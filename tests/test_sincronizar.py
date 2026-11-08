"""Sincronização diária football-data → Supabase (api/_sincronizar.py). Sem rede."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api'))
import _sincronizar as S  # noqa: E402

SCP = {'id': 498, 'name': 'Sporting Clube de Portugal', 'shortName': 'Sporting CP'}
RESPOSTA = {'matches': [
    {'id': 11, 'utcDate': '2026-11-07T20:30:00Z', 'status': 'FINISHED', 'matchday': 11, 'stage': 'REGULAR_SEASON',
     'competition': {'code': 'PPL'}, 'homeTeam': SCP, 'awayTeam': {'id': 583, 'name': 'Moreirense FC'},
     'score': {'fullTime': {'home': 3, 'away': 0}}},
    {'id': 12, 'utcDate': '2026-11-29T20:30:00Z', 'status': 'TIMED', 'matchday': 12, 'stage': 'REGULAR_SEASON',
     'competition': {'code': 'PPL'}, 'homeTeam': {'id': 503, 'name': 'FC Porto'}, 'awayTeam': SCP,
     'score': {'fullTime': {'home': None, 'away': None}}},
    {'id': 13, 'utcDate': '2026-11-25T20:00:00Z', 'status': 'IN_PLAY', 'matchday': 5, 'stage': 'LEAGUE_STAGE',
     'competition': {'code': 'CL'}, 'homeTeam': SCP, 'awayTeam': {'id': 66, 'name': 'Manchester United FC'},
     'score': {'fullTime': {'home': 1, 'away': 0}}},
    {'id': 14, 'utcDate': '2027-02-17T20:00:00Z', 'status': 'SCHEDULED', 'matchday': None, 'stage': 'PLAYOFFS',
     'competition': {'code': 'CL'}, 'homeTeam': SCP, 'awayTeam': {'id': 1, 'name': 'Outro FC'}, 'score': {'fullTime': {}}},
    {'id': 15, 'utcDate': '2026-11-21T18:00:00Z', 'status': 'TIMED', 'matchday': 1, 'stage': 'REGULAR_SEASON',
     'competition': {'code': 'TDP'}, 'homeTeam': SCP, 'awayTeam': {'id': 2, 'name': 'União da Serra'}, 'score': {}},
]}


class TestSincronizar(unittest.TestCase):
    def test_normalizar(self):
        jogos, ignorados = S.normalizar(RESPOSTA)
        self.assertEqual(ignorados, [15])                                   # a taça não está no plano gratuito
        j = {x['fd_id']: x for x in jogos}
        self.assertEqual((j[11]['competicao'], j[11]['fase'], j[11]['casa'], j[11]['fora']),
                         ('Liga Portugal', 'Jornada 11', 'Sporting CP', 'Moreirense'))
        self.assertEqual((j[11]['golos_casa'], j[11]['golos_fora'], j[11]['sporting_casa']), (3, 0, True))
        self.assertEqual((j[12]['casa'], j[12]['sporting_casa'], j[12]['golos_casa']), ('FC Porto', False, None))
        self.assertEqual(j[13]['fase'], 'Fase de liga · jornada 5')
        self.assertIsNone(j[13]['golos_casa'])                              # a decorrer: o resultado não segue
        self.assertEqual(j[14]['fase'], 'Play-off')

    def test_jogos_so_com_dia_ficam_as_18_de_lisboa(self):
        inverno = {'utcDate': '2026-12-20T00:00:00Z', 'status': 'SCHEDULED'}
        verao = {'utcDate': '2027-04-11T00:00:00Z', 'status': 'SCHEDULED'}
        marcado = {'utcDate': '2026-12-04T20:15:00Z', 'status': 'TIMED'}
        self.assertEqual(S.hora_do_jogo(inverno), '2026-12-20T18:00:00Z')
        self.assertEqual(S.hora_do_jogo(verao), '2027-04-11T17:00:00Z')      # 18:00 em Lisboa (hora de verão)
        self.assertEqual(S.hora_do_jogo(marcado), '2026-12-04T20:15:00Z')

    def test_so_com_o_segredo_da_vercel(self):
        amb = {'CRON_SECRET': 'c', 'FOOTBALL_DATA_TOKEN': 't', 'SINCRONIZAR_SEGREDO': 's'}
        nunca = lambda *a: self.fail('não devia chamar')
        self.assertEqual(S.resposta('', amb, nunca, nunca)[0], 403)
        self.assertEqual(S.resposta('Bearer errado', amb, nunca, nunca)[0], 403)
        self.assertEqual(S.resposta('Bearer c', {}, nunca, nunca)[0], 403)        # sem CRON_SECRET não corre
        self.assertEqual(S.resposta('Bearer c', {'CRON_SECRET': 'c'}, nunca, nunca)[0], 503)

    def test_caminho_feliz_e_falhas(self):
        amb = {'CRON_SECRET': 'c', 'FOOTBALL_DATA_TOKEN': 't', 'SINCRONIZAR_SEGREDO': 's'}
        enviados = []
        codigo, corpo = S.resposta('Bearer c', amb, lambda t: RESPOSTA, lambda s, j: enviados.append((s, j)) or {'ok': True})
        self.assertEqual(codigo, 200)
        self.assertEqual((corpo['lidos'], corpo['ignorados']), (4, 1))
        self.assertEqual(enviados[0][0], 's')
        def falha(*a):
            raise OSError('sem rede')
        self.assertEqual(S.resposta('Bearer c', amb, falha, None)[0], 502)
        self.assertEqual(S.resposta('Bearer c', amb, lambda t: {'matches': []}, None)[0], 502)


if __name__ == '__main__':
    unittest.main()
