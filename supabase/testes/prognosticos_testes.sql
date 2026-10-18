-- =========================================================================
-- Testes dos prognósticos e do Homem do jogo (migração 20261018130000).
-- Tudo dentro de um bloco que acaba com uma exceção de propósito: a
-- transação é desfeita e não fica nada. Esperado: 'RELATORIO ... falhas=0'.
-- =========================================================================
do $$
declare
  a uuid := gen_random_uuid();   -- membro da liga
  b uuid := gen_random_uuid();   -- membro da liga
  c uuid := gen_random_uuid();   -- fora da liga
  futuro bigint := 990001; passado bigint := 990002; antigo bigint := 990003;
  liga bigint := 990001;
  jogador bigint;
  r jsonb; n int; falhas text[] := '{}'; passos int := 0;
begin
  select id into jogador from desporto_jogadores where no_plantel limit 1;
  insert into auth.users (id, email) values (a, 'tp-a@exemplo.invalid'), (b, 'tp-b@exemplo.invalid'), (c, 'tp-c@exemplo.invalid');
  insert into perfis (id, utilizador, nome_mostrado) values (a, 'tp_a', 'tp_a'), (b, 'tp_b', 'tp_b'), (c, 'tp_c', 'tp_c');
  insert into desporto_jogos (id, epoca, competicao, data, casa, fora, sporting_casa, fonte, id_externo, golos_casa, golos_fora) overriding system value values
    (futuro,  '2026/27', 'Teste', now() + interval '2 days', 'Sporting CP', 'Rival', true,  'teste', 'tp1', null, null),
    (passado, '2026/27', 'Teste', now() - interval '3 hours', 'Rival', 'Sporting CP', false, 'teste', 'tp2', 1, 2),
    (antigo,  '2026/27', 'Teste', now() - interval '5 days',  'Sporting CP', 'Rival', true,  'teste', 'tp3', 0, 0);
  insert into fantasy_perfis (perfil_id, nome_equipa) values (a, 'Equipa A'), (b, 'Equipa B');
  insert into fantasy_ligas (id, nome, codigo, dono) overriding system value values (liga, 'Liga de teste', 'TPTPTP', a);
  insert into fantasy_liga_membros (liga_id, perfil_id) values (liga, a), (liga, b);

  -- 1. sem sessão não se guarda
  perform set_config('request.jwt.claims', '', true);
  begin perform prognostico_guardar(futuro, 2, 0); falhas := falhas || 'guardou sem sessão'; exception when others then null; end;
  passos := passos + 1;

  -- 2. antes do jogo guarda e pode corrigir
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform prognostico_guardar(futuro, 1, 0);
  perform prognostico_guardar(futuro, 2, 0);
  if (select golos_sporting from prognosticos where perfil_id = a and jogo_id = futuro) <> 2 then falhas := falhas || 'não corrigiu'; end if;
  passos := passos + 1;

  -- 3. depois do início fecha
  begin perform prognostico_guardar(passado, 2, 1); falhas := falhas || 'guardou depois do início'; exception when others then null; end;
  begin perform prognostico_guardar(futuro, 25, 0); falhas := falhas || 'aceitou 25 golos'; exception when others then null; end;
  passos := passos + 1;

  -- 4. pontos: exato 3, vencedor certo 1, errado 0 (com o Sporting em casa e fora)
  if prognostico_pontos(2, 1, false, 1, 2) <> 3 then falhas := falhas || 'exato fora'; end if;
  if prognostico_pontos(3, 0, false, 1, 2) <> 1 then falhas := falhas || 'vencedor fora'; end if;
  if prognostico_pontos(0, 1, false, 1, 2) <> 0 then falhas := falhas || 'errado fora'; end if;
  if prognostico_pontos(1, 1, true, 0, 0) <> 1 then falhas := falhas || 'empate certo'; end if;
  if prognostico_pontos(1, 0, true, null, null) is not null then falhas := falhas || 'sem resultado devia ser null'; end if;
  passos := passos + 1;

  -- 5. pontos na classificação da liga (inserção direta para simular jogos já passados)
  reset role;
  insert into prognosticos (perfil_id, jogo_id, golos_sporting, golos_adversario) values
    (a, passado, 2, 1), (a, antigo, 0, 0), (b, passado, 3, 0), (b, antigo, 1, 0), (c, passado, 2, 1);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select pontos into n from prognosticos_classificacao_liga(liga) where utilizador = 'tp_a';
  if n <> 6 then falhas := falhas || ('pontos de a: ' || n); end if;          -- 3 + 3
  select pontos into n from prognosticos_classificacao_liga(liga) where utilizador = 'tp_b';
  if n <> 1 then falhas := falhas || ('pontos de b: ' || n); end if;          -- 1 + 0
  select count(*) into n from prognosticos_classificacao_liga(liga);
  if n <> 2 then falhas := falhas || ('membros na tabela: ' || n); end if;    -- c não é membro
  passos := passos + 1;

  -- 6. só se veem os próprios prognósticos; quem não é membro não vê a liga
  select count(*) into n from prognosticos;
  if n <> 3 then falhas := falhas || ('a vê ' || n || ' prognósticos'); end if;   -- os seus 3
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin perform * from prognosticos_classificacao_liga(liga); falhas := falhas || 'não membro viu a liga'; exception when others then null; end;
  begin insert into prognosticos (perfil_id, jogo_id, golos_sporting, golos_adversario) values (c, futuro, 9, 9); falhas := falhas || 'inseriu direto'; exception when others then null; end;
  r := prognosticos_resumo(futuro);
  if (r->>'total')::int <> 1 or (r->>'vitoria')::int <> 1 then falhas := falhas || ('resumo: ' || r::text); end if;
  passos := passos + 1;

  -- 7. homem do jogo: antes do fim não, na janela sim (e muda o voto), fora da janela não
  begin perform homem_do_jogo_votar(futuro, jogador); falhas := falhas || 'votou antes do jogo'; exception when others then null; end;
  perform homem_do_jogo_votar(passado, jogador);
  perform homem_do_jogo_votar(passado, jogador);
  begin perform homem_do_jogo_votar(antigo, jogador); falhas := falhas || 'votou depois de fechar'; exception when others then null; end;
  begin perform homem_do_jogo_votar(passado, -1); falhas := falhas || 'votou em quem não está no plantel'; exception when others then null; end;
  select votos into n from homem_do_jogo_resultados(passado) where jogador_id = jogador;
  if n <> 1 then falhas := falhas || ('votos: ' || coalesce(n, 0)); end if;
  passos := passos + 1;
  reset role;

  raise exception 'RELATORIO passos=% falhas=% %', passos, coalesce(array_length(falhas, 1), 0), array_to_string(falhas, ' | ');
end $$;
