#!/usr/bin/env python3
"""
Vai buscar a API-Football:
  · o plantel atual do Sporting (nome, numero, posicao, idade, foto)
  · os emblemas das equipas da Liga

Guarda as imagens em img/ e os dados em dados/plantel.json.

Corre isto quando houver mexidas no plantel (nao e preciso mais do que
uma vez por semana). Gasta 3 pedidos do limite diario de 100.

    python atualizar_fotos.py
"""

import json
import os
import sys
import time
import urllib.request

RAIZ = os.path.dirname(os.path.abspath(__file__))
FICHEIRO_CHAVE = os.path.join(RAIZ, "chave-api.txt")
API = "https://v3.football.api-sports.io/"
EQUIPA_SCP = 228
LIGA = 94

PASTA_JOGADORES = os.path.join(RAIZ, "img", "players")
PASTA_EQUIPAS = os.path.join(RAIZ, "img", "teams")
PASTA_DADOS = os.path.join(RAIZ, "dados")


def chave():
    if not os.path.exists(FICHEIRO_CHAVE):
        sys.exit("Falta o ficheiro chave-api.txt com a chave da API-Football.")
    with open(FICHEIRO_CHAVE, encoding="utf-8") as f:
        return f.read().strip()


def pedir(caminho, k):
    req = urllib.request.Request(API + caminho, headers={"x-apisports-key": k})
    with urllib.request.urlopen(req, timeout=20) as r:
        dados = json.loads(r.read().decode("utf-8"))
    if dados.get("errors"):
        print("  aviso da API:", dados["errors"])
    return dados


def descarregar(url, destino):
    if os.path.exists(destino) and os.path.getsize(destino) > 500:
        return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            conteudo = r.read()
        if len(conteudo) < 200:
            return False
        with open(destino, "wb") as f:
            f.write(conteudo)
        return True
    except Exception as e:
        print("  falhou", url, e)
        return False


def limpar(nome):
    return "".join(c for c in nome.lower().replace(" ", "-") if c.isalnum() or c == "-")


def main():
    k = chave()
    for pasta in (PASTA_JOGADORES, PASTA_EQUIPAS, PASTA_DADOS):
        os.makedirs(pasta, exist_ok=True)

    # ---------- plantel ----------
    print("A ler o plantel do Sporting...")
    dados = pedir("players/squads?team=%d" % EQUIPA_SCP, k)
    if not dados.get("response"):
        sys.exit("A API nao devolveu plantel.")

    jogadores = dados["response"][0]["players"]
    print("  %d jogadores" % len(jogadores))

    saida = []
    novas = 0
    for j in jogadores:
        ficheiro = "%d.png" % j["id"]
        if descarregar(j["photo"], os.path.join(PASTA_JOGADORES, ficheiro)):
            novas += 1
        saida.append({
            "id": j["id"],
            "nome": j["name"],
            "n": j.get("number"),
            "posicao": j.get("position"),
            "idade": j.get("age"),
            "foto": "img/players/" + ficheiro,
        })
    print("  %d fotos novas" % novas)

    # ---------- emblemas ----------
    print("A ler emblemas das equipas...")
    equipas = {}
    for liga, epoca in ((LIGA, 2023), (95, 2023)):
        try:
            d = pedir("teams?league=%d&season=%d" % (liga, epoca), k)
        except Exception as e:
            print("  falhou liga", liga, e)
            continue
        for item in d.get("response", []):
            t = item["team"]
            equipas[t["name"]] = {"id": t["id"], "logo": t["logo"]}
        time.sleep(1)

    novos = 0
    mapa = {}
    for nome, t in equipas.items():
        ficheiro = "%d.png" % t["id"]
        if descarregar(t["logo"], os.path.join(PASTA_EQUIPAS, ficheiro)):
            novos += 1
        mapa[nome] = "img/teams/" + ficheiro
    print("  %d equipas, %d emblemas novos" % (len(mapa), novos))

    with open(os.path.join(PASTA_DADOS, "plantel.json"), "w", encoding="utf-8") as f:
        json.dump({"atualizado": time.strftime("%Y-%m-%d %H:%M"),
                   "jogadores": saida, "equipas": mapa}, f, ensure_ascii=False, indent=1)

    print("Feito. dados/plantel.json escrito.")


if __name__ == "__main__":
    main()
