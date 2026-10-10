"""Corre os testes de JavaScript (node --test) dentro do python -m unittest.

As regras da equipa Fantasy no browser estão em js/fantasy.js e os testes em
tests/*.test.js. Sem Node instalado, o teste é saltado (não falha).
"""
import shutil
import subprocess
import unittest
from pathlib import Path

PASTA = Path(__file__).resolve().parent


class TestesJavaScript(unittest.TestCase):
    def test_node(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('Node.js não está instalado')
        ficheiros = sorted(str(f) for f in PASTA.glob('*.test.js'))
        self.assertTrue(ficheiros, 'não há testes de JavaScript')
        r = subprocess.run([node, '--test', *ficheiros], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-2000:])


if __name__ == '__main__':
    unittest.main()
