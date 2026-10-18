/* Regras dos prognósticos e do Homem do jogo no browser (js/prognosticos.js).
   As mesmas contas fazem-se no servidor (prognostico_pontos), testadas em
   supabase/testes/prognosticos_testes.sql. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {}, console, document: { addEventListener: () => {}, getElementById: () => null, querySelector: () => null },
                  Componentes: { seguro: t => String(t ?? '') }, Nuvem: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'prognosticos.js'), 'utf8'), sandbox);
const T = sandbox.window.Prognosticos._teste;

test('pontos: exato 3, vencedor ou empate certo 1, resto 0, sem resultado null', () => {
  const fora = { sporting_casa: false, golos_casa: 1, golos_fora: 2 };       // Rival 1–2 Sporting
  assert.equal(T.pontos({ golos_sporting: 2, golos_adversario: 1 }, fora), 3);
  assert.equal(T.pontos({ golos_sporting: 4, golos_adversario: 0 }, fora), 1);
  assert.equal(T.pontos({ golos_sporting: 1, golos_adversario: 1 }, fora), 0);
  const empate = { sporting_casa: true, golos_casa: 0, golos_fora: 0 };
  assert.equal(T.pontos({ golos_sporting: 2, golos_adversario: 2 }, empate), 1);
  assert.equal(T.pontos({ golos_sporting: 1, golos_adversario: 0 }, { sporting_casa: true, golos_casa: null, golos_fora: null }), null);
});

test('próximo jogo e jogo em votação (do fim previsto até 3 dias depois)', () => {
  const agora = Date.parse('2026-10-18T20:00:00Z');
  const lista = [
    { id: 1, data: '2026-10-14T19:00:00Z' },        // há 4 dias: votação fechada
    { id: 2, data: '2026-10-18T17:00:00Z' },        // há 3 h: em votação
    { id: 3, data: '2026-10-18T19:00:00Z' },        // há 1 h: ainda a decorrer
    { id: 4, data: '2026-10-21T20:00:00Z' },
    { id: 5, data: '2026-10-25T20:00:00Z' }
  ];
  assert.equal(T.proximoJogo(lista, agora).id, 4);
  assert.equal(T.jogoParaVotar(lista, agora).id, 2);
  assert.equal(T.jogoParaVotar(lista, Date.parse('2026-10-18T18:30:00Z')), null);
});

test('jogo do calendário ↔ jogo da base de dados (mesmo dia e adversário)', () => {
  const lista = [
    { id: 7, data: '2026-10-21T20:00:00Z', casa: 'Sporting CP', fora: 'LASK', sporting_casa: true },
    { id: 8, data: '2026-10-25T20:00:00Z', casa: 'V. Guimarães', fora: 'Sporting CP', sporting_casa: false }
  ];
  assert.equal(T.correspondente(lista, { data: '2026-10-21T20:00:00Z', casa: 'Sporting CP', fora: 'LASK' }).id, 7);
  assert.equal(T.correspondente(lista, { data: '2026-10-25T20:00:00Z', casa: 'Vitória de Guimarães', fora: 'Sporting CP' }).id, 8);
  assert.equal(T.correspondente(lista, { data: '2026-10-22T20:00:00Z', casa: 'Sporting CP', fora: 'LASK' }), null);
});
