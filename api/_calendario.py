"""Calendário dos jogos do Sporting em iCalendar (.ics), para subscrever no
Google Calendar, no calendário do iPhone ou no Outlook.

Os jogos vêm da tabela desporto_jogos do Supabase (leitura pública, a mesma
que a Fantasy usa). A chave usada é a publicável, que já está no browser —
nenhuma chave privada passa por aqui.

Usado por api/calendario.py (Vercel) e pelo servidor.py (local).
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone

URL_PROJETO = os.environ.get("SUPABASE_URL", "https://wuayudgmkbiipwucblvi.supabase.co")
CHAVE_PUBLICA = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_LChLhrz6yKfPHzm89xingA_SkIuaIKB")
SITE = "https://sporting-fan-ao-minuto.vercel.app"
DURACAO = timedelta(hours=2)


def escapar(texto):
    """RFC 5545: \\ , ; e quebras de linha escapam-se."""
    return (str(texto or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def dobrar(linha):
    """Linhas com mais de 75 bytes continuam na seguinte, começada por um espaço."""
    dados = linha.encode("utf-8")
    if len(dados) <= 75:
        return linha
    partes, atual = [], b""
    for ch in linha:
        b = ch.encode("utf-8")
        if len(atual) + len(b) > (75 if not partes else 74):
            partes.append(atual.decode("utf-8"))
            atual = b""
        atual += b
    partes.append(atual.decode("utf-8"))
    return "\r\n ".join(partes)


def utc(d):
    return d.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def ler_data(texto):
    return datetime.fromisoformat(str(texto).replace("Z", "+00:00"))


def gerar_ics(jogos, agora=None):
    agora = agora or datetime.now(timezone.utc)
    linhas = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sporting ao Minuto//Jogos do Sporting CP//PT",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Jogos do Sporting CP",
        "X-WR-CALDESC:" + escapar("Calendário dos jogos do Sporting CP (Sporting ao Minuto, projeto de adeptos não oficial)."),
        "X-WR-TIMEZONE:Europe/Lisbon", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    ]
    for j in sorted(jogos, key=lambda x: x["data"]):
        inicio = ler_data(j["data"])
        prova = " · ".join(x for x in (j.get("competicao"), j.get("fase")) if x)
        titulo = f"{j['casa']} – {j['fora']}"
        if j.get("golos_casa") is not None and j.get("golos_fora") is not None:
            titulo = f"{j['casa']} {j['golos_casa']}–{j['golos_fora']} {j['fora']}"
        descricao = [prova] if prova else []
        descricao.append(f"Centro de jogo e notícias: {SITE}/ao-vivo")
        linhas += [
            "BEGIN:VEVENT",
            f"UID:jogo-{j['id']}@sporting-ao-minuto",
            f"DTSTAMP:{utc(agora)}",
            f"DTSTART:{utc(inicio)}",
            f"DTEND:{utc(inicio + DURACAO)}",
            "SUMMARY:" + escapar(titulo + (f" ({j['competicao']})" if j.get("competicao") else "")),
            "DESCRIPTION:" + escapar("\n".join(descricao)),
            f"URL:{SITE}/ao-vivo",
            "STATUS:CONFIRMED", "TRANSP:OPAQUE",
        ]
        if j.get("local"):
            linhas.append("LOCATION:" + escapar(j["local"]))
        linhas.append("END:VEVENT")
    linhas.append("END:VCALENDAR")
    return ("\r\n".join(dobrar(l) for l in linhas) + "\r\n").encode("utf-8")


def ler_jogos():
    url = f"{URL_PROJETO}/rest/v1/desporto_jogos?select=id,data,competicao,fase,casa,fora,golos_casa,golos_fora,local&order=data"
    pedido = urllib.request.Request(url, headers={"apikey": CHAVE_PUBLICA, "Accept": "application/json"})
    with urllib.request.urlopen(pedido, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def resposta(ler=ler_jogos):
    """(código, cabeçalhos, corpo)."""
    try:
        corpo = gerar_ics(ler())
    except Exception as e:
        return 502, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}, \
            ("não foi possível ler os jogos: " + str(e)).encode("utf-8")
    return 200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="jogos-sporting.ics"',
        "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    }, corpo
