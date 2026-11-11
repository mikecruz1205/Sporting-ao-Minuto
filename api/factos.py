"""GET /api/factos — factos dos jogos tirados das notícias, já validados
(ver api/_factos.py)."""
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _factos  # noqa: E402


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        codigo, cab, corpo = _factos.resposta()
        self.send_response(codigo)
        for k, v in cab.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)
