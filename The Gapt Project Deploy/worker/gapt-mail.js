const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    let data;
    try { data = await request.json(); }
    catch { return new Response('Bad Request', { status: 400, headers: CORS }); }

    const { to, docType, docNumber, clientName, emisor, fecha, items, subtotal, iva, total, validez, notas, pdfBase64 } = data;

    if (!to || !docType || !docNumber) {
      return new Response(JSON.stringify({ error: 'Faltan campos requeridos' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    const tipoLabel = {
      cotizacion:  'Cotización',
      factura:     'Nota de cobro',
      ordenCompra: 'Orden de compra',
      ordenPago:   'Orden de pago',
      recibo:      'Recibo',
      notaVenta:   'Nota de venta',
    }[docType] || docType;

    const subject = `${tipoLabel} ${docNumber} — THE GAPT PROJECT`;
    const html = buildEmail({ tipoLabel, docNumber, clientName, emisor, fecha, items, subtotal, iva, total, validez, notas });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `THE GAPT PROJECT <finance@thegaptproject.com>`,
        to: [to],
        reply_to: 'hello@thegaptproject.com',
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
    return new Response(JSON.stringify(result), {
      status: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};

function fmt(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildEmail({ tipoLabel, docNumber, clientName, emisor, fecha, items = [], subtotal, iva, total, validez, notas }) {
  const itemRows = items.map(it => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #EAE2D2;font-size:13px;color:#161310;line-height:1.45">
        <strong style="font-weight:600">${it.concepto || ''}</strong>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #EAE2D2;font-size:12px;color:#6E665B;white-space:nowrap;vertical-align:top">${it.unidad || ''}</td>
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
      <td>
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:20px;font-weight:900;letter-spacing:-.04em;color:#F4EFE4;text-transform:uppercase">THE GAPT PROJECT</div>
        <div style="font-family:monospace;font-size:9px;letter-spacing:.24em;color:#6E665B;text-transform:uppercase;margin-top:4px">NO TWO ALIKE</div>
      </td>
      <td align="right">
        <div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6E665B">${tipoLabel}</div>
        <div style="font-family:monospace;font-size:13px;color:#F4EFE4;margin-top:4px">${docNumber}</div>
        <div style="font-family:monospace;font-size:10px;color:#6E665B;margin-top:4px">${fecha || ''}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#F4EFE4;padding:36px 36px 0">
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:900;color:#161310">Hola${clientName ? ', ' + clientName.split(' ')[0] : ''}.</h1>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#3A352E">Adjunto encontrarás tu <strong>${tipoLabel.toLowerCase()}</strong> de THE GAPT PROJECT.${validez ? ` Vigencia: <strong>${validez}</strong>.` : ''}</p>
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
  <tr><td style="background:#F4EFE4;padding:32px 36px">
    <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#6E665B">Para cualquier duda, responde este correo.</p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#161310">
      <a href="mailto:hello@thegaptproject.com" style="display:inline-block;padding:14px 28px;font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#F4EFE4;text-decoration:none">Responder → hello@thegaptproject.com</a>
    </td></tr></table>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)"></td></tr>
  <tr><td style="background:#0F0D0A;padding:24px 36px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:monospace;font-size:10px;color:#6E665B;line-height:1.8">
        <strong style="color:#F4EFE4">THE GAPT PROJECT</strong><br>
        ${emisor || 'Gustavo A. Pastrana T.'}<br>
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
