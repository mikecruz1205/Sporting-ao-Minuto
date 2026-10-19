"""Páginas partilháveis /jogo/… e /jogador/… (api/_pagina.py). Sem rede."""
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api'))
import _pagina as P  # noqa: E402

BASE = """<!doctype html><html><head>
<meta charset="utf-8">
<title>Sporting ao Minuto — geral</title>
<meta name="description" id="meta-descricao" content="geral">
<link rel="canonical" id="canonico" href="https://sporting-fan-ao-minuto.vercel.app/">
<meta property="og:title" id="og-titulo" content="Sporting ao Minuto">
<meta property="og:url" id="og-url" content="https://sporting-fan-ao-minuto.vercel.app/">
<meta property="og:description" id="og-descricao" content="geral">
<meta name="twitter:title" content="Sporting ao Minuto">
<meta name="twitter:description" content="geral">
<link rel="stylesheet" href="css/base.css?v=1">
</head><body></body></html>"""

JOGOS = [
    {'id': 11, 'data': '2026-10-21T19:00:00+00:00', 'competicao': 'Liga dos Campeões', 'fase': 'Fase de liga · jornada 3',
     'casa': 'Sporting CP', 'fora': 'LASK', 'golos_casa': None, 'golos_fora': None, 'local': 'Estádio José Alvalade'},
    {'id': 1, 'data': '2026-08-08T19:30:00+00:00', 'competicao': 'Liga Portugal', 'fase': 'Jornada 1',
     'casa': 'Estrela da Amadora', 'fora': 'Sporting CP', 'golos_casa': 2, 'golos_fora': 2, 'local': None},
    {'id': 30, 'data': '2026-12-31T23:30:00+00:00', 'competicao': 'Liga Portugal', 'fase': None,
     'casa': 'Sporting CP', 'fora': 'Rio Ave', 'golos_casa': None, 'golos_fora': None, 'local': None},
]
JOGADORES = [{'id': 1, 'nome': 'Rui Silva', 'nome_curto': 'Rui Silva', 'posicao': 'GR', 'numero': 1, 'idade': 32, 'nacionalidade': 'Portugal'},
             {'id': 9, 'nome': 'Geovany Quenda', 'nome_curto': 'Quenda', 'posicao': 'AVA', 'numero': 57, 'idade': 19, 'nacionalidade': 'Portugal'}]


def falso(caminho):
    """Faz de PostgREST: filtra os jogos pelo intervalo de datas pedido."""
    if caminho.startswith('desporto_jogos'):
        import urllib.parse
        q = urllib.parse.parse_qs(caminho.split('?', 1)[1])
        de, ate = [datetime.fromisoformat(v.split('.', 1)[1]) for v in q['data']]
        return [j for j in JOGOS if de <= datetime.fromisoformat(j['data']) < ate]
    if caminho.startswith('desporto_jogadores'):
        return JOGADORES
    if caminho.startswith('desporto_estatisticas_epoca'):
        return [{'epoca': '2026/27', 'competicao': 'todas', 'jogos': 8, 'golos': 0, 'fonte': 'wikipedia'}] if 'eq.1&' in caminho else []
    raise AssertionError(caminho)


class TestPagina(unittest.TestCase):
    def test_slug_e_hora_de_lisboa(self):
        self.assertEqual(P.slug('Vitória de Guimarães'), 'vitoria-de-guimaraes')
        self.assertEqual(P.lisboa(datetime(2026, 10, 21, 19, 0, tzinfo=timezone.utc)).hour, 20)    # verão
        self.assertEqual(P.lisboa(datetime(2026, 12, 1, 19, 0, tzinfo=timezone.utc)).hour, 19)     # inverno
        self.assertEqual(P.lisboa(datetime(2026, 10, 25, 0, 59, tzinfo=timezone.utc)).hour, 1)     # antes da mudança
        self.assertEqual(P.lisboa(datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)).hour, 1)      # depois: 1h UTC = 1h

    def test_jogo_pelo_dia_de_lisboa(self):
        self.assertEqual(P.procurar_jogo('2026-10-21-sporting-cp-lask', falso)['id'], 11)
        self.assertEqual(P.procurar_jogo('2026-10-21', falso)['id'], 11)                 # só o dia chega
        self.assertEqual(P.procurar_jogo('2026-12-31-sporting-cp-rio-ave', falso)['id'], 30)  # 23h30 UTC = 31 em Lisboa (inverno)
        self.assertIsNone(P.procurar_jogo('2026-10-22-sporting-cp-lask', falso))
        self.assertIsNone(P.procurar_jogo('../../etc', falso))
        self.assertEqual(P.caminho_jogo(JOGOS[0]), '/jogo/2026-10-21-sporting-cp-lask')

    def test_descricoes(self):
        m = P.meta_jogo(JOGOS[1])
        self.assertEqual(m['titulo'], 'Estrela da Amadora 2–2 Sporting CP')
        self.assertIn('Resultado final', m['descricao'])
        self.assertIn('sábado, 8 de agosto de 2026, às 20:30', m['descricao'])
        p, est = P.procurar_jogador('rui-silva', falso)
        self.assertEqual(P.meta_jogador(p, est)['descricao'],
                         'Guarda-redes do Sporting CP, n.º 1, 32 anos, Portugal. Época 2026/27: 8 jogos e 0 golos (segundo a Wikipédia).')
        q, est = P.procurar_jogador('quenda', falso)                                       # pelo nome curto
        self.assertEqual(P.meta_jogador(q, est)['descricao'], 'Avançado do Sporting CP, n.º 57, 19 anos, Portugal.')
        self.assertEqual(P.procurar_jogador('ninguem', falso), (None, None))

    def test_pagina_com_base_e_metadados_escapados(self):
        codigo, cab, corpo = P.resposta('jogo', '2026-10-21-sporting-cp-lask', falso, BASE)
        h = corpo.decode('utf-8')
        self.assertEqual(codigo, 200)
        self.assertLess(h.index('<base href="/">'), h.index('css/base.css'))           # antes de qualquer caminho relativo
        self.assertIn('<title>Sporting CP – LASK · Sporting ao Minuto</title>', h)
        self.assertIn('href="https://sporting-fan-ao-minuto.vercel.app/jogo/2026-10-21-sporting-cp-lask"', h)
        self.assertIn('id="pagina-partilhada">{"tipo": "jogo"', h)
        mau = dict(JOGOS[0], casa='"><script>alert(1)</script>')
        h = P.montar(BASE, P.meta_jogo(mau), {'tipo': 'jogo', 'jogo': mau})
        self.assertNotIn('<script>alert', h)

    def test_sem_dados_sai_a_pagina_geral(self):
        def falha(_):
            raise OSError('sem rede')
        for ler in (falha, lambda c: []):
            codigo, cab, corpo = P.resposta('jogador', 'ninguem', ler, BASE)
            h = corpo.decode('utf-8')
            self.assertEqual(codigo, 200)
            self.assertIn('<title>Sporting ao Minuto — geral</title>', h)
            self.assertIn('<base href="/">', h)


if __name__ == '__main__':
    unittest.main()
