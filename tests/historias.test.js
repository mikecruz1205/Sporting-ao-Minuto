/* Histórias, selo Oficial e rumores por jogador (js/historias.js). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'historias.js'), 'utf8'), sandbox);
const H = sandbox.window.Historias;

const n = (titulo, canal, quando, extra = {}) => ({ titulo, canal, fonte: canal.toUpperCase(), link: 'https://x/' + encodeURIComponent(titulo), data: new Date(quando), ...extra });
const maisRecentePrimeiro = l => l.sort((a, b) => b.data - a.data);

test('palavras: hífen junta, plural simples e palavras vazias saem', () => {
  const p = [...H._teste.palavras('Sporting perde guarda-redes e conquistas do Leão')];
  assert.deepEqual(p.sort(), ['conquista', 'guardarede', 'perde']);
});

test('a mesma história em vários jornais junta-se; a mais recente fica à frente', () => {
  const lista = maisRecentePrimeiro([
    n('Sporting conquista Supertaça com triunfo sobre o Benfica', 'abola', '2026-10-17T16:40:00Z'),
    n('Imparáveis! Sporting passa Benfica a ferro e conquista Supertaça', 'leonino', '2026-10-17T17:39:00Z'),
    n('Sporting vence Benfica e conquista a Supertaça de voleibol', 'zz', '2026-10-17T17:14:00Z'),
    n('Hjulmand renova contrato até 2030', 'record', '2026-10-17T12:00:00Z')
  ]);
  const h = H.agrupar(lista);
  assert.equal(h.length, 2);
  assert.equal(h[0].todas.length, 3);
  assert.equal(h[0].principal.canal, 'leonino');                 // a mais recente
  assert.equal(h[0].todas[0].canal, 'abola');                    // a primeira a dar
  assert.deepEqual([...h[0].canais].sort(), ['abola', 'leonino', 'zz']);
});

test('palavras de todos os dias (o treinador) não encadeiam histórias diferentes', () => {
  const lista = maisRecentePrimeiro([
    n('Rui Borges elogia Hjulmand depois do treino', 'a', '2026-10-15T10:00:00Z'),
    n('Rui Borges confirma lesão de Quenda', 'b', '2026-10-16T10:00:00Z'),
    n('Rui Borges prepara mudanças no onze', 'c', '2026-10-17T10:00:00Z'),
    n('Rui Borges admite mudanças no onze frente ao LASK', 'd', '2026-10-17T12:00:00Z')
  ]);
  const h = H.agrupar(lista);
  assert.equal(h.length, 3);
  assert.equal(h[0].todas.length, 2);                             // só as duas das mudanças no onze
});

test('o mesmo título com mais de um dia e meio de diferença são histórias diferentes', () => {
  const lista = maisRecentePrimeiro([
    n('Quenda volta aos treinos condicionado', 'a', '2026-10-12T10:00:00Z'),
    n('Quenda volta aos treinos condicionado', 'b', '2026-10-14T10:00:00Z')
  ]);
  assert.equal(H.agrupar(lista).length, 2);
});

test('selo Oficial: o título diz que é oficial; "não é oficial" e "oficiosa" não contam', () => {
  assert.equal(H.eOficial({ titulo: 'Oficial! Varandas renova com médio do Sporting' }), true);
  assert.equal(H.eOficial({ titulo: 'Sporting oficializa contratação de lateral' }), true);
  assert.equal(H.eOficial({ titulo: 'Saída de avançado ainda não é oficial' }), false);
  assert.equal(H.eOficial({ titulo: 'Proposta oficiosa do Nápoles por Hjulmand' }), false);
  const [h] = H.agrupar([n('Oficial: Hjulmand renova até 2030', 'a', '2026-10-17T12:00:00Z'),
                         n('Hjulmand renova até 2030 com cláusula', 'b', '2026-10-17T11:00:00Z')]);
  assert.equal(h.oficial, true);
});

test('rumores por jogador: nome completo, apelido só se for raro e único no plantel', () => {
  const plantel = ['Rui Silva', 'Francisco Silva', 'Morten Hjulmand', 'Geovany Quenda'];
  const merc = [
    n('Nápoles insiste em Hjulmand', 'record', '2026-10-10T10:00:00Z'),
    n('Proposta de 50M por Morten Hjulmand recusada', 'abola', '2026-10-12T10:00:00Z'),
    n('Hjulmand: Sporting fixa preço', 'ojogo', '2026-10-14T10:00:00Z'),
    n('Silva na mira do Benfica', 'cm', '2026-10-13T10:00:00Z'),               // que Silva? não conta
    n('Rui Silva interessa a clube inglês', 'cm', '2026-10-13T11:00:00Z'),
    n('Rui Silva pode sair em janeiro', 'mf', '2026-10-15T11:00:00Z'),
    n('Quenda só tem uma notícia', 'mf', '2026-10-15T12:00:00Z')
  ];
  const r = H.rumoresPorJogador(merc, plantel);
  assert.deepEqual(r.map(x => x.nome), ['Morten Hjulmand', 'Rui Silva']);  // mais jornais primeiro; Quenda só tem uma
  assert.equal(r[0].noticias.length, 3);
  assert.equal(r[0].desde.toISOString(), '2026-10-10T10:00:00.000Z');
  assert.equal(r[1].noticias.length, 2);                                   // o "Silva" sozinho ficou de fora
  assert.equal(H.rumoresPorJogador(merc, plantel, { minimo: 1 }).length, 3);
});
