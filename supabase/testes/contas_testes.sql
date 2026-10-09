-- =========================================================================
-- Testes da recuperação de palavra-passe (supabase/migrations/
-- 20261009180000_contas_recuperacao.sql) e da leitura do chat.
--
-- Corre tudo dentro de um bloco que acaba com uma exceção de propósito:
-- a transação é desfeita e não fica nenhum utilizador de teste. O
-- resultado vem na mensagem do erro ('RELATORIO ...').
-- =========================================================================
do $$
declare
  u uuid := gen_random_uuid();
  codigo text;
  r text;
  falhas text[] := '{}';
  passos int := 0;
  hash_antes text;
  i int;
  ok boolean;
begin
  insert into auth.users (id, email, encrypted_password)
  values (u, 'teste-rec@exemplo.invalid', extensions.crypt('antiga-123', extensions.gen_salt('bf', 10)));
  insert into perfis (id, utilizador, nome_mostrado) values (u, 'teste_rec', 'teste_rec');
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), u);
  select encrypted_password into hash_antes from auth.users where id = u;

  -- 1. sem sessão não se gera código
  perform set_config('request.jwt.claims', '', true);
  begin
    perform conta_gerar_codigo();
    falhas := falhas || 'gerou código sem sessão';
  exception when others then null;
  end;
  passos := passos + 1;

  -- 2. com sessão gera um código XXXX-XXXX-XXXX-XXXX
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  codigo := conta_gerar_codigo();
  if codigo !~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$' then falhas := falhas || ('formato: ' || codigo); end if;
  if not (select tem_codigo from conta_estado_recuperacao()) then falhas := falhas || 'estado sem código'; end if;
  if exists (select 1 from contas_recuperacao where codigo_hash like '%' || replace(codigo, '-', '') || '%') then
    falhas := falhas || 'código guardado em claro';
  end if;
  passos := passos + 1;

  -- 3. código errado → codigo_invalido, palavra-passe igual
  perform set_config('request.jwt.claims', '', true);
  r := conta_recuperar('teste_rec', 'AAAA-AAAA-AAAA-AAAA', 'nova-palavra-1');
  if r <> 'codigo_invalido' then falhas := falhas || ('código errado deu ' || r); end if;
  if (select encrypted_password from auth.users where id = u) <> hash_antes then falhas := falhas || 'mudou com código errado'; end if;
  passos := passos + 1;

  -- 4. utilizador que não existe → a mesma resposta
  r := conta_recuperar('nao_existe_xyz', codigo, 'nova-palavra-1');
  if r <> 'codigo_invalido' then falhas := falhas || ('inexistente deu ' || r); end if;
  passos := passos + 1;

  -- 5. palavra-passe curta é recusada antes de olhar para o código
  r := conta_recuperar('teste_rec', codigo, 'curta');
  if r <> 'palavra_curta' then falhas := falhas || ('curta deu ' || r); end if;
  passos := passos + 1;

  -- 6. código certo, escrito em minúsculas e sem traços → ok
  r := conta_recuperar('TESTE_REC', lower(replace(codigo, '-', ' ')), 'nova-palavra-1');
  if r <> 'ok' then falhas := falhas || ('código certo deu ' || r); end if;
  select extensions.crypt('nova-palavra-1', encrypted_password) = encrypted_password into ok from auth.users where id = u;
  if not ok then falhas := falhas || 'palavra-passe nova não confere'; end if;
  if exists (select 1 from auth.sessions where user_id = u) then falhas := falhas || 'sessões não terminaram'; end if;
  if exists (select 1 from contas_recuperacao where perfil_id = u) then falhas := falhas || 'código não ficou gasto'; end if;
  passos := passos + 1;

  -- 7. o mesmo código já não serve
  r := conta_recuperar('teste_rec', codigo, 'outra-palavra-2');
  if r <> 'codigo_invalido' then falhas := falhas || ('código gasto deu ' || r); end if;
  passos := passos + 1;

  -- 8. ao fim de 5 falhas em 15 min, bloqueia (até com o código certo)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  codigo := conta_gerar_codigo();
  perform set_config('request.jwt.claims', '', true);
  for i in 1..5 loop perform conta_recuperar('teste_rec', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'outra-palavra-2'); end loop;
  r := conta_recuperar('teste_rec', codigo, 'outra-palavra-2');
  if r <> 'demasiadas_tentativas' then falhas := falhas || ('limite deu ' || r); end if;
  passos := passos + 1;

  -- 9. permissões: anon não pode gerar código nem ler as tabelas
  if has_function_privilege('anon', 'public.conta_gerar_codigo()', 'execute') then falhas := falhas || 'anon gera código'; end if;
  if has_table_privilege('anon', 'public.contas_recuperacao', 'select') then falhas := falhas || 'anon lê códigos'; end if;
  if has_table_privilege('authenticated', 'public.contas_recuperacao', 'select') then falhas := falhas || 'authenticated lê códigos'; end if;
  if not has_function_privilege('anon', 'public.conta_recuperar(text,text,text)', 'execute') then falhas := falhas || 'anon não pode recuperar'; end if;
  passos := passos + 1;

  -- 10. chat: a política de leitura é só para authenticated
  if exists (select 1 from pg_policies where tablename = 'chat_mensagens' and cmd = 'SELECT' and 'anon' = any(roles)) then
    falhas := falhas || 'anon ainda lê o chat';
  end if;
  passos := passos + 1;

  raise exception 'RELATORIO passos=% falhas=% %', passos, coalesce(array_length(falhas, 1), 0), falhas;
end $$;
