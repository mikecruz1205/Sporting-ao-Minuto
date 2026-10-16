"""Valida o banco de perguntas do Quiz Leonino (dados/quiz.json).

Cada pergunta tem de ter:
  - id único e o texto da pergunta;
  - exatamente 4 opções, todas preenchidas e diferentes entre si;
  - "correta" = o índice (0 a 3) da única opção certa;
  - dificuldade (facil, media, dificil) e categoria conhecidas;
  - fonte com nome e ligação https (de onde o facto foi tirado);
  - explicação (aparece depois de responder e no Desafio do Dia).
E o banco tem de chegar para um jogo: 5 perguntas de cada dificuldade
mais pelo menos uma de reserva (para a ajuda "trocar pergunta").

Isto verifica a forma, não a verdade dos factos: essa vem da fonte
indicada em cada pergunta, que tem de ser lida antes de a acrescentar.

Uso:  python scripts/validar_quiz.py [caminho]
Sai com código 1 e a lista de problemas se algo falhar.
"""
import json
import sys
from pathlib import Path

DIFICULDADES = {'facil', 'media', 'dificil'}
CATEGORIAS = {'historia', 'titulos', 'jogadores', 'estadio', 'modalidades', 'presidentes'}
POR_JOGO = 5


def validar(dados):
    problemas = []
    perguntas = dados.get('perguntas') if isinstance(dados, dict) else None
    if not isinstance(perguntas, list) or not perguntas:
        return ['o ficheiro não tem a lista "perguntas"']
    ids = set()
    for n, p in enumerate(perguntas, 1):
        quem = f"pergunta {n} ({p.get('id', 'sem id')})"
        if not p.get('id'):
            problemas.append(f'{quem}: falta o id')
        elif p['id'] in ids:
            problemas.append(f'{quem}: id repetido')
        ids.add(p.get('id'))
        if not str(p.get('pergunta', '')).strip():
            problemas.append(f'{quem}: falta o texto da pergunta')
        opcoes = p.get('opcoes')
        if not isinstance(opcoes, list) or len(opcoes) != 4:
            problemas.append(f'{quem}: tem de ter exatamente 4 opções')
        else:
            textos = [str(o).strip() for o in opcoes]
            if any(not t for t in textos):
                problemas.append(f'{quem}: há uma opção vazia')
            if len({t.lower() for t in textos}) != 4:
                problemas.append(f'{quem}: há opções repetidas')
        correta = p.get('correta')
        if not isinstance(correta, int) or isinstance(correta, bool) or not 0 <= correta <= 3:
            problemas.append(f'{quem}: "correta" tem de ser o índice 0, 1, 2 ou 3 da única opção certa')
        if p.get('dificuldade') not in DIFICULDADES:
            problemas.append(f'{quem}: dificuldade desconhecida ({p.get("dificuldade")})')
        if p.get('categoria') not in CATEGORIAS:
            problemas.append(f'{quem}: categoria desconhecida ({p.get("categoria")})')
        fonte = p.get('fonte') or {}
        if not str(fonte.get('nome', '')).strip():
            problemas.append(f'{quem}: falta o nome da fonte')
        if not str(fonte.get('url', '')).startswith('https://'):
            problemas.append(f'{quem}: a fonte tem de ter uma ligação https')
        if not str(p.get('explicacao', '')).strip():
            problemas.append(f'{quem}: falta a explicação')
    for d in sorted(DIFICULDADES):
        n = sum(1 for p in perguntas if p.get('dificuldade') == d)
        if n < POR_JOGO + 1:
            problemas.append(f'só há {n} perguntas "{d}": são precisas pelo menos {POR_JOGO + 1} (5 por jogo e 1 de reserva)')
    return problemas


def main():
    caminho = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / 'dados' / 'quiz.json'
    with open(caminho, encoding='utf-8') as f:
        dados = json.load(f)
    problemas = validar(dados)
    if problemas:
        print(f'{len(problemas)} problema(s) em {caminho}:')
        for p in problemas:
            print('  -', p)
        sys.exit(1)
    n = len(dados['perguntas'])
    print(f'{caminho}: {n} perguntas válidas')


if __name__ == '__main__':
    main()
