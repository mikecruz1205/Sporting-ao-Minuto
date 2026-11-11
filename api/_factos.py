"""Factos de jogos tirados das notícias (servidor).

O ficheiro dados/jogos_noticias.json é escrito por quem lê as notícias: a
tarefa agendada do Claude (uma "routine" do Claude Code, que corre na
nuvem com a subscrição do utilizador) e as sessões do Claude Code. A
tarefa grava-o no ramo `dados-noticias` do GitHub (NOTICIAS_RAMO); o site
lê-o de lá (o repositório é público), por isso uma atualização não precisa
de nova publicação. Sem rede, fica a cópia que vem com o site.

As regras não dependem de quem escreve: aplicam-se aqui, à leitura.
  * O resultado e cada golo só contam com pelo menos DOIS jornais
    diferentes. Com um só, ficam de fora.
  * Os outros lances, as notas e as estatísticas precisam de uma fonte com
    ligação https; mostram sempre de que jornal vieram.
  * Golos a mais para o resultado = dados incoerentes: saem todos os golos.
  * "Em direto" ou "intervalo" com mais de 40 minutos já não é verdade:
    o estado passa a desconhecido.
Nada se deduz nem se estima a partir do que falta.
"""
import json
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FICHEIRO = os.path.join(RAIZ, "dados", "jogos_noticias.json")
REPOSITORIO = "mikecruz1205/Sporting-ao-Minuto"
URL_RAW = "https://raw.githubusercontent.com/%s/%s/dados/jogos_noticias.json"

TIPOS = {"golo", "penalti", "autogolo", "penalti_falhado", "amarelo", "segundo_amarelo", "vermelho",
         "substituicao", "var", "ocasiao", "golo_anulado", "lance"}
GOLOS = {"golo", "penalti", "autogolo"}
ESTADOS = {"agendado", "direto", "intervalo", "terminado", "adiado"}
DIRETO_VALIDO = timedelta(minutes=40)
_CACHE = {"t": 0.0, "dados": None}


def _texto(v, maximo=160):
    return v.strip()[:maximo] if isinstance(v, str) and v.strip() else None


def _inteiro(v, minimo, maximo):
    return v if isinstance(v, int) and not isinstance(v, bool) and minimo <= v <= maximo else None


def _quando(v):
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _fontes_validas(bruto):
    saida = {}
    for chave, f in (bruto or {}).items():
        if not isinstance(f, dict):
            continue
        url, jornal = _texto(f.get("url"), 400), _texto(f.get("jornal"), 60)
        if url and jornal and url.startswith("https://"):
            saida[str(chave)] = {"jornal": jornal, "titulo": _texto(f.get("titulo"), 200), "url": url}
    return saida


def _resolver(ids, fontes):
    lista = [fontes[i] for i in (ids or []) if isinstance(i, str) and i in fontes]
    return lista, {f["jornal"].lower() for f in lista}


def validar_jogo(j, agora):
    data, casa, fora = _texto(j.get("data"), 10), _texto(j.get("casa"), 60), _texto(j.get("fora"), 60)
    if not (data and casa and fora):
        return None
    fontes = _fontes_validas(j.get("fontes"))
    atualizado = _quando(j.get("atualizado_em"))

    estado = j.get("estado") if j.get("estado") in ESTADOS else None
    minuto = _inteiro(j.get("minuto"), 0, 130)
    if estado in ("direto", "intervalo") and (not atualizado or agora - atualizado > DIRETO_VALIDO):
        estado, minuto = None, None

    resultado = None
    r = j.get("resultado") or {}
    lista, jornais = _resolver(r.get("fontes"), fontes)
    gc, gf = _inteiro(r.get("casa"), 0, 30), _inteiro(r.get("fora"), 0, 30)
    if gc is not None and gf is not None and len(jornais) >= 2:
        resultado = {"casa": gc, "fora": gf, "fontes": lista}

    eventos = []
    for e in j.get("eventos") or []:
        if not isinstance(e, dict) or e.get("tipo") not in TIPOS or e.get("equipa") not in ("casa", "fora"):
            continue
        lista, jornais = _resolver(e.get("fontes"), fontes)
        if not lista or (e["tipo"] in GOLOS and len(jornais) < 2):
            continue
        ev = {"tipo": e["tipo"], "minuto": _inteiro(e.get("minuto"), 0, 130),
              "acrescimo": _inteiro(e.get("acrescimo"), 1, 30), "equipa": e["equipa"], "fontes": lista}
        ordem = _inteiro(e.get("ordem"), 0, 130)
        ev["ordem"] = ev["minuto"] if ev["minuto"] is not None else (ordem if ordem is not None else 999)
        for campo in ("jogador", "assistencia", "entrou", "saiu", "detalhe", "nota"):
            v = _texto(e.get(campo))
            if v:
                ev[campo] = v
        eventos.append(ev)
    # mais golos de um lado do que o resultado diz: incoerente, saem os golos
    if resultado:
        for lado in ("casa", "fora"):
            if sum(1 for e in eventos if e["tipo"] in GOLOS and e["equipa"] == lado) > resultado[lado]:
                eventos = [e for e in eventos if e["tipo"] not in GOLOS]
                break
    eventos.sort(key=lambda e: (e["ordem"], e.get("acrescimo") or 0))

    est = j.get("estatisticas") or {}
    linhas = []
    for l in est.get("linhas") or []:
        lista, _ = _resolver(l.get("fontes"), fontes)
        rotulo = _texto(l.get("rotulo"), 60)
        c, f = l.get("casa"), l.get("fora")
        numeros = all(isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x <= 1000 for x in (c, f))
        if lista and rotulo and numeros:
            linhas.append({"chave": _texto(l.get("chave"), 40) or rotulo, "rotulo": rotulo,
                           "unidade": _texto(l.get("unidade"), 4) or "", "casa": c, "fora": f, "fontes": lista})
    notas = []
    for n in est.get("notas") or []:
        lista, _ = _resolver(n.get("fontes"), fontes)
        texto = _texto(n.get("texto"), 200)
        if lista and texto:
            notas.append({"texto": texto, "fontes": lista})

    return {"data": data, "casa": casa, "fora": fora, "competicao": _texto(j.get("competicao"), 60),
            "fase": _texto(j.get("fase"), 60), "estado": estado, "minuto": minuto,
            "atualizado_em": atualizado.strftime("%Y-%m-%dT%H:%M:%SZ") if atualizado else None,
            "resultado": resultado, "eventos": eventos, "estatisticas": {"linhas": linhas, "notas": notas}}


def validar(bruto, agora=None):
    agora = agora or datetime.now(timezone.utc)
    jogos = [v for v in (validar_jogo(j, agora) for j in (bruto or {}).get("jogos") or [] if isinstance(j, dict)) if v]
    return {"atualizado_em": _texto((bruto or {}).get("atualizado_em"), 30), "jogos": jogos}


def _ler_raw(ramo, abrir):
    pedido = urllib.request.Request(URL_RAW % (REPOSITORIO, ramo), headers={"User-Agent": "SportingAoMinuto/1.0"})
    with (abrir or urllib.request.urlopen)(pedido, timeout=4) as r:
        return json.loads(r.read().decode("utf-8"))


def ler(abrir=None, agora=None, validade=60):
    """Os factos já validados. Do ramo de dados no GitHub; sem resposta, da
    cópia que vem com o site. Guardados em memória `validade` segundos."""
    if _CACHE["dados"] is not None and time.time() - _CACHE["t"] < validade and abrir is None:
        return _CACHE["dados"]
    bruto = None
    try:
        bruto = _ler_raw(os.environ.get("NOTICIAS_RAMO", "dados-noticias"), abrir)
    except Exception:
        try:
            with open(FICHEIRO, encoding="utf-8") as f:
                bruto = json.load(f)
        except Exception:
            bruto = {}
    dados = validar(bruto, agora)
    if abrir is None:
        _CACHE.update(t=time.time(), dados=dados)
    return dados


def procurar(dados, data_local, casa, fora, mesma):
    for j in dados.get("jogos") or []:
        if j["data"] == data_local and mesma(j["casa"], casa) and mesma(j["fora"], fora):
            return j
    return None


def _jornais(lista):
    vistos = []
    for f in lista:
        if f["jornal"] not in vistos:
            vistos.append(f["jornal"])
    return vistos


def normalizar(j):
    """Um jogo validado → o formato de api/_jogo.py (fonte "nt")."""
    todas = [f for e in j["eventos"] for f in e["fontes"]] + ((j["resultado"] or {}).get("fontes") or []) + \
        [f for b in j["estatisticas"]["linhas"] + j["estatisticas"]["notas"] for f in b["fontes"]]
    nome = "Notícias (%s)" % ", ".join(_jornais(todas)) if todas else "Notícias"
    hora = j["atualizado_em"]
    r = j["resultado"]
    est = j["estatisticas"]
    tem_est = bool(est["linhas"] or est["notas"])
    return {
        "fonte_id": None,
        "jogo": {"competicao": j["competicao"], "jornada": None, "data": None, "estadio": None, "arbitro": None,
                 "casa": {"nome": j["casa"]}, "fora": {"nome": j["fora"]}},
        "estado": {"codigo": j["estado"] or "desconhecido", "fase": None, "texto_fonte": None,
                   "minuto": j["minuto"], "acrescimo": None, "fonte": nome, "atualizado_em": hora,
                   "atraso": "Lido das notícias: pode ter alguns minutos de atraso."},
        "resultado": {"casa": r["casa"] if r else None, "fora": r["fora"] if r else None, "intervalo": None,
                      "penaltis": None, "fonte": nome, "atualizado_em": hora},
        "eventos": {"disponivel": bool(j["eventos"]), "lista": j["eventos"], "fonte": nome, "atualizado_em": hora,
                    "motivo": None if j["eventos"] else "As notícias lidas ainda não descrevem lances deste jogo."},
        "estatisticas": {"disponivel": tem_est, "linhas": est["linhas"], "notas": est["notas"], "fonte": nome,
                         "atualizado_em": hora,
                         "motivo": None if tem_est else "As notícias lidas não dão estatísticas deste jogo."},
        "equipas": {"disponivel": False, "fonte": nome, "atualizado_em": hora,
                    "motivo": "Os onzes não se tiram das notícias."},
        "jogadores": {"disponivel": False, "lista": [], "fonte": nome, "atualizado_em": hora,
                      "motivo": "As estatísticas individuais não se tiram das notícias."},
    }


def resposta(abrir=None):
    """GET /api/factos — todos os factos validados, para o browser."""
    try:
        dados = ler(abrir)
        return 200, {"Content-Type": "application/json; charset=utf-8",
                     "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=600"}, \
            json.dumps(dados, ensure_ascii=False).encode("utf-8")
    except Exception:
        return 502, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, \
            json.dumps({"erro": "factos indisponíveis"}, ensure_ascii=False).encode("utf-8")
