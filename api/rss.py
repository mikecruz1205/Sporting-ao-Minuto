import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

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
    "feeds.feedburner.com",
)


def permitido(url):
    dominio = urllib.parse.urlparse(url).netloc
    return dominio in DOMINIOS_PERMITIDOS


def para_texto(corpo):
    """Alguns feeds portugueses vem em ISO-8859-1. Se se descodificasse
    tudo como utf-8, os acentos saiam trocados — le-se a codificacao que
    o proprio XML declara e corrige-se a declaracao para utf-8."""
    cabeca = corpo[:200].lower()
    for cod in (b"iso-8859-1", b"latin-1", b"windows-1252"):
        if cod in cabeca:
            nome = cod.decode()
            texto = corpo.decode(nome, errors="replace")
            return texto.replace(nome, "utf-8", 1).replace(nome.upper(), "utf-8", 1)
    return corpo.decode("utf-8", errors="replace")


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)
        url = params.get("url", [None])[0]

        if not url:
            self.responder(400, "falta o parametro url")
            return

        if not permitido(url):
            self.responder(403, "dominio nao permitido")
            return

        try:
            pedido = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0"}
            )

            with urllib.request.urlopen(pedido, timeout=15) as resposta:
                corpo = resposta.read()

            self.responder(
                200,
                para_texto(corpo),
                "application/xml; charset=utf-8"
            )

        except Exception as e:
            self.responder(502, "erro: " + str(e))


    def responder(self, codigo, corpo, tipo="text/plain; charset=utf-8"):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(corpo.encode("utf-8"))
