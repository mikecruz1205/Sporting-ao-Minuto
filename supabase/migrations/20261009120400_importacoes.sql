-- =========================================================================
-- IMPORTAÇÕES IDEMPOTENTES — plantel, estatísticas de época e calendário
-- -------------------------------------------------------------------------
-- Correr a mesma importação duas vezes dá o mesmo resultado: o jogador é
-- encontrado pelos IDs das fontes (desporto_jogador_ids), o jogo pelo par
-- (fonte, id_externo). Valores em falta (null) nunca apagam o que já lá
-- estava. Só administradores (ou o servidor) podem chamar estas funções.
-- =========================================================================

-- chave de um nome, para fontes sem ID (Wikipédia): "Iván Fresneda" → "ivan-fresneda"
create or replace function public.desporto_chave(t text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
    translate(lower(t), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '-', 'g'));
$$;

-- -------------------------------------------------------------------------
-- p = { "jogadores": [ { "nome", "nome_curto", "posicao", "numero", "idade",
--        "nascimento", "nacionalidade", "pe", "foto_url", "foto_fonte",
--        "ids": { "api-football": "46672", "zerozero": "275322", "wikipedia": "rui-silva" } } ],
--       "marcar_saidas": true }   -- quem não vier passa a fora do plantel
-- -------------------------------------------------------------------------
create or replace function public.desporto_importar_jogadores(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x jsonb; jid bigint; k text; vistos bigint[] := '{}';
  novos int := 0; atualizados int := 0; saidas int := 0;
  sinc bigint;
begin
  if not public.fantasy_e_admin() then raise exception 'Só um administrador pode importar jogadores.'; end if;
  insert into public.desporto_sincronizacoes (fonte, tipo) values (coalesce(p->>'fonte', 'varias'), 'jogadores') returning id into sinc;

  for x in select * from jsonb_array_elements(p->'jogadores') loop
    -- encontra pelo primeiro ID conhecido
    select i.jogador_id into jid
    from jsonb_each_text(coalesce(x->'ids', '{}')) e(fonte, id)
    join public.desporto_jogador_ids i on i.fonte = e.fonte and i.id_externo = e.id
    limit 1;

    if jid is null then
      insert into public.desporto_jogadores (nome, nome_curto, posicao, numero, idade, nascimento,
                                             nacionalidade, pe, foto_url, foto_fonte, no_plantel)
      values (x->>'nome', coalesce(x->>'nome_curto', x->>'nome'), x->>'posicao', (x->>'numero')::smallint,
              (x->>'idade')::smallint, (x->>'nascimento')::date, x->>'nacionalidade', x->>'pe',
              x->>'foto_url', x->>'foto_fonte', true)
      returning id into jid;
      novos := novos + 1;
    else
      update public.desporto_jogadores set
        nome          = coalesce(x->>'nome', nome),
        nome_curto    = coalesce(x->>'nome_curto', nome_curto),
        posicao       = coalesce(x->>'posicao', posicao),
        numero        = coalesce((x->>'numero')::smallint, numero),
        idade         = coalesce((x->>'idade')::smallint, idade),
        nascimento    = coalesce((x->>'nascimento')::date, nascimento),
        nacionalidade = coalesce(x->>'nacionalidade', nacionalidade),
        pe            = coalesce(x->>'pe', pe),
        foto_url      = coalesce(x->>'foto_url', foto_url),
        foto_fonte    = case when x->>'foto_url' is not null then x->>'foto_fonte' else foto_fonte end,
        no_plantel    = true,
        atualizado_em = now()
      where id = jid;
      atualizados := atualizados + 1;
    end if;

    -- IDs (um por fonte; se a fonte mudar o ID, fica o novo)
    for k in select jsonb_object_keys(coalesce(x->'ids', '{}')) loop
      delete from public.desporto_jogador_ids where jogador_id = jid and fonte = k and id_externo <> x->'ids'->>k;
      insert into public.desporto_jogador_ids (fonte, id_externo, jogador_id)
      values (k, x->'ids'->>k, jid) on conflict (fonte, id_externo) do nothing;
    end loop;

    insert into public.fantasy_jogadores (jogador_id, elegivel, motivo) values (jid, true, null)
    on conflict (jogador_id) do update set elegivel = true, motivo = null;
    vistos := vistos || jid;
  end loop;

  if coalesce((p->>'marcar_saidas')::boolean, false) then
    update public.desporto_jogadores set no_plantel = false, atualizado_em = now()
    where no_plantel and not (id = any(vistos));
    get diagnostics saidas = row_count;
    update public.fantasy_jogadores set elegivel = false, motivo = 'saiu do plantel'
    where not (jogador_id = any(vistos)) and elegivel;
  end if;

  update public.desporto_sincronizacoes set fim = now(), estado = 'ok', registos = novos + atualizados,
    detalhe = jsonb_build_object('novos', novos, 'atualizados', atualizados, 'saidas', saidas) where id = sinc;
  return jsonb_build_object('ok', true, 'novos', novos, 'atualizados', atualizados, 'saidas', saidas);
end $$;

-- -------------------------------------------------------------------------
-- p = { "fonte": "wikipedia", "epoca": "2026/27", "competicao": "todas",
--       "jogadores": [ { "ids": {"wikipedia": "rui-silva"}, "jogos": 8, "golos": 0 } ] }
-- -------------------------------------------------------------------------
create or replace function public.desporto_importar_estatisticas_epoca(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare x jsonb; jid bigint; n int := 0; ignorados jsonb := '[]'; sinc bigint;
begin
  if not public.fantasy_e_admin() then raise exception 'Só um administrador pode importar estatísticas.'; end if;
  insert into public.desporto_sincronizacoes (fonte, tipo) values (p->>'fonte', 'estatisticas_epoca') returning id into sinc;
  for x in select * from jsonb_array_elements(p->'jogadores') loop
    select i.jogador_id into jid
    from jsonb_each_text(coalesce(x->'ids', '{}')) e(fonte, id)
    join public.desporto_jogador_ids i on i.fonte = e.fonte and i.id_externo = e.id
    limit 1;
    if jid is null then ignorados := ignorados || (x->'ids'); continue; end if;
    insert into public.desporto_estatisticas_epoca (jogador_id, epoca, competicao, equipa, jogos, titularidades,
      minutos, golos, assistencias, amarelos, vermelhos, fonte)
    values (jid, p->>'epoca', coalesce(p->>'competicao', 'todas'), coalesce(p->>'equipa', 'Sporting CP'),
      (x->>'jogos')::smallint, (x->>'titularidades')::smallint, (x->>'minutos')::int, (x->>'golos')::smallint,
      (x->>'assistencias')::smallint, (x->>'amarelos')::smallint, (x->>'vermelhos')::smallint, p->>'fonte')
    on conflict (jogador_id, epoca, competicao, equipa, fonte) do update set
      jogos = excluded.jogos, titularidades = excluded.titularidades, minutos = excluded.minutos,
      golos = excluded.golos, assistencias = excluded.assistencias, amarelos = excluded.amarelos,
      vermelhos = excluded.vermelhos, atualizado_em = now();
    n := n + 1;
  end loop;
  update public.desporto_sincronizacoes set fim = now(), estado = case when jsonb_array_length(ignorados) > 0 then 'parcial' else 'ok' end,
    registos = n, detalhe = jsonb_build_object('ignorados', ignorados) where id = sinc;
  return jsonb_build_object('ok', true, 'registos', n, 'ignorados', ignorados);
end $$;

-- -------------------------------------------------------------------------
-- CALENDÁRIO → jogos e jornadas Fantasy
-- p = { "fonte": "wikipedia", "epoca": "2026/27",
--       "jogos": [ { "id_externo", "competicao", "fase", "data" (com fuso),
--                    "casa", "fora", "sporting_casa", "golos_casa", "golos_fora",
--                    "estado", "local" } ] }
-- Cada jogo futuro passa a jornada; as jornadas ainda por jogar são
-- renumeradas pela data (se um jogo mudar de dia, a ordem acompanha).
-- -------------------------------------------------------------------------
create or replace function public.fantasy_importar_calendario(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := public.fantasy_cfg('jogo');
  antes interval := make_interval(mins => coalesce((cfg->>'fecho_minutos_antes')::int, 0));
  x jsonb; jid bigint; n int := 0; novas int := 0; base int; sinc bigint;
  ep text := p->>'epoca';
begin
  if not public.fantasy_e_admin() then raise exception 'Só um administrador pode importar o calendário.'; end if;
  insert into public.desporto_sincronizacoes (fonte, tipo) values (p->>'fonte', 'calendario') returning id into sinc;

  for x in select * from jsonb_array_elements(p->'jogos') loop
    insert into public.desporto_jogos (epoca, competicao, fase, data, casa, fora, sporting_casa,
                                       golos_casa, golos_fora, estado, local, fonte, id_externo)
    values (ep, x->>'competicao', x->>'fase', (x->>'data')::timestamptz, x->>'casa', x->>'fora',
            (x->>'sporting_casa')::boolean, (x->>'golos_casa')::smallint, (x->>'golos_fora')::smallint,
            coalesce(x->>'estado', 'agendado'), x->>'local', p->>'fonte', x->>'id_externo')
    on conflict (fonte, id_externo) do update set
      competicao = excluded.competicao, fase = excluded.fase, data = excluded.data,
      casa = excluded.casa, fora = excluded.fora, sporting_casa = excluded.sporting_casa,
      golos_casa = coalesce(excluded.golos_casa, public.desporto_jogos.golos_casa),
      golos_fora = coalesce(excluded.golos_fora, public.desporto_jogos.golos_fora),
      estado = excluded.estado, local = coalesce(excluded.local, public.desporto_jogos.local),
      atualizado_em = now()
    returning id into jid;
    n := n + 1;

    -- jogo por jogar → jornada (ou atualiza o fecho, se ainda não fechou)
    if (x->>'data')::timestamptz > now() and coalesce(x->>'estado', 'agendado') = 'agendado' then
      if exists (select 1 from public.fantasy_jornadas where jogo_id = jid) then
        update public.fantasy_jornadas set fecho = (x->>'data')::timestamptz - antes
        where jogo_id = jid and fecho > now() and calculada_em is null;
      else
        insert into public.fantasy_jornadas (epoca, numero, jogo_id, fecho)
        values (ep, 1000 + (select count(*) from public.fantasy_jornadas where epoca = ep), jid, (x->>'data')::timestamptz - antes);
        novas := novas + 1;
      end if;
    end if;
  end loop;

  -- renumerar as que ainda não fecharam, a seguir às que já fecharam
  select coalesce(max(numero), 0) into base from public.fantasy_jornadas
  where epoca = ep and (fecho <= now() or calculada_em is not null) and numero < 1000;
  update public.fantasy_jornadas set numero = numero + 2000
  where epoca = ep and fecho > now() and calculada_em is null;
  update public.fantasy_jornadas j set numero = o.n
  from (select id, base + row_number() over (order by fecho, jogo_id) as n
        from public.fantasy_jornadas where epoca = ep and fecho > now() and calculada_em is null) o
  where j.id = o.id;

  update public.desporto_sincronizacoes set fim = now(), estado = 'ok', registos = n,
    detalhe = jsonb_build_object('jogos', n, 'jornadas_novas', novas) where id = sinc;
  return jsonb_build_object('ok', true, 'jogos', n, 'jornadas_novas', novas);
end $$;

revoke execute on function public.desporto_importar_jogadores(jsonb)          from public, anon;
revoke execute on function public.desporto_importar_estatisticas_epoca(jsonb) from public, anon;
revoke execute on function public.fantasy_importar_calendario(jsonb)          from public, anon;
grant  execute on function public.desporto_importar_jogadores(jsonb)          to authenticated, service_role;
grant  execute on function public.desporto_importar_estatisticas_epoca(jsonb) to authenticated, service_role;
grant  execute on function public.fantasy_importar_calendario(jsonb)          to authenticated, service_role;
