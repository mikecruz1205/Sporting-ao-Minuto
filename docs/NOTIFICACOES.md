# Notificações push

Estado: **tudo escrito e testado, por ligar.** Falta o par de chaves VAPID
e instalar a parte do servidor. Enquanto `CONFIG.push.chavePublica` (em
`js/data.js`) for `null`, o cartão "Avisos no telemóvel" da Agenda fica
escondido e o site não pede autorização a ninguém.

```
 [ dados ]                         [ decide ]                        [ entrega ]
 desporto_jogos (hora, resultado) ─┐
 fantasy_jornadas (fecho)         ─┼─► Edge Function "notificar" ──► Web Push ──► sw.js
 /api/noticias (títulos "Oficial")─┘   (a cada 5 min, pg_cron)        (VAPID)     mostra e abre
                                       · decidir.mjs: que avisos                  o sítio certo
                                       · push_enviados: cada um 1 vez
                                       · subscricoes_push: quem quer qual
```

## Os avisos

Só se avisa do que os dados confirmam. Não há golos nem onze ao minuto
porque o site não tem fonte de dados em direto.

| tipo | quando | abre |
|---|---|---|
| `INICIO` | à hora marcada do jogo (até 20 min depois, uma vez) | `/ao-vivo` |
| `RESULTADO` | quando o resultado fica escrito em `desporto_jogos` (jogos das últimas 36 h) | `/jogos` |
| `OFICIAL` | notícia com até 3 h cujo título diz que é oficial (mesma regra de `js/historias.js`); no máximo uma a cada 2 horas | o artigo, no jornal |
| `JORNADA` | 2 horas antes do fecho de uma jornada da Fantasy | `/fantasy` |

Ficheiros:

- `supabase/functions/notificar/decidir.mjs`: a decisão, sem rede (testes em `tests/notificar.test.js`);
- `supabase/functions/notificar/index.ts`: lê os dados, marca o aviso em `push_enviados` **antes** de enviar e envia; apaga as subscrições que o serviço de push dá como mortas (404/410);
- `supabase/migrations/20261019090000_notificacoes_push.sql`: as tabelas `subscricoes_push` e `push_enviados` (sem acesso direto) e as funções `push_subscrever` / `push_cancelar` (só aceitam os serviços de push dos browsers e os 4 tipos). Os testes estão em `supabase/testes/push_testes.sql`;
- `js/notificacoes.js`: o cartão da Agenda, a autorização (só depois de tocar em "Ligar os avisos") e a subscrição;
- `sw.js`: mostra a mensagem; num toque abre o site no sítio certo, ou o artigo do jornal.

A subscrição é anónima: o endereço de envio do browser, as duas chaves que o
browser dá e os tipos escolhidos. Não fica ligada à conta.

## Ligar, passo a passo

Tudo grátis no plano atual do Supabase. A função corre a cada 5 minutos, ou
seja cerca de 9 mil vezes por mês, longe do limite de 500 mil.

1. **Chaves VAPID**: `npx web-push generate-vapid-keys`. A pública vai para
   `CONFIG.push.chavePublica` em `js/data.js`. A privada **nunca** vai para o
   site nem para o repositório.
2. **Tabelas e funções**: aplicar `supabase/migrations/20261019090000_notificacoes_push.sql`.
3. **Segredos da função** (painel do Supabase → Edge Functions → Secrets, ou
   `supabase secrets set`):
   - `VAPID_PUBLICA`, `VAPID_PRIVADA`;
   - `VAPID_CONTACTO`, por exemplo `mailto:o-teu-email`;
   - `NOTIFICAR_SEGREDO`, uma palavra longa e aleatória.
4. **Instalar a função**:
   `supabase functions deploy notificar --no-verify-jwt`. Com
   `--no-verify-jwt`, quem guarda a função é o cabeçalho `x-segredo`.
5. **Agendamento** (SQL no Supabase):
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select vault.create_secret('O_MESMO_NOTIFICAR_SEGREDO', 'notificar_segredo');
   select cron.schedule('notificar', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://wuayudgmkbiipwucblvi.supabase.co/functions/v1/notificar',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'notificar_segredo')),
       body := '{}'::jsonb,
       timeout_milliseconds := 20000);
   $$);
   ```
6. **Experimentar**: na Agenda, ligar os avisos e escolher os tipos. A tabela
   `push_enviados` mostra cada aviso enviado e a quantas pessoas chegou.

Para parar tudo: `select cron.unschedule('notificar');`.

## Plataformas

- **Android e computador (Chrome, Edge, Firefox)**: funciona normalmente.
- **App Android (TWA)**: as notificações aparecem como da app
  (`enableNotifications: true` no `twa-manifest.json`).
- **iPhone e iPad**: só com o site **adicionado ao ecrã principal** (iOS 16.4
  ou mais recente). O cartão explica isto a quem está no Safari normal.
