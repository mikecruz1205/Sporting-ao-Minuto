-- =========================================================================
-- DADOS DESPORTIVOS — o modelo normalizado
-- -------------------------------------------------------------------------
-- Uma camada única para jogadores, jogos e estatísticas, venham de onde
-- vierem (API-Football, Wikipédia, zerozero, introdução manual). Cada
-- registo guarda a fonte e a hora da última atualização.
--
-- Regra de ouro: um valor desconhecido é NULL, nunca 0. "Sem dados" e
-- "zero" são coisas diferentes e a interface mostra-as de forma diferente.
--
-- Escrita: só pelo servidor (service_role) ou por funções SECURITY DEFINER
-- que validam quem as chama. O browser só lê.
-- =========================================================================

-- ---------------------------------------------------------------- jogadores
create table public.desporto_jogadores (
  id                    bigint generated always as identity primary key,
  nome                  text not null check (char_length(nome) between 2 and 80),
  nome_curto            text not null check (char_length(nome_curto) between 2 and 40),
  posicao               text not null check (posicao in ('GR','DEF','MED','AVA')),
  posicoes_secundarias  text[] not null default '{}',
  numero                smallint check (numero between 1 and 99),
  nascimento            date,
  idade                 smallint check (idade between 14 and 50),
  nacionalidade         text,
  pe                    text check (pe in ('direito','esquerdo','ambos')),
  -- só caminhos do próprio site (/img/...) ou https; a fonte diz de onde veio
  foto_url              text check (foto_url is null or foto_url ~ '^(/img/|https://)'),
  foto_fonte            text,
  no_plantel            boolean not null default true,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
comment on table public.desporto_jogadores is
  'Jogadores do plantel sénior masculino do Sporting. NULL = sem dados disponíveis.';

-- IDs nas fontes externas: é por aqui que uma importação repetida encontra
-- o jogador que já existe em vez de criar outro
create table public.desporto_jogador_ids (
  fonte       text not null check (fonte in ('api-football','zerozero','wikipedia','football-data','thesportsdb','manual')),
  id_externo  text not null,
  jogador_id  bigint not null references public.desporto_jogadores(id) on delete cascade,
  primary key (fonte, id_externo),
  unique (jogador_id, fonte)
);

-- ---------------------------------------------------------------- jogos
create table public.desporto_jogos (
  id             bigint generated always as identity primary key,
  epoca          text not null check (epoca ~ '^\d{4}/\d{2}$'),
  competicao     text not null check (char_length(competicao) between 2 and 60),
  fase           text,
  data           timestamptz not null,
  casa           text not null,
  fora           text not null,
  sporting_casa  boolean not null,
  golos_casa     smallint check (golos_casa >= 0),
  golos_fora     smallint check (golos_fora >= 0),
  estado         text not null default 'agendado'
                 check (estado in ('agendado','em_curso','terminado','adiado','cancelado')),
  local          text,
  fonte          text not null,
  id_externo     text not null,
  atualizado_em  timestamptz not null default now(),
  unique (fonte, id_externo)
);
create index desporto_jogos_data on public.desporto_jogos (data);

-- ---------------------------------------------------------------- estatísticas por jogo
-- Tudo NULL por omissão: só se escreve o que a fonte deu. Uma linha aqui
-- quer dizer que o jogador foi utilizado e os minutos são obrigatórios.
create table public.desporto_estatisticas_jogo (
  jogo_id         bigint not null references public.desporto_jogos(id) on delete cascade,
  jogador_id      bigint not null references public.desporto_jogadores(id) on delete cascade,
  titular         boolean,
  minutos         smallint not null check (minutos between 0 and 130),
  golos           smallint check (golos >= 0),
  assistencias    smallint check (assistencias >= 0),
  amarelos        smallint check (amarelos between 0 and 2),
  vermelhos       smallint check (vermelhos between 0 and 1),
  pen_marcados    smallint check (pen_marcados >= 0),
  pen_falhados    smallint check (pen_falhados >= 0),
  pen_defendidos  smallint check (pen_defendidos >= 0),
  defesas         smallint check (defesas >= 0),
  -- golos sofridos com o jogador em campo (quando a fonte os dá)
  golos_sofridos  smallint check (golos_sofridos >= 0),
  autogolos       smallint check (autogolos >= 0),
  recuperacoes    smallint check (recuperacoes >= 0),
  fonte           text not null,
  atualizado_em   timestamptz not null default now(),
  primary key (jogo_id, jogador_id)
);

-- ---------------------------------------------------------------- estatísticas por época
-- competicao = 'todas' quando a fonte só dá o total da época
create table public.desporto_estatisticas_epoca (
  jogador_id     bigint not null references public.desporto_jogadores(id) on delete cascade,
  epoca          text not null check (epoca ~ '^\d{4}/\d{2}$'),
  competicao     text not null,
  equipa         text not null default 'Sporting CP',
  jogos          smallint check (jogos >= 0),
  titularidades  smallint check (titularidades >= 0),
  minutos        integer check (minutos >= 0),
  golos          smallint check (golos >= 0),
  assistencias   smallint check (assistencias >= 0),
  amarelos       smallint check (amarelos >= 0),
  vermelhos      smallint check (vermelhos >= 0),
  fonte          text not null,
  atualizado_em  timestamptz not null default now(),
  primary key (jogador_id, epoca, competicao, equipa, fonte)
);

-- ---------------------------------------------------------------- registo das sincronizações
create table public.desporto_sincronizacoes (
  id        bigint generated always as identity primary key,
  fonte     text not null,
  tipo      text not null,
  inicio    timestamptz not null default now(),
  fim       timestamptz,
  estado    text not null default 'a_correr' check (estado in ('a_correr','ok','parcial','erro')),
  pedidos   integer,
  registos  integer,
  detalhe   jsonb
);

-- ---------------------------------------------------------------- RLS: todos leem, ninguém escreve do browser
alter table public.desporto_jogadores          enable row level security;
alter table public.desporto_jogador_ids        enable row level security;
alter table public.desporto_jogos              enable row level security;
alter table public.desporto_estatisticas_jogo  enable row level security;
alter table public.desporto_estatisticas_epoca enable row level security;
alter table public.desporto_sincronizacoes     enable row level security;

create policy desporto_jogadores_leitura         on public.desporto_jogadores          for select to anon, authenticated using (true);
create policy desporto_jogador_ids_leitura       on public.desporto_jogador_ids        for select to anon, authenticated using (true);
create policy desporto_jogos_leitura             on public.desporto_jogos              for select to anon, authenticated using (true);
create policy desporto_estatisticas_jogo_leitura on public.desporto_estatisticas_jogo  for select to anon, authenticated using (true);
create policy desporto_estatisticas_epoca_leitura on public.desporto_estatisticas_epoca for select to anon, authenticated using (true);
create policy desporto_sincronizacoes_leitura    on public.desporto_sincronizacoes     for select to anon, authenticated using (true);
