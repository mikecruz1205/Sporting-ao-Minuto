-- =========================================================================
-- SINCRONIZAÇÃO AUTOMÁTICA DOS RESULTADOS — football-data.org
-- -------------------------------------------------------------------------
-- Todos os dias, uma tarefa da Vercel (api/sincronizar.py, onde está o
-- token da football-data) lê o calendário e os resultados do Sporting na
-- Liga e na Liga dos Campeões e entrega-os a esta função.
--
-- · Cada jogo encontra-se pela prova, pela fase (jornada) e por o Sporting
--   jogar em casa ou fora — não pelo nome do adversário, que muda de fonte
--   para fonte. Atualiza o resultado (só de jogos terminados), a hora dos
--   jogos por jogar e o fecho da jornada da Fantasy.
-- · Um jogo que o calendário ainda não tem (uma eliminatória da Champions,
--   por exemplo) entra, com a sua jornada da Fantasy.
-- · Só aceita quem tiver o segredo guardado no cofre (vault) com o nome
--   'sincronizar_segredo'; a mesma palavra está na Vercel. O resto do
--   calendário (taças) continua a vir da importação manual.
-- Testes: supabase/testes/sincronizar_testes.sql.
-- =========================================================================

create or replace function public.desporto_sincronizar_fd(p_segredo text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  certo text;
  ep text := p->>'epoca';
  antes interval := make_interval(mins => coalesce((public.fantasy_cfg('jogo')->>'fecho_minutos_antes')::int, 0));
  x jsonb; g public.desporto_jogos;
  nova_data timestamptz; gc smallint; gf smallint;
  atualizados int := 0; novos int := 0; iguais int := 0; jornadas_novas int := 0; mexeu_jornadas boolean := false;
  sinc bigint; base int;
begin
  select decrypted_secret into certo from vault.decrypted_secrets where name = 'sincronizar_segredo';
  if certo is null or p_segredo is distinct from certo then
    raise exception 'proibido' using errcode = '42501';
  end if;
  if ep is null or jsonb_typeof(p->'jogos') <> 'array' then
    raise exception 'pedido inválido' using errcode = '22023';
  end if;

  insert into public.desporto_sincronizacoes (fonte, tipo) values ('football-data', 'resultados') returning id into sinc;

  for x in select * from jsonb_array_elements(p->'jogos') loop
    nova_data := (x->>'data')::timestamptz;
    gc := (x->>'golos_casa')::smallint;
    gf := (x->>'golos_fora')::smallint;
    g := null;
    select * into g from public.desporto_jogos
     where epoca = ep and competicao = x->>'competicao' and fase = x->>'fase'
       and sporting_casa = (x->>'sporting_casa')::boolean
     order by id limit 1;

    if g.id is null then
      insert into public.desporto_jogos (epoca, competicao, fase, data, casa, fora, sporting_casa,
                                         golos_casa, golos_fora, estado, fonte, id_externo)
      values (ep, x->>'competicao', x->>'fase', nova_data, x->>'casa', x->>'fora', (x->>'sporting_casa')::boolean,
              gc, gf, case when gc is not null and gf is not null then 'terminado' else 'agendado' end,
              'football-data', 'fd:' || (x->>'fd_id'))
      on conflict (fonte, id_externo) do update set
        data = excluded.data, golos_casa = coalesce(excluded.golos_casa, public.desporto_jogos.golos_casa),
        golos_fora = coalesce(excluded.golos_fora, public.desporto_jogos.golos_fora),
        estado = excluded.estado, atualizado_em = now()
      returning * into g;
      novos := novos + 1;
    elsif (gc is not null and gf is not null and (g.golos_casa is distinct from gc or g.golos_fora is distinct from gf))
       or (gc is null and g.golos_casa is null and g.data is distinct from nova_data) then
      update public.desporto_jogos set
        golos_casa = coalesce(gc, golos_casa),
        golos_fora = coalesce(gf, golos_fora),
        estado = case when gc is not null and gf is not null then 'terminado' else estado end,
        data = case when gc is null and golos_casa is null then nova_data else data end,
        atualizado_em = now()
      where id = g.id
      returning * into g;
      atualizados := atualizados + 1;
    else
      iguais := iguais + 1;
    end if;

    /* a jornada da Fantasy de um jogo por jogar acompanha a hora */
    if gc is null and nova_data > now() then
      if exists (select 1 from public.fantasy_jornadas where jogo_id = g.id) then
        update public.fantasy_jornadas set fecho = nova_data - antes
        where jogo_id = g.id and fecho > now() and calculada_em is null and fecho is distinct from nova_data - antes;
        if found then mexeu_jornadas := true; end if;
      else
        insert into public.fantasy_jornadas (epoca, numero, jogo_id, fecho)
        values (ep, 1000 + (select count(*) from public.fantasy_jornadas where epoca = ep), g.id, nova_data - antes);
        jornadas_novas := jornadas_novas + 1; mexeu_jornadas := true;
      end if;
    end if;
  end loop;

  /* as jornadas futuras numeram-se pela data, a seguir às que já fecharam */
  if mexeu_jornadas then
    select coalesce(max(numero), 0) into base from public.fantasy_jornadas
    where epoca = ep and (fecho <= now() or calculada_em is not null) and numero < 1000;
    update public.fantasy_jornadas set numero = numero + 2000
    where epoca = ep and fecho > now() and calculada_em is null;
    update public.fantasy_jornadas j set numero = o.n
    from (select id, base + row_number() over (order by fecho, jogo_id) as n
          from public.fantasy_jornadas where epoca = ep and fecho > now() and calculada_em is null) o
    where j.id = o.id;
  end if;

  update public.desporto_sincronizacoes set fim = now(), estado = 'ok', registos = atualizados + novos,
    detalhe = jsonb_build_object('atualizados', atualizados, 'novos', novos, 'iguais', iguais, 'jornadas_novas', jornadas_novas)
  where id = sinc;
  return jsonb_build_object('ok', true, 'atualizados', atualizados, 'novos', novos, 'iguais', iguais, 'jornadas_novas', jornadas_novas);
end $$;

-- quem chama é a função da Vercel com a chave publicável: o segredo é que protege
revoke all on function public.desporto_sincronizar_fd(text, jsonb) from public;
grant execute on function public.desporto_sincronizar_fd(text, jsonb) to anon, authenticated;
