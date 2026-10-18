"""Calendário .ics dos jogos (api/_calendario.py). Sem rede."""
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api'))
import _calendario as C  # noqa: E402

JOGOS = [
    {'id': 2, 'data': '2026-10-21T20:00:00+00:00', 'competicao': 'Liga dos Campeões', 'fase': 'Fase de liga · jornada 3',
     'casa': 'Sporting CP', 'fora': 'LASK', 'golos_casa': None, 'golos_fora': None, 'local': 'Estádio José Alvalade, Lisboa'},
    {'id': 1, 'data': '2026-08-08T20:30:00+01:00', 'competicao': 'Liga Portugal', 'fase': 'Jornada 1',
     'casa': 'Estrela da Amadora', 'fora': 'Sporting CP', 'golos_casa': 2, 'golos_fora': 2, 'local': None},
]


def desdobrar(texto):
    return texto.replace('\r\n ', '')


class TestCalendario(unittest.TestCase):
    def setUp(self):
        self.ics = C.gerar_ics(JOGOS, datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)).decode('utf-8')

    def test_estrutura(self):
        self.assertTrue(self.ics.startswith('BEGIN:VCALENDAR\r\n'))
        self.assertTrue(self.ics.endswith('END:VCALENDAR\r\n'))
        self.assertEqual(self.ics.count('BEGIN:VEVENT'), 2)
        self.assertIn('UID:jogo-2@sporting-ao-minuto', self.ics)
        self.assertNotIn('\n', self.ics.replace('\r\n', ''))                   # só CRLF

    def test_horas_em_utc_e_ordem(self):
        self.assertIn('DTSTART:20260808T193000Z', self.ics)                    # 20:30 em Lisboa (verão) = 19:30 UTC
        self.assertIn('DTEND:20260808T213000Z', self.ics)
        self.assertLess(self.ics.index('jogo-1@'), self.ics.index('jogo-2@'))   # por data

    def test_resultado_e_escapes(self):
        t = desdobrar(self.ics)
        self.assertIn('SUMMARY:Estrela da Amadora 2–2 Sporting CP (Liga Portugal)', t)
        self.assertIn('SUMMARY:Sporting CP – LASK (Liga dos Campeões)', t)
        self.assertIn('LOCATION:Estádio José Alvalade\\, Lisboa', t)          # vírgula escapada
        self.assertEqual(C.escapar('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne')

    def test_linhas_dobradas_a_75_bytes(self):
        for linha in self.ics.split('\r\n'):
            self.assertLessEqual(len(linha.encode('utf-8')), 75, linha)
        longa = 'DESCRIPTION:' + 'á' * 100
        self.assertEqual(desdobrar(C.dobrar(longa)), longa)

    def test_falha_da_fonte(self):
        def falha():
            raise OSError('sem rede')
        codigo, cab, corpo = C.resposta(falha)
        self.assertEqual(codigo, 502)
        self.assertEqual(cab['Cache-Control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
