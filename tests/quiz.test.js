/* Testes do motor do Quiz Leonino e do Desafio do Dia (js/quiz.js),
   com o banco verdadeiro (dados/quiz.json), sem página.

   Correr:  node --test tests/
   (o python -m unittest também os corre, por tests/test_javascript.py) */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..');
const BANCO = JSON.parse(fs.readFileSync(path.join(raiz, 'dados', 'quiz.json'), 'utf8')).perguntas;

function motor(){
  const sandbox = { window: {}, console, document: { querySelector: () => null, getElementById: () => null, addEventListener: () => {} },
                    Componentes: { seguro: t => String(t ?? '') }, localStorage: { getItem: () => null, setItem: () => {} } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'js', 'quiz.js'), 'utf8'), sandbox, { filename: 'quiz.js' });
  return sandbox.window.QuizMotor;
}
const M = motor();
const aleatorio = semente => M.semente(semente);
const original = id => BANCO.find(p => p.id === id);
const textoCerto = p => p.opcoes[p.correta];

test('novo jogo: 15 perguntas, 5 de cada dificuldade por ordem, sem repetir, com a resposta certa preservada', () => {
  const j = M.novoJogo(BANCO, aleatorio(1));
  assert.equal(j.perguntas.length, 15);
  assert.deepEqual([...j.perguntas.map(p => p.dificuldade)], [...Array(5).fill('facil'), ...Array(5).fill('media'), ...Array(5).fill('dificil')]);
  assert.equal(new Set(j.perguntas.map(p => p.id)).size, 15);
  j.perguntas.forEach(p => {
    assert.equal(p.opcoes.length, 4);
    assert.equal(textoCerto(p), textoCerto(original(p.id)));
  });
  /* as reservas não repetem as do jogo */
  Object.values(j.reservas).flat().forEach(r => assert.ok(!j.perguntas.some(p => p.id === r.id)));
});

test('escada: certas sobem; errar antes da 5.ª dá 0, entre a 6.ª e a 10.ª dá o 1.º patamar, depois o 2.º', () => {
  const jogarAte = (i, errar) => {
    const j = M.novoJogo(BANCO, aleatorio(2));
    for(let k = 0; k < i; k++){ M.responder(j, j.perguntas[k].correta); M.seguinte(j); }
    if(errar){ M.responder(j, (j.perguntas[i].correta + 1) % 4); }
    return j;
  };
  assert.equal(jogarAte(3, true).pontos, 0);
  assert.equal(jogarAte(6, true).pontos, M.ESCADA[4]);       // 100
  assert.equal(jogarAte(11, true).pontos, M.ESCADA[9]);      // 600
  const ganhou = jogarAte(14, false);
  M.responder(ganhou, ganhou.perguntas[14].correta);
  assert.equal(ganhou.estado, 'ganhou');
  assert.equal(ganhou.pontos, 1906);
  assert.equal(ganhou.certas, 15);
});

test('parar: leva os pontos da última certa', () => {
  const j = M.novoJogo(BANCO, aleatorio(3));
  M.desistir(j);
  assert.equal(j.pontos, 0);
  const k = M.novoJogo(BANCO, aleatorio(3));
  for(let i = 0; i < 7; i++){ M.responder(k, k.perguntas[i].correta); M.seguinte(k); }
  M.desistir(k);
  assert.equal(k.estado, 'desistiu');
  assert.equal(k.pontos, M.ESCADA[6]);
});

test('50:50 tira duas erradas e nunca a certa; só uma vez', () => {
  for(let s = 0; s < 40; s++){
    const j = M.novoJogo(BANCO, aleatorio(s));
    M.usarMetade(j, aleatorio(s + 100));
    assert.equal(j.escondidas.length, 2);
    assert.ok(!j.escondidas.includes(j.perguntas[0].correta));
    const antes = [...j.escondidas];
    M.usarMetade(j, aleatorio(s + 200));
    assert.deepEqual([...j.escondidas], antes);
  }
});

test('trocar põe outra pergunta da mesma dificuldade, uma vez', () => {
  const j = M.novoJogo(BANCO, aleatorio(4));
  for(let i = 0; i < 6; i++){ M.responder(j, j.perguntas[i].correta); M.seguinte(j); }
  const antes = j.perguntas[6].id;
  M.usarTrocar(j, aleatorio(5));
  assert.notEqual(j.perguntas[6].id, antes);
  assert.equal(j.perguntas[6].dificuldade, 'media');
  assert.equal(j.ajudas.trocar, false);
  const depois = j.perguntas[6].id;
  M.usarTrocar(j, aleatorio(6));
  assert.equal(j.perguntas[6].id, depois);
});

test('público: somam 100, a certa dentro do intervalo da dificuldade, as tiradas pelo 50:50 a zero', () => {
  for(let s = 0; s < 60; s++){
    const p = M.prepararPergunta(BANCO[s % BANCO.length], aleatorio(s));
    const nivel = ['facil', 'media', 'dificil'][s % 3];
    const escondidas = s % 2 ? [0, 1, 2, 3].filter(k => k !== p.correta).slice(0, 2) : [];
    const v = M.votosDoPublico(p, escondidas, nivel, aleatorio(s + 7));
    assert.equal(v.reduce((a, b) => a + b, 0), 100);
    const [min, max] = { facil: [55, 80], media: [40, 65], dificil: [30, 52] }[nivel];
    assert.ok(v[p.correta] >= min && v[p.correta] <= max, `${nivel}: ${v[p.correta]}`);
    escondidas.forEach(k => assert.equal(v[k], 0));
    v.forEach(x => assert.ok(x >= 0));
  }
});

test('Desafio do Dia: a mesma pergunta para a mesma data, sem repetir antes de o banco acabar', () => {
  const dia = n => new Date(Date.parse('2026-10-16T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  assert.equal(M.perguntaDoDia(BANCO, dia(0)).id, M.perguntaDoDia([...BANCO].reverse(), dia(0)).id);   // ordem do ficheiro não conta
  const ciclo = Array.from({ length: BANCO.length }, (_, n) => M.perguntaDoDia(BANCO, dia(n)).id);
  assert.equal(new Set(ciclo).size, BANCO.length);
  assert.equal(M.numeroDoDesafio('2026-10-16'), 1);
  assert.equal(M.numeroDoDesafio('2026-10-17'), 2);
});

test('Desafio do Dia: o dia muda à meia-noite de Lisboa', () => {
  assert.equal(M.dataLisboa(new Date('2026-10-16T22:59:00Z')), '2026-10-16');   // 23:59 em Lisboa (verão)
  assert.equal(M.dataLisboa(new Date('2026-10-16T23:01:00Z')), '2026-10-17');   // 00:01 em Lisboa
  assert.equal(M.dataLisboa(new Date('2026-12-31T23:30:00Z')), '2026-12-31');   // inverno: Lisboa = UTC
});

test('sequência de dias certos e partilha sem a resposta', () => {
  const r = { '2026-10-14': true, '2026-10-15': true, '2026-10-16': true };
  assert.equal(M.sequencia(r, '2026-10-16'), 3);
  assert.equal(M.sequencia(r, '2026-10-17'), 3);            // hoje ainda não respondeu: conta até ontem
  assert.equal(M.sequencia({ ...r, '2026-10-17': false }, '2026-10-17'), 0);
  assert.equal(M.sequencia({ '2026-10-14': true, '2026-10-16': true }, '2026-10-16'), 1);   // falhou um dia
  const p = M.perguntaDoDia(BANCO, '2026-10-16');
  const texto = M.textoPartilha({ numero: 1, certo: true, seq: 3, url: 'https://exemplo/desafio' });
  assert.ok(!texto.includes(textoCerto(p)));
  assert.match(texto, /n\.º 1/);
  assert.match(texto, /acertei/);
});
