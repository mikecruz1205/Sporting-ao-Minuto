"""Previsão do tempo no dia de jogo (api/_tempo.py). Sem rede."""
import json
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api'))
import _tempo as T  # noqa: E402

AGORA = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
PREVISAO = {"hourly": {
    "time": ["2026-10-21T18:00", "2026-10-21T19:00", "2026-10-21T20:00"],
    "temperature_2m": [15.0, 14.1, 13.2], "precipitation_probability": [5, 0, 10],
    "weather_code": [2, 1, 61], "wind_speed_10m": [10.0, 12.1, 14.0]}}


class TestTempo(unittest.TestCase):
    def test_estadios_com_fonte(self):
        e = T.estadios()
        self.assertIn('Estádio José Alvalade', e)
        for nome, v in e.items():
            self.assertTrue(v['fonte'].startswith(('https://pt.wikipedia.org/', 'https://en.wikipedia.org/', 'https://www.wikidata.org/')), nome)
            self.assertTrue(-90 <= v['lat'] <= 90 and -180 <= v['lon'] <= 180, nome)

    def test_hora_mais_perto_e_descricao(self):
        pedidos = []
        def pedir(lat, lon, dia):
            pedidos.append((lat, lon, dia))
            return PREVISAO
        codigo, cab, corpo = T.resposta('Estádio José Alvalade', '2026-10-21T19:15:00Z', AGORA, pedir)
        d = json.loads(corpo)
        self.assertEqual(codigo, 200)
        self.assertEqual(d['hora'], '2026-10-21T19:00Z')
        self.assertEqual(d['descricao'], 'Pouco nublado')
        self.assertEqual(d['fonte']['licenca'], 'CC BY 4.0')
        self.assertEqual(pedidos[0][2], '2026-10-21')
        self.assertIn('s-maxage', cab['Cache-Control'])
        # 19h40 arredonda para as 20h
        d = json.loads(T.resposta('Estádio José Alvalade', '2026-10-21T19:40:00+00:00', AGORA, pedir)[2])
        self.assertEqual(d['descricao'], 'Chuva fraca')

    def test_recusa_o_que_nao_e_um_jogo_proximo(self):
        nunca = lambda *a: self.fail('não devia pedir')
        self.assertEqual(T.resposta('Estádio Inventado', '2026-10-21T19:00:00Z', AGORA, nunca)[0], 400)
        self.assertEqual(T.resposta('Estádio José Alvalade', '2026-11-30T19:00:00Z', AGORA, nunca)[0], 400)   # mais de 15 dias
        self.assertEqual(T.resposta('Estádio José Alvalade', '2026-10-18T19:00:00Z', AGORA, nunca)[0], 400)   # já passou
        self.assertEqual(T.resposta('Estádio José Alvalade', 'amanhã', AGORA, nunca)[0], 400)
        self.assertEqual(T.resposta('Estádio José Alvalade', '2026-10-21T19:00:00', AGORA, nunca)[0], 400)    # sem fuso

    def test_falha_da_previsao(self):
        def falha(*a):
            raise OSError('sem rede')
        codigo, cab, _ = T.resposta('Estádio José Alvalade', '2026-10-21T19:00:00Z', AGORA, falha)
        self.assertEqual(codigo, 502)
        self.assertEqual(cab['Cache-Control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
