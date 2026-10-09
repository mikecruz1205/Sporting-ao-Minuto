#!/usr/bin/env python3
"""
Sincroniza as estatísticas dos jogos do Sporting para o Fantasy.

Lê uma fonte externa, normaliza para o modelo interno
(desporto_estatisticas_jogo) e envia para o servidor pela função
fantasy_importar_jogo — que guarda, recalcula a jornada e regista tudo em
desporto_sincronizacoes. Correr duas vezes dá o mesmo resultado.

FONTES
  football-data   (gratuita, com token)   Liga Portugal e Liga dos Campeões:
                  onze, banco, golos com marcador e assistente, cartões e
                  substituições com o minuto. UM pedido por jogo.
  api-football    (plano pago para a época atual)   fixtures/players: minutos,
                  golos, assistências, cartões, penáltis, defesas e golos
                  sofridos do guarda-redes. UM pedido por jogo para a equipa toda.

MINUTOS (football-data não os dá diretamente — regra fixa, documentada)
  titular que não sai        → 90
  titular substituído ao m   → m
  suplente que entra ao m    → max(1, 90 - m)
  descontos não contam. Chega para as regras de 1 e 60 minutos.

O QUE FICA "SEM DADOS" (null, nunca 0) com o football-data
  defesas, penáltis falhados e defendidos, recuperações. Os golos sofridos
  com o jogador em campo calculam-se pelos minutos dos golos do adversário.

USO
  python scripts/sincronizar_jogos.py --testar                 # testes da normalização, sem rede
  python scripts/sincronizar_jogos.py --fonte football-data --jogo <id FD> --jogo-interno <id> [--enviar]

  Sem --enviar só mostra o que enviaria. Para enviar são precisas as
  variáveis de ambiente (nunca no repositório nem no browser):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    FOOTBALL_DATA_TOKEN   (ou o ficheiro chave-football-data.txt)
    API_FOOTBALL_KEY      (ou o ficheiro chave-api.txt)
"""
import json, os, re, sys, time, unicodedata, urllib.error, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPORTING_FD = 498          # Sporting CP no football-data.org
SPORTING_AF = 228          # Sporting CP na API-Football


# --------------------------------------------------------------------- utilitários
def chave(t):
    t = unicodedata.normalize('NFD', (t or '').lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')


def segredo(var, ficheiro):
    v = os.environ.get(var, '').strip()
    if v:
        return v
    caminho = os.path.join(RAIZ, ficheiro)
    return open(caminho, encoding='utf-8').read().strip() if os.path.exists(caminho) else ''


def pedir(url, cabecalhos, tentativas=4):
    """GET com repetição controlada: 429 e 5xx esperam e tentam outra vez;
    401/403/404 não adianta repetir."""
    espera = 2
    for n in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=cabecalhos), timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit(f'{e.code}: chave inválida ou sem acesso a este recurso ({url})')
            if e.code == 404:
                raise SystemExit(f'404: não existe ({url})')
            if e.code == 429 or e.code >= 500:
                pausa = int(e.headers.get('Retry-After') or e.headers.get('X-RequestCounter-Reset') or espera)
                print(f'  {e.code}: espera {pausa}s (tentativa {n + 1}/{tentativas})')
                time.sleep(min(pausa, 60)); espera *= 2
                continue
            raise
        except urllib.error.URLError as e:
            print(f'  rede: {e.reason} (tentativa {n + 1}/{tentativas})')
            time.sleep(espera); espera *= 2
    raise SystemExit('a fonte não respondeu depois de várias tentativas')


# --------------------------------------------------------------------- football-data → modelo interno
def normalizar_football_data(m, sporting=SPORTING_FD):
    """m = resposta de /v4/matches/{id}. Devolve (jogo, jogadores) no modelo interno,
    com o nome de cada jogador para depois se ligar ao ID interno."""
    casa = m['homeTeam']['id'] == sporting
    nos = m['homeTeam'] if casa else m['awayTeam']
    ft = (m.get('score') or {}).get('fullTime') or {}
    jogo = {'golos_casa': ft.get('home'), 'golos_fora': ft.get('away'),
            'estado': 'terminado' if m.get('status') == 'FINISHED' else 'em_curso'}

    # intervalos em campo: [entra, sai]
    campo = {}
    for p in nos.get('lineup') or []:
        campo[p['id']] = {'nome': p['name'], 'titular': True, 'entra': 0, 'sai': 90}
    for s in m.get('substitutions') or []:
        if s['team']['id'] != sporting:
            continue
        mi = int(s['minute'])
        if s['playerOut']['id'] in campo:
            campo[s['playerOut']['id']]['sai'] = mi
        campo[s['playerIn']['id']] = {'nome': s['playerIn']['name'], 'titular': False, 'entra': mi, 'sai': 90}

    # expulsão: sai do campo nesse minuto (conta para os minutos e para os golos sofridos)
    for b in m.get('bookings') or []:
        pid = (b.get('player') or {}).get('id')
        if b['team']['id'] == sporting and pid in campo and b.get('card') in ('YELLOW_RED', 'RED'):
            campo[pid]['sai'] = min(campo[pid]['sai'], int(b['minute']))

    for v in campo.values():
        v.update(minutos=max(1, v['sai'] - v['entra']) if v['sai'] > v['entra'] or not v['titular'] else 0,
                 golos=0, assistencias=0, amarelos=0, vermelhos=0, pen_marcados=0, autogolos=0, golos_sofridos=0)

    for g in m.get('goals') or []:
        mi = int(g['minute'])
        do_sporting = g['team']['id'] == sporting
        marcador = (g.get('scorer') or {}).get('id')
        if g.get('type') == 'OWN':
            # autogolo: a equipa do "team" é a que beneficia; quem marcou é do outro lado
            if not do_sporting and marcador in campo:
                campo[marcador]['autogolos'] += 1
        elif do_sporting:
            if marcador in campo:
                campo[marcador]['golos'] += 1
                if g.get('type') == 'PENALTY':
                    campo[marcador]['pen_marcados'] += 1
            assistente = (g.get('assist') or {}).get('id')
            if assistente in campo:
                campo[assistente]['assistencias'] += 1
        if not do_sporting:
            # golo sofrido: conta para quem estava em campo nesse minuto
            for v in campo.values():
                if v['entra'] <= mi <= v['sai'] and v['minutos'] > 0:
                    v['golos_sofridos'] += 1

    for b in m.get('bookings') or []:
        pid = (b.get('player') or {}).get('id')
        if b['team']['id'] != sporting or pid not in campo:
            continue
        if b.get('card') == 'YELLOW':
            campo[pid]['amarelos'] += 1
        else:                       # YELLOW_RED ou RED
            campo[pid]['vermelhos'] = 1

    jogadores = [{'nome_fonte': v['nome'], 'id_fonte': str(pid), 'titular': v['titular'], 'minutos': v['minutos'],
                  'golos': v['golos'], 'assistencias': v['assistencias'], 'amarelos': min(v['amarelos'], 2),
                  'vermelhos': v['vermelhos'], 'pen_marcados': v['pen_marcados'], 'autogolos': v['autogolos'],
                  'golos_sofridos': v['golos_sofridos'],
                  # o football-data não dá estes — ficam sem dados, não a zero
                  'pen_falhados': None, 'pen_defendidos': None, 'defesas': None, 'recuperacoes': None}
                 for pid, v in campo.items() if v['minutos'] > 0]
    return jogo, jogadores


# --------------------------------------------------------------------- API-Football → modelo interno
def normalizar_api_football(resposta, sporting=SPORTING_AF):
    """resposta = /fixtures/players?fixture=ID (as duas equipas num só pedido)."""
    equipa = next((e for e in resposta.get('response', []) if e['team']['id'] == sporting), None)
    if not equipa:
        return []
    out = []
    for p in equipa['players']:
        s = (p.get('statistics') or [{}])[0]
        g, c, pen, jogos = s.get('goals') or {}, s.get('cards') or {}, s.get('penalty') or {}, s.get('games') or {}
        minutos = jogos.get('minutes')
        if not minutos:
            continue
        gr = jogos.get('position') == 'G'
        out.append({'nome_fonte': p['player']['name'], 'id_fonte': str(p['player']['id']),
                    'titular': not jogos.get('substitute', False), 'minutos': minutos,
                    'golos': g.get('total') or 0, 'assistencias': g.get('assists') or 0,
                    'amarelos': c.get('yellow'), 'vermelhos': min(c.get('red') or 0, 1),
                    'pen_marcados': pen.get('scored'), 'pen_falhados': pen.get('missed'),
                    'pen_defendidos': pen.get('saved') if gr else None,
                    'defesas': g.get('saves') if gr else None,
                    'golos_sofridos': g.get('conceded') if gr else None,
                    'autogolos': None, 'recuperacoes': None})
    return out


# --------------------------------------------------------------------- servidor
def rpc(nome, corpo):
    url, chave_srv = os.environ.get('SUPABASE_URL', '').rstrip('/'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not chave_srv:
        raise SystemExit('faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente')
    req = urllib.request.Request(f'{url}/rest/v1/rpc/{nome}', data=json.dumps(corpo).encode(), method='POST',
                                 headers={'apikey': chave_srv, 'Authorization': f'Bearer {chave_srv}',
                                          'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def jogadores_internos():
    url, chave_srv = os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SERVICE_ROLE_KEY']
    req = urllib.request.Request(f'{url}/rest/v1/desporto_jogadores?select=id,nome,nome_curto,desporto_jogador_ids(fonte,id_externo)',
                                 headers={'apikey': chave_srv, 'Authorization': f'Bearer {chave_srv}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def ligar_ids(linhas, internos, fonte):
    """Liga cada jogador da fonte a um ID interno: primeiro pelo ID externo
    guardado, depois pelo nome. Quem não se encontra fica de fora e é avisado."""
    por_id = {(i['fonte'], i['id_externo']): j['id'] for j in internos for i in j['desporto_jogador_ids']}
    por_nome = {}
    for j in internos:
        for n in (j['nome'], j['nome_curto']):
            por_nome.setdefault(chave(n), j['id'])
            por_nome.setdefault(chave(n).split('-')[-1], j['id'])
    ok, falta = [], []
    for l in linhas:
        jid = por_id.get((fonte, l['id_fonte'])) or por_nome.get(chave(l['nome_fonte'])) \
              or por_nome.get(chave(l['nome_fonte']).split('-')[-1])
        (ok if jid else falta).append({**l, 'jogador_id': jid})
    return ok, falta


# --------------------------------------------------------------------- testes (sem rede)
def testar():
    m = {  # forma de /v4/matches/{id} — dados inventados, só para testar as contas
        'status': 'FINISHED', 'score': {'fullTime': {'home': 1, 'away': 2}},
        'homeTeam': {'id': 1, 'lineup': []}, 'awayTeam': {'id': SPORTING_FD, 'lineup': [
            {'id': 10, 'name': 'Guarda'}, {'id': 11, 'name': 'Central'}, {'id': 12, 'name': 'Médio'},
            {'id': 13, 'name': 'Ponta'}]},
        'substitutions': [{'minute': 70, 'team': {'id': SPORTING_FD}, 'playerOut': {'id': 13, 'name': 'Ponta'},
                           'playerIn': {'id': 14, 'name': 'Suplente'}}],
        'goals': [{'minute': 20, 'type': 'REGULAR', 'team': {'id': SPORTING_FD}, 'scorer': {'id': 13}, 'assist': {'id': 12}},
                  {'minute': 80, 'type': 'PENALTY', 'team': {'id': SPORTING_FD}, 'scorer': {'id': 14}, 'assist': None},
                  {'minute': 85, 'type': 'REGULAR', 'team': {'id': 1}, 'scorer': {'id': 99}, 'assist': None}],
        'bookings': [{'minute': 30, 'team': {'id': SPORTING_FD}, 'player': {'id': 11}, 'card': 'YELLOW'},
                     {'minute': 60, 'team': {'id': SPORTING_FD}, 'player': {'id': 11}, 'card': 'YELLOW_RED'}]}
    jogo, js = normalizar_football_data(m)
    p = {j['id_fonte']: j for j in js}
    erros = []
    def igual(rotulo, a, b):
        if a != b: erros.append(f'{rotulo}: esperado {b}, deu {a}')
    igual('resultado', (jogo['golos_casa'], jogo['golos_fora'], jogo['estado']), (1, 2, 'terminado'))
    igual('minutos titular', p['10']['minutos'], 90)
    igual('minutos substituído', p['13']['minutos'], 70)
    igual('minutos suplente', p['14']['minutos'], 20)
    igual('golo + assistência', (p['13']['golos'], p['12']['assistencias']), (1, 1))
    igual('penálti', (p['14']['golos'], p['14']['pen_marcados']), (1, 1))
    igual('vermelho por acumulação', (p['11']['amarelos'], p['11']['vermelhos']), (1, 1))
    igual('expulso sai do campo', (p['11']['minutos'], p['11']['golos_sofridos']), (60, 0))
    igual('golo sofrido com o suplente em campo', (p['14']['golos_sofridos'], p['13']['golos_sofridos']), (1, 0))
    igual('sem dados ≠ zero', (p['10']['defesas'], p['10']['recuperacoes']), (None, None))
    r = {'response': [{'team': {'id': SPORTING_AF}, 'players': [
        {'player': {'id': 46672, 'name': 'Rui Silva'}, 'statistics': [{'games': {'minutes': 90, 'position': 'G', 'substitute': False},
         'goals': {'total': None, 'assists': None, 'saves': 4, 'conceded': 1}, 'cards': {'yellow': 0, 'red': 0},
         'penalty': {'saved': 0, 'missed': 0, 'scored': 0}}]},
        {'player': {'id': 1, 'name': 'Não jogou'}, 'statistics': [{'games': {'minutes': None}}]}]}]}
    a = normalizar_api_football(r)
    igual('api-football: só quem jogou', len(a), 1)
    igual('api-football: guarda-redes', (a[0]['defesas'], a[0]['golos_sofridos'], a[0]['golos']), (4, 1, 0))
    print('testes:', 'OK' if not erros else 'FALHAS'); [print('  ' + e) for e in erros]
    return not erros


def main(args):
    if '--testar' in args:
        sys.exit(0 if testar() else 1)
    fonte = args[args.index('--fonte') + 1]
    externo = args[args.index('--jogo') + 1]
    interno = int(args[args.index('--jogo-interno') + 1])
    if fonte == 'football-data':
        token = segredo('FOOTBALL_DATA_TOKEN', 'chave-football-data.txt')
        if not token: raise SystemExit('falta FOOTBALL_DATA_TOKEN')
        jogo, linhas = normalizar_football_data(pedir(f'https://api.football-data.org/v4/matches/{externo}', {'X-Auth-Token': token}))
    elif fonte == 'api-football':
        chave_af = segredo('API_FOOTBALL_KEY', 'chave-api.txt')
        if not chave_af: raise SystemExit('falta API_FOOTBALL_KEY')
        resposta = pedir(f'https://v3.football.api-sports.io/fixtures/players?fixture={externo}', {'x-apisports-key': chave_af})
        if resposta.get('errors'): raise SystemExit(f'a API respondeu com erro: {resposta["errors"]}')
        jogo, linhas = {'estado': 'terminado'}, normalizar_api_football(resposta)
    else:
        raise SystemExit('fonte desconhecida')
    if '--enviar' not in args:
        print(json.dumps({'jogo': jogo, 'jogadores': linhas}, ensure_ascii=False, indent=1)); return
    ok, falta = ligar_ids(linhas, jogadores_internos(), fonte)
    if falta: print('sem correspondência (ficam de fora):', ', '.join(l['nome_fonte'] for l in falta))
    corpo = {'p': {'fonte': fonte, 'substituir': True, 'jogo': {'id': interno, **jogo},
                   'jogadores': [{k: v for k, v in l.items() if k not in ('nome_fonte', 'id_fonte')} for l in ok]}}
    print(json.dumps(rpc('fantasy_importar_jogo', corpo), ensure_ascii=False))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main(sys.argv[1:])
