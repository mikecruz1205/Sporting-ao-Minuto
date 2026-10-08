"""
Gera os ficheiros da marca a partir do emblema (img/crest.svg).

O crest.svg é, na verdade, um PNG de 1536x1024 embrulhado num SVG — pesa
1,6 MB e era carregado no favicon, no cabeçalho e nas capas. Este script
tira de lá a imagem uma vez e produz versões do tamanho certo:

  img/marca/emblema-{64,128,256,512}.webp   emblema sem o texto em arco
  img/marca/emblema-512.png                 reserva para browsers antigos
  img/icones/icone-{48..512}.png            ícones da aplicação (PWA)
  img/icones/maskable-{192,512}.png         ícones com margem de segurança
  img/icones/apple-touch-icon.png           180x180 para iPhone/iPad
  img/icones/favicon-32.png / favicon.ico
  img/arranque/*.jpg                        ecrãs de arranque do iOS
  img/partilha.jpg                          1200x630 para redes sociais

Correr de novo sempre que o emblema mudar:
    python scripts/gerar_marca.py
"""
import base64, io, os, re
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def caminho(*p): return os.path.join(RAIZ, *p)

FUNDO = (10, 12, 11)          # --carvao
LISTA_1 = (11, 37, 25)        # --lista-1
LISTA_2 = (15, 49, 33)        # --lista-2


def ler_emblema():
    svg = open(caminho('img', 'crest.svg'), encoding='utf-8').read()
    dados = re.search(r'base64,([^"]+)', svg).group(1)
    im = Image.open(io.BytesIO(base64.b64decode(dados))).convert('RGBA')

    # apaga o texto em arco ("Sporting ao Minuto") por baixo do escudo,
    # mantendo a ponta do escudo
    mascara = Image.new('L', im.size, 255)
    d = ImageDraw.Draw(mascara)
    d.rectangle((0, 770, im.width, im.height), fill=0)
    d.polygon([(560, 770), (960, 770), (900, 800), (780, 836), (620, 800)], fill=255)
    im.putalpha(Image.composite(im.split()[3], Image.new('L', im.size, 0), mascara))

    caixa = im.split()[3].point(lambda v: 255 if v > 20 else 0).getbbox()
    return im.crop(caixa)


def quadrado(emblema, lado, margem, fundo=None, listas=False):
    """emblema centrado num quadrado; margem = fração livre de cada lado"""
    tela = Image.new('RGBA', (lado, lado), fundo + (255,) if fundo else (0, 0, 0, 0))
    if listas:
        d = ImageDraw.Draw(tela)
        faixa = max(2, lado // 16)
        for y in range(0, lado, faixa * 2):
            d.rectangle((0, y + faixa, lado, y + faixa * 2), fill=LISTA_2 + (255,))
        # escurece as listas para o emblema sobressair
        veu = Image.new('RGBA', (lado, lado), FUNDO + (150,))
        tela.alpha_composite(veu)
    util = int(lado * (1 - 2 * margem))
    escala = min(util / emblema.width, util / emblema.height)
    e = emblema.resize((max(1, int(emblema.width * escala)), max(1, int(emblema.height * escala))), Image.LANCZOS)
    tela.alpha_composite(e, ((lado - e.width) // 2, (lado - e.height) // 2))
    return tela


def guardar(im, *p, **kw):
    destino = caminho(*p)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    im.save(destino, **kw)
    return destino


def main():
    emblema = ler_emblema()

    # ---- emblema solto (cabeçalho, capas, ecrã de entrada) ----
    for lado in (64, 128, 256, 512):
        guardar(quadrado(emblema, lado, 0.02), 'img', 'marca', f'emblema-{lado}.webp', quality=88, method=6)
    guardar(quadrado(emblema, 512, 0.02).quantize(256, method=Image.Quantize.FASTOCTREE), 'img', 'marca', 'emblema-512.png', optimize=True)

    # ---- ícones da aplicação: fundo carvão com listas apagadas ----
    for lado in (48, 72, 96, 128, 144, 152, 192, 256, 384, 512):
        guardar(quadrado(emblema, lado, 0.1, FUNDO, listas=True).convert('RGB'),
                'img', 'icones', f'icone-{lado}.png', optimize=True)
    # maskable: o Android pode cortar em círculo — o emblema fica nos 60% do meio
    for lado in (192, 512):
        guardar(quadrado(emblema, lado, 0.2, FUNDO, listas=True).convert('RGB'),
                'img', 'icones', f'maskable-{lado}.png', optimize=True)
    guardar(quadrado(emblema, 180, 0.1, FUNDO, listas=True).convert('RGB'),
            'img', 'icones', 'apple-touch-icon.png', optimize=True)
    guardar(quadrado(emblema, 32, 0.0), 'img', 'icones', 'favicon-32.png', optimize=True)
    quadrado(emblema, 48, 0.0).save(caminho('favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])

    # ---- ecrãs de arranque do iOS (o Android gera-os do manifest) ----
    ecras = {
        'iphone-se':        (750, 1334),
        'iphone-x':         (1125, 2436),
        'iphone-14':        (1170, 2532),
        'iphone-15':        (1179, 2556),
        'iphone-15-max':    (1290, 2796),
        'ipad':             (1620, 2160),
        'ipad-pro-11':      (1668, 2388),
        'ipad-pro-129':     (2048, 2732),
    }
    for nome, (w, h) in ecras.items():
        tela = Image.new('RGB', (w, h), FUNDO)
        lado = int(min(w, h) * 0.36)
        e = quadrado(emblema, lado, 0.0)
        tela.paste(e, ((w - lado) // 2, int(h * 0.42) - lado // 2), e)
        guardar(tela, 'img', 'arranque', f'{nome}.jpg', quality=82, optimize=True, progressive=True)

    # ---- imagem de partilha 1200x630 ----
    w, h = 1200, 630
    tela = Image.new('RGB', (w, h), FUNDO)
    d = ImageDraw.Draw(tela)
    for y in range(0, h, 56):
        d.rectangle((0, y + 28, w, y + 56), fill=LISTA_1)
    brilho = Image.new('L', (w, h), 0)
    ImageDraw.Draw(brilho).ellipse((-300, -200, 700, 800), fill=120)
    brilho = brilho.filter(ImageFilter.GaussianBlur(120))
    tela = Image.composite(Image.new('RGB', (w, h), (10, 157, 95)), tela, brilho.point(lambda v: v // 3))
    veu = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(veu).rectangle((560, 0, w, h), fill=FUNDO + (210,))
    tela = Image.alpha_composite(tela.convert('RGBA'), veu)
    e = quadrado(emblema, 470, 0.0)
    tela.alpha_composite(e, (60, (h - 470) // 2))
    d = ImageDraw.Draw(tela)

    def fonte(tam, negrito=True):
        for nome in (['arialbd.ttf', 'Arial Bold.ttf'] if negrito else ['arial.ttf', 'Arial.ttf']):
            try: return ImageFont.truetype(nome, tam)
            except OSError: pass
        return ImageFont.load_default()

    d.text((610, 200), 'SPORTING', font=fonte(76), fill=(242, 245, 243))
    d.text((610, 282), 'AO MINUTO', font=fonte(76), fill=(47, 217, 138))
    d.text((612, 386), 'Notícias, jogos, resultados e', font=fonte(30, False), fill=(169, 181, 175))
    d.text((612, 426), 'o ao minuto do Sporting CP', font=fonte(30, False), fill=(169, 181, 175))
    guardar(tela.convert('RGB'), 'img', 'partilha.jpg', quality=86, optimize=True, progressive=True)

    print('marca gerada a partir de img/crest.svg')


if __name__ == '__main__':
    main()
