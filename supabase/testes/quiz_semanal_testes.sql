-- =========================================================================
-- Testes do Desafio da Semana (migração 20261019150000).
-- Tudo dentro de um bloco que acaba com uma exceção de propósito: a
-- transação é desfeita e não fica nada. Esperado: 'RELATORIO ... falhas=0'.
-- Enquanto a migração não estiver aplicada, corre-se o ficheiro da
-- migração e este no MESMO pedido.
-- =========================================================================
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  liga bigint := 990777;
  d jsonb; r jsonb; certas_esperadas int := 0; resp smallint[] := '{}'; i int; n int;
  falhas text[] := '{}'; passos int := 0;
begin
  insert into auth.users (id, email) values (a, 'tqs-a@exemplo.invalid'), (b, 'tqs-b@exemplo.invalid'), (c, 'tqs-c@exemplo.invalid');
  insert into perfis (id, utilizador, nome_mostrado) values (a, 'tqs_a', 'tqs_a'), (b, 'tqs_b', 'tqs_b'), (c, 'tqs_c', 'tqs_c');
  insert into fantasy_perfis (perfil_id, nome_equipa) values (a, 'Equipa A'), (b, 'Equipa B');
  insert into fantasy_ligas (id, nome, codigo, dono) overriding system value values (liga, 'Liga do quiz', 'TQSTQS', a);
  insert into fantasy_liga_membros (liga_id, perfil_id) values (liga, a), (liga, b);

  -- 1. o visitante vê as perguntas, sem a resposta certa, e não lê as tabelas
  set local role anon;
  d := quiz_semanal();
  n := jsonb_array_length(d->'perguntas');
  if n < 3 then falhas := falhas || ('poucas perguntas: ' || n); end if;
  if exists (select 1 from jsonb_array_elements(d->'perguntas') p where p ? 'correta' or p ? 'explicacao') then falhas := falhas || 'resposta à vista'; end if;
  if exists (select 1 from jsonb_array_elements(d->'perguntas') p where jsonb_array_length(p->'opcoes') < 3 or not (p->'fonte' ? 'nome')) then falhas := falhas || 'opções ou fonte'; end if;
  begin perform 1 from quiz_semanal limit 1; falhas := falhas || 'anon leu quiz_semanal'; exception when insufficient_privilege then null; end;
  begin perform quiz_semanal_responder('{0}'); falhas := falhas || 'anon respondeu'; exception when insufficient_privilege then null; end;
  reset role;
  passos := passos + 1;

  -- 2. as mesmas perguntas para todos: pedir outra vez não muda nada
  if (quiz_semanal()->'perguntas') <> (d->'perguntas') then falhas := falhas || 'perguntas mudaram'; end if;
  if (select count(*) from quiz_semanal) < 1 then falhas := falhas || 'semana não guardada'; end if;
  passos := passos + 1;

  -- 3. responder: todas, uma vez; as certas contam-se no servidor
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := quiz_semanal_responder('{0}');
  if (r->>'ok')::boolean then falhas := falhas || 'aceitou respostas a menos'; end if;
  for i in 0..n - 1 loop
    resp := resp || (case when i % 2 = 0 then ((select perguntas->i->>'correta' from quiz_semanal order by criado_em desc limit 1))::smallint else 3::smallint end);
  end loop;
  select count(*) into certas_esperadas from generate_series(0, n - 1) k, quiz_semanal q
  where q.semana = d->>'semana' and resp[k + 1] = (q.perguntas->k->>'correta')::int;
  r := quiz_semanal_responder(resp);
  if not (r->>'ok')::boolean or (r->>'certas')::int <> certas_esperadas then falhas := falhas || ('contas: ' || r::text); end if;
  if not exists (select 1 from jsonb_array_elements(r->'perguntas') p where p ? 'correta') then falhas := falhas || 'depois de responder não mostra as certas'; end if;
  r := quiz_semanal_responder(resp);
  if (r->>'ok')::boolean or r->>'erro' not like 'Já respondeste%' then falhas := falhas || 'respondeu duas vezes'; end if;
  passos := passos + 1;

  -- 4. classificação: geral para todos; da liga só para os membros
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform quiz_semanal_responder((select array_agg((perguntas->k->>'correta')::smallint order by k) from quiz_semanal, generate_series(0, n - 1) k where semana = d->>'semana'));
  if (select utilizador from quiz_semanal_classificacao() limit 1) <> 'tqs_b' then falhas := falhas || 'quem acertou tudo devia ir à frente'; end if;
  if (select count(*) from quiz_semanal_classificacao(liga) where utilizador in ('tqs_a', 'tqs_b')) <> 2 then falhas := falhas || 'classificação da liga'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin perform * from quiz_semanal_classificacao(liga); falhas := falhas || 'não membro viu a liga'; exception when others then null; end;
  passos := passos + 1;

  -- 5. cada um só lê as suas respostas
  set local role authenticated;
  if exists (select 1 from quiz_semanal_respostas where perfil_id <> c) then falhas := falhas || 'leu respostas dos outros'; end if;
  reset role;
  passos := passos + 1;

  raise exception 'RELATORIO passos=% falhas=% % perguntas=%', passos, cardinality(falhas), falhas, (select jsonb_agg(p->>'pergunta') from jsonb_array_elements(d->'perguntas') p);
end
$$;
