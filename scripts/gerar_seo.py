"""
Gera o sitemap.xml e acerta o robots.txt para o domínio onde o site está.

    python scripts/gerar_seo.py --dominio https://oteudominio.pt

O sitemap só pode ter endereços absolutos, e o domínio de produção não
está escrito em lado nenhum do código — por isso é um passo à parte, que
se corre uma vez (e de novo se o domínio mudar).
"""
import argparse, datetime, os, re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# as mesmas vistas de ROTAS no js/app.js; prioridade e frequência de mudança
ROTAS = [
    ('/',              '1.0', 'always'),
    ('/noticias',      '0.9', 'always'),
    ('/ao-minuto',     '0.9', 'always'),
    ('/jogos',         '0.8', 'daily'),
    ('/agenda',        '0.8', 'daily'),
    ('/classificacao', '0.8', 'daily'),
    ('/mercado',       '0.7', 'hourly'),
    ('/modalidades',   '0.7', 'daily'),
    ('/plantel',       '0.6', 'weekly'),
    ('/estatisticas',  '0.6', 'daily'),
    ('/clube',         '0.4', 'monthly'),
    ('/privacidade',   '0.2', 'yearly'),
    ('/termos',        '0.2', 'yearly'),
]


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--dominio', required=True, help='por exemplo https://oteudominio.pt')
    base = a.parse_args().dominio.rstrip('/')
    if not re.match(r'^https://[a-z0-9.-]+$', base):
        raise SystemExit('usa https://dominio, sem caminho')
    if 'mgira.pt' in base:
        raise SystemExit('app.mgira.pt é o domínio da aplicação mGira, não deste site.')

    hoje = datetime.date.today().isoformat()
    linhas = ['<?xml version="1.0" encoding="UTF-8"?>',
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for caminho, prio, freq in ROTAS:
        linhas += ['  <url>', f'    <loc>{base}{caminho}</loc>', f'    <lastmod>{hoje}</lastmod>',
                   f'    <changefreq>{freq}</changefreq>', f'    <priority>{prio}</priority>', '  </url>']
    linhas.append('</urlset>')
    open(os.path.join(RAIZ, 'sitemap.xml'), 'w', encoding='utf-8').write('\n'.join(linhas) + '\n')

    robots = os.path.join(RAIZ, 'robots.txt')
    texto = open(robots, encoding='utf-8').read()
    texto = re.sub(r'(?m)^Sitemap:.*\n?', '', texto).rstrip() + f'\n\nSitemap: {base}/sitemap.xml\n'
    open(robots, 'w', encoding='utf-8').write(texto)
    # as redes sociais só aceitam endereços absolutos na imagem de partilha
    pagina = os.path.join(RAIZ, 'index.html')
    html = open(pagina, encoding='utf-8').read()
    html = re.sub(r'content="(?:https://[^"/]+)?/img/partilha\.jpg"', f'content="{base}/img/partilha.jpg"', html)
    html = re.sub(r'(<link rel="canonical" id="canonico" href=")[^"]*(")', rf'\g<1>{base}/\g<2>', html)
    html = re.sub(r'(<meta property="og:url" id="og-url" content=")[^"]*(")', rf'\g<1>{base}/\g<2>', html)
    open(pagina, 'w', encoding='utf-8').write(html)

    print('sitemap.xml, robots.txt e as meta de partilha do index.html prontos para', base)


if __name__ == '__main__':
    main()
