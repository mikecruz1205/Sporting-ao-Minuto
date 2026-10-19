/* =========================================================================
   Edge Function "notificar" — envia os avisos push do Sporting ao Minuto.

   POR INSTALAR: precisa das chaves VAPID nos segredos da função e do
   agendamento (pg_cron + pg_net). Passos em docs/NOTIFICACOES.md.

   Segredos (supabase secrets set …):
     VAPID_PUBLICA, VAPID_PRIVADA  — o par de chaves (a pública também vai
                                      para CONFIG.push.chavePublica)
     VAPID_CONTACTO                 — mailto: de quem responde pelo site
     NOTIFICAR_SEGREDO              — palavra longa que o agendamento envia
                                      no cabeçalho x-segredo
   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em todas as funções.

   Cada execução: lê os jogos, as jornadas e as notícias, decide os avisos
   (decidir.mjs), marca cada um em push_enviados ANTES de enviar (duas
   execuções seguidas não repetem) e envia a quem escolheu esse tipo. As
   subscrições que o serviço de push dá como mortas (404/410) apagam-se.
   ========================================================================= */
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.47.10';
import { decidir } from './decidir.mjs';

const SITE = 'https://sporting-fan-ao-minuto.vercel.app';
const DIA = 86400e3;

Deno.serve(async (pedido: Request) => {
  const segredo = Deno.env.get('NOTIFICAR_SEGREDO');
  if (!segredo || pedido.headers.get('x-segredo') !== segredo) return new Response('proibido', { status: 403 });

  const publica = Deno.env.get('VAPID_PUBLICA'), privada = Deno.env.get('VAPID_PRIVADA');
  if (!publica || !privada) return new Response('faltam as chaves VAPID', { status: 503 });
  webpush.setVapidDetails(Deno.env.get('VAPID_CONTACTO') ?? 'mailto:geral@exemplo.invalid', publica, privada);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
                          { auth: { persistSession: false } });
  const agora = Date.now();
  const iso = (t: number) => new Date(t).toISOString();

  const [jogos, jornadas, enviados] = await Promise.all([
    db.from('desporto_jogos').select('id,data,competicao,fase,casa,fora,golos_casa,golos_fora')
      .gte('data', iso(agora - 2 * DIA)).lte('data', iso(agora + DIA)),
    db.from('fantasy_jornadas').select('id,numero,fecho,finalizada_em')
      .gte('fecho', iso(agora)).lte('fecho', iso(agora + DIA)),
    db.from('push_enviados').select('chave,tipo,enviado_em').gte('enviado_em', iso(agora - 3 * DIA)),
  ]);
  const erro = jogos.error || jornadas.error || enviados.error;
  if (erro) return new Response('erro a ler: ' + erro.message, { status: 500 });

  /* as notícias vêm do próprio site (api/noticias.py), já filtradas */
  let noticias: unknown[] = [];
  try {
    const r = await fetch(SITE + '/api/noticias', { signal: AbortSignal.timeout(8000) });
    if (r.ok) noticias = (await r.json()).noticias ?? [];
  } catch { /* sem notícias desta vez */ }

  const avisos = decidir({ agora, jogos: jogos.data ?? [], jornadas: jornadas.data ?? [], noticias, enviados: enviados.data ?? [] });
  const relatorio: Record<string, number> = {};

  for (const a of avisos) {
    /* marcar primeiro: se outra execução já marcou, não se envia de novo */
    const marcado = await db.from('push_enviados').insert({ chave: a.chave, tipo: a.tipo });
    if (marcado.error) continue;

    const { data: subs } = await db.from('subscricoes_push').select('endpoint,p256dh,auth').contains('tipos', [a.tipo]);
    const corpo = JSON.stringify({ tipo: a.tipo, titulo: a.titulo, corpo: a.corpo, url: a.url, tag: a.tag });
    let entregues = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, corpo,
                                       { TTL: a.ttl, urgency: a.tipo === 'OFICIAL' ? 'normal' : 'high' });
        entregues++;
      } catch (e) {
        const codigo = (e as { statusCode?: number }).statusCode;
        if (codigo === 404 || codigo === 410) await db.from('subscricoes_push').delete().eq('endpoint', s.endpoint);
      }
    }
    await db.from('push_enviados').update({ destinatarios: entregues }).eq('chave', a.chave);
    relatorio[a.chave] = entregues;
  }
  return Response.json({ avisos: relatorio });
});
