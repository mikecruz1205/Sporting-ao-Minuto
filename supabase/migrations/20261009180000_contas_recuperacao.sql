-- =========================================================================
-- CONTAS — recuperação da palavra-passe por código
-- -------------------------------------------------------------------------
-- As contas usam só nome de utilizador: o email que o Supabase guarda é
-- interno (utilizador@utilizador.sportingaominuto.pt) e não recebe nada.
-- Por isso a recuperação não pode ser por email. Em vez disso, cada conta
-- pode ter um CÓDIGO DE RECUPERAÇÃO (16 caracteres, 80 bits aleatórios),
-- mostrado uma única vez a quem o gera. Guarda-se só o resumo bcrypt.
--
-- Quem esqueceu a palavra-passe escreve o nome de utilizador, o código e
-- a palavra-passe nova. Se o código estiver certo:
--   · a palavra-passe muda (bcrypt, o mesmo formato que o Supabase Auth usa)
--   · todas as sessões abertas dessa conta terminam
--   · o código fica gasto (a pessoa gera outro depois de entrar)
--
-- Proteções: 5 falhas por utilizador em 15 min e 20 por origem numa hora
-- bloqueiam novas tentativas; a resposta é igual para utilizador
-- inexistente e código errado (não se revela que contas existem); quando
-- não há código guardado faz-se na mesma uma verificação bcrypt, para o
-- tempo de resposta não denunciar a diferença.
--
-- As tabelas não têm políticas RLS: ninguém as lê nem escreve diretamente,
-- só através das funções abaixo (SECURITY DEFINER).
-- =========================================================================

create table if not exists public.contas_recuperacao (
  perfil_id   uuid primary key references public.perfis(id) on delete cascade,
  codigo_hash text not null,
  criado_em   timestamptz not null default now()
);
alter table public.contas_recuperacao enable row level security;
revoke all on public.contas_recuperacao from anon, authenticated;

create table if not exists public.contas_recuperacao_tentativas (
  id         bigint generated always as identity primary key,
  utilizador text not null,
  origem     text,
  sucesso    boolean not null,
  quando     timestamptz not null default now()
);
create index if not exists contas_rec_tent_utilizador on public.contas_recuperacao_tentativas (utilizador, quando desc);
create index if not exists contas_rec_tent_origem on public.contas_recuperacao_tentativas (origem, quando desc);
alter table public.contas_recuperacao_tentativas enable row level security;
revoke all on public.contas_recuperacao_tentativas from anon, authenticated;

/* "abcd-efgh 1jkl" → "ABCDEFGH1JKL"; O→0 e I/L→1, como no Base32 de Crockford */
create or replace function public.conta_normalizar_codigo(p text)
returns text language sql immutable
set search_path = public, pg_temp
as $$
  select translate(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'OIL', '011')
$$;

/* gera (ou substitui) o código da conta com sessão iniciada e devolve-o —
   é a única vez que aparece em claro */
create or replace function public.conta_gerar_codigo()
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid := auth.uid();
  alfabeto constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b bytea := extensions.gen_random_bytes(16);
  v text := '';
  i int;
begin
  if v_id is null then raise exception 'sem_sessao'; end if;
  if not exists (select 1 from perfis where id = v_id) then raise exception 'sem_perfil'; end if;
  -- 256 é múltiplo de 32: cada byte mod 32 é uniforme
  for i in 0..15 loop
    v := v || substr(alfabeto, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  insert into contas_recuperacao (perfil_id, codigo_hash, criado_em)
  values (v_id, extensions.crypt(v, extensions.gen_salt('bf', 10)), now())
  on conflict (perfil_id) do update set codigo_hash = excluded.codigo_hash, criado_em = excluded.criado_em;
  return substr(v, 1, 4) || '-' || substr(v, 5, 4) || '-' || substr(v, 9, 4) || '-' || substr(v, 13, 4);
end $$;

/* a conta com sessão tem código? (para o perfil saber o que mostrar) */
create or replace function public.conta_estado_recuperacao()
returns table (tem_codigo boolean, criado_em timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select r.perfil_id is not null, r.criado_em
  from (select auth.uid() as id) eu
  left join contas_recuperacao r on r.perfil_id = eu.id
$$;

/* Devolve 'ok' ou um código de erro. Não usa exceções de propósito: uma
   exceção desfazia o registo da tentativa falhada e o limite não contava. */
create or replace function public.conta_recuperar(p_utilizador text, p_codigo text, p_nova text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  hash_falso constant text := '$2a$10$kwZiElegPSYc097hRII.O.izMWwCcs6Gfl2Fm2qo0wOwUFdWLGTZq';
  v_user text := lower(trim(coalesce(p_utilizador, '')));
  v_cod  text := public.conta_normalizar_codigo(p_codigo);
  v_origem text;
  v_cab json;
  v_id uuid;
  v_hash text;
  v_certo boolean;
begin
  -- origem do pedido: o PostgREST passa os cabeçalhos HTTP
  begin
    v_cab := nullif(current_setting('request.headers', true), '')::json;
    v_origem := coalesce(v_cab->>'cf-connecting-ip', v_cab->>'x-real-ip',
                         trim(split_part(v_cab->>'x-forwarded-for', ',', 1)));
  exception when others then v_origem := null;
  end;
  v_origem := nullif(v_origem, '');

  if v_user !~ '^[a-z0-9._-]{3,20}$' then return 'codigo_invalido'; end if;

  if (select count(*) from contas_recuperacao_tentativas
       where utilizador = v_user and not sucesso and quando > now() - interval '15 minutes') >= 5
     or (v_origem is not null and (select count(*) from contas_recuperacao_tentativas
       where origem = v_origem and not sucesso and quando > now() - interval '1 hour') >= 20)
  then
    return 'demasiadas_tentativas';
  end if;

  if char_length(coalesce(p_nova, '')) < 8 then return 'palavra_curta'; end if;
  if octet_length(p_nova) > 72 then return 'palavra_longa'; end if;

  select p.id, r.codigo_hash into v_id, v_hash
    from perfis p left join contas_recuperacao r on r.perfil_id = p.id
   where p.utilizador = v_user;

  if v_hash is null then
    perform extensions.crypt(v_cod, hash_falso);   -- mesmo custo, mesma resposta
    v_certo := false;
  else
    v_certo := extensions.crypt(v_cod, v_hash) = v_hash;
  end if;

  -- de vez em quando, limpa o registo antigo
  delete from contas_recuperacao_tentativas where quando < now() - interval '30 days';

  if not v_certo then
    insert into contas_recuperacao_tentativas (utilizador, origem, sucesso) values (v_user, v_origem, false);
    return 'codigo_invalido';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_nova, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = v_id;
  delete from auth.refresh_tokens where user_id = v_id::text;
  delete from auth.sessions where user_id = v_id;
  delete from contas_recuperacao where perfil_id = v_id;
  insert into contas_recuperacao_tentativas (utilizador, origem, sucesso) values (v_user, v_origem, true);
  return 'ok';
end $$;

revoke all on function public.conta_gerar_codigo() from public, anon;
revoke all on function public.conta_estado_recuperacao() from public, anon;
revoke all on function public.conta_recuperar(text, text, text) from public;
revoke all on function public.conta_normalizar_codigo(text) from public, anon, authenticated;
grant execute on function public.conta_gerar_codigo() to authenticated;
grant execute on function public.conta_estado_recuperacao() to authenticated;
grant execute on function public.conta_recuperar(text, text, text) to anon, authenticated;

-- =========================================================================
-- CHAT — só quem tem conta lê as mensagens
-- -------------------------------------------------------------------------
-- A política antiga deixava qualquer pessoa (anon) ler o chat pela API,
-- mesmo sem conta. O site novo tem modo visitante: as mensagens dos
-- adeptos passam a ser só para quem entrou.
-- =========================================================================
drop policy if exists chat_leitura_publica on public.chat_mensagens;
drop policy if exists chat_leitura_com_conta on public.chat_mensagens;
create policy chat_leitura_com_conta on public.chat_mensagens
  for select to authenticated using (true);
