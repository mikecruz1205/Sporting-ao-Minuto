"""GET /api/noticias — as notícias do Sporting de 12 jornais, num só JSON
pequeno, comprimido e com ETag (ver api/_noticias.py)."""
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _noticias  # noqa: E402


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        try:
            codigo, cab, corpo = _noticias.resposta(self.headers)
        except Exception as e:                                    # nunca um 500 sem explicação
            codigo, cab, corpo = 502, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}, \
                ("erro ao ler os jornais: " + str(e)).encode("utf-8")
        self.send_response(codigo)
        for k, v in cab.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        if corpo:
            self.wfile.write(corpo)
