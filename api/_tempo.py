"""Previsão do tempo para a hora de um jogo, no estádio.

GET /api/tempo?estadio=<nome>&hora=<ISO 8601>

· O estádio tem de estar em dados/estadios.json (coordenadas com fonte:
  Wikipédia ou Wikidata). Sem coordenadas verificadas, não há previsão.
· A hora tem de estar entre 3 horas atrás e 15 dias à frente (o horizonte
  da previsão). Fora disso, 400 — isto não é um proxy aberto.
· A previsão vem do Open-Meteo (grátis, sem chave, para uso não comercial;
  licença CC BY 4.0: a atribuição vai na resposta e aparece no site).
  Quem pede é este servidor, por isso o IP de quem visita não sai daqui.

Usado por api/tempo.py (Vercel) e pelo servidor.py (local).
"""
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL_OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
ATRIBUICAO = {"nome": "Open-Meteo.com", "url": "https://open-meteo.com/", "licenca": "CC BY 4.0"}

# códigos de tempo da OMM (WMO), como o Open-Meteo os dá
DESCRICOES = {
    0: "Céu limpo", 1: "Pouco nublado", 2: "Parcialmente nublado", 3: "Nublado",
    45: "Nevoeiro", 48: "Nevoeiro com geada",
    51: "Chuvisco fraco", 53: "Chuvisco", 55: "Chuvisco forte", 56: "Chuvisco gelado", 57: "Chuvisco gelado forte",
    61: "Chuva fraca", 63: "Chuva", 65: "Chuva forte", 66: "Chuva gelada", 67: "Chuva gelada forte",
    71: "Neve fraca", 73: "Neve", 75: "Neve forte", 77: "Grãos de neve",
    80: "Aguaceiros fracos", 81: "Aguaceiros", 82: "Aguaceiros fortes", 85: "Aguaceiros de neve", 86: "Aguaceiros de neve fortes",
    95: "Trovoada", 96: "Trovoada com granizo", 99: "Trovoada com granizo forte",
}

_estadios = None


def estadios():
    global _estadios
    if _estadios is None:
        with open(os.path.join(RAIZ, "dados", "estadios.json"), encoding="utf-8") as f:
            _estadios = json.load(f)["estadios"]
    return _estadios


def ler_hora(texto):
    d = datetime.fromisoformat(str(texto).strip().replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError("hora sem fuso")
    return d.astimezone(timezone.utc)


def pedir_open_meteo(lat, lon, dia):
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "timezone": "UTC",
        "hourly": "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
        "start_date": dia, "end_date": dia,
    })
    pedido = urllib.request.Request(f"{URL_OPEN_METEO}?{q}", headers={"User-Agent": "SportingAoMinuto/1.0"})
    with urllib.request.urlopen(pedido, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))


def escolher_hora(dados, hora):
    """A hora da previsão mais perto da hora do jogo (as horas vêm em UTC)."""
    h = dados.get("hourly") or {}
    horas = h.get("time") or []
    if not horas:
        return None
    alvo = hora.replace(minute=0, second=0, microsecond=0) + (timedelta(hours=1) if hora.minute >= 30 else timedelta())
    i = min(range(len(horas)), key=lambda k: abs(datetime.fromisoformat(horas[k]).replace(tzinfo=timezone.utc) - alvo))
    val = lambda chave: (h.get(chave) or [None] * len(horas))[i]
    codigo = val("weather_code")
    return {
        "hora": horas[i] + "Z",
        "temperatura": val("temperature_2m"),
        "chuva_prob": val("precipitation_probability"),
        "vento_kmh": val("wind_speed_10m"),
        "codigo": codigo,
        "descricao": DESCRICOES.get(codigo, "—") if codigo is not None else None,
    }


def resposta(estadio, hora_texto, agora=None, pedir=pedir_open_meteo):
    """(código, cabeçalhos, corpo JSON)."""
    agora = agora or datetime.now(timezone.utc)
    erro = lambda codigo, msg: (codigo, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
                                json.dumps({"erro": msg}, ensure_ascii=False).encode("utf-8"))
    e = estadios().get(estadio or "")
    if not e:
        return erro(400, "estádio sem coordenadas verificadas")
    try:
        hora = ler_hora(hora_texto)
    except Exception:
        return erro(400, "hora inválida")
    if not (agora - timedelta(hours=3) <= hora <= agora + timedelta(days=15)):
        return erro(400, "hora fora do horizonte da previsão")
    try:
        p = escolher_hora(pedir(e["lat"], e["lon"], hora.strftime("%Y-%m-%d")), hora)
    except Exception:
        return erro(502, "a previsão não respondeu")
    if not p:
        return erro(502, "sem previsão para essa hora")
    corpo = {"estadio": estadio, **p, "fonte": ATRIBUICAO, "coordenadas": e["fonte"]}
    return 200, {"Content-Type": "application/json; charset=utf-8",
                 "Cache-Control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=3600"}, \
        json.dumps(corpo, ensure_ascii=False).encode("utf-8")
