/* Testes do museu (js/museu.js) e dos dados do palmarés (js/data.js).

   Correr:  node --test tests/
   (o python -m unittest também os corre, por tests/test_javascript.py)

   Os números esperados são os da Wikipédia (pt e en), verificados a 10 de
   outubro de 2026. Se o Sporting ganhar um troféu, atualiza-se PALMARES e
   estes números. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

function montar(){
  const sandbox = {
    window: {}, console,
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) },
    Componentes: { seguro: t => String(t ?? '') },
    tacaSVG: () => '<svg></svg>',
    setTimeout: () => 0, clearTimeout: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(ler('data.js') + '\n;this.PALMARES = PALMARES; this.CLUBE = CLUBE;', sandbox, { filename: 'data.js' });
  vm.runInContext(ler('museu.js'), sandbox, { filename: 'museu.js' });
  return { P: sandbox.PALMARES, CLUBE: sandbox.CLUBE, T: sandbox.window.Museu._teste };
}

test('números do palmarés: os das duas Wikipédias', () => {
  const { P, T } = montar();
  const n = id => P.competicoes.find(c => c.id === id).epocas.length;
  assert.equal(n('liga'), 21);
  assert.equal(n('taca'), 18);
  assert.equal(n('supertaca'), 9);
  assert.equal(n('ligacup'), 4);
  assert.equal(n('europa'), 1);
  assert.equal(n('cpt'), 4);
  assert.equal(T.totalPrincipal(), 57);
});

test('épocas bem escritas, por ordem e sem repetidas', () => {
  const { P } = montar();
  for(const c of P.competicoes){
    const es = c.epocas.map(([e]) => e);
    assert.equal(new Set(es).size, es.length, `${c.id} tem épocas repetidas`);
    es.forEach(e => assert.match(e, /^\d{4}(–\d{2})?$/, `${c.id}: época mal escrita "${e}"`));
    const anos = es.map(e => parseInt(e, 10));
    assert.deepEqual([...anos], [...anos].sort((a, b) => a - b), `${c.id} fora de ordem`);
    /* uma época "AAAA–BB" tem de ser de um ano para o seguinte */
    es.filter(e => e.includes('–')).forEach(e => {
      const [a, b] = e.split('–');
      assert.equal((Number(a) + 1) % 100, Number(b), `${c.id}: "${e}" não é uma época seguida`);
    });
    c.epocas.forEach(([, artigo]) => assert.ok(artigo === null || typeof artigo === 'string'));
  }
});

test('dobradinhas (Campeonato e Taça na mesma época)', () => {
  const { P, T } = montar();
  const liga = P.competicoes.find(c => c.id === 'liga').epocas.map(([e]) => e);
  assert.deepEqual([...liga.filter(T.temDobradinha)], ['1940–41', '1947–48', '1953–54', '1973–74', '1981–82', '2001–02', '2024–25']);
});

test('filtros da linha do tempo', () => {
  const { T } = montar();
  assert.equal(T.filtrar('todas').length, 60);          // sem os regionais
  assert.equal(T.filtrar('regionais').length, 31);
  assert.equal(T.filtrar('supertaca').length, 9);
  assert.equal(T.filtrar('europa').length, 3);          // Taça das Taças, Intertoto, Ibérica
  assert.equal(T.filtrar('extintas').length, 8);
  assert.equal(T.filtrar('todas', '1940').length, 10);
  assert.equal(T.filtrar('todas', 'todas', '1974').length, 2);       // 1973/74: Campeonato e Taça
  assert.equal(T.filtrar('todas', 'todas', '2021').length, 4);       // 2020/21 (Liga, Taça da Liga), 2021 Supertaça, 2021/22 Taça da Liga
  assert.equal(T.filtrar('todas', 'todas', 'dobradinha').length, 14);
  assert.equal(T.filtrar('todas', 'todas', 'taca das tacas').length, 1);
  assert.equal(T.filtrar('liga', '1990').length, 1);                // 1999/00
  assert.equal(T.filtrar('ligacup', '1960').length, 0);
});

test('"na mesma época" não mistura a Supertaça nem os regionais', () => {
  const { T } = montar();
  const x = T.todas().find(y => y.chave === 'liga:2020–21');
  assert.deepEqual([...T.mesmaEpoca(x).map(y => y.c.id)], ['ligacup']);
  const s = T.todas().find(y => y.chave === 'supertaca:2021');
  assert.equal(T.mesmaEpoca(s).length, 0);
});

test('campeões no plantel: cada título existe no palmarés do clube', () => {
  const { P, CLUBE } = montar();
  const doClube = id => new Set(P.competicoes.find(c => c.id === id).epocas.map(([e]) => e));
  for(const j of CLUBE.campeoes){
    for(const [comp, epocas] of Object.entries(j.titulos)){
      assert.ok(['liga', 'taca', 'ligacup', 'supertaca'].includes(comp), `${j.nome}: competição desconhecida ${comp}`);
      epocas.forEach(e => assert.ok(doClube(comp).has(e), `${j.nome}: ${comp} ${e} não está no palmarés do Sporting`));
    }
  }
  /* quem chegou em 2025 não tem títulos: em 2025/26 o Sporting não ganhou nada */
  assert.ok(!CLUBE.campeoes.some(j => j.nome === 'Georgios Vagiannidis'));
  assert.equal(CLUBE.titulos, undefined, 'os números antigos (11 Supertaças, 5 Taças da Liga) não podem voltar');
});
