import urllib.request
import json
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

FICHEIRO_CHAVE = "chave-api.txt"


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)
        caminho = params.get("p", [None])[0]

        if not caminho:
            self.responder(400, "pedido invalido")
            return

        if not os.path.exists(FICHEIRO_CHAVE):
            self.responder(500, "falta o ficheiro chave-api.txt")
            return

        with open(FICHEIRO_CHAVE, encoding="utf-8") as f:
            chave = f.read().strip()

        url = "https://v3.football.api-sports.io/" + caminho

        try:
            pedido = urllib.request.Request(
                url,
                headers={"x-apisports-key": chave}
            )

            with urllib.request.urlopen(pedido, timeout=20) as resposta:
                corpo = resposta.read().decode("utf-8")

            self.responder(
                200,
                corpo,
                "application/json; charset=utf-8"
            )

        except Exception as e:
            self.responder(502, "erro: " + str(e))


    def responder(self, codigo, corpo, tipo="text/plain; charset=utf-8"):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(corpo.encode("utf-8"))
