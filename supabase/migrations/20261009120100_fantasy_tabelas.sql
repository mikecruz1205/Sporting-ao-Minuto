-- =========================================================================
-- FANTASY DO SPORTING
-- -------------------------------------------------------------------------
-- Inspirado nas mecânicas do Fantasy da Champions (plantel de 15, orçamento,
-- onze e banco, capitão e vice, transferências por jornada, ligas), só com
-- jogadores do Sporting. Cada jogo oficial do Sporting é uma jornada.
--
-- O browser nunca escreve pontos, orçamentos nem plantéis de ninguém:
--   · a equipa guarda-se por fantasy_guardar_equipa(), que valida tudo;
--   · os pontos calculam-se no servidor (fantasy_calcular_jornada) a partir
--     de desporto_estatisticas_jogo, com as regras de fantasy_config;
--   · cada cálculo guarda o detalhe, para se poder auditar.
-- =========================================================================

-- ---------------------------------------------------------------- configuração
create table public.fantasy_config (
  chave          text primary key,
  valor          jsonb not null,
  descricao      text,
  atualizado_em  timestamptz not null default now()
);

insert into public.fantasy_config (chave, valor, descricao) values
('jogo', '{
   "orcamento": 100.0,
   "plantel":  {"GR":2, "DEF":5, "MED":5, "AVA":3},
   "onze_min": {"GR":1, "DEF":3, "MED":2, "AVA":1},
   "onze_max": {"GR":1, "DEF":5, "MED":5, "AVA":3},
   "transferencias_gratis": 2,
   "custo_transferencia_extra": 4,
   "multiplicador_capitao": 2,
   "fecho_minutos_antes": 0,
   "horas_ate_final": 48,
   "max_ligas_por_utilizador": 10,
   "max_membros_liga": 50
 }', 'Regras do jogo: orçamento (M€ Fantasy), plantel, formações válidas, transferências e capitão'),
('pontuacao', '{
   "jogou_1_min": 1,
   "jogou_60_min": 1,
   "golo": {"GR":6, "DEF":6, "MED":5, "AVA":4},
   "assistencia": 3,
   "baliza_inviolada": {"GR":4, "DEF":4, "MED":1, "AVA":0},
   "baliza_inviolada_minutos": 60,
   "defesas_por_ponto": 3,
   "recuperacoes_por_ponto": 3,
   "amarelo": -1,
   "vermelho": -3,
   "penalti_falhado": -2,
   "autogolo": -2,
   "penalti_defendido": 5,
   "golos_sofridos": {"posicoes": ["GR","DEF"], "por_cada": 2, "pontos": -1}
 }', 'Tabela de pontuação. Alterar aqui muda o cálculo sem mexer na interface'),
('precos', '{
   "base": {"GR":4.5, "DEF":5.0, "MED":5.5, "AVA":6.5},
   "por_jogo": 0.15,
   "max_por_jogos": 2.0,
   "por_golo": {"GR":0.5, "DEF":0.5, "MED":0.35, "AVA":0.3},
   "max_por_golos": 3.0,
   "arredondar": 0.5,
   "minimo": 4.0,
   "maximo": 13.0,
   "variacao": {"jornadas": 3, "subir_media": 6, "descer_media": 1, "passo": 0.1}
 }', 'Preços Fantasy (não são valores de mercado). Inicial = base da posição + jogos e golos da época; depois variam com a pontuação Fantasy');

-- ---------------------------------------------------------------- jogadores no jogo
create table public.fantasy_jogadores (
  jogador_id  bigint primary key references public.desporto_jogadores(id) on delete cascade,
  elegivel    boolean not null default true,
  motivo      text
);

-- preços: cada mudança é uma linha nova — o histórico fica todo
create table public.fantasy_precos (
  jogador_id  bigint not null references public.desporto_jogadores(id) on delete cascade,
  desde       timestamptz not null default now(),
  preco       numeric(4,1) not null check (preco between 3 and 20),
  motivo      text not null,
  primary key (jogador_id, desde)
);

create view public.fantasy_preco_atual with (security_invoker = on) as
  select distinct on (jogador_id) jogador_id, preco, desde, motivo
  from public.fantasy_precos
  order by jogador_id, desde desc;

-- ---------------------------------------------------------------- jornadas
create table public.fantasy_jornadas (
  id             bigint generated always as identity primary key,
  epoca          text not null check (epoca ~ '^\d{4}/\d{2}$'),
  numero         smallint not null check (numero > 0),
  jogo_id        bigint not null unique references public.desporto_jogos(id) on delete restrict,
  fecho          timestamptz not null,
  calculada_em   timestamptz,
  finalizada_em  timestamptz,
  unique (epoca, numero)
);

-- futura → aberta → em curso → provisória → finalizada
create or replace function public.fantasy_estado_jornada(j public.fantasy_jornadas)
returns text language sql stable set search_path = public, pg_temp as $$
  select case
    when j.finalizada_em is not null then 'finalizada'
    when j.calculada_em  is not null then 'provisoria'
    when now() >= j.fecho            then 'em_curso'
    when j.id = (select x.id from public.fantasy_jornadas x
                 where x.fecho > now() and x.finalizada_em is null
                 order by x.fecho limit 1) then 'aberta'
    else 'futura' end;
$$;

-- a jornada em que se pode mexer agora
create or replace function public.fantasy_jornada_aberta()
returns public.fantasy_jornadas language sql stable set search_path = public, pg_temp as $$
  select * from public.fantasy_jornadas
  where fecho > now() and finalizada_em is null
  order by fecho limit 1;
$$;

-- pontos de cada jogador em cada jornada, com o detalhe do cálculo
create table public.fantasy_pontos_jogador (
  jornada_id    bigint not null references public.fantasy_jornadas(id) on delete cascade,
  jogador_id    bigint not null references public.desporto_jogadores(id) on delete cascade,
  pontos        smallint not null,
  jogou         boolean not null,
  detalhe       jsonb not null,
  calculado_em  timestamptz not null default now(),
  primary key (jornada_id, jogador_id)
);

-- ---------------------------------------------------------------- equipas dos utilizadores
create table public.fantasy_perfis (
  perfil_id    uuid primary key references public.perfis(id) on delete cascade,
  nome_equipa  text not null check (char_length(nome_equipa) between 3 and 30),
  criado_em    timestamptz not null default now()
);

-- a equipa de cada jornada (o que conta é a última guardada até ao fecho)
create table public.fantasy_equipa_jornada (
  perfil_id       uuid   not null references public.fantasy_perfis(perfil_id) on delete cascade,
  jornada_id      bigint not null references public.fantasy_jornadas(id) on delete cascade,
  formacao        text   not null check (formacao ~ '^[3-5]-[2-5]-[1-3]$'),
  orcamento       numeric(5,1) not null,
  transferencias  smallint not null default 0,
  penalizacao     smallint not null default 0,
  guardado_em     timestamptz not null default now(),
  primary key (perfil_id, jornada_id)
);

create table public.fantasy_escolhas (
  perfil_id     uuid   not null,
  jornada_id    bigint not null,
  jogador_id    bigint not null references public.desporto_jogadores(id),
  titular       boolean not null,
  ordem_banco   smallint check (ordem_banco between 1 and 4),
  capitao       boolean not null default false,
  vice          boolean not null default false,
  preco_compra  numeric(4,1) not null,
  primary key (perfil_id, jornada_id, jogador_id),
  foreign key (perfil_id, jornada_id) references public.fantasy_equipa_jornada(perfil_id, jornada_id) on delete cascade,
  check (titular = (ordem_banco is null)),
  check (not (capitao and vice)),
  check (titular or not (capitao or vice))
);

create table public.fantasy_transferencias (
  id           bigint generated always as identity primary key,
  perfil_id    uuid   not null references public.fantasy_perfis(perfil_id) on delete cascade,
  jornada_id   bigint not null references public.fantasy_jornadas(id) on delete cascade,
  sai          bigint not null references public.desporto_jogadores(id),
  entra        bigint not null references public.desporto_jogadores(id),
  preco_sai    numeric(4,1) not null,
  preco_entra  numeric(4,1) not null,
  gratis_por_inelegivel boolean not null default false,
  criado_em    timestamptz not null default now()
);

create table public.fantasy_historico (
  id          bigint generated always as identity primary key,
  perfil_id   uuid not null references public.fantasy_perfis(perfil_id) on delete cascade,
  jornada_id  bigint references public.fantasy_jornadas(id) on delete cascade,
  acao        text not null,
  detalhe     jsonb,
  criado_em   timestamptz not null default now()
);

create table public.fantasy_resultados (
  perfil_id        uuid   not null references public.fantasy_perfis(perfil_id) on delete cascade,
  jornada_id       bigint not null references public.fantasy_jornadas(id) on delete cascade,
  pontos_onze      integer not null,
  pontos_banco     integer not null,
  bonus_capitao    integer not null,
  penalizacao      integer not null,
  total            integer not null,
  capitao_efetivo  bigint references public.desporto_jogadores(id),
  substituicoes    jsonb not null default '[]',
  calculado_em     timestamptz not null default now(),
  primary key (perfil_id, jornada_id)
);

-- ---------------------------------------------------------------- ligas privadas
create table public.fantasy_ligas (
  id         bigint generated always as identity primary key,
  nome       text not null check (char_length(nome) between 3 and 40),
  codigo     text not null unique check (codigo ~ '^[A-Z2-9]{6}$'),
  dono       uuid not null references public.fantasy_perfis(perfil_id) on delete cascade,
  criado_em  timestamptz not null default now()
);
create table public.fantasy_liga_membros (
  liga_id    bigint not null references public.fantasy_ligas(id) on delete cascade,
  perfil_id  uuid   not null references public.fantasy_perfis(perfil_id) on delete cascade,
  entrou_em  timestamptz not null default now(),
  primary key (liga_id, perfil_id)
);

-- quem pode importar estatísticas e fechar jornadas (preenchida à mão)
create table public.fantasy_admins (
  perfil_id  uuid primary key references public.perfis(id) on delete cascade
);

-- ---------------------------------------------------------------- RLS
alter table public.fantasy_config          enable row level security;
alter table public.fantasy_jogadores       enable row level security;
alter table public.fantasy_precos          enable row level security;
alter table public.fantasy_jornadas        enable row level security;
alter table public.fantasy_pontos_jogador  enable row level security;
alter table public.fantasy_perfis          enable row level security;
alter table public.fantasy_equipa_jornada  enable row level security;
alter table public.fantasy_escolhas        enable row level security;
alter table public.fantasy_transferencias  enable row level security;
alter table public.fantasy_historico       enable row level security;
alter table public.fantasy_resultados      enable row level security;
alter table public.fantasy_ligas           enable row level security;
alter table public.fantasy_liga_membros    enable row level security;
alter table public.fantasy_admins          enable row level security;

-- públicos: regras, jogadores, preços, jornadas, pontos e resultados
create policy fantasy_config_leitura     on public.fantasy_config         for select to anon, authenticated using (true);
create policy fantasy_jogadores_leitura  on public.fantasy_jogadores      for select to anon, authenticated using (true);
create policy fantasy_precos_leitura     on public.fantasy_precos         for select to anon, authenticated using (true);
create policy fantasy_jornadas_leitura   on public.fantasy_jornadas       for select to anon, authenticated using (true);
create policy fantasy_pontos_leitura     on public.fantasy_pontos_jogador for select to anon, authenticated using (true);
create policy fantasy_perfis_leitura     on public.fantasy_perfis         for select to anon, authenticated using (true);
create policy fantasy_resultados_leitura on public.fantasy_resultados     for select to anon, authenticated using (true);

-- a equipa dos outros só se vê depois do fecho da jornada (ninguém copia)
create policy fantasy_equipa_jornada_leitura on public.fantasy_equipa_jornada for select to anon, authenticated
  using (perfil_id = (select auth.uid())
         or exists (select 1 from public.fantasy_jornadas j where j.id = jornada_id and j.fecho <= now()));
create policy fantasy_escolhas_leitura on public.fantasy_escolhas for select to anon, authenticated
  using (perfil_id = (select auth.uid())
         or exists (select 1 from public.fantasy_jornadas j where j.id = jornada_id and j.fecho <= now()));

-- transferências e histórico: só o próprio
create policy fantasy_transferencias_leitura on public.fantasy_transferencias for select to authenticated
  using (perfil_id = (select auth.uid()));
create policy fantasy_historico_leitura on public.fantasy_historico for select to authenticated
  using (perfil_id = (select auth.uid()));

-- ligas: quem é membro vê a liga e os outros membros
create or replace function public.fantasy_sou_membro(p_liga bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.fantasy_liga_membros
                 where liga_id = p_liga and perfil_id = (select auth.uid()));
$$;
create policy fantasy_ligas_leitura on public.fantasy_ligas for select to authenticated
  using (public.fantasy_sou_membro(id));
create policy fantasy_liga_membros_leitura on public.fantasy_liga_membros for select to authenticated
  using (public.fantasy_sou_membro(liga_id));

-- admins: cada um só vê a sua linha (para a interface saber se é admin)
create policy fantasy_admins_leitura on public.fantasy_admins for select to authenticated
  using (perfil_id = (select auth.uid()));

-- ---------------------------------------------------------------- utilitários
create or replace function public.fantasy_cfg(p_chave text)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select valor from public.fantasy_config where chave = p_chave;
$$;

create or replace function public.fantasy_e_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
      or session_user = 'postgres'
      or exists (select 1 from public.fantasy_admins where perfil_id = (select auth.uid()));
$$;

-- arredonda ao passo configurado (0,5 → 7,25 passa a 7,5)
create or replace function public.fantasy_arredondar(v numeric, passo numeric)
returns numeric language sql immutable as $$
  select round(v / passo) * passo;
$$;
