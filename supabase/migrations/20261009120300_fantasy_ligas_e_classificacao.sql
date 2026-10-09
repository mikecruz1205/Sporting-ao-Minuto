-- =========================================================================
-- LIGAS PRIVADAS
-- =========================================================================
create or replace function public.fantasy_criar_liga(p_nome text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  eu uuid := auth.uid();
  cfg jsonb := public.fantasy_cfg('jogo');
  cod text; lid bigint; tentativas int := 0;
  letras text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if eu is null then raise exception 'Tens de entrar na tua conta.'; end if;
  if not exists (select 1 from public.fantasy_perfis where perfil_id = eu) then
    raise exception 'Guarda primeiro a tua equipa Fantasy.';
  end if;
  if (select count(*) from public.fantasy_liga_membros where perfil_id = eu) >= (cfg->>'max_ligas_por_utilizador')::int then
    raise exception 'Já estás no máximo de ligas.';
  end if;
  loop
    cod := (select string_agg(substr(letras, 1 + (get_byte(b, i) % length(letras)), 1), '')
            from (select extensions.gen_random_bytes(6) b) r, generate_series(0, 5) i);
    exit when not exists (select 1 from public.fantasy_ligas where codigo = cod);
    tentativas := tentativas + 1;
    if tentativas > 10 then raise exception 'Não foi possível gerar um código.'; end if;
  end loop;
  insert into public.fantasy_ligas (nome, codigo, dono) values (trim(p_nome), cod, eu) returning id into lid;
  insert into public.fantasy_liga_membros (liga_id, perfil_id) values (lid, eu);
  return jsonb_build_object('ok', true, 'id', lid, 'codigo', cod);
end $$;

create or replace function public.fantasy_entrar_liga(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare eu uuid := auth.uid(); cfg jsonb := public.fantasy_cfg('jogo'); l public.fantasy_ligas;
begin
  if eu is null then raise exception 'Tens de entrar na tua conta.'; end if;
  if not exists (select 1 from public.fantasy_perfis where perfil_id = eu) then
    raise exception 'Guarda primeiro a tua equipa Fantasy.';
  end if;
  select * into l from public.fantasy_ligas where codigo = upper(trim(p_codigo));
  if l.id is null then raise exception 'Não há nenhuma liga com esse código.'; end if;
  if (select count(*) from public.fantasy_liga_membros where liga_id = l.id) >= (cfg->>'max_membros_liga')::int then
    raise exception 'Essa liga já está cheia.';
  end if;
  if (select count(*) from public.fantasy_liga_membros where perfil_id = eu) >= (cfg->>'max_ligas_por_utilizador')::int then
    raise exception 'Já estás no máximo de ligas.';
  end if;
  insert into public.fantasy_liga_membros (liga_id, perfil_id) values (l.id, eu) on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', l.id, 'nome', l.nome);
end $$;

create or replace function public.fantasy_sair_liga(p_liga bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare eu uuid := auth.uid();
begin
  if eu is null then raise exception 'Tens de entrar na tua conta.'; end if;
  delete from public.fantasy_liga_membros where liga_id = p_liga and perfil_id = eu;
  -- liga sem ninguém deixa de existir
  delete from public.fantasy_ligas l where l.id = p_liga
    and not exists (select 1 from public.fantasy_liga_membros m where m.liga_id = l.id);
  return jsonb_build_object('ok', true);
end $$;

-- =========================================================================
-- CLASSIFICAÇÃO
-- =========================================================================
create view public.fantasy_classificacao with (security_invoker = on) as
  select fp.perfil_id, p.utilizador, fp.nome_equipa,
         coalesce(sum(r.total), 0)::int as total,
         count(r.jornada_id)::int as jornadas,
         rank() over (order by coalesce(sum(r.total), 0) desc)::int as posicao
  from public.fantasy_perfis fp
  join public.perfis p on p.id = fp.perfil_id
  left join public.fantasy_resultados r on r.perfil_id = fp.perfil_id
  group by fp.perfil_id, p.utilizador, fp.nome_equipa;

create view public.fantasy_classificacao_jornada with (security_invoker = on) as
  select r.jornada_id, j.numero, r.perfil_id, p.utilizador, fp.nome_equipa, r.total,
         rank() over (partition by r.jornada_id order by r.total desc)::int as posicao
  from public.fantasy_resultados r
  join public.fantasy_jornadas j on j.id = r.jornada_id
  join public.fantasy_perfis fp on fp.perfil_id = r.perfil_id
  join public.perfis p on p.id = r.perfil_id;

-- =========================================================================
-- PERMISSÕES DAS FUNÇÕES
-- As de administração verificam o papel lá dentro e, além disso, não
-- ficam expostas a anónimos.
-- =========================================================================
revoke execute on function public.fantasy_calcular_jornada(bigint)        from public, anon;
revoke execute on function public.fantasy_importar_jogo(jsonb)            from public, anon;
revoke execute on function public.fantasy_finalizar_jornada(bigint)       from public, anon;
revoke execute on function public.fantasy_definir_precos_iniciais(text)   from public, anon;
revoke execute on function public.fantasy_guardar_equipa(bigint[], bigint[], bigint, bigint, text) from public, anon;
revoke execute on function public.fantasy_criar_liga(text)                from public, anon;
revoke execute on function public.fantasy_entrar_liga(text)               from public, anon;
revoke execute on function public.fantasy_sair_liga(bigint)               from public, anon;
grant  execute on function public.fantasy_calcular_jornada(bigint)        to authenticated, service_role;
grant  execute on function public.fantasy_importar_jogo(jsonb)            to authenticated, service_role;
grant  execute on function public.fantasy_finalizar_jornada(bigint)       to authenticated, service_role;
grant  execute on function public.fantasy_definir_precos_iniciais(text)   to authenticated, service_role;
grant  execute on function public.fantasy_guardar_equipa(bigint[], bigint[], bigint, bigint, text) to authenticated;
grant  execute on function public.fantasy_criar_liga(text)                to authenticated;
grant  execute on function public.fantasy_entrar_liga(text)               to authenticated;
grant  execute on function public.fantasy_sair_liga(bigint)               to authenticated;
