-- Avisos do verificador de segurança do Supabase:
--  · funções puras com search_path fixo
--  · as funções auxiliares (é admin? sou membro?) deixam de estar abertas
--    a anónimos — só servem a quem tem sessão iniciada
alter function public.fantasy_arredondar(numeric, numeric)                 set search_path = public, pg_temp;
alter function public.fantasy_formacao_valida(int, int, int, int, jsonb)   set search_path = public, pg_temp;
alter function public.desporto_chave(text)                                 set search_path = public, pg_temp;
revoke execute on function public.fantasy_e_admin()           from public, anon;
revoke execute on function public.fantasy_sou_membro(bigint)  from public, anon;
grant  execute on function public.fantasy_e_admin()           to authenticated, service_role;
grant  execute on function public.fantasy_sou_membro(bigint)  to authenticated, service_role;
