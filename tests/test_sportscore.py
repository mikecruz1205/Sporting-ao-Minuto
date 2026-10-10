"""Testes da SportScore (api/_jogo.py: ler_ss / normalizar_ss).

    python -m unittest discover -s tests -v

Usa respostas REAIS da API, gravadas a 2026-10-10 em tests/dados/:
  * sportscore_braga_sporting_2026-10-09.json — SC Braga 1-3 Sporting CP
    (Liga, 9/10/2026), conferido com a RTP: "O Sporting ... ao vencer por
    3-1, com reviravolta, no reduto do SC Braga";
  * sportscore_direto_puebla_leon.json — um jogo da Liga MX a decorrer (16');
  * sportscore_classificacao_liga.json — a classificação da Liga Portugal.
A rede é simulada: nenhum teste faz pedidos à SportScore.
"""
import io
import json
import os
import sys
import unittest
import urllib.error
from datetime import datetime, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "api"))
import _jogo  # noqa: E402


def dados(nome):
    with open(os.path.join(AQUI, "dados", nome), encoding="utf-8") as f:
        return f.read()


BRAGA = dados("sportscore_braga_sporting_2026-10-09.json")
DIRETO = dados("sportscore_direto_puebla_leon.json")
LIGA = dados("sportscore_classificacao_liga.json")
INICIO = datetime(2026, 10, 9, 19, 15, tzinfo=timezone.utc)


class Rede:
    """Simula a SportScore: responde por caminho/slug e conta os pedidos."""

    def __init__(self, jogos):
        self.jogos, self.pedidos = jogos, []

    def __call__(self, pedido, timeout=None):
        url = pedido.full_url
        self.pedidos.append(url)
        if "/standings/" in url:
            return io.BytesIO((LIGA if "portuguese" in url else '{"tables": []}').encode())
        for slug, corpo in self.jogos.items():
            if "slug=" + slug in url:
                return io.BytesIO(corpo.encode())
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO(b'{"error": "Match not found"}'))


class Normalizacao(unittest.TestCase):

    def setUp(self):
        self.m = json.loads(BRAGA)["match"]
        self.d = _jogo.normalizar_ss(self.m, "sporting-braga-vs-sporting-cp", json.loads(BRAGA)["updated"])

    def test_resultado_e_estado_do_jogo_real(self):
        self.assertEqual(self.d["estado"]["codigo"], "terminado")
        self.assertIsNone(self.d["estado"]["minuto"])
        self.assertEqual((self.d["resultado"]["casa"], self.d["resultado"]["fora"]), (1, 3))
        self.assertEqual(self.d["resultado"]["intervalo"], {"home": 1, "away": 0})
        self.assertEqual(self.d["estado"]["fonte"], "SportScore")
        self.assertEqual(self.d["atribuicao"]["texto"], "Powered by SportScore")

    def test_golos_com_minuto_e_resultado_parcial(self):
        golos = [(e["minuto"], e["tipo"], e["equipa"], e.get("jogador"), e.get("resultado"))
                 for e in self.d["eventos"]["lista"] if e["tipo"] in ("golo", "autogolo", "penalti")]
        self.assertEqual(golos, [
            (41, "autogolo", "casa", "Rui Silva", "1-0"),
            (66, "golo", "fora", "Luis Suárez", "1-1"),
            (71, "autogolo", "fora", "Bernardo Caltabiano Parise Fontes", "1-2"),
            (82, "golo", "fora", "Rodrigo Zalazar", "1-3"),
        ])

    def test_substituicoes_e_cartoes(self):
        ev = self.d["eventos"]["lista"]
        trocas = [(e["minuto"], e["entrou"], e["saiu"]) for e in ev if e["tipo"] == "substituicao"]
        self.assertIn((59, "Luis Suárez", "Fotis Ioannidis"), trocas)
        self.assertEqual(len(trocas), 10)
        self.assertEqual([(e["minuto"], e["jogador"]) for e in ev if e["tipo"] == "amarelo"],
                         [(89, "Sergio Barcia"), (89, "Flávio Gonçalves")])
        self.assertEqual(len({e["id"] for e in ev}), len(ev), "ids únicos")

    def test_onzes(self):
        eq = self.d["equipas"]
        self.assertTrue(eq["disponivel"])
        self.assertEqual((eq["casa"]["formacao"], eq["fora"]["formacao"]), ("3-4-2-1", "4-2-3-1"))
        self.assertEqual((len(eq["casa"]["titulares"]), len(eq["fora"]["titulares"])), (11, 11))
        self.assertEqual(eq["fora"]["titulares"][0], {"nome": "Rui Silva", "numero": 1, "posicao": "GR"})
        self.assertTrue(eq["confirmado"])

    def test_sem_estatisticas_diz_porque(self):
        self.assertFalse(self.d["estatisticas"]["disponivel"])
        self.assertTrue(self.d["estatisticas"]["motivo"])
        self.assertFalse(self.d["jogadores"]["disponivel"])

    def test_repetir_nao_duplica(self):
        outra = _jogo.normalizar_ss(self.m, "x")
        self.assertEqual([e["id"] for e in outra["eventos"]["lista"]], [e["id"] for e in self.d["eventos"]["lista"]])

    def test_jogo_em_direto_real(self):
        d = _jogo.normalizar_ss(json.loads(DIRETO)["match"], "puebla-vs-club-leon")
        self.assertEqual(d["estado"]["codigo"], "direto")
        self.assertEqual(d["estado"]["minuto"], 16)
        self.assertEqual(d["estado"]["fase"], "1.ª parte")
        self.assertIsNone(d["resultado"]["intervalo"], "na 1.ª parte não há resultado ao intervalo")
        self.assertTrue(d["estado"]["atraso"])
        linhas = {l["chave"]: (l["casa"], l["fora"]) for l in d["estatisticas"]["linhas"]}
        self.assertEqual(linhas, {"posse": (54, 46), "remates_baliza": (1, 0), "remates_fora": (3, 0)},
                         "Attacks e Dangerous Attacks ficam de fora (a fonte não os define)")

    def test_estados_pelo_texto(self):
        casos = {("live", "Half-time"): "intervalo", ("live", "HT"): "intervalo", ("upcoming", "Postponed"): "adiado",
                 ("upcoming", "Delayed"): "agendado", ("upcoming", "Not started"): "agendado",
                 ("finished", "Finished"): "terminado", ("live", "Suspended"): "suspenso",
                 ("upcoming", "Cancelled"): "cancelado", ("live", "2nd half"): "direto", ("???", ""): "desconhecido"}
        for (st, txt), esperado in casos.items():
            self.assertEqual(_jogo.estado_ss(st, txt), esperado, (st, txt))


class Procura(unittest.TestCase):

    def setUp(self):
        _jogo._MEMORIA.clear()
        _jogo._JANELA.clear()
        _jogo._SS_EQUIPAS.update(t=0.0, nomes={})
        os.environ["SPORTSCORE_ATIVO"] = "1"

    def tearDown(self):
        os.environ.pop("SPORTSCORE_ATIVO", None)

    def test_desligada_por_omissao(self):
        os.environ.pop("SPORTSCORE_ATIVO", None)
        rede = Rede({"sporting-braga-vs-sporting-cp": BRAGA})
        with self.assertRaises(_jogo.ErroFonte) as c:
            _jogo.ler_ss("2026-10-09", "SC Braga", "Sporting CP", abrir=rede, quando=INICIO)
        self.assertEqual(c.exception.motivo, "desligada")
        self.assertEqual(rede.pedidos, [], "desligada não faz pedidos")

    def test_encontra_o_jogo_pelo_nome_do_calendario(self):
        rede = Rede({"sporting-braga-vs-sporting-cp": BRAGA})
        d = _jogo.ler_ss("2026-10-09", "SC Braga", "Sporting CP", abrir=rede, quando=INICIO)
        self.assertEqual(d["fonte_id"], "ss:sporting-braga-vs-sporting-cp")
        self.assertEqual((d["resultado"]["casa"], d["resultado"]["fora"]), (1, 3))

    def test_com_id_vai_direto_ao_jogo(self):
        rede = Rede({"sporting-braga-vs-sporting-cp": BRAGA})
        _jogo._SS_EQUIPAS.update(t=9e18, nomes={"Sporting Braga": "sporting-braga"})
        _jogo.ler_ss("2026-10-09", "SC Braga", "Sporting CP", fonte_id="ss:sporting-braga-vs-sporting-cp",
                     abrir=rede, quando=INICIO)
        self.assertEqual(len(rede.pedidos), 1)

    def test_outro_jogo_com_o_mesmo_slug_nao_serve(self):
        """O slug é o mesmo na 2.ª volta (Sporting-Braga, março): se a data não
        bater certo, não se mostra o jogo errado."""
        rede = Rede({"sporting-braga-vs-sporting-cp": BRAGA})
        with self.assertRaises(_jogo.ErroFonte) as c:
            _jogo.ler_ss("2027-03-07", "Sporting CP", "SC Braga", abrir=rede,
                         quando=datetime(2027, 3, 7, 16, 0, tzinfo=timezone.utc))
        self.assertEqual(c.exception.motivo, "sem_jogo")

    def test_equipas_trocadas_nao_servem(self):
        rede = Rede({"sporting-braga-vs-sporting-cp": BRAGA})
        with self.assertRaises(_jogo.ErroFonte):
            _jogo.ler_ss("2026-10-09", "Sporting CP", "SC Braga", abrir=rede, quando=INICIO)

    def test_nomes_do_calendario(self):
        nomes = {r["team"]: r["team_slug"] for r in json.loads(LIGA)["tables"][0]["rows"]}
        casos = {"SC Braga": "sporting-braga", "V. Guimarães": "vitoria-guimaraes", "Estrela da Amadora": None,
                 "FC Porto": "fc-porto", "Benfica": "benfica", "Sporting CP": "sporting-cp", "Ac. Viseu": None,
                 "Casa Pia": None, "Nacional": None}
        for nome, esperado in casos.items():
            slug = _jogo.ss_slug_equipa(nome, nomes)
            if esperado:
                self.assertEqual(slug, esperado, nome)
            else:
                self.assertTrue(slug, nome)

    def test_cache_de_60_segundos_em_direto(self):
        corpo = json.loads(BRAGA)
        corpo["match"].update(status="live", status_text="2nd half", live_minute=67)
        rede = Rede({"sporting-braga-vs-sporting-cp": json.dumps(corpo)})
        leitores = [("ss", _jogo.ler_ss)]
        d, s = _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", leitores=leitores, abrir=rede)
        n = len(rede.pedidos)
        d2, s2 = _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", leitores=leitores, abrir=rede)
        self.assertEqual((d["estado"]["codigo"], d["estado"]["minuto"]), ("direto", 67))
        self.assertEqual(s, 60)
        self.assertEqual(len(rede.pedidos), n, "o 2.º pedido dentro de 60 s vem da cache")
        self.assertEqual(d["atribuicoes"][0]["url"], "https://sportscore.com/")

    def test_falha_mostra_ultima_leitura_com_hora(self):
        rede = Rede({"sporting-braga-vs-sporting-cp": BRAGA})
        leitores = [("ss", _jogo.ler_ss)]
        _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", leitores=leitores, abrir=rede)
        for v in _jogo._MEMORIA.values():
            v["expira"] = 0

        def cai(pedido, timeout=None):
            raise urllib.error.HTTPError(pedido.full_url, 503, "erro", {}, io.BytesIO(b""))
        d, s = _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", leitores=leitores, abrir=cai)
        self.assertTrue(d["disponivel"])
        self.assertTrue(d["desatualizado"])
        self.assertIn("última leitura boa", d["aviso"])
        self.assertEqual((d["resultado"]["casa"], d["resultado"]["fora"]), (1, 3), "nada inventado: os dados guardados")

    def test_id_valido(self):
        _jogo.validar_pedido("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", "ss:sporting-braga-vs-sporting-cp")
        with self.assertRaises(ValueError):
            _jogo.validar_pedido("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", "ss:../../x")


if __name__ == "__main__":
    unittest.main()
