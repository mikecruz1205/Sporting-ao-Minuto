#!/usr/bin/env python3
"""
Prepara as importações do Fantasy a partir dos dados reais que o projeto
já tem, sem inventar nada:

  · plantel do zerozero      dados/plantel_zz.json   (nome, nº, posição, idade, país)
  · plantel da API-Football  dados/plantel.json      (ID externo e fotografia 150×150)
  · Wikipédia (época atual)  um JSON exportado pelo site com Wiki.sincronizarSporting()
                             (plantel, presenças e golos, calendário e resultados)

Escreve três ficheiros JSON prontos para as funções do Supabase:
  desporto_importar_jogadores, desporto_importar_estatisticas_epoca e
  fantasy_importar_calendario. As funções são idempotentes: correr outra
  vez atualiza, não duplica.

    python scripts/preparar_importacao_fantasy.py <wiki.json> <pasta-de-saida>

Regras:
  · fotografia só se o ficheiro existir em img/players/<id API>.png
    (vem da API-Football); sem ela, a interface mostra um avatar neutro
  · um valor que nenhuma fonte dá fica null — nunca 0
  · quando duas fontes discordam, fica a mais recente (zerozero) para
    nº, posição, idade e país; os IDs de todas ficam guardados
"""
import json, os, re, sys, unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISBOA = ZoneInfo('Europe/Lisbon')
EPOCA = '2026/27'


def chave(t):
    t = unicodedata.normalize('NFD', t.lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')


# nomes que as fontes escrevem de maneira diferente (mesma pessoa)
SINONIMOS = {'maxi-araujo': 'maximiliano-araujo'}
# IDs da API-Football com o nome de jogo em vez do nome (verificados à mão)
API_POR_ALCUNHA = {'18748': 'pedro-goncalves', '386820': 'rafael-nel'}
# nome curto conhecido (o mesmo que o site já usa nas fichas)
NOME_CURTO = {'pedro-goncalves': 'Pote'}


def canon(nome):
    k = chave(nome)
    return SINONIMOS.get(k, k)


def nome_curto(nome):
    k = canon(nome)
    if k in NOME_CURTO:
        return NOME_CURTO[k]
    if len(nome) <= 16:
        return nome
    partes = nome.split()
    return partes[0][0] + '. ' + partes[-1]


def mesmo_jogador_api(nome_api, nome):
    """'Z. Debast' ~ 'Zeno Debast'; 'Rui Silva' ≠ 'Francisco Silva'."""
    a, b = chave(nome_api).split('-'), canon(nome).split('-')
    if a == b:
        return True
    return a[-1] == b[-1] and a[0][0] == b[0][0] and (len(a[0]) == 1 or a[0] == b[0])


def main(wiki_json, saida):
    zz = json.load(open(os.path.join(RAIZ, 'dados', 'plantel_zz.json'), encoding='utf-8'))['jogadores']
    api = json.load(open(os.path.join(RAIZ, 'dados', 'plantel.json'), encoding='utf-8'))['jogadores']
    wiki = json.load(open(wiki_json, encoding='utf-8'))
    fotos = set(f[:-4] for f in os.listdir(os.path.join(RAIZ, 'img', 'players')) if f.endswith('.png'))

    nomes_wiki = {canon(n): n for n in list(wiki['stats']) + [p[0] for p in wiki['plantel']]}
    plantel_wiki = {canon(p[0]): p for p in wiki['plantel']}

    jogadores = {}
    # 1) zerozero (o plantel mais recente)
    for j in zz:
        k = canon(j['nome'])
        m = re.search(r'/(\d+)_[^/]+\.png$', j.get('foto') or '')
        jogadores[k] = {
            'nome': j['nome'], 'posicao': j['posGrupo'], 'numero': j.get('n'),
            'idade': j.get('idade'), 'nacionalidade': j.get('pais'),
            'ids': {'zerozero': m.group(1)} if m else {},
        }
    # 2) Wikipédia: quem lá está e o zerozero não tem
    for k, (nome, n, pos) in plantel_wiki.items():
        if k not in jogadores:
            jogadores[k] = {'nome': nome, 'posicao': pos, 'numero': n, 'idade': None,
                            'nacionalidade': None, 'ids': {}}
        # o nome completo ganha ao diminutivo ("Maximiliano Araújo" > "Maxi Araújo")
        if len(nome) > len(jogadores[k]['nome']):
            jogadores[k]['nome_curto'] = jogadores[k]['nome']
            jogadores[k]['nome'] = nome
    for k, j in jogadores.items():
        if k in nomes_wiki:
            j['ids']['wikipedia'] = chave(nomes_wiki[k])

    # 3) API-Football: ID externo e fotografia
    for a in api:
        aid = str(a['id'])
        alvo = API_POR_ALCUNHA.get(aid)
        cand = [k for k, j in jogadores.items()
                if (alvo and k == alvo) or (not alvo and mesmo_jogador_api(a['nome'], j['nome']))]
        if len(cand) == 1:
            j = jogadores[cand[0]]
            j['ids']['api-football'] = aid
            if aid in fotos:
                j['foto_url'] = f'/img/players/{aid}.png'
                j['foto_fonte'] = 'API-Football (media.api-sports.io)'

    lista = []
    for k, j in sorted(jogadores.items(), key=lambda kv: ('GR DEF MED AVA'.split().index(kv[1]['posicao']), kv[1]['numero'] or 99)):
        j.setdefault('nome_curto', nome_curto(j['nome']))
        if len(j['nome_curto']) > 16:
            j['nome_curto'] = nome_curto(j['nome_curto'])
        j.setdefault('foto_url', None)
        j.setdefault('foto_fonte', None)
        lista.append(j)

    # estatísticas da época (Wikipédia: jogos e golos em todas as provas)
    epoca = {'fonte': 'wikipedia', 'epoca': EPOCA, 'competicao': 'todas', 'jogadores': [
        {'ids': {'wikipedia': chave(n)}, 'jogos': s['j'], 'golos': s['g']} for n, s in wiki['stats'].items()]}

    # calendário
    def prova(c):
        a, _, b = c.partition(' — ')
        if a == 'LIGA':
            return 'Liga Portugal', 'Jornada ' + b.lstrip('J')
        if a == 'CHAMPIONS':
            return 'Liga dos Campeões', 'Fase de liga · jornada ' + b.lstrip('J')
        if a == 'TAÇA DA LIGA':
            return 'Taça da Liga', {'QF': 'Quartos de final', 'MEIA-FINAL': 'Meias-finais', 'FINAL': 'Final'}.get(b, b)
        return a.title(), b or None

    agora = datetime.now(LISBOA)
    jogos = []
    for data, comp, casa, fora, gc, gf, local in wiki['jogos']:
        d = datetime.fromisoformat(data).replace(tzinfo=LISBOA)
        c, fase = prova(comp)
        jogos.append({
            'id_externo': f'{EPOCA}|{comp}|{casa}|{fora}',
            'competicao': c, 'fase': fase, 'data': d.isoformat(),
            'casa': casa, 'fora': fora, 'sporting_casa': casa == 'Sporting CP',
            'golos_casa': gc, 'golos_fora': gf,
            'estado': 'terminado' if (d < agora and gc is not None and gf is not None) else 'agendado',
            'local': local,
        })
    calendario = {'fonte': 'wikipedia', 'epoca': EPOCA, 'jogos': sorted(jogos, key=lambda j: j['data'])}

    os.makedirs(saida, exist_ok=True)
    for nome, dados in (('jogadores', {'fonte': 'zerozero+wikipedia+api-football', 'jogadores': lista}),
                        ('epoca', epoca), ('calendario', calendario)):
        json.dump(dados, open(os.path.join(saida, nome + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'{len(lista)} jogadores · {len(epoca["jogadores"])} linhas de época · {len(jogos)} jogos')
    for j in lista:
        print(f"  {j['posicao']:3} {str(j['numero'] or ''):>2} {j['nome']:24} {j['nome_curto']:16} "
              f"{','.join(f'{k}={v}' for k, v in j['ids'].items()):60} foto={'sim' if j['foto_url'] else 'não'}")


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main(sys.argv[1], sys.argv[2])
