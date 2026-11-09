# Dados do Sporting ao Minuto

## O que vem de onde

| Dado | Fonte | Como chega |
|---|---|---|
| Notícias | 12 jornais (RSS/sitemaps) | `/api/noticias` agrega no servidor (ETag, cache 60 s) |
| Calendário e resultados no browser | Wikipédia (página da época) | `js/wiki.js`, no browser, ao abrir o site |
| Classificação da Liga | football-data (token na Vercel) com a Wikipédia de reserva | `/api/fd` |
| Resultados e calendário na base de dados (Liga, Champions) | football-data | **automático**: cron da Vercel 06:30 e 23:50 UTC → `/api/sincronizar` → `desporto_sincronizar_fd` |
| Taças, estatísticas da época, plantel na base de dados | Wikipédia (+ zerozero e API-Football para IDs e fotografias) | **à mão** (abaixo) |
| Previsão do tempo no dia de jogo | Open-Meteo (CC BY 4.0) | `/api/tempo`, só estádios de `dados/estadios.json` (coordenadas com fonte) |
| Pontos da Fantasy | estatísticas por jogo | nenhuma fonte grátis: administrador introduz no painel de gestão, ou fonte paga |

O que usa a base de dados: Fantasy, prognósticos, Desafio da Semana, `/calendario.ics`,
páginas `/jogo/…` e `/jogador/…`.

## Sincronização automática (football-data)

- Código: `api/_sincronizar.py` (normaliza: prova, fase "Jornada N" /
  "Fase de liga · jornada N", casa/fora, resultado só de jogos `FINISHED`; jogos
  `SCHEDULED` às 00:00 UTC ficam às 18:00 de Lisboa).
- A função do Supabase encontra cada jogo pela prova + fase + `sporting_casa`
  (não pelo nome do adversário), atualiza resultado, hora e fecho da jornada da
  Fantasy, e junta jogos novos com jornada.
- Segurança: `CRON_SECRET` (Vercel) protege o pedido; `SINCRONIZAR_SEGREDO`
  (Vercel) = segredo `sincronizar_segredo` do cofre do Supabase. Os valores não
  se escrevem em lado nenhum fora desses dois sítios.
- Correr à mão: `curl -H "Authorization: Bearer <CRON_SECRET>" https://sporting-fan-ao-minuto.vercel.app/api/sincronizar`.
- Verificar: `select * from desporto_sincronizacoes order by id desc limit 5;`
  (ordenar pelo `id` ou pela data, não por um texto formatado).

## Importação manual (Wikipédia) — taças, estatísticas, plantel

1. Abrir o site local (pré-visualização "sporting-hud") e passar o ecrã de
   boas-vindas.
2. Correr um recetor local de uso único (Python, `http.server`, porta 8124, CORS
   para `http://localhost:8123`, grava o corpo do POST num ficheiro do scratchpad
   e termina).
3. Injetar na página um `<script>` (o `Wiki` não está em `window`) que faz
   `Wiki.sincronizarSporting().then(d => fetch('http://localhost:8124/', {method:'POST', body: JSON.stringify(d)}))`.
4. `python scripts/preparar_importacao_fantasy.py <wiki.json> <pasta>` →
   `jogadores.json`, `epoca.json`, `calendario.json`. Ver o calendário antes de
   importar (resultados, nomes das fases em português).
5. Pelo MCP do Supabase (`execute_sql`; `fantasy_e_admin()` aceita
   `session_user = 'postgres'`), por esta ordem:
   `desporto_importar_jogadores` (só se o plantel mudou — marca saídas!),
   `desporto_importar_estatisticas_epoca`, `fantasy_importar_calendario`.
   Os `id_externo` do calendário têm o formato `2026/27|LIGA — J11|Casa|Fora`:
   confirmar que coincidem com os existentes para não duplicar.
6. Se o `quiz_semanal` da semana foi gerado com dados velhos e ainda não tem
   respostas, apagar essa linha (volta a gerar-se no próximo pedido).

Notas: as estatísticas por prova da Wikipédia vêm por vezes com números colados
("Liga: 82 jogos"); a importação só usa o total da época, que está certo. A
Wikipédia demora algumas horas a pôr o resultado depois do jogo; a football-data
costuma ser mais rápida.
