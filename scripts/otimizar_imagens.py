"""
Otimiza os emblemas das equipas (img/teams/*.png) no próprio sítio.

Vêm da API a 150x150 em PNG de 24 bits — uns 70 KB cada, 6 MB no total —
e o site mostra-os a 22–76 px. Reduzidos a 128 px com paleta de 256 cores
(com transparência) ficam com uma fração do peso e o mesmo aspeto.

Os nomes e caminhos não mudam, por isso nada no site precisa de saber.
Corre-se sozinho no fim do atualizar_emblemas.py; também se pode correr à mão:
    python scripts/otimizar_imagens.py
"""
import glob, os
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def otimizar(caminho, lado=128):
    antes = os.path.getsize(caminho)
    im = Image.open(caminho).convert('RGBA')
    if max(im.size) > lado:
        im.thumbnail((lado, lado), Image.LANCZOS)
    reduzida = im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    tmp = caminho + '.tmp'
    reduzida.save(tmp, 'PNG', optimize=True)
    depois = os.path.getsize(tmp)
    if depois < antes:
        os.replace(tmp, caminho)
        return antes, depois
    os.remove(tmp)
    return antes, antes


def main():
    total_antes = total_depois = 0
    for f in sorted(glob.glob(os.path.join(RAIZ, 'img', 'teams', '*.png'))):
        a, d = otimizar(f)
        total_antes += a; total_depois += d
    print('emblemas: %.1f MB -> %.1f MB' % (total_antes / 1e6, total_depois / 1e6))


if __name__ == '__main__':
    main()
