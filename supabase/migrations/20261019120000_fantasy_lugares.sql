-- =========================================================================
-- FANTASY POR LUGARES: escolhe-se a formação e um jogador para cada lugar
-- (guarda-redes, defesa direito, centrais, defesa esquerdo, …), mais 3
-- suplentes. Antes eram 15 jogadores com quotas por posição e a formação
-- saía de quem se comprava.
-- -------------------------------------------------------------------------
-- · fantasy_config.jogo ganha "formacoes" (os papéis de cada lugar, pela
--   ordem de FORMACOES em js/data.js), "papeis" (as posições que podem
--   jogar em cada papel) e "suplentes": 3;
-- · fantasy_escolhas.posto: o lugar de cada titular (0 = guarda-redes … 10);
-- · fantasy_guardar_onze(): grava a equipa por lugares. A função antiga,
--   fantasy_guardar_equipa(), passa a pedir para recarregar a página;
-- · fantasy_calcular_jornada(): quem não joga sai para o primeiro suplente
--   (pela ordem do banco) que jogou e pode jogar naquele lugar. As equipas
--   guardadas antes desta mudança (sem lugares) seguem a regra antiga.
-- Testes: supabase/testes/fantasy_lugares_testes.sql.
-- =========================================================================

alter table public.fantasy_escolhas add column if not exists posto smallint check (posto between 0 and 10);
alter table public.fantasy_escolhas drop constraint if exists fantasy_escolhas_posto_titular;
alter table public.fantasy_escolhas add constraint fantasy_escolhas_posto_titular check (posto is null or titular);

alter table public.fantasy_equipa_jornada drop constraint if exists fantasy_equipa_jornada_formacao_check;
alter table public.fantasy_equipa_jornada add constraint fantasy_equipa_jornada_formacao_check
  check (formacao ~ '^[3-5](-[1-5]){2,3}$');

update public.fantasy_config
   set valor = valor || jsonb_build_object(
         'suplentes', 3,
         'papeis', '{"GR": ["GR"], "LD": ["DEF"], "LE": ["DEF"], "DC": ["DEF"], "ALA": ["DEF", "MED"], "MDC": ["MED"], "MC": ["MED"], "MO": ["MED"], "EXT": ["MED", "AVA"], "PL": ["AVA"]}'::jsonb,
         'formacoes', '{"4-3-3": ["GR", "LE", "DC", "DC", "LD", "MC", "MC", "MC", "EXT", "PL", "EXT"], "4-2-3-1": ["GR", "LE", "DC", "DC", "LD", "MDC", "MDC", "EXT", "MO", "EXT", "PL"], "3-4-3": ["GR", "DC", "DC", "DC", "ALA", "MC", "MC", "ALA", "EXT", "PL", "EXT"], "3-4-2-1": ["GR", "DC", "DC", "DC", "ALA", "MC", "MC", "ALA", "MO", "MO", "PL"], "3-5-2": ["GR", "DC", "DC", "DC", "ALA", "MC", "MC", "MC", "ALA", "PL", "PL"], "4-4-2": ["GR", "LE", "DC", "DC", "LD", "EXT", "MC", "MC", "EXT", "PL", "PL"], "5-3-2": ["GR", "ALA", "DC", "DC", "DC", "ALA", "MC", "MC", "MC", "PL", "PL"]}'::jsonb),
       atualizado_em = now()
 where chave = 'jogo';

-- pode um jogador desta posição (GR, DEF, MED, AVA) jogar neste papel (LD, DC, EXT…)?
create or replace function public.fantasy_pode_jogar(papel text, pos text, cfg jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce((cfg->'papeis'->papel) ? pos, false);
$$;

-- -------------------------------------------------------------------------
-- gravar a equipa: formação, os 11 pela ordem dos lugares e os suplentes
-- -------------------------------------------------------------------------
create or replace function public.fantasy_guardar_onze(
  p_formacao text, p_onze bigint[], p_banco bigint[], p_capitao bigint, p_vice bigint, p_nome_equipa text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  cfg jsonb := public.fantasy_cfg('jogo');
  papeis jsonb := cfg->'formacoes'->p_formacao;
  n_sup int := coalesce((cfg->>'suplentes')::int, 3);
  j public.fantasy_jornadas;
  todos bigint[] := coalesce(p_onze, '{}') || coalesce(p_banco, '{}');
  erros text[] := '{}';
  ant bigint;
  orc numeric(5,1);
  gasto numeric := 0;
  n_trans int := 0; n_gratis_inel int := 0; pen int := 0;
  r record;
begin
  if eu is null then return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Tens de entrar na tua conta.')); end if;
  if not exists (select 1 from public.perfis where id = eu) then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Perfil não encontrado.'));
  end if;

  j := public.fantasy_jornada_aberta();
  if j.id is null then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Não há nenhuma jornada aberta de momento.'));
  end if;

  if papeis is null then return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Formação desconhecida.')); end if;
  if coalesce(array_length(p_onze, 1), 0) <> 11 or array_position(p_onze, null) is not null then
    erros := erros || text 'Falta escolher um jogador para cada lugar do onze.';
  end if;
  if coalesce(array_length(p_banco, 1), 0) <> n_sup or array_position(p_banco, null) is not null then
    erros := erros || format('O banco tem de ter %s suplentes.', n_sup);
  end if;
  if (select count(distinct x) from unnest(todos) x) <> coalesce(array_length(todos, 1), 0) then
    erros := erros || text 'Há jogadores repetidos.';
  end if;
  if array_length(erros, 1) > 0 then return jsonb_build_object('ok', false, 'erros', to_jsonb(erros)); end if;

  if (select count(*) from public.desporto_jogadores where id = any(todos)) <> 11 + n_sup then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Há jogadores que não existem.'));
  end if;

  -- um jogador por lugar, e só quem pode jogar nesse lugar
  for r in
    select i, dj.posicao, coalesce(dj.nome_curto, dj.nome) as nome, papeis->>(i - 1) as papel
    from generate_subscripts(p_onze, 1) i
    join public.desporto_jogadores dj on dj.id = p_onze[i]
    order by i
  loop
    if not public.fantasy_pode_jogar(r.papel, r.posicao, cfg) then
      erros := erros || format('%s não pode jogar no lugar %s.', r.nome, r.papel);
    end if;
  end loop;

  if p_capitao is null or not (p_capitao = any(p_onze)) then erros := erros || text 'O capitão tem de ser titular.'; end if;
  if p_vice is null or not (p_vice = any(p_onze)) then erros := erros || text 'O vice-capitão tem de ser titular.'; end if;
  if p_capitao = p_vice then erros := erros || text 'Capitão e vice têm de ser jogadores diferentes.'; end if;

  select ej.jornada_id, ej.orcamento into ant, orc
  from public.fantasy_equipa_jornada ej join public.fantasy_jornadas jj on jj.id = ej.jornada_id
  where ej.perfil_id = eu and jj.epoca = j.epoca and jj.numero < j.numero
  order by jj.numero desc limit 1;

  if exists (
    select 1 from unnest(todos) x
    left join public.fantasy_jogadores fj on fj.jogador_id = x
    join public.desporto_jogadores dj on dj.id = x
    where (coalesce(fj.elegivel, false) = false or dj.no_plantel = false)
      and (ant is null or not exists (select 1 from public.fantasy_escolhas e
                                      where e.perfil_id = eu and e.jornada_id = ant and e.jogador_id = x))
  ) then
    erros := erros || text 'Há jogadores que não podem ser escolhidos (já não estão no plantel ou não são elegíveis).';
  end if;
  if (select count(*) from public.fantasy_preco_atual where jogador_id = any(todos)) <> 11 + n_sup then
    erros := erros || text 'Há jogadores ainda sem preço Fantasy.';
  end if;

  if array_length(erros, 1) > 0 then return jsonb_build_object('ok', false, 'erros', to_jsonb(erros)); end if;

  if ant is null then
    orc := (cfg->>'orcamento')::numeric;
  else
    orc := orc + coalesce((
      select sum(pa.preco - e.preco_compra)
      from public.fantasy_escolhas e join public.fantasy_preco_atual pa on pa.jogador_id = e.jogador_id
      where e.perfil_id = eu and e.jornada_id = ant and not (e.jogador_id = any(todos))), 0);
  end if;

  select coalesce(sum(case when e.jogador_id is not null then e.preco_compra else pa.preco end), 0)
    into gasto
  from unnest(todos) x
  join public.fantasy_preco_atual pa on pa.jogador_id = x
  left join public.fantasy_escolhas e on e.perfil_id = eu and e.jornada_id = ant and e.jogador_id = x;

  if gasto > orc then
    return jsonb_build_object('ok', false, 'erros',
      jsonb_build_array(format('Passas o orçamento: gastas %s M€ e tens %s M€.', gasto, orc)));
  end if;

  if ant is not null then
    select count(*) into n_trans from unnest(todos) x
    where not exists (select 1 from public.fantasy_escolhas e where e.perfil_id = eu and e.jornada_id = ant and e.jogador_id = x);
    select count(*) into n_gratis_inel
    from public.fantasy_escolhas e
    left join public.fantasy_jogadores fj on fj.jogador_id = e.jogador_id
    join public.desporto_jogadores dj on dj.id = e.jogador_id
    where e.perfil_id = eu and e.jornada_id = ant and not (e.jogador_id = any(todos))
      and (coalesce(fj.elegivel, false) = false or dj.no_plantel = false);
    pen := greatest(0, n_trans - n_gratis_inel - (cfg->>'transferencias_gratis')::int)
           * (cfg->>'custo_transferencia_extra')::int;
  end if;

  insert into public.fantasy_perfis (perfil_id, nome_equipa)
  values (eu, coalesce(nullif(trim(p_nome_equipa), ''), (select 'Equipa de ' || utilizador from public.perfis where id = eu)))
  on conflict (perfil_id) do update
    set nome_equipa = coalesce(nullif(trim(p_nome_equipa), ''), public.fantasy_perfis.nome_equipa);

  delete from public.fantasy_equipa_jornada where perfil_id = eu and jornada_id = j.id;
  insert into public.fantasy_equipa_jornada (perfil_id, jornada_id, formacao, orcamento, transferencias, penalizacao)
  values (eu, j.id, p_formacao, orc, n_trans, pen);

  insert into public.fantasy_escolhas (perfil_id, jornada_id, jogador_id, titular, posto, ordem_banco, capitao, vice, preco_compra)
  select eu, j.id, x,
         x = any(p_onze),
         case when x = any(p_onze) then array_position(p_onze, x) - 1 end,
         case when x = any(p_banco) then array_position(p_banco, x) end,
         x = p_capitao, x = p_vice,
         coalesce(e.preco_compra, pa.preco)
  from unnest(todos) x
  join public.fantasy_preco_atual pa on pa.jogador_id = x
  left join public.fantasy_escolhas e on e.perfil_id = eu and e.jornada_id = ant and e.jogador_id = x;

  delete from public.fantasy_transferencias where perfil_id = eu and jornada_id = j.id;
  if ant is not null and n_trans > 0 then
    insert into public.fantasy_transferencias (perfil_id, jornada_id, sai, entra, preco_sai, preco_entra, gratis_por_inelegivel)
    select eu, j.id, s.jogador_id, en.x, s.preco_atual, en.preco, s.inelegivel
    from (select row_number() over (order by dj.posicao, e.jogador_id) n, e.jogador_id, pa.preco preco_atual, dj.posicao,
                 (coalesce(fj.elegivel, false) = false or dj.no_plantel = false) inelegivel
          from public.fantasy_escolhas e
          join public.desporto_jogadores dj on dj.id = e.jogador_id
          join public.fantasy_preco_atual pa on pa.jogador_id = e.jogador_id
          left join public.fantasy_jogadores fj on fj.jogador_id = e.jogador_id
          where e.perfil_id = eu and e.jornada_id = ant and not (e.jogador_id = any(todos))) s
    join (select row_number() over (order by dj.posicao, x) n, x, pa.preco, dj.posicao
          from unnest(todos) x
          join public.desporto_jogadores dj on dj.id = x
          join public.fantasy_preco_atual pa on pa.jogador_id = x
          where not exists (select 1 from public.fantasy_escolhas e where e.perfil_id = eu and e.jornada_id = ant and e.jogador_id = x)) en
      on en.n = s.n;
  end if;

  insert into public.fantasy_historico (perfil_id, jornada_id, acao, detalhe)
  values (eu, j.id, 'guardar', jsonb_build_object(
    'onze', to_jsonb(p_onze), 'banco', to_jsonb(p_banco),
    'capitao', p_capitao, 'vice', p_vice, 'formacao', p_formacao,
    'transferencias', n_trans, 'penalizacao', pen, 'gasto', gasto, 'orcamento', orc));

  return jsonb_build_object('ok', true, 'jornada', j.numero, 'formacao', p_formacao,
    'orcamento', orc, 'gasto', gasto, 'saldo', orc - gasto,
    'transferencias', n_trans, 'gratis', (cfg->>'transferencias_gratis')::int, 'penalizacao', pen);
end $$;

revoke all on function public.fantasy_guardar_onze(text, bigint[], bigint[], bigint, bigint, text) from public, anon;
grant execute on function public.fantasy_guardar_onze(text, bigint[], bigint[], bigint, bigint, text) to authenticated;
revoke all on function public.fantasy_pode_jogar(text, text, jsonb) from public, anon;

-- a gravação antiga (15 jogadores) já não serve: quem tiver a página antiga aberta recarrega
create or replace function public.fantasy_guardar_equipa(
  p_titulares bigint[], p_banco bigint[], p_capitao bigint, p_vice bigint, p_nome_equipa text default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object('ok', false, 'erros', jsonb_build_array(
    'A Fantasy passou a ter um jogador por lugar e 3 suplentes. Recarrega a página para montares a equipa.'));
$$;

-- -------------------------------------------------------------------------
-- calcular a jornada: substituições por lugar
-- -------------------------------------------------------------------------
create or replace function public.fantasy_calcular_jornada(p_jornada bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j public.fantasy_jornadas;
  g public.desporto_jogos;
  cfgp jsonb := public.fantasy_cfg('pontuacao');
  cfgj jsonb := public.fantasy_cfg('jogo');
  mult int := (cfgj->>'multiplicador_capitao')::int;
  sofridos int;
  n_jog int; n_eq int := 0;
  eq record; s record; b record;
  usados bigint[]; subs jsonb; onze_final bigint[];
  gr int; def int; med int; ava int;
  form_eq text; por_lugar boolean; serve boolean;
  v_cap bigint; v_vice bigint; cap_ef bigint; pts_onze int; pts_banco int; bonus int; pen int;
begin
  if not public.fantasy_e_admin() then raise exception 'Só um administrador pode calcular jornadas.'; end if;
  select * into j from public.fantasy_jornadas where id = p_jornada;
  if j.id is null then raise exception 'Jornada % não existe.', p_jornada; end if;
  if j.finalizada_em is not null then raise exception 'A jornada % já está finalizada.', j.numero; end if;
  select * into g from public.desporto_jogos where id = j.jogo_id;
  if not exists (select 1 from public.desporto_estatisticas_jogo where jogo_id = g.id) then
    raise exception 'Ainda não há estatísticas para o jogo desta jornada.';
  end if;

  sofridos := case when g.sporting_casa then g.golos_fora else g.golos_casa end;

  delete from public.fantasy_pontos_jogador where jornada_id = j.id;
  insert into public.fantasy_pontos_jogador (jornada_id, jogador_id, pontos, jogou, detalhe)
  select j.id, e.jogador_id, r.pontos, r.jogou, r.detalhe
  from public.desporto_estatisticas_jogo e
  join public.desporto_jogadores dj on dj.id = e.jogador_id
  cross join lateral public.fantasy_pontuar(e, dj.posicao, sofridos, cfgp) r
  where e.jogo_id = g.id;
  get diagnostics n_jog = row_count;

  delete from public.fantasy_resultados where jornada_id = j.id;
  for eq in
    select fp.perfil_id, public.fantasy_jornada_da_equipa(fp.perfil_id, j.id) as jornada_eq
    from public.fantasy_perfis fp
  loop
    continue when eq.jornada_eq is null;
    usados := '{}'; subs := '[]'::jsonb;

    select array_agg(jogador_id) into onze_final
    from public.fantasy_escolhas where perfil_id = eq.perfil_id and jornada_id = eq.jornada_eq and titular;

    -- equipa por lugares (guardada depois desta mudança) ou à moda antiga
    select ej.formacao into form_eq from public.fantasy_equipa_jornada ej
    where ej.perfil_id = eq.perfil_id and ej.jornada_id = eq.jornada_eq;
    por_lugar := coalesce((cfgj->'formacoes') ? form_eq, false)
      and (select count(*) from public.fantasy_escolhas e
           where e.perfil_id = eq.perfil_id and e.jornada_id = eq.jornada_eq and e.titular and e.posto is not null) = 11;

    for s in
      select e.jogador_id, dj.posicao, e.posto
      from public.fantasy_escolhas e
      join public.desporto_jogadores dj on dj.id = e.jogador_id
      left join public.fantasy_pontos_jogador pj on pj.jornada_id = j.id and pj.jogador_id = e.jogador_id
      where e.perfil_id = eq.perfil_id and e.jornada_id = eq.jornada_eq and e.titular and not coalesce(pj.jogou, false)
      order by coalesce(e.posto, 99), case dj.posicao when 'GR' then 0 when 'DEF' then 1 when 'MED' then 2 else 3 end, e.jogador_id
    loop
      for b in
        select e.jogador_id, dj.posicao
        from public.fantasy_escolhas e
        join public.desporto_jogadores dj on dj.id = e.jogador_id
        join public.fantasy_pontos_jogador pj on pj.jornada_id = j.id and pj.jogador_id = e.jogador_id and pj.jogou
        where e.perfil_id = eq.perfil_id and e.jornada_id = eq.jornada_eq and not e.titular
          and not (e.jogador_id = any(usados))
        order by e.ordem_banco
      loop
        if por_lugar then
          -- entra quem pode jogar no lugar de quem não jogou
          serve := public.fantasy_pode_jogar(cfgj->'formacoes'->form_eq->>s.posto, b.posicao, cfgj);
        else
          if (s.posicao = 'GR') <> (b.posicao = 'GR') then continue; end if;
          select count(*) filter (where posicao='GR'), count(*) filter (where posicao='DEF'),
                 count(*) filter (where posicao='MED'), count(*) filter (where posicao='AVA')
            into gr, def, med, ava
          from public.desporto_jogadores
          where id = any(array_remove(onze_final, s.jogador_id) || b.jogador_id);
          serve := public.fantasy_formacao_valida(gr, def, med, ava, cfgj);
        end if;
        if serve then
          onze_final := array_remove(onze_final, s.jogador_id) || b.jogador_id;
          usados := usados || b.jogador_id;
          subs := subs || jsonb_build_object('sai', s.jogador_id, 'entra', b.jogador_id);
          exit;
        end if;
      end loop;
    end loop;

    select max(jogador_id) filter (where capitao), max(jogador_id) filter (where vice)
      into v_cap, v_vice
    from public.fantasy_escolhas where perfil_id = eq.perfil_id and jornada_id = eq.jornada_eq;
    cap_ef := case
      when exists (select 1 from public.fantasy_pontos_jogador where jornada_id = j.id and jogador_id = v_cap and jogou) then v_cap
      when exists (select 1 from public.fantasy_pontos_jogador where jornada_id = j.id and jogador_id = v_vice and jogou) then v_vice
    end;

    select coalesce(sum(pontos), 0) into pts_onze
    from public.fantasy_pontos_jogador where jornada_id = j.id and jogador_id = any(onze_final);
    select coalesce(sum(pj.pontos), 0) into pts_banco
    from public.fantasy_escolhas e
    join public.fantasy_pontos_jogador pj on pj.jornada_id = j.id and pj.jogador_id = e.jogador_id
    where e.perfil_id = eq.perfil_id and e.jornada_id = eq.jornada_eq and not (e.jogador_id = any(onze_final));
    bonus := coalesce((select pontos from public.fantasy_pontos_jogador where jornada_id = j.id and jogador_id = cap_ef), 0) * (mult - 1);
    pen := case when eq.jornada_eq = j.id
                then (select penalizacao from public.fantasy_equipa_jornada where perfil_id = eq.perfil_id and jornada_id = j.id)
                else 0 end;

    insert into public.fantasy_resultados (perfil_id, jornada_id, pontos_onze, pontos_banco, bonus_capitao, penalizacao, total, capitao_efetivo, substituicoes)
    values (eq.perfil_id, j.id, pts_onze, pts_banco, bonus, pen, pts_onze + bonus - pen, cap_ef, subs);
    n_eq := n_eq + 1;
  end loop;

  update public.fantasy_jornadas set calculada_em = now() where id = j.id;
  return jsonb_build_object('ok', true, 'jornada', j.numero, 'jogadores', n_jog, 'equipas', n_eq);
end $$;
