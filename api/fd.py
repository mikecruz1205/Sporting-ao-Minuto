"""Proxy para o football-data.org (Vercel): /api/fd?p=competitions/PPL/standings

So deixa passar a classificacao da Liga e da Champions (o que o site usa;
o jogo em si vai por /api/jogo). Antes aceitava qualquer caminho, o que
deixava gastar os 10 pedidos por minuto do plano gratuito a quem
descobrisse o endereco. A CDN guarda a resposta 5 minutos.

O token le-se da variavel de ambiente FOOTBALL_DATA_TOKEN (Vercel) ou,
em casa, do ficheiro chave-football-data.txt (nunca publicado).
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

FICHEIRO_CHAVE = "chave-football-data.txt"
PERMITIDO = re.compile(r"^competitions/(PPL|CL)/standings$")


def token():
    do_ambiente = os.environ.get("FOOTBALL_DATA_TOKEN", "").strip()
    if do_ambiente:
        return do_ambiente
    if os.path.exists(FICHEIRO_CHAVE):
        with open(FICHEIRO_CHAVE, encoding="utf-8") as f:
            return f.read().strip()
    return ""


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)
        caminho = (params.get("p") or [""])[0].lstrip("/")

        if not PERMITIDO.match(caminho):
            return self.responder(400, {"erro": "caminho nao permitido"})

        chave = token()
        if not chave:
            return self.responder(503, {"erro": "sem token: define FOOTBALL_DATA_TOKEN nas variaveis de ambiente do Vercel"})

        try:
            pedido = urllib.request.Request("https://api.football-data.org/v4/" + caminho,
                                            headers={"X-Auth-Token": chave})
            with urllib.request.urlopen(pedido, timeout=15) as r:
                corpo = r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            return self.responder(502 if e.code >= 500 else e.code, {"erro": "football-data respondeu %s" % e.code})
        except Exception:
            return self.responder(502, {"erro": "football-data nao respondeu"})
        self.responder(200, corpo, cache="public, s-maxage=300, stale-while-revalidate=600")

    def responder(self, codigo, corpo, cache="no-store"):
        texto = corpo if isinstance(corpo, str) else json.dumps(corpo, ensure_ascii=False)
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(texto.encode("utf-8"))
