# Museu do Sporting, Fantasy e quadro tático (10 de outubro de 2026)

## Erros encontrados e corrigidos

| Onde | Erro | Correção |
|---|---|---|
| Palmarés (`js/data.js`) | Dizia **11 Supertaças** e **5 Taças da Liga**. A Wikipédia em português e em inglês dão **9** e **4** | Números corrigidos; o palmarés passou a `PALMARES`, época a época, com fonte e data de verificação |
| Campeões no plantel | Lista escrita à mão com erros: Vagiannidis (chegou em 2025) aparecia com "Campeonato · Taça"; João Virgínia com "2 Campeonatos · Taça" (tem só a Taça da Liga 2021/22); Inácio, Quaresma, Nuno Santos e outros com títulos a menos | Títulos de cada jogador verificados na secção de palmarés da Wikipédia. Vagiannidis sai; Debast e Felicíssimo entram (2024/25) |
| Campeões / quadro tático | Se a Wikipédia falhasse, o plantel nunca chegava e ficava "a carregar" para sempre | Recurso: o retrato do zerozero (`dados/plantel_zz.json`). Sem nenhum dos dois aparece "Não foi possível carregar o plantel" |
| Campeões vazio | A mensagem de vazio era para programadores ("edita CLUBE.campeoes em js/data.js") | Mensagem para adeptos e esqueleto enquanto carrega |
| Fantasy | Comprar um jogador que já estava na equipa duplicava-o | `podeEntrar()` recusa ("Já está na tua equipa") |
| Fantasy | A equipa montada sem sessão perdia-se ao entrar na conta | O rascunho de visitante passa para a conta (com aviso e "Desfazer") |
| Fantasy | Ao sair ou mudar de conta, os dados, as ligas e a gestão da conta anterior podiam continuar à vista | `carregar()` limpa tudo quando a conta muda |
| Fantasy | Rascunhos estragados (repetidos, jogadores que já não existem) eram aceites | São ignorados |
| Fantasy | O capitão ou o vice que iam para o banco perdiam a braçadeira sem aviso | Aviso: "X foi para o banco e deixou de ser capitão" |
| Fantasy | Titulares eram anunciados como "suplente N" aos leitores de ecrã (`ids.map(slot)` passava o índice) | Corrigido |
| Fantasy | Erros técnicos do servidor apareciam em inglês; um erro de rede deixava "A guardar…" preso | Mensagens em português; o botão nunca fica preso |
| Quadro tático | Campo gigante (classe `campo` renomeada por engano) | Classe reposta; campo pequeno ao estilo de jogo, sem ratings |
| Quadro tático | Contador "11/11" com posições vazias; Preencher punha jogadores fora de posição; regras de substituições da Fantasy antiga bloqueavam o onze ideal | Posições compatíveis, contador real, regras antigas retiradas |
| Consola | 503 repetidos do football-data (sem chave) e da carreira dos jogadores (API-Football sem chave) | Ao primeiro 503 desiste durante 30 minutos na sessão; a carreira diz que a fonte não responde |

## Museu do Sporting CP (`js/museu.js`, `css/museu.css`)

- **Entrada**: fotografia das taças dos Campeonatos de 1943/44 a 1950/51 no Museu Sporting —
  [Threeohsix, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Trof%C3%A9us_do_tricampeonato_do_Sporting_de_1947_a_1949_no_Museu_Sporting.jpg),
  CC BY-SA 4.0, reduzida e convertida para WebP (`img/museu/`). O crédito aparece na própria entrada.
- **Números**: 21 Campeonatos, 18 Taças de Portugal, 9 Supertaças, 4 Taças da Liga, 1 Taça das Taças;
  57 títulos nacionais e europeus (inclui os 4 Campeonatos de Portugal, 1922–1938).
- **Sala dos troféus**: uma vitrine por competição (número, em disputa/extinta/europeia, primeira e última).
  Abre a lista de épocas; cada época abre a ficha.
- **Outras conquistas e regionais** (só na Wikipédia em português): Taça Império, Intertoto, Taça Ibérica,
  Campeonato de Lisboa e Taça de Honra. Mostram-se à parte e não entram no total.
- **Linha do tempo**: por décadas, com filtros (competição, extintas, regionais, década) e pesquisa
  (um ano como "1974" encontra as épocas que passam por ele; "dobradinha" encontra Campeonato + Taça).
- **Ficha**: n.º da conquista, anterior e seguinte, o que mais se ganhou na mesma época, dobradinha e
  ligação ao artigo da Wikipédia dessa época (os 51 artigos ligados foram confirmados). Treinadores e
  plantéis não aparecem: ainda não há fonte verificada para todas as conquistas.
- Acessível por teclado (a ficha é um `<dialog>` e o foco volta ao botão de origem), tema claro e escuro,
  telemóvel, e sem animações com "reduzir movimento".

### Atualizar o palmarés

Quando o Sporting ganhar um troféu: acrescentar a época em `PALMARES.competicoes[...].epocas`
(`js/data.js`), com o título do artigo da Wikipédia em português (ou `null`), mudar `verificado`, e
acrescentar o título aos jogadores em `CLUBE.campeoes`. Os testes (`tests/museu.test.js`) verificam os
totais, o formato das épocas e que cada título de cada jogador existe no palmarés do clube — atualizar
lá os números esperados.

## Fantasy: o que mudou na interface

- Campo com as duas grandes áreas e largura limitada (deixou de esticar a 980 px).
- Cada jogador mostra a posição pela cor (GR, DEF, MED, AVA), o preço e os pontos quando existem; legenda por baixo do campo.
- Animação curta para quem entra no onze ou troca (desligada com "reduzir movimento").
- As regras do jogo não mudaram: continuam no servidor (`fantasy_guardar_equipa`).

## Testes

- `python -m unittest discover -s tests` — 45 testes (inclui os de JavaScript através de `tests/test_javascript.py`).
- `node --test tests/` — 15 testes de JavaScript:
  - `tests/fantasy_logica.test.js` (9): compra de 15, limites de posição e orçamento, capitão e vice, trocas,
    braçadeira, rascunho do visitante, rascunho estragado, mudança de conta, mensagens de erro.
  - `tests/museu.test.js` (6): números do palmarés, formato e ordem das épocas, dobradinhas, filtros e pesquisa,
    "na mesma época", títulos dos jogadores contra o palmarés do clube.
- No browser: quadro tático e Fantasy (computador e telemóvel), museu (filtros, ficha, teclado, tema claro),
  todas as vistas sem erros de JavaScript nem conteúdo fora do ecrã a 390 px, e o recurso do plantel com a
  Wikipédia em baixo (com e sem o retrato do zerozero).
