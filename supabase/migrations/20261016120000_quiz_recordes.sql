-- =========================================================================
-- QUIZ LEONINO — o recorde pessoal de cada conta
--
-- O jogo corre no browser (js/quiz.js); aqui guarda-se só o melhor
-- resultado de cada conta, para o recorde acompanhar a pessoa entre
-- aparelhos. Não há classificação pública: cada conta só vê o seu.
-- Grava-se apenas pela função quiz_guardar_recorde(), que aceita só os
-- valores da escada de pontos e guarda sempre o maior.
-- =========================================================================

create table public.quiz_recordes (
  perfil_id     uuid primary key references public.perfis(id) on delete cascade,
  melhor        integer not null default 0 check (melhor between 0 and 1906),
  jogos         integer not null default 0 check (jogos >= 0),
  atualizado_em timestamptz not null default now()
);

alter table public.quiz_recordes enable row level security;

create policy quiz_recordes_proprio on public.quiz_recordes
  for select to authenticated using (perfil_id = auth.uid());

revoke all on public.quiz_recordes from anon, authenticated;
grant select on public.quiz_recordes to authenticated;

-- a escada de pontos do jogo (igual a ESCADA em js/quiz.js)
create or replace function public.quiz_guardar_recorde(p_pontos integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  eu uuid := auth.uid();
  r public.quiz_recordes;
begin
  if eu is null then raise exception 'Tens de entrar na tua conta.'; end if;
  if p_pontos is null or not (p_pontos = any (array[0, 10, 20, 30, 50, 100, 150, 200, 300, 450, 600, 800, 1000, 1250, 1500, 1906])) then
    raise exception 'Pontuação inválida.';
  end if;
  insert into public.quiz_recordes as q (perfil_id, melhor, jogos)
  values (eu, p_pontos, 1)
  on conflict (perfil_id) do update
    set melhor = greatest(q.melhor, excluded.melhor),
        jogos = q.jogos + 1,
        atualizado_em = now()
  returning * into r;
  return jsonb_build_object('ok', true, 'melhor', r.melhor, 'jogos', r.jogos);
end $$;

revoke all on function public.quiz_guardar_recorde(integer) from public, anon;
grant execute on function public.quiz_guardar_recorde(integer) to authenticated;
