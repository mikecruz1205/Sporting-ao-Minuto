/* =========================================================================
   Que avisos enviar agora? — a parte pura da Edge Function "notificar"
   (sem rede nem base de dados; testada em tests/notificar.test.js).

   Só se avisa do que os dados confirmam:
     INICIO    — à hora marcada de um jogo (desporto_jogos.data)
     RESULTADO — quando o resultado fica escrito em desporto_jogos
     OFICIAL   — notícia cujo título diz que é oficial (mesma regra de
                 js/historias.js), no máximo uma a cada 2 horas
     JORNADA   — 2 horas antes do fecho de uma jornada da Fantasy
   Cada aviso tem uma chave (inicio-17, resultado-17…) e não se repete:
   as chaves já enviadas vêm da tabela push_enviados.
   ========================================================================= */

export const TIPOS = ['INICIO', 'RESULTADO', 'OFICIAL', 'JORNADA'];

const MIN = 60e3, HORA = 3600e3;
export const JANELA_INICIO = 20 * MIN;       // o agendamento corre a cada 5 min; folga para falhas
export const JANELA_RESULTADO = 36 * HORA;   // resultados escritos até um dia e meio depois
export const ANTES_DO_FECHO = 2 * HORA;
export const IDADE_OFICIAL = 3 * HORA;
export const INTERVALO_OFICIAL = 2 * HORA;

/* a mesma regra de js/historias.js (o teste confirma que dizem o mesmo) */
const RX_OFICIAL = /\boficial(iza|izou|izado|izada|izam|mente)?\b|comunicado (oficial|do clube|do sporting)/i;
const RX_NAO_OFICIAL = /n[ãa]o (é |e |foi |ainda )?oficial|oficios|ainda sem confirma/i;
export const eOficial = titulo => RX_OFICIAL.test(titulo || '') && !RX_NAO_OFICIAL.test(titulo || '');

const ms = d => new Date(d).getTime();
const horaLisboa = d => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
const prova = j => [j.competicao, j.fase].filter(Boolean).join(' · ');

/* resumo curto e estável de um endereço, para a chave do aviso */
export function resumoTexto(s){
  let h = 2166136261;
  for(const c of String(s)){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

export function decidir({ agora, jogos = [], jornadas = [], noticias = [], enviados = [] }){
  const ja = new Set(enviados.map(e => e.chave));
  const avisos = [];
  const juntar = a => { if(!ja.has(a.chave)){ ja.add(a.chave); avisos.push(a); } };

  for(const j of jogos){
    const inicio = ms(j.data);
    if(agora >= inicio && agora - inicio < JANELA_INICIO && j.golos_casa == null)
      juntar({ chave: `inicio-${j.id}`, tipo: 'INICIO', titulo: `Está a começar: ${j.casa} – ${j.fora}`,
               corpo: prova(j) || 'Jogo do Sporting', url: '/ao-vivo', tag: `jogo-${j.id}`, ttl: 30 * 60 });
    if(j.golos_casa != null && j.golos_fora != null && agora >= inicio && agora - inicio < JANELA_RESULTADO){
      const sportingCasa = /sporting/i.test(j.casa);
      const nosso = sportingCasa ? j.golos_casa : j.golos_fora, deles = sportingCasa ? j.golos_fora : j.golos_casa;
      const como = nosso > deles ? 'Vitória do Sporting' : nosso < deles ? 'Derrota do Sporting' : 'Empate';
      juntar({ chave: `resultado-${j.id}`, tipo: 'RESULTADO', titulo: `${j.casa} ${j.golos_casa}–${j.golos_fora} ${j.fora}`,
               corpo: [como, prova(j)].filter(Boolean).join(' · '), url: '/jogos', tag: `jogo-${j.id}`, ttl: 12 * 3600 });
    }
  }

  for(const jr of jornadas){
    const falta = ms(jr.fecho) - agora;
    if(!jr.finalizada_em && falta > 0 && falta <= ANTES_DO_FECHO)
      juntar({ chave: `jornada-${jr.id}`, tipo: 'JORNADA', titulo: `Fantasy: a jornada ${jr.numero} fecha às ${horaLisboa(jr.fecho)}`,
               corpo: 'Confirma a tua equipa e o capitão antes do início do jogo.', url: '/fantasy', tag: `jornada-${jr.id}`, ttl: Math.round(falta / 1000) });
  }

  /* notícias oficiais: a mais recente que ainda não foi enviada, se o
     último aviso oficial já foi há mais de 2 horas */
  const ultimoOficial = Math.max(0, ...enviados.filter(e => e.tipo === 'OFICIAL').map(e => ms(e.enviado_em)));
  if(agora - ultimoOficial >= INTERVALO_OFICIAL){
    const n = noticias
      .filter(n => eOficial(n.titulo) && agora - ms(n.data) >= 0 && agora - ms(n.data) <= IDADE_OFICIAL)
      .sort((a, b) => ms(b.data) - ms(a.data))
      .find(n => !ja.has(`oficial-${resumoTexto(n.link)}`));
    if(n) juntar({ chave: `oficial-${resumoTexto(n.link)}`, tipo: 'OFICIAL', titulo: 'Oficial',
                   corpo: `${n.titulo} (${n.fonte})`, url: n.link, tag: 'oficial', ttl: 6 * 3600 });
  }
  return avisos;
}
