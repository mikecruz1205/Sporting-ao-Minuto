"""As regras dos factos tirados das notícias (api/_factos.py)."""
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api"))
import _factos  # noqa: E402

AGORA = datetime(2026, 11, 11, 15, 0, tzinfo=timezone.utc)
FONTES = {
    "a": {"jornal": "RTP", "url": "https://www.rtp.pt/x"},
    "b": {"jornal": "Leonino", "url": "https://leonino.pt/y"},
    "c": {"jornal": "Leonino", "url": "https://leonino.pt/z"},
    "m": {"jornal": "Mau", "url": "http://inseguro.pt/w"},
}


def jogo(**extra):
    base = {"data": "2026-11-07", "casa": "Sporting CP", "fora": "Moreirense", "estado": "terminado",
            "atualizado_em": "2026-11-11T14:30:00Z", "fontes": FONTES,
            "resultado": {"casa": 1, "fora": 0, "fontes": ["a", "b"]},
            "eventos": [{"tipo": "golo", "minuto": 61, "equipa": "casa", "jogador": "Luis Suárez", "fontes": ["a", "b"]}]}
    base.update(extra)
    return _factos.validar_jogo(base, AGORA)


class Regras(unittest.TestCase):

    def test_resultado_e_golo_com_dois_jornais(self):
        j = jogo()
        self.assertEqual((j["resultado"]["casa"], j["resultado"]["fora"]), (1, 0))
        self.assertEqual([e["jogador"] for e in j["eventos"]], ["Luis Suárez"])

    def test_um_so_jornal_nao_chega_para_resultado_nem_golo(self):
        # dois artigos do mesmo jornal contam como um jornal
        j = jogo(resultado={"casa": 1, "fora": 0, "fontes": ["b", "c"]},
                 eventos=[{"tipo": "golo", "minuto": 61, "equipa": "casa", "jogador": "X", "fontes": ["b", "c"]},
                          {"tipo": "ocasiao", "minuto": 8, "equipa": "casa", "jogador": "Maxi", "fontes": ["b"]}])
        self.assertIsNone(j["resultado"])
        self.assertEqual([e["tipo"] for e in j["eventos"]], ["ocasiao"])

    def test_fonte_sem_https_nao_conta(self):
        j = jogo(eventos=[{"tipo": "lance", "minuto": 30, "equipa": "fora", "detalhe": "?", "fontes": ["m"]}])
        self.assertEqual(j["eventos"], [])

    def test_golos_a_mais_para_o_resultado_saem(self):
        dois = [{"tipo": "golo", "minuto": m, "equipa": "casa", "jogador": "X", "fontes": ["a", "b"]} for m in (10, 20)]
        self.assertEqual(jogo(eventos=dois)["eventos"], [])

    def test_direto_antigo_deixa_de_ser_direto(self):
        j = jogo(estado="direto", minuto=55, atualizado_em="2026-11-11T13:00:00Z")
        self.assertIsNone(j["estado"])
        self.assertIsNone(j["minuto"])
        self.assertEqual(jogo(estado="direto", minuto=55, atualizado_em="2026-11-11T14:45:00Z")["estado"], "direto")

    def test_lance_sem_minuto_ordena_pelo_sitio_dito(self):
        j = jogo(eventos=[{"tipo": "lance", "minuto": None, "ordem": 46, "equipa": "casa", "fontes": ["b"]},
                          {"tipo": "ocasiao", "minuto": 8, "equipa": "casa", "fontes": ["b"]}])
        self.assertEqual([e["ordem"] for e in j["eventos"]], [8, 46])

    def test_formato_do_centro_de_jogo(self):
        n = _factos.normalizar(jogo())
        self.assertEqual(n["estado"]["codigo"], "terminado")
        self.assertEqual(n["resultado"]["casa"], 1)
        self.assertTrue(n["eventos"]["disponivel"])
        self.assertEqual(n["eventos"]["fonte"], "Notícias (RTP, Leonino)")

    def test_o_ficheiro_do_site_passa_as_regras(self):
        import json
        with open(_factos.FICHEIRO, encoding="utf-8") as f:
            dados = _factos.validar(json.load(f), AGORA)
        m = next(j for j in dados["jogos"] if j["fora"] == "Moreirense")
        self.assertEqual((m["resultado"]["casa"], m["resultado"]["fora"]), (1, 0))
        self.assertIn("Luis Suárez", [e.get("jogador") for e in m["eventos"] if e["tipo"] == "golo"])


if __name__ == "__main__":
    unittest.main()
