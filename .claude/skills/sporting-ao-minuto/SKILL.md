---
name: sporting-ao-minuto
description: Regras, processos e verificações do site Sporting ao Minuto (repositório sporting-hud — SPA em JavaScript simples, funções Python na Vercel, Supabase). Usa esta skill SEMPRE que trabalhares neste projeto, mesmo que o pedido pareça pequeno — mudar uma vista, corrigir um bug, mexer no CSS, na Fantasy, no quiz, nas notícias, nos jogos, publicar ("faz o push"), atualizar dados ("o site está desatualizado"), criar migrações no Supabase ou rever o design. Diz o que nunca se faz (inventar dados, chaves no repositório), como se testa, como se faz commit e como se mantêm os dados em dia.
---

# Sporting ao Minuto

Site de adeptos do Sporting CP (não oficial), em `C:\Users\user\sporting-hud`.
Publicado em https://sporting-fan-ao-minuto.vercel.app (Vercel, a partir do
ramo `main` do GitHub `mikecruz1205/Sporting-ao-Minuto`). Base de dados:
Supabase `wuayudgmkbiipwucblvi`. Tudo o que o utilizador lê está em português
de Portugal, e as mensagens de commit também.

## Como o código está organizado

- `index.html` — todas as vistas (`<main class="vista" id="vista-…">`); os
  ficheiros CSS/JS levam `?v=NN`.
- `js/app.js` — o motor, todo dentro de uma função anónima (nada fica em
  `window` a não ser o que se expõe de propósito, como `DadosSite` ou
  `irParaVista`). Módulos carregados só quando a vista abre: `MODULOS` /
  `carregarModulo` (fantasy, quiz, museu, arquivo, prognósticos).
- `js/*.js` — componentes, notícias agrupadas (`historias.js`), contas
  (`nuvem.js`, supabase-js só quando é preciso), Fantasy, quiz, etc.
- `css/*.css` — tokens em `css/base.css` (tema escuro por omissão, claro em
  `[data-tema="claro"]`).
- `api/*.py` — funções da Vercel; a lógica pura fica em `api/_nome.py` (testável
  sem rede) e o `api/nome.py` só recebe o pedido. `servidor.py` reproduz-as no
  local (porta 8123, configuração de pré-visualização "sporting-hud").
- `supabase/migrations/` e `supabase/testes/` — SQL e os testes de cada migração.
- `docs/` — decisões e processos (dados, Fantasy, notificações, relatórios).

## O que nunca se faz, e porquê

- **Inventar dados.** Cada número, resultado, data ou nome vem de uma fonte e
  diz qual. Sem fonte, mostra-se "sem dados" (null, nunca 0). Se os dados
  estiverem atrasados, a frase diz de quando são ("dados de 08/11"). É um site
  de adeptos que vive da confiança: um resultado inventado é pior do que um
  vazio.
- **Chaves ou segredos no repositório ou no browser.** Ficam nas variáveis da
  Vercel ou no cofre (vault) do Supabase. A chave publicável do Supabase pode
  estar no browser; a de serviço nunca. Não se repetem valores de segredos nas
  respostas ao utilizador.
- **Serviços pagos, termos por ler, contornar bloqueios anti-robô.** Pede-se
  primeiro ao utilizador.
- **Criar contas ou entrar com credenciais no Supabase real para testar.** Os
  fluxos de conta testam-se em SQL dentro de uma transação desfeita (ver abaixo).
- **Tocar na pasta `.github` sem autorização.**

## Fluxo de cada alteração

1. **Ler antes de mexer.** Ver como a vista/função já funciona (procurar com
   grep pelo id ou classe) — o projeto tem muitas peças que se tocam.
2. **Classes CSS novas com nome próprio.** Antes de criar uma classe, procurar
   se o nome já existe em `css/` (`grep -n "^\.nome"`): já aconteceu `.partilhar`
   colidir com o botão redondo da página inicial e partir o telemóvel.
3. **Mudou CSS ou JS → subir a versão** em `index.html`
   (`sed -i 's/?v=NN/?v=NN+1/g' index.html`); senão o service worker e a CDN
   servem a versão antiga.
4. **Testes**, todos a passar antes do commit:
   - `python -m unittest discover -s tests` (corre também os de JavaScript);
   - `node --test tests/` quando mexeste em JS;
   - `node --check js/ficheiro.js` depois de editar JS.
   Lógica nova leva teste novo (`tests/test_*.py` para Python, `tests/*.test.js`
   com `node:test` e `vm` para JS).
5. **Ver no browser** quando a mudança se vê: pré-visualização "sporting-hud"
   (servidor local na porta 8123). Ao abrir pela primeira vez aparece o ecrã de
   boas-vindas: carregar em "Continuar como visitante". Ver também a 375 px de
   largura e nos dois temas (ver `references/design.md`).
6. **Commit no fim de cada tarefa, sem perguntar**, em português, a explicar o
   quê e porquê, a terminar com a linha de coautoria. **Push só quando o
   utilizador pede** ("faz o push", "publica", "atualiza o site").
7. Depois do push, confirmar que a Vercel publicou (a página serve o `?v=` novo)
   e ver a consola sem erros.

## Supabase

- Cada migração nova vai para `supabase/migrations/AAAAMMDDHHMMSS_nome.sql` com
  um cabeçalho que explica o porquê, e tem um teste em
  `supabase/testes/nome_testes.sql`: um bloco `do $$ … $$` que acaba em
  `raise exception 'RELATORIO passos=% falhas=% %'` — a exceção desfaz tudo.
  Enquanto a migração não está aplicada, corre-se o SQL da migração e o teste no
  mesmo pedido (`execute_sql`): a exceção desfaz as duas coisas. Esperado:
  `falhas=0`.
- Aplicar com `apply_migration` só quando o site publicado não depende do
  contrário (uma função nova que o código antigo não chama pode ir já; uma que
  muda o que o código publicado usa vai junto com o push).
- Funções que escrevem são `security definer` com `set search_path`, validam
  tudo e devolvem só o necessário; tabelas com RLS e `revoke` explícito.
- Se o site "está em baixo" e o domínio do Supabase não resolve: o projeto
  gratuito foi suspenso — `get_project` e `restore_project`.

## Dados (resumo — detalhe em `references/dados.md`)

- **Resultados e calendário da Liga e da Champions: automáticos**, duas vezes
  por dia (cron da Vercel → `/api/sincronizar` → football-data → função
  `desporto_sincronizar_fd`). Ver as execuções em `desporto_sincronizacoes`.
- **Taças, estatísticas da época por jogador e plantel: à mão**, pela exportação
  da Wikipédia que o próprio site faz. O utilizador pediu para a automação não
  usar a Wikipédia; a importação manual continua a ser o caminho para o que a
  football-data gratuita não tem.
- Quando o utilizador diz que o site está desatualizado, ver primeiro
  `desporto_sincronizacoes` e `max(atualizado_em)` das estatísticas.

## Design (resumo — detalhe e script de auditoria em `references/design.md`)

Identidade: escuro com verde do Sporting, títulos em Barlow Condensed, texto em
Manrope (alojadas no próprio site). Mínimos verificados em cada mudança visível:
contraste 4.5:1 (3:1 em texto grande), alvos de toque ≥ 24 px (44 px nos
principais), nada mais largo do que o ecrã a 375 px, rótulos em todos os
botões só com ícone, `focus-visible` visível, respeito por
`prefers-reduced-motion`. Correr `scripts/auditar_interface.js` antes de dar uma
mudança de interface por terminada.
