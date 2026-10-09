"""Camada unica de dados de jogo (servidor).

Recebe "que jogo" (data e equipas, tal como o calendario do site os tem),
pergunta as fontes configuradas e devolve UM formato normalizado, com a
fonte e a hora de cada bloco de dados. E usada por api/jogo.py (Vercel) e
pelo servidor.py (local); nao depende de nada fora da biblioteca padrao.

Fontes, por ordem de prioridade
  1. API-Football (API_FOOTBALL_KEY)  -> estado, minuto, resultado, eventos,
     onzes, estatisticas da equipa e dos jogadores. So responde se o plano
     cobrir a epoca (o gratuito so tem 2022-2024; a conta esta suspensa a
     2026-10-09).
  2. football-data.org (FOOTBALL_DATA_TOKEN) -> estado e resultado (no plano
     gratuito COM ATRASO); eventos e onzes so nos planos pagos ("Deep Data").
  Sem nenhuma: devolve-se "dados em direto indisponiveis" -- nunca se
  inventa nem se estima nada.

Regras de conflito
  * Estado, minuto e resultado: vence a fonte com prioridade mais alta que
    respondeu. Se duas fontes derem resultados finais diferentes, fica o da
    prioritaria e o conflito vai registado em "fontes".
  * O resultado NUNCA se calcula a partir dos eventos: vem do campo de
    resultado da fonte (um golo anulado sai dos eventos e do resultado
    quando a fonte o corrigir, sem duplicar nada).
  * Os eventos substituem-se em bloco a cada leitura (nao se acrescentam),
    por isso uma atualizacao nunca duplica golos nem cartoes.

Cache
  * Em memoria (por instancia), com tempo conforme o estado do jogo; o
    Vercel guarda tambem a resposta na CDN (s-maxage), partilhada por todos.
  * Se a fonte falhar, devolve-se a ultima resposta boa, marcada como
    desatualizada e com a hora real -- nunca como se fosse atual.
"""

import hashlib
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

AF_BASE = "https://v3.football.api-sports.io/"
FD_BASE = "https://api.football-data.org/v4/"
SPORTING_AF = 228
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NOME_FONTE = {"af": "API-Football", "fd": "football-data.org"}
VERSAO = 1


# ---------------------------------------------------------------------------
# utilitarios
# ---------------------------------------------------------------------------
def agora():
    return datetime.now(timezone.utc)


def iso(d):
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def _ultimo_domingo(ano, mes):
    d = datetime(ano, mes + 1, 1, tzinfo=timezone.utc) - timedelta(days=1) if mes < 12 else datetime(ano, 12, 31, tzinfo=timezone.utc)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def hora_lisboa(d):
    """Hora de Lisboa sem depender da base de fusos do sistema: hora de
    verão da UE entre o último domingo de março e o último de outubro, à 01:00 UTC."""
    d = d.astimezone(timezone.utc)
    inicio = _ultimo_domingo(d.year, 3).replace(hour=1)
    fim = _ultimo_domingo(d.year, 10).replace(hour=1)
    return d.astimezone(timezone(timedelta(hours=1 if inicio <= d < fim else 0)))


def chave_nome(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(fc|sc|cf|cd|sad|clube|club|futebol|sporting clube de|de|do|da)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def mesma_equipa(a, b):
    """'SC Braga' ~ 'Braga' ~ 'Sporting Clube de Braga'. Compara pela palavra
    mais distintiva; o Sporting reconhece-se a parte (ha muitos Sportings)."""
    ka, kb = chave_nome(a), chave_nome(b)
    if not ka or not kb:
        return False
    if eh_sporting(a) or eh_sporting(b):
        return eh_sporting(a) and eh_sporting(b)
    pa, pb = set(ka.split()), set(kb.split())
    return bool(pa & pb) or ka in kb or kb in ka


def eh_sporting(nome):
    n = (nome or "").lower()
    return bool(re.search(r"sporting( cp| clube de portugal| lisbon)?$", n.strip())) or n.strip() in ("sporting cp", "sporting")


def segredo(variavel, ficheiro):
    """Variavel de ambiente (Vercel) ou ficheiro local (nunca publicado:
    esta no .gitignore e no .vercelignore)."""
    v = os.environ.get(variavel, "").strip()
    if v:
        return v
    caminho = os.path.join(RAIZ, ficheiro)
    if os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as f:
            return f.read().strip()
    return ""


class ErroFonte(Exception):
    """motivo: sem_chave | conta | limite | sem_cobertura | tempo | rede | resposta | sem_jogo"""

    def __init__(self, motivo, detalhe=""):
        super().__init__(detalhe or motivo)
        self.motivo = motivo
        self.detalhe = detalhe


# limite de pedidos por instancia e por fonte (a CDN faz o grosso do trabalho)
_JANELA = {}
LIMITE_POR_MINUTO = {"af": 20, "fd": 8}


def _gastar(fonte):
    t = time.time()
    fila = [x for x in _JANELA.get(fonte, []) if t - x < 60]
    if len(fila) >= LIMITE_POR_MINUTO[fonte]:
        _JANELA[fonte] = fila
        raise ErroFonte("limite", "limite de pedidos por minuto deste servidor")
    fila.append(t)
    _JANELA[fonte] = fila


def pedir_json(url, cabecalhos, fonte, tempo=6, tentativas=2, abrir=None):
    """GET com tempo limite e uma nova tentativa em 429/5xx/timeout.
    'abrir' permite aos testes simular a rede."""
    abrir = abrir or urllib.request.urlopen
    ultimo = None
    for n in range(tentativas):
        _gastar(fonte)
        try:
            pedido = urllib.request.Request(url, headers={**cabecalhos, "Accept": "application/json"})
            with abrir(pedido, timeout=tempo) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise ErroFonte("conta", "a fonte recusou a chave (%s)" % e.code)
            if e.code == 404:
                raise ErroFonte("sem_jogo", "a fonte nao conhece este pedido")
            ultimo = ErroFonte("limite" if e.code == 429 else "resposta", "HTTP %s" % e.code)
        except (TimeoutError, OSError) as e:
            ultimo = ErroFonte("tempo" if "timed out" in str(e).lower() else "rede", str(e)[:120])
        except ValueError:
            ultimo = ErroFonte("resposta", "a fonte devolveu algo que nao e JSON")
        if n + 1 < tentativas:
            time.sleep(0.6 * (n + 1))
    raise ultimo


def _id_evento(*partes):
    return hashlib.sha1("|".join(str(p) for p in partes).encode()).hexdigest()[:12]


def _num(v):
    """'54%' -> 54 ; '1.23' -> 1.23 ; None -> None ; 0 -> 0"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip().replace("%", "").replace(",", ".")
    if s in ("", "-", "null"):
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else round(f, 2)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# API-Football
# ---------------------------------------------------------------------------
ESTADOS_AF = {
    "TBD": "agendado", "NS": "agendado", "1H": "direto", "HT": "intervalo", "2H": "direto",
    "ET": "direto", "BT": "intervalo", "P": "direto", "LIVE": "direto", "SUSP": "suspenso",
    "INT": "interrompido", "FT": "terminado", "AET": "terminado", "PEN": "terminado",
    "PST": "adiado", "CANC": "cancelado", "ABD": "abandonado", "AWD": "terminado", "WO": "terminado",
}
FASES_AF = {
    "1H": "1.ª parte", "2H": "2.ª parte", "HT": "Intervalo", "ET": "Prolongamento",
    "BT": "Intervalo do prolongamento", "P": "Grandes penalidades", "AET": "Após prolongamento",
    "PEN": "Após grandes penalidades", "FT": "Resultado final",
}
ESTATS_AF = [
    # (tipo na fonte, chave, rotulo, unidade)
    ("Ball Possession", "posse", "Posse de bola", "%"),
    ("Total Shots", "remates", "Remates", ""),
    ("Shots on Goal", "remates_baliza", "Remates à baliza", ""),
    ("Shots off Goal", "remates_fora", "Remates para fora", ""),
    ("Blocked Shots", "remates_bloqueados", "Remates bloqueados", ""),
    ("Corner Kicks", "cantos", "Cantos", ""),
    ("Fouls", "faltas", "Faltas", ""),
    ("Offsides", "foras_jogo", "Foras de jogo", ""),
    ("Yellow Cards", "amarelos", "Cartões amarelos", ""),
    ("Red Cards", "vermelhos", "Cartões vermelhos", ""),
    ("Goalkeeper Saves", "defesas", "Defesas do guarda-redes", ""),
    ("Total passes", "passes", "Passes", ""),
    ("Passes accurate", "passes_certos", "Passes certos", ""),
    ("Passes %", "precisao_passe", "Precisão de passe", "%"),
    ("expected_goals", "xg", "Golos esperados (xG)", ""),
]
POSICAO_AF = {"G": "GR", "D": "DEF", "M": "MED", "F": "AVA"}


def _lado(team_id, casa_id):
    return "casa" if team_id == casa_id else "fora"


def eventos_af(fx):
    casa_id = fx["teams"]["home"]["id"]
    # quem esta em campo, para saber o sentido de cada substituicao
    em_campo = {}
    for l in fx.get("lineups") or []:
        em_campo[l["team"]["id"]] = {(p.get("player") or {}).get("name") for p in l.get("startXI") or []}
    saida, vistos = [], {}
    for e in sorted(fx.get("events") or [], key=lambda e: ((e.get("time") or {}).get("elapsed") or 0,
                                                           (e.get("time") or {}).get("extra") or 0)):
        t = e.get("time") or {}
        tipo_f, detalhe = (e.get("type") or "").lower(), (e.get("detail") or "")
        equipa_id = (e.get("team") or {}).get("id")
        jogador = (e.get("player") or {}).get("name")
        outro = (e.get("assist") or {}).get("name")
        ev = {"minuto": t.get("elapsed"), "acrescimo": t.get("extra"), "equipa": _lado(equipa_id, casa_id)}
        if tipo_f == "goal":
            d = detalhe.lower()
            if "missed" in d:
                ev.update(tipo="penalti_falhado", jogador=jogador)
            elif "own" in d:
                ev.update(tipo="autogolo", jogador=jogador)
            else:
                ev.update(tipo="penalti" if "penalty" in d else "golo", jogador=jogador, assistencia=outro)
        elif tipo_f == "card":
            d = detalhe.lower()
            ev.update(tipo="segundo_amarelo" if "second" in d else "vermelho" if "red" in d else "amarelo", jogador=jogador)
        elif tipo_f == "subst":
            campo = em_campo.setdefault(equipa_id, set())
            if jogador in campo and outro not in campo:
                saiu, entrou = jogador, outro
            elif outro in campo and jogador not in campo:
                saiu, entrou = outro, jogador
            else:
                saiu = entrou = None          # a fonte nao deixa saber o sentido
            if saiu:
                campo.discard(saiu)
                campo.add(entrou)
            ev.update(tipo="substituicao", entrou=entrou, saiu=saiu,
                      jogadores=None if saiu else [x for x in (jogador, outro) if x])
        elif tipo_f == "var":
            ev.update(tipo="var", jogador=jogador, detalhe=traduz_var(detalhe))
        else:
            continue
        base = (ev["tipo"], ev["minuto"], ev["acrescimo"], ev["equipa"], jogador, outro)
        vistos[base] = vistos.get(base, 0) + 1
        ev["id"] = _id_evento(*base, vistos[base])
        saida.append({k: v for k, v in ev.items() if v is not None or k in ("acrescimo",)})
    return saida


def traduz_var(d):
    d0 = (d or "").lower()
    if "goal cancelled" in d0 or "goal disallowed" in d0:
        return "Golo anulado" + (" (fora de jogo)" if "offside" in d0 else "")
    if "penalty confirmed" in d0:
        return "Penálti confirmado"
    if "penalty cancelled" in d0:
        return "Penálti anulado"
    if "card upgrade" in d0:
        return "Cartão agravado"
    return d or "Decisão do VAR"


def estatisticas_af(fx):
    blocos = fx.get("statistics") or []
    if len(blocos) < 2:
        return []
    casa_id = fx["teams"]["home"]["id"]
    por_lado = {}
    for b in blocos:
        por_lado[_lado((b.get("team") or {}).get("id"), casa_id)] = {
            s.get("type"): s.get("value") for s in b.get("statistics") or []}
    linhas = []
    for tipo, chave, rotulo, unidade in ESTATS_AF:
        c, f = _num(por_lado.get("casa", {}).get(tipo)), _num(por_lado.get("fora", {}).get(tipo))
        if c is None and f is None:
            continue
        linhas.append({"chave": chave, "rotulo": rotulo, "unidade": unidade, "casa": c, "fora": f})
    return linhas


def equipas_af(fx):
    casa_id = fx["teams"]["home"]["id"]
    saida = {}
    for l in fx.get("lineups") or []:
        def jog(p):
            j = p.get("player") or {}
            return {"nome": j.get("name"), "numero": j.get("number"), "posicao": POSICAO_AF.get(j.get("pos"), j.get("pos"))}
        saida[_lado((l.get("team") or {}).get("id"), casa_id)] = {
            "formacao": l.get("formation"), "treinador": (l.get("coach") or {}).get("name"),
            "titulares": [jog(p) for p in l.get("startXI") or []],
            "suplentes": [jog(p) for p in l.get("substitutes") or []],
        }
    return saida


def jogadores_af(fx):
    casa_id = fx["teams"]["home"]["id"]
    saida = []
    for bloco in fx.get("players") or []:
        lado = _lado((bloco.get("team") or {}).get("id"), casa_id)
        for p in bloco.get("players") or []:
            s = (p.get("statistics") or [{}])[0]
            g, sh, ps, tk = s.get("games") or {}, s.get("shots") or {}, s.get("passes") or {}, s.get("tackles") or {}
            gl, fl, cd = s.get("goals") or {}, s.get("fouls") or {}, s.get("cards") or {}
            precisao = ps.get("accuracy")
            certos = _num(precisao) if precisao is not None and "%" not in str(precisao) else None
            linha = {
                "equipa": lado, "nome": (p.get("player") or {}).get("name"),
                "numero": g.get("number"), "posicao": POSICAO_AF.get(g.get("position"), g.get("position")),
                "titular": g.get("substitute") is False if g.get("substitute") is not None else None,
                "minutos": g.get("minutes"), "golos": gl.get("total"), "assistencias": gl.get("assists"),
                "remates": sh.get("total"), "remates_baliza": sh.get("on"),
                "passes": ps.get("total"), "passes_chave": ps.get("key"),
                "passes_certos": certos if (certos is not None and ps.get("total") is not None and certos <= ps.get("total")) else None,
                "precisao_passe": _num(precisao) if precisao is not None and "%" in str(precisao) else None,
                "desarmes": tk.get("total"), "intercecoes": tk.get("interceptions"),
                "faltas_cometidas": fl.get("committed"), "faltas_sofridas": fl.get("drawn"),
                "amarelos": cd.get("yellow"), "vermelhos": cd.get("red"),
                "defesas": gl.get("saves"), "golos_sofridos": gl.get("conceded"),
                "nota": _num(g.get("rating")),
            }
            saida.append(linha)
    return saida


def normalizar_af(fx, quando=None):
    f, liga, eq, golos, score = fx["fixture"], fx.get("league") or {}, fx["teams"], fx.get("goals") or {}, fx.get("score") or {}
    st = f.get("status") or {}
    codigo = ESTADOS_AF.get(st.get("short"), "desconhecido")
    em_jogo = codigo in ("direto", "intervalo")
    hora = iso(quando or agora())
    eventos = eventos_af(fx)
    estats = estatisticas_af(fx)
    equipas = equipas_af(fx)
    jogadores = jogadores_af(fx)
    return {
        "fonte_id": "af:%s" % f.get("id"),
        "jogo": {
            "competicao": liga.get("name"), "jornada": liga.get("round"), "epoca": liga.get("season"),
            "data": f.get("date"), "estadio": (f.get("venue") or {}).get("name"),
            "arbitro": f.get("referee"),
            "casa": {"nome": eq["home"].get("name")}, "fora": {"nome": eq["away"].get("name")},
        },
        "estado": {
            "codigo": codigo, "fase": FASES_AF.get(st.get("short")), "texto_fonte": st.get("long"),
            "minuto": st.get("elapsed") if em_jogo else None,
            "acrescimo": st.get("extra") if em_jogo else None,
            "fonte": NOME_FONTE["af"], "atualizado_em": hora, "atraso": None,
        },
        "resultado": {
            "casa": golos.get("home"), "fora": golos.get("away"),
            "intervalo": (score.get("halftime") or {}) if (score.get("halftime") or {}).get("home") is not None else None,
            "penaltis": (score.get("penalty") or {}) if (score.get("penalty") or {}).get("home") is not None else None,
            "fonte": NOME_FONTE["af"], "atualizado_em": hora,
        },
        "eventos": {"disponivel": "events" in fx, "lista": eventos, "fonte": NOME_FONTE["af"], "atualizado_em": hora},
        "estatisticas": {"disponivel": bool(estats), "linhas": estats, "fonte": NOME_FONTE["af"], "atualizado_em": hora,
                         "motivo": None if estats else "A fonte ainda não publicou estatísticas deste jogo."},
        "equipas": {"disponivel": bool(equipas), **equipas, "fonte": NOME_FONTE["af"], "atualizado_em": hora,
                    "motivo": None if equipas else "Os onzes ainda não foram publicados pela fonte."},
        "jogadores": {"disponivel": bool(jogadores), "lista": jogadores, "fonte": NOME_FONTE["af"], "atualizado_em": hora,
                      "motivo": None if jogadores else "A fonte ainda não publicou estatísticas individuais."},
    }


def ler_af(data_local, casa, fora, fonte_id=None, abrir=None):
    chave = segredo("API_FOOTBALL_KEY", "chave-api.txt")
    if not chave:
        raise ErroFonte("sem_chave", "API_FOOTBALL_KEY não está configurada no servidor")
    cab = {"x-apisports-key": chave}

    def get(caminho):
        d = pedir_json(AF_BASE + caminho, cab, "af", abrir=abrir)
        erros = d.get("errors")
        if erros:
            texto = json.dumps(erros, ensure_ascii=False).lower()
            if "suspend" in texto or "token" in texto or "key" in texto:
                raise ErroFonte("conta", "conta ou chave recusada pela API-Football")
            if "request" in texto and "limit" in texto or "ratelimit" in texto:
                raise ErroFonte("limite", "limite diário de pedidos atingido")
            if "plan" in texto or "season" in texto:
                raise ErroFonte("sem_cobertura", "o plano não cobre esta época")
            raise ErroFonte("resposta", texto[:160])
        return d

    fid = fonte_id[3:] if fonte_id and fonte_id.startswith("af:") else None
    if not fid:
        lista = get("fixtures?" + urllib.parse.urlencode({"team": SPORTING_AF, "date": data_local, "timezone": "Europe/Lisbon"}))
        candidatos = [x for x in lista.get("response") or []
                      if mesma_equipa(x["teams"]["home"]["name"], casa) and mesma_equipa(x["teams"]["away"]["name"], fora)]
        candidatos = candidatos or (lista.get("response") or [])[:1]
        if not candidatos:
            raise ErroFonte("sem_jogo", "a API-Football não tem este jogo nesta data")
        fid = candidatos[0]["fixture"]["id"]
    d = get("fixtures?id=%s" % fid)
    if not d.get("response"):
        raise ErroFonte("sem_jogo", "a API-Football não devolveu o jogo")
    return normalizar_af(d["response"][0])


# ---------------------------------------------------------------------------
# football-data.org
# ---------------------------------------------------------------------------
ESTADOS_FD = {
    "SCHEDULED": "agendado", "TIMED": "agendado", "IN_PLAY": "direto", "LIVE": "direto",
    "PAUSED": "intervalo", "FINISHED": "terminado", "AWARDED": "terminado",
    "SUSPENDED": "suspenso", "POSTPONED": "adiado", "CANCELLED": "cancelado",
}


def normalizar_fd(m, plano_gratuito=True, quando=None):
    st = m.get("status")
    codigo = ESTADOS_FD.get(st, "desconhecido")
    em_jogo = codigo in ("direto", "intervalo")
    sc = m.get("score") or {}
    ft, ht = sc.get("fullTime") or {}, sc.get("halfTime") or {}
    hora = m.get("lastUpdated") or iso(quando or agora())
    casa_id = (m.get("homeTeam") or {}).get("id")
    atraso = ("Com atraso: o plano gratuito do football-data.org atualiza os resultados com alguns minutos de atraso."
              if plano_gratuito else None)

    eventos, tem_eventos = [], any(k in m for k in ("goals", "bookings", "substitutions"))
    vistos = {}
    for g in m.get("goals") or []:
        t = (g.get("type") or "").upper()
        ev = {"tipo": "autogolo" if t == "OWN" else "penalti" if t == "PENALTY" else "golo",
              "minuto": g.get("minute"), "acrescimo": g.get("injuryTime"),
              "equipa": _lado((g.get("team") or {}).get("id"), casa_id),
              "jogador": (g.get("scorer") or {}).get("name"), "assistencia": (g.get("assist") or {}).get("name")}
        eventos.append(ev)
    for b in m.get("bookings") or []:
        c = b.get("card")
        eventos.append({"tipo": "vermelho" if c == "RED" else "segundo_amarelo" if c == "YELLOW_RED" else "amarelo",
                        "minuto": b.get("minute"), "acrescimo": None,
                        "equipa": _lado((b.get("team") or {}).get("id"), casa_id), "jogador": (b.get("player") or {}).get("name")})
    for s in m.get("substitutions") or []:
        eventos.append({"tipo": "substituicao", "minuto": s.get("minute"), "acrescimo": None,
                        "equipa": _lado((s.get("team") or {}).get("id"), casa_id),
                        "entrou": (s.get("playerIn") or {}).get("name"), "saiu": (s.get("playerOut") or {}).get("name")})
    eventos.sort(key=lambda e: (e.get("minuto") or 0, e.get("acrescimo") or 0))
    for ev in eventos:
        base = (ev["tipo"], ev["minuto"], ev["acrescimo"], ev["equipa"], ev.get("jogador") or ev.get("entrou"), ev.get("assistencia") or ev.get("saiu"))
        vistos[base] = vistos.get(base, 0) + 1
        ev["id"] = _id_evento(*base, vistos[base])

    def onze(lado):
        eq = m.get("homeTeam" if lado == "casa" else "awayTeam") or {}
        if not eq.get("lineup"):
            return None
        conv = lambda p: {"nome": p.get("name"), "numero": p.get("shirtNumber"), "posicao": p.get("position")}
        return {"formacao": eq.get("formation"), "treinador": (eq.get("coach") or {}).get("name"),
                "titulares": [conv(p) for p in eq.get("lineup") or []], "suplentes": [conv(p) for p in eq.get("bench") or []]}

    equipas = {k: v for k, v in (("casa", onze("casa")), ("fora", onze("fora"))) if v}
    sem_plano = "O plano gratuito do football-data.org não inclui {}."
    return {
        "fonte_id": "fd:%s" % m.get("id"),
        "jogo": {
            "competicao": (m.get("competition") or {}).get("name"), "jornada": m.get("matchday"),
            "data": m.get("utcDate"), "estadio": m.get("venue"),
            "arbitro": ((m.get("referees") or [{}])[0] or {}).get("name"),
            "casa": {"nome": (m.get("homeTeam") or {}).get("name")}, "fora": {"nome": (m.get("awayTeam") or {}).get("name")},
        },
        "estado": {"codigo": codigo, "fase": None, "texto_fonte": st,
                   "minuto": m.get("minute") if em_jogo else None, "acrescimo": m.get("injuryTime") if em_jogo else None,
                   "fonte": NOME_FONTE["fd"], "atualizado_em": hora, "atraso": atraso},
        "resultado": {"casa": ft.get("home"), "fora": ft.get("away"),
                      "intervalo": ht if ht.get("home") is not None else None, "penaltis": None,
                      "fonte": NOME_FONTE["fd"], "atualizado_em": hora},
        "eventos": {"disponivel": tem_eventos, "lista": eventos, "fonte": NOME_FONTE["fd"], "atualizado_em": hora,
                    "motivo": None if tem_eventos else sem_plano.format("golos, cartões nem substituições")},
        "estatisticas": {"disponivel": False, "linhas": [], "fonte": NOME_FONTE["fd"], "atualizado_em": hora,
                         "motivo": "O football-data.org não dá estatísticas de jogo no plano gratuito."},
        "equipas": {"disponivel": bool(equipas), **equipas, "fonte": NOME_FONTE["fd"], "atualizado_em": hora,
                    "motivo": None if equipas else sem_plano.format("os onzes")},
        "jogadores": {"disponivel": False, "lista": [], "fonte": NOME_FONTE["fd"], "atualizado_em": hora,
                      "motivo": "O football-data.org não dá estatísticas individuais."},
    }


def ler_fd(data_local, casa, fora, fonte_id=None, abrir=None):
    token = segredo("FOOTBALL_DATA_TOKEN", "chave-football-data.txt")
    if not token:
        raise ErroFonte("sem_chave", "FOOTBALL_DATA_TOKEN não está configurado no servidor")
    cab = {"X-Auth-Token": token}
    plano_gratuito = os.environ.get("FOOTBALL_DATA_PLANO", "gratuito").lower() == "gratuito"
    if fonte_id and fonte_id.startswith("fd:"):
        m = pedir_json(FD_BASE + "matches/" + fonte_id[3:], cab, "fd", abrir=abrir)
        return normalizar_fd(m, plano_gratuito)
    d = datetime.strptime(data_local, "%Y-%m-%d")
    q = urllib.parse.urlencode({"dateFrom": (d - timedelta(days=1)).strftime("%Y-%m-%d"),
                                "dateTo": (d + timedelta(days=1)).strftime("%Y-%m-%d")})
    lista = pedir_json(FD_BASE + "matches?" + q, cab, "fd", abrir=abrir)
    for m in lista.get("matches") or []:
        if mesma_equipa((m.get("homeTeam") or {}).get("name"), casa) and mesma_equipa((m.get("awayTeam") or {}).get("name"), fora):
            return normalizar_fd(m, plano_gratuito)
    raise ErroFonte("sem_cobertura", "o football-data.org não tem este jogo (a competição pode não estar no plano)")


# ---------------------------------------------------------------------------
# juntar as fontes
# ---------------------------------------------------------------------------
LEITORES = [("af", ler_af), ("fd", ler_fd)]

MOTIVOS = {
    "sem_chave": "sem chave configurada",
    "conta": "conta ou chave recusada",
    "limite": "limite de pedidos atingido",
    "sem_cobertura": "o plano não cobre este jogo",
    "tempo": "não respondeu a tempo",
    "rede": "sem ligação",
    "resposta": "resposta inválida",
    "sem_jogo": "não tem este jogo",
}

BLOCOS = ("eventos", "estatisticas", "equipas", "jogadores")


def juntar(resultados, fontes, conflitos):
    """resultados: lista de (id_fonte, dados normalizados), por prioridade."""
    base = dict(resultados[0][1])
    principal = resultados[0][0]
    # blocos que a fonte principal nao tem podem vir da seguinte
    for bloco in BLOCOS:
        if base[bloco].get("disponivel"):
            continue
        for fid, dados in resultados[1:]:
            if dados[bloco].get("disponivel"):
                base[bloco] = dados[bloco]
                break
    # resultado final: se outra fonte disser outra coisa, regista-se
    for fid, dados in resultados[1:]:
        r0, r1 = base["resultado"], dados["resultado"]
        if (base["estado"]["codigo"] == "terminado" and dados["estado"]["codigo"] == "terminado"
                and (r0["casa"], r0["fora"]) != (r1["casa"], r1["fora"])):
            conflitos.append("%s dá %s-%s; %s dá %s-%s. Fica o de %s (prioridade mais alta)." % (
                NOME_FONTE[principal], r0["casa"], r0["fora"], NOME_FONTE[fid], r1["casa"], r1["fora"], NOME_FONTE[principal]))
    base["ids"] = {fid: dados["fonte_id"] for fid, dados in resultados}
    return base


def tempo_de_cache(dados, quando_jogo):
    """segundos de validade: curto em direto, longo depois do fim"""
    codigo = (dados or {}).get("estado", {}).get("codigo")
    if codigo in ("direto", "intervalo"):
        return 20
    if codigo == "terminado":
        return 6 * 3600
    if codigo in ("adiado", "cancelado", "abandonado"):
        return 1800
    falta = (quando_jogo - agora()).total_seconds() if quando_jogo else None
    if falta is not None and -3 * 3600 < falta < 2 * 3600:
        return 60            # perto da hora ou já devia ter começado
    return 900


_MEMORIA = {}     # chave -> {"expira": t, "dados": {...}, "bom": {...}, "bom_em": t}


def obter(data_iso, casa, fora, fonte_id=None, leitores=None, abrir=None):
    """Ponto de entrada. data_iso: hora de início do calendário (UTC ou com
    fuso). Devolve (dados, segundos_de_cache)."""
    try:
        quando = datetime.fromisoformat(data_iso.replace("Z", "+00:00"))
        if quando.tzinfo is None:
            quando = quando.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        raise ValueError("data inválida")
    # o dia do jogo em Lisboa (a API-Football filtra pelo dia local)
    data_local = hora_lisboa(quando).strftime("%Y-%m-%d")
    chave = "%s|%s|%s" % (quando.strftime("%Y-%m-%dT%H:%M"), chave_nome(casa), chave_nome(fora))

    guardado = _MEMORIA.get(chave)
    t = time.time()
    if guardado and guardado["expira"] > t:
        return guardado["dados"], max(5, int(guardado["expira"] - t))

    fontes, resultados, conflitos = [], [], []
    for fid, ler in (leitores or LEITORES):
        try:
            dados = ler(data_local, casa, fora, fonte_id if (fonte_id or "").startswith(fid + ":") else None, abrir=abrir)
            resultados.append((fid, dados))
            fontes.append({"id": fid, "nome": NOME_FONTE[fid], "estado": "ok"})
        except ErroFonte as e:
            fontes.append({"id": fid, "nome": NOME_FONTE[fid], "estado": e.motivo,
                           "detalhe": MOTIVOS.get(e.motivo, e.motivo)})
        except Exception as e:      # nunca deixar uma fonte partir o pedido todo
            fontes.append({"id": fid, "nome": NOME_FONTE[fid], "estado": "resposta",
                           "detalhe": "erro inesperado: %s" % type(e).__name__})

    if resultados:
        dados = juntar(resultados, fontes, conflitos)
        dados.update(disponivel=True, desatualizado=False)
    elif guardado and guardado.get("bom"):
        # a fonte falhou agora, mas há uma leitura boa anterior: devolve-se
        # essa, marcada como desatualizada (nunca como atual)
        dados = dict(guardado["bom"])
        dados.update(desatualizado=True,
                     aviso="As fontes não responderam agora. Estes dados são da última leitura boa, às %s." %
                           datetime.fromtimestamp(guardado["bom_em"], timezone.utc).strftime("%H:%M UTC"))
    else:
        dados = {"disponivel": False, "desatualizado": False,
                 "motivo": "Dados em direto indisponíveis: nenhuma fonte configurada respondeu para este jogo."}

    dados.update(versao=VERSAO, gerado_em=iso(agora()), fontes=fontes, conflitos=conflitos,
                 pedido={"data": iso(quando), "casa": casa, "fora": fora})
    segundos = tempo_de_cache(dados if dados.get("disponivel") else None, quando)
    if not dados.get("disponivel"):
        segundos = min(segundos, 120)      # sem dados: volta a tentar mais cedo
    entrada = {"expira": t + segundos, "dados": dados}
    if resultados:
        entrada.update(bom=dados, bom_em=t)
    elif guardado:
        entrada.update(bom=guardado.get("bom"), bom_em=guardado.get("bom_em"))
    _MEMORIA[chave] = entrada
    if len(_MEMORIA) > 200:          # memória limitada
        for k in sorted(_MEMORIA, key=lambda k: _MEMORIA[k]["expira"])[:50]:
            _MEMORIA.pop(k, None)
    dados["proxima_atualizacao_s"] = segundos
    return dados, segundos


def validar_pedido(data, casa, fora, fonte_id):
    if not data or not casa or not fora:
        raise ValueError("faltam parâmetros: data, casa e fora")
    padrao = re.compile(r"^[\w .'\-ºª&()]{2,60}$", re.UNICODE)
    if not padrao.match(casa) or not padrao.match(fora):
        raise ValueError("nome de equipa inválido")
    if fonte_id and not re.match(r"^(af|fd):\d{1,10}$", fonte_id):
        raise ValueError("id de fonte inválido")
