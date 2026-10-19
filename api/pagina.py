"""GET /jogo/<…> e /jogador/<…> (reescritos para /api/pagina?tipo=…&s=…):
o site com a pré-visualização do jogo ou do jogador (ver api/_pagina.py)."""
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _pagina  # noqa: E402


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        tipo = (q.get("tipo") or [""])[0]
        resto = (q.get("s") or [""])[0][:120]
        if tipo not in ("jogo", "jogador"):
            self.send_response(404)
            self.end_headers()
            return
        codigo, cab, corpo = _pagina.resposta(tipo, resto)
        self.send_response(codigo)
        for k, v in cab.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)
