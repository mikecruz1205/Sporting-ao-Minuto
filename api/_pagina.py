"""Páginas partilháveis: /jogo/<data>-<casa>-<fora> e /jogador/<nome>.

É o mesmo index.html do site, com o título, a descrição e a pré-visualização
(Open Graph, a que o WhatsApp, o Facebook e o X mostram) do jogo ou do
jogador. Quem abre a ligação vê o site normal, já no jogo ou na ficha.

Duas coisas extra no <head>:
  · <base href="/"> logo a seguir ao charset: os ficheiros do site são
    pedidos com caminhos relativos (css/…, js/…, dados/…), que num endereço
    de dois níveis (/jogo/…) apontariam para /jogo/css/…;
  · <script type="application/json" id="pagina-partilhada"> com o que se
    encontrou, para o site abrir logo o jogo ou o jogador certo.

Os dados são os da base de dados (desporto_jogos, desporto_jogadores e
desporto_estatisticas_epoca), lidos com a chave publicável. Sem dados para
aquele endereço, a página sai com a descrição normal do site.

Usado por api/pagina.py (Vercel) e pelo servidor.py (local).
"""
import html
import json
import os
import re
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from _calendario import CHAVE_PUBLICA, SITE, URL_PROJETO, ler_data

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
         "setembro", "outubro", "novembro", "dezembro"]
POSICOES = {"GR": "Guarda-redes", "DEF": "Defesa", "MED": "Médio", "AVA": "Avançado"}
FONTES = {"wikipedia": "Wikipédia", "zerozero": "zerozero", "api-football": "API-Football"}


def slug(texto):
    """'Vitória de Guimarães' → 'vitoria-de-guimaraes' (o mesmo em js/app.js)."""
    t = unicodedata.normalize("NFD", str(texto or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def _ultimo_domingo(ano, mes):
    d = (datetime(ano, mes + 1, 1, tzinfo=timezone.utc) - timedelta(days=1))
    while d.weekday() != 6:
        d -= timedelta(days=1)
    return d.replace(hour=1)


def lisboa(d):
    """Hora de Lisboa (hora de verão da UE: do último domingo de março ao de outubro, à 1h UTC)."""
    d = d.astimezone(timezone.utc)
    verao = _ultimo_domingo(d.year, 3) <= d < _ultimo_domingo(d.year, 10)
    return (d + timedelta(hours=1 if verao else 0)).replace(tzinfo=None)


def caminho_jogo(j):
    return "/jogo/%s-%s-%s" % (lisboa(ler_data(j["data"])).strftime("%Y-%m-%d"), slug(j["casa"]), slug(j["fora"]))


def caminho_jogador(p):
    return "/jogador/" + slug(p["nome"])


def meta_jogo(j):
    quando = lisboa(ler_data(j["data"]))
    dia = "%s, %d de %s de %d, às %s" % (DIAS[quando.weekday()], quando.day, MESES[quando.month - 1],
                                          quando.year, quando.strftime("%H:%M"))
    prova = " · ".join(x for x in (j.get("competicao"), j.get("fase")) if x)
    if j.get("golos_casa") is not None and j.get("golos_fora") is not None:
        titulo = "%s %s–%s %s" % (j["casa"], j["golos_casa"], j["golos_fora"], j["fora"])
        descricao = "Resultado final. %s. Jogado %s%s." % (prova or "Futebol", dia, ", " + j["local"] if j.get("local") else "")
    else:
        titulo = "%s – %s" % (j["casa"], j["fora"])
        descricao = "%s. %s%s. Centro de jogo, prognósticos e notícias no Sporting ao Minuto." % (
            prova or "Futebol", dia[0].upper() + dia[1:], ", " + j["local"] if j.get("local") else "")
    return {"titulo": titulo, "descricao": descricao, "caminho": caminho_jogo(j)}


def meta_jogador(p, estatisticas=None):
    partes = [POSICOES.get(p.get("posicao"), "Jogador") + " do Sporting CP"]
    if p.get("numero") is not None:
        partes.append("n.º %d" % p["numero"])
    if p.get("idade") is not None:
        partes.append("%d anos" % p["idade"])
    if p.get("nacionalidade"):
        partes.append(p["nacionalidade"])
    descricao = ", ".join(partes) + "."
    e = estatisticas or {}
    if e.get("jogos"):
        golos = e.get("golos") or 0
        descricao += " Época %s: %d %s e %d %s (segundo a %s)." % (
            e["epoca"], e["jogos"], "jogo" if e["jogos"] == 1 else "jogos",
            golos, "golo" if golos == 1 else "golos", FONTES.get(e.get("fonte"), e.get("fonte") or "fonte"))
    return {"titulo": p["nome"], "descricao": descricao, "caminho": caminho_jogador(p)}


# --------------------------------------------------------------------- dados
def _rest(caminho):
    pedido = urllib.request.Request(URL_PROJETO + "/rest/v1/" + caminho,
                                    headers={"apikey": CHAVE_PUBLICA, "Accept": "application/json"})
    with urllib.request.urlopen(pedido, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))


def procurar_jogo(resto, ler=_rest):
    """resto = 'AAAA-MM-DD-casa-fora'. O Sporting joga no máximo um jogo por dia:
    o dia chega; os nomes desempatam se houver mais de um."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:-([a-z0-9-]*))?$", resto or "")
    if not m:
        return None
    dia = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
    de, ate = (dia - timedelta(hours=3)).isoformat(), (dia + timedelta(hours=27)).isoformat()
    jogos = ler("desporto_jogos?select=id,data,competicao,fase,casa,fora,golos_casa,golos_fora,local"
                "&data=gte.%s&data=lt.%s&order=data" % (urllib.parse.quote(de), urllib.parse.quote(ate)))
    do_dia = [j for j in jogos if lisboa(ler_data(j["data"])).date() == dia.date()]
    if len(do_dia) > 1 and m.group(4):
        iguais = [j for j in do_dia if caminho_jogo(j).endswith(m.group(4))]
        do_dia = iguais or do_dia
    return do_dia[0] if do_dia else None


def procurar_jogador(resto, ler=_rest):
    jogadores = ler("desporto_jogadores?select=id,nome,nome_curto,posicao,numero,idade,nacionalidade&no_plantel=is.true")
    alvo = slug(resto)
    p = next((x for x in jogadores if alvo in (slug(x["nome"]), slug(x.get("nome_curto")))), None)
    if not p:
        return None, None
    linhas = ler("desporto_estatisticas_epoca?select=epoca,competicao,jogos,golos,fonte&jogador_id=eq.%d"
                 "&order=epoca.desc" % p["id"])
    est = next((l for l in linhas if l.get("competicao") == "todas"), linhas[0] if linhas else None)
    return p, est


# --------------------------------------------------------------------- página
def _attr(texto):
    return html.escape(texto, quote=True)


def montar(base, meta=None, dados=None):
    """index.html com os metadados do jogo/jogador (ou sem eles) e o <base>."""
    pagina = base.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/">', 1)
    if meta:
        titulo = "%s · Sporting ao Minuto" % meta["titulo"]
        url = SITE + meta["caminho"]
        trocas = [
            (r"(<title>)[^<]*", html.escape(titulo, quote=False)),
            (r'(<meta name="description" id="meta-descricao" content=")[^"]*', _attr(meta["descricao"])),
            (r'(<link rel="canonical" id="canonico" href=")[^"]*', _attr(url)),
            (r'(<meta property="og:title" id="og-titulo" content=")[^"]*', _attr(titulo)),
            (r'(<meta property="og:url" id="og-url" content=")[^"]*', _attr(url)),
            (r'(<meta property="og:description" id="og-descricao" content=")[^"]*', _attr(meta["descricao"])),
            (r'(<meta name="twitter:title" content=")[^"]*', _attr(titulo)),
            (r'(<meta name="twitter:description" content=")[^"]*', _attr(meta["descricao"])),
        ]
        for padrao, valor in trocas:
            pagina = re.sub(padrao, lambda m, valor=valor: m.group(1) + valor, pagina, count=1)
    if dados:
        js = json.dumps(dados, ensure_ascii=False).replace("<", "\\u003c")
        pagina = pagina.replace("</head>", '<script type="application/json" id="pagina-partilhada">%s</script>\n</head>' % js, 1)
    return pagina


def ler_base():
    with open(os.path.join(RAIZ, "index.html"), encoding="utf-8") as f:
        return f.read()


def resposta(tipo, resto, ler=_rest, base=None):
    """(código, cabeçalhos, corpo). Sem dados ou com falha da base de dados, a
    página sai na mesma (o site trata do resto); só a pré-visualização é a geral."""
    base = base if base is not None else ler_base()
    meta = dados = None
    try:
        if tipo == "jogo":
            j = procurar_jogo(resto, ler)
            if j:
                meta, dados = meta_jogo(j), {"tipo": "jogo", "jogo": j}
        elif tipo == "jogador":
            p, est = procurar_jogador(resto, ler)
            if p:
                meta, dados = meta_jogador(p, est), {"tipo": "jogador", "nome": p["nome"]}
    except Exception:
        pass
    corpo = montar(base, meta, dados or {"tipo": tipo, "resto": resto}).encode("utf-8")
    return 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
    }, corpo
