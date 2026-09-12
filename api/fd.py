"""Proxy para o football-data.org (Vercel).

O token nunca chega ao browser: a API deles nao manda cabecalhos de CORS,
e uma chave num ficheiro servido ao publico deixava de ser uma chave.

Uso: /api/fd?p=competitions/PPL/standings

O token le-se da variavel de ambiente FOOTBALL_DATA_TOKEN (Settings >
Environment Variables no Vercel) ou, em alternativa, do ficheiro
chave-football-data.txt.
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

FICHEIRO_CHAVE = "chave-football-data.txt"
PERMITIDO = re.compile(r"^(competitions|teams|matches|persons)/[\w/?&=.,-]*$")


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

        if not caminho:
            return self.responder(400, "falta o parametro p")
        if not PERMITIDO.match(caminho):
            return self.responder(400, "caminho nao permitido")

        chave = token()
        if not chave:
            return self.responder(
                503,
                "sem token: define FOOTBALL_DATA_TOKEN nas variaveis de "
                "ambiente do Vercel, ou cria chave-football-data.txt")

        url = "https://api.football-data.org/v4/" + caminho
        try:
            pedido = urllib.request.Request(url, headers={"X-Auth-Token": chave})
            with urllib.request.urlopen(pedido, timeout=25) as r:
                corpo = r.read().decode("utf-8")
            return self.responder(200, corpo, "application/json; charset=utf-8")
        except urllib.error.HTTPError as e:
            detalhe = e.read()[:300].decode("utf-8", "replace")
            return self.responder(e.code, "football-data respondeu %s: %s" % (e.code, detalhe))
        except Exception as e:
            return self.responder(502, "football-data nao respondeu: %s" % e)

    def responder(self, codigo, corpo, tipo="text/plain; charset=utf-8"):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(corpo.encode("utf-8"))
