/* Que avisos push enviar (supabase/functions/notificar/decidir.mjs).
   A parte que envia (index.ts) precisa das chaves VAPID e não corre aqui. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const carregar = () => import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'notificar', 'decidir.mjs')).href);
const agora = Date.parse('2026-10-21T20:05:00Z');
const jogo = (id, data, extra = {}) => ({ id, data, competicao: 'Liga dos Campeões', fase: 'Fase de liga · jornada 3',
                                          casa: 'Sporting CP', fora: 'LASK', golos_casa: null, golos_fora: null, ...extra });

test('início do jogo: só nos primeiros 20 minutos e uma vez', async () => {
  const { decidir } = await carregar();
  const jogos = [jogo(17, '2026-10-21T20:00:00Z'), jogo(18, '2026-10-21T19:30:00Z'), jogo(19, '2026-10-21T20:30:00Z')];
  const a = decidir({ agora, jogos });
  assert.deepEqual(a.map(x => x.chave), ['inicio-17']);
  assert.equal(a[0].titulo, 'Está a começar: Sporting CP – LASK');
  assert.equal(a[0].corpo, 'Liga dos Campeões · Fase de liga · jornada 3');
  assert.deepEqual(decidir({ agora, jogos, enviados: [{ chave: 'inicio-17', tipo: 'INICIO' }] }), []);
});

test('resultado: quando fica escrito, com vitória ou derrota do lado certo', async () => {
  const { decidir } = await carregar();
  const fora = jogo(20, '2026-10-20T19:00:00Z', { casa: 'Benfica', fora: 'Sporting CP', golos_casa: 1, golos_fora: 2 });
  const casa = jogo(21, '2026-10-21T18:00:00Z', { golos_casa: 0, golos_fora: 1 });
  const antigo = jogo(22, '2026-10-17T19:00:00Z', { golos_casa: 3, golos_fora: 0 });     // mais de 36 h: não se avisa
  const a = decidir({ agora, jogos: [fora, casa, antigo] });
  assert.deepEqual(a.map(x => x.chave), ['resultado-20', 'resultado-21']);
  assert.equal(a[0].titulo, 'Benfica 1–2 Sporting CP');
  assert.match(a[0].corpo, /^Vitória do Sporting/);
  assert.match(a[1].corpo, /^Derrota do Sporting/);
  assert.equal(a[0].tag, 'jogo-20');                                                    // substitui o "está a começar"
});

test('Fantasy: 2 horas antes do fecho, com a hora de Lisboa', async () => {
  const { decidir } = await carregar();
  const jornadas = [
    { id: 9, numero: 9, fecho: '2026-10-21T21:30:00Z', finalizada_em: null },           // daqui a 1 h 25
    { id: 10, numero: 10, fecho: '2026-10-21T23:30:00Z', finalizada_em: null },         // daqui a 3 h 25
    { id: 11, numero: 11, fecho: '2026-10-21T21:00:00Z', finalizada_em: '2026-10-21T19:00:00Z' }
  ];
  const a = decidir({ agora, jornadas });
  assert.deepEqual(a.map(x => x.chave), ['jornada-9']);
  assert.equal(a[0].titulo, 'Fantasy: a jornada 9 fecha às 22:30');                     // outubro: Lisboa = UTC+1
});

test('notícia oficial: a mais recente, com até 3 horas, e no máximo uma a cada 2 horas', async () => {
  const { decidir, resumoTexto } = await carregar();
  const noticias = [
    { titulo: 'Oficial! Hjulmand renova até 2030', fonte: 'RECORD', link: 'https://x/1', data: '2026-10-21T19:00:00Z' },
    { titulo: 'Oficial: Quenda renova', fonte: 'A BOLA', link: 'https://x/2', data: '2026-10-21T19:40:00Z' },
    { titulo: 'Oficial: Trincão renova', fonte: 'A BOLA', link: 'https://x/3', data: '2026-10-21T15:00:00Z' },   // velha
    { titulo: 'Saída de avançado ainda não é oficial', fonte: 'CM', link: 'https://x/4', data: '2026-10-21T20:00:00Z' }
  ];
  const a = decidir({ agora, noticias });
  assert.equal(a.length, 1);
  assert.equal(a[0].corpo, 'Oficial: Quenda renova (A BOLA)');
  assert.equal(a[0].url, 'https://x/2');
  const recente = [{ chave: 'oficial-zzz', tipo: 'OFICIAL', enviado_em: '2026-10-21T19:00:00Z' }];
  assert.deepEqual(decidir({ agora, noticias, enviados: recente }), []);                 // a última foi há 1 h
  const antiga = [{ chave: `oficial-${resumoTexto('https://x/2')}`, tipo: 'OFICIAL', enviado_em: '2026-10-21T17:00:00Z' }];
  assert.equal(decidir({ agora, noticias, enviados: antiga })[0].url, 'https://x/1');    // a seguinte por enviar
});

test('a regra de "Oficial" é a mesma do site (js/historias.js)', async () => {
  const { eOficial } = await carregar();
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'historias.js'), 'utf8'), sb);
  for(const titulo of ['Oficial! Varandas renova', 'Sporting oficializa lateral', 'Comunicado oficial do clube',
                       'Ainda não é oficial', 'Proposta oficiosa', 'Onze oficial do Sporting', 'Treino aberto', 'oficialmente apresentado'])
    assert.equal(eOficial(titulo), sb.window.Historias.eOficial({ titulo }), titulo);
});
