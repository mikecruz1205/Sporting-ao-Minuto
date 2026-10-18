-- =========================================================================
-- PROGNÓSTICOS E HOMEM DO JOGO
--
-- Prognóstico: cada conta prevê o resultado de um jogo do Sporting até à
-- hora de início (validado aqui, não no browser). Pontos quando o jogo tem
-- resultado em desporto_jogos: 3 pelo resultado exato, 1 por acertar no
-- vencedor ou no empate, 0 de resto.
--
-- Homem do jogo: cada conta vota num jogador do plantel, desde o fim
-- previsto do jogo (1h45 depois do início) até 3 dias depois.
--
-- Ninguém lê os prognósticos ou votos dos outros: só os seus. Os totais
-- (percentagens, votos, classificação de uma liga) vêm de funções que só
-- devolvem números agregados — e a da liga só a quem é membro.
-- =========================================================================

create table public.prognosticos (
  perfil_id         uuid     not null references public.perfis(id) on delete cascade,
  jogo_id           bigint   not null references public.desporto_jogos(id) on delete cascade,
  golos_sporting    smallint not null check (golos_sporting between 0 and 20),
  golos_adversario  smallint not null check (golos_adversario between 0 and 20),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  primary key (perfil_id, jogo_id)
);

create table public.homem_do_jogo_votos (
  perfil_id   uuid   not null references public.perfis(id) on delete cascade,
  jogo_id     bigint not null references public.desporto_jogos(id) on delete cascade,
  jogador_id  bigint not null references public.desporto_jogadores(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  primary key (perfil_id, jogo_id)
);

alter table public.prognosticos enable row level security;
alter table public.homem_do_jogo_votos enable row level security;
create policy prognosticos_proprios on public.prognosticos for select to authenticated using (perfil_id = auth.uid());
create policy homem_votos_proprios on public.homem_do_jogo_votos for select to authenticated using (perfil_id = auth.uid());
revoke all on public.prognosticos, public.homem_do_jogo_votos from anon, authenticated;
grant select on public.prognosticos, public.homem_do_jogo_votos to authenticated;

-- pontos de um prognóstico (null enquanto o jogo não tiver resultado)
create or replace function public.prognostico_pontos(p_nos int, p_eles int, p_sporting_casa boolean, p_casa int, p_fora int)
returns int language sql immutable as $$
  select case
    when p_casa is null or p_fora is null then null
    when p_nos = (case when p_sporting_casa then p_casa else p_fora end)
     and p_eles = (case when p_sporting_casa then p_fora else p_casa end) then 3
    when sign(p_nos - p_eles) = sign((case when p_sporting_casa then p_casa else p_fora end)
                                    - (case when p_sporting_casa then p_fora else p_casa end)) then 1
    else 0 end
$$;

create or replace function public.prognostico_guardar(p_jogo bigint, p_nos int, p_eles int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare eu uuid := auth.uid(); j public.desporto_jogos;
begin
  if eu is null then raise exception 'Tens de entrar na tua conta.'; end if;
  select * into j from public.desporto_jogos where id = p_jogo;
  if j.id is null then raise exception 'Jogo desconhecido.'; end if;
  if j.sporting_casa is null then raise exception 'Só há prognósticos para jogos do Sporting.'; end if;
  if now() >= j.data then raise exception 'O jogo já começou: os prognósticos fecharam.'; end if;
  if p_nos is null or p_eles is null or p_nos not between 0 and 20 or p_eles not between 0 and 20 then
    raise exception 'Resultado inválido.';
  end if;
  insert into public.prognosticos as p (perfil_id, jogo_id, golos_sporting, golos_adversario)
  values (eu, p_jogo, p_nos, p_eles)
  on conflict (perfil_id, jogo_id) do update
    set golos_sporting = excluded.golos_sporting, golos_adversario = excluded.golos_adversario, atualizado_em = now();
  return jsonb_build_object('ok', true);
end $$;

-- o que os adeptos preveem: só percentagens, nunca quem previu o quê
create or replace function public.prognosticos_resumo(p_jogo bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'total', count(*),
    'vitoria', count(*) filter (where golos_sporting > golos_adversario),
    'empate', count(*) filter (where golos_sporting = golos_adversario),
    'derrota', count(*) filter (where golos_sporting < golos_adversario))
  from public.prognosticos where jogo_id = p_jogo
$$;

-- classificação de prognósticos de uma liga privada (só para membros)
create or replace function public.prognosticos_classificacao_liga(p_liga bigint)
returns table (perfil_id uuid, utilizador text, nome_mostrado text, pontos bigint, exatos bigint, jogos bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.fantasy_liga_membros m where m.liga_id = p_liga and m.perfil_id = auth.uid()) then
    raise exception 'Só os membros da liga veem esta classificação.';
  end if;
  return query
    select m.perfil_id, pf.utilizador, pf.nome_mostrado,
           coalesce(sum(public.prognostico_pontos(p.golos_sporting, p.golos_adversario, j.sporting_casa, j.golos_casa, j.golos_fora)), 0)::bigint,
           count(*) filter (where public.prognostico_pontos(p.golos_sporting, p.golos_adversario, j.sporting_casa, j.golos_casa, j.golos_fora) = 3),
           count(*) filter (where j.golos_casa is not null)
    from public.fantasy_liga_membros m
    join public.perfis pf on pf.id = m.perfil_id
    left join public.prognosticos p on p.perfil_id = m.perfil_id
    left join public.desporto_jogos j on j.id = p.jogo_id
    where m.liga_id = p_liga
    group by m.perfil_id, pf.utilizador, pf.nome_mostrado
    order by 4 desc, 5 desc, pf.utilizador;
end $$;

create or replace function public.homem_do_jogo_votar(p_jogo bigint, p_jogador bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare eu uuid := auth.uid(); j public.desporto_jogos;
begin
  if eu is null then raise exception 'Tens de entrar na tua conta.'; end if;
  select * into j from public.desporto_jogos where id = p_jogo;
  if j.id is null or j.sporting_casa is null then raise exception 'Jogo desconhecido.'; end if;
  if now() < j.data + interval '1 hour 45 minutes' then raise exception 'A votação abre no fim do jogo.'; end if;
  if now() > j.data + interval '3 days' then raise exception 'A votação deste jogo já fechou.'; end if;
  if not exists (select 1 from public.desporto_jogadores where id = p_jogador and no_plantel) then
    raise exception 'Esse jogador não está no plantel.';
  end if;
  insert into public.homem_do_jogo_votos as v (perfil_id, jogo_id, jogador_id) values (eu, p_jogo, p_jogador)
  on conflict (perfil_id, jogo_id) do update set jogador_id = excluded.jogador_id, criado_em = now();
  return jsonb_build_object('ok', true);
end $$;

-- votos de um jogo, por jogador (números agregados)
create or replace function public.homem_do_jogo_resultados(p_jogo bigint)
returns table (jogador_id bigint, nome_curto text, votos bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.jogador_id, d.nome_curto, count(*) from public.homem_do_jogo_votos v
  join public.desporto_jogadores d on d.id = v.jogador_id
  where v.jogo_id = p_jogo group by v.jogador_id, d.nome_curto order by 3 desc, 2
$$;

revoke all on function public.prognostico_guardar(bigint, int, int), public.homem_do_jogo_votar(bigint, bigint),
  public.prognosticos_classificacao_liga(bigint) from public, anon;
grant execute on function public.prognostico_guardar(bigint, int, int), public.homem_do_jogo_votar(bigint, bigint),
  public.prognosticos_classificacao_liga(bigint) to authenticated;
revoke all on function public.prognosticos_resumo(bigint), public.homem_do_jogo_resultados(bigint) from public;
grant execute on function public.prognosticos_resumo(bigint), public.homem_do_jogo_resultados(bigint) to anon, authenticated;
