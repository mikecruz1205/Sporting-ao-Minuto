"""GET /api/tempo?estadio=…&hora=… — a previsão do tempo para a hora de um
jogo, no estádio (ver api/_tempo.py)."""
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _tempo  # noqa: E402


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        codigo, cab, corpo = _tempo.resposta((q.get("estadio") or [""])[0][:120], (q.get("hora") or [""])[0][:40])
        self.send_response(codigo)
        for k, v in cab.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)
