const GAPT_LOGO_EMAIL = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px"><tr>
  <td style="padding:0;vertical-align:middle;font-size:0;line-height:0">
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;line-height:0;font-size:0">
      <tr>
        <td style="width:15px;height:26px;background:#FF5A1F">&nbsp;</td>
        <td style="width:2px;height:26px;background:#161310">&nbsp;</td>
        <td style="width:9px;height:26px;background:#FF5A1F">&nbsp;</td>
      </tr>
    </table>
  </td>
  <td style="padding:0 0 0 9px;vertical-align:middle">
    <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:20px;font-weight:900;color:#F4EFE4;letter-spacing:-.04em;text-transform:uppercase;line-height:1">GAPT</span><span style="display:inline-block;width:3px;height:3px;background:#FF5A1F;vertical-align:middle;margin-left:2px;margin-bottom:1px">&nbsp;</span>
  </td>
</tr></table>
<p style="margin:0;font-family:monospace;font-size:9px;letter-spacing:.22em;color:#6E665B;text-transform:uppercase">THE GAPT PROJECT · NO TWO ALIKE</p>`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-GAPT-PIN',
};

const FROM_ADDRESSES = {
  gustavo: 'Gustavo Pastrana — THE GAPT PROJECT <gustavo@thegaptproject.com>',
  hello: 'THE GAPT PROJECT <hello@thegaptproject.com>',
  proyectos: 'Proyectos — THE GAPT PROJECT <proyectos@thegaptproject.com>',
};
const REPLY_ADDRESSES = {
  gustavo: 'gustavo@thegaptproject.com',
  hello: 'hello@thegaptproject.com',
  proyectos: 'proyectos@thegaptproject.com',
};

// ─── WEB PUSH (RFC 8291 + 8188) ──────────────────────────────────────────────

function b64urlDec(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b.padEnd(b.length + (4 - b.length % 4) % 4, '=')), c => c.charCodeAt(0));
}

function b64urlEnc(u8) {
  const arr = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8 instanceof ArrayBuffer ? u8 : u8.buffer);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function u8cat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let off = 0; for (const a of arrs) { out.set(a, off); off += a.length; } return out;
}

async function hmac256(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

function rawToPkcs8(rawB64) {
  const raw = b64urlDec(rawB64);
  const pfx = new Uint8Array([
    0x30,0x41,0x02,0x01,0x00,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,
    0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x04,0x27,0x30,0x25,0x02,0x01,0x01,0x04,0x20,
  ]);
  return u8cat(pfx, raw).buffer;
}

async function vapidJwt(endpoint, pubB64, privB64) {
  const enc = new TextEncoder();
  const { origin } = new URL(endpoint);
  const exp = Math.floor(Date.now() / 1000) + 43200;
  const hdr = b64urlEnc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const pld = b64urlEnc(enc.encode(JSON.stringify({ aud: origin, exp, sub: 'mailto:gustavo@thegaptproject.com' })));
  const key = await crypto.subtle.importKey('pkcs8', rawToPkcs8(privB64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${hdr}.${pld}`)));
  return `${hdr}.${pld}.${b64urlEnc(sig)}`;
}

async function encryptForPush(sub, payloadStr) {
  const enc = new TextEncoder();
  const payload = enc.encode(payloadStr);
  const clientPub = b64urlDec(sub.keys.p256dh);
  const auth = b64urlDec(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, eph.privateKey, 256));
  // RFC 8291: combine ECDH secret + auth secret → IKM
  const prkKey = await hmac256(auth, shared);
  const ikm = await hmac256(prkKey, u8cat(enc.encode('WebPush: info\x00'), clientPub, ephPub, new Uint8Array([1])));
  // RFC 8188: derive CEK + NONCE
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac256(salt, ikm);
  const cek = (await hmac256(prk, u8cat(enc.encode('Content-Encoding: aes128gcm\x00'), new Uint8Array([1])))).slice(0, 16);
  const iv  = (await hmac256(prk, u8cat(enc.encode('Content-Encoding: nonce\x00'),    new Uint8Array([1])))).slice(0, 12);
  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cekKey, u8cat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
  return u8cat(salt, rs, new Uint8Array([ephPub.length]), ephPub, ciphertext);
}

async function broadcastPush(env, data) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.KV) return;
  const subsRaw = await env.KV.get('push:subscriptions');
  if (!subsRaw) return;
  let subs; try { subs = JSON.parse(subsRaw); } catch { return; }
  if (!subs.length) return;
  const expired = [];
  for (const sub of subs) {
    try {
      const body = await encryptForPush(sub, JSON.stringify(data));
      const jwt  = await vapidJwt(sub.endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      const res  = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'TTL': '86400',
          'Urgency': data.urgency || 'normal',
        },
        body,
      });
      if (res.status === 410 || res.status === 404) expired.push(sub.endpoint);
      else if (!res.ok) console.error('[PUSH]', res.status, await res.text().catch(() => ''));
    } catch (e) { console.error('[PUSH] error:', e.message); }
  }
  if (expired.length) {
    await env.KV.put('push:subscriptions', JSON.stringify(subs.filter(s => !expired.includes(s.endpoint))));
  }
}

async function handlePushSubscribe(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  let body; try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) return dlJson({ error: 'Suscripción inválida' }, 400);
  if (!env.KV) return dlJson({ error: 'KV no disponible' }, 500);
  const subsRaw = await env.KV.get('push:subscriptions');
  const subs = subsRaw ? JSON.parse(subsRaw) : [];
  const filtered = subs.filter(s => s.endpoint !== body.endpoint);
  filtered.push({ endpoint: body.endpoint, keys: body.keys, ua: (request.headers.get('user-agent') || '').slice(0, 80), createdAt: Date.now() });
  await env.KV.put('push:subscriptions', JSON.stringify(filtered));
  return dlJson({ ok: true, count: filtered.length });
}

async function handlePushUnsubscribe(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  let body; try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }
  if (!env.KV) return dlJson({ ok: true });
  const subsRaw = await env.KV.get('push:subscriptions');
  if (!subsRaw) return dlJson({ ok: true });
  await env.KV.put('push:subscriptions', JSON.stringify(JSON.parse(subsRaw).filter(s => s.endpoint !== body.endpoint)));
  return dlJson({ ok: true });
}

async function handlePushStatus(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const subsRaw = env.KV ? await env.KV.get('push:subscriptions') : null;
  const subs = subsRaw ? JSON.parse(subsRaw) : [];
  return dlJson({
    count: subs.length,
    vapidConfigured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    subs: subs.map(s => ({ endpoint: s.endpoint.slice(0, 60) + '…', ua: s.ua, createdAt: s.createdAt })),
  });
}

async function handlePushTest(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return dlJson({ error: 'VAPID no configurado' }, 500);
  const subsRaw = env.KV ? await env.KV.get('push:subscriptions') : null;
  const subs = subsRaw ? JSON.parse(subsRaw) : [];
  if (!subs.length) return dlJson({ error: 'Sin suscriptores. Activa las notificaciones en GAPT One primero.' }, 400);
  try {
    await broadcastPush(env, { title: '🔔 GAPT One', body: 'Prueba de notificación exitosa.', url: '/one/', tag: 'test-' + Date.now(), urgency: 'high' });
    return dlJson({ ok: true, sent: subs.length });
  } catch (e) {
    return dlJson({ error: e.message }, 500);
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([processPendingDeliveries(env), processReminders(env), processRecurring(env)]));
  },
  async email(message, env, ctx) {
    ctx.waitUntil(handleInboundEmail(message, env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }
    if (url.pathname === '/paid-manual' && request.method === 'POST') {
      return handleManualPaid(request, env);
    }
    if (url.pathname === '/docs') {
      return handleDocs(request, env);
    }
    if (url.pathname === '/cfdi-request' && request.method === 'POST') {
      return handleCfdiRequest(request, env);
    }
    if (url.pathname === '/cfdi/requests' && request.method === 'GET') return handleCfdiRequests(request, env);
    if (url.pathname.startsWith('/cfdi/status/') && request.method === 'POST') return handleCfdiStatus(request, env, url);
    if (url.pathname.startsWith('/cfdi/reply/') && request.method === 'POST') return handleCfdiReply(request, env, url);
    if (url.pathname.startsWith('/cfdi/send-cfdi/') && request.method === 'POST') return handleCfdiSendCfdi(request, env, url);
    if (url.pathname.startsWith('/cfdi/archive/') && request.method === 'GET') return handleCfdiArchive(request, env, url);
    if (url.pathname.startsWith('/cfdi/delete/') && request.method === 'DELETE') return handleCfdiDelete(request, env, url);

    // entregas (internal file delivery)
    if (url.pathname === '/entregas/upload' && request.method === 'POST') return handleEntregasUpload(request, env);
    if (url.pathname === '/entregas/link' && request.method === 'POST') return handleEntregasLink(request, env);
    if (url.pathname === '/entregas/upload-start' && request.method === 'POST') return handleUploadStart(request, env);
    if (url.pathname.startsWith('/entregas/upload-part/') && request.method === 'POST') return handleUploadPart(request, env, url);
    if (url.pathname.startsWith('/entregas/upload-finish/') && request.method === 'POST') return handleUploadFinish(request, env, url);
    if (url.pathname === '/entregas/list' && request.method === 'GET') return handleEntregasList(request, env);
    if (url.pathname.startsWith('/entregas/info/') && request.method === 'GET') return handleEntregasInfo(request, env, url);
    if (url.pathname.startsWith('/entregas/file/') && request.method === 'POST') return handleEntregasFile(request, env, url);
    if (url.pathname.startsWith('/entregas/delete/') && request.method === 'DELETE') return handleEntregasDelete(request, env, url);
    if (url.pathname === '/groups') return handleGroups(request, env);
    if (url.pathname.startsWith('/entregas/share/') && request.method === 'POST') return handleEntregasShare(request, env, url);
    if (url.pathname.startsWith('/entregas/detail/') && request.method === 'GET') return handleEntregasDetail(request, env, url);
    if (url.pathname.startsWith('/entregas/resend/') && request.method === 'POST') return handleEntregasResend(request, env, url);
    if (url.pathname.startsWith('/entregas/track/') && request.method === 'POST') return handleEntregasTrack(request, env, url);
    if (url.pathname === '/push/subscribe' && request.method === 'POST') return handlePushSubscribe(request, env);
    if (url.pathname === '/push/unsubscribe' && request.method === 'POST') return handlePushUnsubscribe(request, env);
    if (url.pathname === '/push/test' && request.method === 'POST') return handlePushTest(request, env);
    if (url.pathname === '/push/status' && request.method === 'GET') return handlePushStatus(request, env);
    if (url.pathname === '/stripe-session' && request.method === 'POST') return handleStripeSession(request, env);
    // Reminders
    if (url.pathname === '/reminders' && request.method === 'GET') return handleReminders(request, env);
    if (url.pathname === '/reminders' && request.method === 'POST') return handleCreateReminder(request, env);
    if (url.pathname.startsWith('/reminders/') && url.pathname.endsWith('/send') && request.method === 'POST') return handleSendReminderNow(request, env, url);
    if (url.pathname.startsWith('/reminders/') && url.pathname.endsWith('/status') && request.method === 'PATCH') return handleUpdateReminderStatus(request, env, url);
    if (url.pathname.startsWith('/reminders/') && request.method === 'DELETE') return handleStopReminder(request, env, url);
    // Invoices
    if (url.pathname === '/invoices' && request.method === 'GET') return handleListInvoices(request, env);
    if (url.pathname.startsWith('/invoices/') && url.pathname.endsWith('/status') && request.method === 'PATCH') return handleUpdateInvoiceStatus(request, env, url);
    if (url.pathname.startsWith('/invoices/') && url.pathname.endsWith('/pay') && request.method === 'POST') return handleRecordPayment(request, env, url);
    // Expenses
    if (url.pathname === '/expenses' && request.method === 'GET') return handleListExpenses(request, env);
    if (url.pathname === '/expenses' && request.method === 'POST') return handleCreateExpense(request, env);
    if (url.pathname.startsWith('/expenses/') && request.method === 'DELETE') return handleDeleteExpense(request, env, url);
    // Reports
    if (url.pathname === '/reports/summary' && request.method === 'GET') return handleReportSummary(request, env);
    if (url.pathname === '/reports/aging' && request.method === 'GET') return handleReportAging(request, env);
    // Client statement
    if (url.pathname === '/clients/statement' && request.method === 'POST') return handleClientStatement(request, env);
    // Resend inbound webhook (no requiere PIN — validado por shared secret)
    if (url.pathname === '/email-inbound' && request.method === 'POST') return handleResendInbound(request, env);
    // SPEIs
    if (url.pathname === '/speis' && request.method === 'GET') return handleListSpeis(request, env);
    if (url.pathname.startsWith('/speis/') && url.pathname.endsWith('/confirm') && request.method === 'POST') return handleConfirmSpei(request, env, url);
    if (url.pathname.startsWith('/speis/') && url.pathname.endsWith('/reject') && request.method === 'POST') return handleRejectSpei(request, env, url);
    if (url.pathname.startsWith('/speis/') && url.pathname.endsWith('/match') && request.method === 'POST') return handleMatchSpei(request, env, url);
    // Recurring
    if (url.pathname === '/recurring' && request.method === 'GET') return handleListRecurring(request, env);
    if (url.pathname === '/recurring' && request.method === 'POST') return handleCreateRecurring(request, env);
    if (url.pathname.startsWith('/recurring/') && request.method === 'DELETE') return handleDeleteRecurring(request, env, url);

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }
    if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);

    let data;
    try { data = await request.json(); }
    catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

    const { to, docType, docNumber, clientName, clientRfc, emisor, fecha, items, subtotal, iva, total, validez, notas, pdfBase64, pdfPagadoBase64 } = data;

    if (!to || !docType || !docNumber) {
      return new Response(JSON.stringify({ error: 'Faltan campos requeridos' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    const tipoLabel = {
      cotizacion:  'Cotización',
      factura:     'Nota de cobro',
      ordenCambio: 'Orden de cambio',
      ordenCompra: 'Orden de compra',
      ordenPago:   'Orden de pago',
      recibo:      'Recibo',
      notaVenta:   'Nota de venta',
    }[docType] || docType;

    // Use pre-created Stripe session from frontend (avoids duplicate sessions),
    // or create one now if the frontend didn't pre-create it.
    let paymentUrl = data.paymentUrl || null;
    let stripeSessionId = data.stripeSessionId || null;
    if (!paymentUrl && env.STRIPE_SECRET_KEY && Number(total) > 0) {
      try {
        const amountCents = Math.round(Number(total) * 100);
        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'mode': 'payment',
            'currency': 'mxn',
            'line_items[0][price_data][currency]': 'mxn',
            'line_items[0][price_data][product_data][name]': `${tipoLabel} ${docNumber} — THE GAPT PROJECT`,
            'line_items[0][price_data][unit_amount]': String(amountCents),
            'line_items[0][quantity]': '1',
            'customer_email': to,
            'success_url': 'https://thegaptproject.com/?pago=ok',
            'cancel_url': 'https://thegaptproject.com/',
            'expires_at': String(Math.floor(Date.now() / 1000) + (2 * 60 * 60)),
            'metadata[to]': to,
            'metadata[docType]': docType,
            'metadata[docNumber]': docNumber,
            'metadata[clientName]': clientName || '',
            'metadata[clientRfc]': clientRfc || '',
            'metadata[emisor]': emisor || '',
            'metadata[fecha]': fecha || '',
            'metadata[total]': String(total),
            'metadata[subtotal]': String(subtotal || ''),
            'metadata[iva]': String(iva || ''),
            'metadata[tipoLabel]': tipoLabel,
          }),
        });
        const stripeData = await stripeRes.json();
        paymentUrl = stripeData.url || null;
        stripeSessionId = stripeData.id || null;
      } catch(err) { console.log('STRIPE_ERROR', err.message); }
    }
    // Store stamped PDF in KV keyed by Stripe session for payment confirmation email
    if (stripeSessionId && env.KV) {
      const pdfToStore = pdfPagadoBase64 || pdfBase64;
      if (pdfToStore) await env.KV.put(stripeSessionId, pdfToStore, { expirationTtl: 86400 });
    }

    const subject = `${tipoLabel} ${docNumber} — THE GAPT PROJECT`;
    const html = buildEmail({ tipoLabel, docType, docNumber, clientName, emisor, fecha, items, subtotal, iva, total, validez, notas, paymentUrl });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `THE GAPT PROJECT <finance@thegaptproject.com>`,
        to: [to],
        bcc: ['billing@thegaptproject.com'],
        reply_to: 'finance@thegaptproject.com',
        subject,
        html,
        ...(pdfBase64 ? {
          attachments: [{
            filename: `${docNumber}.pdf`,
            content: pdfBase64,
          }]
        } : {}),
      }),
    });

    const result = await res.json();

    if (res.ok && env.KV && docNumber) {
      const clientPhone = data.clientPhone || '';
      const now = Date.now();
      // Permanent invoice record
      await env.KV.put(`invoice:${docNumber}`, JSON.stringify({
        docNumber, docType, tipoLabel, clientName, clientEmail: to, clientPhone,
        emisor, fecha, items: items || [], subtotal, iva, total,
        notas: data.notas || '', paymentUrl: paymentUrl || '',
        stripeSessionId: stripeSessionId || '',
        status: 'pendiente', paidAt: null, paidAmount: null, paidMethod: null,
        sentAt: now,
      }));
      // Reminder entry for follow-ups (only when there's a payment link)
      if (paymentUrl) {
        await env.KV.put(`reminder:${docNumber}`, JSON.stringify({
          docNumber, tipoLabel, clientName, clientEmail: to, clientPhone,
          total, subtotal, iva, paymentUrl, stripeSessionId,
          fecha, emisor, sentAt: now, lastReminderAt: now, reminderCount: 0,
        }));
      }
    }

    return new Response(JSON.stringify(result), {
      status: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};

async function handleStripeSession(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.STRIPE_SECRET_KEY) return dlJson({ error: 'Stripe no configurado' }, 400);
  const { total, docNumber, docType, clientName, clientEmail, clientRfc, tipoLabel } = await request.json();
  if (!total || Number(total) <= 0) return dlJson({ error: 'Total inválido' }, 400);
  try {
    const label = tipoLabel || ({ cotizacion:'Cotización', factura:'Nota de cobro' }[docType] || docType || 'Documento');
    const amountCents = Math.round(Number(total) * 100);
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        'mode': 'payment', 'currency': 'mxn',
        'line_items[0][price_data][currency]': 'mxn',
        'line_items[0][price_data][product_data][name]': `${label} ${docNumber || ''} — THE GAPT PROJECT`,
        'line_items[0][price_data][unit_amount]': String(amountCents),
        'line_items[0][quantity]': '1',
        'customer_email': clientEmail || '',
        'success_url': 'https://thegaptproject.com/?pago=ok',
        'cancel_url': 'https://thegaptproject.com/',
        'expires_at': String(Math.floor(Date.now() / 1000) + 7200),
        'metadata[to]': clientEmail || '',
        'metadata[docNumber]': docNumber || '', 'metadata[clientName]': clientName || '',
        'metadata[clientRfc]': clientRfc || '',
        'metadata[total]': String(total), 'metadata[docType]': docType || '', 'metadata[tipoLabel]': label,
      }),
    });
    const data = await stripeRes.json();
    if (!data.url) return dlJson({ error: 'Error de Stripe: ' + (data.error?.message || 'sin URL') }, 502);
    return dlJson({ paymentUrl: data.url, sessionId: data.id });
  } catch (err) {
    return dlJson({ error: err.message }, 502);
  }
}

/* ─── RESEND INBOUND WEBHOOK ─────────────────────────────────────────────────── */

async function handleResendInbound(request, env) {
  // Optional: validate shared secret
  const secret = request.headers.get('svix-signature') || request.headers.get('x-resend-signature') || '';
  if (env.RESEND_INBOUND_SECRET && !secret.includes(env.RESEND_INBOUND_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try { payload = await request.json(); } catch { return new Response('Bad Request', { status: 400 }); }

  // Resend inbound payload shape: { from, to, subject, text, html, ... }
  const from    = payload.from || '';
  const subject = payload.subject || '';
  const text    = (payload.text || '') + ' ' + (payload.html || '').replace(/<[^>]+>/g, ' ');

  await processSpeiEmail({ from, subject, text }, env);
  return new Response('ok', { status: 200 });
}

/* ─── INBOUND EMAIL / SPEI DETECTION ────────────────────────────────────────── */

async function handleInboundEmail(message, env) {
  if (!env.KV) return;
  const reader = message.raw.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(total);
  let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }
  let raw = new TextDecoder().decode(buf);
  raw = raw.replace(/Content-Transfer-Encoding:\s*base64[\r\n]+([A-Za-z0-9+/=\r\n]+)/gi, (_, b64) => {
    try { return atob(b64.replace(/\s/g, '')); } catch { return _; }
  });
  await processSpeiEmail({
    from: message.from || '',
    subject: message.headers.get('subject') || '',
    text: raw,
  }, env);
}

async function processSpeiEmail({ from, subject, text }, env) {
  if (!env.KV) return;

  const isPaymentEmail = /spei|transferencia|depósito|deposito|revolut|pago recibido/i.test(text + subject);
  if (!isPaymentEmail) return;

  const invList = await env.KV.list({ prefix: 'invoice:' });
  let matched = null;

  for (const key of invList.keys) {
    const docNumber = key.name.replace('invoice:', '');
    if (text.includes(docNumber)) {
      const inv = await env.KV.get(key.name, 'json');
      if (inv && ['pendiente', 'parcial'].includes(inv.status)) {
        matched = inv;
        break;
      }
    }
  }

  const now = Date.now();
  const preview = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);

  if (matched) {
    const fmt = n => Number(n||0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    await env.KV.put(`spei:${matched.docNumber}`, JSON.stringify({
      docNumber: matched.docNumber, clientName: matched.clientName,
      total: matched.total, status: 'pending-confirm',
      from, subject, preview, receivedAt: now,
    }), { expirationTtl: 86400 * 14 });
    await broadcastPush(env, {
      title: '💸 Posible pago — confirmar',
      body: `${matched.docNumber} · $${fmt(matched.total)} de ${matched.clientName}`,
      url: '/one/', tag: `spei-${matched.docNumber}`, urgency: 'high',
    });
  } else {
    const uid = `spei-unmatched:${now}`;
    await env.KV.put(uid, JSON.stringify({
      id: uid, status: 'unmatched', from, subject, preview, receivedAt: now,
    }), { expirationTtl: 86400 * 30 });
    await broadcastPush(env, {
      title: '📩 Pago sin folio identificado',
      body: `De: ${from.slice(0, 50)} — revisa en Cobros`,
      url: '/one/', tag: 'spei-unmatched', urgency: 'normal',
    });
  }
}

async function handleListSpeis(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson({ pending: [], unmatched: [] });
  const [p, u] = await Promise.all([
    env.KV.list({ prefix: 'spei:' }),
    env.KV.list({ prefix: 'spei-unmatched:' }),
  ]);
  const [pending, unmatched] = await Promise.all([
    Promise.all(p.keys.map(k => env.KV.get(k.name, 'json'))),
    Promise.all(u.keys.map(k => env.KV.get(k.name, 'json'))),
  ]);
  return dlJson({
    pending:   pending.filter(Boolean).sort((a, b) => b.receivedAt - a.receivedAt),
    unmatched: unmatched.filter(Boolean).sort((a, b) => b.receivedAt - a.receivedAt),
  });
}

async function handleConfirmSpei(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const docNumber = decodeURIComponent(url.pathname.split('/speis/')[1]?.replace('/confirm','') || '');
  if (!docNumber || !env.KV) return dlJson({ error: 'Folio requerido' }, 400);
  const [speiRaw, invRaw] = await Promise.all([
    env.KV.get(`spei:${docNumber}`),
    env.KV.get(`invoice:${docNumber}`),
  ]);
  if (!invRaw) return dlJson({ error: 'Factura no encontrada' }, 404);
  const inv = JSON.parse(invRaw);
  await env.KV.put(`invoice:${docNumber}`, JSON.stringify({
    ...inv, status: 'pagado', paidAt: Date.now(),
    paidAmount: Number(inv.total), paidMethod: 'spei',
  }));
  await Promise.all([
    env.KV.delete(`spei:${docNumber}`),
    env.KV.delete(`reminder:${docNumber}`),
  ]);
  return dlJson({ ok: true });
}

async function handleRejectSpei(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const docNumber = decodeURIComponent(url.pathname.split('/speis/')[1]?.replace('/reject','') || '');
  if (!docNumber || !env.KV) return dlJson({ error: 'Requerido' }, 400);
  await env.KV.delete(`spei:${docNumber}`);
  return dlJson({ ok: true });
}

async function handleMatchSpei(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const speiId = decodeURIComponent(url.pathname.split('/speis/')[1]?.replace('/match','') || '');
  if (!speiId || !env.KV) return dlJson({ error: 'Requerido' }, 400);
  const { docNumber } = await request.json();
  if (!docNumber) return dlJson({ error: 'Folio requerido' }, 400);
  const invRaw = await env.KV.get(`invoice:${docNumber}`);
  if (!invRaw) return dlJson({ error: 'Factura no encontrada' }, 404);
  const inv = JSON.parse(invRaw);
  await env.KV.put(`invoice:${docNumber}`, JSON.stringify({
    ...inv, status: 'pagado', paidAt: Date.now(),
    paidAmount: Number(inv.total), paidMethod: 'spei',
  }));
  await Promise.all([
    env.KV.delete(`spei-unmatched:${speiId}`),
    env.KV.delete(`reminder:${docNumber}`),
  ]);
  return dlJson({ ok: true });
}

/* ─── PAYMENT REMINDERS ────────────────────────────────────────────────────── */

async function processReminders(env) {
  if (!env.KV) return;
  const list = await env.KV.list({ prefix: 'reminder:' });
  if (!list?.keys?.length) return;
  const now = Date.now();
  const FOUR_DAYS = 4 * 24 * 60 * 60 * 1000;
  for (const key of list.keys) {
    try {
      const r = await env.KV.get(key.name, 'json');
      if (!r || now - r.lastReminderAt < FOUR_DAYS) continue;
      await sendReminderEmail(r, env);
      await env.KV.put(key.name, JSON.stringify({
        ...r, lastReminderAt: now, reminderCount: (r.reminderCount || 0) + 1,
      }));
    } catch (e) { console.error('[REMINDER]', key.name, e.message); }
  }
}

async function sendReminderEmail(r, env) {
  if (!r.clientEmail || !env.RESEND_API_KEY) return;
  const count = (r.reminderCount || 0) + 1;
  const html = buildReminderEmail({ ...r, count });
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'THE GAPT PROJECT <finance@thegaptproject.com>',
      to: [r.clientEmail],
      bcc: ['billing@thegaptproject.com'],
      reply_to: 'finance@thegaptproject.com',
      subject: `Recordatorio #${count} — ${r.tipoLabel} ${r.docNumber} pendiente de pago`,
      html,
    }),
  });
}

async function sendWhatsAppReminder(r, env) {
  if (!r.clientPhone || !env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return;
  const digits = String(r.clientPhone).replace(/\D/g, '');
  if (digits.length < 10) return;
  const e164 = digits.length === 10 ? '52' + digits : digits;
  const totalFmt = Number(r.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: e164,
      type: 'template',
      template: {
        name: env.WHATSAPP_TEMPLATE || 'recordatorio_pago_gapt',
        language: { code: 'es_MX' },
        components: [{ type: 'body', parameters: [
          { type: 'text', text: r.clientName || 'Cliente' },
          { type: 'text', text: r.tipoLabel || 'Documento' },
          { type: 'text', text: r.docNumber || '' },
          { type: 'text', text: totalFmt },
          { type: 'text', text: r.paymentUrl || '' },
        ]}],
      },
    }),
  });
}

async function handleCreateReminder(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson({ error: 'KV no disponible' }, 500);
  const data = await request.json();
  const { docNumber, total, clientName, tipoLabel, clientEmail, paymentUrl } = data;
  if (!docNumber || !clientEmail) return dlJson({ error: 'Folio y email requeridos' }, 400);
  const now = Date.now();
  await env.KV.put(`reminder:${docNumber}`, JSON.stringify({
    docNumber, tipoLabel: tipoLabel || 'Documento', clientName, clientEmail,
    clientPhone: '', total: Number(total) || 0, paymentUrl: paymentUrl || '',
    sentAt: now, lastReminderAt: now, reminderCount: 0,
  }));
  return dlJson({ ok: true });
}

async function handleReminders(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson([]);
  const list = await env.KV.list({ prefix: 'reminder:' });
  const items = await Promise.all((list.keys || []).map(k => env.KV.get(k.name, 'json')));
  return dlJson(items.filter(Boolean).sort((a, b) => b.sentAt - a.sentAt));
}

async function handleSendReminderNow(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const seg = url.pathname.split('/');
  const docNumber = decodeURIComponent(seg[seg.length - 2] || '');
  if (!docNumber || !env.KV) return dlJson({ error: 'Folio requerido' }, 400);
  const raw = await env.KV.get(`reminder:${docNumber}`);
  if (!raw) return dlJson({ error: 'No encontrado' }, 404);
  const r = JSON.parse(raw);
  await sendReminderEmail(r, env);
  r.lastReminderAt = Date.now();
  r.reminderCount = (r.reminderCount || 0) + 1;
  await env.KV.put(`reminder:${docNumber}`, JSON.stringify(r));
  return dlJson({ ok: true });
}

async function handleUpdateReminderStatus(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const seg = url.pathname.split('/');
  const docNumber = decodeURIComponent(seg[seg.length - 2] || '');
  if (!docNumber || !env.KV) return dlJson({ error: 'Folio requerido' }, 400);
  const raw = await env.KV.get(`reminder:${docNumber}`);
  if (!raw) return dlJson({ error: 'No encontrado' }, 404);
  const { status } = await request.json();
  const r = { ...JSON.parse(raw), status: status || 'Pendiente' };
  await env.KV.put(`reminder:${docNumber}`, JSON.stringify(r));
  return dlJson({ ok: true });
}

async function handleStopReminder(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const docNumber = decodeURIComponent(url.pathname.split('/reminders/')[1] || '');
  if (!docNumber || !env.KV) return dlJson({ error: 'Folio requerido' }, 400);
  await env.KV.delete(`reminder:${docNumber}`);
  return dlJson({ ok: true });
}

/* ─── INVOICES ──────────────────────────────────────────────────────────────── */

async function handleListInvoices(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson([]);
  const list = await env.KV.list({ prefix: 'invoice:' });
  const items = await Promise.all(list.keys.map(k => env.KV.get(k.name, 'json')));
  return dlJson(items.filter(Boolean).sort((a, b) => b.sentAt - a.sentAt));
}

async function handleUpdateInvoiceStatus(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const seg = url.pathname.split('/');
  const docNumber = decodeURIComponent(seg[seg.length - 2] || '');
  if (!docNumber || !env.KV) return dlJson({ error: 'Folio requerido' }, 400);
  const raw = await env.KV.get(`invoice:${docNumber}`);
  if (!raw) return dlJson({ error: 'No encontrado' }, 404);
  const { status } = await request.json();
  await env.KV.put(`invoice:${docNumber}`, JSON.stringify({ ...JSON.parse(raw), status }));
  return dlJson({ ok: true });
}

async function handleRecordPayment(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const seg = url.pathname.split('/');
  const docNumber = decodeURIComponent(seg[seg.length - 2] || '');
  if (!docNumber || !env.KV) return dlJson({ error: 'Folio requerido' }, 400);
  const raw = await env.KV.get(`invoice:${docNumber}`);
  if (!raw) return dlJson({ error: 'No encontrado' }, 404);
  const { paidAmount, paidMethod, notes } = await request.json();
  const inv = JSON.parse(raw);
  const isFullyPaid = Number(paidAmount) >= Number(inv.total);
  await env.KV.put(`invoice:${docNumber}`, JSON.stringify({
    ...inv, paidAt: Date.now(),
    paidAmount: Number(paidAmount), paidMethod: paidMethod || 'transferencia',
    status: isFullyPaid ? 'pagado' : 'parcial',
    paymentNotes: notes || '',
  }));
  if (isFullyPaid) await env.KV.delete(`reminder:${docNumber}`);
  return dlJson({ ok: true });
}

/* ─── EXPENSES ───────────────────────────────────────────────────────────────── */

async function handleListExpenses(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson([]);
  const list = await env.KV.list({ prefix: 'expense:' });
  const items = await Promise.all(list.keys.map(k => env.KV.get(k.name, 'json')));
  return dlJson(items.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt));
}

async function handleCreateExpense(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson({ error: 'KV no disponible' }, 500);
  const data = await request.json();
  const id = `expense:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await env.KV.put(id, JSON.stringify({ ...data, id, createdAt: Date.now() }));
  return dlJson({ ok: true, id });
}

async function handleDeleteExpense(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = decodeURIComponent(url.pathname.split('/expenses/')[1] || '');
  if (!id || !env.KV) return dlJson({ error: 'ID requerido' }, 400);
  await env.KV.delete(`expense:${id}`);
  return dlJson({ ok: true });
}

/* ─── REPORTS ────────────────────────────────────────────────────────────────── */

async function handleReportSummary(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson({});
  const [invList, expList] = await Promise.all([
    env.KV.list({ prefix: 'invoice:' }),
    env.KV.list({ prefix: 'expense:' }),
  ]);
  const [invoices, expenses] = await Promise.all([
    Promise.all(invList.keys.map(k => env.KV.get(k.name, 'json'))),
    Promise.all(expList.keys.map(k => env.KV.get(k.name, 'json'))),
  ]);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart  = new Date(now.getFullYear(), 0, 1).getTime();
  const inv = invoices.filter(Boolean);
  const exp = expenses.filter(Boolean);
  const sum = (arr, key) => arr.reduce((s, x) => s + (Number(x[key]) || 0), 0);
  const paid    = inv.filter(i => i.status === 'pagado');
  const pending = inv.filter(i => ['pendiente','parcial'].includes(i.status));
  return dlJson({
    facturadasMes:  inv.filter(i => i.sentAt >= monthStart).length,
    facturadasAnio: inv.filter(i => i.sentAt >= yearStart).length,
    cobradoMes:     sum(paid.filter(i => i.paidAt >= monthStart), 'paidAmount'),
    cobradoAnio:    sum(paid.filter(i => i.paidAt >= yearStart), 'paidAmount'),
    porCobrar:      sum(pending, 'total'),
    gastosMes:      sum(exp.filter(e => new Date(e.fecha).getTime() >= monthStart), 'monto'),
    gastosAnio:     sum(exp.filter(e => new Date(e.fecha).getTime() >= yearStart), 'monto'),
    totalFacturas:  inv.length,
    totalPagadas:   paid.length,
    totalPendientes: pending.length,
  });
}

async function handleReportAging(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson({});
  const list = await env.KV.list({ prefix: 'invoice:' });
  const invoices = (await Promise.all(list.keys.map(k => env.KV.get(k.name, 'json')))).filter(Boolean);
  const pending = invoices.filter(i => ['pendiente','parcial'].includes(i.status));
  const now = Date.now();
  const days = i => Math.floor((now - i.sentAt) / 86400000);
  const bucket = (min, max) => pending.filter(i => days(i) >= min && (max === null || days(i) < max));
  const bucketSum = arr => arr.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const b0  = bucket(0, 30);
  const b30 = bucket(30, 60);
  const b60 = bucket(60, 90);
  const b90 = bucket(90, null);
  return dlJson({
    current:  { invoices: b0,  total: bucketSum(b0) },
    days30:   { invoices: b30, total: bucketSum(b30) },
    days60:   { invoices: b60, total: bucketSum(b60) },
    days90:   { invoices: b90, total: bucketSum(b90) },
  });
}

/* ─── CLIENT STATEMENT ────────────────────────────────────────────────────────── */

async function handleClientStatement(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV || !env.RESEND_API_KEY) return dlJson({ error: 'Configuración incompleta' }, 500);
  const { clientEmail, clientName, pdfBase64 } = await request.json();
  if (!clientEmail) return dlJson({ error: 'Email requerido' }, 400);
  const list = await env.KV.list({ prefix: 'invoice:' });
  const all = (await Promise.all(list.keys.map(k => env.KV.get(k.name, 'json')))).filter(Boolean);
  const pending = all.filter(i => i.clientEmail === clientEmail && ['pendiente','parcial'].includes(i.status))
                     .sort((a, b) => a.sentAt - b.sentAt);
  if (!pending.length) return dlJson({ error: 'Sin documentos pendientes para este cliente' }, 400);
  const total = pending.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const fmt = n => Number(n||0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  const rows = pending.map(i => `
    <tr>
      <td style="padding:8px 12px;font-family:monospace;font-size:12px;border-bottom:1px solid #2A2520">${i.docNumber}</td>
      <td style="padding:8px 12px;font-size:12px;border-bottom:1px solid #2A2520">${i.tipoLabel}</td>
      <td style="padding:8px 12px;font-size:12px;border-bottom:1px solid #2A2520">${i.fecha}</td>
      <td style="padding:8px 12px;font-family:monospace;font-size:12px;text-align:right;border-bottom:1px solid #2A2520;color:${i.status==='parcial'?'#F59E0B':'#F4EFE4'}">$${fmt(i.total)}</td>
      <td style="padding:8px 12px;font-size:11px;border-bottom:1px solid #2A2520;color:#6E665B">${i.status==='parcial'?'Pago parcial':'Pendiente'}</td>
      ${i.paymentUrl ? `<td style="padding:8px 12px;border-bottom:1px solid #2A2520"><a href="${i.paymentUrl}" style="color:#FF5A1F;font-size:11px;text-decoration:none">Pagar →</a></td>` : '<td style="border-bottom:1px solid #2A2520"></td>'}
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><body style="background:#161310;margin:0;padding:24px;font-family:'Helvetica Neue',Arial,sans-serif">
    ${GAPT_LOGO_EMAIL}
    <h2 style="color:#F4EFE4;font-size:16px;font-weight:700;margin:24px 0 4px">Estado de cuenta</h2>
    <p style="color:#6E665B;font-size:12px;margin:0 0 24px">${clientName || clientEmail}</p>
    <table style="width:100%;border-collapse:collapse;background:#1E1A16">
      <thead><tr>
        <th style="padding:8px 12px;font-family:monospace;font-size:10px;letter-spacing:.1em;text-align:left;color:#6E665B;border-bottom:1px solid #FF5A1F">FOLIO</th>
        <th style="padding:8px 12px;font-family:monospace;font-size:10px;letter-spacing:.1em;text-align:left;color:#6E665B;border-bottom:1px solid #FF5A1F">TIPO</th>
        <th style="padding:8px 12px;font-family:monospace;font-size:10px;letter-spacing:.1em;text-align:left;color:#6E665B;border-bottom:1px solid #FF5A1F">FECHA</th>
        <th style="padding:8px 12px;font-family:monospace;font-size:10px;letter-spacing:.1em;text-align:right;color:#6E665B;border-bottom:1px solid #FF5A1F">TOTAL</th>
        <th style="padding:8px 12px;font-family:monospace;font-size:10px;letter-spacing:.1em;text-align:left;color:#6E665B;border-bottom:1px solid #FF5A1F">ESTADO</th>
        <th style="border-bottom:1px solid #FF5A1F"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="padding:12px;font-family:monospace;font-size:11px;color:#6E665B">TOTAL PENDIENTE</td>
        <td style="padding:12px;font-family:monospace;font-size:14px;font-weight:700;color:#FF5A1F;text-align:right">$${fmt(total)}</td>
        <td colspan="2"></td>
      </tr></tfoot>
    </table>
    <p style="color:#6E665B;font-size:11px;margin-top:20px">Si pagas por <strong style="color:#F4EFE4">transferencia SPEI</strong>, incluye el folio correspondiente en el campo <em>Concepto</em> y envíanos tu comprobante respondiendo a este correo.</p>
    <p style="color:#6E665B;font-size:10px;margin-top:24px">THE GAPT PROJECT · thegaptproject.com</p>
  </body></html>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'THE GAPT PROJECT <finance@thegaptproject.com>',
      to: [clientEmail],
      bcc: ['billing@thegaptproject.com'],
      reply_to: 'finance@thegaptproject.com',
      subject: `Estado de cuenta — THE GAPT PROJECT`,
      html,
      ...(pdfBase64 ? { attachments: [{ filename: `estado-cuenta-${(clientName||clientEmail).replace(/\s+/g,'-')}.pdf`, content: pdfBase64 }] } : {}),
    }),
  });
  return dlJson({ ok: true, count: pending.length, total });
}

/* ─── RECURRING INVOICES ─────────────────────────────────────────────────────── */

async function handleListRecurring(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson([]);
  const list = await env.KV.list({ prefix: 'recurring:' });
  const items = await Promise.all(list.keys.map(k => env.KV.get(k.name, 'json')));
  return dlJson(items.filter(Boolean));
}

async function handleCreateRecurring(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.KV) return dlJson({ error: 'KV no disponible' }, 500);
  const data = await request.json();
  const id = `recurring:${Date.now()}`;
  await env.KV.put(id, JSON.stringify({ ...data, id, createdAt: Date.now(), lastGeneratedAt: null }));
  return dlJson({ ok: true, id });
}

async function handleDeleteRecurring(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = decodeURIComponent(url.pathname.split('/recurring/')[1] || '');
  if (!id || !env.KV) return dlJson({ error: 'ID requerido' }, 400);
  await env.KV.delete(`recurring:${id}`);
  return dlJson({ ok: true });
}

async function processRecurring(env) {
  if (!env.KV) return;
  const list = await env.KV.list({ prefix: 'recurring:' });
  if (!list?.keys?.length) return;
  const now = Date.now();
  for (const key of list.keys) {
    try {
      const r = await env.KV.get(key.name, 'json');
      if (!r) continue;
      const freqMs = { mensual: 30, bimestral: 60, trimestral: 90, semestral: 180, anual: 365 }[r.frecuencia] * 86400000;
      const lastGen = r.lastGeneratedAt || r.createdAt;
      if (now - lastGen < freqMs) continue;
      await broadcastPush(env, {
        title: '📋 Factura recurrente lista',
        body: `${r.tipoLabel || 'Documento'} para ${r.clientName} — $${Number(r.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`,
        url: '/one/',
        tag: `recurring-${key.name}`,
        urgency: 'normal',
      });
      await env.KV.put(key.name, JSON.stringify({ ...r, lastGeneratedAt: now, pendingGeneration: true }));
    } catch(e) { console.error('[RECURRING]', key.name, e.message); }
  }
}

function buildReminderEmail({ clientName, tipoLabel, docNumber, total, paymentUrl, fecha, count }) {
  const totalFmt = Number(total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Recordatorio de pago — ${docNumber}</title></head>
<body style="margin:0;padding:0;background:#F4EFE4;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #DCD2BF">
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF,#6234E6,#FF3D8B,#FF5A1F,#FFB300)"></td></tr>
  <tr><td style="padding:28px 32px 20px">
    <div style="font-family:Arial,sans-serif;font-weight:900;font-size:20px;letter-spacing:-.03em;color:#161310">GAPT<span style="display:inline-block;width:3px;height:3px;background:#FF5A1F;margin:0 1px 1px 2px;vertical-align:bottom"></span></div>
    <div style="font-family:monospace;font-size:8px;letter-spacing:.22em;color:#6E665B;text-transform:uppercase;margin-top:3px">THE PROJECT · NO TWO ALIKE</div>
  </td></tr>
  <tr><td style="padding:0 32px 24px">
    <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C9A227;margin-bottom:10px">⏰ Recordatorio de pago #${count}</div>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#161310">Hola <strong>${esc(clientName)}</strong>,</p>
    <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#3A352E">
      Te recordamos que tienes un pago pendiente correspondiente a la <strong>${esc(tipoLabel)}</strong> <strong>${esc(docNumber)}</strong>${fecha ? ` del ${esc(fecha)}` : ''}.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EAE2D2;margin-bottom:24px">
      <tr style="background:#F4EFE4"><td style="padding:10px 16px;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B">${esc(tipoLabel)}</td>
      <td style="padding:10px 16px;text-align:right;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B">${esc(docNumber)}</td></tr>
      <tr><td style="padding:14px 16px;font-size:13px;color:#6E665B">Total pendiente</td>
      <td style="padding:14px 16px;text-align:right;font-weight:700;font-size:16px;color:#FF5A1F;font-family:monospace">$${totalFmt} MXN</td></tr>
    </table>
    ${paymentUrl ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px"><tr><td align="center" style="background:#FF5A1F">
      <a href="${paymentUrl}" style="display:inline-block;padding:14px 28px;font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#fff;text-decoration:none">Pagar en línea →</a>
    </td></tr></table>` : ''}
    <p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#6E665B">Si pagas por <strong style="color:#F4EFE4">transferencia SPEI</strong>, incluye el folio <strong style="color:#FF5A1F;font-family:monospace">${docNumber}</strong> en el campo <em>Concepto</em> para que registremos tu pago automáticamente, y envíanos tu comprobante respondiendo a este correo.</p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#6E665B">Si ya realizaste tu pago, ignora este mensaje — lo registraremos automáticamente. Si tienes alguna duda escríbenos a <a href="mailto:hello@thegaptproject.com" style="color:#FF5A1F">hello@thegaptproject.com</a></p>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #EAE2D2">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:monospace;font-size:8px;letter-spacing:.8px;color:#6E665B;text-transform:uppercase">THEGAPTPROJECT.COM</td>
      <td style="font-family:monospace;font-size:8px;letter-spacing:.8px;color:#6E665B;text-transform:uppercase;text-align:right">EST. 2026 · MX</td>
    </tr></table>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

async function handleWebhook(request, env) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  // Verify webhook signature — fail closed: no secret configured means no event is trusted.
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Webhook not configured', { status: 500 });
  try {
    const parts = sig.split(',').reduce((acc, p) => {
      const [k, v] = p.split('=');
      acc[k] = v;
      return acc;
    }, {});
    const timestamp = parts.t;
    const signed = parts.v1;
    const payload = `${timestamp}.${body}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (expected !== signed) return new Response('Invalid signature', { status: 400 });
  } catch(_) {
    return new Response('Signature error', { status: 400 });
  }

  let event;
  try { event = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};
    const { to, tipoLabel, docNumber, clientName, clientRfc, emisor, fecha, total, subtotal, iva } = meta;

    if (to && docNumber && env.RESEND_API_KEY) {
      const paidAt = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

      // Fetch PaymentIntent to get card details
      let cardBrand = '', cardLast4 = '', paidAtFull = paidAt;
      if (session.payment_intent && env.STRIPE_SECRET_KEY) {
        try {
          const piRes = await fetch(
            `https://api.stripe.com/v1/payment_intents/${session.payment_intent}?expand[]=payment_method`,
            { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } }
          );
          const pi = await piRes.json();
          if (pi.payment_method && pi.payment_method.card) {
            const card = pi.payment_method.card;
            cardBrand = card.wallet ? card.wallet.type : card.brand;
            cardLast4 = card.last4;
          }
          if (pi.created) {
            paidAtFull = new Date(pi.created * 1000).toLocaleString('es-MX', {
              year: 'numeric', month: 'long', day: 'numeric',
              hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City'
            });
          }
        } catch(_) {}
      }

      const html = buildPaidEmail({ tipoLabel, docNumber, clientName, clientEmail: to, clientRfc, emisor, fecha, total, subtotal, iva, paidAt: paidAtFull, stripeId: session.id, cardBrand, cardLast4 });

      // Retrieve stored PDF (if any) to attach to confirmation email
      const pdfBase64 = env.KV ? await env.KV.get(session.id) : null;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'THE GAPT PROJECT <finance@thegaptproject.com>',
          to: [to],
          bcc: ['billing@thegaptproject.com'],
          reply_to: 'finance@thegaptproject.com',
          subject: `✓ Pago recibido — ${tipoLabel} ${docNumber}`,
          html,
          ...(pdfBase64 ? {
            attachments: [{
              filename: `${docNumber}-PAGADO.pdf`,
              content: pdfBase64,
            }]
          } : {}),
        }),
      });

      // Update records after payment
      if (env.KV) {
        if (pdfBase64) await env.KV.delete(session.id);
        if (meta.docNumber) {
          await env.KV.delete(`reminder:${meta.docNumber}`);
          const invRaw = await env.KV.get(`invoice:${meta.docNumber}`);
          if (invRaw) {
            const inv = JSON.parse(invRaw);
            await env.KV.put(`invoice:${meta.docNumber}`, JSON.stringify({
              ...inv, status: 'pagado', paidAt: Date.now(),
              paidAmount: Number(meta.total) || inv.total,
              paidMethod: 'stripe',
            }));
          }
        }
      }
      try { await broadcastPush(env, { title: '✓ Pago recibido', body: `${tipoLabel || ''} ${docNumber} · $${Number(total||0).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`, url: '/one/', tag: `pay-${session.id}`, urgency: 'high' }); } catch(e) { console.error('[PUSH-STRIPE]', e.message); }
    }
  }

  return new Response('ok', { status: 200 });
}

async function handleManualPaid(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  let data;
  try { data = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

  const { to, docType, docNumber, clientName, clientRfc, emisor, fecha, total, subtotal, iva,
          referencia, banco, fechaPago, montoSpei, ordenante, clabe, concepto, pdfPagadoBase64 } = data;
  if (!to || !docNumber || !env.RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'Faltan campos' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const tipoLabel = {
    cotizacion: 'Cotización', factura: 'Nota de cobro', ordenCambio: 'Orden de cambio', ordenCompra: 'Orden de compra',
    ordenPago: 'Orden de pago', recibo: 'Recibo', notaVenta: 'Nota de venta',
  }[docType] || docType;

  const paidAt = fechaPago
    ? new Date(fechaPago + 'T12:00:00').toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

  const speiRows = `
    ${referencia ? `<tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Clave de rastreo</td><td style="padding:10px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${esc(referencia)}</td></tr>` : ''}
    ${banco ? `<tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Banco origen</td><td style="padding:10px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${esc(banco)}</td></tr>` : ''}
    ${ordenante ? `<tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Ordenante</td><td style="padding:10px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${esc(ordenante)}</td></tr>` : ''}
    ${clabe ? `<tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">CLABE origen</td><td style="padding:10px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${esc(clabe)}</td></tr>` : ''}
    ${concepto ? `<tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Concepto</td><td style="padding:10px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${esc(concepto)}</td></tr>` : ''}
    ${montoSpei ? `<tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Monto recibido</td><td style="padding:10px 0;font-size:13px;font-weight:700;color:#006847;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">$${Number(montoSpei).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN</td></tr>` : ''}
  `;

  const html = buildPaidEmail({
    tipoLabel, docNumber, clientName, clientEmail: to, clientRfc, emisor, fecha,
    total: montoSpei || total, subtotal, iva,
    paidAt, stripeId: null, cardBrand: 'spei', cardLast4: '',
    extraRows: speiRows,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'THE GAPT PROJECT <finance@thegaptproject.com>',
      to: [to],
      bcc: ['billing@thegaptproject.com'],
      reply_to: 'finance@thegaptproject.com',
      subject: `✓ Pago recibido — ${tipoLabel} ${docNumber}`,
      html,
      ...(pdfPagadoBase64 ? { attachments: [{ filename: `${docNumber}-PAGADO.pdf`, content: pdfPagadoBase64 }] } : {}),
    }),
  });

  const result = await res.json();
  try { await broadcastPush(env, { title: '✓ Pago SPEI registrado', body: `${tipoLabel} ${docNumber} · $${Number(montoSpei||total||0).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`, url: '/one/', tag: `pay-spei-${docNumber}`, urgency: 'high' }); } catch(e) { console.error('[PUSH-SPEI]', e.message); }
  return new Response(JSON.stringify(result), { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function handleCfdiRequest(request, env) {
  let data;
  try { data = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

  const { rfc, razon, cp, correo, regimen, uso, folio, monto, notas } = data;
  if (!rfc || !razon || !correo || !env.RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'Faltan campos' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Solicitud CFDI</title></head>
<body style="margin:0;padding:0;background:#EAE2D2;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EAE2D2;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#161310;padding:24px 32px">
    <div style="font-size:18px;font-weight:900;color:#F4EFE4;text-transform:uppercase">THE GAPT PROJECT</div>
    <div style="font-family:monospace;font-size:8px;letter-spacing:.22em;color:#3A352E;margin-top:4px;text-transform:uppercase">Solicitud de CFDI</div>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:32px">
    <h2 style="margin:0 0 20px;font-size:20px;font-weight:900;color:#161310">Nueva solicitud de CFDI</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
      <tr style="background:#161310"><td colspan="2" style="padding:10px 14px;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B">Datos fiscales del receptor</td></tr>
      <tr><td style="padding:10px 14px;color:#6E665B;border-bottom:1px solid #EAE2D2;width:40%">RFC</td><td style="padding:10px 14px;font-family:monospace;font-weight:700;color:#161310;border-bottom:1px solid #EAE2D2">${esc(rfc)}</td></tr>
      <tr><td style="padding:10px 14px;color:#6E665B;border-bottom:1px solid #EAE2D2">Razón social</td><td style="padding:10px 14px;font-weight:700;color:#161310;border-bottom:1px solid #EAE2D2">${esc(razon)}</td></tr>
      <tr><td style="padding:10px 14px;color:#6E665B;border-bottom:1px solid #EAE2D2">Código postal</td><td style="padding:10px 14px;font-family:monospace;color:#161310;border-bottom:1px solid #EAE2D2">${esc(cp)}</td></tr>
      <tr><td style="padding:10px 14px;color:#6E665B;border-bottom:1px solid #EAE2D2">Régimen fiscal</td><td style="padding:10px 14px;color:#161310;border-bottom:1px solid #EAE2D2">${esc(regimen)}</td></tr>
      <tr><td style="padding:10px 14px;color:#6E665B;border-bottom:1px solid #EAE2D2">Uso del CFDI</td><td style="padding:10px 14px;color:#161310;border-bottom:1px solid #EAE2D2">${esc(uso)}</td></tr>
      <tr><td style="padding:10px 14px;color:#6E665B;border-bottom:1px solid #EAE2D2">Correo receptor</td><td style="padding:10px 14px;color:#FF5A1F;border-bottom:1px solid #EAE2D2">${esc(correo)}</td></tr>
      ${folio ? `<tr style="background:#161310"><td colspan="2" style="padding:10px 14px;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B">Referencia de pago</td></tr>
      <tr><td style="padding:10px 14px;color:#6E665B;border-bottom:1px solid #EAE2D2">Folio</td><td style="padding:10px 14px;font-family:monospace;font-weight:700;color:#161310;border-bottom:1px solid #EAE2D2">${esc(folio)}</td></tr>
      ${monto ? `<tr><td style="padding:10px 14px;color:#6E665B;border-bottom:1px solid #EAE2D2">Monto</td><td style="padding:10px 14px;font-family:monospace;font-weight:700;color:#19A85B;border-bottom:1px solid #EAE2D2">$${Number(monto).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN</td></tr>` : ''}` : ''}
      ${notas ? `<tr><td style="padding:10px 14px;color:#6E665B" colspan="2">Notas: ${esc(notas)}</td></tr>` : ''}
    </table>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#0F0D0A;padding:18px 32px">
    <div style="font-family:monospace;font-size:9px;color:#6E665B">Solicitud recibida desde thegaptproject.com/cfdi</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'THE GAPT PROJECT <finance@thegaptproject.com>',
      to: ['gustavo@thegaptproject.com'],
      reply_to: correo,
      subject: `📄 Solicitud CFDI — ${rfc} · ${folio || 'sin folio'}`,
      html,
    }),
  });

  let solFolio = '';
  if (env.KV) {
    const id = generateId(8);
    solFolio = await nextSolFolio(env);
    const entry = { id, rfc, razon, cp, correo, regimen, uso, folio: folio || '', monto: monto || '', notas: notas || '', solFolio, status: 'pending', createdAt: Date.now() };
    await env.KV.put(`cfdi:${id}`, JSON.stringify(entry), { expirationTtl: 90 * 24 * 60 * 60 });
    const listRaw = await env.KV.get('cfdi:list');
    const list = listRaw ? JSON.parse(listRaw) : [];
    list.unshift({ id, rfc, razon, correo, folio: folio || '', monto: monto || '', solFolio, status: 'pending', createdAt: Date.now() });
    await env.KV.put('cfdi:list', JSON.stringify(list.slice(0, 200)));
  }

  // Auto-acknowledgment to the client — immediate, no manual step
  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'THE GAPT PROJECT <finance@thegaptproject.com>',
          to: [correo],
          bcc: ['billing@thegaptproject.com'],
          reply_to: 'finance@thegaptproject.com',
          subject: `Solicitud recibida${solFolio ? ' · ' + solFolio : ''} — THE GAPT PROJECT`,
          html: buildCfdiAckEmail({ razon, solFolio, correo }),
        }),
      });
    } catch(e) { console.error('[CFDI-ACK]', e.message); }
  }

  try { await broadcastPush(env, { title: '📄 Nueva solicitud CFDI', body: `${rfc} · ${razon}${folio ? ' · ' + folio : ''}`, url: '/one/', tag: `cfdi-${Date.now()}`, urgency: 'high' }); } catch(e) { console.error('[PUSH-CFDI]', e.message); }

  return new Response(JSON.stringify({ ok: true, solFolio }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function nextSolFolio(env) {
  const year = new Date().getFullYear();
  const key = `cfdi:sol-counter:${year}`;
  const cur = parseInt((await env.KV.get(key)) || '0', 10);
  const next = cur + 1;
  await env.KV.put(key, String(next));
  return `SOL-${year}-${String(next).padStart(3, '0')}`;
}

function buildCfdiAckEmail({ razon, solFolio, correo }) {
  razon = esc(razon); solFolio = esc(solFolio); correo = esc(correo);
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Solicitud recibida — THE GAPT PROJECT</title></head>
<body style="margin:0;padding:0;background:#EAE2D2;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EAE2D2;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#161310;padding:32px 36px 24px">${GAPT_LOGO_EMAIL}</td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:36px 36px 28px">
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3A352E">Hola${razon ? ' ' + razon : ''}, hemos recibido tu solicitud de factura y la hemos procesado. Recibirás en un plazo máximo de 24 horas tu factura al correo <strong>${correo}</strong>.</p>
    ${solFolio ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#161310;margin-bottom:20px">
      <tr><td style="padding:16px 20px">
        <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6E665B;margin-bottom:6px">_ Folio de tu solicitud</div>
        <div style="font-family:monospace;font-size:15px;color:#FF5A1F;font-weight:700">${solFolio}</div>
      </td></tr>
    </table>` : ''}
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6E665B">¿Tienes alguna duda? Responde a este correo o escríbenos a <a href="mailto:finance@thegaptproject.com" style="color:#FF5A1F">finance@thegaptproject.com</a></p>
  </td></tr>
  <tr><td style="background:#0F0D0A;padding:20px 36px">
    <p style="margin:0;font-family:monospace;font-size:9px;letter-spacing:.14em;color:#3A352E;text-transform:uppercase">THE GAPT PROJECT · Finance Team · thegaptproject.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function handleCfdiRequests(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const listRaw = env.KV ? await env.KV.get('cfdi:list') : null;
  return new Response(listRaw || '[]', { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function handleCfdiStatus(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = url.pathname.split('/').pop();
  let body; try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }
  const { status } = body;
  if (env.KV) {
    const metaRaw = await env.KV.get(`cfdi:${id}`);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      meta.status = status;
      await env.KV.put(`cfdi:${id}`, JSON.stringify(meta), { expirationTtl: 90 * 24 * 60 * 60 });
    }
    const listRaw = await env.KV.get('cfdi:list');
    if (listRaw) {
      const list = JSON.parse(listRaw);
      const idx = list.findIndex(e => e.id === id);
      if (idx >= 0) { list[idx].status = status; await env.KV.put('cfdi:list', JSON.stringify(list)); }
    }
  }
  return dlJson({ ok: true });
}

async function handleCfdiReply(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = url.pathname.split('/').pop();
  let body; try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }
  const { message } = body;
  const metaRaw = env.KV ? await env.KV.get(`cfdi:${id}`) : null;
  if (!metaRaw) return dlJson({ error: 'No encontrado' }, 404);
  const meta = JSON.parse(metaRaw);
  if (env.RESEND_API_KEY) {
    const html = buildCfdiReplyEmail({ razon: meta.razon, rfc: meta.rfc, folio: meta.folio, message });
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'THE GAPT PROJECT <finance@thegaptproject.com>',
        to: [meta.correo],
        bcc: ['billing@thegaptproject.com'],
        reply_to: 'finance@thegaptproject.com',
        subject: `Tu CFDI — THE GAPT PROJECT${meta.folio ? ' · ' + meta.folio : ''}`,
        html,
      }),
    });
  }
  meta.status = 'done';
  if (env.KV) {
    await env.KV.put(`cfdi:${id}`, JSON.stringify(meta), { expirationTtl: 90 * 24 * 60 * 60 });
    const listRaw = await env.KV.get('cfdi:list');
    if (listRaw) {
      const list = JSON.parse(listRaw);
      const idx = list.findIndex(e => e.id === id);
      if (idx >= 0) { list[idx].status = 'done'; await env.KV.put('cfdi:list', JSON.stringify(list)); }
    }
  }
  return dlJson({ ok: true });
}

async function handleCfdiSendCfdi(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = url.pathname.split('/').pop();
  let body; try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }
  const { pdfBase64, uuid, xmlText, summary } = body;
  if (!pdfBase64) return dlJson({ error: 'Falta el PDF del CFDI' }, 400);
  const metaRaw = env.KV ? await env.KV.get(`cfdi:${id}`) : null;
  if (!metaRaw) return dlJson({ error: 'No encontrado' }, 404);
  const meta = JSON.parse(metaRaw);
  if (!env.RESEND_API_KEY) return dlJson({ error: 'Falta RESEND_API_KEY' }, 500);

  // Archive the XML (legal source of truth) and PDF in R2 so they don't need to be re-uploaded later
  let xmlR2Key = null, pdfR2Key = null;
  if (env.FILES) {
    try {
      if (xmlText) {
        xmlR2Key = `cfdi-xml/${id}-${uuid || Date.now()}.xml`;
        await env.FILES.put(xmlR2Key, xmlText, { httpMetadata: { contentType: 'application/xml' } });
      }
      pdfR2Key = `cfdi-pdf/${id}-${uuid || Date.now()}.pdf`;
      const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
      await env.FILES.put(pdfR2Key, pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });
    } catch(e) { console.error('[CFDI-ARCHIVE]', e.message); }
  }

  const html = buildCfdiSendEmail({ razon: meta.razon, rfc: meta.rfc, folio: meta.folio, solFolio: meta.solFolio, regimen: meta.regimen, uso: meta.uso, uuid, summary });
  const baseFilename = `CFDI-${uuid || meta.folio || id}`;
  const attachments = [{ filename: `${baseFilename}.pdf`, content: pdfBase64 }];
  if (xmlText) attachments.push({ filename: `${baseFilename}.xml`, content: utf8ToBase64(xmlText) });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'THE GAPT PROJECT <finance@thegaptproject.com>',
      to: [meta.correo],
      bcc: ['billing@thegaptproject.com'],
      reply_to: 'finance@thegaptproject.com',
      subject: `Tu CFDI — THE GAPT PROJECT${meta.folio ? ' · ' + meta.folio : ''}`,
      html,
      attachments,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[CFDI-SEND] Resend error ${res.status} — ${errBody}`);
    return dlJson({ error: 'No se pudo enviar el correo' }, 502);
  }

  meta.status = 'done';
  meta.cfdiUuid = uuid || meta.cfdiUuid || null;
  if (xmlR2Key) meta.xmlR2Key = xmlR2Key;
  if (pdfR2Key) meta.pdfR2Key = pdfR2Key;
  if (summary) meta.cfdiSummary = summary;
  if (env.KV) {
    await env.KV.put(`cfdi:${id}`, JSON.stringify(meta), { expirationTtl: 90 * 24 * 60 * 60 });
    const listRaw = await env.KV.get('cfdi:list');
    if (listRaw) {
      const list = JSON.parse(listRaw);
      const idx = list.findIndex(e => e.id === id);
      if (idx >= 0) {
        list[idx].status = 'done'; list[idx].cfdiUuid = meta.cfdiUuid;
        if (summary) list[idx].cfdiSummary = summary;
        await env.KV.put('cfdi:list', JSON.stringify(list));
      }
    }
  }
  try { await broadcastPush(env, { title: '✓ CFDI enviado', body: `${meta.razon} · ${meta.rfc}`, url: '/one/', tag: `cfdi-sent-${id}`, urgency: 'normal' }); } catch(e) { console.error('[PUSH-CFDI-SEND]', e.message); }
  return dlJson({ ok: true });
}

async function handleCfdiArchive(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = url.pathname.split('/').pop();
  const metaRaw = env.KV ? await env.KV.get(`cfdi:${id}`) : null;
  if (!metaRaw) return dlJson({ error: 'No encontrado' }, 404);
  const meta = JSON.parse(metaRaw);
  if (!meta.xmlR2Key || !env.FILES) return dlJson({ error: 'Sin XML archivado para esta solicitud' }, 404);
  const obj = await env.FILES.get(meta.xmlR2Key);
  if (!obj) return dlJson({ error: 'Archivo no encontrado en R2' }, 404);
  const xmlText = await obj.text();
  return dlJson({ xmlText, uuid: meta.cfdiUuid || null });
}

async function handleCfdiDelete(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = url.pathname.split('/').pop();
  if (env.KV) {
    const metaRaw = await env.KV.get(`cfdi:${id}`);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      if (env.FILES) {
        if (meta.xmlR2Key) await env.FILES.delete(meta.xmlR2Key).catch(() => {});
        if (meta.pdfR2Key) await env.FILES.delete(meta.pdfR2Key).catch(() => {});
      }
      await env.KV.delete(`cfdi:${id}`);
    }
    const listRaw = await env.KV.get('cfdi:list');
    if (listRaw) {
      const list = JSON.parse(listRaw).filter(c => c.id !== id);
      await env.KV.put('cfdi:list', JSON.stringify(list));
    }
  }
  return dlJson({ ok: true });
}

const CFDI_CAT_REGIMEN = { '601':'General de Ley Personas Morales','603':'Personas Morales con Fines no Lucrativos','605':'Sueldos y Salarios','606':'Arrendamiento','612':'Actividades Empresariales y Profesionales','614':'Ingresos por Intereses','616':'Sin obligaciones fiscales','620':'Sociedades Cooperativas de Producción','621':'Incorporación Fiscal','625':'Plataformas Tecnológicas','626':'Régimen Simplificado de Confianza' };
const CFDI_CAT_USO = { G01:'Adquisición de bienes', G02:'Devoluciones, descuentos o bonificaciones', G03:'Gastos en general', I01:'Construcciones', I04:'Equipo de cómputo y accesorios', D01:'Honorarios médicos, dentales y hospitalarios', D10:'Servicios educativos (colegiaturas)', S01:'Sin efectos fiscales', CP01:'Pagos' };
const cfdiCodeLabel = (code, cat) => code ? (cat[code] ? `${code} — ${cat[code]}` : code) : '';

function buildCfdiSendEmail({ razon, rfc, folio, solFolio, regimen, uso, uuid, summary }) {
  const money = n => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const fecha = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const regimenLabel = esc(cfdiCodeLabel(regimen, CFDI_CAT_REGIMEN));
  const usoLabel = esc(cfdiCodeLabel(uso, CFDI_CAT_USO));
  const fiscalRows = summary ? `
      ${summary.emisorNombre ? `<tr><td style="padding:8px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Emisor</td><td style="padding:8px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${esc(summary.emisorNombre)}${summary.emisorRfc ? ' · ' + esc(summary.emisorRfc) : ''}</td></tr>` : ''}
      ${summary.fechaTimbrado ? `<tr><td style="padding:8px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Fecha de timbrado</td><td style="padding:8px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${esc(fecha(summary.fechaTimbrado))}</td></tr>` : ''}
      ${summary.subtotal ? `<tr><td style="padding:8px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Subtotal</td><td style="padding:8px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${money(summary.subtotal)}</td></tr>` : ''}
      ${summary.ivaTraslado ? `<tr><td style="padding:8px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">IVA trasladado</td><td style="padding:8px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">${money(summary.ivaTraslado)}</td></tr>` : ''}
      ${summary.ivaRetenido ? `<tr><td style="padding:8px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">IVA retenido</td><td style="padding:8px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">−${money(summary.ivaRetenido)}</td></tr>` : ''}
      ${summary.isrRetenido ? `<tr><td style="padding:8px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">ISR retenido</td><td style="padding:8px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2">−${money(summary.isrRetenido)}</td></tr>` : ''}
      ${summary.total ? `<tr style="background:#161310"><td style="padding:14px 16px;font-size:12px;color:#F4EFE4;font-family:monospace;letter-spacing:.08em;text-transform:uppercase">Total</td><td style="padding:14px 16px;font-size:16px;font-weight:700;color:#FF5A1F;text-align:right;font-family:monospace">${money(summary.total)}</td></tr>` : ''}
  ` : '';
  razon = esc(razon); rfc = esc(rfc); folio = esc(folio); solFolio = esc(solFolio); uuid = esc(uuid);
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>CFDI — THE GAPT PROJECT</title></head>
<body style="margin:0;padding:0;background:#EAE2D2;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EAE2D2;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#161310;padding:32px 36px 24px">
    ${GAPT_LOGO_EMAIL}
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:36px 36px 28px">
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3A352E">Hola${razon ? ' ' + razon : ''}, hemos terminado de procesar tu CFDI. Adjunto encontrarás el PDF (representación impresa) y el XML timbrado.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#161310;margin-bottom:20px">
      <tr><td style="padding:16px 20px">
        <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6E665B;margin-bottom:6px">_ Referencia</div>
        <div style="font-size:13px;color:#F4EFE4;font-weight:600">${razon}</div>
        <div style="font-family:monospace;font-size:11px;color:#6E665B;margin-top:2px">${rfc}${folio ? ' · ' + folio : ''}${solFolio ? ' · ' + solFolio : ''}</div>
        ${regimenLabel || usoLabel ? `<div style="font-family:monospace;font-size:9px;color:#6E665B;margin-top:8px">${regimenLabel ? 'Régimen: ' + regimenLabel : ''}${regimenLabel && usoLabel ? ' · ' : ''}${usoLabel ? 'Uso CFDI: ' + usoLabel : ''}</div>` : ''}
        ${uuid ? `<div style="font-family:monospace;font-size:9px;color:#3A352E;margin-top:8px;word-break:break-all">UUID: ${uuid}</div>` : ''}
      </td></tr>
    </table>
    ${fiscalRows ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${fiscalRows}</table>` : ''}
    <p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#6E665B">Si tu pago fue por <strong>transferencia SPEI</strong>, envíanos tu comprobante respondiendo a este mismo correo.</p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6E665B">Si tienes alguna duda, comunícate con nosotros respondiendo a este correo o escribiendo a <a href="mailto:finance@thegaptproject.com" style="color:#FF5A1F">finance@thegaptproject.com</a></p>
  </td></tr>
  <tr><td style="background:#0F0D0A;padding:20px 36px">
    <p style="margin:0;font-family:monospace;font-size:9px;letter-spacing:.14em;color:#3A352E;text-transform:uppercase">THE GAPT PROJECT · thegaptproject.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildCfdiReplyEmail({ razon, rfc, folio, message }) {
  razon = esc(razon); rfc = esc(rfc); folio = esc(folio); message = esc(message);
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>CFDI — THE GAPT PROJECT</title></head>
<body style="margin:0;padding:0;background:#EAE2D2;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EAE2D2;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#161310;padding:32px 36px 24px">
    ${GAPT_LOGO_EMAIL}
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:36px 36px 28px">
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3A352E">${message.replace(/\n/g, '<br>')}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#161310;margin-bottom:20px">
      <tr><td style="padding:16px 20px">
        <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6E665B;margin-bottom:6px">_ Referencia</div>
        <div style="font-size:13px;color:#F4EFE4;font-weight:600">${razon}</div>
        <div style="font-family:monospace;font-size:11px;color:#6E665B;margin-top:2px">${rfc}${folio ? ' · ' + folio : ''}</div>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6E665B">¿Tienes alguna duda? Responde a este correo o escríbenos a <a href="mailto:finance@thegaptproject.com" style="color:#FF5A1F">finance@thegaptproject.com</a></p>
  </td></tr>
  <tr><td style="background:#0F0D0A;padding:20px 36px">
    <p style="margin:0;font-family:monospace;font-size:9px;letter-spacing:.14em;color:#3A352E;text-transform:uppercase">THE GAPT PROJECT · thegaptproject.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// v2 — cloud sync
function checkPin(request, env) {
  // Fail closed: if the secret isn't configured, deny everyone rather than letting everyone in.
  if (!env.GAPT_PIN) return false;
  return request.headers.get('X-GAPT-PIN') === env.GAPT_PIN;
}

async function handleDocs(request, env) {
  if (!checkPin(request, env)) {
    return new Response(JSON.stringify({ error: 'PIN incorrecto' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (request.method === 'GET') {
    const docs = env.KV ? await env.KV.get('gapt-docs-all', 'json') : null;
    return new Response(JSON.stringify(docs || []), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (request.method === 'POST') {
    let docs;
    try { docs = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }
    if (!Array.isArray(docs)) {
      return new Response(JSON.stringify({ error: 'Array esperado' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (env.KV) await env.KV.put('gapt-docs-all', JSON.stringify(docs));
    return new Response(JSON.stringify({ ok: true, count: docs.length }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  return new Response('Method Not Allowed', { status: 405, headers: CORS });
}

function cardBadge(brand, last4) {
  const brands = {
    visa:         { bg: '#1A1F71', color: '#fff', label: 'VISA' },
    mastercard:   { bg: '#EB001B', color: '#fff', label: 'MC' },
    amex:         { bg: '#016FD0', color: '#fff', label: 'AMEX' },
    discover:     { bg: '#FF6600', color: '#fff', label: 'DISC' },
    diners:       { bg: '#004A97', color: '#fff', label: 'DINERS' },
    jcb:          { bg: '#003087', color: '#fff', label: 'JCB' },
    unionpay:     { bg: '#C0392B', color: '#fff', label: 'UP' },
    spei:         { bg: '#006847', color: '#fff', label: 'SPEI' },
    apple_pay:    { bg: '#000000', color: '#fff', label: '🍎 Apple Pay' },
    google_pay:   { bg: '#4285F4', color: '#fff', label: 'G Pay' },
    samsung_pay:  { bg: '#1428A0', color: '#fff', label: 'Samsung Pay' },
  };
  const b = brands[brand] || { bg: '#6E665B', color: '#fff', label: (brand || 'tarjeta').toUpperCase() };
  const suffix = last4 && !['apple_pay','google_pay','samsung_pay'].includes(brand) ? ` •••• ${last4}` : '';
  return `<span style="display:inline-block;background:${b.bg};color:${b.color};font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.06em;padding:4px 10px;border-radius:3px">${b.label}</span><span style="font-family:monospace;font-size:12px;color:#161310;margin-left:6px">${suffix}</span>`;
}

function buildPaidEmail({ tipoLabel, docNumber, clientName, clientEmail, clientRfc, emisor, fecha, total, subtotal, iva, paidAt, stripeId, cardBrand, cardLast4, extraRows = '' }) {
  const cfdiLinkParams = new URLSearchParams({ ref: docNumber || '', monto: total || '' });
  if (clientRfc) cfdiLinkParams.set('rfc', clientRfc);
  if (clientName) cfdiLinkParams.set('razon', clientName);
  if (clientEmail) cfdiLinkParams.set('correo', clientEmail);
  const cfdiLink = `https://thegaptproject.com/cfdi/?${cfdiLinkParams.toString()}`;
  tipoLabel = esc(tipoLabel); docNumber = esc(docNumber); clientName = esc(clientName); emisor = esc(emisor); fecha = esc(fecha);
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Pago recibido — ${docNumber}</title></head>
<body style="margin:0;padding:0;background:#EAE2D2;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EAE2D2;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#161310;padding:32px 36px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>${GAPT_LOGO_EMAIL}</td>
      <td align="right">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#19A85B">✓ PAGO RECIBIDO</div>
        <div style="font-family:monospace;font-size:13px;color:#F4EFE4;margin-top:4px">${docNumber}</div>
        <div style="font-family:monospace;font-size:10px;color:#6E665B;margin-top:4px">${paidAt}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:36px 36px 24px">
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:900;color:#161310">Hola${clientName ? ', ' + clientName.split(' ')[0] : ''}.</h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#3A352E">
      Hemos recibido tu pago correctamente. A continuación el resumen de tu <strong>${tipoLabel ? tipoLabel.toLowerCase() : 'documento'}</strong>.
    </p>
    <div style="background:#19A85B;color:#fff;display:inline-block;padding:8px 20px;font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:24px">✓ PAGADO — $${Number(total).toLocaleString('es-MX', {minimumFractionDigits:2})} MXN</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">
      ${subtotal ? `<tr><td style="padding:8px 0;font-size:13px;color:#6E665B;border-bottom:1px solid #DCD2BF">Subtotal</td><td style="padding:8px 0;font-size:13px;color:#161310;text-align:right;border-bottom:1px solid #DCD2BF">$${Number(subtotal).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN</td></tr>` : ''}
      ${iva && Number(iva) > 0 ? `<tr><td style="padding:8px 0;font-size:13px;color:#6E665B;border-bottom:1px solid #DCD2BF">IVA 16%</td><td style="padding:8px 0;font-size:13px;color:#161310;text-align:right;border-bottom:1px solid #DCD2BF">$${Number(iva).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN</td></tr>` : ''}
      <tr style="background:#161310"><td style="padding:14px 16px;font-size:12px;color:#F4EFE4;font-family:monospace;letter-spacing:.08em;text-transform:uppercase">Total pagado</td><td style="padding:14px 16px;font-size:16px;font-weight:700;color:#19A85B;text-align:right">$${Number(total).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #DCD2BF">
      <tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace">Fecha y hora</td><td style="padding:10px 0;font-size:12px;color:#161310;text-align:right;font-family:monospace">${paidAt}</td></tr>
      ${cardBrand ? `<tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">Método de pago</td><td style="padding:10px 0;text-align:right;border-top:1px solid #EAE2D2">${cardBadge(cardBrand, cardLast4)}</td></tr>` : ''}
      ${stripeId ? `<tr><td style="padding:10px 0;font-size:12px;color:#6E665B;font-family:monospace;border-top:1px solid #EAE2D2">ID de transacción</td><td style="padding:10px 0;font-size:11px;color:#6E665B;text-align:right;font-family:monospace;border-top:1px solid #EAE2D2;word-break:break-all">${stripeId}</td></tr>` : ''}
      ${extraRows}
    </table>
  </td></tr>
  <tr><td style="background:#F4EFE4;padding:24px 36px">
    <div style="border-left:3px solid #FF5A1F;padding:14px 18px;background:#FBF8F1">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6E665B;margin-bottom:8px">_ ¿Necesitas factura fiscal (CFDI)?</div>
      <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#3A352E">Solicita tu CFDI antes del <strong>último día del mes</strong> en que realizaste el pago. Solo necesitas tener a la mano tu RFC, razón social y código postal fiscal.</p>
      <a href="${cfdiLink}" style="display:inline-block;background:#161310;color:#F4EFE4;font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:12px 22px;text-decoration:none">Solicitar factura CFDI →</a>
    </div>
  </td></tr>
  <tr><td style="background:#F4EFE4;padding:0 36px 32px">
    <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#3A352E">Atentamente,</p>
    <p style="margin:0 0 20px;font-size:14px;font-weight:700;color:#161310">Finance Team — THE GAPT PROJECT</p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#161310">
      <a href="mailto:finance@thegaptproject.com" style="display:inline-block;padding:14px 28px;font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#F4EFE4;text-decoration:none">Contactar → finance@thegaptproject.com</a>
    </td></tr></table>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#0F0D0A;padding:24px 36px">
    <div style="font-family:monospace;font-size:10px;color:#6E665B;line-height:1.8">
      <strong style="color:#F4EFE4">THE GAPT PROJECT</strong><br>
      Finance Team<br>
      finance@thegaptproject.com · thegaptproject.com
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── ENTREGAS (internal file delivery) ───────────────────────────────────────

function generateId(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, n => chars[n % chars.length]).join('');
}

function dlJson(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function handleGroups(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (request.method === 'GET') {
    const raw = env.KV ? await env.KV.get('groups:list') : null;
    return dlJson(raw ? JSON.parse(raw) : []);
  }
  if (request.method === 'POST') {
    let groups;
    try { groups = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }
    if (env.KV) await env.KV.put('groups:list', JSON.stringify(groups));
    return dlJson({ ok: true });
  }
  return new Response('Method Not Allowed', { status: 405, headers: CORS });
}

async function handleEntregasUpload(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);

  let formData;
  try { formData = await request.formData(); }
  catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

  const fileEntries = formData.getAll('file');
  const contactsRaw = formData.get('contacts') || '[]';
  const mode = formData.get('mode') || 'individual';
  const message = formData.get('message') || '';
  const clientPin = formData.get('clientPin') || String(Math.floor(1000 + Math.random() * 9000));
  const sendAtRaw = formData.get('sendAt') || '';
  const fromEmail = formData.get('fromEmail') || 'gustavo';

  let contacts = [];
  try { contacts = JSON.parse(contactsRaw); } catch {}
  if (!contacts.length) return dlJson({ error: 'Se requiere al menos un contacto' }, 400);
  if (!fileEntries.length) return dlJson({ error: 'Se requiere al menos un archivo' }, 400);
  if (!contacts.some(c => c.main)) contacts[0].main = true;

  const id = generateId(10);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const sendAt = sendAtRaw ? new Date(sendAtRaw).getTime() : Date.now();
  const scheduled = sendAt > Date.now() + 30000;

  const files = [];
  for (let i = 0; i < fileEntries.length; i++) {
    const file = fileEntries[i];
    const r2key = `delivery/${id}/${i}`;
    await env.FILES.put(r2key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { filename: file.name, size: String(file.size) },
    });
    files.push({ filename: file.name, size: file.size, r2key });
  }

  const meta = {
    id, files, contacts, mode, message, clientPin, fromEmail,
    sendAt, status: scheduled ? 'pending' : 'sent',
    expiresAt, createdAt: Date.now(),
  };

  if (env.KV) {
    await env.KV.put(`dl:${id}`, JSON.stringify(meta), { expirationTtl: 8 * 24 * 60 * 60 });
    const listRaw = await env.KV.get('dl:list');
    const list = listRaw ? JSON.parse(listRaw) : [];
    list.unshift({ id, filename: files.map(f => f.filename).join(', '), contacts, mode, sendAt, status: meta.status, expiresAt, createdAt: Date.now() });
    await env.KV.put('dl:list', JSON.stringify(list.slice(0, 100)));
  }

  let emailError = null;
  if (!scheduled && env.RESEND_API_KEY) {
    try { await sendEntregaEmails(meta, env); }
    catch (e) { emailError = e.message; console.error('[GAPT-UPLOAD] email failed:', e.message); }
  }

  return dlJson({ ok: true, id, status: meta.status, link: `https://thegaptproject.com/entrega/?id=${id}`, ...(emailError ? { emailError } : {}) });
}

async function handleEntregasLink(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  let body;
  try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

  const { url, name, contacts, mode, message, clientPin, sendAt: sendAtRaw, fromEmail } = body;
  if (!url || !contacts?.length) return dlJson({ error: 'Faltan campos requeridos' }, 400);
  if (!contacts.some(c => c.main)) contacts[0].main = true;

  const id = generateId(10);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const sendAt = sendAtRaw ? new Date(sendAtRaw).getTime() : Date.now();
  const scheduled = sendAt > Date.now() + 30000;
  const pin = clientPin || String(Math.floor(1000 + Math.random() * 9000));

  const meta = {
    id, type: 'link', url, name: name || url,
    files: [{ filename: name || url, size: 0 }],
    contacts, mode: mode || 'individual', message: message || '',
    clientPin: pin, fromEmail: fromEmail || 'gustavo',
    sendAt, status: scheduled ? 'pending' : 'sent',
    expiresAt, createdAt: Date.now(),
  };

  if (env.KV) {
    await env.KV.put(`dl:${id}`, JSON.stringify(meta), { expirationTtl: 8 * 24 * 60 * 60 });
    const listRaw = await env.KV.get('dl:list');
    const list = listRaw ? JSON.parse(listRaw) : [];
    list.unshift({ id, filename: name || url, contacts, mode: meta.mode, sendAt, status: meta.status, expiresAt, createdAt: Date.now() });
    await env.KV.put('dl:list', JSON.stringify(list.slice(0, 100)));
  }

  let emailError = null;
  if (!scheduled && env.RESEND_API_KEY) {
    try { await sendEntregaEmails(meta, env); }
    catch (e) { emailError = e.message; console.error('[GAPT-LINK] email failed:', e.message); }
  }

  return dlJson({ ok: true, id, status: meta.status, link: `https://thegaptproject.com/entrega/?id=${id}`, ...(emailError ? { emailError } : {}) });
}

async function handleUploadStart(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  let body;
  try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

  const { files, contacts, mode, message, clientPin, sendAt, fromEmail } = body;
  if (!files?.length || !contacts?.length) return dlJson({ error: 'Faltan campos requeridos' }, 400);

  const id = generateId(10);
  const uploads = [];

  for (let i = 0; i < files.length; i++) {
    const { filename, size } = files[i];
    const r2key = `delivery/${id}/${i}`;
    const mpu = await env.FILES.createMultipartUpload(r2key, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { filename, size: String(size) },
    });
    uploads.push({ fileIdx: i, filename, size, r2key, uploadId: mpu.uploadId });
  }

  const pendingMeta = {
    id, uploads,
    contacts, mode: mode || 'individual',
    message: message || '',
    clientPin: clientPin || String(Math.floor(1000 + Math.random() * 9000)),
    fromEmail: fromEmail || 'gustavo',
    sendAt: sendAt ? new Date(sendAt).getTime() : Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
  };

  if (env.KV) await env.KV.put(`dl:pending:${id}`, JSON.stringify(pendingMeta), { expirationTtl: 24 * 60 * 60 });

  return dlJson({ ok: true, id, uploads: uploads.map(u => ({ fileIdx: u.fileIdx, uploadId: u.uploadId, r2key: u.r2key })) });
}

async function handleUploadPart(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);

  const segs = url.pathname.split('/').filter(Boolean);
  // /entregas/upload-part/:id/:fileIdx/:partNum
  const id = segs[2];
  const fileIdx = parseInt(segs[3]);
  const partNum = parseInt(segs[4]);

  const pendingRaw = env.KV ? await env.KV.get(`dl:pending:${id}`) : null;
  if (!pendingRaw) return dlJson({ error: 'Upload no encontrado' }, 404);
  const pending = JSON.parse(pendingRaw);

  const upload = pending.uploads[fileIdx];
  if (!upload) return dlJson({ error: 'Índice de archivo inválido' }, 400);

  const mpu = env.FILES.resumeMultipartUpload(upload.r2key, upload.uploadId);
  const chunk = await request.arrayBuffer();
  const part = await mpu.uploadPart(partNum, chunk);

  return dlJson({ ok: true, partNumber: part.partNumber, etag: part.etag });
}

async function handleUploadFinish(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);

  const id = url.pathname.split('/').pop();
  let body;
  try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

  const pendingRaw = env.KV ? await env.KV.get(`dl:pending:${id}`) : null;
  if (!pendingRaw) return dlJson({ error: 'Upload no encontrado' }, 404);
  const pending = JSON.parse(pendingRaw);

  // body.parts: [{fileIdx, parts: [{partNumber, etag}]}]
  const files = [];
  for (const { fileIdx, parts } of body.parts) {
    const upload = pending.uploads[fileIdx];
    const mpu = env.FILES.resumeMultipartUpload(upload.r2key, upload.uploadId);
    await mpu.complete(parts);
    files.push({ filename: upload.filename, size: upload.size, r2key: upload.r2key });
  }

  const scheduled = pending.sendAt > Date.now() + 30000;
  const meta = {
    id, files,
    contacts: pending.contacts, mode: pending.mode,
    message: pending.message, clientPin: pending.clientPin,
    fromEmail: pending.fromEmail, sendAt: pending.sendAt,
    expiresAt: pending.expiresAt, createdAt: pending.createdAt,
    status: scheduled ? 'pending' : 'sent',
  };

  if (env.KV) {
    await env.KV.put(`dl:${id}`, JSON.stringify(meta), { expirationTtl: 8 * 24 * 60 * 60 });
    await env.KV.delete(`dl:pending:${id}`);
    const listRaw = await env.KV.get('dl:list');
    const list = listRaw ? JSON.parse(listRaw) : [];
    list.unshift({ id, filename: files.map(f => f.filename).join(', '), contacts: meta.contacts, mode: meta.mode, sendAt: meta.sendAt, status: meta.status, expiresAt: meta.expiresAt, createdAt: meta.createdAt });
    await env.KV.put('dl:list', JSON.stringify(list.slice(0, 100)));
  }

  let emailError = null;
  if (!scheduled && env.RESEND_API_KEY) {
    try { await sendEntregaEmails(meta, env); }
    catch (e) { emailError = e.message; console.error('[GAPT-FINISH] email failed:', e.message); }
  }

  return dlJson({ ok: true, id, status: meta.status, link: `https://thegaptproject.com/entrega/?id=${id}`, ...(emailError ? { emailError } : {}) });
}

async function handleEntregasList(request, env) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const listRaw = env.KV ? await env.KV.get('dl:list') : null;
  return new Response(listRaw || '[]', { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function handleEntregasInfo(request, env, url) {
  const id = url.pathname.split('/').pop();
  const metaRaw = env.KV ? await env.KV.get(`dl:${id}`) : null;
  if (!metaRaw) return dlJson({ error: 'Entrega no encontrada o expirada' }, 404);
  const meta = JSON.parse(metaRaw);
  if (Date.now() > meta.expiresAt) return dlJson({ error: 'Este enlace ha expirado' }, 410);
  const main = meta.contacts ? (meta.contacts.find(c => c.main) || meta.contacts[0]) : {};
  // normalize to multi-file format
  const files = meta.files || [{ filename: meta.filename, size: meta.size }];
  return dlJson({
    files,
    clientName: main.name || meta.clientName || '',
    message: meta.message, expiresAt: meta.expiresAt, createdAt: meta.createdAt,
  });
}

async function handleEntregasFile(request, env, url) {
  const segs = url.pathname.split('/').filter(Boolean);
  // /entregas/file/:id or /entregas/file/:id/:fileIdx
  const id = segs[2];
  const fileIdx = segs[3] !== undefined ? parseInt(segs[3]) : 0;

  let body;
  try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

  const metaRaw = env.KV ? await env.KV.get(`dl:${id}`) : null;
  if (!metaRaw) return dlJson({ error: 'Entrega no encontrada o expirada' }, 404);
  const meta = JSON.parse(metaRaw);
  if (Date.now() > meta.expiresAt) return dlJson({ error: 'Este enlace ha expirado' }, 410);
  if (String(body.pin) !== String(meta.clientPin)) return dlJson({ error: 'PIN incorrecto' }, 401);

  // link type — return URL as JSON
  if (meta.type === 'link') return dlJson({ type: 'link', url: meta.url, name: meta.name });

  // normalize to multi-file format (backward compat)
  const files = meta.files || [{ filename: meta.filename, size: meta.size, r2key: meta.r2key }];
  const fileEntry = files[fileIdx];
  if (!fileEntry) return dlJson({ error: 'Archivo no encontrado' }, 404);

  const object = env.FILES ? await env.FILES.get(fileEntry.r2key) : null;
  if (!object) return dlJson({ error: 'Archivo no disponible' }, 404);

  const headers = new Headers(CORS);
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileEntry.filename)}`);
  return new Response(object.body, { headers });
}

async function handleEntregasDelete(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = url.pathname.split('/').pop();
  const metaRaw = env.KV ? await env.KV.get(`dl:${id}`) : null;
  if (metaRaw) {
    const meta = JSON.parse(metaRaw);
    if (env.FILES) await env.FILES.delete(meta.r2key).catch(() => {});
    if (env.KV) {
      await env.KV.delete(`dl:${id}`);
      const listRaw = await env.KV.get('dl:list');
      if (listRaw) {
        const list = JSON.parse(listRaw).filter(d => d.id !== id);
        await env.KV.put('dl:list', JSON.stringify(list));
      }
    }
  }
  return dlJson({ ok: true });
}

async function sendEntregaEmails(meta, env) {
  const { contacts = [], mode, files, filename, size, message, clientPin, expiresAt, id, fromEmail = 'gustavo' } = meta;
  const resolvedFiles = files || [{ filename, size }];
  if (mode === 'cc') {
    const main = contacts.find(c => c.main) || contacts[0];
    const ccEmails = contacts.filter(c => c !== main).map(c => c.email).filter(Boolean);
    await sendSingleEntregaEmail({ id, files: resolvedFiles, message, clientPin, expiresAt, recipientName: main.name, recipientEmail: main.email, ccEmails, fromEmail }, env);
  } else {
    for (const contact of contacts) {
      await sendSingleEntregaEmail({ id, files: resolvedFiles, message, clientPin, expiresAt, recipientName: contact.name, recipientEmail: contact.email, fromEmail }, env);
    }
  }
}

async function sendSingleEntregaEmail({ id, files = [], message, clientPin, expiresAt, recipientName, recipientEmail, ccEmails = [], fromEmail = 'gustavo' }, env) {
  const link = `https://thegaptproject.com/entrega/?id=${id}`;
  const expiryStr = new Date(expiresAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
  const sizeStr = totalSize > 1048576 ? `${(totalSize / 1048576).toFixed(1)} MB` : `${Math.round(totalSize / 1024)} KB`;
  const fileLabel = files.length === 1 ? files[0].filename : `${files.length} archivos`;
  const firstName = recipientName ? recipientName.split(' ')[0] : '';
  const personalMsg = (message || 'Tengo una entrega para ti desde THE GAPT PROJECT.').replace(/\{nombre\}/gi, firstName);

  const html = buildEntregaEmail({ firstName, filename: fileLabel, sizeStr, personalMsg, clientPin, link, expiryStr });
  const emailPayload = {
    from: FROM_ADDRESSES[fromEmail] || FROM_ADDRESSES.gustavo,
    to: [recipientEmail],
    ...(ccEmails.length ? { cc: ccEmails } : {}),
    reply_to: REPLY_ADDRESSES[fromEmail] || REPLY_ADDRESSES.gustavo,
    subject: `Tienes una entrega — ${fileLabel}`,
    html,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(emailPayload),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => res.status);
    console.error(`[GAPT-ENTREGAS] Resend error ${res.status} → to:${recipientEmail} from:${emailPayload.from} — ${errBody}`);
    throw new Error(`Resend ${res.status}: ${errBody}`);
  }
}

function buildEntregaEmail({ firstName, filename, sizeStr, personalMsg, clientPin, link, expiryStr }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Entrega THE GAPT PROJECT</title></head>
<body style="margin:0;padding:0;background:#EAE2D2;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EAE2D2;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#161310;padding:32px 36px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>${GAPT_LOGO_EMAIL}</td>
      <td align="right">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B">ENTREGA</div>
        <div style="font-family:monospace;font-size:9px;color:#6E665B;margin-top:4px">Vigencia: ${expiryStr}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:36px 36px 24px">
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:900;color:#161310">Hola${firstName ? ', ' + firstName : ''}.</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3A352E">${personalMsg}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#161310;margin-bottom:28px">
      <tr><td style="padding:20px 24px">
        <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6E665B;margin-bottom:8px">_ Archivo</div>
        <div style="font-size:15px;font-weight:700;color:#F4EFE4;margin-bottom:4px">${filename}</div>
        <div style="font-family:monospace;font-size:10px;color:#6E665B">${sizeStr}</div>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr><td style="background:#FF5A1F;text-align:center">
        <a href="${link}" style="display:block;padding:16px 32px;font-family:monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#fff;text-decoration:none;font-weight:700">Descargar archivo →</a>
      </td></tr>
    </table>
    <div style="border-left:3px solid #FF5A1F;padding:14px 18px;background:#FBF8F1;margin-bottom:8px">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6E665B;margin-bottom:8px">_ PIN de acceso</div>
      <div style="font-family:monospace;font-size:36px;font-weight:900;color:#161310;letter-spacing:.3em">${clientPin}</div>
      <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#6E665B">Necesitarás este PIN para descargar el archivo. El enlace expira el <strong style="color:#161310">${expiryStr}</strong>.</p>
    </div>
  </td></tr>
  <tr><td style="background:#F4EFE4;padding:0 36px 32px">
    <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#3A352E">Saludos,</p>
    <p style="margin:0 0 20px;font-size:14px;font-weight:700;color:#161310">Gustavo Pastrana — THE GAPT PROJECT</p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#161310">
      <a href="mailto:gustavo@thegaptproject.com" style="display:inline-block;padding:14px 28px;font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#F4EFE4;text-decoration:none">Responder → gustavo@thegaptproject.com</a>
    </td></tr></table>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#0F0D0A;padding:24px 36px">
    <div style="font-family:monospace;font-size:10px;color:#6E665B;line-height:1.8">
      <strong style="color:#F4EFE4">THE GAPT PROJECT</strong><br>
      gustavo@thegaptproject.com · thegaptproject.com
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function processPendingDeliveries(env) {
  if (!env.KV || !env.RESEND_API_KEY) return;
  const listRaw = await env.KV.get('dl:list');
  if (!listRaw) return;
  const list = JSON.parse(listRaw);
  const now = Date.now();
  let changed = false;

  for (const item of list) {
    if (item.status !== 'pending' || item.sendAt > now) continue;
    const metaRaw = await env.KV.get(`dl:${item.id}`);
    if (!metaRaw) { item.status = 'expired'; changed = true; continue; }
    const meta = JSON.parse(metaRaw);
    try {
      await sendEntregaEmails(meta, env);
      meta.status = 'sent';
      item.status = 'sent';
      await env.KV.put(`dl:${meta.id}`, JSON.stringify(meta), { expirationTtl: 8 * 24 * 60 * 60 });
    } catch (e) {
      console.error('Error sending scheduled delivery', item.id, e.message);
    }
    changed = true;
  }

  if (changed) await env.KV.put('dl:list', JSON.stringify(list));
}

async function handleEntregasDetail(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = url.pathname.split('/').pop();
  const metaRaw = env.KV ? await env.KV.get(`dl:${id}`) : null;
  if (!metaRaw) return dlJson({ error: 'Entrega no encontrada' }, 404);
  const meta = JSON.parse(metaRaw);
  return dlJson({
    id: meta.id,
    files: meta.files || [],
    contacts: meta.contacts || [],
    mode: meta.mode,
    clientPin: meta.clientPin,
    fromEmail: meta.fromEmail,
    link: `https://thegaptproject.com/entrega/?id=${meta.id}`,
    status: meta.status,
    sendAt: meta.sendAt,
    expiresAt: meta.expiresAt,
    createdAt: meta.createdAt,
    downloadedAt: meta.downloadedAt || null,
    downloadCount: meta.downloadCount || 0,
  });
}

async function handleEntregasResend(request, env, url) {
  if (!checkPin(request, env)) return dlJson({ error: 'PIN incorrecto' }, 401);
  const id = url.pathname.split('/').pop();
  const metaRaw = env.KV ? await env.KV.get(`dl:${id}`) : null;
  if (!metaRaw) return dlJson({ error: 'Entrega no encontrada' }, 404);
  const meta = JSON.parse(metaRaw);
  if (!env.RESEND_API_KEY) return dlJson({ error: 'Email no configurado' }, 500);
  if (Date.now() > meta.expiresAt) return dlJson({ error: 'La entrega ha expirado' }, 410);
  try {
    await sendEntregaEmails(meta, env);
    return dlJson({ ok: true });
  } catch (e) {
    console.error('[GAPT-RESEND] email failed:', e.message);
    return dlJson({ error: e.message }, 500);
  }
}

async function handleEntregasTrack(request, env, url) {
  const id = url.pathname.split('/').pop();
  if (!env.KV || !id) return dlJson({ ok: true });
  let body = {};
  try { body = await request.json(); } catch {}
  const metaRaw = await env.KV.get(`dl:${id}`);
  if (!metaRaw) return dlJson({ ok: true });
  const meta = JSON.parse(metaRaw);
  const now = Date.now();
  if (!meta.downloadedAt) meta.downloadedAt = now;
  meta.downloadCount = (meta.downloadCount || 0) + 1;
  meta.lastDownloadAt = now;
  if (body.action) {
    meta.trackLog = meta.trackLog || [];
    meta.trackLog.push({ action: body.action, at: now });
    if (meta.trackLog.length > 20) meta.trackLog = meta.trackLog.slice(-20);
  }
  if (body.action === 'downloaded') {
    const fileLabel = meta.files?.[0]?.filename || 'archivo';
    try { await broadcastPush(env, { title: '↓ Entrega descargada', body: fileLabel, url: '/one/', tag: `dl-${id}`, urgency: 'normal' }); } catch(e) { console.error('[PUSH-DL]', e.message); }
  }
  const ttl = Math.max(0, Math.floor((meta.expiresAt - now) / 1000));
  if (ttl > 0) await env.KV.put(`dl:${id}`, JSON.stringify(meta), { expirationTtl: ttl });
  // update dl:list entry with downloadedAt
  const listRaw = await env.KV.get('dl:list');
  if (listRaw) {
    const list = JSON.parse(listRaw);
    const item = list.find(x => x.id === id);
    if (item) {
      item.downloadedAt = meta.downloadedAt;
      item.downloadCount = meta.downloadCount;
      await env.KV.put('dl:list', JSON.stringify(list));
    }
  }
  return dlJson({ ok: true });
}

async function handleEntregasShare(request, env, url) {
  const id = url.pathname.split('/').pop();
  let body;
  try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

  const { pin, senderName, recipientName, recipientEmail, note } = body;
  if (!recipientEmail || !recipientName) return dlJson({ error: 'Nombre y correo del destinatario son requeridos' }, 400);

  const metaRaw = env.KV ? await env.KV.get(`dl:${id}`) : null;
  if (!metaRaw) return dlJson({ error: 'Entrega no encontrada' }, 404);
  const meta = JSON.parse(metaRaw);
  if (Date.now() > meta.expiresAt) return dlJson({ error: 'Este enlace ha expirado' }, 410);
  if (String(pin) !== String(meta.clientPin)) return dlJson({ error: 'PIN incorrecto' }, 401);
  if (!env.RESEND_API_KEY) return dlJson({ error: 'Email no configurado' }, 500);

  const link = `https://thegaptproject.com/entrega/?id=${id}`;
  const expiryStr = new Date(meta.expiresAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const metaFiles = meta.files || [{ filename: meta.filename, size: meta.size }];
  const totalSize = metaFiles.reduce((s, f) => s + (f.size || 0), 0);
  const sizeStr = totalSize > 1048576 ? `${(totalSize / 1048576).toFixed(1)} MB` : `${Math.round(totalSize / 1024)} KB`;
  const fileLabel = esc(metaFiles.length === 1 ? metaFiles[0].filename : `${metaFiles.length} archivos`);
  const firstName = esc(recipientName.split(' ')[0]);
  const senderNameSafe = esc(senderName);
  const noteSafe = esc(note);

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Documento compartido — THE GAPT PROJECT</title></head>
<body style="margin:0;padding:0;background:#EAE2D2;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EAE2D2;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#161310;padding:32px 36px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>${GAPT_LOGO_EMAIL}</td>
      <td align="right">
        <div style="font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B">DOCUMENTO COMPARTIDO</div>
        <div style="font-family:monospace;font-size:9px;color:#6E665B;margin-top:4px">Vigencia: ${expiryStr}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:36px 36px 24px">
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:900;color:#161310">Hola, ${firstName}.</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3A352E">
      <strong style="color:#161310">${senderNameSafe || 'Alguien'}</strong> ha compartido el siguiente documento contigo.
    </p>
    ${noteSafe ? `<div style="border-left:3px solid #6E665B;padding:12px 16px;background:#F0EAD8;margin-bottom:24px">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B;margin-bottom:6px">_ Nota</div>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#3A352E">${noteSafe}</p>
    </div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#161310;margin-bottom:24px">
      <tr><td style="padding:20px 24px">
        <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6E665B;margin-bottom:8px">_ Entrega</div>
        <div style="font-size:15px;font-weight:700;color:#F4EFE4;margin-bottom:4px">${fileLabel}</div>
        <div style="font-family:monospace;font-size:10px;color:#6E665B">${sizeStr}</div>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr><td style="background:#FF5A1F;text-align:center">
        <a href="${link}" style="display:block;padding:16px 32px;font-family:monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#fff;text-decoration:none;font-weight:700">Ver documento →</a>
      </td></tr>
    </table>
    <div style="border-left:3px solid #FF5A1F;padding:14px 18px;background:#FBF8F1;margin-bottom:8px">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6E665B;margin-bottom:8px">_ PIN de acceso</div>
      <div style="font-family:monospace;font-size:36px;font-weight:900;color:#161310;letter-spacing:.3em">${meta.clientPin}</div>
      <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#6E665B">Necesitarás este PIN para ver y descargar el documento. Disponible hasta el <strong style="color:#161310">${expiryStr}</strong>.</p>
    </div>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#0F0D0A;padding:24px 36px">
    <div style="font-family:monospace;font-size:10px;color:#6E665B;line-height:1.8">
      <strong style="color:#F4EFE4">THE GAPT PROJECT</strong><br>
      Este documento ha sido creado por THE GAPT PROJECT · thegaptproject.com
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'THE GAPT PROJECT <hello@thegaptproject.com>',
      to: [recipientEmail],
      reply_to: 'hello@thegaptproject.com',
      subject: `${senderName || 'Alguien'} ha compartido un documento contigo`,
      html,
    }),
  });

  return dlJson({ ok: true });
}

function buildEmail({ tipoLabel, docType, docNumber, clientName, emisor, fecha, items = [], subtotal, iva, total, validez, notas, paymentUrl }) {
  tipoLabel = esc(tipoLabel); docNumber = esc(docNumber); clientName = esc(clientName); emisor = esc(emisor); fecha = esc(fecha); validez = esc(validez); notas = esc(notas);
  // Corrections window disclaimer — only applies to billing documents (nota de cobro / orden de cambio),
  // not quotes or purchase orders, where "trabajo entregado" doesn't apply the same way.
  const avisoCorrecciones = ['factura', 'ordenCambio'].includes(docType) ? `
    <tr><td style="background:#F4EFE4;padding:20px 36px 0">
      <div style="border-left:3px solid #6E665B;padding:12px 16px;background:#FBF8F1">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#3A352E">Cualquier detalle o error en el trabajo debe notificarse dentro de los <strong>15 días naturales</strong> posteriores a la entrega. Pasado este plazo, las correcciones se cobrarán por separado.</p>
      </div>
    </td></tr>` : '';
  const avisoSpei = ['factura', 'ordenCambio', 'ordenPago', 'notaVenta'].includes(docType) ? `
    <tr><td style="background:#F4EFE4;padding:20px 36px 0">
      <div style="border-left:3px solid #FF5A1F;padding:12px 16px;background:#FBF8F1">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#3A352E">Si realizas tu pago por <strong>transferencia SPEI</strong>, envíanos tu comprobante respondiendo a este mismo correo.</p>
      </div>
    </td></tr>` : '';
  const itemRows = items.map(it => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #EAE2D2;font-size:13px;color:#161310;line-height:1.45">
        <strong style="font-weight:600">${esc(it.concepto || '')}</strong>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #EAE2D2;font-size:12px;color:#6E665B;white-space:nowrap;vertical-align:top">${esc(it.unidad || '')}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #EAE2D2;font-size:12px;color:#6E665B;text-align:right;white-space:nowrap;vertical-align:top">${it.cantidad || ''}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #EAE2D2;font-size:13px;color:#161310;text-align:right;white-space:nowrap;vertical-align:top">$${fmt(it.precio_unitario)}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #EAE2D2;font-size:13px;color:#161310;font-weight:600;text-align:right;white-space:nowrap;vertical-align:top">$${fmt((it.cantidad || 1) * (it.precio_unitario || 0))}</td>
    </tr>`).join('');

  const totalsRow = `
    ${subtotal != null ? `<tr><td colspan="4" style="padding:8px 16px;text-align:right;font-size:12px;color:#6E665B;font-family:monospace">Subtotal</td><td style="padding:8px 16px;text-align:right;font-size:13px;color:#161310;white-space:nowrap">$${fmt(subtotal)}</td></tr>` : ''}
    ${iva != null && iva > 0 ? `<tr><td colspan="4" style="padding:8px 16px;text-align:right;font-size:12px;color:#6E665B;font-family:monospace">IVA 16%</td><td style="padding:8px 16px;text-align:right;font-size:13px;color:#161310;white-space:nowrap">$${fmt(iva)}</td></tr>` : ''}
    <tr style="background:#161310"><td colspan="4" style="padding:14px 16px;text-align:right;font-size:12px;color:#F4EFE4;letter-spacing:.08em;text-transform:uppercase;font-family:monospace">Total MXN</td><td style="padding:14px 16px;text-align:right;font-size:16px;font-weight:700;color:#FF5A1F;white-space:nowrap">$${fmt(total)}</td></tr>
  `;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${tipoLabel} ${docNumber}</title></head>
<body style="margin:0;padding:0;background:#EAE2D2;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EAE2D2;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#161310;padding:32px 36px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>${GAPT_LOGO_EMAIL}</td>
      <td align="right">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B">${tipoLabel}</div>
        <div style="font-family:monospace;font-size:13px;color:#F4EFE4;margin-top:4px">${docNumber}</div>
        <div style="font-family:monospace;font-size:10px;color:#6E665B;margin-top:4px">${fecha || ''}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:36px 36px 0">
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:900;color:#161310">Hola${clientName ? ', ' + clientName.split(' ')[0] : ''}.</h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#3A352E">
      Tienes una nueva <strong style="color:#161310">${tipoLabel.toLowerCase()}</strong> de THE GAPT PROJECT. Adjunto podrás ver el PDF con el detalle completo, y a continuación encontrarás el resumen.${validez ? ` Vigencia: <strong style="color:#161310">${validez}</strong>.` : ''}
    </p>
  </td></tr>
  <tr><td style="background:#F4EFE4;padding:24px 36px 0"><div style="height:1px;background:#DCD2BF"></div></td></tr>
  <tr><td style="background:#F4EFE4;padding:0 36px">
    ${items.length > 0 ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px">
      <thead><tr style="background:#161310">
        <th style="padding:10px 16px;text-align:left;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B;font-weight:500">Concepto</th>
        <th style="padding:10px 16px;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B;font-weight:500">Unidad</th>
        <th style="padding:10px 16px;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B;font-weight:500">Cant.</th>
        <th style="padding:10px 16px;text-align:right;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B;font-weight:500">P.Unit.</th>
        <th style="padding:10px 16px;text-align:right;font-family:monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B;font-weight:500">Importe</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>` : ''}
  </td></tr>
  ${notas ? `<tr><td style="background:#F4EFE4;padding:24px 36px 0">
    <div style="border-left:3px solid #FF5A1F;padding:12px 16px;background:#FBF8F1">
      <div style="font-family:monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#6E665B;margin-bottom:6px">_ Notas</div>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#3A352E">${notas}</p>
    </div>
  </td></tr>` : ''}
  ${avisoCorrecciones}
  ${avisoSpei}
  <tr><td style="background:#F4EFE4;padding:32px 36px">
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3A352E">Si tienes alguna pregunta o ajuste, no dudes en comunicarte con nosotros.</p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#3A352E">Atentamente,</p>
    <p style="margin:0 0 24px;font-size:14px;font-weight:700;color:#161310">Finance Team — THE GAPT PROJECT</p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:12px 0">
      <tr>
        ${paymentUrl ? `<td style="background:#FF5A1F">
          <a href="${paymentUrl}" style="display:inline-block;padding:14px 28px;font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#fff;text-decoration:none;white-space:nowrap">Pagar en línea →</a>
        </td>` : ''}
        <td style="background:#161310">
          <a href="mailto:finance@thegaptproject.com" style="display:inline-block;padding:14px 28px;font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#F4EFE4;text-decoration:none;white-space:nowrap">Responder → finance@thegaptproject.com</a>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#0F0D0A;padding:24px 36px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:monospace;font-size:10px;color:#6E665B;line-height:1.8">
        <strong style="color:#F4EFE4">THE GAPT PROJECT</strong><br>
        Finance Team<br>
        finance@thegaptproject.com · thegaptproject.com
      </td>
      <td align="right" style="vertical-align:bottom">
        <div style="font-family:monospace;font-size:9px;letter-spacing:.18em;color:#3A352E;text-transform:uppercase">No two alike</div>
      </td>
    </tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
