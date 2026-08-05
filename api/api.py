import urllib.request
import urllib.parse
import json
import os

FICHEIRO_CHAVE = "chave-api.txt"

def handler(request):
    caminho = request.args.get("p")

    if not caminho:
        return {
            "statusCode": 400,
            "body": "pedido invalido"
        }

    if not os.path.exists(FICHEIRO_CHAVE):
        return {
            "statusCode": 500,
            "body": "falta o ficheiro chave-api.txt"
        }

    with open(FICHEIRO_CHAVE, encoding="utf-8") as f:
        chave = f.read().strip()

    url = "https://v3.football.api-sports.io/" + caminho

    try:
        pedido = urllib.request.Request(
            url,
            headers={"x-apisports-key": chave}
        )

        with urllib.request.urlopen(pedido, timeout=20) as resposta:
            corpo = resposta.read()

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*"
            },
            "body": corpo.decode("utf-8")
        }

    except Exception as e:
        return {
            "statusCode": 502,
            "body": "erro: " + str(e)
        }