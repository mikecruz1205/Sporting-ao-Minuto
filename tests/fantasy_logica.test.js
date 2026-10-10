/* Testes das regras da equipa Fantasy no browser (js/fantasy.js), sem
   servidor nem página: o ficheiro corre numa sandbox com um Supabase falso.

   Correr:  node --test tests/
   (o python -m unittest também os corre, por tests/test_fantasy_js.py)

   Os números de configuração são os da migração
   supabase/migrations/20261009120100_fantasy_tabelas.sql. */

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
    fecho_minutos_antes: 0, horas_ate_final: 48
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
  const Nuvem = { cliente: supabaseFalso(tabelas), perfil };
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

/* compra os 15 mais baratos que cabem: 2 GR, 5 DEF, 5 MED, 3 AVA */
function comprarQuinze({ T, jogadores }){
  const quero = { GR: 2, DEF: 5, MED: 5, AVA: 3 };
  jogadores.filter(j => j.preco < 50).forEach(j => { if(quero[j.posicao]-- > 0) T.adicionar(j.id); });
}

test('visitor: o Fantasy carrega e diz o que falta', async () => {
  const m = montar();
  await m.F.recarregar();
  assert.equal(m.T.estado, 'pronto');
  assert.equal(m.T.rascunho.titulares.length + m.T.rascunho.banco.length, 0);
  assert.ok(m.T.problemas().some(p => /guarda-redes/.test(p)));
});

test('comprar 15: onze válido, GR suplente à frente do banco, sem repetidos', async () => {
  const m = montar();
  await m.F.recarregar();
  comprarQuinze(m);
  const r = m.T.rascunho;
  const todos = [...r.titulares, ...r.banco];
  assert.equal(r.titulares.length, 11);
  assert.equal(r.banco.length, 4);
  assert.equal(new Set(todos).size, 15);
  const pos = id => m.jogadores.find(j => j.id === id).posicao;
  assert.equal(pos(r.banco[0]), 'GR');
  assert.equal(r.titulares.filter(id => pos(id) === 'GR').length, 1);
  const c = m.T.contar(r.titulares);
  assert.ok(c.DEF >= 3 && c.DEF <= 5 && c.MED >= 2 && c.MED <= 5 && c.AVA >= 1 && c.AVA <= 3);
  /* comprar outra vez o mesmo não duplica */
  m.T.adicionar(r.titulares[0]);
  assert.equal([...r.titulares, ...r.banco].length, 15);
  /* falta só a braçadeira */
  assert.deepEqual([...m.T.problemas()], ['Escolhe o capitão', 'Escolhe o vice-capitão']);
});

test('limites: terceiro guarda-redes e jogador acima do orçamento não entram', async () => {
  const m = montar();
  await m.F.recarregar();
  [1, 2, 3].forEach(id => m.T.adicionar(id));
  assert.equal(m.T.contar([...m.T.rascunho.titulares, ...m.T.rascunho.banco]).GR, 2);
  comprarQuinze(m);
  const caro = m.jogadores.find(j => j.preco > 50);
  m.T.remover(m.T.rascunho.titulares.find(id => m.jogadores.find(j => j.id === id).posicao === 'AVA'));
  m.T.adicionar(caro.id);
  assert.ok(![...m.T.rascunho.titulares, ...m.T.rascunho.banco].includes(caro.id));
  assert.ok(m.T.contas().saldo >= 0);
});

test('capitão e vice: trocam de lugar e só titulares', async () => {
  const m = montar();
  await m.F.recarregar();
  comprarQuinze(m);
  const [a, b] = m.T.rascunho.titulares.slice(1, 3);
  m.T.capitao(a); m.T.vice(b);
  assert.equal(m.T.rascunho.capitao, a);
  assert.equal(m.T.rascunho.vice, b);
  m.T.vice(a);                                   // o capitão passa a vice e o vice a capitão
  assert.equal(m.T.rascunho.vice, a);
  assert.equal(m.T.rascunho.capitao, b);
  m.T.capitao(m.T.rascunho.banco[1]);            // suplente não pode
  assert.equal(m.T.rascunho.capitao, b);
  assert.deepEqual([...m.T.problemas()], []);
});

test('trocas: GR só com GR, formação inválida recusada, capitão no banco perde a braçadeira com aviso', async () => {
  const m = montar();
  await m.F.recarregar();
  comprarQuinze(m);
  const r = m.T.rascunho;
  const pos = id => m.jogadores.find(j => j.id === id).posicao;
  const grTit = r.titulares.find(id => pos(id) === 'GR');
  const supCampo = r.banco.find(id => pos(id) !== 'GR');
  assert.match(m.T.trocar(grTit, supCampo), /guarda-redes/);
  /* um titular com um titular não é troca */
  assert.match(m.T.trocar(r.titulares[1], r.titulares[2]), /titular e um suplente/);
  /* troca válida da mesma posição, com o capitão a sair */
  const sup = r.banco.find(id => pos(id) !== 'GR');
  const tit = r.titulares.find(id => pos(id) === pos(sup));
  m.T.capitao(tit);
  assert.equal(m.T.trocar(tit, sup), null);
  assert.ok(m.T.rascunho.titulares.includes(sup));
  assert.ok(m.T.rascunho.banco.includes(tit));
  assert.equal(m.T.rascunho.capitao, null);
  assert.match(m.T.aviso.texto, /deixou de ser capitão/);
  assert.equal(new Set([...m.T.rascunho.titulares, ...m.T.rascunho.banco]).size, 15);
});

test('o rascunho do visitante passa para a conta ao entrar', async () => {
  const m = montar();
  await m.F.recarregar();
  comprarQuinze(m);
  m.T.guardarRascunho();
  assert.ok(m.guardados.has('scp-fantasy-rascunho-anonimo'));
  const antes = JSON.stringify(m.T.rascunho);

  m.Nuvem.perfil = { id: 'u1', utilizador: 'adepto' };
  await m.F.recarregar();
  assert.equal(m.T.eu.id, 'u1');
  assert.equal(JSON.stringify(m.T.rascunho), antes);
  assert.ok(!m.guardados.has('scp-fantasy-rascunho-anonimo'));
  assert.match(m.T.aviso.texto, /antes de entrar/);
});

test('rascunho estragado (repetidos) é ignorado', async () => {
  const m = montar({ perfil: { id: 'u1', utilizador: 'adepto' } });
  m.localStorage.setItem('scp-fantasy-rascunho-u1', JSON.stringify({ jornada: 7, r: { titulares: [1, 1, 4], banco: [], capitao: 1, vice: null } }));
  await m.F.recarregar();
  assert.equal(m.T.rascunho.titulares.length, 0);
});

test('mudar de conta ou sair não deixa à vista os dados da conta anterior', async () => {
  const minhas = {
    fantasy_equipa_jornada: [{ perfil_id: 'u2', jornada_id: 7, orcamento: 100 }],
    fantasy_escolhas: [1, 4, 5, 6, 10, 11, 12, 16, 17, 18, 13].map((id, i) => ({ perfil_id: 'u2', jornada_id: 7, jogador_id: id, titular: true, capitao: i === 1, vice: i === 2, preco_compra: 5 }))
      .concat([2, 7, 14, 19].map((id, i) => ({ perfil_id: 'u2', jornada_id: 7, jogador_id: id, titular: false, ordem_banco: i, capitao: false, vice: false, preco_compra: 5 }))),
    fantasy_perfis: [{ perfil_id: 'u2', nome_equipa: 'Leões do u2' }],
    fantasy_admins: [{ perfil_id: 'u2' }]
  };
  const m = montar({ perfil: { id: 'u2', utilizador: 'outro' }, minhas });
  await m.F.recarregar();
  assert.equal(m.T.minhas.perfil.nome_equipa, 'Leões do u2');
  assert.equal(m.T.admin, true);
  assert.equal(m.T.rascunho.titulares.length, 11);

  m.Nuvem.perfil = null;                          // sai da conta
  await m.F.recarregar();
  assert.equal(m.T.minhas.perfil, null);
  assert.equal(m.T.minhas.equipas.length, 0);
  assert.equal(m.T.admin, false);
  assert.equal(m.T.rascunho.titulares.length, 0);

  m.Nuvem.perfil = { id: 'u3', utilizador: 'terceiro' }; // entra outra conta, sem equipa
  await m.F.recarregar();
  assert.equal(m.T.minhas.perfil, null);
  assert.equal(m.T.rascunho.titulares.length, 0);
});

test('mensagens de erro: português do servidor passa, técnicas não', async () => {
  const { T } = montar();
  assert.match(T.mensagemErro({ message: 'TypeError: Failed to fetch' }), /sem ligação/);
  assert.match(T.mensagemErro({ message: 'JWT expired' }), /sessão expirou/);
  assert.match(T.mensagemErro({ message: 'permission denied for table fantasy_escolhas' }), /não respondeu como esperado/);
  assert.equal(T.mensagemErro({ message: 'Já estás no máximo de ligas.' }), 'Já estás no máximo de ligas.');
});
