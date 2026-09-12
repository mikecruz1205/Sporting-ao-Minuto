#!/usr/bin/env python3
"""
Emblemas das equipas — Liga portuguesa e fase de liga da Champions.

A API-Football deixou de responder (conta suspensa), por isso os emblemas
passam a vir do TheSportsDB, que os serve de graca e sem chave.

Corre-se a mao quando mudarem os adversarios:
    python atualizar_emblemas.py
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding='utf-8')

PASTA  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'img', 'teams')
MAPA   = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dados', 'emblemas.json')
UA     = 'SportingAoMinuto/1.0 (+https://github.com/mikecruz1205/Sporting-ao-Minuto)'
BASE   = 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t='

# Como escrevemos o nome -> como o TheSportsDB lhe chama.
# So entram aqui os que nao se encontram pelo nome directo.
ALIAS = {
    'Paris Saint-Germain': 'Paris SG',
    'Vitória de Guimarães': 'Guimaraes',
    'V. Guimarães':         'Guimaraes',
    'Académico de Viseu':   'Academico Viseu',
    'Ac. Viseu':            'Academico Viseu',
    'Estrela da Amadora':   'Estrela Amadora',
    'Bodø/Glimt':           'Bodo Glimt',
    'Internazionale':       'Inter Milan',
    'Inter Milan':          'Inter Milan',
    'Sporting CP':          'Sporting CP',
    'Marítimo':             'Maritimo',
    'Famalicão':            'Famalicao',
    'Braga':                'Braga',
    'Porto':                'Porto',
    'FC Porto':             'Porto',
    'Lille':                'Lille OSC',
    'Nacional':             'Nacional Madeira',
}

def ficheiro(nome):
    s = unicodedata.normalize('NFD', nome).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') + '.png'

def procurar(nome):
    """O TheSportsDB corta o acesso se lhe pedirmos depressa de mais,
       por isso espera-se e tenta-se de novo em vez de desistir."""
    alvo = ALIAS.get(nome, nome)
    u = BASE + urllib.parse.quote(alvo)
    for tentativa in range(5):
        try:
            req = urllib.request.Request(u, headers={'User-Agent': UA})
            d = json.loads(urllib.request.urlopen(req, timeout=25).read().decode())
            for t in (d.get('teams') or []):
                if t.get('strSport') == 'Soccer' and t.get('strBadge'):
                    return t['strBadge']
            return None
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(8 * (tentativa + 1)); continue
            raise
    return None

def descarregar(url, destino):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    dados = urllib.request.urlopen(req, timeout=30).read()
    if len(dados) < 500:
        raise ValueError('imagem demasiado pequena')
    open(destino, 'wb').write(dados)
    return len(dados)

def main(equipas):
    os.makedirs(PASTA, exist_ok=True)
    os.makedirs(os.path.dirname(MAPA), exist_ok=True)
    mapa = json.load(open(MAPA, encoding='utf-8')) if os.path.exists(MAPA) else {}

    novos = falhados = 0
    for nome in equipas:
        f = ficheiro(nome)
        destino = os.path.join(PASTA, f)
        if nome in mapa and os.path.exists(destino):
            continue
        try:
            url = procurar(nome)
            if not url:
                print(f'  sem emblema: {nome}'); falhados += 1; continue
            n = descarregar(url, destino)
            mapa[nome] = 'img/teams/' + f
            novos += 1
            print(f'  {nome:26} -> {f} ({n//1024} KB)')
        except Exception as e:
            print(f'  falhou {nome}: {type(e).__name__}'); falhados += 1
        time.sleep(1.5)

    json.dump(mapa, open(MAPA, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1, sort_keys=True)
    print(f'\n{novos} novos, {falhados} sem emblema, {len(mapa)} no total')
    print('mapa em', MAPA)

if __name__ == '__main__':
    lista = json.load(open(sys.argv[1], encoding='utf-8')) if len(sys.argv) > 1 else []
    main(lista)
