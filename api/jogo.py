"""Centro de jogo: /api/jogo?data=2026-10-09T19:15:00Z&casa=SC%20Braga&fora=Sporting%20CP

Devolve o jogo normalizado (estado, resultado, eventos, estatisticas,
onzes e jogadores), com a fonte e a hora de cada bloco. Toda a logica
esta em api/_jogo.py (partilhada com o servidor.py local). As chaves das
fontes leem-se das variaveis de ambiente do Vercel e nunca saem daqui.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _jogo  # noqa: E402


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        um = lambda k: (q.get(k) or [""])[0].strip()
        data, casa, fora, fonte_id = um("data"), um("casa"), um("fora"), um("id") or None
        try:
            _jogo.validar_pedido(data, casa, fora, fonte_id)
            dados, segundos = _jogo.obter(data, casa, fora, fonte_id)
        except ValueError as e:
            return self.responder(400, {"erro": str(e)}, 0)
        except Exception as e:  # nunca um 500 sem explicação
            return self.responder(502, {"disponivel": False, "erro": "falha interna: %s" % type(e).__name__}, 0)
        self.responder(200, dados, segundos)

    def responder(self, codigo, corpo, segundos):
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        # a CDN do Vercel guarda a resposta: com muita gente a ver o mesmo
        # jogo, a fonte recebe um pedido por intervalo e não um por pessoa
        self.send_header("Cache-Control", "public, s-maxage=%d, stale-while-revalidate=%d" % (segundos, segundos * 2)
                         if segundos else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(json.dumps(corpo, ensure_ascii=False).encode("utf-8"))
