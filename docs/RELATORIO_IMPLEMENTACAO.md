# Relatório de implementação — melhorias e inovações

Os 15 tópicos de `docs/RELATORIO_INOVACAO.md`, por ordem, com um commit cada
um. Há também um pedido a meio: a Fantasy por lugares.

**Testes no fim:**

- `node --test tests/`: 47 a passar, 0 falhas.
- `python -m unittest discover -s tests`: 73 a passar (inclui os de JavaScript).
- Os testes SQL correm numa transação desfeita no fim, por isso não deixam
  nada na base de dados. Cada ficheiro em `supabase/testes/` acaba em
  `RELATORIO ... falhas=0`.

**Migrações aplicadas no Supabase:** `chat_carimbar_autor_fechado`,
`prognosticos_homem_do_jogo`, `fantasy_lugares` e `quiz_semanal`.

**Escrita mas não aplicada:** `notificacoes_push`, que fica à espera das
chaves VAPID.

---

## Mudar

### 1. Notícias agregadas no servidor — `68c8f61`
- **Ficheiros:**
  - `api/_noticias.py` e `api/noticias.py`
  - `servidor.py`, `vercel.json`
  - `js/app.js`
  - `tests/test_noticias.py`
- **O que muda:** um só pedido, `/api/noticias`, com os 12 jornais juntos e
  filtrados, com ETag (responde 304 sem nada de novo), gzip e cache na CDN.
- **Como testar:** abrir `/api/noticias` e repetir o pedido com
  `If-None-Match`, que deve dar 304. No site, as notícias aparecem com um
  único pedido na aba Rede.

### 2. Fantasy com pontos — `6d9e967`
- **Ficheiros:**
  - `js/fantasy.js`, `css/fantasy.css`
  - `docs/FANTASY_GESTAO.md`
- **O que muda:** o separador "Gestão" (só para administradores) tem as
  jornadas em atraso, um relatório colado com as estatísticas e os golos
  tirados do calendário. Também calcula de uma vez as jornadas que já têm
  estatísticas.
- **Como testar:** ficar administrador com o SQL em
  `docs/FANTASY_GESTAO.md` e abrir `/fantasy` → Gestão.

### 3. Cada página carrega só o que usa — `01811b3`
- **Ficheiros:** `js/app.js`, `js/nuvem.js`, `js/entrada.js`, `index.html`.
- **O que muda:** a Fantasy, o Quiz, o Museu, o Arquivo e os Prognósticos
  só carregam quando se abre a vista respetiva. O supabase-js só carrega
  quando é preciso (sessão guardada, entrar, Fantasy, chat).
- **Como testar:** na aba Rede, a página inicial sem sessão não pede
  `supabase.js` nem `fantasy.js`.

### 4. Privacidade — `3142d7f`
- **Ficheiros:** `fontes/`, `css/fontes.css`, `vendor/supabase-js-2.47.10/`.
- **O que muda:** os pedidos a Google Fonts e ao jsDelivr deixaram de
  existir. Os pedidos para fora que restam são as imagens dos jornais e a
  Wikipédia.
- **Como testar:** na aba Rede não aparece `fonts.googleapis.com` nem
  `jsdelivr`.

### 5. Acessibilidade — `0f7c0a8`
- **Ficheiros:** `index.html`, `js/app.js`.
- **O que muda:** há um `h1` por vista, foram acrescentados os rótulos em
  falta, e os links para fora dizem "(abre num separador novo)" ao leitor
  de ecrã.
- **Como testar:** com um leitor de ecrã, ou com o painel de
  acessibilidade do browser.

### 6. Segurança — `dcb2c41`
- **O que muda:** `chat_carimbar_autor` deixou de poder ser chamada pela
  API.
- **Testes:** `supabase/testes/contas_testes.sql`.

### 7. Carreira escondida sem fonte — `2400dc6`
- **O que muda:** o bloco da carreira só aparece se a API-Football estiver
  ligada (`/api/api?estado=1`).
- **Testes:** `tests/test_api_estado.py`.

## Inovar

### 8. Prognósticos e Homem do jogo — `26e8e92`
- **Ficheiros:** `js/prognosticos.js` e a migração respetiva.
- **O que muda:** prognóstico do resultado até ao início do jogo, voto no
  Homem do jogo até 3 dias depois, e classificação nas ligas privadas.
- **Testes:**
  - `tests/prognosticos.test.js`
  - `supabase/testes/prognosticos_testes.sql` (7 passos, 0 falhas)
- **Como testar:** com conta, no bloco "Jogar e conversar" da página
  inicial ou no Centro de jogo.

### 9. Calendário `.ics` — `c70c694`
- **O que muda:** `/calendario.ics`, com os jogos de futebol da equipa
  principal. Na Agenda há botões para subscrever (iPhone/Outlook) e para o
  Google Calendar.
- **Testes:** `tests/test_calendario.py`.
- **Como testar:** abrir `/calendario.ics`, ou subscrever a partir da
  Agenda.

### 10. Notícias por história, selo "Oficial" e rumores por jogador — `8ca447d`
- **Ficheiros:** `js/historias.js`.
- **O que muda:**
  - um cartão por história, com "Esta história está em N jornais";
  - o selo "Oficial" quando o título do jornal o diz;
  - em Mercado, "Rumores por jogador" com a linha do tempo de cada um.
- **Testes:** `tests/historias.test.js`.
- **Limitação:** o sporting.pt não tem RSS, por isso o selo vem dos títulos
  dos jornais.

### 11. Notificações push — `fba3582` (por ligar)
- **O que está feito:**
  - a decisão de que avisos enviar (`supabase/functions/notificar/decidir.mjs`);
  - o envio (`index.ts`);
  - a migração e o cartão "Avisos no telemóvel" na Agenda, que fica
    escondido sem chave.
- **Testes:**
  - `tests/notificar.test.js`
  - `supabase/testes/push_testes.sql` (5 passos, 0 falhas)
- **Para ligar:** ver os passos em `docs/NOTIFICACOES.md` (chaves VAPID,
  migração, segredos, função, `pg_cron`).

### 12. Páginas `/jogo/...` e `/jogador/...` — `1cb5e39`
- **Ficheiros:** `api/_pagina.py` e `api/pagina.py`.
- **O que muda:** o título, a descrição e a pré-visualização de cada página
  vêm da base de dados. As páginas abrem o jogo ou a ficha certos, e há
  botões "Partilhar".
- **Testes:** `tests/test_pagina.py`.
- **Como testar:** abrir `/jogo/2026-10-21-sporting-cp-lask` ou
  `/jogador/rui-silva`, ou colar a ligação no WhatsApp.

### Pedido a meio: Fantasy por lugares — `de32ebc`
- **O que muda:**
  - escolhe-se a formação e um jogador para cada lugar (defesa direito,
    defesa esquerdo, …), só entre quem pode jogar lá;
  - há 3 suplentes;
  - o capitão e o vice escolhem-se em listas por cima do campo;
  - a substituição automática respeita o lugar.
- **Migração:** `fantasy_lugares`, aplicada.
- **Testes:**
  - `tests/fantasy_logica.test.js` (reescrito)
  - `supabase/testes/fantasy_lugares_testes.sql` (5 passos, 0 falhas)
- **Limitação:** a base de dados só sabe se um jogador é defesa, médio ou
  avançado, não o lado em que joga. Quem decide quem joga a defesa direito
  ou esquerdo é o utilizador.

### 13. Quiz vivo — `e8c6bb5`
- **O que muda:**
  - um Desafio da Semana com 5 perguntas feitas pelo servidor com os dados
    da época;
  - cada pergunta diz de que jogo ou de que data fala e mostra a fonte;
  - as respostas certas só aparecem depois de responder, com uma resposta
    por conta e por semana;
  - classificação geral e por liga.
- **Migração:** `quiz_semanal`, aplicada.
- **Testes:** `supabase/testes/quiz_semanal_testes.sql` (5 passos, 0 falhas).
- **Como testar:** `/quiz` e descer até "Desafio da semana".

### 14. Modo dia de jogo — `2563d94`
- **O que muda:**
  - no dia do jogo, antes do início, a página inicial abre com o jogo:
    contagem, estádio e previsão do tempo para a hora do jogo;
  - mostra também o onze, quando sai numa notícia, e o Centro de jogo em
    destaque.
- **De onde vem a previsão:**
  - do Open-Meteo, grátis e sem chave, com atribuição CC BY 4.0;
  - é pedida pelo nosso servidor (`api/tempo.py`), por isso o IP de quem
    visita não sai do site;
  - as coordenadas de 21 estádios vêm, com fonte, da Wikipédia ou do
    Wikidata (`dados/estadios.json`).
- **Testes:** `tests/test_tempo.py`.
- **Como testar:** abrir a página inicial no dia de um jogo, ou pedir
  `/api/tempo?estadio=Estádio José Alvalade&hora=<ISO>`.

### 15. O meu Sporting — `dbc4096`
- **O que muda:**
  - a vista `/o-meu-sporting` (no menu Comunidade) para seguir modalidades
    e jogadores, guardados só no browser;
  - as notícias filtradas e uma faixa na página inicial;
  - um botão "Seguir" na ficha do jogador;
  - o sino de novidades pode contar só as notícias do que se segue.
- **Testes:** `tests/historias.test.js` (as regras dos nomes).

---

## O que falta e depende de ti

1. **Chaves VAPID** (grátis): para ligar os avisos no telemóvel, seguindo
   `docs/NOTIFICACOES.md`.
2. **Administrador da Fantasy:** o teu nome de utilizador, para calcular os
   pontos das jornadas.
3. **Dados de jogo em atraso:** o último resultado na base de dados é de
   19/09 e as estatísticas são de 09/10. A Fantasy, os prognósticos e o
   Desafio da Semana usam estes dados.
4. **Questões em aberto de antes:**
   - os termos do SportScore;
   - autorização para mexer na pasta `.github`;
   - a chave da API-Football (carreira dos jogadores);
   - as imagens dos jornais, que vêm de fora.
5. **Avisos push por jogador:** os avisos no telemóvel filtram-se por tipo.
   Filtrar pelos jogadores seguidos obrigaria a guardar essas escolhas no
   servidor, e por isso não foi feito.
