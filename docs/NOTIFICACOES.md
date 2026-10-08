# Notificações push — arquitetura

Estado: **o browser está pronto, o servidor por ligar.** Enquanto
`CONFIG.push.chavePublica` (em `js/data.js`) for `null`, o site não pede
autorização a ninguém.

```
 [ fontes ]                 [ quem decide ]                 [ quem entrega ]
 football-data (jogo)  ─┐
 feeds RSS (notícias)  ─┼─► Edge Function "notificar" ──► Web Push (VAPID) ──► sw.js
 onze inicial (notícia)─┘    · deteta o acontecimento        · um envio por        · mostra
                             · escolhe quem quer receber      subscrição            · abre o site
                               (preferências)                                       no sítio certo
                             · tabela subscricoes_push
```

## Tipos de mensagem

O servidor envia JSON no corpo da mensagem push:

```json
{ "tipo": "GOLO", "titulo": "GOLO! Sporting 1-0", "corpo": "Gyökeres, 23'", "url": "/ao-vivo", "tag": "jogo-2026-10-09" }
```

| tipo | quando | url sugerida |
|---|---|---|
| `INICIO` | apito inicial | `/ao-vivo` |
| `GOLO` | golo (dos dois lados; o texto diz quem) | `/ao-vivo` |
| `FIM` | apito final | `/ao-vivo` |
| `RESULTADO` | resultado final com marcadores | `/jogos` |
| `ONZE` | sai o onze inicial | `/ao-vivo` |
| `NOTICIA` | notícia forte (`palavrasQuentes` em `js/data.js`) | link da notícia |
| `MERCADO` | entrada/saída confirmada | `/mercado` |

As predefinições (título, `tag`, vibração) estão em `sw.js`
(`PREDEFINICOES`). A `tag` faz com que um golo novo substitua o anterior
em vez de empilhar.

## Base de dados (Supabase)

```sql
create table public.subscricoes_push (
  id          uuid primary key default gen_random_uuid(),
  utilizador  uuid references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  tipos       text[] not null default '{GOLO,INICIO,RESULTADO,ONZE}',
  criada_em   timestamptz not null default now(),
  vista_em    timestamptz not null default now()
);

alter table public.subscricoes_push enable row level security;

-- cada um vê, cria e apaga só as suas
create policy "as minhas subscrições" on public.subscricoes_push
  for all using (auth.uid() = utilizador) with check (auth.uid() = utilizador);
```

O envio é feito com a chave de serviço (só no servidor), que ignora a RLS.

## Ligar, passo a passo

1. **Chaves VAPID**: `npx web-push generate-vapid-keys`.
   A pública vai para `CONFIG.push.chavePublica`; a privada **nunca** vai
   para o site — fica nos segredos da Edge Function.
2. **Tabela**: corre o SQL acima no Supabase.
3. **Guardar a subscrição** depois do gesto do utilizador:
   ```js
   Notificacoes.ativar(Notificacoes.preferencias(), (sub, prefs) =>
     Nuvem.guardarSubscricaoPush(sub, Object.keys(prefs).filter(k => prefs[k])));
   ```
   (`Nuvem.guardarSubscricaoPush` e `Nuvem.apagarSubscricaoPush` já existem
   em `js/nuvem.js`.)
4. **Edge Function `notificar`** (Deno, biblioteca `web-push`): recebe
   `{ tipo, titulo, corpo, url }`, lê as subscrições cujo `tipos` inclui o
   tipo, envia, e apaga as que responderem 404/410 (subscrição expirada).
5. **Quem dispara**:
   - jogo — um agendamento (cron do Supabase) a cada minuto em dia de jogo
     lê o football-data (já usado em `api/fd.py`) e compara com o último
     estado guardado; muda o resultado → `GOLO`; começa → `INICIO`; acaba
     → `FIM` e `RESULTADO`;
   - notícias — o mesmo processo que lê os feeds marca as que batem em
     `palavrasQuentes` e envia `NOTICIA`/`MERCADO`, com limite (não mais de
     uma por hora, por exemplo).
6. **Interface**: um cartão "Notificações" (por exemplo na vista Clube) com
   um interruptor por tipo (`Notificacoes.TIPOS`) e o botão que chama
   `Notificacoes.ativar`. Pedir autorização **só** quando a pessoa carrega
   no botão — nunca ao abrir o site.

## Plataformas

- **Android / computador (Chrome, Edge, Firefox)**: Web Push normal.
- **App Android (TWA)**: as mesmas notificações aparecem como da app
  ("notification delegation"); `enableNotifications: true` já está no
  `twa-manifest.json` gerado.
- **iPhone / iPad**: Web Push só funciona com o site **adicionado ao ecrã
  principal** (iOS 16.4 ou mais recente). No Safari normal não há.
