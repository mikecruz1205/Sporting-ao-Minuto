"""GET /api/calendario (e /calendario.ics) — os jogos do Sporting em
iCalendar, para subscrever no telemóvel (ver api/_calendario.py)."""
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _calendario  # noqa: E402


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        codigo, cab, corpo = _calendario.resposta()
        self.send_response(codigo)
        for k, v in cab.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)
