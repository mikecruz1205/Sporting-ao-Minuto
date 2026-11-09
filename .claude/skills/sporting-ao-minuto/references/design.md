# Design do Sporting ao Minuto

## Identidade (não mudar sem pedido)

- Tema escuro por omissão; claro em `document.documentElement.dataset.tema = 'claro'`.
- Cores em tokens em `css/base.css`: `--verde`, `--verde-claro`, `--sobre-verde`,
  `--texto`, `--texto-2`, `--texto-3`, `--cartao`, `--linha`, `--vermelho`,
  `--vermelho-cheio` (fundo de chips com texto branco), `--amarelo`, `--empate`.
  Usar sempre os tokens; uma cor nova vai para os dois temas.
- Tipografia: títulos em Barlow Condensed (maiúsculas), texto em Manrope,
  números em `var(--f-num)`. Fontes alojadas em `fontes/` (sem Google).
- Componentes que já existem e devem ser reaproveitados: `.chip`, `.pilula`,
  `.botao-cta`, `.botao-tentar`, `.cartao`, `.estado`, `.osso` (esqueleto de
  carregamento), `.so-leitor` (texto só para leitores de ecrã).

## Mínimos de qualidade (verificados com o script)

| Regra | Mínimo | Porquê |
|---|---|---|
| Contraste do texto | 4.5:1; 3:1 em texto ≥ 24 px ou ≥ 18,66 px negrito | WCAG AA; muita gente lê no telemóvel ao sol |
| Alvos de toque | ≥ 24 px (WCAG 2.2); 44 px nos botões principais e no telemóvel | dedos, não ratos |
| Largura | nada mais largo do que 375 px no telemóvel | deslizar para o lado parte a leitura |
| Texto | ≥ 12 px em texto corrido e em botões; rótulos em maiúsculas podem ir a 11 px | legibilidade |
| Nomes | todo o botão/ligação tem nome (texto, `aria-label` ou `title`); imagens com `alt` (`alt=""` se decorativas) | leitores de ecrã |
| Foco | `:focus-visible` com contorno visível | teclado |
| Movimento | `prefers-reduced-motion` respeitado | conforto |
| Ligações para fora | `target="_blank" rel="noopener"`; o site acrescenta o aviso "(abre num separador novo)" | já automático |

Armadilhas já encontradas:
- **Colisão de classes**: uma classe nova com um nome já usado noutro ficheiro
  herda tamanho e posição de outro componente (`.partilhar` em 2026-11-09).
  Procurar o nome antes de o usar.
- **Especificidade**: uma regra como `.ev--quente .ev__tipo` vence
  `.ev__tipo--oficial` e muda a cor do texto sem se ver no ficheiro onde se mexe.
  Ver as regras que aplicam ao elemento (o script de auditoria aponta o
  elemento; no browser, listar `document.styleSheets` que lhe correspondem).
- **Vermelho com texto branco**: `--vermelho` do tema escuro (#e05252) só dá
  3.8:1; usar `--vermelho-cheio`.

## Como auditar

1. Pré-visualização "sporting-hud"; tamanho telemóvel (`resize_window` preset
   mobile); passar o ecrã de boas-vindas ("Continuar como visitante").
2. Colar o conteúdo de `scripts/auditar_interface.js` no `javascript_tool`: define
   `window.__auditar()` (só a vista aberta) e `window.__auditarSite()` (todas as
   vistas, nos dois temas) e lança esta em segundo plano, porque demora ~90 s e o
   `javascript_tool` só espera 45 s. Ler o resultado depois com
   `window.__auditoria` (`null` = ainda a correr). Para uma volta curta:
   `await __auditarSite({ vistas: ['jogos'], temas: ['claro'] })`.
3. Ler o resumo: vistas com falhas de contraste, alvos pequenos, botões sem
   nome, imagens sem `alt`, largura > ecrã. Corrigir, subir `?v=`, recarregar e
   correr outra vez até ficar a zeros (o texto pequeno é informativo).
4. Repor o tamanho (`resize_window` preset desktop) no fim.
