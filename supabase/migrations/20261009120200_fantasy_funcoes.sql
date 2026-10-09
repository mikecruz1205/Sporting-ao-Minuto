-- =========================================================================
-- PONTUAÇÃO DE UM JOGADOR NUM JOGO
-- -------------------------------------------------------------------------
-- Entra a linha de estatísticas, a posição, os golos sofridos pela equipa
-- no jogo inteiro e a tabela de pontos. Sai o total e o detalhe (uma
-- entrada por regra aplicada, para auditoria). Estatística em falta
-- (NULL) não dá pontos e fica assinalada como "sem dados".
-- =========================================================================
create or replace function public.fantasy_pontuar(
  e public.desporto_estatisticas_jogo, pos text, sofridos_equipa integer, cfg jsonb)
returns table (pontos integer, jogou boolean, detalhe jsonb)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  d jsonb := '[]'::jsonb;
  t integer := 0;
  v integer;
  min_cs integer := coalesce((cfg->>'baliza_inviolada_minutos')::int, 60);
  sofridos integer;
  sem text[] := '{}';
begin
  jogou := e.minutos > 0;
  if not jogou then
    pontos := 0;
    detalhe := jsonb_build_array(jsonb_build_object('regra','nao_jogou','pontos',0));
    return next; return;
  end if;

  -- presença
  v := (cfg->>'jogou_1_min')::int;
  t := t + v; d := d || jsonb_build_object('regra','jogou','valor',e.minutos,'pontos',v);
  if e.minutos >= 60 then
    v := (cfg->>'jogou_60_min')::int;
    t := t + v; d := d || jsonb_build_object('regra','jogou_60','valor',e.minutos,'pontos',v);
  end if;

  -- golos e assistências
  if e.golos is null then sem := sem || text 'golos';
  elsif e.golos > 0 then
    v := e.golos * (cfg->'golo'->>pos)::int;
    t := t + v; d := d || jsonb_build_object('regra','golo','valor',e.golos,'pontos',v);
  end if;
  if e.assistencias is null then sem := sem || text 'assistencias';
  elsif e.assistencias > 0 then
    v := e.assistencias * (cfg->>'assistencia')::int;
    t := t + v; d := d || jsonb_build_object('regra','assistencia','valor',e.assistencias,'pontos',v);
  end if;

  -- golos sofridos: com o jogador em campo quando a fonte os dá; senão o
  -- total da equipa, mas só para quem jogou os minutos mínimos
  sofridos := coalesce(e.golos_sofridos, case when e.minutos >= min_cs then sofridos_equipa end);

  -- baliza inviolada (exige os minutos mínimos)
  if e.minutos >= min_cs then
    if sofridos is null then sem := sem || text 'golos_sofridos';
    elsif sofridos = 0 then
      v := coalesce((cfg->'baliza_inviolada'->>pos)::int, 0);
      if v <> 0 then
        t := t + v; d := d || jsonb_build_object('regra','baliza_inviolada','valor',0,'pontos',v);
      end if;
    end if;
  end if;

  -- golos sofridos (guarda-redes e defesas): -1 por cada 2
  if sofridos is not null and sofridos > 0
     and (cfg->'golos_sofridos'->'posicoes') ? pos then
    v := (sofridos / (cfg->'golos_sofridos'->>'por_cada')::int) * (cfg->'golos_sofridos'->>'pontos')::int;
    if v <> 0 then
      t := t + v; d := d || jsonb_build_object('regra','golos_sofridos','valor',sofridos,'pontos',v);
    end if;
  end if;

  -- defesas do guarda-redes
  if pos = 'GR' then
    if e.defesas is null then sem := sem || text 'defesas';
    elsif e.defesas >= (cfg->>'defesas_por_ponto')::int then
      v := e.defesas / (cfg->>'defesas_por_ponto')::int;
      t := t + v; d := d || jsonb_build_object('regra','defesas','valor',e.defesas,'pontos',v);
    end if;
  end if;

  -- recuperações de bola: só quando a fonte as dá (não se estimam)
  if e.recuperacoes is not null and e.recuperacoes >= (cfg->>'recuperacoes_por_ponto')::int then
    v := e.recuperacoes / (cfg->>'recuperacoes_por_ponto')::int;
    t := t + v; d := d || jsonb_build_object('regra','recuperacoes','valor',e.recuperacoes,'pontos',v);
  end if;

  -- disciplina: com vermelho (direto ou por acumulação) os amarelos não descontam
  if e.vermelhos is null then sem := sem || text 'vermelhos';
  elsif e.vermelhos > 0 then
    v := (cfg->>'vermelho')::int;
    t := t + v; d := d || jsonb_build_object('regra','vermelho','valor',e.vermelhos,'pontos',v);
  end if;
  if e.amarelos is null then sem := sem || text 'amarelos';
  elsif e.amarelos > 0 and coalesce(e.vermelhos, 0) = 0 then
    v := (cfg->>'amarelo')::int;
    t := t + v; d := d || jsonb_build_object('regra','amarelo','valor',e.amarelos,'pontos',v);
  end if;

  -- penáltis e autogolos
  if e.pen_falhados is not null and e.pen_falhados > 0 then
    v := e.pen_falhados * (cfg->>'penalti_falhado')::int;
    t := t + v; d := d || jsonb_build_object('regra','penalti_falhado','valor',e.pen_falhados,'pontos',v);
  end if;
  if e.pen_defendidos is not null and e.pen_defendidos > 0 then
    v := e.pen_defendidos * (cfg->>'penalti_defendido')::int;
    t := t + v; d := d || jsonb_build_object('regra','penalti_defendido','valor',e.pen_defendidos,'pontos',v);
  end if;
  if e.autogolos is not null and e.autogolos > 0 then
    v := e.autogolos * (cfg->>'autogolo')::int;
    t := t + v; d := d || jsonb_build_object('regra','autogolo','valor',e.autogolos,'pontos',v);
  end if;

  if array_length(sem, 1) > 0 then
    d := d || jsonb_build_object('regra','sem_dados','campos',to_jsonb(sem),'pontos',0);
  end if;
  pontos := t; detalhe := d;
  return next;
end $$;

-- =========================================================================
-- A EQUIPA EM VIGOR NUMA JORNADA
-- A última guardada até essa jornada (inclusive). Quem não mexe mantém a
-- equipa da jornada anterior.
-- =========================================================================
create or replace function public.fantasy_jornada_da_equipa(p_perfil uuid, p_jornada bigint)
returns bigint language sql stable set search_path = public, pg_temp as $$
  select ej.jornada_id
  from public.fantasy_equipa_jornada ej
  join public.fantasy_jornadas j  on j.id = ej.jornada_id
  join public.fantasy_jornadas alvo on alvo.id = p_jornada
  where ej.perfil_id = p_perfil and j.epoca = alvo.epoca and j.numero <= alvo.numero
  order by j.numero desc limit 1;
$$;

-- formação válida? (contagens do onze dentro dos mínimos e máximos)
create or replace function public.fantasy_formacao_valida(gr int, def int, med int, ava int, cfg jsonb)
returns boolean language sql immutable as $$
  select gr + def + med + ava = 11
     and gr  between (cfg->'onze_min'->>'GR')::int  and (cfg->'onze_max'->>'GR')::int
     and def between (cfg->'onze_min'->>'DEF')::int and (cfg->'onze_max'->>'DEF')::int
     and med between (cfg->'onze_min'->>'MED')::int and (cfg->'onze_max'->>'MED')::int
     and ava between (cfg->'onze_min'->>'AVA')::int and (cfg->'onze_max'->>'AVA')::int;
$$;

-- =========================================================================
-- GUARDAR A EQUIPA (só para a jornada aberta)
-- p_titulares: 11 ids · p_banco: 4 ids por ordem de entrada (o primeiro
-- tem de ser o guarda-redes suplente) · p_capitao e p_vice: titulares
-- =========================================================================
create or replace function public.fantasy_guardar_equipa(
  p_titulares bigint[], p_banco bigint[], p_capitao bigint, p_vice bigint, p_nome_equipa text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  eu uuid := auth.uid();
  cfg jsonb := public.fantasy_cfg('jogo');
  j public.fantasy_jornadas;
  todos bigint[] := coalesce(p_titulares, '{}') || coalesce(p_banco, '{}');
  erros text[] := '{}';
  ant bigint;                -- jornada da equipa anterior
  orc numeric(5,1);          -- orçamento desta jornada
  gasto numeric := 0;
  n_trans int := 0; n_gratis_inel int := 0; pen int := 0;
  c record; formacao text; gr int; def int; med int; ava int;
begin
  if eu is null then return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Tens de entrar na tua conta.')); end if;
  if not exists (select 1 from public.perfis where id = eu) then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Perfil não encontrado.'));
  end if;

  j := public.fantasy_jornada_aberta();
  if j.id is null then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Não há nenhuma jornada aberta de momento.'));
  end if;

  -- ---------- estrutura
  if coalesce(array_length(p_titulares, 1), 0) <> 11 then erros := erros || text 'O onze tem de ter 11 jogadores.'; end if;
  if coalesce(array_length(p_banco, 1), 0) <> 4 then erros := erros || text 'O banco tem de ter 4 jogadores.'; end if;
  if (select count(distinct x) from unnest(todos) x) <> coalesce(array_length(todos, 1), 0) then
    erros := erros || text 'Há jogadores repetidos.';
  end if;
  if array_length(erros, 1) > 0 then return jsonb_build_object('ok', false, 'erros', to_jsonb(erros)); end if;

  -- todos existem?
  if (select count(*) from public.desporto_jogadores where id = any(todos)) <> 15 then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Há jogadores que não existem.'));
  end if;

  -- ---------- posições do plantel (2-5-5-3)
  for c in
    select p.k, (cfg->'plantel'->>p.k)::int as precisa,
           (select count(*) from public.desporto_jogadores dj where dj.id = any(todos) and dj.posicao = p.k) as tem
    from (values ('GR'),('DEF'),('MED'),('AVA')) p(k)
  loop
    if c.tem <> c.precisa then
      erros := erros || format('Precisas de %s %s e tens %s.', c.precisa,
        case c.k when 'GR' then 'guarda-redes' when 'DEF' then 'defesas' when 'MED' then 'médios' else 'avançados' end, c.tem);
    end if;
  end loop;

  -- ---------- formação do onze
  select count(*) filter (where posicao='GR'), count(*) filter (where posicao='DEF'),
         count(*) filter (where posicao='MED'), count(*) filter (where posicao='AVA')
    into gr, def, med, ava
  from public.desporto_jogadores where id = any(p_titulares);
  if not public.fantasy_formacao_valida(gr, def, med, ava, cfg) then
    erros := erros || format('Formação inválida (%s-%s-%s com %s guarda-redes).', def, med, ava, gr);
  end if;
  formacao := def || '-' || med || '-' || ava;
  if (select posicao from public.desporto_jogadores where id = p_banco[1]) <> 'GR' then
    erros := erros || text 'O primeiro do banco tem de ser o guarda-redes suplente.';
  end if;

  -- ---------- capitão e vice
  if p_capitao is null or not (p_capitao = any(p_titulares)) then erros := erros || text 'O capitão tem de ser titular.'; end if;
  if p_vice is null or not (p_vice = any(p_titulares)) then erros := erros || text 'O vice-capitão tem de ser titular.'; end if;
  if p_capitao = p_vice then erros := erros || text 'Capitão e vice têm de ser jogadores diferentes.'; end if;

  -- ---------- equipa anterior (a que está em vigor antes desta jornada)
  select ej.jornada_id, ej.orcamento into ant, orc
  from public.fantasy_equipa_jornada ej join public.fantasy_jornadas jj on jj.id = ej.jornada_id
  where ej.perfil_id = eu and jj.epoca = j.epoca and jj.numero < j.numero
  order by jj.numero desc limit 1;

  -- ---------- elegibilidade: quem entra tem de ser elegível. Quem já
  -- estava e deixou de o ser pode ficar até ser trocado (e essa troca é grátis)
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
  -- todos têm preço?
  if (select count(*) from public.fantasy_preco_atual where jogador_id = any(todos)) <> 15 then
    erros := erros || text 'Há jogadores ainda sem preço Fantasy.';
  end if;

  if array_length(erros, 1) > 0 then return jsonb_build_object('ok', false, 'erros', to_jsonb(erros)); end if;

  -- ---------- orçamento: quem fica mantém o preço de compra; quem entra
  -- paga o preço atual; quem sai é vendido ao preço atual (o lucro ou a
  -- perda entra no orçamento desta jornada — nunca nas anteriores)
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

  -- ---------- transferências (contra a equipa anterior; a primeira equipa é livre)
  if ant is not null then
    select count(*) into n_trans from unnest(todos) x
    where not exists (select 1 from public.fantasy_escolhas e where e.perfil_id = eu and e.jornada_id = ant and e.jogador_id = x);
    -- trocar quem deixou de ser elegível não conta
    select count(*) into n_gratis_inel
    from public.fantasy_escolhas e
    left join public.fantasy_jogadores fj on fj.jogador_id = e.jogador_id
    join public.desporto_jogadores dj on dj.id = e.jogador_id
    where e.perfil_id = eu and e.jornada_id = ant and not (e.jogador_id = any(todos))
      and (coalesce(fj.elegivel, false) = false or dj.no_plantel = false);
    pen := greatest(0, n_trans - n_gratis_inel - (cfg->>'transferencias_gratis')::int)
           * (cfg->>'custo_transferencia_extra')::int;
  end if;

  -- ---------- grava (substitui o que houver para esta jornada)
  -- perfil Fantasy (cria-se na primeira vez que a equipa é válida)
  insert into public.fantasy_perfis (perfil_id, nome_equipa)
  values (eu, coalesce(nullif(trim(p_nome_equipa), ''), (select 'Equipa de ' || utilizador from public.perfis where id = eu)))
  on conflict (perfil_id) do update
    set nome_equipa = coalesce(nullif(trim(p_nome_equipa), ''), public.fantasy_perfis.nome_equipa);

  delete from public.fantasy_equipa_jornada where perfil_id = eu and jornada_id = j.id;
  insert into public.fantasy_equipa_jornada (perfil_id, jornada_id, formacao, orcamento, transferencias, penalizacao)
  values (eu, j.id, formacao, orc, n_trans, pen);

  insert into public.fantasy_escolhas (perfil_id, jornada_id, jogador_id, titular, ordem_banco, capitao, vice, preco_compra)
  select eu, j.id, x,
         x = any(p_titulares),
         case when x = any(p_banco) then array_position(p_banco, x) end,
         x = p_capitao, x = p_vice,
         coalesce(e.preco_compra, pa.preco)
  from unnest(todos) x
  join public.fantasy_preco_atual pa on pa.jogador_id = x
  left join public.fantasy_escolhas e on e.perfil_id = eu and e.jornada_id = ant and e.jogador_id = x;

  -- registo das transferências desta jornada (refeito a cada gravação)
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
    'titulares', to_jsonb(p_titulares), 'banco', to_jsonb(p_banco),
    'capitao', p_capitao, 'vice', p_vice, 'formacao', formacao,
    'transferencias', n_trans, 'penalizacao', pen, 'gasto', gasto, 'orcamento', orc));

  return jsonb_build_object('ok', true, 'jornada', j.numero, 'formacao', formacao,
    'orcamento', orc, 'gasto', gasto, 'saldo', orc - gasto,
    'transferencias', n_trans, 'gratis', (cfg->>'transferencias_gratis')::int, 'penalizacao', pen);
end $$;

-- =========================================================================
-- CALCULAR UMA JORNADA (pontos dos jogadores e das equipas)
-- Recalcula sempre do zero, por isso pode correr as vezes que for preciso
-- enquanto a jornada for provisória — nenhuma substituição se aplica duas
-- vezes. Depois de finalizada já não mexe.
-- =========================================================================
create or replace function public.fantasy_calcular_jornada(p_jornada bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
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

  -- pontos de cada jogador utilizado
  delete from public.fantasy_pontos_jogador where jornada_id = j.id;
  insert into public.fantasy_pontos_jogador (jornada_id, jogador_id, pontos, jogou, detalhe)
  select j.id, e.jogador_id, r.pontos, r.jogou, r.detalhe
  from public.desporto_estatisticas_jogo e
  join public.desporto_jogadores dj on dj.id = e.jogador_id
  cross join lateral public.fantasy_pontuar(e, dj.posicao, sofridos, cfgp) r
  where e.jogo_id = g.id;
  get diagnostics n_jog = row_count;

  -- equipas: a que estava em vigor nesta jornada
  delete from public.fantasy_resultados where jornada_id = j.id;
  for eq in
    select fp.perfil_id, public.fantasy_jornada_da_equipa(fp.perfil_id, j.id) as jornada_eq
    from public.fantasy_perfis fp
  loop
    continue when eq.jornada_eq is null;
    usados := '{}'; subs := '[]'::jsonb;

    select array_agg(jogador_id) into onze_final
    from public.fantasy_escolhas where perfil_id = eq.perfil_id and jornada_id = eq.jornada_eq and titular;

    -- substituições automáticas: titular que não jogou sai para o primeiro
    -- suplente (pela ordem do banco) que jogou e mantém a formação válida;
    -- guarda-redes só por guarda-redes
    for s in
      select e.jogador_id, dj.posicao
      from public.fantasy_escolhas e
      join public.desporto_jogadores dj on dj.id = e.jogador_id
      left join public.fantasy_pontos_jogador pj on pj.jornada_id = j.id and pj.jogador_id = e.jogador_id
      where e.perfil_id = eq.perfil_id and e.jornada_id = eq.jornada_eq and e.titular and not coalesce(pj.jogou, false)
      order by case dj.posicao when 'GR' then 0 when 'DEF' then 1 when 'MED' then 2 else 3 end, e.jogador_id
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
        if (s.posicao = 'GR') <> (b.posicao = 'GR') then continue; end if;
        select count(*) filter (where posicao='GR'), count(*) filter (where posicao='DEF'),
               count(*) filter (where posicao='MED'), count(*) filter (where posicao='AVA')
          into gr, def, med, ava
        from public.desporto_jogadores
        where id = any(array_remove(onze_final, s.jogador_id) || b.jogador_id);
        if public.fantasy_formacao_valida(gr, def, med, ava, cfgj) then
          onze_final := array_remove(onze_final, s.jogador_id) || b.jogador_id;
          usados := usados || b.jogador_id;
          subs := subs || jsonb_build_object('sai', s.jogador_id, 'entra', b.jogador_id);
          exit;
        end if;
      end loop;
    end loop;

    -- capitão: se não jogou, o vice; se nenhum jogou, não há bónus
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
    -- a penalização só conta na jornada em que as transferências foram feitas
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

-- =========================================================================
-- IMPORTAR UM JOGO (calendário, resultado e estatísticas) — idempotente
-- -------------------------------------------------------------------------
-- p = {
--   "fonte": "manual" | "api-football" | ...,
--   "jogo": { "id": 12 }  ou  { "id_externo": "...", "epoca": "2026/27",
--             "competicao": "...", "fase": "...", "data": "...", "casa": "...",
--             "fora": "...", "sporting_casa": true, "golos_casa": 2,
--             "golos_fora": 0, "estado": "terminado", "local": "..." },
--   "jogadores": [ { "jogador_id": 5 }  ou  { "fonte_id": "46672" },
--                  "minutos": 90, "golos": 1, ... } ],
--   "substituir": true   -- apaga quem já não vem (correções)
-- }
-- Se o jogo for de uma jornada ainda não finalizada, recalcula-a.
-- =========================================================================
create or replace function public.fantasy_importar_jogo(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fonte text := coalesce(p->>'fonte', 'manual');
  jg jsonb := p->'jogo';
  v_jogo bigint;
  jr public.fantasy_jornadas;
  x jsonb; jid bigint; n int := 0; ids bigint[] := '{}';
  calc jsonb;
  sinc bigint;
begin
  if not public.fantasy_e_admin() then raise exception 'Só um administrador pode importar jogos.'; end if;
  insert into public.desporto_sincronizacoes (fonte, tipo, detalhe) values (v_fonte, 'jogo', jg) returning id into sinc;

  if jg ? 'id' then
    v_jogo := (jg->>'id')::bigint;
    update public.desporto_jogos set
      golos_casa = coalesce((jg->>'golos_casa')::smallint, golos_casa),
      golos_fora = coalesce((jg->>'golos_fora')::smallint, golos_fora),
      estado     = coalesce(jg->>'estado', estado),
      atualizado_em = now()
    where id = v_jogo;
    if not found then raise exception 'Jogo % não existe.', v_jogo; end if;
  else
    insert into public.desporto_jogos (epoca, competicao, fase, data, casa, fora, sporting_casa,
                                       golos_casa, golos_fora, estado, local, fonte, id_externo)
    values (jg->>'epoca', jg->>'competicao', jg->>'fase', (jg->>'data')::timestamptz, jg->>'casa', jg->>'fora',
            (jg->>'sporting_casa')::boolean, (jg->>'golos_casa')::smallint, (jg->>'golos_fora')::smallint,
            coalesce(jg->>'estado', 'agendado'), jg->>'local', v_fonte, jg->>'id_externo')
    on conflict (fonte, id_externo) do update set
      competicao = excluded.competicao, fase = excluded.fase, data = excluded.data,
      casa = excluded.casa, fora = excluded.fora, sporting_casa = excluded.sporting_casa,
      golos_casa = excluded.golos_casa, golos_fora = excluded.golos_fora,
      estado = excluded.estado, local = coalesce(excluded.local, public.desporto_jogos.local),
      atualizado_em = now()
    returning id into v_jogo;
  end if;

  select * into jr from public.fantasy_jornadas fj where fj.jogo_id = v_jogo;
  if jr.finalizada_em is not null and jsonb_array_length(coalesce(p->'jogadores', '[]')) > 0 then
    raise exception 'A jornada % já está finalizada: as estatísticas não podem mudar.', jr.numero;
  end if;

  for x in select * from jsonb_array_elements(coalesce(p->'jogadores', '[]')) loop
    jid := coalesce((x->>'jogador_id')::bigint,
                    (select i.jogador_id from public.desporto_jogador_ids i where i.fonte = v_fonte and i.id_externo = x->>'fonte_id'));
    if jid is null then raise exception 'Jogador desconhecido: %', x; end if;
    if x->>'minutos' is null then raise exception 'Faltam os minutos do jogador %.', jid; end if;
    insert into public.desporto_estatisticas_jogo (jogo_id, jogador_id, titular, minutos, golos, assistencias,
      amarelos, vermelhos, pen_marcados, pen_falhados, pen_defendidos, defesas, golos_sofridos, autogolos, recuperacoes, fonte)
    values (v_jogo, jid, (x->>'titular')::boolean, (x->>'minutos')::smallint, (x->>'golos')::smallint,
      (x->>'assistencias')::smallint, (x->>'amarelos')::smallint, (x->>'vermelhos')::smallint,
      (x->>'pen_marcados')::smallint, (x->>'pen_falhados')::smallint, (x->>'pen_defendidos')::smallint,
      (x->>'defesas')::smallint, (x->>'golos_sofridos')::smallint, (x->>'autogolos')::smallint,
      (x->>'recuperacoes')::smallint, v_fonte)
    on conflict (jogo_id, jogador_id) do update set
      titular = excluded.titular, minutos = excluded.minutos, golos = excluded.golos,
      assistencias = excluded.assistencias, amarelos = excluded.amarelos, vermelhos = excluded.vermelhos,
      pen_marcados = excluded.pen_marcados, pen_falhados = excluded.pen_falhados,
      pen_defendidos = excluded.pen_defendidos, defesas = excluded.defesas,
      golos_sofridos = excluded.golos_sofridos, autogolos = excluded.autogolos,
      recuperacoes = excluded.recuperacoes, fonte = excluded.fonte, atualizado_em = now();
    ids := ids || jid; n := n + 1;
  end loop;

  if coalesce((p->>'substituir')::boolean, false) then
    delete from public.desporto_estatisticas_jogo e where e.jogo_id = v_jogo and not (e.jogador_id = any(ids));
  end if;

  if jr.id is not null and n > 0 then
    calc := public.fantasy_calcular_jornada(jr.id);
  end if;

  update public.desporto_sincronizacoes set fim = now(), estado = 'ok', registos = n where id = sinc;
  return jsonb_build_object('ok', true, 'jogo_id', v_jogo, 'jogadores', n, 'calculo', calc);
end $$;

-- =========================================================================
-- FINALIZAR UMA JORNADA e atualizar os preços
-- Depois disto os pontos ficam fixos. Os preços variam com a média de
-- pontos das últimas N jornadas finalizadas (regras em fantasy_config).
-- =========================================================================
create or replace function public.fantasy_finalizar_jornada(p_jornada bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.fantasy_jornadas;
  cfg jsonb := public.fantasy_cfg('precos');
  v jsonb := cfg->'variacao';
  n int;
begin
  if not public.fantasy_e_admin() then raise exception 'Só um administrador pode finalizar jornadas.'; end if;
  select * into j from public.fantasy_jornadas where id = p_jornada;
  if j.calculada_em is null then raise exception 'A jornada % ainda não foi calculada.', j.numero; end if;
  if j.finalizada_em is not null then raise exception 'A jornada % já estava finalizada.', j.numero; end if;
  update public.fantasy_jornadas set finalizada_em = now() where id = j.id;

  with ultimas as (
    select id from public.fantasy_jornadas
    where epoca = j.epoca and finalizada_em is not null and numero <= j.numero
    order by numero desc limit (v->>'jornadas')::int
  ), medias as (
    select pj.jogador_id, avg(pj.pontos) media, bool_or(pj.jogou) jogou
    from public.fantasy_pontos_jogador pj where pj.jornada_id in (select id from ultimas)
    group by pj.jogador_id
  ), novos as (
    select m.jogador_id, pa.preco,
           case when m.media >= (v->>'subir_media')::numeric then (v->>'passo')::numeric
                when m.jogou and m.media <= (v->>'descer_media')::numeric then -(v->>'passo')::numeric
                else 0 end as delta, m.media
    from medias m join public.fantasy_preco_atual pa on pa.jogador_id = m.jogador_id
  )
  insert into public.fantasy_precos (jogador_id, preco, motivo)
  select jogador_id,
         least(greatest(preco + delta, (cfg->>'minimo')::numeric), (cfg->>'maximo')::numeric),
         format('jornada %s: média de %s pontos nas últimas %s jornadas', j.numero, round(media, 1), v->>'jornadas')
  from novos where delta <> 0
    and least(greatest(preco + delta, (cfg->>'minimo')::numeric), (cfg->>'maximo')::numeric) <> preco;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'jornada', j.numero, 'precos_alterados', n);
end $$;

-- =========================================================================
-- PREÇOS INICIAIS — base da posição + jogos e golos da época
-- Só para quem ainda não tem preço. Fórmula em fantasy_config.precos.
-- =========================================================================
create or replace function public.fantasy_definir_precos_iniciais(p_epoca text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb := public.fantasy_cfg('precos'); n int;
begin
  if not public.fantasy_e_admin() then raise exception 'Só um administrador.'; end if;
  insert into public.fantasy_precos (jogador_id, preco, motivo)
  select dj.id,
    least(greatest(public.fantasy_arredondar(
        (cfg->'base'->>dj.posicao)::numeric
        + least(coalesce(es.jogos, 0) * (cfg->>'por_jogo')::numeric, (cfg->>'max_por_jogos')::numeric)
        + least(coalesce(es.golos, 0) * (cfg->'por_golo'->>dj.posicao)::numeric, (cfg->>'max_por_golos')::numeric),
        (cfg->>'arredondar')::numeric), (cfg->>'minimo')::numeric), (cfg->>'maximo')::numeric),
    case when es.jogador_id is null
      then format('inicial: base %s (%s); sem estatísticas da época %s', cfg->'base'->>dj.posicao, dj.posicao, p_epoca)
      else format('inicial: base %s (%s) + %s jogos + %s golos na época %s (%s, %s)',
                  cfg->'base'->>dj.posicao, dj.posicao, coalesce(es.jogos::text, 'sem dados'),
                  coalesce(es.golos::text, 'sem dados'), p_epoca, es.fonte, to_char(es.atualizado_em, 'DD/MM/YYYY'))
    end
  from public.desporto_jogadores dj
  left join lateral (
    select * from public.desporto_estatisticas_epoca x
    where x.jogador_id = dj.id and x.epoca = p_epoca and x.competicao = 'todas'
    order by x.atualizado_em desc limit 1) es on true
  where dj.no_plantel
    and not exists (select 1 from public.fantasy_precos fp where fp.jogador_id = dj.id);
  get diagnostics n = row_count;
  return n;
end $$;
