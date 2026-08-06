#!/usr/bin/env python3
"""
SPORTING CP — servidor local

Faz quatro coisas:
  1. serve os ficheiros do site
  2. /rss?url=...   vai buscar os feeds dos jornais
  3. /ler?url=...   vai buscar um artigo e devolve-o limpo, para ser lido
                    dentro do site (sem sair para o browser)
  4. /api?p=...     fala com a API-Football, guarda a resposta em cache e
                    nunca deixa a chave chegar ao browser

    python servidor.py            -> http://localhost:8123
    python servidor.py 9000       -> noutra porta
"""

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORTA = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
RAIZ = os.path.dirname(os.path.abspath(__file__))
PASTA_CACHE = os.path.join(RAIZ, "cache")
FICHEIRO_CHAVE = os.path.join(RAIZ, "chave-api.txt")

# de onde se deixa ir buscar feeds e artigos
DOMINIOS_PERMITIDOS = (
    "leonino.pt", "www.leonino.pt",
    "www.record.pt", "record.pt",
    "maisfutebol.iol.pt", "www.maisfutebol.iol.pt",
    "www.noticiasaominuto.com", "noticiasaominuto.com",
    "www.zerozero.pt", "zerozero.pt",
    "observador.pt", "www.observador.pt",
    "www.rtp.pt", "rtp.pt",
    "bolanarede.pt", "www.bolanarede.pt",
    "futebol365.pt", "www.futebol365.pt",
    "www.cmjornal.pt", "cmjornal.pt",
    "feeds.feedburner.com", "www.publico.pt", "publico.pt",
    "www.playmakerstats.com", "playmakerstats.com",
    "www.abola.pt", "abola.pt", "www.ojogo.pt", "ojogo.pt",
    "sapo.pt", "desporto.sapo.pt", "24.sapo.pt", "eco.sapo.pt",
    "sicnoticias.pt", "cnnportugal.iol.pt", "tvi.iol.pt",
    "news.google.com", "www.sporting.pt",
    "en.wikipedia.org", "pt.wikipedia.org",
)

CABECALHO_NAVEGADOR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/rss+xml,application/xml,*/*",
    "Accept-Language": "pt-PT,pt;q=0.9",
}

# quanto tempo vale cada resposta da API antes de se ir buscar outra vez
TTL_API = 30 * 24 * 3600     # estatisticas de epocas passadas nao mudam


class Manipulador(SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    # ------------------------------------------------------------------
    def do_GET(self):
        # /api/rss tem de vir ANTES de /api: no Vercel os feeds sao servidos
        # por api/rss.py, e o data.js usa esse caminho tambem aqui
        if self.path.startswith("/rss") or self.path.startswith("/api/rss"):
            self.servir_rss()
        elif self.path.startswith("/ler") or self.path.startswith("/api/ler"):
            self.servir_artigo()
        elif self.path.startswith("/api"):
            self.servir_api()
        elif self.path.startswith("/fundo"):
            self.servir_imagem("entrada")
        elif self.path.startswith("/emblema"):
            self.servir_imagem("crest")
        else:
            super().do_GET()

    # ------------------------------------------------------------------
    def servir_imagem(self, base):
        """Serve img/<base>.* seja qual for a extensao — .jpg, .jpeg, .png,
        .webp, .svg… Assim nao ha enganos ao gravar o ficheiro.
        Usado pela foto do ecra de entrada e pelo emblema do clube."""
        pasta = os.path.join(RAIZ, "img")
        tipos = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".png": "image/png", ".webp": "image/webp",
                 ".gif": "image/gif", ".avif": "image/avif",
                 ".svg": "image/svg+xml"}
        # a ordem manda: um ficheiro teu (.png/.jpg) ganha ao .svg de reserva
        ordem = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"]
        try:
            ficheiros = os.listdir(pasta)
        except FileNotFoundError:
            return self.erro(404, "sem pasta img")

        for ext in ordem:
            for nome in ficheiros:
                raiz, e = os.path.splitext(nome)
                if raiz.lower() == base and e.lower() == ext:
                    with open(os.path.join(pasta, nome), "rb") as f:
                        return self.responder(f.read(), tipos[ext])
        self.erro(404, "sem imagem %s" % base)

    def end_headers(self):
        if not self.path.startswith("/img/"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    # ------------------------------------------------------------------
    def parametro(self, nome):
        consulta = urllib.parse.urlparse(self.path).query
        return urllib.parse.parse_qs(consulta).get(nome, [""])[0]

    def alvo_permitido(self, alvo):
        anfitriao = (urllib.parse.urlparse(alvo).hostname or "").lower()
        if anfitriao in DOMINIOS_PERMITIDOS:
            return True
        return any(anfitriao.endswith("." + d) for d in DOMINIOS_PERMITIDOS)

    def ir_buscar(self, alvo, tempo=20):
        pedido = urllib.request.Request(alvo, headers=CABECALHO_NAVEGADOR)
        with urllib.request.urlopen(pedido, timeout=tempo) as r:
            return r.read(), r.headers.get("Content-Type", "")

    # ------------------------------------------------------------------
    def servir_rss(self):
        alvo = self.parametro("url")
        if not alvo:
            return self.erro(400, "falta o parametro url")
        if not self.alvo_permitido(alvo):
            return self.erro(403, "dominio nao permitido")
        try:
            corpo, _ = self.ir_buscar(alvo, 15)
        except urllib.error.HTTPError as e:
            return self.erro(502, "a fonte respondeu %s" % e.code)
        except Exception as e:
            return self.erro(502, "nao consegui ler a fonte: %s" % e)

        self.responder(self.para_utf8(corpo), "application/xml; charset=utf-8")

    # ------------------------------------------------------------------
    def servir_artigo(self):
        """Devolve o artigo pronto a ser mostrado dentro do site.
        Tira os scripts (muitos jornais tem codigo que foge da moldura)
        e poe um <base> para as imagens e o estilo continuarem a funcionar."""
        alvo = self.parametro("url")
        if not alvo:
            return self.erro(400, "falta o parametro url")
        if not self.alvo_permitido(alvo):
            return self.erro(403, "dominio nao permitido")

        try:
            corpo, tipo = self.ir_buscar(alvo, 20)
        except Exception as e:
            return self.responder(
                ("<html><body style='font-family:sans-serif;padding:40px;"
                 "background:#141817;color:#e6ece9'>"
                 "<h2>Nao consegui abrir este artigo aqui dentro.</h2>"
                 "<p>%s</p><p><a style='color:#2fd98a' target='_blank' href='%s'>"
                 "Abrir no site do jornal</a></p></body></html>" % (e, alvo)
                 ).encode("utf-8"), "text/html; charset=utf-8")

        codificacao = "utf-8"
        m = re.search(r"charset=([\w-]+)", tipo or "", re.I)
        if m:
            codificacao = m.group(1)
        html = corpo.decode(codificacao, errors="replace")

        html = re.sub(r"<script\b.*?</script>", "", html, flags=re.S | re.I)
        html = re.sub(r"<noscript\b.*?</noscript>", "", html, flags=re.S | re.I)
        html = re.sub(r"<iframe\b.*?</iframe>", "", html, flags=re.S | re.I)
        html = re.sub(r"\son\w+\s*=\s*(\"[^\"]*\"|'[^']*')", "", html, flags=re.I)

        base = "<base href=\"%s\" target=\"_blank\">" % alvo
        extra = ("<style>body{max-width:900px;margin:0 auto;padding:12px}"
                 "img{max-width:100%!important;height:auto!important}</style>")
        if re.search(r"<head[^>]*>", html, re.I):
            html = re.sub(r"(<head[^>]*>)", r"\1" + base + extra, html, count=1, flags=re.I)
        else:
            html = base + extra + html

        self.responder(html.encode("utf-8"), "text/html; charset=utf-8")

    # ------------------------------------------------------------------
    def servir_api(self):
        """Proxy para a API-Football, com cache em disco.
        O plano gratuito da conta so da 100 pedidos por dia, por isso tudo
        o que ja foi pedido uma vez fica guardado em cache/."""
        caminho = self.parametro("p")
        if not caminho or not re.match(r"^[a-z/]+\?[\w=&.-]+$", caminho):
            return self.erro(400, "pedido invalido")

        os.makedirs(PASTA_CACHE, exist_ok=True)
        nome = hashlib.sha1(caminho.encode()).hexdigest() + ".json"
        ficheiro = os.path.join(PASTA_CACHE, nome)

        if os.path.exists(ficheiro) and time.time() - os.path.getmtime(ficheiro) < TTL_API:
            with open(ficheiro, "rb") as f:
                return self.responder(f.read(), "application/json; charset=utf-8")

        if not os.path.exists(FICHEIRO_CHAVE):
            return self.erro(500, "falta o ficheiro chave-api.txt")
        with open(FICHEIRO_CHAVE, encoding="utf-8") as f:
            chave = f.read().strip()

        url = "https://v3.football.api-sports.io/" + caminho
        try:
            pedido = urllib.request.Request(url, headers={"x-apisports-key": chave})
            with urllib.request.urlopen(pedido, timeout=20) as r:
                corpo = r.read()
        except Exception as e:
            return self.erro(502, "a API respondeu mal: %s" % e)

        try:
            dados = json.loads(corpo)
            if dados.get("results", 0) > 0 or not dados.get("errors"):
                with open(ficheiro, "wb") as f:
                    f.write(corpo)
        except Exception:
            pass

        self.responder(corpo, "application/json; charset=utf-8")

    # ------------------------------------------------------------------
    @staticmethod
    def para_utf8(corpo):
        cabeca = corpo[:200].lower()
        if b"utf-8" in cabeca:
            return corpo
        for cod in (b"iso-8859-1", b"latin-1", b"windows-1252"):
            if cod in cabeca:
                try:
                    texto = corpo.decode(cod.decode(), errors="replace")
                except Exception:
                    return corpo
                texto = texto.replace(cod.decode(), "utf-8", 1)
                texto = texto.replace(cod.decode().upper(), "utf-8", 1)
                return texto.encode("utf-8")
        return corpo

    def responder(self, corpo, tipo):
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(corpo)

    def erro(self, codigo, mensagem):
        corpo = mensagem.encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(corpo)

    def log_message(self, formato, *args):
        if args and str(args[1]).startswith(("4", "5")):
            sys.stderr.write("%s %s\n" % (self.address_string(), formato % args))


if __name__ == "__main__":
    servidor = ThreadingHTTPServer(("127.0.0.1", PORTA), Manipulador)
    print("SPORTING CP  ->  http://localhost:%d" % PORTA)
    print("Ctrl+C para parar.")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nservidor parado.")
