"""Testes da camada de dados de jogo (api/_jogo.py).

    python -m unittest discover -s tests -v

Os jogos aqui são DADOS DE TESTE com a estrutura documentada de cada fonte
(API-Football v3 e football-data.org v4) — servem para provar que a
normalização, a deduplicação, as correções (VAR) e as falhas se tratam bem.
Não aparecem no site.
"""
import io
import json
import os
import sys
import unittest
import urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api"))
import _jogo  # noqa: E402

SCP, BRA = 228, 217


def fixture_af(status="2H", elapsed=67, extra=None, golos=(1, 0), eventos=None, com_stats=True, com_onzes=True):
    titulares_scp = [{"player": {"id": i, "name": n, "number": k, "pos": p}} for i, n, k, p in [
        (1, "Rui Silva", 1, "G"), (2, "Gonçalo Inácio", 25, "D"), (3, "Ousmane Diomande", 26, "D"),
        (4, "Iván Fresneda", 22, "D"), (5, "Maximiliano Araújo", 20, "D"), (6, "Morten Hjulmand", 42, "M"),
        (7, "Hidemasa Morita", 5, "M"), (8, "Francisco Trincão", 17, "F"), (9, "Pedro Gonçalves", 8, "M"),
        (10, "Geovany Quenda", 7, "F"), (11, "Luis Suárez", 97, "F")]]
    suplentes_scp = [{"player": {"id": 12, "name": "Conrad Harder", "number": 19, "pos": "F"}},
                     {"player": {"id": 13, "name": "Zeno Debast", "number": 6, "pos": "D"}}]
    titulares_bra = [{"player": {"id": 100 + i, "name": "Jogador Braga %d" % i, "number": i, "pos": "D"}} for i in range(11)]
    return {
        "fixture": {"id": 999001, "referee": "Árbitro Teste", "date": "2026-10-09T20:15:00+01:00",
                    "venue": {"name": "Estádio Municipal de Braga"},
                    "status": {"long": "Second Half", "short": status, "elapsed": elapsed, "extra": extra}},
        "league": {"name": "Primeira Liga", "round": "Regular Season - 8", "season": 2026},
        "teams": {"home": {"id": BRA, "name": "SC Braga"}, "away": {"id": SCP, "name": "Sporting CP"}},
        "goals": {"home": golos[0], "away": golos[1]},
        "score": {"halftime": {"home": 0, "away": 0}, "penalty": {"home": None, "away": None}},
        "events": eventos if eventos is not None else [
            {"time": {"elapsed": 12, "extra": None}, "team": {"id": SCP}, "player": {"name": "Morten Hjulmand"},
             "assist": {"name": None}, "type": "Card", "detail": "Yellow Card"},
            {"time": {"elapsed": 58, "extra": None}, "team": {"id": BRA}, "player": {"name": "Jogador Braga 9"},
             "assist": {"name": "Jogador Braga 7"}, "type": "Goal", "detail": "Normal Goal"},
            {"time": {"elapsed": 63, "extra": None}, "team": {"id": SCP}, "player": {"name": "Conrad Harder"},
             "assist": {"name": "Luis Suárez"}, "type": "subst", "detail": "Substitution 1"},
            {"time": {"elapsed": 64, "extra": None}, "team": {"id": SCP}, "player": {"name": "Pedro Gonçalves"},
             "assist": {"name": "Zeno Debast"}, "type": "subst", "detail": "Substitution 2"},
        ],
        "lineups": [
            {"team": {"id": BRA}, "formation": "4-3-3", "coach": {"name": "Treinador Braga"},
             "startXI": titulares_bra, "substitutes": []},
            {"team": {"id": SCP}, "formation": "4-2-3-1", "coach": {"name": "Rui Borges"},
             "startXI": titulares_scp, "substitutes": suplentes_scp},
        ] if com_onzes else [],
        "statistics": [
            {"team": {"id": BRA}, "statistics": [
                {"type": "Ball Possession", "value": "42%"}, {"type": "Total Shots", "value": 8},
                {"type": "Shots on Goal", "value": 3}, {"type": "Corner Kicks", "value": None},
                {"type": "expected_goals", "value": "0.91"}, {"type": "Passes %", "value": "81%"}]},
            {"team": {"id": SCP}, "statistics": [
                {"type": "Ball Possession", "value": "58%"}, {"type": "Total Shots", "value": 12},
                {"type": "Shots on Goal", "value": 4}, {"type": "Corner Kicks", "value": None},
                {"type": "expected_goals", "value": "1.40"}, {"type": "Passes %", "value": "88%"}]},
        ] if com_stats else [],
        "players": [
            {"team": {"id": SCP}, "players": [
                {"player": {"name": "Luis Suárez"}, "statistics": [{
                    "games": {"minutes": 63, "number": 97, "position": "F", "rating": "6.9", "substitute": False},
                    "shots": {"total": 3, "on": 1}, "goals": {"total": None, "assists": None, "saves": None, "conceded": 0},
                    "passes": {"total": 21, "key": 1, "accuracy": "17"}, "tackles": {"total": None, "interceptions": 1},
                    "fouls": {"drawn": 2, "committed": 1}, "cards": {"yellow": 0, "red": 0}}]}]},
        ],
    }


class Normalizacao(unittest.TestCase):

    def test_estado_em_direto_com_minuto_da_fonte(self):
        d = _jogo.normalizar_af(fixture_af())
        self.assertEqual(d["estado"]["codigo"], "direto")
        self.assertEqual(d["estado"]["minuto"], 67)
        self.assertEqual(d["estado"]["fase"], "2.ª parte")
        self.assertEqual((d["resultado"]["casa"], d["resultado"]["fora"]), (1, 0))

    def test_estados_mapeados(self):
        casos = {"NS": "agendado", "HT": "intervalo", "FT": "terminado", "PST": "adiado",
                 "SUSP": "suspenso", "CANC": "cancelado", "PEN": "terminado", "XYZ": "desconhecido"}
        for curto, esperado in casos.items():
            d = _jogo.normalizar_af(fixture_af(status=curto, elapsed=None))
            self.assertEqual(d["estado"]["codigo"], esperado, curto)
            if esperado not in ("direto", "intervalo"):
                self.assertIsNone(d["estado"]["minuto"], "sem minuto fora do jogo (%s)" % curto)

    def test_eventos_e_sentido_das_substituicoes(self):
        ev = _jogo.normalizar_af(fixture_af())["eventos"]["lista"]
        self.assertEqual([e["tipo"] for e in ev], ["amarelo", "golo", "substituicao", "substituicao"])
        golo = ev[1]
        self.assertEqual((golo["equipa"], golo["jogador"], golo["assistencia"]), ("casa", "Jogador Braga 9", "Jogador Braga 7"))
        # na fonte, a 1.ª troca vem com 'player' = quem entra e a 2.ª com 'player' = quem sai:
        # o sentido decide-se pelo onze, não pela posição do campo
        self.assertEqual((ev[2]["entrou"], ev[2]["saiu"]), ("Conrad Harder", "Luis Suárez"))
        self.assertEqual((ev[3]["entrou"], ev[3]["saiu"]), ("Zeno Debast", "Pedro Gonçalves"))

    def test_substituicao_sem_onze_nao_inventa_sentido(self):
        d = _jogo.normalizar_af(fixture_af(com_onzes=False))
        troca = [e for e in d["eventos"]["lista"] if e["tipo"] == "substituicao"][0]
        self.assertIsNone(troca.get("entrou"))
        self.assertEqual(sorted(troca["jogadores"]), ["Conrad Harder", "Luis Suárez"])

    def test_atualizacoes_nao_duplicam_eventos(self):
        a = _jogo.normalizar_af(fixture_af())["eventos"]["lista"]
        b = _jogo.normalizar_af(fixture_af())["eventos"]["lista"]
        self.assertEqual([e["id"] for e in a], [e["id"] for e in b])
        self.assertEqual(len({e["id"] for e in a}), len(a))

    def test_golo_anulado_pelo_var(self):
        golo = {"time": {"elapsed": 30, "extra": None}, "team": {"id": SCP}, "player": {"name": "Luis Suárez"},
                "assist": {"name": None}, "type": "Goal", "detail": "Normal Goal"}
        antes = _jogo.normalizar_af(fixture_af(golos=(0, 1), eventos=[golo]))
        var = {"time": {"elapsed": 32, "extra": None}, "team": {"id": SCP}, "player": {"name": "Luis Suárez"},
               "assist": {"name": None}, "type": "Var", "detail": "Goal cancelled"}
        depois = _jogo.normalizar_af(fixture_af(golos=(0, 0), eventos=[var]))
        self.assertEqual(antes["resultado"]["fora"], 1)
        self.assertEqual(depois["resultado"]["fora"], 0, "o resultado vem da fonte, não dos eventos")
        self.assertEqual([e["tipo"] for e in depois["eventos"]["lista"]], ["var"])
        self.assertEqual(depois["eventos"]["lista"][0]["detalhe"], "Golo anulado")

    def test_tipos_de_golo_e_cartao(self):
        ev = [
            {"time": {"elapsed": 10, "extra": None}, "team": {"id": SCP}, "player": {"name": "A"}, "assist": {}, "type": "Goal", "detail": "Penalty"},
            {"time": {"elapsed": 20, "extra": None}, "team": {"id": BRA}, "player": {"name": "B"}, "assist": {}, "type": "Goal", "detail": "Own Goal"},
            {"time": {"elapsed": 30, "extra": None}, "team": {"id": SCP}, "player": {"name": "C"}, "assist": {}, "type": "Goal", "detail": "Missed Penalty"},
            {"time": {"elapsed": 45, "extra": 2}, "team": {"id": BRA}, "player": {"name": "D"}, "assist": {}, "type": "Card", "detail": "Second Yellow card"},
            {"time": {"elapsed": 90, "extra": 4}, "team": {"id": BRA}, "player": {"name": "E"}, "assist": {}, "type": "Card", "detail": "Red Card"},
        ]
        lista = _jogo.normalizar_af(fixture_af(eventos=ev))["eventos"]["lista"]
        self.assertEqual([e["tipo"] for e in lista], ["penalti", "autogolo", "penalti_falhado", "segundo_amarelo", "vermelho"])
        self.assertEqual((lista[3]["minuto"], lista[3]["acrescimo"]), (45, 2))

    def test_estatisticas_sem_inferir(self):
        linhas = {l["chave"]: l for l in _jogo.normalizar_af(fixture_af())["estatisticas"]["linhas"]}
        self.assertEqual((linhas["posse"]["casa"], linhas["posse"]["fora"]), (42, 58))
        self.assertEqual(linhas["xg"]["fora"], 1.4)
        self.assertEqual(linhas["precisao_passe"]["fora"], 88)
        self.assertNotIn("cantos", linhas, "valor nulo nas duas equipas não aparece como 0")
        self.assertNotIn("faltas", linhas, "o que a fonte não dá não aparece")

    def test_sem_estatisticas_diz_porque(self):
        d = _jogo.normalizar_af(fixture_af(com_stats=False))
        self.assertFalse(d["estatisticas"]["disponivel"])
        self.assertTrue(d["estatisticas"]["motivo"])

    def test_jogador(self):
        j = _jogo.normalizar_af(fixture_af())["jogadores"]["lista"][0]
        self.assertEqual((j["nome"], j["minutos"], j["remates"], j["passes"], j["passes_certos"]), ("Luis Suárez", 63, 3, 21, 17))
        self.assertIsNone(j["golos"])
        self.assertIsNone(j["precisao_passe"])
        self.assertEqual(j["nota"], 6.9)

    def test_football_data_gratuito(self):
        m = {"id": 77, "utcDate": "2026-10-09T19:15:00Z", "status": "IN_PLAY", "matchday": 8,
             "lastUpdated": "2026-10-09T20:01:00Z", "competition": {"name": "Primeira Liga"},
             "homeTeam": {"id": 5613, "name": "Sporting Clube de Braga"}, "awayTeam": {"id": 498, "name": "Sporting Clube de Portugal"},
             "score": {"fullTime": {"home": 1, "away": 1}, "halfTime": {"home": 0, "away": 1}}}
        d = _jogo.normalizar_fd(m)
        self.assertEqual(d["estado"]["codigo"], "direto")
        self.assertIsNone(d["estado"]["minuto"], "o plano gratuito não dá o minuto")
        self.assertIn("atraso", d["estado"]["atraso"])
        self.assertFalse(d["eventos"]["disponivel"])
        self.assertIn("gratuito", d["eventos"]["motivo"])
        self.assertEqual(d["estado"]["atualizado_em"], "2026-10-09T20:01:00Z")

    def test_football_data_com_eventos(self):
        m = {"id": 78, "status": "FINISHED", "homeTeam": {"id": 1, "name": "Sporting Clube de Portugal"},
             "awayTeam": {"id": 2, "name": "FC Arouca"}, "score": {"fullTime": {"home": 2, "away": 2}, "halfTime": {}},
             "goals": [{"minute": 3, "type": "REGULAR", "team": {"id": 1}, "scorer": {"name": "Gonçalo Inácio"}, "assist": {"name": "Maximiliano Araújo"}}],
             "bookings": [{"minute": 36, "card": "YELLOW", "team": {"id": 2}, "player": {"name": "Espen van Ee"}}],
             "substitutions": [{"minute": 70, "team": {"id": 1}, "playerIn": {"name": "Conrad Harder"}, "playerOut": {"name": "Luis Suárez"}}]}
        ev = _jogo.normalizar_fd(m, plano_gratuito=False)["eventos"]["lista"]
        self.assertEqual([e["tipo"] for e in ev], ["golo", "amarelo", "substituicao"])
        self.assertEqual((ev[2]["entrou"], ev[2]["saiu"]), ("Conrad Harder", "Luis Suárez"))


class Juntar(unittest.TestCase):

    def setUp(self):
        _jogo._MEMORIA.clear()
        self.chamadas = 0

    def leitor_ok(self, dados):
        def ler(*a, **k):
            self.chamadas += 1
            return dados
        return ler

    def leitor_falha(self, motivo):
        def ler(*a, **k):
            self.chamadas += 1
            raise _jogo.ErroFonte(motivo)
        return ler

    def test_primeira_falha_segunda_responde(self):
        fd = _jogo.normalizar_fd({"id": 1, "status": "IN_PLAY", "homeTeam": {"id": 1, "name": "SC Braga"},
                                  "awayTeam": {"id": 2, "name": "Sporting CP"}, "score": {"fullTime": {"home": 0, "away": 1}}})
        d, s = _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP",
                           leitores=[("af", self.leitor_falha("conta")), ("fd", self.leitor_ok(fd))])
        self.assertTrue(d["disponivel"])
        self.assertEqual(d["estado"]["fonte"], "football-data.org")
        self.assertEqual(d["fontes"][0]["estado"], "conta")
        self.assertEqual(s, 20, "em direto a cache é curta")

    def test_cache_nao_volta_a_pedir(self):
        af = _jogo.normalizar_af(fixture_af(status="FT", elapsed=90))
        leitores = [("af", self.leitor_ok(af))]
        _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", leitores=leitores)
        _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", leitores=leitores)
        self.assertEqual(self.chamadas, 1)

    def test_falha_depois_de_leitura_boa_fica_marcada_como_antiga(self):
        af = _jogo.normalizar_af(fixture_af())
        _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", leitores=[("af", self.leitor_ok(af))])
        for v in _jogo._MEMORIA.values():
            v["expira"] = 0           # a cache caducou
        d, _ = _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", leitores=[("af", self.leitor_falha("tempo"))])
        self.assertTrue(d["disponivel"])
        self.assertTrue(d["desatualizado"])
        self.assertIn("última leitura boa", d["aviso"])

    def test_sem_fontes_diz_indisponivel(self):
        d, s = _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP",
                           leitores=[("af", self.leitor_falha("sem_chave")), ("fd", self.leitor_falha("sem_chave"))])
        self.assertFalse(d["disponivel"])
        self.assertIn("indisponíveis", d["motivo"])
        self.assertNotIn("estado", d, "sem fonte não há estado nem minuto")
        self.assertLessEqual(s, 120)

    def test_conflito_de_resultado_final(self):
        af = _jogo.normalizar_af(fixture_af(status="FT", elapsed=90, golos=(2, 1)))
        fd = _jogo.normalizar_fd({"id": 5, "status": "FINISHED", "homeTeam": {"id": 1, "name": "SC Braga"},
                                  "awayTeam": {"id": 2, "name": "Sporting CP"}, "score": {"fullTime": {"home": 2, "away": 2}}})
        d, _ = _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP",
                           leitores=[("af", self.leitor_ok(af)), ("fd", self.leitor_ok(fd))])
        self.assertEqual((d["resultado"]["casa"], d["resultado"]["fora"]), (2, 1))
        self.assertEqual(len(d["conflitos"]), 1)

    def test_bloco_em_falta_vem_da_segunda_fonte(self):
        af = _jogo.normalizar_af(fixture_af(com_onzes=False))
        fd = _jogo.normalizar_fd({"id": 6, "status": "IN_PLAY", "homeTeam": {"id": 1, "name": "SC Braga", "lineup": [{"name": "X", "shirtNumber": 1}]},
                                  "awayTeam": {"id": 2, "name": "Sporting CP", "lineup": [{"name": "Rui Silva", "shirtNumber": 1}]},
                                  "score": {"fullTime": {"home": 0, "away": 0}}}, plano_gratuito=False)
        d, _ = _jogo.obter("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP",
                           leitores=[("af", self.leitor_ok(af)), ("fd", self.leitor_ok(fd))])
        self.assertEqual(d["equipas"]["fonte"], "football-data.org")
        self.assertEqual(d["estado"]["fonte"], "API-Football")


class Rede(unittest.TestCase):

    def setUp(self):
        _jogo._JANELA.clear()

    def abrir_seq(self, respostas):
        fila = list(respostas)

        def abrir(pedido, timeout=None):
            r = fila.pop(0)
            if isinstance(r, Exception):
                raise r
            return io.BytesIO(r.encode("utf-8"))
        return abrir

    def erro_http(self, codigo):
        return urllib.error.HTTPError("http://x", codigo, "erro", {}, io.BytesIO(b""))

    def test_429_volta_a_tentar(self):
        abrir = self.abrir_seq([self.erro_http(429), '{"ok": 1}'])
        self.assertEqual(_jogo.pedir_json("http://x", {}, "fd", abrir=abrir), {"ok": 1})

    def test_401_nao_insiste(self):
        abrir = self.abrir_seq([self.erro_http(401), '{"ok": 1}'])
        with self.assertRaises(_jogo.ErroFonte) as c:
            _jogo.pedir_json("http://x", {}, "fd", abrir=abrir)
        self.assertEqual(c.exception.motivo, "conta")

    def test_tempo_esgotado(self):
        abrir = self.abrir_seq([TimeoutError("timed out"), TimeoutError("timed out")])
        with self.assertRaises(_jogo.ErroFonte) as c:
            _jogo.pedir_json("http://x", {}, "fd", abrir=abrir)
        self.assertEqual(c.exception.motivo, "tempo")

    def test_resposta_que_nao_e_json(self):
        abrir = self.abrir_seq(["<html>", "<html>"])
        with self.assertRaises(_jogo.ErroFonte) as c:
            _jogo.pedir_json("http://x", {}, "fd", abrir=abrir)
        self.assertEqual(c.exception.motivo, "resposta")

    def test_limite_por_minuto_deste_servidor(self):
        abrir = self.abrir_seq(['{"ok":1}'] * 20)
        for _ in range(_jogo.LIMITE_POR_MINUTO["fd"]):
            _jogo.pedir_json("http://x", {}, "fd", abrir=abrir)
        with self.assertRaises(_jogo.ErroFonte) as c:
            _jogo.pedir_json("http://x", {}, "fd", abrir=abrir)
        self.assertEqual(c.exception.motivo, "limite")

    def test_conta_suspensa_da_api_football(self):
        os.environ["API_FOOTBALL_KEY"] = "chave-de-teste"
        try:
            abrir = self.abrir_seq([json.dumps({"errors": {"access": "Your account is suspended"}, "response": []})])
            with self.assertRaises(_jogo.ErroFonte) as c:
                _jogo.ler_af("2026-10-09", "SC Braga", "Sporting CP", abrir=abrir)
            self.assertEqual(c.exception.motivo, "conta")
        finally:
            del os.environ["API_FOOTBALL_KEY"]


class Utilitarios(unittest.TestCase):

    def test_hora_de_lisboa(self):
        verao = _jogo.hora_lisboa(datetime(2026, 10, 9, 19, 15, tzinfo=timezone.utc))
        inverno = _jogo.hora_lisboa(datetime(2026, 12, 1, 20, 0, tzinfo=timezone.utc))
        self.assertEqual(verao.strftime("%H:%M"), "20:15")
        self.assertEqual(inverno.strftime("%H:%M"), "20:00")
        self.assertEqual(_jogo.hora_lisboa(datetime(2026, 10, 25, 0, 59, tzinfo=timezone.utc)).utcoffset().seconds, 3600)
        self.assertEqual(_jogo.hora_lisboa(datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)).utcoffset().seconds, 0)

    def test_equipas(self):
        self.assertTrue(_jogo.mesma_equipa("SC Braga", "Braga"))
        self.assertTrue(_jogo.mesma_equipa("Sporting CP", "Sporting Clube de Portugal"))
        self.assertTrue(_jogo.mesma_equipa("Sporting Clube de Braga", "SC Braga"))
        self.assertFalse(_jogo.mesma_equipa("Sporting CP", "SC Braga"))
        self.assertFalse(_jogo.mesma_equipa("Sporting CP", "Sporting Clube de Braga"))

    def test_pedidos_invalidos(self):
        for args in [("", "A", "B", None), ("2026-10-09T19:15:00Z", "Braga/../x", "Sporting CP", None),
                     ("2026-10-09T19:15:00Z", "Braga", "Sporting?CP", None),
                     ("2026-10-09T19:15:00Z", "Braga", "Sporting CP", "af:1;drop")]:
            with self.assertRaises(ValueError):
                _jogo.validar_pedido(*args)
        _jogo.validar_pedido("2026-10-09T19:15:00Z", "SC Braga", "Sporting CP", "af:123")


if __name__ == "__main__":
    unittest.main()
