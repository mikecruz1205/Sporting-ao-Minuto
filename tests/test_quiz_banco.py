"""O banco do Quiz Leonino passa a validação (scripts/validar_quiz.py),
e a validação apanha os erros que deve apanhar."""
import copy
import json
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / 'scripts'))
from validar_quiz import validar  # noqa: E402


class TestBancoQuiz(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(RAIZ / 'dados' / 'quiz.json', encoding='utf-8') as f:
            cls.dados = json.load(f)

    def test_banco_valido(self):
        self.assertEqual(validar(self.dados), [])

    def test_apanha_erros(self):
        mau = copy.deepcopy(self.dados)
        p = mau['perguntas'][0]
        p['opcoes'] = p['opcoes'][:3]
        mau['perguntas'][1]['correta'] = 4
        mau['perguntas'][2]['fonte'] = {'nome': '', 'url': 'http://exemplo'}
        mau['perguntas'][3]['id'] = mau['perguntas'][4]['id']
        mau['perguntas'][5]['opcoes'][1] = mau['perguntas'][5]['opcoes'][0]
        erros = ' | '.join(validar(mau))
        for esperado in ['exatamente 4 opções', '"correta"', 'nome da fonte', 'ligação https', 'id repetido', 'opções repetidas']:
            self.assertIn(esperado, erros)

    def test_chega_para_um_jogo(self):
        mau = copy.deepcopy(self.dados)
        mau['perguntas'] = [p for p in mau['perguntas'] if p['dificuldade'] != 'dificil'][:30] + \
                           [p for p in mau['perguntas'] if p['dificuldade'] == 'dificil'][:3]
        self.assertTrue(any('"dificil"' in e for e in validar(mau)))


if __name__ == '__main__':
    unittest.main()
