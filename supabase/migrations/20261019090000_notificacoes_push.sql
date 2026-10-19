-- =========================================================================
-- NOTIFICAÇÕES PUSH — subscrições e avisos enviados
-- -------------------------------------------------------------------------
-- POR LIGAR: só faz sentido com as chaves VAPID e a Edge Function
-- "notificar" (ver docs/NOTIFICACOES.md). Testada sem ficar na base de
-- dados com supabase/testes/push_testes.sql.
--
-- As subscrições são anónimas (não se ligam à conta): o endereço de push
-- de cada browser, as duas chaves que o browser dá e os tipos de aviso que
-- a pessoa escolheu. Ninguém lê nem escreve nas tabelas diretamente: o
-- browser usa push_subscrever / push_cancelar e o envio usa a chave de
-- serviço, só no servidor.
-- =========================================================================

create table if not exists public.subscricoes_push (
  endpoint   text primary key check (length(endpoint) between 30 and 1000),
  p256dh     text not null check (length(p256dh) between 40 and 200),
  auth       text not null check (length(auth) between 10 and 100),
  tipos      text[] not null default '{INICIO,RESULTADO,OFICIAL,JORNADA}',
  criada_em  timestamptz not null default now(),
  vista_em   timestamptz not null default now()
);
alter table public.subscricoes_push enable row level security;
revoke all on public.subscricoes_push from anon, authenticated;

-- cada aviso uma vez só (a chave diz o quê: inicio-17, resultado-17, jornada-9…)
create table if not exists public.push_enviados (
  chave          text primary key,
  tipo           text not null,
  enviado_em     timestamptz not null default now(),
  destinatarios  integer not null default 0
);
alter table public.push_enviados enable row level security;
revoke all on public.push_enviados from anon, authenticated;

-- guardar (ou atualizar) a subscrição deste browser
create or replace function public.push_subscrever(p_endpoint text, p_p256dh text, p_auth text, p_tipos text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  validos constant text[] := array['INICIO', 'RESULTADO', 'OFICIAL', 'JORNADA'];
  servidor text := lower(substring(p_endpoint from '^https://([^/:]+)/'));
begin
  -- só os serviços de push dos browsers (Chrome/Edge/Android, Firefox, Windows, Safari/iPhone)
  if servidor is null or not (
       servidor = 'fcm.googleapis.com'
    or servidor = 'updates.push.services.mozilla.com'
    or servidor like '%.push.services.mozilla.com'
    or servidor like '%.notify.windows.com'
    or servidor = 'web.push.apple.com'
    or servidor like '%.push.apple.com') then
    raise exception 'serviço de push desconhecido' using errcode = '22023';
  end if;
  if p_tipos is null or cardinality(p_tipos) = 0 or not (p_tipos <@ validos) then
    raise exception 'tipos de aviso inválidos' using errcode = '22023';
  end if;
  -- trava contra enchimento: o site é pequeno
  if (select count(*) from subscricoes_push) >= 50000
     and not exists (select 1 from subscricoes_push where endpoint = p_endpoint) then
    raise exception 'limite de subscrições atingido' using errcode = '54000';
  end if;

  insert into subscricoes_push (endpoint, p256dh, auth, tipos)
  values (p_endpoint, p_p256dh, p_auth, p_tipos)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, tipos = excluded.tipos, vista_em = now();
end;
$$;

-- deixar de receber (quem tem o endereço de push é o próprio browser)
create or replace function public.push_cancelar(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from subscricoes_push where endpoint = p_endpoint;
$$;

revoke all on function public.push_subscrever(text, text, text, text[]) from public;
revoke all on function public.push_cancelar(text) from public;
grant execute on function public.push_subscrever(text, text, text, text[]) to anon, authenticated;
grant execute on function public.push_cancelar(text) to anon, authenticated;
