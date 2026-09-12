#!/usr/bin/env python3
"""
Plantel actual do Sporting, a partir do zerozero.pt.

Porque nao o Wikipedia: a pagina da epoca no Wikipedia e mantida por
voluntarios e fica semanas atrasada — em setembro de 2026 ainda la
estavam jogadores ja vendidos e faltavam tres contratacoes. O zerozero
acompanha o mercado ao dia e serve o HTML sem JavaScript.

Escreve dados/plantel_zz.json. Corre-se sempre que houver movimento:
    python atualizar_plantel.py
"""
import gzip, json, os, re, sys, urllib.request
import html as H

sys.stdout.reconfigure(encoding='utf-8')

RAIZ    = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.join(RAIZ, 'dados', 'plantel_zz.json')
EQUIPA  = 'https://www.zerozero.pt/equipa/sporting-cp/16'
UA      = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
           '(KHTML, like Gecko) Chrome/128.0 Safari/537.36')

# como o zerozero agrupa -> como o site trata as posicoes
GRUPOS = [
    ('Guarda Redes', 'GR',  'GR'),
    ('Defesa',       'DEF', 'DEF'),
    ('Médio',        'MED', 'MED'),
    ('Avançado',     'AVA', 'AVA'),
]

BANDEIRAS = {
    'Portugal':'🇵🇹', 'Brasil':'🇧🇷', 'Espanha':'🇪🇸', 'França':'🇫🇷',
    'Itália':'🇮🇹', 'Dinamarca':'🇩🇰', 'Bélgica':'🇧🇪', 'Grécia':'🇬🇷',
    'Geórgia':'🇬🇪', 'Uruguai':'🇺🇾', 'Colômbia':'🇨🇴', 'Senegal':'🇸🇳',
    'Moçambique':'🇲🇿', 'Inglaterra':'🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Marrocos':'🇲🇦',
    'Austrália':'🇦🇺', 'Holanda':'🇳🇱', 'Argentina':'🇦🇷', 'Alemanha':'🇩🇪',
}
SIGLAS = {
    'Portugal':'POR', 'Brasil':'BRA', 'Espanha':'ESP', 'França':'FRA',
    'Itália':'ITA', 'Dinamarca':'DEN', 'Bélgica':'BEL', 'Grécia':'GRE',
    'Geórgia':'GEO', 'Uruguai':'URU', 'Colômbia':'COL', 'Senegal':'SEN',
    'Moçambique':'MOZ', 'Inglaterra':'ENG', 'Marrocos':'MAR',
    'Austrália':'AUS', 'Holanda':'NED', 'Argentina':'ARG', 'Alemanha':'GER',
}


def buscar(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Accept-Language': 'pt-PT,pt;q=0.9'})
    with urllib.request.urlopen(req, timeout=40) as r:
        dados = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            dados = gzip.decompress(dados)
        return dados.decode('utf-8', 'replace')


def valor_em_milhoes(t):
    t = H.unescape(t or '').replace('\xa0', ' ').strip()
    m = re.match(r'^([\d.,]+)\s*M\s*€$', t)
    if m:
        return float(m.group(1).replace(',', '.'))
    m = re.match(r'^([\d.,]+)\s*mil\s*€$', t)
    if m:
        return round(float(m.group(1).replace(',', '.')) / 1000, 3)
    return None


def ler_plantel(html):
    """Os jogadores vêm em <div class="staff">, agrupados por posição.
       A posição não está em cada cartão: é o último título que passou."""
    marcas = []
    for rotulo, pos, grupo in GRUPOS:
        for m in re.finditer(r'>\s*%s\s*<' % re.escape(rotulo), html):
            marcas.append((m.start(), pos, grupo))
            break
    marcas.sort()

    def posicao_em(indice):
        atual = ('—', 'MED')
        for pos_html, pos, grupo in marcas:
            if pos_html < indice:
                atual = (pos, grupo)
        return atual

    jogadores, vistos = [], set()
    for m in re.finditer(r'<div class="staff">', html):
        bloco = html[m.start(): m.start() + 2200]
        nome = re.search(r'<a href="/jogador/[a-z0-9-]+/\d+[^"]*">([^<]+)</a>', bloco)
        if not nome:
            continue
        nome = H.unescape(nome.group(1)).strip()
        if not nome or nome in vistos:
            continue
        vistos.add(nome)

        numero = re.search(r'<div class="number">(\d+)</div>', bloco)
        idade  = re.search(r'<span>(\d+)\s*anos', bloco)
        valor  = re.search(r'anos\s*-\s*([^<]+)</span>', bloco)
        pais   = re.search(r'<a title="([^"]+)" href="/pais/', bloco)
        foto   = re.search(r"background-image:\s*url\('([^']+)'\)", bloco)

        p = pais.group(1) if pais else ''
        pos, grupo = posicao_em(m.start())
        jogadores.append({
            'nome':  nome,
            'n':     int(numero.group(1)) if numero else None,
            'pos':   pos,
            'posGrupo': grupo,
            'idade': int(idade.group(1)) if idade else None,
            'valor': valor_em_milhoes(valor.group(1)) if valor else None,
            'nac':   ('%s %s' % (BANDEIRAS.get(p, '🏳️'), SIGLAS.get(p, p[:3].upper()))).strip(),
            'pais':  p,
            'foto':  foto.group(1) if foto and 'jogadores' in foto.group(1) else None,
        })
    return jogadores


def main():
    html = buscar(EQUIPA)
    jogadores = ler_plantel(html)
    if len(jogadores) < 18:
        print('só encontrei %d jogadores — não vale a pena gravar' % len(jogadores))
        return 1

    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    json.dump({'fonte': EQUIPA, 'jogadores': jogadores},
              open(DESTINO, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    por_grupo = {}
    for j in jogadores:
        por_grupo.setdefault(j['posGrupo'], []).append(j)
    for g in ('GR', 'DEF', 'MED', 'AVA'):
        nomes = ', '.join(x['nome'] for x in por_grupo.get(g, []))
        print('%-4s %2d  %s' % (g, len(por_grupo.get(g, [])), nomes))
    print('\n%d jogadores -> %s' % (len(jogadores), DESTINO))
    return 0


if __name__ == '__main__':
    sys.exit(main())
