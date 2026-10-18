"""Notícias agregadas no servidor (api/_noticias.py): leitura dos feeds,
filtro do Sporting, repetidos, ETag, 304 e compressão. Sem rede."""
import gzip
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api'))
import _noticias as N  # noqa: E402

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Jornal</title>
<item><title>Sporting vence em Alvalade e segue na luta pelo título</title><link>https://exemplo.pt/a</link>
  <pubDate>Sat, 17 Oct 2026 20:15:00 +0100</pubDate>
  <description><![CDATA[<p>O &eacute;xito do <b>Sporting</b> {TEAM_LINK|16|Sporting} na jornada.</p><img src="https://exemplo.pt/i.jpg">]]></description>
  <media:content url="https://exemplo.pt/m.jpg" medium="image"/></item>
<item><title>Sporting de Braga empata no Minho frente ao Gil Vicente</title><link>https://exemplo.pt/b</link>
  <pubDate>Sat, 17 Oct 2026 19:00:00 +0100</pubDate></item>
<item><title>Rafael Leão marca e o Milan ganha em casa</title><link>https://exemplo.pt/c</link>
  <pubDate>Sat, 17 Oct 2026 18:00:00 +0100</pubDate></item>
<item><title>Leões preparam a receção ao Moreirense</title><link>https://exemplo.pt/d</link>
  <pubDate>Sat, 17 Oct 2026 10:00:00 +0100</pubDate></item>
<item><title>Curto</title><link>https://exemplo.pt/e</link><pubDate>Sat, 17 Oct 2026 10:00:00 +0100</pubDate></item>
</channel></rss>"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title>Sporting anuncia renovação do capitão até 2029</title><link href="https://atom.pt/1"/>
  <updated>2026-10-17T12:00:00Z</updated><summary>Texto curto.</summary></entry>
</feed>"""

SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
<url><loc>https://abola.pt/x</loc><news:news><news:publication_date>2026-10-17T21:00:00+01:00</news:publication_date>
  <news:title>Sporting: as notas dos jogadores frente ao Moreirense</news:title></news:news></url>
</urlset>"""


class TestLerFeeds(unittest.TestCase):
    def test_rss(self):
        n = N.ler_feed(RSS, 'x', 'JORNAL X')
        titulos = [x['titulo'] for x in n]
        self.assertIn('Sporting vence em Alvalade e segue na luta pelo título', titulos)
        self.assertIn('Leões preparam a receção ao Moreirense', titulos)
        self.assertNotIn('Sporting de Braga empata no Minho frente ao Gil Vicente', titulos)    # outro Sporting
        self.assertNotIn('Rafael Leão marca e o Milan ganha em casa', titulos)                   # não é o leão
        self.assertEqual(len(n), 2)                                                               # o título curto fica de fora
        a = n[0]
        self.assertEqual(a['data'], '2026-10-17T19:15:00Z')                                      # para UTC
        self.assertEqual(a['imagem'], 'https://exemplo.pt/m.jpg')
        self.assertNotIn('<', a['resumo'])
        self.assertNotIn('TEAM_LINK', a['resumo'])
        self.assertIn('éxito', a['resumo'])
        self.assertLessEqual(len(a['resumo']), 180)

    def test_atom_e_sitemap(self):
        a = N.ler_feed(ATOM, 'a', 'ATOM')
        self.assertEqual(a[0]['link'], 'https://atom.pt/1')
        s = N.ler_feed(SITEMAP, 'abola', 'A BOLA')
        self.assertEqual(s[0]['link'], 'https://abola.pt/x')
        self.assertEqual(s[0]['data'], '2026-10-17T20:00:00Z')
        self.assertEqual(s[0]['resumo'], '')

    def test_xml_estragado_nao_rebenta(self):
        self.assertEqual(N.ler_feed('<rss><item><title>Sporting', 'x', 'X'), [])

    def test_iso_8859_1(self):
        corpo = '<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>Leões em Alvalade à noite</title><link>https://a.pt/1</link><pubDate>Sat, 17 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>'.encode('iso-8859-1')
        n = N.ler_feed(N.para_texto(corpo), 'x', 'X')
        self.assertEqual(n[0]['titulo'], 'Leões em Alvalade à noite')


class TestJuntar(unittest.TestCase):
    def test_repetidos_e_ordem(self):
        a = {'titulo': 'Sporting vence o Moreirense por 3-0', 'link': 'https://a/1', 'data': '2026-10-17T20:00:00Z', 'canal': 'a'}
        b = {'titulo': 'Sporting vence o Moreirense por 3-0!', 'link': 'https://b/1', 'data': '2026-10-17T20:05:00Z', 'canal': 'b'}
        c = {'titulo': 'Outra notícia do Sporting sobre o mercado', 'link': 'https://a/1', 'data': '2026-10-17T21:00:00Z', 'canal': 'c'}
        d = {'titulo': 'Leões treinam em Alcochete antes da Taça', 'link': 'https://d/1', 'data': '2026-10-17T22:00:00Z', 'canal': 'd'}
        r = N.juntar([[a, c], [b, d]])
        self.assertEqual([x['link'] for x in r], ['https://d/1', 'https://a/1'])
        self.assertEqual(r[1]['canal'], 'a')                                   # fica a primeira a chegar


class TestResposta(unittest.TestCase):
    def setUp(self):
        self.corpo = json.dumps({'noticias': [{'titulo': 'Sporting'}]}).encode()
        self.recolher = lambda: (self.corpo, '"abc"')

    def test_gzip_etag_e_cache(self):
        codigo, cab, corpo = N.resposta({'Accept-Encoding': 'gzip, br'}, self.recolher)
        self.assertEqual(codigo, 200)
        self.assertEqual(cab['Content-Encoding'], 'gzip')
        self.assertEqual(gzip.decompress(corpo), self.corpo)
        self.assertEqual(cab['ETag'], '"abc"')
        self.assertIn('s-maxage=60', cab['Cache-Control'])

    def test_304_quando_nada_mudou(self):
        codigo, cab, corpo = N.resposta({'If-None-Match': '"abc"'}, self.recolher)
        self.assertEqual(codigo, 304)
        self.assertEqual(corpo, b'')

    def test_sem_gzip(self):
        codigo, cab, corpo = N.resposta({}, self.recolher)
        self.assertEqual(corpo, self.corpo)
        self.assertNotIn('Content-Encoding', cab)


if __name__ == '__main__':
    unittest.main()
