"""/api/api?estado=1 diz se há fonte para a carreira (chave da API-Football)
sem chamar a API e sem mostrar a chave. Sem rede."""
import io
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api'))
import api as proxy  # noqa: E402


def pedir(caminho):
    h = proxy.handler.__new__(proxy.handler)
    h.path = caminho
    h.wfile = io.BytesIO()
    estado = {}
    h.send_response = lambda c: estado.update(codigo=c)
    h.send_header = lambda k, v: estado.setdefault('cab', {}).update({k: v})
    h.end_headers = lambda: None
    with mock.patch('urllib.request.urlopen', side_effect=AssertionError('não devia chamar a API')):
        h.do_GET()
    return estado['codigo'], json.loads(h.wfile.getvalue().decode('utf-8')), estado.get('cab', {})


class TestEstadoCarreira(unittest.TestCase):
    def test_sem_chave(self):
        with mock.patch.dict(os.environ, {'API_FOOTBALL_KEY': ''}), mock.patch('os.path.exists', return_value=False):
            codigo, corpo, cab = pedir('/api/api?estado=1')
        self.assertEqual((codigo, corpo), (200, {'disponivel': False}))
        self.assertIn('s-maxage=300', cab['Cache-Control'])

    def test_com_chave_nao_a_mostra(self):
        with mock.patch.dict(os.environ, {'API_FOOTBALL_KEY': 'segredo-123'}):
            codigo, corpo, _ = pedir('/api/api?estado=1')
        self.assertEqual((codigo, corpo), (200, {'disponivel': True}))
        self.assertNotIn('segredo', json.dumps(corpo))

    def test_pedidos_fora_da_lista_continuam_recusados(self):
        with mock.patch.dict(os.environ, {'API_FOOTBALL_KEY': 'x'}):
            codigo, _, _ = pedir('/api/api?p=teams?id=1')
        self.assertEqual(codigo, 400)


if __name__ == '__main__':
    unittest.main()
