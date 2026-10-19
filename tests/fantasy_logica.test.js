/* Testes das regras da equipa Fantasy no browser (js/fantasy.js), sem
   servidor nem página: o ficheiro corre numa sandbox com um Supabase falso.

   Correr:  node --test tests/
   (o python -m unittest também os corre, por tests/test_javascript.py)

   Os números de configuração são os das migrações
   supabase/migrations/20261009120100_fantasy_tabelas.sql e
   20261019120000_fantasy_lugares.sql (formações, papéis e 3 suplentes). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'js', 'fantasy.js'), 'utf8');

const CONFIG = {
  jogo: {
    orcamento: 100.0,
    plantel: { GR: 2, DEF: 5, MED: 5, AVA: 3 },
    onze_min: { GR: 1, DEF: 3, MED: 2, AVA: 1 },
    onze_max: { GR: 1, DEF: 5, MED: 5, AVA: 3 },
    transferencias_gratis: 2, custo_transferencia_extra: 4, multiplicador_capitao: 2,
    fecho_minutos_antes: 0, horas_ate_final: 48,
    suplentes: 3,
    papeis: { GR: ['GR'], LD: ['DEF'], LE: ['DEF'], DC: ['DEF'], ALA: ['DEF', 'MED'], MDC: ['MED'], MC: ['MED'], MO: ['MED'], EXT: ['MED', 'AVA'], PL: ['AVA'] },
    formacoes: {"4-3-3": ["GR", "LE", "DC", "DC", "LD", "MC", "MC", "MC", "EXT", "PL", "EXT"], "4-2-3-1": ["GR", "LE", "DC", "DC", "LD", "MDC", "MDC", "EXT", "MO", "EXT", "PL"], "3-4-3": ["GR", "DC", "DC", "DC", "ALA", "MC", "MC", "ALA", "EXT", "PL", "EXT"], "3-4-2-1": ["GR", "DC", "DC", "DC", "ALA", "MC", "MC", "ALA", "MO", "MO", "PL"], "3-5-2": ["GR", "DC", "DC", "DC", "ALA", "MC", "MC", "MC", "ALA", "PL", "PL"], "4-4-2": ["GR", "LE", "DC", "DC", "LD", "EXT", "MC", "MC", "EXT", "PL", "PL"], "5-3-2": ["GR", "ALA", "DC", "DC", "DC", "ALA", "MC", "MC", "MC", "PL", "PL"]}
  },
  pontuacao: {}, precos: {}
};

/* plantel de teste: 3 GR, 6 DEF, 6 MED, 5 AVA (um deles caríssimo) */
function plantelTeste(){
  const linhas = [];
  let id = 1;
  const pos = (p, n, preco) => { for(let i = 0; i < n; i++) linhas.push({ id: id++, posicao: p, preco }); };
  pos('GR', 3, 4.5); pos('DEF', 6, 5.0); pos('MED', 6, 5.5); pos('AVA', 4, 6.5);
  linhas.push({ id: id++, posicao: 'AVA', preco: 60 });
  return linhas.map(l => ({ ...l, nome: `Jogador ${l.id}`, nome_curto: `J. Teste${l.id}`, numero: l.id, no_plantel: true, foto_url: null }));
}

/* um Supabase que só lê: from(tabela).select().eq().order()… e await */
function supabaseFalso(tabelas){
  return {
    from(tabela){
      let linhas = (tabelas[tabela] || []).slice();
      let uma = false;
      const q = {
        select(){ return q; }, order(){ return q; }, limit(){ return q; },
        eq(campo, valor){ linhas = linhas.filter(l => l[campo] === valor); return q; },
        in(campo, valores){ linhas = linhas.filter(l => valores.includes(l[campo])); return q; },
        maybeSingle(){ uma = true; return q; },
        then(ok, falha){ return Promise.resolve({ data: uma ? (linhas[0] || null) : linhas, error: null }).then(ok, falha); }
      };
      return q;
    },
    rpc: async () => ({ data: null, error: { message: 'não usado nos testes' } })
  };
}

function montar({ perfil = null, minhas = {} } = {}){
  const jogadores = plantelTeste();
  const amanha = new Date(Date.now() + 86400e3).toISOString();
  const tabelas = {
    fantasy_config: Object.entries(CONFIG).map(([chave, valor]) => ({ chave, valor })),
    desporto_jogadores: jogadores.map(({ preco, ...j }) => j),
    fantasy_jogadores: jogadores.map(j => ({ jogador_id: j.id, elegivel: true })),
    fantasy_precos: jogadores.map(j => ({ jogador_id: j.id, preco: j.preco, desde: '2026-08-01' })),
    desporto_estatisticas_epoca: [],
    fantasy_jornadas: [{ id: 7, numero: 1, fecho: amanha, finalizada_em: null, calculada_em: null, jogo_id: 70,
                         jogo: { casa: 'Sporting CP', fora: 'Adversário', competicao: 'Liga' } }],
    fantasy_pontos_jogador: [],
    ...minhas
  };
  const guardados = new Map();
  const localStorage = {
    getItem: k => guardados.has(k) ? guardados.get(k) : null,
    setItem: (k, v) => guardados.set(k, String(v)),
    removeItem: k => guardados.delete(k)
  };
  const Nuvem = { cliente: supabaseFalso(tabelas), perfil, garantir: async () => true };
  const sandbox = {
    window: {}, console, localStorage, Nuvem,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    Componentes: { seguro: t => String(t ?? ''), esqueletoCompacto: () => '' },
    /* os avisos apagam-se sozinhos com um temporizador: aqui não é preciso */
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: 'fantasy.js' });
  const F = sandbox.window.Fantasy;
  return { F, T: F._teste, Nuvem, localStorage, guardados, jogadores, tabelas };
}

const pos = (m, id) => m.jogadores.find(j => j.id === id).posicao;
const usados = m => [...m.T.rascunho.onze.filter(x => x != null), ...m.T.rascunho.banco];

/* monta o onze lugar a lugar com o mais barato que lá pode jogar, e o banco */
function montarEquipa(m, banco = ['GR', 'DEF', 'MED']){
  for(let i = 0; i < 11; i++){
    const livre = m.jogadores.filter(j => j.preco < 50 && !usados(m).includes(j.id)).sort((a, b) => a.preco - b.preco || a.id - b.id);
    const j = livre.find(x => !m.T.podeEntrar(x.id, { tipo: 'posto', i }));
    assert.ok(j, 'ninguém para o lugar ' + i);
    assert.equal(m.T.adicionar(j.id, { tipo: 'posto', i }), true);
  }
  banco.forEach(p => {
    const j = m.jogadores.find(x => x.posicao === p && x.preco < 50 && !usados(m).includes(x.id));
    assert.equal(m.T.adicionar(j.id, { tipo: 'banco' }), true);
  });
}

test('visitante: o Fantasy carrega com o campo vazio da 4-3-3 e diz o que falta', async () => {
  const m = montar();
  await m.F.recarregar();
  assert.equal(m.T.estado, 'pronto');
  assert.equal(m.T.rascunho.formacao, '4-3-3');
  assert.deepEqual([...m.T.rascunho.onze], Array(11).fill(null));
  const p = m.T.problemas();
  assert.match(p[0], /^Falta escolher: guarda-redes, defesa esquerdo, defesa central \(2\), defesa direito/);
  assert.ok(p.includes('Faltam 3 suplentes'));
});

test('um jogador por lugar: só quem lá pode jogar; sem lugar pedido vai para onde cabe', async () => {
  const m = montar();
  await m.F.recarregar();
  const ld = 4;                                                    // na 4-3-3, o lugar 4 é o defesa direito
  assert.equal(m.T.nomeLugar('4-3-3', ld), 'Defesa direito');
  assert.equal(m.T.nomeLugar('4-3-3', 1), 'Defesa esquerdo');
  const medio = m.jogadores.find(j => j.posicao === 'MED').id;
  const defesa = m.jogadores.find(j => j.posicao === 'DEF').id;
  assert.match(m.T.podeEntrar(medio, { tipo: 'posto', i: ld }), /^Não joga a defesa direito$/);
  assert.equal(m.T.adicionar(medio, { tipo: 'posto', i: ld }), false);
  assert.equal(m.T.adicionar(defesa, { tipo: 'posto', i: ld }), true);
  assert.equal(m.T.rascunho.onze[ld], defesa);
  /* um avançado sem lugar pedido vai para ponta de lança (só aceita avançados) antes de um extremo */
  const ava = m.jogadores.find(j => j.posicao === 'AVA').id;
  m.T.adicionar(ava);
  assert.equal(m.T.rascunho.onze[9], ava);
  /* trocar o defesa direito por outro: o primeiro sai da equipa */
  const outro = m.jogadores.filter(j => j.posicao === 'DEF')[1].id;
  m.T.adicionar(outro, { tipo: 'posto', i: ld });
  assert.equal(m.T.rascunho.onze[ld], outro);
  assert.ok(!usados(m).includes(defesa));
});

test('equipa completa: 11 nos lugares e 3 suplentes; o 15.º não entra; falta só a braçadeira', async () => {
  const m = montar();
  await m.F.recarregar();
  montarEquipa(m);
  assert.equal(usados(m).length, 14);
  assert.equal(new Set(usados(m)).size, 14);
  const fora = m.jogadores.find(j => j.preco < 50 && !usados(m).includes(j.id));
  assert.match(m.T.podeEntrar(fora.id), /Sem lugar livre/);
  assert.match(m.T.podeEntrar(fora.id, { tipo: 'banco' }), /banco já tem 3/);
  assert.deepEqual([...m.T.problemas()], ['Escolhe o capitão', 'Escolhe o vice-capitão']);
});

test('capitão e vice: só titulares, e trocam um com o outro', async () => {
  const m = montar();
  await m.F.recarregar();
  montarEquipa(m);
  const [a, b] = m.T.rascunho.onze.slice(5, 7);
  m.T.capitao(a); m.T.vice(b);
  m.T.vice(a);                                                    // o capitão passa a vice e o vice a capitão
  assert.equal(m.T.rascunho.vice, a);
  assert.equal(m.T.rascunho.capitao, b);
  m.T.capitao(m.T.rascunho.banco[1]);                             // suplente não pode
  assert.equal(m.T.rascunho.capitao, b);
  assert.deepEqual([...m.T.problemas()], []);
});

test('trocas: suplente só para um lugar onde pode jogar; dois titulares trocam se servirem; capitão no banco perde a braçadeira', async () => {
  const m = montar();
  await m.F.recarregar();
  montarEquipa(m);
  const r = m.T.rascunho;
  const [grSup, defSup, medSup] = r.banco;
  assert.match(m.T.trocar(r.onze[0], defSup), /não joga a guarda-redes/);
  assert.match(m.T.trocar(r.onze[4], medSup), /não joga a defesa direito/);
  /* dois defesas trocam de lado; um defesa e um médio não */
  const [le, ld] = [r.onze[1], r.onze[4]];
  assert.equal(m.T.trocar(le, ld), null);
  assert.equal(m.T.rascunho.onze[1], ld);
  assert.match(m.T.trocar(m.T.rascunho.onze[2], m.T.rascunho.onze[5]), /não joga a/);
  /* o defesa suplente entra para defesa direito, e o capitão que lá estava vai para o banco */
  const capitao = m.T.rascunho.onze[4];
  m.T.capitao(capitao);
  assert.equal(m.T.trocar(capitao, defSup), null);
  assert.equal(m.T.rascunho.onze[4], defSup);
  assert.ok(m.T.rascunho.banco.includes(capitao));
  assert.equal(m.T.rascunho.capitao, null);
  assert.match(m.T.aviso.texto, /deixou de ser capitão/);
  assert.equal(m.T.trocar(grSup, m.T.rascunho.onze[0]), null);   // guarda-redes com guarda-redes
});

test('mudar de formação: cada um para um lugar onde pode jogar; quem não cabe vai para o banco e diz-se', async () => {
  const m = montar();
  await m.F.recarregar();
  montarEquipa(m);
  const antes = new Set(usados(m));
  m.T.mudarFormacao('3-5-2');
  const r = m.T.rascunho;
  assert.equal(r.formacao, '3-5-2');
  assert.deepEqual(new Set(usados(m)), antes);                      // ninguém se perde
  r.onze.forEach((id, i) => { if(id != null) assert.ok(!/não joga/.test(m.T.problemas().join())); });
  assert.equal(r.onze.filter(x => x == null).length, 1);            // falta um ponta de lança (não havia no banco)
  assert.equal(r.banco.length, 4);
  assert.match(m.T.aviso.texto, /passou para o banco: não cabia na 3-5-2/);
  const p = m.T.problemas();
  assert.ok(p.some(x => /Falta escolher: ponta de lança/.test(x)));
  assert.ok(p.some(x => /O banco leva 3 suplentes: vende 1/.test(x)));
  /* voltar à 4-3-3 sobe do banco quem cabe */
  m.T.mudarFormacao('4-3-3');
  assert.equal(m.T.rascunho.onze.filter(x => x == null).length, 0);
  assert.equal(m.T.rascunho.banco.length, 3);
});

test('mover para um lugar vazio e mandar um titular para o banco', async () => {
  const m = montar();
  await m.F.recarregar();
  montarEquipa(m);
  const ld = m.T.rascunho.onze[4];
  m.T.remover(m.T.rascunho.banco[2]);                               // fica um lugar livre no banco
  assert.equal(m.T.paraBanco(ld), null);
  assert.equal(m.T.rascunho.onze[4], null);
  assert.ok(m.T.rascunho.banco.includes(ld));
  assert.match(m.T.colocar(m.T.rascunho.banco[0], 4), /não joga a defesa direito/);   // o guarda-redes suplente
  assert.equal(m.T.colocar(ld, 4), null);
  assert.equal(m.T.rascunho.onze[4], ld);
});

test('orçamento: o jogador caríssimo não cabe', async () => {
  const m = montar();
  await m.F.recarregar();
  montarEquipa(m);
  const caro = m.jogadores.find(j => j.preco > 50);
  assert.match(m.T.podeEntrar(caro.id, { tipo: 'posto', i: 9 }), /^Faltam .* M€$/);
  assert.equal(m.T.adicionar(caro.id, { tipo: 'posto', i: 9 }), false);
  assert.ok(m.T.contas().saldo >= 0);
});

test('o rascunho do visitante passa para a conta ao entrar', async () => {
  const m = montar();
  await m.F.recarregar();
  montarEquipa(m);
  m.T.guardarRascunho();
  assert.ok(m.guardados.has('scp-fantasy-rascunho-v2-anonimo'));
  const antes = JSON.stringify(m.T.rascunho);

  m.Nuvem.perfil = { id: 'u1', utilizador: 'adepto' };
  await m.F.recarregar();
  assert.equal(m.T.eu.id, 'u1');
  assert.equal(JSON.stringify(m.T.rascunho), antes);
  assert.ok(!m.guardados.has('scp-fantasy-rascunho-v2-anonimo'));
  assert.match(m.T.aviso.texto, /antes de entrar/);
});

test('rascunho estragado (repetidos ou formação desconhecida) é ignorado', async () => {
  const m = montar({ perfil: { id: 'u1', utilizador: 'adepto' } });
  const onze = [1, 1, 4, ...Array(8).fill(null)];
  m.localStorage.setItem('scp-fantasy-rascunho-v2-u1', JSON.stringify({ jornada: 7, r: { formacao: '4-3-3', onze, banco: [], capitao: 1, vice: null } }));
  await m.F.recarregar();
  assert.equal(m.T.rascunho.onze.filter(x => x != null).length, 0);
  m.localStorage.setItem('scp-fantasy-rascunho-v2-u1', JSON.stringify({ jornada: 7, r: { formacao: '9-9-9', onze: Array(11).fill(null), banco: [], capitao: null, vice: null } }));
  await m.F.recarregar();
  assert.equal(m.T.rascunho.formacao, '4-3-3');
});

/* 11 titulares (GR, 4 DEF, 3 MED, 3 AVA) e 4 no banco, à moda antiga (sem lugares) */
const TITULARES_ANTIGOS = [1, 4, 5, 6, 7, 10, 11, 12, 16, 17, 18];
const BANCO_ANTIGO = [2, 8, 13, 19];

test('equipa guardada por lugares abre como foi guardada', async () => {
  const minhas = {
    fantasy_equipa_jornada: [{ perfil_id: 'u2', jornada_id: 7, orcamento: 100, formacao: '4-3-3' }],
    fantasy_escolhas: TITULARES_ANTIGOS.map((id, i) => ({ perfil_id: 'u2', jornada_id: 7, jogador_id: id, titular: true, posto: i, capitao: i === 1, vice: i === 2, preco_compra: 5 }))
      .concat([2, 8, 13].map((id, i) => ({ perfil_id: 'u2', jornada_id: 7, jogador_id: id, titular: false, ordem_banco: i + 1, capitao: false, vice: false, preco_compra: 5 })))
  };
  const m = montar({ perfil: { id: 'u2', utilizador: 'outro' }, minhas });
  await m.F.recarregar();
  assert.deepEqual([...m.T.rascunho.onze], TITULARES_ANTIGOS);
  assert.deepEqual([...m.T.rascunho.banco], [2, 8, 13]);
  assert.equal(m.T.rascunho.capitao, 4);
});

test('equipa guardada com as regras antigas (15, sem lugares): arrumada por lugares, e diz o que falta', async () => {
  const minhas = {
    fantasy_equipa_jornada: [{ perfil_id: 'u2', jornada_id: 7, orcamento: 100, formacao: '4-3-3' }],
    fantasy_escolhas: TITULARES_ANTIGOS.map((id, i) => ({ perfil_id: 'u2', jornada_id: 7, jogador_id: id, titular: true, posto: null, capitao: i === 1, vice: i === 2, preco_compra: 5 }))
      .concat(BANCO_ANTIGO.map((id, i) => ({ perfil_id: 'u2', jornada_id: 7, jogador_id: id, titular: false, ordem_banco: i + 1, capitao: false, vice: false, preco_compra: 5 })))
  };
  const m = montar({ perfil: { id: 'u2', utilizador: 'outro' }, minhas });
  await m.F.recarregar();
  const r = m.T.rascunho;
  assert.equal(r.onze.filter(x => x != null).length, 11);
  assert.deepEqual(new Set(usados(m)), new Set([...TITULARES_ANTIGOS, ...BANCO_ANTIGO]));
  r.onze.forEach((id, i) => assert.ok(['GR', 'DEF', 'MED', 'AVA'].includes(pos(m, id))));
  assert.ok(m.T.problemas().some(x => /O banco leva 3 suplentes: vende 1/.test(x)));
});

test('mudar de conta ou sair não deixa à vista os dados da conta anterior', async () => {
  const minhas = {
    fantasy_equipa_jornada: [{ perfil_id: 'u2', jornada_id: 7, orcamento: 100, formacao: '4-3-3' }],
    fantasy_escolhas: TITULARES_ANTIGOS.map((id, i) => ({ perfil_id: 'u2', jornada_id: 7, jogador_id: id, titular: true, posto: i, capitao: i === 1, vice: i === 2, preco_compra: 5 }))
      .concat([2, 8, 13].map((id, i) => ({ perfil_id: 'u2', jornada_id: 7, jogador_id: id, titular: false, ordem_banco: i + 1, capitao: false, vice: false, preco_compra: 5 }))),
    fantasy_perfis: [{ perfil_id: 'u2', nome_equipa: 'Leões do u2' }],
    fantasy_admins: [{ perfil_id: 'u2' }]
  };
  const m = montar({ perfil: { id: 'u2', utilizador: 'outro' }, minhas });
  await m.F.recarregar();
  assert.equal(m.T.minhas.perfil.nome_equipa, 'Leões do u2');
  assert.equal(m.T.admin, true);
  assert.equal(m.T.rascunho.onze.filter(x => x != null).length, 11);

  m.Nuvem.perfil = null;                          // sai da conta
  await m.F.recarregar();
  assert.equal(m.T.minhas.perfil, null);
  assert.equal(m.T.minhas.equipas.length, 0);
  assert.equal(m.T.admin, false);
  assert.equal(m.T.rascunho.onze.filter(x => x != null).length, 0);

  m.Nuvem.perfil = { id: 'u3', utilizador: 'terceiro' }; // entra outra conta, sem equipa
  await m.F.recarregar();
  assert.equal(m.T.minhas.perfil, null);
  assert.equal(m.T.rascunho.onze.filter(x => x != null).length, 0);
});

test('mensagens de erro: português do servidor passa, técnicas não', async () => {
  const { T } = montar();
  assert.match(T.mensagemErro({ message: 'TypeError: Failed to fetch' }), /sem ligação/);
  assert.match(T.mensagemErro({ message: 'JWT expired' }), /sessão expirou/);
  assert.match(T.mensagemErro({ message: 'permission denied for table fantasy_escolhas' }), /não respondeu como esperado/);
  assert.equal(T.mensagemErro({ message: 'Já estás no máximo de ligas.' }), 'Já estás no máximo de ligas.');
});

/* ---------- gestão: relatório colado e golos do calendário */
const PLANTEL_TESTE = [
  { id: 1, nome: 'Rui Silva', nome_curto: 'Rui Silva', posicao: 'GR' },
  { id: 2, nome: 'Francisco Silva', nome_curto: 'F. Silva', posicao: 'GR' },
  { id: 3, nome: 'Zeno Debast', nome_curto: 'Debast', posicao: 'DEF' },
  { id: 4, nome: 'Luis Javier Suárez', nome_curto: 'Suárez', posicao: 'AVA' },
  { id: 5, nome: 'Gonçalo Inácio', nome_curto: 'Inácio', posicao: 'DEF' }
];

test('relatório colado: formatos, sem dados em vez de zero, nomes ambíguos e desconhecidos', () => {
  const { T } = montar();
  const r = T.lerRelatorio(`Rui Silva; 90; 0; 0; 0; 0; 3; 1
Debast; 90
suarez, 78, 2, 1, 1
Inacio 64 1
Silva; 90
Fulano Desconhecido; 90
Debast sem números`, PLANTEL_TESTE);
  const por = id => r.linhas.find(l => l.jogador_id === id);
  assert.equal(por(1).defesas, 3);
  assert.equal(por(1).golos_sofridos, 1);
  assert.equal(por(3).minutos, 90);
  assert.equal(por(3).golos, null);                     // não indicado: sem dados, não zero
  assert.equal(por(4).golos, 2);
  assert.equal(por(4).assistencias, 1);
  assert.equal(por(4).amarelos, 1);
  assert.equal(por(4).defesas, null);                   // defesas só contam para guarda-redes
  assert.equal(por(5).minutos, 64);
  assert.equal(por(5).golos, 1);
  assert.deepEqual([...r.ambiguos], ['Silva']);          // Rui Silva e F. Silva
  assert.ok(r.naoReconhecidos.includes('Fulano Desconhecido'));
  assert.ok(r.naoReconhecidos.includes('Debast sem números'));
  assert.equal(r.linhas.length, 4);
});

test('golos do calendário: marcadores do Sporting, sem os autogolos do adversário; autogolos nossos à parte', () => {
  const { T } = montar();
  const jogo = { casa: 'Lens', fora: 'Sporting CP', golosCasa: 1, golosFora: 3,
    marcadoresCasa: [{ nome: 'Debast', minuto: '50', tipo: 'ag' }],
    marcadoresFora: [{ nome: 'Suárez', minuto: '12', tipo: '' }, { nome: 'Suárez', minuto: '61', tipo: 'gp' }, { nome: 'Gradit', minuto: '70', tipo: 'ag' }] };
  const g = T.golosDoCalendario(jogo, PLANTEL_TESTE);
  assert.equal(g.golos_casa, 1);
  assert.equal(g.golos_fora, 3);
  assert.equal(g.golos.get(4), 2);                      // dois do Suárez (um de penálti)
  assert.equal(g.golos.size, 1);                        // o autogolo do Gradit não é de ninguém do Sporting
  assert.equal(g.autogolos.get(3), 1);                  // o autogolo do Debast
  assert.equal(T.golosDoCalendario(null, PLANTEL_TESTE), null);
});

test('painel de gestão: jornadas em atraso, relatório colado e cálculo das que já têm estatísticas', async () => {
  const ontem = new Date(Date.now() - 86400e3).toISOString();
  const anteontem = new Date(Date.now() - 2 * 86400e3).toISOString();
  const m = montar({ perfil: { id: 'adm', utilizador: 'admin' }, minhas: {
    fantasy_admins: [{ perfil_id: 'adm' }],
    fantasy_jornadas: [
      { id: 7, numero: 1, fecho: anteontem, finalizada_em: null, calculada_em: null, jogo_id: 70, jogo: { casa: 'Sporting CP', fora: 'Moreirense', competicao: 'Liga', data: anteontem, golos_casa: 3, golos_fora: 0 } },
      { id: 8, numero: 2, fecho: ontem, finalizada_em: null, calculada_em: ontem, jogo_id: 71, jogo: { casa: 'Lens', fora: 'Sporting CP', competicao: 'Champions', data: ontem, golos_casa: 0, golos_fora: 2 } }
    ]
  } });
  await m.F.recarregar();
  assert.equal(m.T.admin, true);
  const html = m.T.gestao();
  assert.match(html, /Jornadas em atraso <span>2<\/span>/);
  assert.match(html, /sem estatísticas/);
  assert.match(html, /provisória/);
  assert.match(html, /Colar o relatório do jogo/);
  assert.match(html, /Golos e resultado da Wikipédia/);
});
