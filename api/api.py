"""Proxy para a API-Football (Vercel): /api/api?p=players?id=123&season=2024

So deixa passar o que o site usa (a carreira de um jogador por epoca).
Antes aceitava qualquer caminho: quem descobrisse o endereco podia gastar
a quota diaria da conta. A chave le-se da variavel de ambiente do Vercel
(API_FOOTBALL_KEY) e nunca chega ao browser; o ficheiro chave-api.txt so
existe em casa e nunca e publicado (.gitignore e .vercelignore).
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

FICHEIRO_CHAVE = "chave-api.txt"
PERMITIDO = re.compile(r"^players\?id=\d{1,9}&season=(19|20)\d{2}$")


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)
        caminho = (params.get("p") or [""])[0]

        if not PERMITIDO.match(caminho or ""):
            return self.responder(400, {"erro": "pedido nao permitido"})

        chave = os.environ.get("API_FOOTBALL_KEY", "").strip()
        if not chave and os.path.exists(FICHEIRO_CHAVE):
            with open(FICHEIRO_CHAVE, encoding="utf-8") as f:
                chave = f.read().strip()
        if not chave:
            return self.responder(503, {"erro": "sem chave: define API_FOOTBALL_KEY nas variaveis de ambiente do Vercel"})

        try:
            pedido = urllib.request.Request("https://v3.football.api-sports.io/" + caminho,
                                            headers={"x-apisports-key": chave})
            with urllib.request.urlopen(pedido, timeout=15) as resposta:
                corpo = resposta.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            return self.responder(502, {"erro": "a API-Football respondeu %s" % e.code})
        except Exception:
            return self.responder(502, {"erro": "a API-Football nao respondeu"})

        # as estatisticas de epocas passadas nao mudam: a CDN guarda um dia
        self.responder(200, corpo, cache="public, s-maxage=86400, stale-while-revalidate=604800")

    def responder(self, codigo, corpo, cache="no-store"):
        texto = corpo if isinstance(corpo, str) else json.dumps(corpo, ensure_ascii=False)
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(texto.encode("utf-8"))
