-- =========================================================================
-- Testes das notificações push (migração 20261019090000).
-- Tudo dentro de um bloco que acaba com uma exceção de propósito: a
-- transação é desfeita e não fica nada. Esperado: 'RELATORIO ... falhas=0'.
-- Enquanto a migração não estiver aplicada, corre-se o ficheiro da
-- migração e este no MESMO pedido: a exceção do fim desfaz as duas coisas.
-- =========================================================================
do $$
declare
  fcm text := 'https://fcm.googleapis.com/fcm/send/teste-' || md5(random()::text);
  moz text := 'https://updates.push.services.mozilla.com/wpush/v2/teste-' || md5(random()::text);
  p256 text := repeat('B', 87);
  au text := repeat('a', 22);
  n int; t text[]; falhas text[] := '{}'; passos int := 0;
begin
  -- 1. o visitante (anon) não lê nem escreve nas tabelas
  set local role anon;
  begin perform 1 from subscricoes_push limit 1; falhas := falhas || 'anon leu subscricoes_push'; exception when insufficient_privilege then null; end;
  begin insert into subscricoes_push (endpoint, p256dh, auth) values (fcm, p256, au); falhas := falhas || 'anon escreveu'; exception when insufficient_privilege then null; end;
  begin perform 1 from push_enviados limit 1; falhas := falhas || 'anon leu push_enviados'; exception when insufficient_privilege then null; end;
  passos := passos + 1;

  -- 2. subscreve pelos serviços de push conhecidos e atualiza sem duplicar
  perform push_subscrever(fcm, p256, au, array['INICIO', 'RESULTADO']);
  perform push_subscrever(moz, p256, au, array['OFICIAL']);
  perform push_subscrever(fcm, p256, au, array['JORNADA']);
  reset role;
  select count(*) into n from subscricoes_push where endpoint in (fcm, moz);
  if n <> 2 then falhas := falhas || ('subscrições: ' || n); end if;
  select tipos into t from subscricoes_push where endpoint = fcm;
  if t <> array['JORNADA'] then falhas := falhas || 'não atualizou os tipos'; end if;
  passos := passos + 1;

  -- 3. recusa serviços desconhecidos, http e tipos que não existem
  set local role anon;
  begin perform push_subscrever('https://exemplo.invalid/push/abcdefghijklmnopqrstuvwxyz', p256, au, array['INICIO']); falhas := falhas || 'aceitou servidor desconhecido'; exception when others then null; end;
  begin perform push_subscrever('http://fcm.googleapis.com/fcm/send/abcdefghijklmnop', p256, au, array['INICIO']); falhas := falhas || 'aceitou http'; exception when others then null; end;
  begin perform push_subscrever('https://fcm.googleapis.com.exemplo.invalid/x/abcdefghijklmnop', p256, au, array['INICIO']); falhas := falhas || 'aceitou falso fcm'; exception when others then null; end;
  begin perform push_subscrever(fcm, p256, au, array['GOLO']); falhas := falhas || 'aceitou tipo GOLO'; exception when others then null; end;
  begin perform push_subscrever(fcm, p256, au, array[]::text[]); falhas := falhas || 'aceitou sem tipos'; exception when others then null; end;
  begin perform push_subscrever(fcm, 'curta', au, array['INICIO']); falhas := falhas || 'aceitou chave curta'; exception when others then null; end;
  passos := passos + 1;

  -- 4. cancelar apaga só a sua
  perform push_cancelar(moz);
  reset role;
  if exists (select 1 from subscricoes_push where endpoint = moz) then falhas := falhas || 'não cancelou'; end if;
  if not exists (select 1 from subscricoes_push where endpoint = fcm) then falhas := falhas || 'cancelou a outra'; end if;
  passos := passos + 1;

  -- 5. a mesma chave de aviso não entra duas vezes (é o que impede repetir avisos)
  insert into push_enviados (chave, tipo) values ('teste-inicio-1', 'INICIO');
  begin insert into push_enviados (chave, tipo) values ('teste-inicio-1', 'INICIO'); falhas := falhas || 'aviso repetido'; exception when unique_violation then null; end;
  passos := passos + 1;

  raise exception 'RELATORIO passos=% falhas=% %', passos, cardinality(falhas), falhas;
end
$$;
