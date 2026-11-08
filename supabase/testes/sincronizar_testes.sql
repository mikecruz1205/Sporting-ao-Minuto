-- =========================================================================
-- Testes da sincronização football-data (migração 20261108120000).
-- Tudo dentro de um bloco que acaba com uma exceção de propósito: a
-- transação é desfeita (incluindo o segredo de teste no cofre).
-- Esperado: 'RELATORIO ... falhas=0'.
-- =========================================================================
do $$
declare
  segredo text := 'teste-' || md5(random()::text);
  r jsonb; falhas text[] := '{}'; passos int := 0;
  j11 public.desporto_jogos; j12 public.desporto_jogos;
  nova_hora timestamptz;
  pedido jsonb;
begin
  delete from vault.secrets where name = 'sincronizar_segredo';
  perform vault.create_secret(segredo, 'sincronizar_segredo', 'teste');
  select * into j11 from desporto_jogos where epoca = '2026/27' and competicao = 'Liga Portugal' and fase = 'Jornada 11';
  select * into j12 from desporto_jogos where epoca = '2026/27' and competicao = 'Liga Portugal' and fase = 'Jornada 12';
  nova_hora := date_trunc('minute', j12.data) + interval '75 minutes';

  pedido := jsonb_build_object('epoca', '2026/27', 'jogos', jsonb_build_array(
    jsonb_build_object('fd_id', 1, 'competicao', 'Liga Portugal', 'fase', 'Jornada 11', 'data', j11.data,
                       'casa', 'Sporting CP', 'fora', 'Moreirense', 'sporting_casa', j11.sporting_casa, 'golos_casa', 3, 'golos_fora', 0),
    jsonb_build_object('fd_id', 2, 'competicao', 'Liga Portugal', 'fase', 'Jornada 12', 'data', nova_hora,
                       'casa', j12.casa, 'fora', j12.fora, 'sporting_casa', j12.sporting_casa, 'golos_casa', null, 'golos_fora', null),
    jsonb_build_object('fd_id', 3, 'competicao', 'Liga dos Campeões', 'fase', 'Play-off', 'data', now() + interval '90 days',
                       'casa', 'Sporting CP', 'fora', 'Equipa de teste', 'sporting_casa', true, 'golos_casa', null, 'golos_fora', null)));

  -- 1. sem o segredo certo não entra nada; o visitante sem segredo também não
  begin perform desporto_sincronizar_fd('errado', pedido); falhas := falhas || 'aceitou segredo errado'; exception when insufficient_privilege then null; end;
  set local role anon;
  begin perform desporto_sincronizar_fd(null, pedido); falhas := falhas || 'aceitou sem segredo'; exception when insufficient_privilege then null; end;
  reset role;
  passos := passos + 1;

  -- 2. com o segredo: resultado escrito, hora mudada, jogo novo com jornada
  r := desporto_sincronizar_fd(segredo, pedido);
  if (r->>'atualizados')::int <> 2 or (r->>'novos')::int <> 1 or (r->>'jornadas_novas')::int <> 1 then falhas := falhas || ('contas: ' || r::text); end if;
  if (select golos_casa || '-' || golos_fora || ' ' || estado from desporto_jogos where id = j11.id) <> '3-0 terminado' then falhas := falhas || 'resultado do J11'; end if;
  if (select data from desporto_jogos where id = j12.id) <> nova_hora then falhas := falhas || 'hora do J12'; end if;
  if (select fecho from fantasy_jornadas where jogo_id = j12.id) <> nova_hora then falhas := falhas || 'fecho da jornada do J12'; end if;
  if not exists (select 1 from fantasy_jornadas fj join desporto_jogos g on g.id = fj.jogo_id where g.fonte = 'football-data' and g.id_externo = 'fd:3') then
    falhas := falhas || 'jornada do jogo novo';
  end if;
  passos := passos + 1;

  -- 3. correr outra vez não muda nada (nem duplica)
  r := desporto_sincronizar_fd(segredo, pedido);
  if (r->>'atualizados')::int <> 0 or (r->>'novos')::int <> 0 or (r->>'iguais')::int <> 3 then falhas := falhas || ('repetição: ' || r::text); end if;
  if (select count(*) from desporto_jogos where fase = 'Play-off' and epoca = '2026/27') <> 1 then falhas := falhas || 'duplicou o jogo novo'; end if;
  passos := passos + 1;

  -- 4. um resultado já escrito não é apagado por um pedido sem resultado
  perform desporto_sincronizar_fd(segredo, jsonb_set(pedido, '{jogos,0,golos_casa}', 'null'::jsonb));
  if (select golos_casa from desporto_jogos where id = j11.id) <> 3 then falhas := falhas || 'apagou o resultado'; end if;
  passos := passos + 1;

  -- 5. as jornadas futuras continuam numeradas pela data, sem buracos
  if exists (
    select 1 from (select numero, row_number() over (order by fecho, jogo_id) + min(numero) over () - 1 esperado
                   from fantasy_jornadas where epoca = '2026/27' and fecho > now() and calculada_em is null) t
    where numero <> esperado) then falhas := falhas || 'numeração das jornadas'; end if;
  passos := passos + 1;

  raise exception 'RELATORIO passos=% falhas=% %', passos, cardinality(falhas), falhas;
end
$$;
