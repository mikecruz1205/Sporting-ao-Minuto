-- =========================================================================
-- Testes da Fantasy por lugares (migração 20261019120000).
-- Tudo dentro de um bloco que acaba com uma exceção de propósito: a
-- transação é desfeita e não fica nada. Esperado: 'RELATORIO ... falhas=0'.
-- Enquanto a migração não estiver aplicada, corre-se o ficheiro da
-- migração e este no MESMO pedido: a exceção do fim desfaz as duas coisas.
-- =========================================================================
do $$
declare
  a uuid := gen_random_uuid();
  cfg jsonb := public.fantasy_cfg('jogo');
  papeis jsonb := cfg->'formacoes'->'4-3-3';
  jr public.fantasy_jornadas := public.fantasy_jornada_aberta();
  onze bigint[] := '{}'; banco bigint[] := '{}'; usados bigint[] := '{}';
  ld bigint; med_banco bigint; def_banco bigint; extra bigint;
  r jsonb; papel text; p bigint; i int;
  falhas text[] := '{}'; passos int := 0;
begin
  if jr.id is null then raise exception 'sem jornada aberta para testar'; end if;
  insert into auth.users (id, email) values (a, 'tfl-a@exemplo.invalid');
  insert into perfis (id, utilizador, nome_mostrado) values (a, 'tfl_a', 'tfl_a');

  -- um onze 4-3-3 com quem pode jogar em cada lugar (do plantel, com preço e elegível)
  for i in 0..10 loop
    papel := papeis->>i;
    select dj.id into p
    from desporto_jogadores dj
    join fantasy_preco_atual pa on pa.jogador_id = dj.id
    join fantasy_jogadores fj on fj.jogador_id = dj.id and fj.elegivel
    where dj.no_plantel and fantasy_pode_jogar(papel, dj.posicao, cfg) and not (dj.id = any(usados))
    order by pa.preco, dj.id limit 1;
    onze := onze || p; usados := usados || p;
  end loop;
  ld := onze[5];                                                          -- lugar 4 = LD
  -- banco: 1.º um médio, 2.º um defesa, 3.º um guarda-redes
  select dj.id into med_banco from desporto_jogadores dj join fantasy_preco_atual pa on pa.jogador_id = dj.id join fantasy_jogadores fj on fj.jogador_id = dj.id and fj.elegivel
    where dj.no_plantel and dj.posicao = 'MED' and not (dj.id = any(usados)) order by pa.preco limit 1;
  usados := usados || med_banco;
  select dj.id into def_banco from desporto_jogadores dj join fantasy_preco_atual pa on pa.jogador_id = dj.id join fantasy_jogadores fj on fj.jogador_id = dj.id and fj.elegivel
    where dj.no_plantel and dj.posicao = 'DEF' and not (dj.id = any(usados)) order by pa.preco limit 1;
  usados := usados || def_banco;
  select dj.id into extra from desporto_jogadores dj join fantasy_preco_atual pa on pa.jogador_id = dj.id join fantasy_jogadores fj on fj.jogador_id = dj.id and fj.elegivel
    where dj.no_plantel and dj.posicao = 'GR' and not (dj.id = any(usados)) order by pa.preco limit 1;
  banco := array[med_banco, def_banco, extra];

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- 1. a configuração tem as formações do site e 3 suplentes
  if (cfg->>'suplentes')::int <> 3 or jsonb_array_length(papeis) <> 11 then falhas := falhas || 'configuração'; end if;
  if not fantasy_pode_jogar('EXT', 'AVA', cfg) or fantasy_pode_jogar('LD', 'MED', cfg) then falhas := falhas || 'papéis'; end if;
  passos := passos + 1;

  -- 2. erros: médio a defesa direito, banco com 4, capitão no banco, formação desconhecida
  r := fantasy_guardar_onze('4-3-3', onze[1:4] || med_banco || onze[6:11], array[ld, def_banco, extra], onze[10], onze[9]);
  if (r->>'ok')::boolean or r->'erros'->>0 not like '%não pode jogar no lugar LD%' then falhas := falhas || ('médio a LD: ' || r::text); end if;
  r := fantasy_guardar_onze('4-3-3', onze, banco || onze[1], onze[10], onze[9]);
  if (r->>'ok')::boolean then falhas := falhas || 'aceitou 4 no banco'; end if;
  r := fantasy_guardar_onze('4-3-3', onze, banco, med_banco, onze[9]);
  if (r->>'ok')::boolean then falhas := falhas || 'capitão no banco'; end if;
  r := fantasy_guardar_onze('9-9-9', onze, banco, onze[10], onze[9]);
  if (r->>'ok')::boolean then falhas := falhas || 'formação inventada'; end if;
  r := fantasy_guardar_onze('4-3-3', onze[1:10] || null::bigint, banco, onze[10], onze[9]);
  if (r->>'ok')::boolean then falhas := falhas || 'lugar vazio'; end if;
  passos := passos + 1;

  -- 3. a equipa certa grava, com o lugar de cada titular e o banco por ordem
  r := fantasy_guardar_onze('4-3-3', onze, banco, onze[10], onze[9], 'Equipa de teste');
  if not (r->>'ok')::boolean then falhas := falhas || ('não gravou: ' || r::text); end if;
  if (select formacao from fantasy_equipa_jornada where perfil_id = a and jornada_id = jr.id) <> '4-3-3' then falhas := falhas || 'formação'; end if;
  if (select posto from fantasy_escolhas where perfil_id = a and jornada_id = jr.id and jogador_id = ld) <> 4 then falhas := falhas || 'posto do LD'; end if;
  if (select string_agg(ordem_banco::text, ',' order by ordem_banco) from fantasy_escolhas where perfil_id = a and jornada_id = jr.id and not titular) <> '1,2,3' then falhas := falhas || 'banco'; end if;
  passos := passos + 1;

  -- 4. a gravação antiga (15 jogadores) já não grava
  r := fantasy_guardar_equipa(onze, banco || onze[1], onze[10], onze[9]);
  if (r->>'ok')::boolean or r->'erros'->>0 not like '%Recarrega a página%' then falhas := falhas || 'função antiga'; end if;
  passos := passos + 1;

  -- 5. substituição por lugar: o LD não jogou; o 1.º do banco (médio) não pode
  --    jogar a LD, por isso entra o 2.º (defesa)
  reset role;
  insert into fantasy_admins (perfil_id) values (a);
  insert into desporto_estatisticas_jogo (jogo_id, jogador_id, titular, minutos, golos, assistencias, amarelos, vermelhos, fonte)
  select jr.jogo_id, x, true, 90, 0, 0, 0, 0, 'teste' from unnest(array_remove(onze, ld) || med_banco || def_banco) x
  on conflict do nothing;
  perform fantasy_calcular_jornada(jr.id);
  r := (select substituicoes from fantasy_resultados where perfil_id = a and jornada_id = jr.id);
  if r is distinct from jsonb_build_array(jsonb_build_object('sai', ld, 'entra', def_banco)) then
    falhas := falhas || ('substituição: ' || coalesce(r::text, 'nenhuma'));
  end if;
  passos := passos + 1;

  raise exception 'RELATORIO passos=% falhas=% %', passos, cardinality(falhas), falhas;
end
$$;
