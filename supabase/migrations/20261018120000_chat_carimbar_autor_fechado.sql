-- =========================================================================
-- chat_carimbar_autor() é a função do gatilho que grava o autor de cada
-- mensagem do chat. Estava exposta pela API (/rest/v1/rpc/...) a anónimos e
-- a todas as contas (aviso do Supabase). Um gatilho não precisa dessa
-- permissão para correr — o Postgres só a verifica quando o gatilho é
-- criado —, por isso fecha-se a toda a gente.
-- =========================================================================
revoke all on function public.chat_carimbar_autor() from public, anon, authenticated;
