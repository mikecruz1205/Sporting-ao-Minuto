import urllib.request
import urllib.parse

DOMINIOS_PERMITIDOS = (
    "www.record.pt", "record.pt",
    "maisfutebol.iol.pt", "www.maisfutebol.iol.pt",
    "www.noticiasaominuto.com", "noticiasaominuto.com",
    "www.zerozero.pt", "zerozero.pt",
    "observador.pt", "www.observador.pt",
    "www.rtp.pt", "rtp.pt",
)

def permitido(url):
    dominio = urllib.parse.urlparse(url).netloc
    return dominio in DOMINIOS_PERMITIDOS

def handler(request):
    url = request.args.get("url")

    if not url:
        return {
            "statusCode": 400,
            "body": "falta o parametro url"
        }

    if not permitido(url):
        return {
            "statusCode": 403,
            "body": "dominio nao permitido"
        }

    try:
        pedido = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0"}
        )

        with urllib.request.urlopen(pedido, timeout=15) as resposta:
            corpo = resposta.read()

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/xml; charset=utf-8",
                "Access-Control-Allow-Origin": "*"
            },
            "body": corpo.decode("utf-8", errors="ignore")
        }

    except Exception as e:
        return {
            "statusCode": 502,
            "body": "erro: " + str(e)
        }