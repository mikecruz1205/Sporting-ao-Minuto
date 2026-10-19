-- =========================================================================
-- QUIZ VIVO — o Desafio da Semana
-- -------------------------------------------------------------------------
-- Cinco perguntas por semana (de segunda a domingo, hora de Lisboa), iguais
-- para todos, feitas pelo servidor a partir dos dados do site:
--   · o resultado do último jogo registado antes da semana;
--   · quantas vitórias nos jogos registados da época;
--   · o melhor marcador e os golos do segundo (estatísticas da época,
--     com a fonte e a data da última atualização);
--   · o adversário do próximo jogo.
-- Cada pergunta diz de que jogo ou de que data fala, por isso continua
-- certa mesmo que os dados do site estejam atrasados. Ficam congeladas na
-- primeira vez que alguém as pede nessa semana (tabela quiz_semanal).
--
-- As respostas certas não saem do servidor antes de se responder; cada
-- conta responde uma vez por semana (quiz_semanal_responder). Há uma
-- classificação geral e outra por liga privada (as ligas da Fantasy).
-- Testes: supabase/testes/quiz_semanal_testes.sql.
-- =========================================================================

create table if not exists public.quiz_semanal (
  semana     text primary key check (semana ~ '^[0-9]{4}-S[0-9]{2}$'),
  inicio     timestamptz not null,
  perguntas  jsonb not null,
  criado_em  timestamptz not null default now()
);
alter table public.quiz_semanal enable row level security;
revoke all on public.quiz_semanal from anon, authenticated;

create table if not exists public.quiz_semanal_respostas (
  perfil_id  uuid not null references public.perfis(id) on delete cascade,
  semana     text not null references public.quiz_semanal(semana) on delete cascade,
  respostas  smallint[] not null,
  certas     smallint not null,
  total      smallint not null,
  criado_em  timestamptz not null default now(),
  primary key (perfil_id, semana)
);
alter table public.quiz_semanal_respostas enable row level security;
revoke all on public.quiz_semanal_respostas from anon, authenticated;
grant select on public.quiz_semanal_respostas to authenticated;
drop policy if exists quiz_semanal_respostas_minhas on public.quiz_semanal_respostas;
create policy quiz_semanal_respostas_minhas on public.quiz_semanal_respostas
  for select to authenticated using (perfil_id = (select auth.uid()));

-- a semana de agora em Lisboa: '2026-S43' e a segunda-feira às 00:00
create or replace function public.quiz_semana_atual(out semana text, out inicio timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select to_char(d, 'IYYY') || '-S' || to_char(d, 'IW'),
         date_trunc('week', d) at time zone 'Europe/Lisbon'
  from (select now() at time zone 'Europe/Lisbon' as d) x;
$$;

-- uma pergunta com as opções baralhadas sempre da mesma maneira nessa semana
create or replace function public.quiz_pergunta(p_semana text, p_id text, p_texto text, p_certa text,
                                                 p_erradas text[], p_fonte jsonb, p_explicacao text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  with o as (select x, md5(p_semana || '|' || p_id || '|' || x) h from unnest(array[p_certa] || p_erradas[1:3]) x),
       a as (select array_agg(x order by h) l from o)
  select jsonb_build_object('id', p_id, 'pergunta', p_texto, 'opcoes', to_jsonb(l),
                            'correta', array_position(l, p_certa) - 1, 'fonte', p_fonte, 'explicacao', p_explicacao)
  from a;
$$;

-- respostas erradas plausíveis para um número (sem negativos nem repetidos)
create or replace function public.quiz_numeros_perto(p_certo int, p_max int default null)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array_agg(x::text order by abs(x - p_certo), x)
  from (select distinct x from unnest(array[p_certo - 1, p_certo + 1, p_certo + 2, p_certo - 2, p_certo + 3]) x
        where x >= 0 and x <> p_certo and (p_max is null or x <= p_max)) v;
$$;

create or replace function public.quiz_semanal_gerar(p_semana text, p_inicio timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  qs jsonb := '[]'::jsonb;
  g public.desporto_jogos;
  ep text; n int; v int;
  certa text; erradas text[];
  t1 record; t2 record;
  dia text;
  fonte_cal jsonb := jsonb_build_object('nome', 'Calendário e resultados do site (Wikipédia)');
  fonte_est jsonb;
begin
  -- 1. o resultado do último jogo registado antes da semana
  select * into g from desporto_jogos
  where golos_casa is not null and golos_fora is not null and data < p_inicio
  order by data desc limit 1;
  if found then
    ep := g.epoca;
    dia := to_char(g.data at time zone 'Europe/Lisbon', 'DD/MM');
    certa := g.golos_casa || '–' || g.golos_fora;
    erradas := array(select x from unnest(array[
                 (g.golos_casa + 1) || '–' || g.golos_fora, g.golos_casa || '–' || (g.golos_fora + 1),
                 g.golos_fora || '–' || g.golos_casa, (g.golos_casa + 1) || '–' || (g.golos_fora + 1),
                 greatest(g.golos_casa - 1, 0) || '–' || g.golos_fora, g.golos_casa || '–' || greatest(g.golos_fora - 1, 0)]) with ordinality u(x, o)
               where x <> certa group by x order by min(o));
    qs := qs || public.quiz_pergunta(p_semana, 'resultado', format('Qual foi o resultado do %s – %s (%s, %s)?', g.casa, g.fora, g.competicao, dia),
                                     certa, erradas, fonte_cal, format('%s %s %s, %s, %s.', g.casa, certa, g.fora, g.competicao, dia));

    -- 2. vitórias nos jogos registados dessa época
    select count(*) filter (where (sporting_casa and golos_casa > golos_fora) or (not sporting_casa and golos_fora > golos_casa)), count(*)
      into v, n
    from desporto_jogos where epoca = ep and golos_casa is not null and golos_fora is not null and data < p_inicio;
    if n >= 3 then
      qs := qs || public.quiz_pergunta(p_semana, 'vitorias',
        format('Nos %s jogos de %s com resultado registado no calendário do site (até %s), quantas vitórias teve o Sporting?',
               n, ep, to_char(g.data at time zone 'Europe/Lisbon', 'DD/MM')),
        v::text, public.quiz_numeros_perto(v, n), fonte_cal,
        format('%s vitórias em %s jogos.', v, n));
    end if;
  end if;

  -- 3. o melhor marcador da época (só se for um, sem empate) e 4. os golos do segundo
  select dj.nome, e.golos, e.fonte, e.atualizado_em, e.epoca into t1
  from desporto_estatisticas_epoca e join desporto_jogadores dj on dj.id = e.jogador_id
  where e.competicao = 'todas' and e.golos > 0
  order by e.golos desc, dj.nome limit 1;
  if found and (select count(*) from desporto_estatisticas_epoca where competicao = 'todas' and epoca = t1.epoca and golos = t1.golos) = 1 then
    fonte_est := jsonb_build_object('nome', format('%s — estatísticas da época %s, dados de %s',
                   case t1.fonte when 'wikipedia' then 'Wikipédia' else t1.fonte end, t1.epoca,
                   to_char(t1.atualizado_em at time zone 'Europe/Lisbon', 'DD/MM/YYYY')));
    erradas := array(select dj.nome from desporto_estatisticas_epoca e join desporto_jogadores dj on dj.id = e.jogador_id
                     where e.competicao = 'todas' and e.epoca = t1.epoca and e.golos < t1.golos and dj.nome <> t1.nome
                     order by e.golos desc nulls last, e.jogos desc nulls last, dj.nome limit 3);
    if cardinality(erradas) = 3 then
      qs := qs || public.quiz_pergunta(p_semana, 'marcador',
        format('Segundo a fonte dos números do site (dados de %s), quem era o melhor marcador do Sporting em %s, em todas as competições?',
               to_char(t1.atualizado_em at time zone 'Europe/Lisbon', 'DD/MM'), t1.epoca),
        t1.nome, erradas, fonte_est, format('%s, com %s golos.', t1.nome, t1.golos));
    end if;

    select dj.nome, e.golos into t2
    from desporto_estatisticas_epoca e join desporto_jogadores dj on dj.id = e.jogador_id
    where e.competicao = 'todas' and e.epoca = t1.epoca and e.golos > 0 and e.golos < t1.golos
    order by e.golos desc, dj.nome limit 1;
    if found then
      qs := qs || public.quiz_pergunta(p_semana, 'golos',
        format('Quantos golos tinha marcado %s em %s, em todas as competições (dados de %s)?',
               t2.nome, t1.epoca, to_char(t1.atualizado_em at time zone 'Europe/Lisbon', 'DD/MM')),
        t2.golos::text, public.quiz_numeros_perto(t2.golos), fonte_est, format('%s golos.', t2.golos));
    end if;
  end if;

  -- 5. o adversário do próximo jogo
  select * into g from desporto_jogos where data >= p_inicio order by data limit 1;
  if found then
    certa := case when g.sporting_casa then g.fora else g.casa end;
    erradas := array(select x from (
                 select distinct case when sporting_casa then fora else casa end x from desporto_jogos where epoca = g.epoca) o
               where x <> certa order by md5(p_semana || x) limit 3);
    if cardinality(erradas) = 3 then
      qs := qs || public.quiz_pergunta(p_semana, 'proximo',
        format('Contra quem joga o Sporting a %s (%s)?', to_char(g.data at time zone 'Europe/Lisbon', 'DD/MM'), g.competicao),
        certa, erradas, fonte_cal,
        format('%s – %s, %s, %s às %s.', g.casa, g.fora, g.competicao, to_char(g.data at time zone 'Europe/Lisbon', 'DD/MM'),
               to_char(g.data at time zone 'Europe/Lisbon', 'HH24:MI')));
    end if;
  end if;

  return qs;
end $$;

-- o desafio desta semana; as respostas certas só para quem já respondeu
create or replace function public.quiz_semanal()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s record;
  q public.quiz_semanal;
  r public.quiz_semanal_respostas;
  eu uuid := auth.uid();
begin
  select * into s from public.quiz_semana_atual();
  insert into public.quiz_semanal (semana, inicio, perguntas)
  values (s.semana, s.inicio, public.quiz_semanal_gerar(s.semana, s.inicio))
  on conflict (semana) do nothing;
  select * into q from public.quiz_semanal where semana = s.semana;
  if eu is not null then
    select * into r from public.quiz_semanal_respostas where perfil_id = eu and semana = s.semana;
  end if;
  return jsonb_build_object(
    'semana', q.semana, 'inicio', q.inicio, 'fim', q.inicio + interval '7 days',
    'respondido', r.perfil_id is not null, 'certas', r.certas, 'respostas', to_jsonb(r.respostas),
    'perguntas', coalesce((select jsonb_agg(case when r.perfil_id is not null then p else p - 'correta' - 'explicacao' end order by ord)
                           from jsonb_array_elements(q.perguntas) with ordinality t(p, ord)), '[]'::jsonb));
end $$;

create or replace function public.quiz_semanal_responder(p_respostas smallint[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  s record;
  q public.quiz_semanal;
  n int; certas int := 0; i int;
begin
  if eu is null then return jsonb_build_object('ok', false, 'erro', 'Entra na tua conta para responder.'); end if;
  if not exists (select 1 from public.perfis where id = eu) then return jsonb_build_object('ok', false, 'erro', 'Perfil não encontrado.'); end if;
  perform public.quiz_semanal();                                -- garante as perguntas da semana
  select * into s from public.quiz_semana_atual();
  select * into q from public.quiz_semanal where semana = s.semana;
  n := jsonb_array_length(q.perguntas);
  if n = 0 then return jsonb_build_object('ok', false, 'erro', 'Não há perguntas esta semana.'); end if;
  if coalesce(array_length(p_respostas, 1), 0) <> n or array_position(p_respostas, null) is not null then
    return jsonb_build_object('ok', false, 'erro', 'Responde a todas as perguntas.');
  end if;
  if exists (select 1 from public.quiz_semanal_respostas where perfil_id = eu and semana = s.semana) then
    return jsonb_build_object('ok', false, 'erro', 'Já respondeste ao desafio desta semana.');
  end if;
  for i in 1..n loop
    if p_respostas[i] = (q.perguntas->(i - 1)->>'correta')::int then certas := certas + 1; end if;
  end loop;
  insert into public.quiz_semanal_respostas (perfil_id, semana, respostas, certas, total)
  values (eu, s.semana, p_respostas, certas, n);
  return jsonb_build_object('ok', true) || public.quiz_semanal();
end $$;

-- classificação da semana: geral, ou só os membros de uma liga (para quem é membro)
create or replace function public.quiz_semanal_classificacao(p_liga bigint default null)
returns table (posicao bigint, utilizador text, certas smallint, total smallint, eu boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare s record;
begin
  if p_liga is not null and not public.fantasy_sou_membro(p_liga) then
    raise exception 'Só os membros da liga veem esta classificação.';
  end if;
  select * into s from public.quiz_semana_atual();
  return query
    select rank() over (order by r.certas desc, r.criado_em), p.utilizador, r.certas, r.total, r.perfil_id = auth.uid()
    from public.quiz_semanal_respostas r join public.perfis p on p.id = r.perfil_id
    where r.semana = s.semana
      and (p_liga is null or r.perfil_id in (select m.perfil_id from public.fantasy_liga_membros m where m.liga_id = p_liga))
    order by r.certas desc, r.criado_em
    limit 50;
end $$;

revoke all on function public.quiz_semana_atual() from public, anon, authenticated;
revoke all on function public.quiz_pergunta(text, text, text, text, text[], jsonb, text) from public, anon, authenticated;
revoke all on function public.quiz_numeros_perto(int, int) from public, anon, authenticated;
revoke all on function public.quiz_semanal_gerar(text, timestamptz) from public, anon, authenticated;
revoke all on function public.quiz_semanal() from public;
revoke all on function public.quiz_semanal_responder(smallint[]) from public, anon;
revoke all on function public.quiz_semanal_classificacao(bigint) from public;
grant execute on function public.quiz_semanal() to anon, authenticated;
grant execute on function public.quiz_semanal_responder(smallint[]) to authenticated;
grant execute on function public.quiz_semanal_classificacao(bigint) to anon, authenticated;
