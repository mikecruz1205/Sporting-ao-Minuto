-- =========================================================================
-- TESTES DO FANTASY — correm numa transação que é sempre desfeita
-- -------------------------------------------------------------------------
-- O bloco termina com um erro de propósito ("RELATORIO {...}"): assim tudo
-- o que se criou para testar (contas, equipas, estatísticas) desaparece,
-- e o relatório chega na mensagem do erro. Nada de dados de teste fica na
-- base de dados.
--
-- Correr no editor SQL do Supabase (ou pela MCP) com o utilizador postgres.
-- =========================================================================
do $testes$
declare
  r jsonb := '{}'::jsonb;      -- relatório
  falhas jsonb := '[]'::jsonb;
  cfg jsonb := public.fantasy_cfg('pontuacao');
  e public.desporto_estatisticas_jogo;
  p record;
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  id_ jsonb;                   -- nome curto → id
  j1 public.fantasy_jornadas; j2 public.fantasy_jornadas;
  res jsonb; n int; v numeric;
  tit bigint[]; banco bigint[];

  procedure_ok boolean;
begin
  -- ------------------------------------------------------------ utilitário
  -- (as verificações acumulam-se em "falhas"; o relatório conta-as)

  -- =========================== 1. PONTUAÇÃO (fantasy_pontuar) ===========================
  -- a) não jogou
  e := row(0,0,true,0,0,0,0,0,0,0,0,0,0,0,0,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'AVA', 0, cfg);
  if p.pontos <> 0 or p.jogou then falhas := falhas || '"a: nao jogou"'; end if;

  -- b) avançado 90', 2 golos, 1 assistência, 1 amarelo → 1+1+8+3-1 = 12
  e := row(0,0,true,90,2,1,1,0,0,0,0,null,null,0,null,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'AVA', 1, cfg);
  if p.pontos <> 12 then falhas := falhas || to_jsonb('b: esperado 12, deu ' || p.pontos); end if;

  -- c) defesa 90', equipa sem golos sofridos → 1+1+4 = 6
  e := row(0,0,true,90,0,0,0,0,0,0,0,null,null,0,null,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'DEF', 0, cfg);
  if p.pontos <> 6 then falhas := falhas || to_jsonb('c: esperado 6, deu ' || p.pontos); end if;

  -- d) defesa 90', equipa sofre 3 → 2 - 1 = 1
  select * into p from public.fantasy_pontuar(e, 'DEF', 3, cfg);
  if p.pontos <> 1 then falhas := falhas || to_jsonb('d: esperado 1, deu ' || p.pontos); end if;

  -- e) defesa 45', equipa sofre 3 → só presença = 1 (sem 60', não conta o total da equipa)
  e := row(0,0,false,45,0,0,0,0,0,0,0,null,null,0,null,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'DEF', 3, cfg);
  if p.pontos <> 1 then falhas := falhas || to_jsonb('e: esperado 1, deu ' || p.pontos); end if;

  -- f) guarda-redes 90', 7 defesas, 1 penálti defendido, sofre 1 → 2 + 2 + 5 = 9
  e := row(0,0,true,90,0,0,0,0,0,0,1,7,null,0,null,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'GR', 1, cfg);
  if p.pontos <> 9 then falhas := falhas || to_jsonb('f: esperado 9, deu ' || p.pontos); end if;

  -- g) médio 70', amarelo + vermelho (2.º amarelo), equipa sofre 1 → 2 - 3 = -1
  e := row(0,0,true,70,0,0,1,1,0,0,0,null,null,0,null,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'MED', 1, cfg);
  if p.pontos <> -1 then falhas := falhas || to_jsonb('g: esperado -1, deu ' || p.pontos); end if;

  -- h) médio 90', golos desconhecidos (null) → 2 e assinala "sem dados" (sem os tratar como 0)
  e := row(0,0,true,90,null,0,0,0,0,0,0,null,null,0,null,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'MED', 1, cfg);
  if p.pontos <> 2 or not (p.detalhe @> '[{"regra":"sem_dados","campos":["golos"]}]') then
    falhas := falhas || to_jsonb('h: esperado 2 com sem_dados(golos), deu ' || p.pontos || ' ' || p.detalhe::text); end if;

  -- i) defesa 90' com autogolo, equipa sofre 2 → 2 - 1 - 2 = -1
  e := row(0,0,true,90,0,0,0,0,0,0,0,null,null,1,null,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'DEF', 2, cfg);
  if p.pontos <> -1 then falhas := falhas || to_jsonb('i: esperado -1, deu ' || p.pontos); end if;

  -- j) médio 90', 7 recuperações, equipa sem golos sofridos → 2 + 1 (baliza) + 2 = 5
  e := row(0,0,true,90,0,0,0,0,0,0,0,null,null,0,7,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'MED', 0, cfg);
  if p.pontos <> 5 then falhas := falhas || to_jsonb('j: esperado 5, deu ' || p.pontos); end if;

  -- k) avançado 90', penálti falhado → 2 - 2 = 0
  e := row(0,0,true,90,0,0,0,0,0,1,0,null,null,0,null,'teste',now());
  select * into p from public.fantasy_pontuar(e, 'AVA', 0, cfg);
  if p.pontos <> 0 then falhas := falhas || to_jsonb('k: esperado 0, deu ' || p.pontos); end if;

  r := r || jsonb_build_object('pontuacao', 'ok');

  -- =========================== 2. EQUIPAS, JORNADAS E CLASSIFICAÇÃO ===========================
  select jsonb_object_agg(nome_curto, id) into id_ from public.desporto_jogadores;
  select * into j1 from public.fantasy_jornada_aberta();
  select * into j2 from public.fantasy_jornadas where epoca = j1.epoca and numero = j1.numero + 1;

  insert into auth.users (id, email) values (ua, 'teste-a@exemplo.invalid'), (ub, 'teste-b@exemplo.invalid');
  insert into public.perfis (id, utilizador, nome_mostrado) values (ua, 'teste_a', 'Teste A'), (ub, 'teste_b', 'Teste B');

  tit := array[ (id_->>'Rui Silva')::bigint, (id_->>'Gonçalo Inácio')::bigint, (id_->>'Zeno Debast')::bigint,
                (id_->>'Iván Fresneda')::bigint, (id_->>'Eduardo Quaresma')::bigint, (id_->>'Rodrigo Zalazar')::bigint,
                (id_->>'Sergi Altimira')::bigint, (id_->>'Issa Doumbia')::bigint, (id_->>'Silas Andersen')::bigint,
                (id_->>'Luis Suárez')::bigint, (id_->>'Geny Catamo')::bigint ];
  banco := array[ (id_->>'Diego Callai')::bigint, (id_->>'Rodrigo Dias')::bigint, (id_->>'João Simões')::bigint,
                  (id_->>'Rafael Nel')::bigint ];

  -- ---------- utilizador A
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);

  -- validações que têm de falhar
  res := public.fantasy_guardar_equipa(tit[1:10], banco, tit[10], tit[6], null);
  if (res->>'ok')::boolean then falhas := falhas || '"v1: aceitou onze de 10"'; end if;
  res := public.fantasy_guardar_equipa(tit, banco[1:3] || tit[2], tit[10], tit[6], null);
  if (res->>'ok')::boolean then falhas := falhas || '"v2: aceitou repetido"'; end if;
  res := public.fantasy_guardar_equipa(tit, banco, banco[4], tit[6], null);
  if (res->>'ok')::boolean then falhas := falhas || '"v3: aceitou capitão no banco"'; end if;
  res := public.fantasy_guardar_equipa(tit, array[banco[2], banco[1], banco[3], banco[4]], tit[10], tit[6], null);
  if (res->>'ok')::boolean then falhas := falhas || '"v4: aceitou banco sem GR em primeiro"'; end if;
  -- 6 defesas e 4 médios no plantel
  res := public.fantasy_guardar_equipa(tit, array[banco[1], banco[2], (id_->>'G. Vagiannidis')::bigint, banco[4]], tit[10], tit[6], null);
  if (res->>'ok')::boolean then falhas := falhas || '"v5: aceitou 6 defesas"'; end if;
  -- orçamento: troca baratos por caros até passar os 100
  res := public.fantasy_guardar_equipa(
    array[tit[1], tit[2], tit[3], tit[4], tit[5], tit[6], tit[7], tit[8], tit[9], tit[10], (id_->>'Flávio Gonçalves')::bigint],
    array[banco[1], (id_->>'Maxi Araújo')::bigint, (id_->>'Pedro Lima')::bigint, (id_->>'Fotis Ioannidis')::bigint],
    tit[10], tit[6], null);
  if (res->>'ok')::boolean or res::text not like '%orçamento%' then falhas := falhas || to_jsonb('v6: orçamento ' || res::text); end if;

  -- válida: 4-4-2, capitão Suárez, vice Zalazar (custa 97,0)
  res := public.fantasy_guardar_equipa(tit, banco, tit[10], tit[6], 'Os de Teste');
  if not (res->>'ok')::boolean or (res->>'gasto')::numeric <> 97.0 or res->>'formacao' <> '4-4-2' then
    falhas := falhas || to_jsonb('v7: equipa válida ' || res::text); end if;
  r := r || jsonb_build_object('guardar_a', res);

  -- ---------- utilizador B: igual, capitão Catamo
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  res := public.fantasy_guardar_equipa(tit, banco, tit[11], tit[6], null);
  if not (res->>'ok')::boolean then falhas := falhas || to_jsonb('v8: equipa B ' || res::text); end if;

  -- RLS: antes do fecho, B não vê a equipa de A
  execute 'set local role authenticated';
  select count(*) into n from public.fantasy_escolhas where perfil_id = ua;
  execute 'reset role';
  if n <> 0 then falhas := falhas || to_jsonb('rls1: B viu a equipa de A antes do fecho (' || n || ')'); end if;

  -- ---------- a jornada 1 fecha e joga-se (Braga 1-2 Sporting)
  update public.fantasy_jornadas set fecho = now() - interval '3 hours' where id = j1.id;
  update public.desporto_jogos set golos_casa = 1, golos_fora = 2, estado = 'terminado' where id = j1.jogo_id;

  execute 'set local role authenticated';
  select count(*) into n from public.fantasy_escolhas where perfil_id = ua and jornada_id = j1.id;
  execute 'reset role';
  if n <> 15 then falhas := falhas || to_jsonb('rls2: depois do fecho devia ver 15, viu ' || n); end if;

  -- Fresneda e Suárez não jogam (substituições automáticas); capitão de A não joga → vice
  res := public.fantasy_importar_jogo(jsonb_build_object('fonte', 'manual', 'jogo', jsonb_build_object('id', j1.jogo_id),
    'substituir', true, 'jogadores', jsonb_build_array(
      jsonb_build_object('jogador_id', id_->'Rui Silva',        'minutos', 90, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0,'defesas',4),
      jsonb_build_object('jogador_id', id_->'Gonçalo Inácio',   'minutos', 90, 'golos',1,'assistencias',0,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Zeno Debast',      'minutos', 90, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Eduardo Quaresma', 'minutos', 90, 'golos',0,'assistencias',0,'amarelos',1,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Rodrigo Zalazar',  'minutos', 90, 'golos',0,'assistencias',1,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Sergi Altimira',   'minutos', 90, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Issa Doumbia',     'minutos', 60, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Silas Andersen',   'minutos', 30, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Geny Catamo',      'minutos', 90, 'golos',1,'assistencias',0,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Rodrigo Dias',     'minutos', 30, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'João Simões',      'minutos', 20, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0),
      jsonb_build_object('jogador_id', id_->'Rafael Nel',       'minutos', 15, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0))));
  r := r || jsonb_build_object('importar', res);

  -- importar outra vez o mesmo não duplica nem muda nada
  perform public.fantasy_importar_jogo(jsonb_build_object('fonte', 'manual', 'jogo', jsonb_build_object('id', j1.jogo_id),
    'jogadores', jsonb_build_array(jsonb_build_object('jogador_id', id_->'Rui Silva', 'minutos', 90, 'golos',0,'assistencias',0,'amarelos',0,'vermelhos',0,'defesas',4))));
  select count(*) into n from public.desporto_estatisticas_jogo where jogo_id = j1.jogo_id;
  if n <> 12 then falhas := falhas || to_jsonb('idem1: esperado 12 linhas, há ' || n); end if;

  -- A: onze final = Rui 3, Inácio 8, Debast 2, Dias 1 (entra), Quaresma 1, Zalazar 5, Altimira 2,
  --    Doumbia 2, Andersen 1, Simões 1 (entra), Catamo 6 = 32; vice Zalazar ×2 → +5 = 37; banco: Nel 1
  select to_jsonb(x) into res from public.fantasy_resultados x where perfil_id = ua and jornada_id = j1.id;
  if (res->>'total')::int <> 37 or (res->>'pontos_onze')::int <> 32 or (res->>'bonus_capitao')::int <> 5
     or (res->>'pontos_banco')::int <> 1 or jsonb_array_length(res->'substituicoes') <> 2
     or (res->>'capitao_efetivo')::bigint <> (id_->>'Rodrigo Zalazar')::bigint then
    falhas := falhas || to_jsonb('calc A: ' || res::text); end if;
  r := r || jsonb_build_object('resultado_a', res);
  -- B: igual mas o capitão (Catamo, 6) jogou → 32 + 6 = 38
  select total into n from public.fantasy_resultados where perfil_id = ub and jornada_id = j1.id;
  if n <> 38 then falhas := falhas || to_jsonb('calc B: esperado 38, deu ' || n); end if;

  -- recalcular dá o mesmo (as substituições não se aplicam duas vezes)
  perform public.fantasy_calcular_jornada(j1.id);
  select total into n from public.fantasy_resultados where perfil_id = ua and jornada_id = j1.id;
  if n <> 37 then falhas := falhas || to_jsonb('idem2: recalculado deu ' || n); end if;

  -- classificação
  select posicao into n from public.fantasy_classificacao where perfil_id = ub;
  if n <> 1 then falhas := falhas || to_jsonb('class: B devia ser 1.º, é ' || n); end if;

  -- ---------- jornada 2: três transferências (2 grátis + 1 a -4 pontos)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  res := public.fantasy_guardar_equipa(tit,
    array[banco[1], (id_->>'G. Vagiannidis')::bigint, (id_->>'Pedro Lima')::bigint, (id_->>'Flávio Gonçalves')::bigint],
    tit[10], tit[6], null);
  if not (res->>'ok')::boolean or (res->>'transferencias')::int <> 3 or (res->>'penalizacao')::int <> 4
     or (res->>'gasto')::numeric <> 100.0 or (res->>'jornada')::int <> j2.numero then
    falhas := falhas || to_jsonb('trans: ' || res::text); end if;
  r := r || jsonb_build_object('transferencias', res);
  select count(*) into n from public.fantasy_transferencias where perfil_id = ua and jornada_id = j2.id;
  if n <> 3 then falhas := falhas || to_jsonb('trans2: esperado 3 registos, há ' || n); end if;
  -- a equipa da jornada 1 não mudou (não há alterações retroativas)
  select count(*) into n from public.fantasy_escolhas where perfil_id = ua and jornada_id = j1.id and jogador_id = (id_->>'Rafael Nel')::bigint;
  if n <> 1 then falhas := falhas || '"retro: a equipa da jornada 1 mudou"'; end if;

  -- ---------- finalizar a jornada 1: preços mexem (média ≥ 6 sobe, ≤ 1 desce)
  res := public.fantasy_finalizar_jornada(j1.id);
  select preco into v from public.fantasy_preco_atual where jogador_id = (id_->>'Gonçalo Inácio')::bigint;
  if v <> 6.6 then falhas := falhas || to_jsonb('preco1: Inácio devia ir a 6.6, está ' || v); end if;
  select preco into v from public.fantasy_preco_atual where jogador_id = (id_->>'Rafael Nel')::bigint;
  if v <> 6.4 then falhas := falhas || to_jsonb('preco2: Nel devia ir a 6.4, está ' || v); end if;
  select count(*) into n from public.fantasy_precos where jogador_id = (id_->>'Gonçalo Inácio')::bigint;
  if n <> 2 then falhas := falhas || '"preco3: o histórico de preços não ficou"'; end if;
  r := r || jsonb_build_object('finalizar', res);

  -- depois de finalizada, as estatísticas não podem mudar
  begin
    perform public.fantasy_importar_jogo(jsonb_build_object('fonte', 'manual', 'jogo', jsonb_build_object('id', j1.jogo_id),
      'jogadores', jsonb_build_array(jsonb_build_object('jogador_id', id_->'Rui Silva', 'minutos', 10))));
    falhas := falhas || '"fin: aceitou estatísticas numa jornada finalizada"';
  exception when others then null;
  end;

  r := r || jsonb_build_object('falhas', falhas, 'n_falhas', jsonb_array_length(falhas));
  raise exception 'RELATORIO %', r::text;
end $testes$;
