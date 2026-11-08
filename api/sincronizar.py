"""GET /api/sincronizar — tarefa diária da Vercel (vercel.json, "crons"):
resultados e calendário da football-data para o Supabase (ver api/_sincronizar.py).
A Vercel manda o CRON_SECRET no cabeçalho Authorization; sem ele, 403."""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _sincronizar  # noqa: E402


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        codigo, corpo = _sincronizar.resposta(self.headers.get("Authorization", ""))
        dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)
