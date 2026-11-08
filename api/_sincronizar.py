"""Sincronização diária dos resultados: football-data.org → Supabase.

Corre na Vercel (api/sincronizar.py), chamada pela tarefa agendada do
vercel.json, porque é lá que está o token da football-data
(FOOTBALL_DATA_TOKEN). Um só pedido à football-data:

    GET /v4/teams/498/matches?season=<ano>   (Sporting CP, Liga e Champions)

Os jogos normalizam-se para o modelo do site (prova, fase, casa/fora,
resultado só de jogos terminados) e entregam-se à função
desporto_sincronizar_fd do Supabase, que os encontra pela prova, pela
jornada e por o Sporting jogar em casa ou fora, e atualiza resultados,
horas e as jornadas da Fantasy. A função só aceita quem tiver o segredo
partilhado (SINCRONIZAR_SEGREDO aqui, 'sincronizar_segredo' no cofre).

O plano gratuito da football-data não tem as taças nem as estatísticas por
jogador: essas continuam a entrar pela importação manual.
"""
import json
import os
import urllib.request
from datetime import datetime, timezone

from _calendario import CHAVE_PUBLICA, URL_PROJETO

SPORTING_FD = 498
EPOCA = "2026/27"
ANO_FD = 2026                     # a football-data nomeia a época pelo ano em que começa

PROVAS = {"PPL": "Liga Portugal", "CL": "Liga dos Campeões"}
FASES_CL = {"PLAYOFFS": "Play-off", "LAST_16": "Oitavos de final", "QUARTER_FINALS": "Quartos de final",
            "SEMI_FINALS": "Meias-finais", "FINAL": "Final"}

# os nomes que o site já usa (os da football-data são os oficiais, mais compridos)
NOMES = {
    "Sporting Clube de Portugal": "Sporting CP", "Sporting CP": "Sporting CP",
    "FC Porto": "FC Porto", "Sport Lisboa e Benfica": "Benfica", "SL Benfica": "Benfica",
    "Sporting Clube de Braga": "SC Braga", "SC Braga": "SC Braga", "Vitória SC": "V. Guimarães",
    "Vitória Sport Clube": "V. Guimarães", "Académico de Viseu FC": "Ac. Viseu", "Académico Viseu": "Ac. Viseu",
    "CD Santa Clara": "Santa Clara", "Moreirense FC": "Moreirense", "Rio Ave FC": "Rio Ave",
    "FC Famalicão": "Famalicão", "FC Arouca": "Arouca", "Casa Pia AC": "Casa Pia", "GD Estoril Praia": "Estoril",
    "Gil Vicente FC": "Gil Vicente", "CD Nacional": "Nacional", "CS Marítimo": "Marítimo",
    "CF Estrela da Amadora": "Estrela da Amadora", "FC Alverca": "Alverca",
}


def nome(equipa):
    if (equipa or {}).get("id") == SPORTING_FD:
        return "Sporting CP"
    n = (equipa or {}).get("name") or (equipa or {}).get("shortName") or "?"
    return NOMES.get(n, NOMES.get((equipa or {}).get("shortName") or "", n))


def fase(m):
    codigo = (m.get("competition") or {}).get("code")
    if codigo == "PPL":
        return "Jornada %d" % m["matchday"] if m.get("matchday") else None
    if codigo == "CL":
        if m.get("stage") in (None, "LEAGUE_STAGE") and m.get("matchday"):
            return "Fase de liga · jornada %d" % m["matchday"]
        return FASES_CL.get(m.get("stage"))
    return None


def normalizar(resposta):
    """Resposta de /teams/498/matches → jogos para desporto_sincronizar_fd.
    Fica de fora o que não se sabe pôr no sítio certo (prova ou fase
    desconhecida); um resultado só segue com o jogo terminado."""
    jogos, ignorados = [], []
    for m in resposta.get("matches") or []:
        codigo = (m.get("competition") or {}).get("code")
        f = fase(m)
        casa, fora = m.get("homeTeam") or {}, m.get("awayTeam") or {}
        sporting_casa = casa.get("id") == SPORTING_FD
        if codigo not in PROVAS or not f or not (sporting_casa or fora.get("id") == SPORTING_FD) or not m.get("utcDate"):
            ignorados.append(m.get("id"))
            continue
        final = (m.get("score") or {}).get("fullTime") or {}
        terminado = m.get("status") == "FINISHED" and final.get("home") is not None and final.get("away") is not None
        jogos.append({
            "fd_id": m.get("id"),
            "competicao": PROVAS[codigo], "fase": f,
            "data": m["utcDate"],
            "casa": nome(casa), "fora": nome(fora), "sporting_casa": sporting_casa,
            "golos_casa": final.get("home") if terminado else None,
            "golos_fora": final.get("away") if terminado else None,
        })
    return jogos, ignorados


def ler_football_data(token):
    pedido = urllib.request.Request(
        "https://api.football-data.org/v4/teams/%d/matches?season=%d" % (SPORTING_FD, ANO_FD),
        headers={"X-Auth-Token": token})
    with urllib.request.urlopen(pedido, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def enviar(segredo, jogos):
    corpo = json.dumps({"p_segredo": segredo, "p": {"epoca": EPOCA, "jogos": jogos}}).encode("utf-8")
    pedido = urllib.request.Request(URL_PROJETO + "/rest/v1/rpc/desporto_sincronizar_fd", data=corpo, method="POST",
                                    headers={"apikey": CHAVE_PUBLICA, "Content-Type": "application/json"})
    with urllib.request.urlopen(pedido, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def resposta(autorizacao, ambiente=None, ler=ler_football_data, gravar=enviar):
    """(código, corpo). Só corre com o CRON_SECRET da Vercel no cabeçalho."""
    amb = os.environ if ambiente is None else ambiente
    cron, token, segredo = amb.get("CRON_SECRET", ""), amb.get("FOOTBALL_DATA_TOKEN", ""), amb.get("SINCRONIZAR_SEGREDO", "")
    if not cron or autorizacao != "Bearer " + cron:
        return 403, {"erro": "proibido"}
    if not token or not segredo:
        return 503, {"erro": "faltam FOOTBALL_DATA_TOKEN ou SINCRONIZAR_SEGREDO na Vercel"}
    try:
        jogos, ignorados = normalizar(ler(token))
    except Exception as e:
        return 502, {"erro": "a football-data não respondeu", "detalhe": type(e).__name__}
    if not jogos:
        return 502, {"erro": "a football-data não devolveu jogos"}
    try:
        r = gravar(segredo, jogos)
    except Exception as e:
        return 502, {"erro": "o Supabase não aceitou", "detalhe": type(e).__name__}
    return 200, {"ok": True, "lidos": len(jogos), "ignorados": len(ignorados), "supabase": r,
                 "quando": datetime.now(timezone.utc).isoformat(timespec="seconds")}
