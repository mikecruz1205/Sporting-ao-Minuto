-- =========================================================================
-- Testes do recorde do Quiz Leonino (supabase/migrations/
-- 20261016120000_quiz_recordes.sql).
--
-- Corre tudo dentro de um bloco que acaba com uma exceção de propósito:
-- a transação é desfeita e não fica nenhum utilizador de teste. O
-- resultado vem na mensagem do erro ('RELATORIO ...').
-- =========================================================================
do $$
declare
  u uuid := gen_random_uuid();
  v uuid := gen_random_uuid();
  r jsonb;
  falhas text[] := '{}';
  passos int := 0;
  n int;
begin
  insert into auth.users (id, email) values (u, 'teste-quiz-u@exemplo.invalid'), (v, 'teste-quiz-v@exemplo.invalid');
  insert into perfis (id, utilizador, nome_mostrado) values (u, 'teste_quiz_u', 'teste_quiz_u'), (v, 'teste_quiz_v', 'teste_quiz_v');

  -- 1. sem sessão não se grava
  perform set_config('request.jwt.claims', '', true);
  begin
    perform quiz_guardar_recorde(100);
    falhas := falhas || 'gravou sem sessão';
  exception when others then null;
  end;
  passos := passos + 1;

  -- 2. com sessão grava e devolve o melhor
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  r := quiz_guardar_recorde(300);
  if (r->>'melhor')::int <> 300 or (r->>'jogos')::int <> 1 then falhas := falhas || ('primeiro: ' || r::text); end if;
  passos := passos + 1;

  -- 3. um resultado pior não baixa o recorde, mas conta o jogo
  r := quiz_guardar_recorde(20);
  if (r->>'melhor')::int <> 300 or (r->>'jogos')::int <> 2 then falhas := falhas || ('pior: ' || r::text); end if;
  passos := passos + 1;

  -- 4. um melhor sobe
  r := quiz_guardar_recorde(1906);
  if (r->>'melhor')::int <> 1906 then falhas := falhas || ('melhor: ' || r::text); end if;
  passos := passos + 1;

  -- 5. valores fora da escada são recusados
  begin
    perform quiz_guardar_recorde(999);
    falhas := falhas || 'aceitou 999';
  exception when others then null;
  end;
  begin
    perform quiz_guardar_recorde(-10);
    falhas := falhas || 'aceitou -10';
  exception when others then null;
  end;
  begin
    perform quiz_guardar_recorde(5000);
    falhas := falhas || 'aceitou 5000';
  exception when others then null;
  end;
  passos := passos + 1;

  -- 6. outra conta não vê o recorde da primeira (RLS) nem consegue escrever direto na tabela
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from quiz_recordes;
  if n <> 0 then falhas := falhas || ('a outra conta vê ' || n || ' recordes'); end if;
  begin
    insert into quiz_recordes (perfil_id, melhor) values (v, 1906);
    falhas := falhas || 'inseriu direto na tabela';
  exception when others then null;
  end;
  begin
    update quiz_recordes set melhor = 0 where perfil_id = u;
    get diagnostics n = row_count;
    if n > 0 then falhas := falhas || 'alterou o recorde de outra conta'; end if;
  exception when others then null;
  end;
  passos := passos + 1;

  -- 7. a própria conta vê só o seu
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  select count(*) into n from quiz_recordes;
  if n <> 1 then falhas := falhas || ('a própria conta vê ' || n || ' recordes'); end if;
  passos := passos + 1;
  reset role;

  raise exception 'RELATORIO passos=% falhas=%', passos, coalesce(array_length(falhas, 1), 0)
    using detail = array_to_string(falhas, ' | ');
end $$;
