"""Notícias do Sporting, agregadas no servidor.

Antes, cada browser descarregava o XML completo de 12 jornais a cada 60 s
(cerca de 4 MB por minuto, sem compressão). Agora o servidor lê os jornais,
fica só com as notícias do Sporting e devolve um JSON pequeno e comprimido,
com ETag: se nada mudou, a resposta é um 304 sem corpo.

O filtro é o mesmo do browser (CONFIG.filtroSporting e CONFIG.excluir em
js/data.js): o clube tem de estar no TÍTULO. Nada é reescrito: título,
excerto curto, imagem, data, jornal e ligação para o artigo original.

Usado por api/noticias.py (Vercel) e pelo servidor.py (local).
"""
import gzip
import hashlib
import html
import json
import re
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

# os mesmos jornais de CONFIG.feeds (js/data.js)
FEEDS = [
    ("leonino", "LEONINO", "https://leonino.pt/feed"),
    ("record", "RECORD", "https://www.record.pt/rss"),
    ("mf", "MAISFUTEBOL", "https://maisfutebol.iol.pt/rss"),
    ("nam", "NOTÍCIAS AO MINUTO", "https://www.noticiasaominuto.com/rss/desporto"),
    ("zz", "ZEROZERO", "https://www.zerozero.pt/rss/noticias.php"),
    ("rtp", "RTP", "https://www.rtp.pt/noticias/rss/desporto"),
    ("obs", "OBSERVADOR", "https://observador.pt/seccao/desporto/feed/"),
    ("bnr", "BOLA NA REDE", "https://bolanarede.pt/feed/"),
    ("f365", "FUTEBOL 365", "https://futebol365.pt/feed/"),
    ("cm", "CORREIO DA MANHÃ", "https://www.cmjornal.pt/rss"),
    ("publico", "PÚBLICO", "https://feeds.feedburner.com/PublicoRSS"),
    ("abola", "A BOLA", "https://www.abola.pt/sitemap-news.xml"),
]

FILTRO_SPORTING = re.compile(r"sporting|leões|leonin|alvalade|verde e branco|(?<!rafael\s)\bleão\b", re.I)
EXCLUIR = [re.compile(p, re.I) for p in (
    r"sporting\s+(de\s+)?braga", r"sporting\s+gij", r"sporting\s+kansas", r"sporting\s+cristal",
    r"sporting\s+charleroi", r"sporting\s+covilh", r"sporting\s+lokeren", r"rafael\s+le[ãa]o",
    r"le[ãa]o\s+(xiv|xiii|xii|papa)", r"papa\s+le[ãa]o", r"vaticano|pontif[íi]ce|santa s[ée]",
)]
MAXIMO = 200                 # notícias devolvidas (as mais recentes)
TEMPO_FEED = 8               # segundos por jornal
CACHE_SEGUNDOS = 60          # cada instância relê os jornais no máximo uma vez por minuto


def e_do_sporting(titulo):
    return bool(FILTRO_SPORTING.search(titulo)) and not any(rx.search(titulo) for rx in EXCLUIR)


def para_texto(corpo):
    """Alguns feeds vêm em ISO-8859-1: lê-se a codificação que o XML declara."""
    cabeca = corpo[:200].lower()
    for cod in (b"iso-8859-1", b"latin-1", b"windows-1252"):
        if cod in cabeca:
            nome = cod.decode()
            texto = corpo.decode(nome, errors="replace")
            return texto.replace(nome, "utf-8", 1).replace(nome.upper(), "utf-8", 1)
    return corpo.decode("utf-8", errors="replace")


def limpar(texto):
    """Sem HTML, sem as ligações internas do zerozero e com as entidades resolvidas."""
    t = re.sub(r"\{[A-Z_]+_LINK\|[^|}]*\|([^}]*)\}", r"\1", texto or "")
    t = re.sub(r"<[^>]*>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"[<>]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def chave_titulo(titulo):
    t = unicodedata.normalize("NFD", titulo.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", t).strip()[:60]


def ler_data(texto):
    texto = (texto or "").strip()
    if not texto:
        return None
    try:
        d = parsedate_to_datetime(texto)
    except (TypeError, ValueError, IndexError):
        try:
            d = datetime.fromisoformat(texto.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def _local(tag):
    return tag.rsplit("}", 1)[-1].split(":")[-1]


def _filhos(el, nome):
    return [c for c in el if _local(c.tag) == nome]


def _texto(el, nome):
    for c in el:
        if _local(c.tag) == nome:
            return "".join(c.itertext())
    return ""


def _imagem(item):
    for c in item:
        nome = _local(c.tag)
        if nome == "enclosure" and c.get("url") and re.search("image", c.get("type") or "image", re.I):
            return c.get("url")
    for c in item.iter():
        if _local(c.tag) in ("content", "thumbnail") and c.get("url"):
            return c.get("url")
    corpo = _texto(item, "encoded") or _texto(item, "content") or _texto(item, "description")
    m = re.search(r"""<img[^>]+src=["']([^"']+)["']""", corpo or "", re.I)
    return m.group(1) if m else None


def ler_feed(xml_texto, canal, fonte):
    """Notícias do Sporting de um feed (RSS, Atom ou sitemap de notícias)."""
    try:
        raiz = ET.fromstring(xml_texto.encode("utf-8"))
    except ET.ParseError:
        return []
    saida = []
    for el in raiz.iter():
        nome = _local(el.tag)
        if nome == "url" and any(_local(c.tag) == "news" for c in el):
            noticia = next(c for c in el if _local(c.tag) == "news")
            titulo = limpar(_texto(noticia, "title"))
            link = _texto(el, "loc").strip()
            data = ler_data(_texto(noticia, "publication_date"))
            resumo, imagem = "", None
        elif nome in ("item", "entry"):
            titulo = limpar(_texto(el, "title"))
            link = _texto(el, "link").strip()
            if not link:
                ligacao = _filhos(el, "link")
                link = (ligacao[0].get("href") or "").strip() if ligacao else ""
            data = ler_data(_texto(el, "pubDate") or _texto(el, "updated") or _texto(el, "published"))
            resumo = limpar(_texto(el, "description") or _texto(el, "summary"))[:180]
            imagem = _imagem(el)
        else:
            continue
        if not data or len(titulo) <= 14 or not link.startswith("http") or not e_do_sporting(titulo):
            continue
        saida.append({"titulo": titulo, "link": link, "resumo": resumo, "imagem": imagem,
                      "data": data.strftime("%Y-%m-%dT%H:%M:%SZ"), "fonte": fonte, "canal": canal})
    return saida


def juntar(listas, maximo=MAXIMO):
    """Junta os jornais: fora os repetidos (mesmo endereço ou mesmo título) e
    por ordem de chegada, das mais recentes para as mais antigas."""
    todas = sorted((n for l in listas for n in l), key=lambda n: n["data"], reverse=True)
    vistos_link, vistos_titulo, saida = set(), set(), []
    for n in sorted(todas, key=lambda n: n["data"]):            # a primeira a chegar fica
        k = chave_titulo(n["titulo"])
        if n["link"] in vistos_link or k in vistos_titulo:
            continue
        vistos_link.add(n["link"])
        vistos_titulo.add(k)
        saida.append(n)
    saida.sort(key=lambda n: n["data"], reverse=True)
    return saida[:maximo]


def _buscar(feed):
    canal, fonte, url = feed
    try:
        pedido = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Sporting ao Minuto)"})
        with urllib.request.urlopen(pedido, timeout=TEMPO_FEED) as r:
            return canal, ler_feed(para_texto(r.read()), canal, fonte), True
    except Exception:
        return canal, [], False


_cache = {"quando": 0.0, "corpo": None, "etag": None}


def recolher(agora=None):
    """JSON (bytes) e ETag das notícias, relido no máximo uma vez por minuto."""
    agora = agora or time.time()
    if _cache["corpo"] and agora - _cache["quando"] < CACHE_SEGUNDOS:
        return _cache["corpo"], _cache["etag"]
    with ThreadPoolExecutor(max_workers=len(FEEDS)) as ex:
        resultados = list(ex.map(_buscar, FEEDS))
    noticias = juntar([r[1] for r in resultados])
    falharam = [r[0] for r in resultados if not r[2]]
    if not noticias and _cache["corpo"]:
        return _cache["corpo"], _cache["etag"]                  # todos falharam: fica o último bom
    etag = '"' + hashlib.sha1(json.dumps(noticias, ensure_ascii=False).encode("utf-8")).hexdigest()[:20] + '"'
    corpo = json.dumps({"noticias": noticias, "falharam": falharam,
                        "lido_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
                       ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    _cache.update(quando=agora, corpo=corpo, etag=etag)
    return corpo, etag


def resposta(cabecalhos_pedido, recolher_fn=recolher):
    """(código, cabeçalhos, corpo) para um GET, com 304, gzip e cache na CDN."""
    corpo, etag = recolher_fn()
    cab = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        "ETag": etag,
        "Vary": "Accept-Encoding",
    }
    if etag and etag in (cabecalhos_pedido.get("If-None-Match") or ""):
        return 304, cab, b""
    if "gzip" in (cabecalhos_pedido.get("Accept-Encoding") or ""):
        cab["Content-Encoding"] = "gzip"
        corpo = gzip.compress(corpo, 6)
    return 200, cab, corpo
