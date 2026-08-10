const WORKER = 'https://gapt-mail.hvfgc6bp2r.workers.dev';
const VAPID_PUBLIC_KEY = 'BKvTLyQyRmZ_abE4nFHyoEue6ahTUytUSDWw1EJ3ZvZD5T6auakmR3zYf45SWhRqipkW5mrAmXFiqtg08-FzTBE';
let pin = '';
let swReg = null;
let cfdiData = [], entData = [], cfdiFilter = 'all', activeReplyId = null;

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function timeAgo(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'Ahora mismo';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  return `Hace ${Math.floor(hrs / 24)} d\u{ed}a${Math.floor(hrs/24) !== 1 ? 's' : ''}`;
}

/* \u{2500}\u{2500} THEME \u{2500}\u{2500} */
(function(){ try { const t = localStorage.getItem('gapt-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch(_) {} })();
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  if (next === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'light');
  try { localStorage.setItem('gapt-theme', next); } catch(_) {}
}

/* \u{2500}\u{2500} PIN / AUTH \u{2500}\u{2500} */
const pinInput = document.getElementById('pin-input');
pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') verifyPin(); });

async function verifyPin() {
  const p = pinInput.value.trim();
  if (!p) return;
  const res = await fetch(WORKER + '/docs', { headers: { 'X-GAPT-PIN': p } });
  if (res.ok) {
    pin = p;
    localStorage.setItem('gapt-pin', p);
    document.getElementById('pin-gate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadAll().then(() => { lastRefresh = Date.now(); updateRefreshLabel(); });
    startAutoRefresh();
    setupPush();
    checkPushStatus();
    initFacturaTab();
    initCfdiXml();
    initEntregasTab();
    initClientesTab();
  } else {
    document.getElementById('pin-err').textContent = 'PIN incorrecto';
    pinInput.value = '';
    setTimeout(() => { document.getElementById('pin-err').textContent = ''; }, 2000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 30000);
  registerSW();
  const saved = localStorage.getItem('gapt-pin');
  if (saved) { pin = saved; pinInput.value = saved; verifyPin(); }
});

function updateClock() {
  const now = new Date();
  document.getElementById('topbar-time').textContent = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  updateRefreshLabel();
}

/* \u{2500}\u{2500} TAB SWITCHING (5 main tabs) \u{2500}\u{2500} */
const TAB_LABELS = { home: 'ONE', factura: 'FACTURA', cfdi: 'CFDI', entregas: 'ENTREGAS', cobranza: 'COBRANZA', gastos: 'GASTOS', recurrentes: 'RECURRENTES', clientes: 'CLIENTES', proyectos: 'PROYECTOS', mensajes: 'MENSAJES', expedientes: 'EXPEDIENTES', credenciales: 'CREDENCIALES' };
const OVERFLOW_TABS = ['gastos', 'recurrentes', 'clientes', 'proyectos', 'mensajes', 'expedientes', 'credenciales'];
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-tab]').forEach(n => n.classList.toggle('active', n.dataset.tab === name));
  document.getElementById('nav-more-btn')?.classList.toggle('active', OVERFLOW_TABS.includes(name));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('topbar-tab-label').textContent = TAB_LABELS[name] || 'ONE';
  window.scrollTo({ top: 0 });
  if (name === 'entregas') loadHistory();
  if (name === 'clientes') renderClientList();
  if (name === 'cobranza') loadCobranza();
  if (name === 'gastos') loadExpenses();
  if (name === 'recurrentes') loadRecurring();
  if (name === 'proyectos') { $c('proy-list-view').style.display = 'block'; $c('proy-detail-view').style.display = 'none'; loadProyectosAdmin(); loadInvitesAdmin(); }
  if (name === 'mensajes') { $c('msg-list-view').style.display = 'block'; $c('msg-detail-view').style.display = 'none'; loadMensajesAdmin(); }
  if (name === 'credenciales') loadCredenciales();
  if (name === 'expedientes') loadExpedientes();
}

function toggleMoreMenu(force) {
  const sheet = document.getElementById('nav-more-sheet');
  const backdrop = document.getElementById('nav-more-backdrop');
  const show = force !== undefined ? force : !sheet.classList.contains('show');
  sheet.classList.toggle('show', show);
  backdrop.classList.toggle('show', show);
}

/* \u{2500}\u{2500} LOAD DASHBOARD DATA \u{2500}\u{2500} */
async function loadAll() { await Promise.all([loadCfdi(), loadEntregas(), loadFinancialSummary()]); }

async function loadSpeis() {
  try {
    const res = await fetch(WORKER + '/speis', { headers: { 'X-GAPT-PIN': pin } });
    const { pending, unmatched } = await res.json();
    const section = document.getElementById('spei-section');
    const hasAny = pending.length || unmatched.length;
    if (section) section.style.display = hasAny ? 'block' : 'none';
    const fmt = n => Number(n||0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    const ts = t => new Date(t).toLocaleString('es-MX', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });

    const pendEl = document.getElementById('spei-pending-list');
    if (pendEl) {
      pendEl.innerHTML = pending.length ? pending.map(s => `
        <div style="border:1px solid #F59E0B;background:var(--card);padding:14px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px">
            <div>
              <div style="font-family:monospace;font-size:11px;font-weight:700;color:var(--cream)">${esc(s.docNumber)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(s.clientName)}</div>
              <div style="font-family:monospace;font-size:9px;color:var(--muted);margin-top:2px">${ts(s.receivedAt)}</div>
            </div>
            <div style="font-family:monospace;font-size:16px;font-weight:700;color:#4ADE80">$${fmt(s.total)}</div>
          </div>
          <div style="font-family:monospace;font-size:9px;color:var(--muted);margin-bottom:10px;line-height:1.5;word-break:break-word">${esc((s.preview||'').slice(0,120))}\u{2026}</div>
          <div style="display:flex;gap:6px">
            <button onclick="speiConfirm('${esc(s.docNumber)}')" style="font-family:monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:7px 14px;border:1px solid #4ADE80;background:none;color:#4ADE80;cursor:pointer">Confirmar pago \u{2713}</button>
            <button onclick="speiReject('${esc(s.docNumber)}')" style="font-family:monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:7px 12px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer">No es pago</button>
          </div>
        </div>`).join('') : '<div class="empty">Sin pagos pendientes de confirmar</div>';
    }

    const unmWrap = document.getElementById('spei-unmatched-wrap');
    if (unmWrap) unmWrap.style.display = unmatched.length ? 'block' : 'none';
    const unmEl = document.getElementById('spei-unmatched-list');
    if (unmEl) {
      unmEl.innerHTML = unmatched.length ? unmatched.map(s => {
        const uid = esc((s.id||'').replace('spei-unmatched:',''));
        return `
        <div class="gcard" style="padding:14px;margin-bottom:8px">
          <div style="font-family:monospace;font-size:9px;color:var(--muted);margin-bottom:4px">${ts(s.receivedAt)} \u{b7} De: ${esc(s.from||'')}</div>
          <div style="font-size:11px;color:var(--cream);margin-bottom:6px">${esc(s.subject||'')}</div>
          <div style="font-family:monospace;font-size:9px;color:var(--muted);line-height:1.5;word-break:break-word;margin-bottom:10px">${esc((s.preview||'').slice(0,150))}\u{2026}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <input id="spei-match-input-${uid}" class="fac-input" placeholder="Folio (ej. NC-001)" style="font-family:monospace;font-size:10px;padding:6px 8px;width:140px;box-sizing:border-box">
            <button onclick="speiMatch('${uid}')" style="font-family:monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:7px 12px;border:1px solid var(--orange);background:none;color:var(--orange);cursor:pointer">Asignar folio</button>
            <button onclick="speiDismiss('${uid}')" style="font-family:monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:7px 12px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer">Descartar</button>
          </div>
        </div>`;
      }).join('') : '<div class="empty">Sin pagos sin identificar</div>';
    }
  } catch(e) { console.error('loadSpeis', e); }
}

async function speiConfirm(docNumber) {
  if (!(await gConfirm(`\u{bf}Confirmar pago de ${docNumber} y marcarlo como pagado?`, { confirmLabel: 'Confirmar pago' }))) return;
  await fetch(`${WORKER}/speis/${encodeURIComponent(docNumber)}/confirm`, { method: 'POST', headers: { 'X-GAPT-PIN': pin } });
  loadCobranza(); loadFinancialSummary();
}

async function speiReject(docNumber) {
  await fetch(`${WORKER}/speis/${encodeURIComponent(docNumber)}/reject`, { method: 'POST', headers: { 'X-GAPT-PIN': pin } });
  loadSpeis();
}

async function speiMatch(uid) {
  const docNumber = document.getElementById(`spei-match-input-${uid}`)?.value.trim();
  if (!docNumber) return;
  await fetch(`${WORKER}/speis/${encodeURIComponent(uid)}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
    body: JSON.stringify({ docNumber }),
  });
  loadCobranza(); loadFinancialSummary();
}

async function speiDismiss(uid) {
  await fetch(`${WORKER}/speis/${encodeURIComponent(uid)}/reject`, { method: 'POST', headers: { 'X-GAPT-PIN': pin } });
  loadSpeis();
}

// Alta manual de un cobro: crea el registro en cobranza (y su link de pago) sin
// enviarle nada al cliente. Antes esto creaba un `reminder:` suelto que no aparec\u{ed}a
// en el historial de facturas \u{2014} ahora escribe el mismo registro que un env\u{ed}o real.
async function remCreate() {
  const folio  = document.getElementById('rem-folio').value.trim();
  const total  = document.getElementById('rem-total').value.trim();
  const nombre = document.getElementById('rem-nombre').value.trim();
  const tipo   = document.getElementById('rem-tipo').value.trim() || 'factura';
  const email  = document.getElementById('rem-email').value.trim();
  const errEl  = document.getElementById('rem-create-err');
  errEl.style.display = 'none';
  if (!folio || !total || !nombre || !email) {
    errEl.textContent = 'Folio, total, nombre y email son requeridos';
    errEl.style.display = 'block';
    return;
  }
  const res = await fetch(WORKER + '/invoices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
    body: JSON.stringify({
      docNumber: folio, docType: tipo, clientName: nombre, clientEmail: email,
      total: Number(total), subtotal: Number(total), fecha: new Date().toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' }),
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    errEl.textContent = e.error || 'Error al agregar el cobro';
    errEl.style.display = 'block';
    return;
  }
  ['rem-folio','rem-total','rem-nombre','rem-tipo','rem-email'].forEach(id => { document.getElementById(id).value = ''; });
  loadCobranza(); loadFinancialSummary();
}

// Detiene el seguimiento autom\u{e1}tico sin tocar el estado del documento: sigue
// pendiente de cobro, solo deja de mandar recordatorios.
async function remPause(docNumber) {
  if (!(await gConfirm(`\u{bf}Dejar de enviar recordatorios autom\u{e1}ticos de ${docNumber}? El documento sigue pendiente de cobro.`, { confirmLabel: 'Pausar' }))) return;
  await fetch(`${WORKER}/reminders/${encodeURIComponent(docNumber)}`, { method: 'DELETE', headers: { 'X-GAPT-PIN': pin } });
  loadCobranza();
}

async function remSendNow(docNumber) {
  if (!(await gConfirm(`\u{bf}Enviar ahora un recordatorio de pago de ${docNumber} al cliente?`, { confirmLabel: 'Enviar' }))) return;
  try {
    const res = await fetch(`${WORKER}/reminders/${encodeURIComponent(docNumber)}/send`, { method: 'POST', headers: { 'X-GAPT-PIN': pin } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo enviar');
    showToast(`\u{2713} Recordatorio #${json.reminderCount || ''} enviado`, '#19A85B');
  } catch (err) {
    showToast('\u{26a0} ' + err.message, '#FF5A1F');
  }
  loadCobranza();
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} FINANCIAL DASHBOARD \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */

async function loadFinancialSummary() {
  const el = document.getElementById('home-fin-summary');
  if (!el) return;
  try {
    const res = await fetch(WORKER + '/reports/summary', { headers: { 'X-GAPT-PIN': pin } });
    const s = await res.json();
    const fmt = n => '$' + Number(n||0).toLocaleString('es-MX', { minimumFractionDigits: 0 });
    const cobEl = document.getElementById('stat-cobros-num');
    if (cobEl) cobEl.textContent = fmt(s.porCobrar);
    const mes = new Date().toLocaleString('es-MX', { month: 'long' });
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:4px">
        <div class="fin-metric"><div class="fin-metric-val green">${fmt(s.cobradoMes)}</div><div class="fin-metric-lbl">Cobrado ${mes}</div></div>
        <div class="fin-metric"><div class="fin-metric-val orange">${fmt(s.porCobrar)}</div><div class="fin-metric-lbl">Por cobrar</div></div>
        <div class="fin-metric"><div class="fin-metric-val red">${fmt(s.gastosMes)}</div><div class="fin-metric-lbl">Gastos ${mes}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
        <div class="fin-metric"><div class="fin-metric-val">${s.facturadasMes}</div><div class="fin-metric-lbl">Facturas ${mes}</div></div>
        <div class="fin-metric"><div class="fin-metric-val green">${fmt(s.cobradoAnio)}</div><div class="fin-metric-lbl">Cobrado ${new Date().getFullYear()}</div></div>
        <div class="fin-metric"><div class="fin-metric-val">${fmt(s.cobradoAnio - s.gastosAnio)}</div><div class="fin-metric-lbl">Utilidad bruta</div></div>
      </div>`;
  } catch { /* silencioso */ }
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} INVOICES \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */

let allInvoices = [];
let allReminders = {};
let invActiveFilter = 'pendiente';

const invDaysSince = ts => Math.floor((Date.now() - (ts || Date.now())) / 86400000);
const INV_VENCIDO_DIAS = 14;
const invEsPendiente = i => ['pendiente','parcial'].includes(i.status);
const invEsVencido = i => invEsPendiente(i) && invDaysSince(i.sentAt) > INV_VENCIDO_DIAS;

// Vista \u{fa}nica de cobranza: documentos por cobrar, su seguimiento y los SPEI por
// confirmar. Antes esto viv\u{ed}a partido en dos pesta\u{f1}as (Cobros / Facturas) sobre los
// mismos documentos, con acciones duplicadas que no coincid\u{ed}an entre s\u{ed}.
async function loadCobranza() {
  const listEl  = document.getElementById('inv-list');
  const agingEl = document.getElementById('inv-aging');
  const statsEl = document.getElementById('inv-stats');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty">Cargando\u{2026}</div>';
  loadSpeis();
  try {
    const [invRes, agingRes, remRes] = await Promise.all([
      fetch(WORKER + '/invoices', { headers: { 'X-GAPT-PIN': pin } }),
      fetch(WORKER + '/reports/aging', { headers: { 'X-GAPT-PIN': pin } }),
      fetch(WORKER + '/reminders', { headers: { 'X-GAPT-PIN': pin } }),
    ]);
    allInvoices = await invRes.json();
    const aging = await agingRes.json();
    const remList = await remRes.json().catch(() => []);
    allReminders = {};
    if (Array.isArray(remList)) for (const r of remList) allReminders[r.docNumber] = r;

    const fmt$ = n => '$' + Number(n||0).toLocaleString('es-MX', { minimumFractionDigits: 0 });
    if (statsEl) {
      const pendientes = allInvoices.filter(invEsPendiente);
      const porCobrar = pendientes.reduce((s,i) => s + (Number(i.total)||0), 0);
      const cobrado = allInvoices.filter(i => i.status === 'pagado').reduce((s,i) => s + (Number(i.paidAmount)||Number(i.total)||0), 0);
      const vencidos = allInvoices.filter(invEsVencido).length;
      statsEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px">
        <div class="fin-metric"><div class="fin-metric-val orange">${fmt$(porCobrar)}</div><div class="fin-metric-lbl">Por cobrar \u{b7} ${pendientes.length} doc${pendientes.length!==1?'s':''}</div></div>
        <div class="fin-metric"><div class="fin-metric-val green">${fmt$(cobrado)}</div><div class="fin-metric-lbl">Total cobrado</div></div>
        <div class="fin-metric"><div class="fin-metric-val${vencidos?' red':''}">${vencidos}</div><div class="fin-metric-lbl">Vencidos +${INV_VENCIDO_DIAS} d\u{ed}as</div></div>
      </div>`;
    }
    if (agingEl && aging.current) {
      const agingFmt = (b, label) => `
        <div class="gcard" style="flex:1;min-width:120px;padding:10px;text-align:center">
          <div style="font-family:monospace;font-size:14px;font-weight:700;color:${b.total > 0 ? 'var(--orange)' : 'var(--muted)'}">${fmt$(b.total)}</div>
          <div style="font-family:monospace;font-size:8px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-top:2px">${label}</div>
          <div style="font-family:monospace;font-size:9px;color:var(--muted)">${b.invoices.length} doc${b.invoices.length !== 1 ? 's' : ''}</div>
        </div>`;
      agingEl.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap">
        ${agingFmt(aging.current,'0\u{2013}30 d\u{ed}as')}${agingFmt(aging.days30,'31\u{2013}60 d\u{ed}as')}
        ${agingFmt(aging.days60,'61\u{2013}90 d\u{ed}as')}${agingFmt(aging.days90,'+90 d\u{ed}as')}
      </div>`;
    }
    renderInvoiceList();
  } catch { listEl.innerHTML = '<div class="empty">Error al cargar cobranza</div>'; }
}

function invFilter(f) {
  invActiveFilter = f;
  document.querySelectorAll('.inv-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  renderInvoiceList();
}

function renderInvoiceList() {
  const el = document.getElementById('inv-list');
  if (!el) return;
  const filtered = allInvoices.filter(i =>
      invActiveFilter === 'todos'    ? true
    : invActiveFilter === 'pendiente' ? invEsPendiente(i)
    : invActiveFilter === 'vencido'   ? invEsVencido(i)
    : i.status === invActiveFilter);
  if (!filtered.length) { el.innerHTML = '<div class="empty">Sin documentos en este filtro</div>'; return; }
  const order = { parcial: 0, pendiente: 1, pagado: 2, cancelado: 3 };
  filtered.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.sentAt||0) - (a.sentAt||0));
  const fmt = n => Number(n||0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  const sc = { pagado:'inv-status-pagado', pendiente:'inv-status-pendiente', parcial:'inv-status-parcial', cancelado:'inv-status-cancelado' };
  el.innerHTML = filtered.map(inv => {
    const id = esc(inv.docNumber);
    const isPending = invEsPendiente(inv);
    const rem = allReminders[inv.docNumber];
    const dias = invDaysSince(inv.sentAt);
    const vencido = invEsVencido(inv);
    // Seguimiento: el cron manda recordatorio cada 4 d\u{ed}as mientras exista el registro.
    const proximo = rem ? Math.max(0, 4 - invDaysSince(rem.lastReminderAt)) : null;
    const segLinea = !isPending ? ''
      : rem ? `${rem.reminderCount||0} recordatorio${(rem.reminderCount||0)!==1?'s':''} \u{b7} pr\u{f3}ximo en ${proximo} d\u{ed}a${proximo!==1?'s':''}`
            : 'Sin recordatorios autom\u{e1}ticos';
    return `
    <div class="gcard" style="padding:14px;margin-bottom:8px${vencido ? ';border-left:3px solid var(--bad)' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap">
            <span style="font-family:monospace;font-size:11px;font-weight:700;color:var(--cream)">${id}</span>
            <span class="inv-status-badge ${sc[inv.status]||'inv-status-pendiente'}">${inv.status}</span>
            ${vencido?`<span class="inv-status-badge" style="border-color:var(--bad);color:var(--bad)">vencido ${dias}d</span>`:''}
            <span style="font-family:monospace;font-size:9px;color:var(--muted)">${esc(inv.tipoLabel||'')}</span>
          </div>
          <div style="font-size:12px;color:var(--muted)">${esc(inv.clientName)}</div>
          <div style="font-family:monospace;font-size:9px;color:var(--muted);margin-top:1px">${esc(inv.clientEmail||'')} \u{b7} ${inv.fecha||''}</div>
          ${segLinea?`<div style="font-family:monospace;font-size:9px;color:var(--muted);margin-top:3px">\u{21bb} ${segLinea}</div>`:''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:monospace;font-size:15px;font-weight:700;color:var(--orange)">$${fmt(inv.total)}</div>
          ${inv.status==='parcial'?`<div style="font-family:monospace;font-size:9px;color:#F59E0B">Pagado: $${fmt(inv.paidAmount)}</div>`:''}
          ${inv.paidAt?`<div style="font-family:monospace;font-size:9px;color:var(--muted)">${new Date(inv.paidAt).toLocaleDateString('es-MX')}</div>`:''}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:8px;border-top:1px solid var(--border)">
        ${isPending?`<button onclick="invRecordPayment('${id}')" class="rem-action-btn rem-action-paid">Registrar pago</button>`:''}
        ${isPending?`<button onclick="remSendNow('${id}')" class="rem-action-btn">Enviar recordatorio</button>`:''}
        ${isPending&&!inv.stripeInvoiceId?`<button onclick="invLinkStripe('${id}')" class="rem-action-btn">Generar link de pago</button>`:''}
        ${inv.paymentUrl?`<a href="${esc(inv.paymentUrl)}" target="_blank" class="rem-action-btn" style="text-decoration:none;padding:7px 12px">Link \u{2192}</a>`:''}
        ${isPending?`<button onclick="invSendStatement('${esc(inv.clientEmail||'')}','${esc(inv.clientName||'')}')" class="rem-action-btn">Estado de cuenta</button>`:''}
        ${isPending?`<button onclick="invDownloadStatement('${esc(inv.clientEmail||'')}','${esc(inv.clientName||'')}')" class="rem-action-btn">Descargar PDF</button>`:''}
        <button onclick="invChangeStatus('${id}')" class="rem-action-btn">Cambiar estado</button>
        ${isPending&&rem?`<button onclick="remPause('${id}')" class="rem-action-btn">Pausar recordatorios</button>`:''}
        <button onclick="invDelete('${id}')" class="rem-action-btn rem-action-stop">Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

async function invDelete(docNumber) {
  if (!(await gConfirm(`\u{bf}Eliminar ${docNumber} de cobranza? Se borra el registro, su seguimiento y el PDF guardado.`, { confirmLabel: 'Eliminar', danger: true }))) return;
  await fetch(`${WORKER}/invoices/${encodeURIComponent(docNumber)}`, { method: 'DELETE', headers: { 'X-GAPT-PIN': pin } });
  loadCobranza(); loadFinancialSummary();
}

async function invRecordPayment(docNumber) {
  const inv = allInvoices.find(i => i.docNumber === docNumber);
  const payment = await gPaymentPrompt(docNumber, inv?.total);
  if (!payment) return;
  await fetch(`${WORKER}/invoices/${encodeURIComponent(docNumber)}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
    body: JSON.stringify({ paidAmount: payment.amount, paidMethod: payment.method }),
  });
  loadCobranza(); loadFinancialSummary();
}

async function invChangeStatus(docNumber) {
  const status = await gChoice('Cambiar estado.', `Documento ${docNumber}`, [
    { value: 'pendiente', label: 'Pendiente' },
    { value: 'pagado', label: 'Pagado' },
    { value: 'cancelado', label: 'Cancelado' },
    { value: 'parcial', label: 'Pago parcial' },
  ]);
  if (!status) return;
  await fetch(`${WORKER}/invoices/${encodeURIComponent(docNumber)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
    body: JSON.stringify({ status }),
  });
  loadCobranza(); loadFinancialSummary();
}

async function invLinkStripe(docNumber) {
  try {
    const res = await fetch(`${WORKER}/invoices/${encodeURIComponent(docNumber)}/stripe-invoice`, {
      method: 'POST',
      headers: { 'X-GAPT-PIN': pin },
    });
    const json = await res.json();
    if (!res.ok || !json.paymentUrl) throw new Error(json.error || 'Error desconocido');
    showToast('\u{2713} Link de pago generado \u{2014} no se envi\u{f3} ning\u{fa}n correo.', '#19A85B');
    loadCobranza();
  } catch (err) {
    showToast('\u{26a0} ' + err.message, '#FF5A1F');
  }
}

async function generateStatementPDF(invoices, clientName, clientEmail) {
  const fmt = n => Number(n||0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  const today = new Date().toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });
  document.getElementById('stmt-fecha').textContent = today;
  document.getElementById('stmt-generated').textContent = today;
  document.getElementById('stmt-client-name').textContent = clientName || clientEmail;
  document.getElementById('stmt-client-email').textContent = clientEmail;

  const total = invoices.reduce((s, i) => s + (Number(i.total)||0), 0);
  document.getElementById('stmt-total').textContent = '$' + fmt(total);

  await facLoadLibs();

  const wrap = document.getElementById('stmt-sheet-wrap');
  const sheet = document.getElementById('stmt-sheet');
  const tbody = document.getElementById('stmt-rows');
  const overflowNote = document.getElementById('stmt-overflow-note');
  const sheetW = 816;
  const letterH = Math.round(sheetW * 11 / 8.5);
  const dpiScale = Math.ceil(5100 / sheetW);

  wrap.style.left = '0';
  wrap.style.top = '0';
  wrap.style.overflow = 'visible';
  sheet.style.width = sheetW + 'px';
  sheet.style.height = letterH + 'px';
  sheet.style.minHeight = 'unset';

  // Descripci\u{f3}n must summarize what the charge is FOR \u{2014} inv.notas is a free-text
  // remarks field (often payment conditions/legal boilerplate typed on the original
  // document) and was showing up verbatim in this column, which reads as nonsense
  // next to a specific invoice. Use the actual line-item concepts instead.
  function descFor(inv) {
    const concepts = (inv.items || []).map(it => it.concepto).filter(Boolean).join(', ');
    return concepts || inv.tipoLabel || '';
  }

  function renderRows(list, padY, fontSize) {
    tbody.innerHTML = list.map((inv, i) => `
      <tr style="background:${i%2===0?'#FAFAF8':'#fff'}">
        <td style="padding:${padY}px 6px;font-family:monospace;font-size:${fontSize}px;color:#161310">${esc(inv.docNumber)}</td>
        <td style="padding:${padY}px 6px;font-size:${fontSize}px;color:#161310">${esc(inv.tipoLabel||'')}</td>
        <td style="padding:${padY}px 6px;font-family:monospace;font-size:${fontSize}px;color:#6E665B">${esc(inv.fecha||'')}</td>
        <td style="padding:${padY}px 6px;font-size:${fontSize}px;color:#6E665B">${esc(descFor(inv).slice(0,60))}</td>
        <td style="padding:${padY}px 6px;font-family:monospace;font-size:${fontSize}px;text-align:right;color:#161310">$${fmt(inv.subtotal||0)}</td>
        <td style="padding:${padY}px 6px;font-family:monospace;font-size:${fontSize}px;text-align:right;color:#6E665B">$${fmt(inv.iva||0)}</td>
        <td style="padding:${padY}px 6px;font-family:monospace;font-size:${Math.max(fontSize,8)}px;font-weight:700;text-align:right;color:#161310">$${fmt(inv.total)}</td>
        <td style="padding:${padY}px 6px;font-family:monospace;font-size:${Math.max(fontSize-1,6)}px;text-align:center;color:${inv.status==='parcial'?'#B45309':'#6E665B'}">${inv.status==='parcial'?'PARCIAL':'PENDIENTE'}</td>
      </tr>`).join('');
  }

  // Fit-to-one-page: start at a comfortable size, shrink rows if the list is long,
  // and only as a last resort (even the smallest legible size still overflows)
  // truncate the tail and say so explicitly \u{2014} never silently crop documents off
  // the page, which is what a fixed-height capture used to do.
  let rowsToShow = invoices;
  let padY = 9, fontSize = 9.5;
  let hiddenCount = 0, hiddenTotal = 0;
  overflowNote.style.display = 'none';
  renderRows(rowsToShow, padY, fontSize);
  void sheet.offsetHeight;
  const fits = () => sheet.scrollHeight <= letterH;

  while (!fits() && (padY > 2 || fontSize > 6.5)) {
    padY = Math.max(2, padY - 1);
    fontSize = Math.max(6.5, fontSize - 0.5);
    renderRows(rowsToShow, padY, fontSize);
    void sheet.offsetHeight;
  }
  while (!fits() && rowsToShow.length > 1) {
    const dropped = rowsToShow[rowsToShow.length - 1];
    hiddenCount++; hiddenTotal += Number(dropped.total) || 0;
    rowsToShow = rowsToShow.slice(0, -1);
    renderRows(rowsToShow, padY, fontSize);
    void sheet.offsetHeight;
  }
  document.getElementById('stmt-count').textContent = `${invoices.length} documento${invoices.length !== 1 ? 's' : ''} pendiente${invoices.length !== 1 ? 's' : ''}`;
  if (hiddenCount > 0) {
    overflowNote.textContent = `+ ${hiddenCount} documento${hiddenCount !== 1 ? 's' : ''} adicional${hiddenCount !== 1 ? 'es' : ''} por $${fmt(hiddenTotal)} \u{2014} ver detalle completo en GAPT One.`;
    overflowNote.style.display = 'block';
    void sheet.offsetHeight;
  }

  let canvas;
  try {
    canvas = await html2canvas(sheet, {
      scale: dpiScale, useCORS: true, logging: false,
      backgroundColor: '#fff', width: sheetW, height: letterH,
      scrollX: 0, scrollY: 0,
    });
  } finally {
    wrap.style.left = '-9999px';
    wrap.style.overflow = 'hidden';
    sheet.style.height = '';
    sheet.style.minHeight = '';
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, pageH);
  return pdf.output('datauristring').split(',')[1];
}

async function invSendStatement(clientEmail, clientName) {
  const pending = allInvoices.filter(i => i.clientEmail === clientEmail && ['pendiente','parcial'].includes(i.status));
  if (!pending.length) { showToast('\u{26a0} Este cliente no tiene documentos pendientes', '#FF5A1F'); return; }
  if (!(await gConfirm(`\u{bf}Enviar estado de cuenta a ${clientEmail}? ${pending.length} documento(s) pendientes.`, { confirmLabel: 'Enviar' }))) return;
  let pdfBase64 = null;
  try {
    pdfBase64 = await generateStatementPDF(pending, clientName, clientEmail);
  } catch(e) {
    console.error('PDF stmt error', e);
    if (!(await gConfirm(`No se pudo generar el PDF (${e.message}). \u{bf}Enviar el correo sin adjunto?`, { confirmLabel: 'Enviar sin PDF' }))) return;
  }
  const res = await fetch(`${WORKER}/clients/statement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
    body: JSON.stringify({ clientEmail, clientName, pdfBase64 }),
  });
  const d = await res.json();
  if (d.ok) showToast(`\u{2713} Enviado con PDF adjunto \u{2014} ${d.count} doc(s), $${Number(d.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})}`, '#19A85B');
  else showToast('\u{26a0} ' + (d.error || 'Error al enviar'), '#FF5A1F');
}

async function invDownloadStatement(clientEmail, clientName) {
  const pending = allInvoices.filter(i => i.clientEmail === clientEmail && ['pendiente','parcial'].includes(i.status));
  if (!pending.length) { showToast('\u{26a0} Sin documentos pendientes', '#FF5A1F'); return; }
  const b64 = await generateStatementPDF(pending, clientName, clientEmail);
  const link = document.createElement('a');
  link.href = 'data:application/pdf;base64,' + b64;
  link.download = `estado-cuenta-${(clientName||clientEmail).replace(/\s+/g,'-')}.pdf`;
  link.click();
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} EXPENSES \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */

async function loadExpenses() {
  const listEl = document.getElementById('exp-list');
  const sumEl  = document.getElementById('exp-summary');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty">Cargando\u{2026}</div>';
  document.getElementById('exp-fecha').value = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(WORKER + '/expenses', { headers: { 'X-GAPT-PIN': pin } });
    const list = await res.json();
    if (sumEl) {
      const mes = new Date().getMonth();
      const anio = new Date().getFullYear();
      const esMes = e => { const d = new Date(e.fecha); return d.getMonth()===mes && d.getFullYear()===anio; };
      const totalMes  = list.filter(esMes).reduce((s,e) => s+(Number(e.monto)||0), 0);
      const totalAnio = list.filter(e => new Date(e.fecha).getFullYear()===anio).reduce((s,e) => s+(Number(e.monto)||0), 0);
      const cats = {};
      list.filter(esMes).forEach(e => { cats[e.categoria]=(cats[e.categoria]||0)+(Number(e.monto)||0); });
      const topCat = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,3);
      const fmt = n => '$'+Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:0});
      sumEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div class="fin-metric"><div class="fin-metric-val red">${fmt(totalMes)}</div><div class="fin-metric-lbl">Gastos este mes</div></div>
          <div class="fin-metric"><div class="fin-metric-val">${fmt(totalAnio)}</div><div class="fin-metric-lbl">Gastos ${anio}</div></div>
        </div>
        ${topCat.length?`<div style="font-family:monospace;font-size:9px;color:var(--muted);margin-bottom:12px">Top: ${topCat.map(([c,v])=>`${c} ${fmt(v)}`).join(' \u{b7} ')}</div>`:''}`;
    }
    if (!list.length) { listEl.innerHTML = '<div class="empty">Sin gastos registrados</div>'; return; }
    const fmt = n => Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2});
    listEl.innerHTML = list.map(e => `
      <div class="gcard" style="padding:12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="min-width:0">
          <div style="font-size:12px;color:var(--cream);margin-bottom:2px">${esc(e.descripcion)}</div>
          <div style="font-family:monospace;font-size:9px;color:var(--muted)">${e.fecha} \u{b7} <span style="color:var(--orange)">${esc(e.categoria)}</span>${e.proveedor?` \u{b7} ${esc(e.proveedor)}`:''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <div style="font-family:monospace;font-size:13px;font-weight:700;color:var(--bad)">\u{2212}$${fmt(e.monto)}</div>
          <button onclick="expDelete('${esc((e.id||'').replace('expense:',''))}')" style="font-family:monospace;font-size:10px;background:none;border:none;color:var(--muted);cursor:pointer;padding:4px">\u{2715}</button>
        </div>
      </div>`).join('');
  } catch { listEl.innerHTML = '<div class="empty">Error al cargar gastos</div>'; }
}

async function expCreate() {
  const fecha = document.getElementById('exp-fecha').value;
  const monto = document.getElementById('exp-monto').value;
  const desc  = document.getElementById('exp-desc').value.trim();
  const cat   = document.getElementById('exp-cat').value;
  const prov  = document.getElementById('exp-prov').value.trim();
  const errEl = document.getElementById('exp-create-err');
  errEl.style.display = 'none';
  if (!fecha||!monto||!desc) { errEl.textContent='Fecha, monto y descripci\u{f3}n son requeridos'; errEl.style.display='block'; return; }
  await fetch(WORKER+'/expenses', {
    method:'POST', headers:{'Content-Type':'application/json','X-GAPT-PIN':pin},
    body: JSON.stringify({ fecha, monto:Number(monto), descripcion:desc, categoria:cat, proveedor:prov }),
  });
  ['exp-monto','exp-desc','exp-prov'].forEach(id => { document.getElementById(id).value=''; });
  loadExpenses(); loadFinancialSummary();
}

async function expDelete(id) {
  if (!(await gConfirm('\u{bf}Eliminar este gasto?', { confirmLabel: 'Eliminar', danger: true }))) return;
  await fetch(`${WORKER}/expenses/${encodeURIComponent(id)}`, { method:'DELETE', headers:{'X-GAPT-PIN':pin} });
  loadExpenses(); loadFinancialSummary();
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} RECURRING INVOICES \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */

async function loadRecurring() {
  const el = document.getElementById('rec-list');
  if (!el) return;
  el.innerHTML = '<div class="empty">Cargando\u{2026}</div>';
  try {
    const res = await fetch(WORKER+'/recurring', { headers:{'X-GAPT-PIN':pin} });
    const list = await res.json();
    if (!list.length) { el.innerHTML='<div class="empty">Sin facturas recurrentes</div>'; return; }
    const fmt = n => Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2});
    const freqLabel = { mensual:'Mensual',bimestral:'Bimestral',trimestral:'Trimestral',semestral:'Semestral',anual:'Anual' };
    el.innerHTML = list.map(r => {
      const rid = esc((r.id||'').replace('recurring:',''));
      return `
      <div class="gcard" style="padding:14px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--cream);margin-bottom:3px">${esc(r.clientName)}</div>
            <div style="font-family:monospace;font-size:9px;color:var(--muted)">${esc(r.clientEmail)} \u{b7} ${freqLabel[r.frecuencia]||r.frecuencia}</div>
            ${r.concepto?`<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(r.concepto)}</div>`:''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-family:monospace;font-size:15px;font-weight:700;color:var(--orange)">$${fmt(r.total)}</div>
            ${r.lastGeneratedAt?`<div style="font-family:monospace;font-size:9px;color:var(--muted)">\u{da}ltimo: ${new Date(r.lastGeneratedAt).toLocaleDateString('es-MX')}</div>`:''}
            ${r.pendingGeneration?`<div style="font-family:monospace;font-size:9px;color:#F59E0B">\u{26a0} Revisar en Facturas</div>`:''}
          </div>
        </div>
        <div style="padding-top:8px;border-top:1px solid var(--border)">
          <button onclick="recDelete('${rid}')" class="rem-action-btn rem-action-stop">Eliminar</button>
        </div>
      </div>`;
    }).join('');
  } catch { el.innerHTML='<div class="empty">Error al cargar recurrentes</div>'; }
}

async function recCreate() {
  const nombre   = document.getElementById('rec-nombre').value.trim();
  const email    = document.getElementById('rec-email').value.trim();
  const tipo     = document.getElementById('rec-tipo').value.trim()||'Nota de cobro';
  const total    = document.getElementById('rec-total').value;
  const freq     = document.getElementById('rec-freq').value;
  const concepto = document.getElementById('rec-concepto').value.trim();
  const errEl    = document.getElementById('rec-create-err');
  errEl.style.display='none';
  if (!nombre||!email||!total) { errEl.textContent='Nombre, email y total son requeridos'; errEl.style.display='block'; return; }
  await fetch(WORKER+'/recurring', {
    method:'POST', headers:{'Content-Type':'application/json','X-GAPT-PIN':pin},
    body: JSON.stringify({ clientName:nombre, clientEmail:email, tipoLabel:tipo, total:Number(total), frecuencia:freq, concepto }),
  });
  ['rec-nombre','rec-email','rec-tipo','rec-total','rec-concepto'].forEach(id => { document.getElementById(id).value=''; });
  loadRecurring();
}

async function recDelete(id) {
  if (!(await gConfirm('\u{bf}Eliminar esta factura recurrente?', { confirmLabel: 'Eliminar', danger: true }))) return;
  await fetch(`${WORKER}/recurring/${encodeURIComponent(id)}`, { method:'DELETE', headers:{'X-GAPT-PIN':pin} });
  loadRecurring();
}

async function loadCfdi() {
  try {
    const res = await fetch(WORKER + '/cfdi/requests', { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) throw new Error();
    cfdiData = await res.json();
    updateStats(); renderCfdi(); renderHomeCfdi();
  } catch {
    document.getElementById('cfdi-list').innerHTML = '<div class="empty">Error al cargar solicitudes</div>';
  }
}

async function loadEntregas() {
  try {
    const res = await fetch(WORKER + '/entregas/list', { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) throw new Error();
    entData = await res.json();
    updateStats(); renderHomeEntregas();
  } catch {
    document.getElementById('home-ent-list').innerHTML = '<div class="empty">Error al cargar entregas</div>';
  }
}

function updateStats() {
  document.getElementById('stat-cfdi-num').textContent = cfdiData.filter(c => c.status === 'pending').length;
  document.getElementById('stat-ent-num').textContent = entData.filter(e => e.expiresAt > Date.now()).length;
}

/* \u{2500}\u{2500} HOME FEED (read-only summaries) \u{2500}\u{2500} */
function renderHomeCfdi() {
  const el = document.getElementById('home-cfdi-list');
  const list = cfdiData.slice(0, 4);
  if (!list.length) { el.innerHTML = '<div class="empty">Sin solicitudes</div>'; return; }
  el.innerHTML = list.map(c => cfdiCard(c)).join('') +
    `<button class="fac-btn-sm" onclick="switchTab('cfdi')" style="margin-top:6px">Ver todas \u{2192}</button>`;
}

function renderHomeEntregas() {
  const el = document.getElementById('home-ent-list');
  if (!entData.length) { el.innerHTML = '<div class="empty">Sin entregas</div>'; return; }
  const now = Date.now();
  const rows = entData.slice(0, 5).map(e => {
    const expired = e.expiresAt < now;
    const main = e.contacts?.find(c => c.main) || e.contacts?.[0] || {};
    const downloaded = !expired && e.downloadedAt;
    let statusLabel, statusClass;
    if (expired) { statusLabel = '\u{2715} Expirada'; statusClass = ''; }
    else if (e.status === 'pending') { statusLabel = '\u{21bb} Programada'; statusClass = 'pending'; }
    else if (downloaded) { statusLabel = '\u{2193} Descargada'; statusClass = 'sent'; }
    else { statusLabel = '\u{2713} Enviada'; statusClass = 'sent'; }
    return `<div class="ent-row">
      <div class="ent-info"><div class="ent-name">${esc(e.filename)}</div><div class="ent-meta">${esc(main.name || '\u{2014}')} \u{b7} ${timeAgo(e.createdAt)}</div></div>
      <span class="ent-status ${statusClass}">${statusLabel}</span>
    </div>`;
  });
  el.innerHTML = rows.join('') + `<button class="fac-btn-sm" onclick="switchTab('entregas')" style="margin-top:6px">Ver todas \u{2192}</button>`;
}

/* \u{2500}\u{2500} CFDI TAB \u{2500}\u{2500} */
function setCfdiFilter(f) {
  cfdiFilter = f;
  document.querySelectorAll('#tab-cfdi .ftab').forEach(t => t.classList.toggle('active', t.dataset.f === f));
  renderCfdi();
}

function renderCfdi() {
  const list = cfdiFilter === 'all' ? cfdiData : cfdiData.filter(c => c.status === cfdiFilter);
  const el = document.getElementById('cfdi-list');
  if (!list.length) { el.innerHTML = '<div class="empty">Sin solicitudes' + (cfdiFilter !== 'all' ? ' en este filtro' : '') + '</div>'; return; }
  el.innerHTML = list.map(c => cfdiCard(c)).join('');
}

let cfdiActiveRequestId = null;

function cfdiCard(c) {
  const badgeClass = { pending: 'pending', in_progress: 'in_progress', done: 'done' }[c.status] || 'pending';
  const badgeLabel = { pending: '\u{25cf} Pendiente', in_progress: '\u{21bb} En proceso', done: '\u{2713} Atendida' }[c.status] || 'Pendiente';
  const montoStr = c.monto ? '$' + Number(c.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 }) + ' MXN' : '';
  const hasLinkedDoc = c.folio && facLsGet(FAC_LS_DOCS, []).some(d => d.folio === c.folio);
  return `<div class="cfdi-card" id="cfdi-${c.id}">
    <div class="cfdi-card-head">
      <div>
        <div class="cfdi-rfc">${esc(c.rfc)}</div>
        <div class="cfdi-razon">${esc(c.razon)}</div>
        <div class="cfdi-meta">${c.solFolio ? esc(c.solFolio) + ' \u{b7} ' : ''}${c.folio ? esc(c.folio) + (montoStr ? ' \u{b7} ' : '') : ''}${montoStr}<br><a href="mailto:${esc(c.correo)}">${esc(c.correo)}</a></div>
      </div>
      <span class="status-badge ${badgeClass}">${badgeLabel}</span>
    </div>
    ${c.cfdiUuid ? `<div class="cfdi-notas">\u{1f9fe} CFDI enviado \u{b7} UUID <span class="mono">${esc(c.cfdiUuid)}</span>${c.cfdiSummary ? `<br>${cfdiFmtMoney(c.cfdiSummary.total)} \u{b7} Timbrado ${cfdiFmtFecha(c.cfdiSummary.fechaTimbrado)}${c.cfdiSummary.ivaRetenido || c.cfdiSummary.isrRetenido ? ` \u{b7} Ret. IVA ${cfdiFmtMoney(c.cfdiSummary.ivaRetenido)} \u{b7} Ret. ISR ${cfdiFmtMoney(c.cfdiSummary.isrRetenido)}` : ''}` : ''}</div>` : ''}
    <div class="cfdi-time">${timeAgo(c.createdAt)}</div>
    <div class="cfdi-actions">
      <button class="cfdi-btn primary" onclick="uploadCfdiForRequest('${c.id}')">\u{1f9fe} ${c.cfdiUuid ? 'Reenviar' : 'Subir'} CFDI</button>
      ${hasLinkedDoc ? `<button class="cfdi-btn" onclick="cfdiPreviewDoc('${esc(c.folio)}')">\u{1f441} Ver documento</button>` : ''}
      <button class="cfdi-btn" onclick="openReply('${c.id}')">\u{2709} Responder</button>
      ${c.status !== 'in_progress' ? `<button class="cfdi-btn" onclick="setStatus('${c.id}','in_progress')">\u{21bb} En proceso</button>` : ''}
      ${c.status !== 'done' ? `<button class="cfdi-btn" onclick="setStatus('${c.id}','done')">\u{2713} Marcar atendida</button>` : ''}
      ${c.status === 'done' ? `<button class="cfdi-btn" onclick="setStatus('${c.id}','pending')">\u{21a9} Reabrir</button>` : ''}
      <button class="cfdi-btn danger" onclick="deleteCfdiRequest('${c.id}')">\u{1f5d1} Eliminar</button>
    </div>
  </div>`;
}

async function deleteCfdiRequest(id) {
  const c = cfdiData.find(x => x.id === id);
  if (!(await gConfirm(`\u{bf}Eliminar la solicitud de CFDI de ${c ? c.razon : 'este cliente'} permanentemente? Esto tambi\u{e9}n borra el XML/PDF archivados.`, { confirmLabel: 'Eliminar', danger: true }))) return;
  await fetch(`${WORKER}/cfdi/delete/${id}`, { method: 'DELETE', headers: { 'X-GAPT-PIN': pin } });
  cfdiData = cfdiData.filter(x => x.id !== id);
  updateStats(); renderCfdi(); renderHomeCfdi();
  showToast('\u{2713} Solicitud eliminada', '#19A85B');
}

function cfdiPreviewDoc(folio) {
  const doc = facLsGet(FAC_LS_DOCS, []).find(d => d.folio === folio);
  if (!doc) { showToast('\u{26a0} No se encontr\u{f3} el documento ' + folio, '#FF5A1F'); return; }
  const t = FAC_TIPOS[doc.tipo] || { nombre: doc.tipo, cliLabel: '_ Para', legal: '' };
  const old = facDoc; facDoc = doc; const calc = facCalc(); facDoc = old;
  const fechaTxt = doc.fecha ? new Date(doc.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'}) : '';
  const conceptosHtml = (doc.conceptos||[]).filter(c=>c.desc||c.pu).map((c,i) => `
    <tr><td class="mono" style="font-size:9px;color:#6E665B">${String(i+1).padStart(2,'0')}</td><td>${esc(c.desc)}</td>
    <td class="r mono">${c.cant}</td><td>${esc(c.unidad)}</td><td class="r mono">${facFmt(c.pu)}</td><td class="r mono">${facFmt(c.cant*c.pu||0)}</td></tr>`).join('')
    || `<tr><td colspan="6" style="color:#9B968C;padding:16px;text-align:center">Sin conceptos</td></tr>`;
  let totalesHtml = `<div class="row"><span>Subtotal</span><span>${facFmt(calc.subtotal)}</span></div>`;
  if (calc.desc>0) totalesHtml += `<div class="row"><span>Descuento</span><span>\u{2212}${facFmt(calc.desc)}</span></div>`;
  if (doc.iva) totalesHtml += `<div class="row"><span>IVA 16%</span><span>${facFmt(calc.iva)}</span></div>`;
  totalesHtml += `<div class="row total"><span>Total MXN</span><span>${facFmt(calc.total)}</span></div>`;
  const cfg = facLsGet(FAC_LS_CFG, {});

  document.getElementById('cfdi-preview-content').innerHTML = `
    <div class="fac-sheet" style="margin:0 auto">
      <div class="fac-sheet__grad"></div>
      <div class="fac-sheet__head">
        <div class="fac-sheet__mark">
          <span class="lock"><svg viewBox="0 0 100 100" shape-rendering="crispEdges" aria-hidden="true"><rect width="100" height="100" fill="#FF5A1F"/><rect x="57" width="6" height="100" fill="#FFFFFF"/></svg><span class="gapt">GAPT<i class="stop"></i></span></span>
          <span class="sub">THE PROJECT \u{b7} NO TWO ALIKE</span>
        </div>
        <div class="fac-sheet__doc">
          <div class="tipo">${esc(t.nombre)}</div>
          <div class="folio">${esc(doc.folio)}</div>
          <div class="meta">FECHA \u{b7} ${esc(fechaTxt)}</div>
        </div>
      </div>
      <div class="fac-sheet__parties">
        <div class="fac-sheet__party">
          <h4>_ Emite</h4>
          <div class="nm">${esc(cfg.nombre || 'Gustavo A. Pastrana T.')}</div>
          <p>THE GAPT PROJECT \u{b7} Cuernavaca, Morelos \u{b7} MX<br>hello@thegaptproject.com</p>
        </div>
        <div class="fac-sheet__party">
          <h4>${esc(t.cliLabel)}</h4>
          <div class="nm">${esc(doc.cliente?.nombre || '\u{2014}')}</div>
          <p>${[doc.cliente?.rfc && 'RFC: '+esc(doc.cliente.rfc), esc(doc.cliente?.dir), esc(doc.cliente?.mail)].filter(Boolean).join('<br>')}</p>
        </div>
      </div>
      <table>
        <thead><tr><th style="width:24px">#</th><th>Concepto</th><th class="r" style="width:44px">Cant.</th><th style="width:56px">Unidad</th><th class="r" style="width:74px">P. Unit.</th><th class="r" style="width:84px">Importe</th></tr></thead>
        <tbody>${conceptosHtml}</tbody>
      </table>
      <div class="totales">${totalesHtml}</div>
      ${doc.notas ? `<div class="fac-sheet__notes"><h5>_ Notas</h5><p>${esc(doc.notas)}</p></div>` : ''}
      <div class="fac-sheet__legal">${esc(t.legal||'')}</div>
      <div class="fac-sheet__foot"><span>thegaptproject.com</span><span>hello@thegaptproject.com</span><span>Status: ${esc(doc.status)}</span></div>
    </div>
  `;
  document.getElementById('cfdi-preview-modalBg').classList.add('show');
}

async function uploadCfdiForRequest(reqId) {
  const c = cfdiData.find(x => x.id === reqId);
  if (!c) return;
  cfdiActiveRequestId = reqId;
  switchTab('cfdi');
  const banner = document.getElementById('cfdi-xml-context');

  // \u{bf}Ya se mand\u{f3} un CFDI antes para esta solicitud? Recupera el XML archivado en vez de pedir subirlo otra vez
  if (c.cfdiUuid) {
    try {
      const res = await fetch(`${WORKER}/cfdi/archive/${reqId}`, { headers: { 'X-GAPT-PIN': pin } });
      const json = await res.json();
      if (res.ok && json.xmlText) {
        cfdiRawXmlText = json.xmlText;
        const data = cfdiParseXml(json.xmlText);
        cfdiRepData = data;
        cfdiRenderRep(data);
        document.getElementById('cfdi-rep-wrap').style.display = 'block';
        await cfdiRenderQr(data);
        document.getElementById('cfdi-xml-download').style.display = 'block';
        document.getElementById('cfdi-xml-download-full').style.display = 'block';
        if (banner) { banner.textContent = `_ Reenviando CFDI archivado para: ${c.razon} (${c.rfc}) \u{2192} ${c.correo}`; banner.classList.add('show'); }
        cfdiShowSendButton();
        document.getElementById('cfdi-rep-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    } catch(_) {}
  }

  if (banner) {
    banner.textContent = `_ Subiendo CFDI para: ${c.razon} (${c.rfc}) \u{2192} se enviar\u{e1} a ${c.correo}`;
    banner.classList.add('show');
  }
  document.getElementById('cfdi-xml-drop').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function setStatus(id, status) {
  const card = document.getElementById('cfdi-' + id);
  if (card) card.style.opacity = '.5';
  await fetch(`${WORKER}/cfdi/status/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin }, body: JSON.stringify({ status }) });
  const idx = cfdiData.findIndex(c => c.id === id);
  if (idx >= 0) cfdiData[idx].status = status;
  updateStats(); renderCfdi(); renderHomeCfdi();
}

function openReply(id) {
  activeReplyId = id;
  const c = cfdiData.find(x => x.id === id);
  if (!c) return;
  document.getElementById('reply-info').innerHTML = `<strong>${esc(c.razon)}</strong><br>${esc(c.rfc)} \u{b7} ${esc(c.correo)}` + (c.folio ? `<br>Ref: ${esc(c.folio)}` : '');
  const montoStr = c.monto ? `$${Number(c.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN` : '';
  document.getElementById('reply-msg').value = `Hola,\n\nHemos procesado tu solicitud de CFDI${c.folio ? ' (referencia: ' + c.folio + ')' : ''}${montoStr ? ' por ' + montoStr : ''}.\n\nTu factura ha sido emitida y enviada a ${c.correo}. Si no la recibes en los pr\u{f3}ximos minutos, revisa tu carpeta de spam.\n\nCualquier duda estamos a tus \u{f3}rdenes.\n\nTHE GAPT PROJECT`;
  document.getElementById('reply-status').textContent = '';
  document.getElementById('reply-send').disabled = false;
  document.getElementById('reply-send').textContent = 'Enviar y marcar atendida \u{2192}';
  document.getElementById('reply-modal').classList.remove('hidden');
}
function closeReply() { document.getElementById('reply-modal').classList.add('hidden'); activeReplyId = null; }

async function sendReply() {
  if (!activeReplyId) return;
  const message = document.getElementById('reply-msg').value.trim();
  if (!message) { document.getElementById('reply-status').textContent = 'Escribe un mensaje.'; return; }
  const btn = document.getElementById('reply-send');
  btn.disabled = true; btn.textContent = 'Enviando\u{2026}';
  document.getElementById('reply-status').textContent = '';
  try {
    const res = await fetch(`${WORKER}/cfdi/reply/${activeReplyId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin }, body: JSON.stringify({ message }) });
    if (!res.ok) throw new Error();
    const idx = cfdiData.findIndex(c => c.id === activeReplyId);
    if (idx >= 0) cfdiData[idx].status = 'done';
    updateStats(); renderCfdi(); renderHomeCfdi(); closeReply();
  } catch {
    document.getElementById('reply-status').textContent = 'Error al enviar. Intenta de nuevo.';
    btn.disabled = false; btn.textContent = 'Enviar y marcar atendida \u{2192}';
  }
}

/* \u{2500}\u{2500} AUTO-REFRESH \u{2500}\u{2500} */
let refreshInterval = null, lastRefresh = null;
function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => { await loadAll(); lastRefresh = Date.now(); updateRefreshLabel(); }, 60000);
}
function updateRefreshLabel() {}

/* \u{2500}\u{2500} PUSH NOTIFICATIONS \u{2500}\u{2500} */
function b64urlToUint8(base64url) {
  const b = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b.padEnd(b.length + (4 - b.length % 4) % 4, '=')), c => c.charCodeAt(0));
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/one/sw.js', { scope: '/one/' });
    swReg = await navigator.serviceWorker.ready;
  } catch (e) { console.warn('[SW] register failed:', e.message); }
}

async function setupPush() {
  if (!('PushManager' in window)) return;
  if (!swReg) swReg = await navigator.serviceWorker.ready.catch(() => null);
  if (!swReg) return;
  if (VAPID_PUBLIC_KEY === 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY') return;
  const perm = Notification.permission;
  if (perm === 'denied') return;
  if (perm === 'granted') { await subscribePush(); }
  else if (!sessionStorage.getItem('push-banner-dismissed')) {
    document.getElementById('push-banner').classList.remove('hidden');
  }
}

async function requestPush() {
  document.getElementById('push-banner').classList.add('hidden');
  const perm = await Notification.requestPermission();
  if (perm === 'granted') await subscribePush(true);
}

function dismissPushBanner() {
  document.getElementById('push-banner').classList.add('hidden');
  sessionStorage.setItem('push-banner-dismissed', '1');
}

async function subscribePush(force = false) {
  try {
    const reg = swReg || await navigator.serviceWorker.ready;
    if (!reg || !pin) return;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      if (!force) { await saveSubscription(existing); return; }
      await existing.unsubscribe();
    }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToUint8(VAPID_PUBLIC_KEY) });
    await saveSubscription(sub);
    showToast('\u{2713} Notificaciones activadas', '#19A85B');
  } catch (e) {
    console.error('[PUSH] subscribe failed:', e.message);
    showToast('\u{26a0} Push: ' + e.message, '#FF5A1F');
  }
}

function showToast(msg, bg) {
  let el = document.getElementById('push-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'push-toast';
    el.style.cssText = 'position:fixed;bottom:84px;left:16px;right:16px;padding:10px 16px;font-family:monospace;font-size:11px;text-align:center;z-index:500;color:#fff;transition:opacity .3s';
    document.body.appendChild(el);
  }
  el.style.background = bg; el.style.opacity = '1'; el.textContent = msg;
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 4000);
}

/* \u{2500}\u{2500} GENERIC ACTION MODAL (replaces alert/confirm/prompt) \u{2500}\u{2500} */
let _actionResolve = null;
function _actionOpen() {
  document.getElementById('action-modal-status').textContent = '';
  document.getElementById('action-modalBg').classList.add('show');
}
function _actionClose(result) {
  document.getElementById('action-modalBg').classList.remove('show');
  const resolve = _actionResolve; _actionResolve = null;
  if (resolve) resolve(result);
}
document.addEventListener('DOMContentLoaded', () => {
  const bg = document.getElementById('action-modalBg');
  bg.addEventListener('click', e => { if (e.target === bg) _actionClose(null); });
  document.getElementById('action-modal-cancel').addEventListener('click', () => _actionClose(null));
});

function gConfirm(message, { title = 'Confirmar.', confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    _actionResolve = resolve;
    document.getElementById('action-modal-title').textContent = title;
    document.getElementById('action-modal-msg').textContent = message;
    document.getElementById('action-modal-body').innerHTML = '';
    const okBtn = document.getElementById('action-modal-ok');
    okBtn.textContent = confirmLabel;
    okBtn.className = 'gbtn solid' + (danger ? ' danger' : '');
    okBtn.onclick = () => _actionClose(true);
    _actionOpen();
  });
}

function gChoice(title, message, options) {
  return new Promise(resolve => {
    _actionResolve = resolve;
    document.getElementById('action-modal-title').textContent = title;
    document.getElementById('action-modal-msg').textContent = message || '';
    const body = document.getElementById('action-modal-body');
    body.innerHTML = options.map((o, i) => `<label class="gchoice-opt"><input type="radio" name="gchoice" value="${esc(o.value)}" ${i === 0 ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('');
    const okBtn = document.getElementById('action-modal-ok');
    okBtn.textContent = 'Confirmar'; okBtn.className = 'gbtn solid';
    okBtn.onclick = () => {
      const sel = body.querySelector('input[name="gchoice"]:checked');
      _actionClose(sel ? sel.value : null);
    };
    _actionOpen();
  });
}

function gPaymentPrompt(docNumber, total) {
  return new Promise(resolve => {
    _actionResolve = resolve;
    document.getElementById('action-modal-title').textContent = 'Registrar pago.';
    document.getElementById('action-modal-msg').textContent = `${docNumber} \u{b7} Total: $${Number(total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
    const body = document.getElementById('action-modal-body');
    body.innerHTML = `
      <div class="gfield"><label>M\u{e9}todo de pago</label>
        <select id="pay-method">
          <option value="transferencia">Transferencia</option>
          <option value="efectivo">Efectivo</option>
          <option value="cheque">Cheque</option>
          <option value="tarjeta">Tarjeta</option>
        </select>
      </div>
      <div class="gfield"><label>Monto recibido (MXN)</label><input id="pay-amount" type="number" step="0.01" value="${Number(total || 0)}"></div>`;
    const okBtn = document.getElementById('action-modal-ok');
    okBtn.textContent = 'Registrar pago'; okBtn.className = 'gbtn solid';
    okBtn.onclick = () => {
      const amount = Number(document.getElementById('pay-amount').value);
      if (!amount) { document.getElementById('action-modal-status').textContent = 'Ingresa un monto v\u{e1}lido.'; document.getElementById('action-modal-status').className = 'gstatus err'; return; }
      _actionClose({ method: document.getElementById('pay-method').value, amount });
    };
    _actionOpen();
  });
}

async function saveSubscription(sub) {
  const { endpoint, keys } = sub.toJSON();
  const res = await fetch(WORKER + '/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin }, body: JSON.stringify({ endpoint, keys }) });
  if (res.ok) document.getElementById('push-test-btn').style.display = 'inline';
}

async function checkPushStatus() {
  if (!pin) return;
  try {
    const res = await fetch(WORKER + '/push/status', { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) return;
    const data = await res.json();
    if (data.count > 0) document.getElementById('push-test-btn').style.display = 'inline';
  } catch {}
}

async function testPush() {
  const btn = document.getElementById('push-test-btn');
  const orig = btn.textContent;
  btn.textContent = '\u{2026}';
  try {
    const res = await fetch(WORKER + '/push/test', { method: 'POST', headers: { 'X-GAPT-PIN': pin } });
    const data = await res.json();
    showToast(data.ok ? '\u{1f514} Notificaci\u{f3}n enviada \u{2014} cierra la app para verla' : '\u{26a0} ' + (data.error || 'Error'), data.ok ? '#19A85B' : '#FF5A1F');
  } catch (e) {
    showToast('\u{26a0} Error: ' + e.message, '#FF5A1F');
  }
  btn.textContent = orig;
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}
   FACTURA TAB
   \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */
const FAC_TIPOS = {
  cotizacion:   { nombre:'Cotizaci\u{f3}n',      pref:'COT',  cliLabel:'_ Para',        legal:'Esta cotizaci\u{f3}n no representa un comprobante fiscal. Precios sujetos a cambio una vez vencida la vigencia indicada.' },
  factura:      { nombre:'Nota de cobro',   pref:'FAC',  cliLabel:'_ Receptor',    legal:'Documento informativo de cobro. Para CFDI (factura fiscal timbrada ante el SAT) solic\u{ed}tala indicando RFC, uso de CFDI y r\u{e9}gimen fiscal.' },
  ordenCambio:  { nombre:'Orden de cambio', pref:'OCC',  cliLabel:'_ Contratante', legal:'Orden de cambio a la factura original. Se presume aprobaci\u{f3}n al solicitar la OCC. No constituye comprobante fiscal.' },
  ordenCompra:  { nombre:'Orden de compra', pref:'OC',   cliLabel:'_ Proveedor',   legal:'Orden de compra emitida por THE GAPT PROJECT. El proveedor acepta los t\u{e9}rminos indicados al surtir la presente orden.' },
  recibo:       { nombre:'Recibo',          pref:'REC',  cliLabel:'_ Recib\u{ed} de',   legal:'Recibo simple de pago. No constituye comprobante fiscal (CFDI).' },
  notaVenta:    { nombre:'Nota de venta',   pref:'NV',   cliLabel:'_ Cliente',     legal:'Nota de venta. No constituye comprobante fiscal (CFDI).' },
};
const FAC_LS_DOCS = 'gapt-fact-docs', FAC_LS_KEY = 'gapt-anthropic-key', FAC_LS_CFG = 'gapt-fact-cfg', FAC_LS_LAST_SYNC = 'gapt-last-sync';
let facDoc = null, facEditingId = null, facLibsLoaded = false, facInited = false;

function $f(id) { return document.getElementById(id); }
function facLsGet(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch(_) { return f; } }
function facLsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} }

// El folio se deriva del n\u{fa}mero m\u{e1}s alto realmente usado (documentos guardados +
// sincronizados + lo que ya est\u{e9} en cobranza). Antes era un contador aparte en
// localStorage que se desincronizaba al cambiar de dispositivo o limpiar cach\u{e9} y
// terminaba repitiendo o saltando folios; deriv\u{e1}ndolo se autocorrige en cada sync.
function facSiguienteFolio(tipo) {
  const y = new Date().getFullYear();
  const pref = FAC_TIPOS[tipo].pref;
  const rx = new RegExp('^GAPT-' + pref + '-' + y + '-(\\d+)$');
  let max = 0;
  const scan = folio => { const m = rx.exec(String(folio || '')); if (m) max = Math.max(max, parseInt(m[1], 10)); };
  facLsGet(FAC_LS_DOCS, []).forEach(d => scan(d.folio));
  (Array.isArray(allInvoices) ? allInvoices : []).forEach(i => scan(i.docNumber));
  return `GAPT-${pref}-${y}-${String(max + 1).padStart(3,'0')}`;
}

function facNuevoDoc(tipo) {
  return {
    id: null, tipo, folio: facSiguienteFolio(tipo),
    fecha: new Date().toISOString().slice(0,10), vigencia: 15, proyecto: '',
    cliente: { nombre:'', rfc:'', tel:'', mail:'', dir:'', atencion:'' },
    conceptos: [{ desc:'', detalle:'', cant:1, unidad:'servicio', pu:0 }],
    iva: true, retIsr: false, retIva: false, descuento: 0, anticipo: 0,
    condiciones: $f('fac-fCondiciones') ? $f('fac-fCondiciones').value : '50% de anticipo para iniciar, 50% contra entrega.\nPrecios en pesos mexicanos (MXN).',
    notas: '', banco: '', status: 'borrador',
  };
}

function facRenderTipos() {
  $f('fac-doc-types').innerHTML = Object.entries(FAC_TIPOS).map(([k,t]) =>
    `<button class="fac-doc-type ${facDoc.tipo===k?'active':''}" data-tipo="${k}">${t.nombre}</button>`).join('');
  $f('fac-doc-types').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    facDoc.tipo = b.dataset.tipo;
    if (!facEditingId) facDoc.folio = facSiguienteFolio(facDoc.tipo);
    facRenderTipos(); facRender();
  }));
}

function facRenderConceptos() {
  $f('fac-conceptos').innerHTML = facDoc.conceptos.map((c,i) => `
    <div class="fac-concepto-row" data-i="${i}">
      <button class="fac-del" title="Eliminar">\u{d7}</button>
      <label>Concepto ${i+1} (t\u{ed}tulo corto)</label>
      <input class="fc-desc" placeholder="T\u{ed}tulo breve del servicio" value="${esc(c.desc)}" style="width:100%;background:var(--dark);border:1px solid var(--border);color:var(--cream);font-family:inherit;font-size:12px;font-weight:700;padding:7px 9px;outline:none">
      <label style="margin-top:6px;display:block">Detalle (opcional)</label>
      <textarea class="fc-detalle" rows="2" placeholder="Descripci\u{f3}n m\u{e1}s larga de qu\u{e9} incluye este concepto" style="width:100%;background:var(--dark);border:1px solid var(--border);color:var(--muted);font-family:inherit;font-size:11px;padding:7px 9px;outline:none">${esc(c.detalle||'')}</textarea>
      <div class="fac-grid-c">
        <div><label style="font-size:8px">Unidad</label><input class="fc-unidad" value="${esc(c.unidad)}" style="width:100%;background:var(--dark);border:1px solid var(--border);color:var(--cream);font-size:11px;padding:6px"></div>
        <div><label style="font-size:8px">Cant.</label><input class="fc-cant" type="number" min="0" step="0.01" value="${c.cant}" style="width:100%;background:var(--dark);border:1px solid var(--border);color:var(--cream);font-size:11px;padding:6px"></div>
        <div><label style="font-size:8px">P. Unit.</label><input class="fc-pu" type="number" min="0" step="0.01" value="${c.pu}" style="width:100%;background:var(--dark);border:1px solid var(--border);color:var(--cream);font-size:11px;padding:6px"></div>
      </div>
    </div>`).join('');
  $f('fac-conceptos').querySelectorAll('.fac-concepto-row').forEach(row => {
    const i = +row.dataset.i;
    row.querySelector('.fac-del').addEventListener('click', () => {
      facDoc.conceptos.splice(i,1);
      if (!facDoc.conceptos.length) facDoc.conceptos.push({ desc:'', detalle:'', cant:1, unidad:'servicio', pu:0 });
      facRenderConceptos(); facRenderSheet();
    });
    row.querySelector('.fc-desc').addEventListener('input', e => { facDoc.conceptos[i].desc = e.target.value; facRenderSheet(); });
    row.querySelector('.fc-detalle').addEventListener('input', e => { facDoc.conceptos[i].detalle = e.target.value; facRenderSheet(); });
    row.querySelector('.fc-unidad').addEventListener('input', e => { facDoc.conceptos[i].unidad = e.target.value; facRenderSheet(); });
    row.querySelector('.fc-cant').addEventListener('input', e => { facDoc.conceptos[i].cant = parseFloat(e.target.value)||0; facRenderSheet(); });
    row.querySelector('.fc-pu').addEventListener('input', e => { facDoc.conceptos[i].pu = parseFloat(e.target.value)||0; facRenderSheet(); });
  });
}

function facCalc() {
  const subtotal = facDoc.conceptos.reduce((s,c) => s + (c.cant*c.pu||0), 0);
  const desc = Math.min(facDoc.descuento||0, subtotal);
  const base = subtotal - desc;
  const iva = facDoc.iva ? base*0.16 : 0;
  const retIsr = facDoc.retIsr ? base*0.0125 : 0;
  const retIva = facDoc.retIva ? base*(0.16*2/3) : 0;
  const total = base + iva - retIsr - retIva;
  const saldo = total - (facDoc.anticipo||0);
  return { subtotal, desc, base, iva, retIsr, retIva, total, saldo };
}
const facFmt = n => n.toLocaleString('es-MX', { style:'currency', currency:'MXN' });

function facFillForm() {
  $f('fac-fFolio').value = facDoc.folio; $f('fac-fFecha').value = facDoc.fecha; $f('fac-fVigencia').value = facDoc.vigencia;
  $f('fac-fProyecto').value = facDoc.proyecto;
  $f('fac-cNombre').value = facDoc.cliente.nombre; $f('fac-cRfc').value = facDoc.cliente.rfc; $f('fac-cTel').value = facDoc.cliente.tel;
  $f('fac-cMail').value = facDoc.cliente.mail; $f('fac-cDir').value = facDoc.cliente.dir;
  $f('fac-cAtencion').value = facDoc.cliente.atencion || '';
  $f('fac-tIva').checked = facDoc.iva; $f('fac-tRetIsr').checked = facDoc.retIsr; $f('fac-tRetIva').checked = facDoc.retIva;
  $f('fac-fDescuento').value = facDoc.descuento; $f('fac-fAnticipo').value = facDoc.anticipo;
  $f('fac-fCondiciones').value = facDoc.condiciones; $f('fac-fNotas').value = facDoc.notas; $f('fac-fBanco').value = facDoc.banco;
  $f('fac-fStatus').value = facDoc.status;
}

function facRenderSheet() {
  const t = FAC_TIPOS[facDoc.tipo];
  $f('fac-pTipo').textContent = t.nombre;
  $f('fac-pFolio').textContent = facDoc.folio;
  $f('fac-fFolio').value = facDoc.folio;
  const fechaTxt = facDoc.fecha ? new Date(facDoc.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'}) : '';
  let meta = `FECHA \u{b7} ${fechaTxt}`;
  if (facDoc.tipo === 'cotizacion' && facDoc.vigencia > 0) meta += `<br>VIGENCIA \u{b7} ${facDoc.vigencia} d\u{ed}as`;
  $f('fac-pMeta').innerHTML = meta;
  $f('fac-pClienteLabel').textContent = t.cliLabel;
  $f('fac-pCliNombre').textContent = facDoc.cliente.nombre || '\u{2014}';
  $f('fac-pCliDatos').innerHTML = [facDoc.cliente.atencion && 'En atenci\u{f3}n a: '+esc(facDoc.cliente.atencion), facDoc.cliente.rfc && 'RFC: '+esc(facDoc.cliente.rfc), esc(facDoc.cliente.dir), [esc(facDoc.cliente.tel),esc(facDoc.cliente.mail)].filter(Boolean).join(' \u{b7} ')].filter(Boolean).join('<br>');
  $f('fac-pProyectoWrap').style.display = facDoc.proyecto ? 'block' : 'none';
  $f('fac-pProyecto').textContent = facDoc.proyecto;

  $f('fac-pConceptos').innerHTML = facDoc.conceptos.filter(c => c.desc||c.pu).map((c,i) => `
    <tr>
      <td class="mono" style="font-size:9px;color:#6E665B">${String(i+1).padStart(2,'0')}</td>
      <td><span class="concepto-titulo">${esc(c.desc)}</span>${c.detalle ? `<span class="concepto-detalle">${esc(c.detalle)}</span>` : ''}</td>
      <td class="r mono">${c.cant}</td>
      <td>${esc(c.unidad)}</td>
      <td class="r mono">${facFmt(c.pu)}</td>
      <td class="r mono">${facFmt(c.cant*c.pu||0)}</td>
    </tr>`).join('') || `<tr><td colspan="6" style="color:#9B968C;padding:16px;text-align:center">Sin conceptos a\u{fa}n</td></tr>`;

  const c = facCalc();
  let rows = `<div class="row"><span>Subtotal</span><span>${facFmt(c.subtotal)}</span></div>`;
  if (c.desc>0) rows += `<div class="row"><span>Descuento</span><span>\u{2212}${facFmt(c.desc)}</span></div>`;
  if (facDoc.iva) rows += `<div class="row"><span>IVA 16%</span><span>${facFmt(c.iva)}</span></div>`;
  if (facDoc.retIsr) rows += `<div class="row"><span>Ret. ISR 1.25%</span><span>\u{2212}${facFmt(c.retIsr)}</span></div>`;
  if (facDoc.retIva) rows += `<div class="row"><span>Ret. IVA</span><span>\u{2212}${facFmt(c.retIva)}</span></div>`;
  rows += `<div class="row total"><span>Total MXN</span><span>${facFmt(c.total)}</span></div>`;
  if (facDoc.anticipo>0) {
    rows += `<div class="row"><span>Anticipo</span><span>\u{2212}${facFmt(facDoc.anticipo)}</span></div>`;
    rows += `<div class="row" style="font-weight:700"><span>Saldo</span><span>${facFmt(c.saldo)}</span></div>`;
  }
  $f('fac-pTotales').innerHTML = rows;

  $f('fac-pCondWrap').style.display = facDoc.condiciones ? 'block' : 'none';
  $f('fac-pCondiciones').textContent = facDoc.condiciones;
  $f('fac-pNotasWrap').style.display = facDoc.notas ? 'block' : 'none';
  $f('fac-pNotas').textContent = facDoc.notas;
  $f('fac-pBancoWrap').style.display = facDoc.banco ? 'block' : 'none';
  // Compacta l\u{ed}neas en blanco repetidas (el textarea libre suele traer "Label\nValor\n\n\nLabel\nValor")
  $f('fac-pBanco').textContent = (facDoc.banco || '').replace(/\n{2,}/g, '\n');
  $f('fac-pLegal').textContent = t.legal;

  const cfg = facLsGet(FAC_LS_CFG, {});
  $f('fac-pPagoWrap').style.display = 'none'; // solo visible durante captura de PDF
  $f('fac-pEmisorNombre').textContent = cfg.nombre || 'Gustavo A. Pastrana T.';
  $f('fac-pEmisorDatos').innerHTML = `THE GAPT PROJECT \u{b7} Architecture &amp; Design Studio<br>${cfg.rfc ? 'RFC: '+esc(cfg.rfc)+'<br>' : ''}Cuernavaca, Morelos \u{b7} MX<br>hello@thegaptproject.com`;
}

function facRender() { facFillForm(); facRenderConceptos(); facRenderSheet(); }

function facSaveDoc() {
  const docs = facLsGet(FAC_LS_DOCS, []);
  const now = Date.now();
  if (facEditingId) {
    const i = docs.findIndex(x => x.id === facEditingId);
    if (i>=0) docs[i] = { ...facDoc, id: facEditingId, updatedAt: now };
  } else {
    facDoc.id = 'd'+now; facEditingId = facDoc.id;
    docs.push({ ...JSON.parse(JSON.stringify(facDoc)), updatedAt: now });
  }
  facLsSet(FAC_LS_DOCS, docs);
  return facEditingId;
}

function facRenderSaved() {
  const docs = facLsGet(FAC_LS_DOCS, []);
  $f('fac-savedList').innerHTML = docs.length ? docs.slice().reverse().map(d => {
    const tot = (() => { const old = facDoc; facDoc = d; const r = facCalc(); facDoc = old; return r.total; })();
    return `<div class="fac-saved-item" data-id="${d.id}">
      <div style="min-width:0"><div class="folio">${esc(d.folio)}</div><div class="cli">${esc(d.cliente.nombre||'Sin cliente')}</div></div>
      <span class="fac-badge ${esc(d.status)}">${esc(d.status)}</span>
      <span class="tot">${facFmt(tot)}</span>
      <div style="display:flex;gap:4px">
        <button class="ent-btn-sm" data-act="abrir">Abrir</button>
        <button class="ent-btn-sm red" data-act="borrar">\u{d7}</button>
      </div>
    </div>`;
  }).join('') : '<p style="font-size:11px;color:var(--muted)">A\u{fa}n no hay documentos guardados.</p>';

  $f('fac-savedList').querySelectorAll('.fac-saved-item').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-act="abrir"]').addEventListener('click', () => {
      const d = facLsGet(FAC_LS_DOCS, []).find(x => x.id === id);
      if (d) { facDoc = JSON.parse(JSON.stringify(d)); facEditingId = id; facRenderTipos(); facRender(); window.scrollTo({top:0,behavior:'smooth'}); }
    });
    el.querySelector('[data-act="borrar"]').addEventListener('click', async () => {
      if (!(await gConfirm('\u{bf}Eliminar este documento?', { confirmLabel: 'Eliminar', danger: true }))) return;
      facLsSet(FAC_LS_DOCS, facLsGet(FAC_LS_DOCS, []).filter(x => x.id !== id));
      if (facEditingId === id) facEditingId = null;
      facRenderSaved();
      // El borrado tiene que registrarse en el servidor: el sync mezcla nube + local
      // por id, as\u{ed} que un borrado solo local lo rev\u{ed}ve en la siguiente sincronizaci\u{f3}n.
      try {
        const res = await fetch(`${WORKER}/docs/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-GAPT-PIN': pin } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      } catch(_) {
        showToast('\u{26a0} Borrado local, pero no se pudo avisar al servidor \u{2014} sincroniza de nuevo m\u{e1}s tarde.', '#FF5A1F');
      }
    });
  });
}

function facFlash(msg) {
  $f('fac-aiStatus').textContent = msg; $f('fac-aiStatus').className = 'fac-ai-status ok';
  setTimeout(() => { if ($f('fac-aiStatus').textContent === msg) $f('fac-aiStatus').textContent = ''; }, 2500);
}

async function facCloudUpload(docs) {
  if (!docs) docs = facLsGet(FAC_LS_DOCS, []);
  const res = await fetch(WORKER + '/docs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin }, body: JSON.stringify(docs) });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
  facLsSet(FAC_LS_LAST_SYNC, Date.now());
  facRenderSyncStatus();
}

async function facCloudDownload() {
  const [res, delRes] = await Promise.all([
    fetch(WORKER + '/docs', { headers: { 'X-GAPT-PIN': pin } }),
    fetch(WORKER + '/docs-deleted', { headers: { 'X-GAPT-PIN': pin } }).catch(() => null),
  ]);
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
  const cloudDocs = await res.json();
  if (!Array.isArray(cloudDocs)) throw new Error('Respuesta inv\u{e1}lida');
  // Ids borrados en el servidor: mandan sobre la copia local, si no un documento
  // borrado en otro dispositivo reaparecer\u{ed}a al mezclar.
  const deleted = (delRes && delRes.ok) ? await delRes.json().catch(() => []) : [];
  const isDeleted = id => Array.isArray(deleted) && deleted.includes(id);
  const localDocs = facLsGet(FAC_LS_DOCS, []);
  const merged = {};
  for (const d of cloudDocs) if (d.id && !isDeleted(d.id)) merged[d.id] = d;
  for (const d of localDocs) { if (!d.id || isDeleted(d.id)) continue; if (!merged[d.id] || (d.updatedAt||0) > (merged[d.id].updatedAt||0)) merged[d.id] = d; }
  const result = Object.values(merged).sort((a,b) => (a.updatedAt||0) - (b.updatedAt||0));
  facLsSet(FAC_LS_DOCS, result);
  facLsSet(FAC_LS_LAST_SYNC, Date.now());
  facRenderSaved(); facRenderSyncStatus();
  return result.length;
}

function facRenderSyncStatus() {
  const el = $f('fac-syncStatus');
  if (!el) return;
  const ts = facLsGet(FAC_LS_LAST_SYNC, null);
  if (!ts) { el.textContent = '\u{2014} Sin sincronizar'; return; }
  const mins = Math.round((Date.now() - ts) / 60000);
  el.textContent = mins < 1 ? '\u{2601} Sync ahora mismo' : `\u{2601} Sync hace ${mins} min`;
}

/* \u{2500}\u{2500} LAZY LOAD PDF LIBS \u{2500}\u{2500} */
function facLoadLibs() {
  if (facLibsLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s1 = document.createElement('script');
    s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s2.onload = () => { facLibsLoaded = true; resolve(); };
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
}

function facCanvasToPDF(c, linkAnnotations = []) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ format: 'letter', unit: 'mm', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgH = (c.height * pageW) / c.width;
  const imgData = c.toDataURL('image/jpeg', 0.92);
  if (imgH <= pageH) {
    pdf.addImage(imgData, 'JPEG', 0, 0, pageW, imgH);
  } else {
    let yOffset = 0;
    while (yOffset < imgH) {
      if (yOffset > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, -yOffset, pageW, imgH);
      yOffset += pageH;
    }
  }
  // Clickable link annotations (ratios 0-1 relative to canvas dimensions \u{2192} PDF mm)
  for (const lnk of linkAnnotations) {
    pdf.link(lnk.x * pageW, lnk.y * pageH, lnk.w * pageW, lnk.h * pageH, { url: lnk.url });
  }
  return pdf.output('datauristring').split(',')[1];
}

function facDrawStamp(ctx, W, H) {
  const sw = W * 0.28, sh = sw * 0.55, cx = W * 0.75, cy = H * 0.26;
  const lw = Math.max(4, W * 0.004);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-10 * Math.PI / 180);
  ctx.strokeStyle = '#FF5A1F'; ctx.lineWidth = lw * 1.6; ctx.globalAlpha = 0.75;
  ctx.strokeRect(-sw/2, -sh/2, sw, sh);
  const g = lw * 3; ctx.lineWidth = lw * 0.8; ctx.globalAlpha = 0.45;
  ctx.strokeRect(-sw/2 + g, -sh/2 + g, sw - g*2, sh - g*2);
  ctx.globalAlpha = 0.80; ctx.fillStyle = '#FF5A1F';
  const ls = sh * 0.18, labelY = -sh * 0.30;
  ctx.font = `bold ${sh * 0.15}px Arial`;
  const textW = ctx.measureText('GAPT PROJECT').width;
  const totalW = ls + sw * 0.04 + textW, startX = -totalW / 2;
  ctx.fillRect(startX, labelY - ls * 0.5, ls, ls);
  ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff';
  ctx.fillRect(startX + ls * 0.57, labelY - ls * 0.5, ls * 0.07, ls);
  ctx.globalAlpha = 0.80; ctx.fillStyle = '#FF5A1F'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('GAPT PROJECT', startX + ls + sw * 0.04, labelY);
  ctx.globalAlpha = 0.45; ctx.lineWidth = lw * 0.6;
  ctx.beginPath(); ctx.moveTo(-sw/2 + sw*0.1, -sh * 0.10); ctx.lineTo(sw/2 - sw*0.1, -sh * 0.10); ctx.stroke();
  ctx.globalAlpha = 0.80; ctx.font = `bold ${sh * 0.50}px Arial`; ctx.fillStyle = '#FF5A1F';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PAID', 0, sh * 0.08);
  ctx.globalAlpha = 0.65; ctx.font = `bold ${sh * 0.16}px Arial`; ctx.fillText('P A G A D O', 0, sh * 0.35);
  ctx.globalAlpha = 0.45; ctx.lineWidth = lw * 0.6;
  ctx.beginPath(); ctx.moveTo(-sw/2 + sw*0.1, sh * 0.45); ctx.lineTo(sw/2 - sw*0.1, sh * 0.45); ctx.stroke();
  ctx.globalAlpha = 1; ctx.restore();
}

// Si la hoja renderizada es m\u{e1}s alta que una p\u{e1}gina carta a su ancho actual, la encoge
// (CSS zoom, que s\u{ed} re-fluye el layout) hasta que quepa en una sola p\u{e1}gina antes de capturarla.
function facFitToOnePage(sheet) {
  const LETTER_RATIO = 11 / 8.5;
  const rect = sheet.getBoundingClientRect();
  const targetH = rect.width * LETTER_RATIO;
  if (rect.height <= targetH + 1) return () => {};
  const ratio = Math.max(targetH / rect.height, 0.72);
  const origFs = sheet.style.fontSize;
  const origLh = sheet.style.lineHeight;
  const currentFs = parseFloat(getComputedStyle(sheet).fontSize);
  sheet.style.fontSize = (currentFs * ratio).toFixed(2) + 'px';
  sheet.style.lineHeight = (1.35 * ratio).toFixed(3);
  void sheet.offsetHeight;
  return () => { sheet.style.fontSize = origFs; sheet.style.lineHeight = origLh; };
}

async function facGenerateBothPDFs(paymentUrl = null) {
  await facLoadLibs();
  const sheet = document.getElementById('fac-sheet');
  if (!sheet || !window.html2canvas || !window.jspdf) return { pdfBase64: null, pdfPagadoBase64: null };
  const SPECTRUM = 'linear-gradient(90deg,#2563FF 0%,#6234E6 24%,#FF3D8B 50%,#FF5A1F 76%,#FFB300 100%)';
  const patchEls = Array.from(sheet.querySelectorAll('.fac-sheet__grad, .fac-ai-dot'));
  patchEls.forEach(el => el.style.setProperty('background', SPECTRUM, 'important'));

  // Show payment button only during PDF capture
  const pagoWrap = document.getElementById('fac-pPagoWrap');
  const pagoBtn  = document.getElementById('fac-pPagoBtn');
  if (paymentUrl && pagoWrap) {
    pagoBtn.href = paymentUrl;
    pagoWrap.style.display = 'block';
  }

  // Pin to exact letter-page height so footer/notes land at the bottom in the PDF
  const sheetW = sheet.getBoundingClientRect().width;
  const letterH = Math.round(sheetW * 11 / 8.5);
  const dpiScale = Math.ceil(5100 / sheetW); // 8.5" \u{d7} 600dpi = 5100px target width
  const origH = sheet.style.height;
  const origMinH = sheet.style.minHeight;
  sheet.style.height = letterH + 'px';
  sheet.style.minHeight = 'unset';
  void sheet.offsetHeight;

  // Capture payment button position for clickable PDF annotation
  const linkAnnotations = [];
  if (pagoBtn && paymentUrl) {
    const sheetRect2 = sheet.getBoundingClientRect();
    const btnRect = pagoBtn.getBoundingClientRect();
    linkAnnotations.push({
      x: (btnRect.left - sheetRect2.left) / sheetW,
      y: (btnRect.top  - sheetRect2.top)  / letterH,
      w: btnRect.width  / sheetW,
      h: btnRect.height / letterH,
      url: paymentUrl,
    });
  }

  let canvas;
  try {
    canvas = await html2canvas(sheet, { scale: dpiScale, useCORS: true, logging: false, backgroundColor: '#fff', width: sheetW, height: letterH });
  } finally {
    patchEls.forEach(el => el.style.removeProperty('background'));
    sheet.style.height = origH;
    sheet.style.minHeight = origMinH;
    if (pagoWrap) pagoWrap.style.display = 'none';
  }
  const pdfBase64 = facCanvasToPDF(canvas, linkAnnotations);
  let pdfPagadoBase64 = pdfBase64;
  try {
    const clone = document.createElement('canvas');
    clone.width = canvas.width; clone.height = canvas.height;
    const cloneCtx = clone.getContext('2d');
    cloneCtx.drawImage(canvas, 0, 0);
    facDrawStamp(cloneCtx, clone.width, clone.height);
    pdfPagadoBase64 = facCanvasToPDF(clone, linkAnnotations);
  } catch(e) { console.error('Stamp failed:', e); }
  return { pdfBase64, pdfPagadoBase64 };
}

function facCollectDocData() {
  const cfg = facLsGet(FAC_LS_CFG, {});
  const c = facCalc();
  const fechaTxt = facDoc.fecha
    ? new Date(facDoc.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})
    : new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'});
  return {
    clientEmail: facDoc.cliente?.mail || '', docType: facDoc.tipo, docNumber: facDoc.folio,
    clientName: facDoc.cliente?.nombre || '', clientPhone: facDoc.cliente?.tel || '', clientRfc: facDoc.cliente?.rfc || '',
    emisor: cfg.nombre || 'Gustavo A. Pastrana T.',
    fecha: fechaTxt, validez: facDoc.vigencia ? `${facDoc.vigencia} d\u{ed}as` : '', notas: facDoc.notas || '', banco: facDoc.banco || '',
    items: (facDoc.conceptos || []).map(it => ({ concepto: it.desc || '', unidad: it.unidad || 'servicio', cantidad: Number(it.cant)||1, precio_unitario: Number(it.pu)||0 })),
    subtotal: c.subtotal, iva: facDoc.iva ? c.iva : null, total: c.total,
  };
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}
   CFDI \u{2192} PDF (representaci\u{f3}n impresa, desde XML del SAT)
   \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */
let cfdiXmlInited = false, cfdiRepData = null, cfdiRawXmlText = null;
const cfdiFmtMoney = n => (n||0).toLocaleString('es-MX', { style:'currency', currency:'MXN' });
// Matches the plain (no $) 6-decimal number formatting the SAT uses for Base/Importe in its own representaci\u{f3}n impresa
const cfdiFmt6 = n => Number(n||0).toLocaleString('es-MX', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const cfdiFmtNat = n => Number(n||0).toLocaleString('es-MX', { maximumFractionDigits: 6 });
const cfdiFmtTasa = raw => {
  const n = parseFloat(raw || '0') * 100;
  let s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (!s.includes('.')) s += '.00';
  else { const dec = s.split('.')[1]; if (dec.length < 2) s += '0'.repeat(2 - dec.length); }
  return s + '%';
};

function cfdiParseXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML inv\u{e1}lido');
  // SAT CFDI XML uses namespaced tags (cfdi:Comprobante, cfdi:Emisor...) \u{2014} match by local name so it works regardless of prefix
  const byTag = name => doc.getElementsByTagNameNS('*', name)[0] || null;
  const allByTag = name => Array.from(doc.getElementsByTagNameNS('*', name));
  const comp = byTag('Comprobante') || doc.documentElement;
  const emisor = byTag('Emisor');
  const receptor = byTag('Receptor');
  const timbre = byTag('TimbreFiscalDigital');
  const infoGlobal = byTag('InformacionGlobal');
  const conceptosNodes = allByTag('Concepto');
  // Impuestos concept-level appear before the top-level (comprobante) Impuestos in document order \u{2014} the last match is the summary block
  const impuestosNodes = allByTag('Impuestos');
  const impuestosTop = impuestosNodes[impuestosNodes.length - 1] || null;
  const retenciones = impuestosTop ? Array.from(impuestosTop.getElementsByTagNameNS('*', 'Retencion')) : [];
  const traslados = impuestosTop ? Array.from(impuestosTop.getElementsByTagNameNS('*', 'Traslado')) : [];
  const sumImporte = nodes => nodes.reduce((s, n) => s + parseFloat(n.getAttribute('Importe') || '0'), 0);
  const ivaTraslado = impuestosTop && impuestosTop.hasAttribute('TotalImpuestosTrasladados')
    ? parseFloat(impuestosTop.getAttribute('TotalImpuestosTrasladados') || '0')
    : sumImporte(traslados);
  const totalRetenido = impuestosTop && impuestosTop.hasAttribute('TotalImpuestosRetenidos')
    ? parseFloat(impuestosTop.getAttribute('TotalImpuestosRetenidos') || '0')
    : sumImporte(retenciones);
  const ivaRetencionNodes = retenciones.filter(r => r.getAttribute('Impuesto') === '002');
  const isrRetencionNodes = retenciones.filter(r => r.getAttribute('Impuesto') === '001');
  const ivaRetenido = sumImporte(ivaRetencionNodes);
  const isrRetenido = sumImporte(isrRetencionNodes);
  const tasaPct = n => Math.round(parseFloat(n || '0') * 10000) / 100;
  // The comprobante-level Impuestos summary usually omits TasaOCuota on Retencion nodes (only Impuesto+Importe) \u{2014}
  // the rate only appears on the per-concept nodes, so search all Retencion/Traslado nodes in the document for one that has it.
  const allTrasladoNodes = allByTag('Traslado');
  const allRetencionNodes = allByTag('Retencion');
  const trasladoConTasa = allTrasladoNodes.find(n => n.hasAttribute('TasaOCuota'));
  const ivaRetConTasa = allRetencionNodes.find(n => n.getAttribute('Impuesto') === '002' && n.hasAttribute('TasaOCuota'));
  const isrRetConTasa = allRetencionNodes.find(n => n.getAttribute('Impuesto') === '001' && n.hasAttribute('TasaOCuota'));
  const trasladoTasaPct = trasladoConTasa ? tasaPct(trasladoConTasa.getAttribute('TasaOCuota')) : 16;
  const ivaRetenidoTasaPct = ivaRetConTasa ? tasaPct(ivaRetConTasa.getAttribute('TasaOCuota')) : null;
  const isrRetenidoTasaPct = isrRetConTasa ? tasaPct(isrRetConTasa.getAttribute('TasaOCuota')) : null;
  const fechaTxt = comp.getAttribute('Fecha') || '';
  const PERIODICIDAD = { '01':'Diario', '02':'Semanal', '03':'Quincenal', '04':'Mensual', '05':'Bimestral' };
  const MESES = { '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio','07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre','13':'Ene-Feb','14':'Mar-Abr','15':'May-Jun','16':'Jul-Ago','17':'Sep-Oct','18':'Nov-Dic' };
  // Cat\u{e1}logos SAT (subconjunto de uso frecuente) \u{2014} si el c\u{f3}digo no est\u{e1} listado se muestra tal cual
  // Textos id\u{e9}nticos a los que usa el SAT en su propia representaci\u{f3}n impresa \u{2014} sin el c\u{f3}digo num\u{e9}rico antepuesto
  const CAT_FORMA_PAGO = { '01':'Efectivo','02':'Cheque nominativo','03':'Transferencia electr\u{f3}nica de fondos (incluye SPEI)','04':'Tarjeta de cr\u{e9}dito','28':'Tarjeta de d\u{e9}bito','99':'Por definir' };
  const CAT_METODO_PAGO = { PUE:'Pago en una sola exhibici\u{f3}n', PPD:'Pago en parcialidades o diferido' };
  const CAT_EXPORTACION = { '01':'No aplica','02':'Definitiva','03':'Temporal' };
  const CAT_USO_CFDI = { G01:'Adquisici\u{f3}n de bienes.', G02:'Devoluciones, descuentos o bonificaciones.', G03:'Gastos en general.', I01:'Construcciones.', I04:'Equipo de c\u{f3}mputo y accesorios.', D01:'Honorarios m\u{e9}dicos, dentales y hospitalarios.', D10:'Servicios educativos (colegiaturas).', S01:'Sin efectos fiscales.', CP01:'Pagos.' };
  const CAT_REGIMEN = { '601':'General de Ley Personas Morales','603':'Personas Morales con Fines no Lucrativos','605':'Sueldos y Salarios','606':'Arrendamiento','612':'Actividades Empresariales y Profesionales','614':'Ingresos por Intereses','616':'Sin obligaciones fiscales','620':'Sociedades Cooperativas de Producci\u{f3}n','621':'Incorporaci\u{f3}n Fiscal','625':'Plataformas Tecnol\u{f3}gicas','626':'R\u{e9}gimen Simplificado de Confianza' };
  const CAT_OBJETO_IMP = { '01':'No objeto de impuesto.', '02':'S\u{ed} objeto de impuesto.', '03':'S\u{ed} objeto de impuesto y no obligado al desglose.', '04':'S\u{ed} objeto de impuesto y no causa impuesto.' };
  const withLabel = (code, cat) => code ? (cat[code] || code) : '';
  const timbreVersion = timbre?.getAttribute('Version') || '1.1';
  const uuid = timbre?.getAttribute('UUID') || '';
  const fechaTimbrado = timbre?.getAttribute('FechaTimbrado') || '';
  const rfcProvCertif = timbre?.getAttribute('RfcProvCertif') || '';
  const selloCfd = timbre?.getAttribute('SelloCFD') || comp.getAttribute('Sello') || '';
  const noCertificadoSat = timbre?.getAttribute('NoCertificadoSAT') || '';
  // F\u{f3}rmula oficial del SAT para la cadena original del complemento de certificaci\u{f3}n digital (TFD 1.1)
  const cadenaOriginal = uuid ? `||${timbreVersion}|${uuid}|${fechaTimbrado}|${rfcProvCertif}|${selloCfd}|${noCertificadoSat}||` : '';
  return {
    folio: comp.getAttribute('Folio') || '', serie: comp.getAttribute('Serie') || '',
    fecha: fechaTxt, lugarExpedicion: comp.getAttribute('LugarExpedicion') || '',
    total: parseFloat(comp.getAttribute('Total') || '0'), subtotal: parseFloat(comp.getAttribute('SubTotal') || '0'),
    descuento: parseFloat(comp.getAttribute('Descuento') || '0'),
    moneda: comp.getAttribute('Moneda') || 'MXN', tipoComprobante: comp.getAttribute('TipoDeComprobante') || '',
    metodoPago: comp.getAttribute('MetodoPago') || '', formaPago: comp.getAttribute('FormaPago') || '',
    metodoPagoLabel: withLabel(comp.getAttribute('MetodoPago'), CAT_METODO_PAGO),
    formaPagoLabel: withLabel(comp.getAttribute('FormaPago'), CAT_FORMA_PAGO),
    noCertificado: comp.getAttribute('NoCertificado') || '',
    exportacion: comp.getAttribute('Exportacion') || '',
    exportacionLabel: withLabel(comp.getAttribute('Exportacion'), CAT_EXPORTACION),
    emisorRfc: emisor?.getAttribute('Rfc') || '', emisorNombre: emisor?.getAttribute('Nombre') || '',
    emisorRegimen: emisor?.getAttribute('RegimenFiscal') || '',
    emisorRegimenLabel: withLabel(emisor?.getAttribute('RegimenFiscal'), CAT_REGIMEN),
    receptorRfc: receptor?.getAttribute('Rfc') || '', receptorNombre: receptor?.getAttribute('Nombre') || '',
    receptorCp: receptor?.getAttribute('DomicilioFiscalReceptor') || '',
    receptorRegimen: receptor?.getAttribute('RegimenFiscalReceptor') || '',
    receptorRegimenLabel: withLabel(receptor?.getAttribute('RegimenFiscalReceptor'), CAT_REGIMEN),
    usoCfdi: receptor?.getAttribute('UsoCFDI') || '',
    usoCfdiLabel: withLabel(receptor?.getAttribute('UsoCFDI'), CAT_USO_CFDI),
    uuid, fechaTimbrado, rfcProvCertif, noCertificadoSat, selloCfd,
    selloSat: timbre?.getAttribute('SelloSAT') || '',
    cadenaOriginal,
    ivaTraslado, ivaRetenido, isrRetenido,
    ivaRetenidoTasaPct, isrRetenidoTasaPct,
    otroRetenido: Math.round(Math.max(0, totalRetenido - ivaRetenido - isrRetenido) * 100) / 100,
    trasladoTasaPct,
    esGlobal: !!infoGlobal,
    periodicidad: infoGlobal ? (PERIODICIDAD[infoGlobal.getAttribute('Periodicidad')] || infoGlobal.getAttribute('Periodicidad') || '') : '',
    mesesGlobalTexto: infoGlobal ? (MESES[infoGlobal.getAttribute('Meses')] || infoGlobal.getAttribute('Meses') || '') : '',
    anioGlobal: infoGlobal ? (infoGlobal.getAttribute('A\u{f1}o') || '') : '',
    conceptos: conceptosNodes.map(c => {
      const IMPUESTO_LABEL = { '001': 'ISR', '002': 'IVA', '003': 'IEPS' };
      const cImpuestoNode = row => ({
        tipoLabel: row.tagName.replace(/^\w+:/, '') === 'Traslado' ? 'Traslado' : 'Retenci\u{f3}n',
        impuestoLabel: IMPUESTO_LABEL[row.getAttribute('Impuesto')] || row.getAttribute('Impuesto') || '',
        base: parseFloat(row.getAttribute('Base') || '0'),
        tipoFactor: row.getAttribute('TipoFactor') || '',
        tasaOCuota: row.getAttribute('TasaOCuota') || '',
        importe: parseFloat(row.getAttribute('Importe') || '0'),
      });
      const cTraslados = Array.from(c.getElementsByTagNameNS('*', 'Traslado')).map(cImpuestoNode);
      const cRetenciones = Array.from(c.getElementsByTagNameNS('*', 'Retencion')).map(cImpuestoNode);
      return {
        claveProdServ: c.getAttribute('ClaveProdServ') || '',
        noIdentificacion: c.getAttribute('NoIdentificacion') || '',
        desc: c.getAttribute('Descripcion') || '', cant: parseFloat(c.getAttribute('Cantidad')||'1'),
        claveUnidad: c.getAttribute('ClaveUnidad') || '', unidad: c.getAttribute('Unidad') || '',
        pu: parseFloat(c.getAttribute('ValorUnitario')||'0'), importe: parseFloat(c.getAttribute('Importe')||'0'),
        descuento: parseFloat(c.getAttribute('Descuento') || '0'),
        objetoImp: c.getAttribute('ObjetoImp') || '', objetoImpLabel: withLabel(c.getAttribute('ObjetoImp'), CAT_OBJETO_IMP),
        impuestos: [...cTraslados, ...cRetenciones],
      };
    }),
  };
}

function cfdiFmtFecha(iso) {
  if (!iso) return '\u{2014}';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('es-MX', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function cfdiRenderRep(data) {
  const $r = id => document.getElementById(id);
  const tipoLabel = { I:'Ingreso', E:'Egreso', T:'Traslado', N:'N\u{f3}mina', P:'Pago' }[data.tipoComprobante] || data.tipoComprobante || '\u{2014}';
  const folioSerie = [data.serie, data.folio].filter(Boolean).join(' ') || '\u{2014}';
  const fechaLugar = `${data.lugarExpedicion || '\u{2014}'} \u{b7} ${cfdiFmtFecha(data.fecha)}`;

  // header recap
  $r('rep-tipo').textContent = tipoLabel;
  $r('rep-folio-serie').textContent = folioSerie;
  $r('rep-fecha-lugar').textContent = fechaLugar;

  // emisor / receptor \u{2014} compact two-column block, labels match the SAT's own representaci\u{f3}n impresa wording
  $r('rep-emisor-line').innerHTML =
    `<div><b>RFC emisor:</b> <span class="mono">${esc(data.emisorRfc || '\u{2014}')}</span></div>` +
    `<div><b>Nombre emisor:</b> ${esc(data.emisorNombre || '\u{2014}')}</div>` +
    `<div><b>R\u{e9}gimen fiscal:</b> ${esc(data.emisorRegimenLabel || '\u{2014}')}</div>`;
  const recRfc = data.receptorRfc || '\u{2014}';
  const isGenerico = recRfc === 'XAXX010101000';
  $r('rep-rec-line').innerHTML = isGenerico
    ? `<div><b>RFC receptor:</b> <span class="mono">${esc(recRfc)}</span></div><div><b>Nombre receptor:</b> P\u{da}BLICO EN GENERAL</div>`
    : `<div><b>RFC receptor:</b> <span class="mono">${esc(recRfc)}</span></div>` +
      `<div><b>Nombre receptor:</b> ${esc(data.receptorNombre || '\u{2014}')}</div>` +
      `<div><b>C\u{f3}digo postal del receptor:</b> ${esc(data.receptorCp || '\u{2014}')}</div>` +
      `<div><b>R\u{e9}gimen fiscal receptor:</b> ${esc(data.receptorRegimenLabel || '\u{2014}')}</div>` +
      `<div><b>Uso CFDI:</b> ${esc(data.usoCfdiLabel || '\u{2014}')}</div>`;

  if (data.esGlobal) {
    $r('rep-global-row').style.display = 'block';
    $r('rep-global-line').textContent = `Periodicidad: ${data.periodicidad || '\u{2014}'} \u{b7} Mes(es): ${data.mesesGlobalTexto || '\u{2014}'} \u{b7} A\u{f1}o: ${data.anioGlobal || '\u{2014}'}`;
  } else {
    $r('rep-global-row').style.display = 'none';
  }

  // datos del comprobante \u{2014} nombres de campo exactamente como los usa el SAT en su propia representaci\u{f3}n impresa
  $r('rep-uuid').textContent = data.uuid || '\u{2014}';
  if (folioSerie !== '\u{2014}') { $r('rep-folio-serie-row').style.display = 'block'; $r('rep-folio-serie2').textContent = folioSerie; }
  else { $r('rep-folio-serie-row').style.display = 'none'; }
  $r('rep-tipo2').textContent = tipoLabel;
  $r('rep-forma-pago').textContent = data.formaPagoLabel || '\u{2014}';
  $r('rep-metodo-pago').textContent = data.metodoPagoLabel || '\u{2014}';
  $r('rep-fecha-lugar2').textContent = fechaLugar;
  $r('rep-noCert').textContent = data.noCertificado || '\u{2014}';
  $r('rep-rfcprov').textContent = data.rfcProvCertif || '\u{2014}';
  $r('rep-fechatimbrado').textContent = cfdiFmtFecha(data.fechaTimbrado);
  $r('rep-noCertSat').textContent = data.noCertificadoSat || '\u{2014}';
  $r('rep-exportacion').textContent = data.exportacionLabel || '\u{2014}';
  $r('rep-moneda').textContent = data.moneda || '\u{2014}';

  $r('rep-conceptos').innerHTML = data.conceptos.map(c => {
    const impuestosRows = c.impuestos.map(imp => `
      <tr><td>${esc(imp.impuestoLabel)}</td><td>${esc(imp.tipoLabel)}</td><td class="r mono">${cfdiFmt6(imp.base)}</td><td>${esc(imp.tipoFactor)}</td><td class="r">${cfdiFmtTasa(imp.tasaOCuota)}</td><td class="r mono">${cfdiFmt6(imp.importe)}</td></tr>`).join('');
    return `
    <tr>
      <td class="mono">${esc(c.claveProdServ)}</td>
      <td class="mono">${esc(c.noIdentificacion)}</td>
      <td>${cfdiFmtNat(c.cant)}</td>
      <td class="mono">${esc(c.claveUnidad)}</td>
      <td>${esc(c.unidad)}</td>
      <td class="r mono">${cfdiFmtNat(c.pu)}</td>
      <td class="r mono">${cfdiFmt6(c.importe || c.cant*c.pu)}</td>
      <td class="r mono">${c.descuento > 0 ? cfdiFmt6(c.descuento) : ''}</td>
      <td>${esc(c.objetoImpLabel)}</td>
    </tr>
    <tr class="rep-concepto-detail">
      <td colspan="9">
        <div class="rep-concepto-detail-grid">
          <div><b>Descripci\u{f3}n</b><div>${esc(c.desc)}</div></div>
          ${impuestosRows ? `<table class="rep-imp-table"><thead><tr><th>Impuesto</th><th>Tipo</th><th class="r">Base</th><th>Tipo Factor</th><th class="r">Tasa o Cuota</th><th class="r">Importe</th></tr></thead><tbody>${impuestosRows}</tbody></table>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="text-align:center;color:#888">Sin conceptos</td></tr>`;

  $r('rep-subtotal').textContent = cfdiFmtMoney(data.subtotal);
  if (data.descuento > 0) { $r('rep-descuento-row').style.display = 'flex'; $r('rep-descuento').textContent = '\u{2212}' + cfdiFmtMoney(data.descuento); }
  else { $r('rep-descuento-row').style.display = 'none'; }
  if (data.ivaTraslado > 0) {
    $r('rep-traslado-row').style.display = 'flex';
    $r('rep-traslado-label').textContent = `Impuestos trasladados IVA ${cfdiFmtTasa(data.trasladoTasaPct / 100)}`;
    $r('rep-traslado').textContent = cfdiFmtMoney(data.ivaTraslado);
  } else { $r('rep-traslado-row').style.display = 'none'; }
  if (data.ivaRetenido > 0) {
    $r('rep-ret-iva-row').style.display = 'flex';
    $r('rep-ret-iva-label').textContent = 'Impuestos retenidos IVA';
    $r('rep-ret-iva').textContent = '\u{2212}' + cfdiFmtMoney(data.ivaRetenido);
  } else { $r('rep-ret-iva-row').style.display = 'none'; }
  if (data.isrRetenido > 0) {
    $r('rep-ret-isr-row').style.display = 'flex';
    $r('rep-ret-isr-label').textContent = 'Impuestos retenidos ISR';
    $r('rep-ret-isr').textContent = '\u{2212}' + cfdiFmtMoney(data.isrRetenido);
  } else { $r('rep-ret-isr-row').style.display = 'none'; }
  if (data.otroRetenido > 0) { $r('rep-ret-otro-row').style.display = 'flex'; $r('rep-ret-otro').textContent = '\u{2212}' + cfdiFmtMoney(data.otroRetenido); }
  else { $r('rep-ret-otro-row').style.display = 'none'; }
  $r('rep-total').textContent = cfdiFmtMoney(data.total);

  $r('rep-sello-cfdi').textContent = data.selloCfd || '\u{2014}';
  $r('rep-sello-sat').textContent = data.selloSat || '\u{2014}';
  $r('rep-cadena-original').textContent = data.cadenaOriginal || '\u{2014}';
}

function cfdiLoadQrLib() {
  if (window.QRCode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function cfdiSatVerifyUrl(data) {
  // Built manually instead of via URLSearchParams: the SAT verifier's server-side
  // prefill only works when "fe" is sent as literal "==" \u{2014} percent-encoding it to
  // "%3D%3D" (what URLSearchParams does) leaves the form fields empty. Confirmed
  // against the real QR embedded in a SAT-issued CFDI PDF.
  const id = encodeURIComponent(data.uuid || '');
  const re = encodeURIComponent(data.emisorRfc || '');
  const rr = encodeURIComponent(data.receptorRfc || '');
  const tt = (data.total || 0).toFixed(2);
  const fe = (data.selloCfd || '').slice(-8);
  return `https://verificacfdi.facturaelectronica.sat.gob.mx/?id=${id}&re=${re}&rr=${rr}&tt=${tt}&fe=${fe}`;
}

async function cfdiRenderQr(data) {
  const box = document.getElementById('rep-qr');
  box.innerHTML = '';
  try {
    await cfdiLoadQrLib();
    new QRCode(box, { text: cfdiSatVerifyUrl(data), width: 144, height: 144, correctLevel: QRCode.CorrectLevel.M });
  } catch (e) {
    box.innerHTML = '<div style="font-family:monospace;font-size:6px;color:#999">QR no disponible</div>';
  }
}

function cfdiHandleXmlFile(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      cfdiRawXmlText = e.target.result;
      const data = cfdiParseXml(cfdiRawXmlText);
      cfdiRepData = data;
      cfdiRenderRep(data);
      document.getElementById('cfdi-rep-wrap').style.display = 'block';
      const summary = document.getElementById('cfdi-xml-summary');
      summary.innerHTML = `<strong>UUID:</strong> <span class="mono">${esc(data.uuid || '\u{2014}')}</span><br>` +
        `<strong>Emisor:</strong> ${esc(data.emisorNombre)} (<span class="mono">${esc(data.emisorRfc)}</span>)<br>` +
        `<strong>Receptor:</strong> ${esc(data.receptorNombre)} (<span class="mono">${esc(data.receptorRfc)}</span>)<br>` +
        `<strong>Total:</strong> <span class="mono">${cfdiFmtMoney(data.total)}</span> \u{b7} Timbrado: ${esc(cfdiFmtFecha(data.fechaTimbrado))}`;
      summary.classList.add('show');
      document.getElementById('cfdi-rep-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      await cfdiRenderQr(data);
      document.getElementById('cfdi-xml-download').style.display = 'block';
      document.getElementById('cfdi-xml-download-full').style.display = 'block';

      // No vino de una tarjeta espec\u{ed}fica \u{2014} busca solicitudes pendientes con el mismo RFC receptor
      if (!cfdiActiveRequestId) {
        const matches = cfdiData.filter(c => c.status !== 'done' && c.rfc && data.receptorRfc && c.rfc.toUpperCase() === data.receptorRfc.toUpperCase());
        cfdiShowAutoMatch(matches);
      } else {
        cfdiShowSendButton();
      }
    } catch (err) {
      showToast('\u{26a0} Error al leer el XML: ' + err.message, '#FF5A1F');
    }
  };
  reader.readAsText(file);
}

function cfdiShowSendButton() {
  const sendBtn = document.getElementById('cfdi-xml-send');
  if (cfdiActiveRequestId) {
    const req = cfdiData.find(x => x.id === cfdiActiveRequestId);
    if (req) { sendBtn.style.display = 'block'; sendBtn.textContent = `\u{2709} Enviar CFDI a ${req.correo}`; sendBtn.disabled = false; return; }
  }
  sendBtn.style.display = 'none';
}

function cfdiShowAutoMatch(matches) {
  const box = document.getElementById('cfdi-xml-match');
  if (!matches.length) { box.classList.remove('show'); box.innerHTML = ''; cfdiShowSendButton(); return; }
  box.innerHTML = matches.map(m => `
    <div class="cfdi-match-row">
      <span>\u{bf}Es para la solicitud de <strong>${esc(m.razon)}</strong> (${esc(m.rfc)})?</span>
      <button class="ent-btn-sm" onclick="cfdiConfirmAutoMatch('${m.id}')">S\u{ed}, vincular</button>
    </div>`).join('') + `<button class="ent-btn-sm" onclick="document.getElementById('cfdi-xml-match').classList.remove('show')" style="margin-top:4px">No, solo generar PDF</button>`;
  box.classList.add('show');
}

function cfdiConfirmAutoMatch(reqId) {
  cfdiActiveRequestId = reqId;
  document.getElementById('cfdi-xml-match').classList.remove('show');
  const req = cfdiData.find(x => x.id === reqId);
  const ctx = document.getElementById('cfdi-xml-context');
  if (req && ctx) { ctx.textContent = `_ Vinculado a: ${req.razon} (${req.rfc}) \u{2192} se enviar\u{e1} a ${req.correo}`; ctx.classList.add('show'); }
  cfdiShowSendButton();
}

async function cfdiRenderPdfBase64() {
  await facLoadLibs();
  const sheet = document.getElementById('cfdi-rep-sheet');
  const dpiScale = Math.ceil(5100 / sheet.getBoundingClientRect().width); // 600dpi @ 8.5in wide
  const canvas = await html2canvas(sheet, { scale: dpiScale, useCORS: true, logging: false, backgroundColor: '#fff' });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ format: 'letter', unit: 'mm', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const imgH = (canvas.height * pageW) / canvas.width;
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageW, imgH);
  return { pdf, pdfBase64: pdf.output('datauristring').split(',')[1] };
}

// Naive XML pretty-printer \u{2014} CFDI XML from the SAT ships minified (no whitespace
// between tags), so it has to be reformatted before it's readable as a code block.
// Splits on tag boundaries and indents by nesting depth; self-closing tags (the
// vast majority of CFDI nodes) don't push the indent.
function prettyXml(xml) {
  const collapsed = String(xml || '').replace(/>\s*</g, '><').trim();
  const parts = collapsed.split(/(?=<)/).filter(Boolean);
  let indent = '';
  const lines = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (/^<\?/.test(part) || /\/>\s*$/.test(part)) {
      lines.push(indent + part);
    } else if (/^<\//.test(part)) {
      indent = indent.slice(0, -2);
      lines.push(indent + part);
    } else if (/^</.test(part)) {
      lines.push(indent + part);
      indent += '  ';
    } else {
      lines.push(indent + part);
    }
  }
  return lines.join('\n');
}

// Minimal XML syntax highlighter \u{2014} colors tag names and attribute name/value pairs.
// esc() already turns `"` into &quot;, so attribute values are matched post-escape.
function xmlHighlight(xml) {
  return esc(xml)
    .replace(/([\w:.-]+)=(&quot;[^&]*?&quot;)/g, '<span class="xh-attr">$1</span>=<span class="xh-val">$2</span>')
    .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="xh-tag">$2</span>');
}

function cfdiRenderXmlSheet(data, rawXml) {
  const $x = id => document.getElementById(id);
  $x('cxs-uuid').textContent = data.uuid || '\u{2014}';
  $x('cxs-fecha').textContent = cfdiFmtFecha(data.fechaTimbrado || data.fecha);
  $x('cxs-summary').innerHTML = `
    <div><b>RFC Emisor</b>${esc(data.emisorRfc || '\u{2014}')}</div>
    <div><b>RFC Receptor</b>${esc(data.receptorRfc || '\u{2014}')}</div>
    <div><b>Nombre Emisor</b>${esc(data.emisorNombre || '\u{2014}')}</div>
    <div><b>Nombre Receptor</b>${esc(data.receptorNombre || '\u{2014}')}</div>
    <div><b>Folio fiscal (UUID)</b>${esc(data.uuid || '\u{2014}')}</div>
    <div><b>Fecha de timbrado</b>${esc(cfdiFmtFecha(data.fechaTimbrado))}</div>
    <div><b>Total</b>${esc(cfdiFmtMoney(data.total))}</div>
    <div><b>Moneda</b>${esc(data.moneda || '\u{2014}')}</div>
  `;

  // .cxs-code has a fixed height (~half the page, in CSS) so the whole document
  // always lands on exactly 2 pages. Shrink the font until the pretty-printed XML
  // fits that box; if it still doesn't fit at the smallest legible size, truncate
  // the text and say so explicitly instead of silently clipping it.
  const codeEl = $x('cxs-code');
  const noteEl = $x('cxs-truncated-note');
  noteEl.style.display = 'none';

  let text = prettyXml(rawXml);
  let fontSize = 8, lineHeight = 1.55;
  const render = () => {
    codeEl.style.fontSize = fontSize + 'px';
    codeEl.style.lineHeight = lineHeight;
    codeEl.innerHTML = xmlHighlight(text);
  };
  const fits = () => codeEl.scrollHeight <= codeEl.clientHeight;

  render();
  while (!fits() && fontSize > 5.5) {
    fontSize -= 0.5;
    lineHeight = Math.max(1.25, lineHeight - 0.03);
    render();
  }
  if (!fits()) {
    // Re-rendering a large syntax-highlighted block (thousands of <span>s for a
    // long CFDI) is expensive, so estimate the cut length from the actual
    // overflow ratio instead of trimming by a fixed 10% each pass \u{2014} converges
    // in a handful of tries instead of dozens.
    for (let attempt = 0; attempt < 6 && !fits() && text.length > 200; attempt++) {
      const ratio = codeEl.clientHeight / codeEl.scrollHeight;
      const targetLen = Math.max(200, Math.floor(text.length * ratio * 0.92));
      if (targetLen >= text.length) break;
      text = text.slice(0, targetLen);
      render();
    }
    noteEl.textContent = '\u{26a0} XML truncado por espacio \u{2014} el archivo completo est\u{e1} disponible en GAPT One.';
    noteEl.style.display = 'block';
  }
}

async function cfdiRenderPdfWithXmlBase64() {
  await facLoadLibs();

  // Page 1: identical to the regular "Descargar PDF" \u{2014} same element, same capture.
  const repSheet = document.getElementById('cfdi-rep-sheet');
  const repDpiScale = Math.ceil(5100 / repSheet.getBoundingClientRect().width); // 600dpi @ 8.5in wide
  const repCanvas = await html2canvas(repSheet, { scale: repDpiScale, useCORS: true, logging: false, backgroundColor: '#fff' });

  // Page 2: XML sheet \u{2014} fixed at exactly one letter page (see cfdiRenderXmlSheet
  // for how the code block is kept from overflowing it).
  cfdiRenderXmlSheet(cfdiRepData, cfdiRawXmlText);
  const xmlWrap = document.getElementById('cfdi-xml-sheet-wrap');
  const xmlSheet = document.getElementById('cfdi-xml-sheet');
  xmlWrap.style.left = '0';
  void xmlSheet.offsetHeight;
  const xmlDpiScale = Math.ceil(5100 / xmlSheet.getBoundingClientRect().width); // 600dpi @ 8.5in wide
  let xmlCanvas;
  try {
    xmlCanvas = await html2canvas(xmlSheet, { scale: xmlDpiScale, useCORS: true, logging: false, backgroundColor: '#fff' });
  } finally {
    xmlWrap.style.left = '-9999px';
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ format: 'letter', unit: 'pt', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const repImgH = (repCanvas.height * pageW) / repCanvas.width;
  pdf.addImage(repCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageW, repImgH);
  pdf.addPage();
  pdf.addImage(xmlCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageW, pageH);

  return { pdf, pdfBase64: pdf.output('datauristring').split(',')[1] };
}

async function cfdiDownloadPdfWithXml() {
  if (!cfdiRepData) return;
  const btn = document.getElementById('cfdi-xml-download-full');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Generando PDF\u{2026}';
  try {
    const { pdf } = await cfdiRenderPdfWithXmlBase64();
    pdf.save(`CFDI-${cfdiRepData.uuid || 'representacion'}-con-xml.pdf`);
  } catch (e) {
    showToast('\u{26a0} Error generando el PDF: ' + e.message, '#FF5A1F');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

async function cfdiDownloadPdf() {
  if (!cfdiRepData) return;
  const btn = document.getElementById('cfdi-xml-download');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Generando PDF\u{2026}';
  try {
    const { pdf } = await cfdiRenderPdfBase64();
    pdf.save(`CFDI-${cfdiRepData.uuid || 'representacion'}.pdf`);
  } catch (e) {
    showToast('\u{26a0} Error generando el PDF: ' + e.message, '#FF5A1F');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

async function cfdiSendToRequest() {
  if (!cfdiRepData || !cfdiActiveRequestId) return;
  const btn = document.getElementById('cfdi-xml-send');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Generando PDF\u{2026}';
  try {
    const { pdfBase64 } = await cfdiRenderPdfBase64();
    btn.textContent = 'Enviando\u{2026}';
    const summary = {
      total: cfdiRepData.total, subtotal: cfdiRepData.subtotal,
      ivaTraslado: cfdiRepData.ivaTraslado, ivaRetenido: cfdiRepData.ivaRetenido, isrRetenido: cfdiRepData.isrRetenido,
      fechaTimbrado: cfdiRepData.fechaTimbrado, emisorRfc: cfdiRepData.emisorRfc, emisorNombre: cfdiRepData.emisorNombre,
      noCertificadoSat: cfdiRepData.noCertificadoSat,
    };
    const res = await fetch(`${WORKER}/cfdi/send-cfdi/${cfdiActiveRequestId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
      body: JSON.stringify({ pdfBase64, uuid: cfdiRepData.uuid, xmlText: cfdiRawXmlText, summary }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Error al enviar');
    showToast('\u{2713} CFDI enviado al cliente', '#19A85B');
    btn.textContent = '\u{2713} Enviado';
    const idx = cfdiData.findIndex(c => c.id === cfdiActiveRequestId);
    if (idx >= 0) { cfdiData[idx].status = 'done'; cfdiData[idx].cfdiUuid = cfdiRepData.uuid; cfdiData[idx].cfdiSummary = summary; }
    updateStats(); renderCfdi(); renderHomeCfdi();
    document.getElementById('cfdi-xml-context')?.classList.remove('show');
    cfdiActiveRequestId = null;
    setTimeout(() => { btn.style.display = 'none'; btn.disabled = false; btn.textContent = orig; }, 2000);
  } catch (e) {
    showToast('\u{26a0} ' + e.message, '#FF5A1F');
    btn.disabled = false; btn.textContent = orig;
  }
}

function initCfdiXml() {
  if (cfdiXmlInited) return;
  cfdiXmlInited = true;
  document.getElementById('cfdi-xml-input').addEventListener('change', e => { if (e.target.files[0]) cfdiHandleXmlFile(e.target.files[0]); });
  document.getElementById('cfdi-xml-download').addEventListener('click', cfdiDownloadPdf);
  document.getElementById('cfdi-xml-download-full').addEventListener('click', cfdiDownloadPdfWithXml);
  document.getElementById('cfdi-xml-send').addEventListener('click', cfdiSendToRequest);
}

/* \u{2500}\u{2500} AI ASSISTANT \u{2500}\u{2500} */
const FAC_AI_SCHEMA = {
  type:"object",
  properties:{
    resumen:{type:"string"},
    conceptos:{ type:"array", items:{ type:"object", properties:{
      concepto:{type:"string", description:"T\u{ed}tulo MUY breve (m\u{e1}x. 6-8 palabras), tipo encabezado, sin punto final. Ej: 'Anteproyecto arquitect\u{f3}nico'."},
      descripcion:{type:"string", description:"Descripci\u{f3}n m\u{e1}s larga y clara de qu\u{e9} incluye este concepto y sus entregables (1-3 frases)."},
      unidad:{type:"string"}, cantidad:{type:"number"}, precio_unitario:{type:"number"}, justificacion:{type:"string"}
    }, required:["concepto","descripcion","unidad","cantidad","precio_unitario","justificacion"], additionalProperties:false } },
    notas_sugeridas:{type:"string"}
  },
  required:["resumen","conceptos","notas_sugeridas"], additionalProperties:false
};
const FAC_AI_SYSTEM = `Eres el asistente de cotizaci\u{f3}n de THE GAPT PROJECT, un estudio de arquitectura y dise\u{f1}o en Cuernavaca, Morelos, M\u{e9}xico, dirigido por el Arq. Gustavo A. Pastrana T. (estudio joven, fundado en 2026).
Tu trabajo: a partir de la descripci\u{f3}n de un servicio de arquitectura/dise\u{f1}o que da el arquitecto, propones los conceptos para cotizar y cu\u{e1}nto cobrar.
Criterios:
- Precios en pesos mexicanos (MXN), SIN IVA.
- Mercado de referencia: Cuernavaca / Morelos / centro de M\u{e9}xico, 2026. Estudio emergente: precios competitivos pero dignos.
- Referencias usuales: proyecto arquitect\u{f3}nico residencial completo suele cotizarse por m\u{b2} (rango orientativo 250\u{2013}600 MXN/m\u{b2} seg\u{fa}n alcance); levantamientos, renders, visitas de obra y tr\u{e1}mites se cotizan por pieza/visita/servicio.
- Cada concepto tiene DOS partes separadas: "concepto" es un t\u{ed}tulo corto tipo encabezado (m\u{e1}x. 6-8 palabras, va en negritas en el documento), y "descripcion" es un texto m\u{e1}s largo y claro que explica qu\u{e9} incluye y los entregables (esa va en texto m\u{e1}s chico debajo del t\u{ed}tulo).
- Si la descripci\u{f3}n es ambigua, asume lo razonable y dilo en la justificaci\u{f3}n.`;

async function facAiGo() {
  const desc = $f('fac-aiPrompt').value.trim();
  const key = (localStorage.getItem(FAC_LS_KEY)||'').trim();
  const st = $f('fac-aiStatus');
  if (!key) { st.className='fac-ai-status err'; st.textContent='Configura tu API key de Anthropic (bot\u{f3}n \u{2699} Config).'; return; }
  if (!desc) { st.className='fac-ai-status err'; st.textContent='Describe primero el trabajo a cotizar.'; return; }
  st.className='fac-ai-status'; st.innerHTML='<span class="fac-spin"></span>Consultando a Claude\u{2026}';
  $f('fac-aiGo').disabled = true; $f('fac-aiResult').classList.remove('show');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true' },
      body:JSON.stringify({ model:'claude-opus-4-8', max_tokens:16000, system:FAC_AI_SYSTEM, output_config:{ format:{ type:'json_schema', schema:FAC_AI_SCHEMA } }, messages:[{ role:'user', content:`Trabajo a cotizar:\n${desc}` }] })
    });
    if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err?.error?.message || `Error HTTP ${res.status}`); }
    const data = await res.json();
    const text = (data.content||[]).find(b=>b.type==='text')?.text || '';
    const out = JSON.parse(text);
    facMostrarSugerencias(out);
    st.className='fac-ai-status ok'; st.textContent='Sugerencias listas. Rev\u{ed}salas y agr\u{e9}galas al documento.';
  } catch(e) {
    st.className='fac-ai-status err';
    st.textContent = 'Error: ' + (e.message||e);
  } finally {
    $f('fac-aiGo').disabled = false;
  }
}

function facMostrarSugerencias(out) {
  const box = $f('fac-aiResult');
  box.innerHTML = `
    <div class="fac-ai-summary">${esc(out.resumen)}</div>
    ${out.conceptos.map((c,i) => `
      <div class="fac-ai-sug">
        <div class="fac-ai-sug__name">${esc(c.concepto)}</div>
        <div class="fac-ai-sug__meta">${c.cantidad} ${esc(c.unidad)} \u{d7} ${facFmt(c.precio_unitario)} = ${facFmt(c.cantidad*c.precio_unitario)}</div>
        <div class="fac-ai-sug__desc" style="font-size:11px;color:var(--muted);margin-top:4px;text-align:justify">${esc(c.descripcion||'')}</div>
        <div class="fac-ai-sug__just">${esc(c.justificacion)}</div>
        <button class="ent-btn-sm" data-add="${i}" style="margin-top:6px">+ Agregar</button>
      </div>`).join('')}
    ${out.notas_sugeridas ? `<div class="fac-ai-sug"><div class="fac-ai-sug__name">Notas sugeridas</div><div class="fac-ai-sug__just">${esc(out.notas_sugeridas)}</div><button class="ent-btn-sm" data-addnotas style="margin-top:6px">+ Usar como notas</button></div>` : ''}
    <button class="fac-btn-accent" id="fac-aiAddAll" style="margin-top:6px">Agregar todos los conceptos</button>
  `;
  box.classList.add('show');
  const addConcepto = c => {
    if (facDoc.conceptos.length===1 && !facDoc.conceptos[0].desc && !facDoc.conceptos[0].pu) facDoc.conceptos = [];
    facDoc.conceptos.push({ desc:c.concepto, detalle:c.descripcion||'', cant:c.cantidad, unidad:c.unidad, pu:c.precio_unitario });
    facRenderConceptos(); facRenderSheet();
  };
  box.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { addConcepto(out.conceptos[+b.dataset.add]); b.textContent='\u{2713} Agregado'; b.disabled=true; }));
  const nb = box.querySelector('[data-addnotas]');
  if (nb) nb.addEventListener('click', () => { facDoc.notas = (facDoc.notas?facDoc.notas+'\n':'') + out.notas_sugeridas; $f('fac-fNotas').value=facDoc.notas; facRenderSheet(); nb.textContent='\u{2713} Agregado'; nb.disabled=true; });
  $f('fac-aiAddAll').addEventListener('click', () => { out.conceptos.forEach(addConcepto); $f('fac-aiAddAll').textContent='\u{2713} Agregados'; $f('fac-aiAddAll').disabled=true; box.querySelectorAll('[data-add]').forEach(b=>{b.textContent='\u{2713} Agregado';b.disabled=true;}); });
}

/* \u{2500}\u{2500} FACTURA INIT \u{2500}\u{2500} */
function initFacturaTab() {
  if (facInited) return;
  facInited = true;
  facDoc = facNuevoDoc('cotizacion');

  const binds = [['fac-fFecha','fecha'],['fac-fVigencia','vigencia'],['fac-fProyecto','proyecto'],['fac-fDescuento','descuento'],['fac-fAnticipo','anticipo'],['fac-fCondiciones','condiciones'],['fac-fNotas','notas'],['fac-fBanco','banco'],['fac-fStatus','status']];
  binds.forEach(([id,prop]) => $f(id).addEventListener('input', e => { facDoc[prop] = (e.target.type==='number') ? (parseFloat(e.target.value)||0) : e.target.value; facRenderSheet(); }));
  [['fac-cNombre','nombre'],['fac-cRfc','rfc'],['fac-cTel','tel'],['fac-cMail','mail'],['fac-cDir','dir'],['fac-cAtencion','atencion']].forEach(([id,prop]) => $f(id).addEventListener('input', e => { facDoc.cliente[prop]=e.target.value; facRenderSheet(); }));
  [['fac-tIva','iva'],['fac-tRetIsr','retIsr'],['fac-tRetIva','retIva']].forEach(([id,prop]) => $f(id).addEventListener('change', e => { facDoc[prop]=e.target.checked; facRenderSheet(); }));

  $f('fac-addConcepto').addEventListener('click', () => { facDoc.conceptos.push({desc:'',detalle:'',cant:1,unidad:'servicio',pu:0}); facRenderConceptos(); facRenderSheet(); });

  $f('fac-btnGuardar').addEventListener('click', async () => {
    facSaveDoc();
    facRenderSaved();
    facFlash('Documento guardado \u{2713}');
    try { await facCloudUpload(); } catch(_) {}
  });

  $f('fac-btnNuevo').addEventListener('click', () => { facDoc = facNuevoDoc(facDoc.tipo); facEditingId=null; facRenderTipos(); facRender(); });

  // Registrar en cobranza sin enviar correo \u{2014} misma huella que deja un env\u{ed}o real
  // (registro + link de pago), pero disparado a mano cuando haga falta.
  $f('fac-btnCobranza').addEventListener('click', async () => {
    const btn = $f('fac-btnCobranza');
    const docData = facCollectDocData();
    if (!docData.docNumber) { showToast('\u{26a0} El documento necesita folio.', '#FF5A1F'); return; }
    if (!(docData.total > 0)) { showToast('\u{26a0} El documento necesita un total mayor a cero.', '#FF5A1F'); return; }
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Registrando\u{2026}';
    try {
      const res = await fetch(WORKER + '/invoices/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
        body: JSON.stringify({ to: docData.clientEmail, ...docData }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Error desconocido');
      facSaveDoc(); facRenderSaved();
      showToast(json.alreadyExisted
        ? `\u{2713} ${docData.docNumber} actualizado en cobranza \u{2014} sin enviar correo.`
        : `\u{2713} ${docData.docNumber} agregado a cobranza \u{2014} sin enviar correo.`, '#19A85B');
    } catch (err) {
      showToast('\u{26a0} ' + err.message, '#FF5A1F');
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  });

  $f('fac-aiGo').addEventListener('click', facAiGo);

  $f('fac-btnSync').addEventListener('click', async () => {
    const btn = $f('fac-btnSync'), status = $f('fac-syncStatus');
    btn.disabled = true; btn.textContent = '\u{2026}'; status.textContent = 'Sincronizando\u{2026}';
    try {
      const count = await facCloudDownload();
      await facCloudUpload();
      status.textContent = `\u{2601} ${count} docs sincronizados`;
      facFlash(`Sync OK \u{2014} ${count} documentos \u{2713}`);
    } catch(e) {
      status.textContent = e.message.includes('401') ? '\u{2717} PIN incorrecto.' : '\u{2717} ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = '\u{2601} Sincronizar';
    }
  });

  /* config modal */
  $f('fac-btnConfig').addEventListener('click', () => {
    const cfg = facLsGet(FAC_LS_CFG, {});
    $f('fac-cfgKey').value = localStorage.getItem(FAC_LS_KEY) || '';
    $f('fac-cfgNombre').value = cfg.nombre || 'Gustavo A. Pastrana T.';
    $f('fac-cfgRfc').value = cfg.rfc || '';
    $f('fac-cfgPin').value = '';
    $f('fac-modalBg').classList.add('show');
  });
  $f('fac-cfgCancel').addEventListener('click', () => $f('fac-modalBg').classList.remove('show'));
  $f('fac-modalBg').addEventListener('click', e => { if (e.target === $f('fac-modalBg')) $f('fac-modalBg').classList.remove('show'); });
  $f('fac-cfgSave').addEventListener('click', () => {
    try { localStorage.setItem(FAC_LS_KEY, $f('fac-cfgKey').value.trim()); } catch(_) {}
    const newPin = $f('fac-cfgPin').value.trim();
    if (/^\d{4}$/.test(newPin)) try { localStorage.setItem('gapt-pin', newPin); } catch(_) {}
    facLsSet(FAC_LS_CFG, { nombre: $f('fac-cfgNombre').value.trim(), rfc: $f('fac-cfgRfc').value.trim() });
    $f('fac-modalBg').classList.remove('show');
    facRenderSheet();
  });

  /* send modal */
  $f('fac-btnEnviar').addEventListener('click', () => {
    $f('fac-sendTo').value = facDoc.cliente?.mail || ''; $f('fac-sendStatus').textContent = '';
    $f('fac-sendPortalAccess').checked = false;
    $f('fac-sendGo').disabled = false; $f('fac-sendGo').textContent = 'Enviar \u{2709}';
    $f('fac-sendModalBg').classList.add('show');
  });
  $f('fac-sendCancel').addEventListener('click', () => $f('fac-sendModalBg').classList.remove('show'));
  $f('fac-sendModalBg').addEventListener('click', e => { if (e.target === $f('fac-sendModalBg')) $f('fac-sendModalBg').classList.remove('show'); });
  $f('fac-sendGo').addEventListener('click', async () => {
    const to = $f('fac-sendTo').value.trim();
    if (!to || !to.includes('@')) { $f('fac-sendStatus').textContent = '\u{26a0} Ingresa un correo v\u{e1}lido.'; return; }
    $f('fac-sendGo').disabled = true; $f('fac-sendGo').textContent = 'Generando PDF\u{2026}'; $f('fac-sendStatus').textContent = '';
    try {
      const docData = facCollectDocData();

      // Pre-fetch Stripe invoice payment URL (valid 30 days) so it can be embedded in the PDF
      let paymentUrl = null, stripeInvoiceId = null;
      try {
        const sessRes = await fetch(WORKER + '/stripe-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
          body: JSON.stringify({ total: docData.total, docNumber: docData.docNumber, docType: docData.docType, clientName: docData.clientName, clientEmail: to, clientRfc: docData.clientRfc, tipoLabel: docData.tipoLabel }),
        });
        if (sessRes.ok) { const s = await sessRes.json(); paymentUrl = s.paymentUrl; stripeInvoiceId = s.invoiceId; }
      } catch(_) {}

      let pdfBase64=null, pdfPagadoBase64=null;
      try { const pdfs = await facGenerateBothPDFs(paymentUrl); pdfBase64=pdfs.pdfBase64; pdfPagadoBase64=pdfs.pdfPagadoBase64; } catch(_) {}
      $f('fac-sendGo').textContent = 'Enviando\u{2026}';
      const grantPortalAccess = $f('fac-sendPortalAccess').checked;
      const res = await fetch(WORKER, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-GAPT-PIN': pin }, body: JSON.stringify({ to, ...docData, pdfBase64, pdfPagadoBase64, paymentUrl, stripeInvoiceId, grantPortalAccess }) });
      const json = await res.json();
      if (res.ok && json.id) {
        $f('fac-sendStatus').style.color = 'var(--green)'; $f('fac-sendStatus').textContent = '\u{2713} Enviado correctamente.';
        $f('fac-sendGo').textContent = '\u{2713} Enviado';
        if (facDoc.status === 'borrador') { facDoc.status = 'enviado'; $f('fac-fStatus').value = 'enviado'; }
        facSaveDoc();
        facRenderSaved();
        setTimeout(() => $f('fac-sendModalBg').classList.remove('show'), 1800);
      } else throw new Error(json.message || json.name || 'Error desconocido');
    } catch(err) {
      $f('fac-sendStatus').style.color = 'var(--bad)'; $f('fac-sendStatus').textContent = '\u{2717} ' + err.message;
      $f('fac-sendGo').disabled = false; $f('fac-sendGo').textContent = 'Reintentar \u{2709}';
    }
  });

  /* spei modal */
  $f('fac-btnSpei').addEventListener('click', () => {
    const docData = facCollectDocData();
    $f('fac-speiTo').value = docData.clientEmail || '';
    $f('fac-speiFecha').value = new Date().toISOString().slice(0,10);
    $f('fac-speiRef').value=''; $f('fac-speiBanco').value=''; $f('fac-speiStatus').textContent='';
    $f('fac-speiGo').disabled = false; $f('fac-speiGo').textContent = 'Enviar comprobante \u{2709}';
    $f('fac-speiModalBg').classList.add('show');
  });
  $f('fac-speiCancel').addEventListener('click', () => $f('fac-speiModalBg').classList.remove('show'));
  $f('fac-speiModalBg').addEventListener('click', e => { if (e.target === $f('fac-speiModalBg')) $f('fac-speiModalBg').classList.remove('show'); });
  $f('fac-speiGo').addEventListener('click', async () => {
    const to = $f('fac-speiTo').value.trim();
    if (!to || !to.includes('@')) { $f('fac-speiStatus').textContent = '\u{26a0} Ingresa un correo v\u{e1}lido.'; return; }
    $f('fac-speiGo').disabled = true; $f('fac-speiGo').textContent = 'Generando PDF\u{2026}'; $f('fac-speiStatus').textContent='';
    try {
      const docData = facCollectDocData();
      const { pdfPagadoBase64 } = await facGenerateBothPDFs();
      $f('fac-speiGo').textContent = 'Enviando\u{2026}';
      const res = await fetch(WORKER + '/paid-manual', {
        method:'POST', headers:{ 'Content-Type':'application/json', 'X-GAPT-PIN': pin },
        body: JSON.stringify({ to, ...docData, pdfPagadoBase64,
          referencia: $f('fac-speiRef').value.trim(), banco: $f('fac-speiBanco').value.trim(), fechaPago: $f('fac-speiFecha').value,
          montoSpei: $f('fac-speiMonto').value.trim(), ordenante: $f('fac-speiOrdenante').value.trim(), clabe: $f('fac-speiClabe').value.trim(), concepto: $f('fac-speiConcepto').value.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.id) {
        $f('fac-speiStatus').style.color = 'var(--green)'; $f('fac-speiStatus').textContent = '\u{2713} Comprobante enviado correctamente.';
        $f('fac-speiGo').textContent = '\u{2713} Enviado';
        setTimeout(() => $f('fac-speiModalBg').classList.remove('show'), 2000);
      } else throw new Error(json.message || json.name || 'Error desconocido');
    } catch(err) {
      $f('fac-speiStatus').style.color = 'var(--bad)'; $f('fac-speiStatus').textContent = '\u{2717} ' + err.message;
      $f('fac-speiGo').disabled = false; $f('fac-speiGo').textContent = 'Reintentar \u{2709}';
    }
  });

  $f('fac-btnPreviewPagado').addEventListener('click', async () => {
    const btn = $f('fac-btnPreviewPagado');
    btn.textContent = 'Generando\u{2026}'; btn.disabled = true;
    try {
      const { pdfPagadoBase64 } = await facGenerateBothPDFs();
      if (!pdfPagadoBase64) throw new Error('No se gener\u{f3} el PDF');
      const blob = new Blob([Uint8Array.from(atob(pdfPagadoBase64), c => c.charCodeAt(0))], { type: 'application/pdf' });
      window.open(URL.createObjectURL(blob), '_blank');
    } catch(e) { showToast('\u{26a0} Error generando vista previa: ' + e.message, '#FF5A1F'); }
    finally { btn.textContent = '\u{2726} Ver sello'; btn.disabled = false; }
  });

  facRenderTipos(); facRender(); facRenderSaved(); facRenderSyncStatus();
  facCloudDownload().catch(()=>{});
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}
   ENTREGAS TAB
   \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */
let entSelectedFiles = [], entDeliveryMode = 'individual', entLastLink = '', entGroups = [];
let entSendOpt = 'now', entEntregaType = 'file', entInited = false, entActiveDetailId = null;
const ENT_CHUNK_SIZE = 50 * 1024 * 1024;
function $e(id) { return document.getElementById(id); }

function entSwitchTab(name) {
  document.querySelectorAll('.ent-inner-tab').forEach((t,i) => t.classList.toggle('active', ['nueva','grupos','historial'][i] === name));
  document.querySelectorAll('.ent-inner-panel').forEach(p => p.classList.remove('active'));
  $e('ent-tab-' + name).classList.add('active');
  if (name === 'historial') loadHistory();
}

function setEntregaType(type) {
  entEntregaType = type;
  $e('ent-section-file').style.display = type === 'file' ? 'block' : 'none';
  $e('ent-section-link').style.display = type === 'link' ? 'block' : 'none';
  $e('ent-toggle-file').classList.toggle('active', type === 'file');
  $e('ent-toggle-link').classList.toggle('active', type === 'link');
}

function entFmtSize(bytes) { return bytes > 1048576 ? (bytes/1048576).toFixed(1)+' MB' : Math.round(bytes/1024)+' KB'; }

function addFiles(fileList) {
  Array.from(fileList).forEach(f => { if (!entSelectedFiles.find(x => x.name===f.name && x.size===f.size)) entSelectedFiles.push(f); });
  renderFilePills();
}

function renderFilePills() {
  $e('ent-file-pill-list').innerHTML = entSelectedFiles.map((f,i) => `
    <div class="ent-file-pill"><div class="fname">${esc(f.name)}</div><div class="fsize">${entFmtSize(f.size)}</div><button class="ent-rm-file" onclick="removeFile(${i})">\u{2715}</button></div>`).join('');
  $e('ent-file-pills').style.display = entSelectedFiles.length ? 'flex' : 'none';
  $e('ent-drop-zone').style.display = entSelectedFiles.length ? 'none' : 'block';
}
function removeFile(i) { entSelectedFiles.splice(i,1); renderFilePills(); }
function clearEntFile() { entSelectedFiles = []; $e('ent-file-input').value=''; $e('ent-file-pills').style.display='none'; $e('ent-drop-zone').style.display='block'; }

function addContactRow(name='', email='', isMain=false) {
  const list = $e('ent-contacts-list');
  const div = document.createElement('div'); div.className = 'ent-contact-row';
  div.innerHTML = `<input type="text" placeholder="Nombre" value="${esc(name)}" style="max-width:140px"><input type="email" placeholder="correo@empresa.com" value="${esc(email)}"><button class="star${isMain?' main':''}" onclick="toggleMain(this)" title="Principal">\u{2b50}</button><button class="rmc" onclick="this.closest('.ent-contact-row').remove()">\u{2715}</button>`;
  list.appendChild(div);
  if (!document.querySelector('#ent-contacts-list .star.main')) list.querySelector('.star')?.classList.add('main');
}
function toggleMain(btn) { document.querySelectorAll('#ent-contacts-list .star').forEach(s => s.classList.remove('main')); btn.classList.add('main'); }
function getContacts() {
  return Array.from(document.querySelectorAll('#ent-contacts-list .ent-contact-row')).map(row => {
    const inputs = row.querySelectorAll('input');
    return { name: inputs[0].value.trim(), email: inputs[1].value.trim(), main: row.querySelector('.star').classList.contains('main') };
  }).filter(c => c.email);
}

function setMode(m) { entDeliveryMode = m; $e('ent-mode-individual').classList.toggle('sel', m==='individual'); $e('ent-mode-cc').classList.toggle('sel', m==='cc'); }

function initSchedule() {
  const now = new Date(); const fmt = h => String(h).padStart(2,'0');
  $e('ent-sopt-today-val').textContent = `${fmt(now.getHours())}:${fmt(now.getMinutes())}`;
  $e('ent-sopt-tomorrow-val').textContent = '09:00';
  $e('ent-f-time').value = `${fmt(now.getHours())}:${fmt(now.getMinutes())}`;
  updateSendPreview();
}
function setSendOpt(opt) {
  entSendOpt = opt;
  ['now','today','tomorrow','custom'].forEach(o => $e('ent-sopt-'+o).classList.toggle('sel', o===opt));
  $e('ent-time-row-hhmm').classList.toggle('show', opt==='today'||opt==='tomorrow');
  $e('ent-time-row-custom').classList.toggle('show', opt==='custom');
  if (opt==='tomorrow') $e('ent-f-time').value = '09:00';
  updateSendPreview();
}
function getSendAt() {
  if (entSendOpt === 'now') return '';
  if (entSendOpt !== 'custom') {
    const [h,m] = $e('ent-f-time').value.split(':').map(Number);
    const d = new Date();
    if (entSendOpt === 'tomorrow') d.setDate(d.getDate()+1);
    d.setHours(h,m,0,0); return d.toISOString();
  }
  const val = $e('ent-f-sendat').value;
  return val ? new Date(val).toISOString() : '';
}
function updateSendPreview() {
  const el = $e('ent-send-preview');
  if (entSendOpt === 'now') { el.textContent = 'Env\u{ed}o inmediato al hacer clic en Enviar'; return; }
  if (entSendOpt === 'custom' && !$e('ent-f-sendat').value) { el.textContent = 'Elige la fecha y hora exacta'; return; }
  const iso = getSendAt();
  if (!iso) { el.textContent = ''; return; }
  el.textContent = '\u{23f0} Se enviar\u{e1} el ' + new Date(iso).toLocaleString('es-MX', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
}

function genPin() { $e('ent-f-pin').value = String(Math.floor(1000 + Math.random()*9000)); }

async function loadGroups() {
  const res = await fetch(WORKER + '/groups', { headers: { 'X-GAPT-PIN': pin } });
  entGroups = res.ok ? await res.json() : [];
  renderGroupSelector(); renderGroupsList();
}
async function saveGroups() { await fetch(WORKER + '/groups', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-GAPT-PIN': pin }, body: JSON.stringify(entGroups) }); }

function renderGroupSelector() {
  const sel = $e('ent-group-sel'); const cur = sel.value;
  sel.innerHTML = '<option value="">\u{2014} Sin grupo \u{2014}</option>' + entGroups.map(g => `<option value="${g.id}">${esc(g.name)} (${g.contacts.length})</option>`).join('');
  sel.value = cur;
}
function applyGroup() {
  const id = $e('ent-group-sel').value; if (!id) return;
  const g = entGroups.find(g => g.id === id); if (!g) return;
  const list = $e('ent-contacts-list'); list.innerHTML = '';
  g.contacts.forEach(c => addContactRow(c.name, c.email, c.main));
}
function renderGroupsList() {
  const container = $e('ent-groups-list');
  if (!entGroups.length) { container.innerHTML = '<div class="empty">No hay grupos a\u{fa}n.</div>'; return; }
  container.innerHTML = entGroups.map(g => `
    <div class="ent-group-card">
      <div class="ent-group-head">
        <div><span class="ent-group-name">${esc(g.name)}</span><span class="ent-group-count">${g.contacts.length} contacto${g.contacts.length!==1?'s':''}</span></div>
        <button class="ent-btn-sm red" onclick="deleteGroup('${g.id}')">Eliminar</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${g.contacts.map(c => `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;font-size:12px;color:${c.main?'var(--cream)':'var(--muted)'}">${esc(c.name||'')} <span class="mono" style="font-size:10px">&lt;${esc(c.email)}&gt;</span></div>${c.main?'<span class="ent-main-badge">Principal</span>':''}</div>`).join('')}
      </div>
    </div>`).join('');
}
function showNewGroupForm() { $e('ent-new-group-form').classList.add('show'); $e('ent-ng-contacts').innerHTML=''; $e('ent-ng-name').value=''; addNGContact('','',true); }
function cancelNewGroup() { $e('ent-new-group-form').classList.remove('show'); }
function addNGContact(name='', email='', isMain=false) {
  const list = $e('ent-ng-contacts');
  const div = document.createElement('div'); div.className='ent-contact-row';
  div.innerHTML = `<input type="text" placeholder="Nombre" value="${esc(name)}" style="max-width:140px"><input type="email" placeholder="correo@empresa.com" value="${esc(email)}"><button class="star${isMain?' main':''}" onclick="toggleNGMain(this)" title="Principal">\u{2b50}</button><button class="rmc" onclick="this.closest('.ent-contact-row').remove()">\u{2715}</button>`;
  list.appendChild(div);
}
function toggleNGMain(btn) { document.querySelectorAll('#ent-ng-contacts .star').forEach(s => s.classList.remove('main')); btn.classList.add('main'); }
async function saveNewGroup() {
  const name = $e('ent-ng-name').value.trim();
  if (!name) { showToast('\u{26a0} Ponle un nombre al grupo.', '#FF5A1F'); return; }
  const contacts = Array.from(document.querySelectorAll('#ent-ng-contacts .ent-contact-row')).map(row => {
    const inputs = row.querySelectorAll('input');
    return { name: inputs[0].value.trim(), email: inputs[1].value.trim(), main: row.querySelector('.star').classList.contains('main') };
  }).filter(c => c.email);
  if (!contacts.length) { showToast('\u{26a0} Agrega al menos un contacto con correo.', '#FF5A1F'); return; }
  entGroups.push({ id: 'grp-'+Date.now().toString(36), name, contacts });
  await saveGroups(); cancelNewGroup(); renderGroupSelector(); renderGroupsList();
}
async function deleteGroup(id) {
  if (!(await gConfirm('\u{bf}Eliminar este grupo?', { confirmLabel: 'Eliminar', danger: true }))) return;
  entGroups = entGroups.filter(g => g.id !== id);
  await saveGroups(); renderGroupSelector(); renderGroupsList();
}

async function sendEntrega() {
  const contacts = getContacts();
  const cpin = $e('ent-f-pin').value.trim();
  if (!entSelectedFiles.length && entEntregaType === 'file') { showToast('\u{26a0} Selecciona al menos un archivo.', '#FF5A1F'); return; }
  if (!contacts.length) { showToast('\u{26a0} Agrega al menos un contacto con correo.', '#FF5A1F'); return; }
  if (!cpin) { showToast('\u{26a0} Define un PIN de acceso.', '#FF5A1F'); return; }
  const sendAt = getSendAt();
  if (entSendOpt === 'custom' && !sendAt) { showToast('\u{26a0} Elige la fecha y hora de env\u{ed}o.', '#FF5A1F'); return; }

  const btn = $e('ent-btn-send'); btn.disabled = true;
  const pw = $e('ent-prog-wrap'), pb = $e('ent-prog-bar');
  pw.style.display = 'block'; pb.style.width = '0%';

  const message = $e('ent-f-msg').value.trim();
  const fromEmail = $e('ent-f-from').value;
  const sendAtIso = sendAt ? new Date(sendAt).toISOString() : null;

  try {
    let data;
    if (entEntregaType === 'link') {
      const url = $e('ent-ext-url').value.trim();
      const name = $e('ent-ext-name').value.trim() || url;
      if (!url) { showToast('\u{26a0} Pega la URL del enlace.', '#FF5A1F'); btn.disabled=false; pw.style.display='none'; return; }
      btn.textContent = 'Enviando...';
      const res = await fetch(WORKER + '/entregas/link', { method:'POST', headers:{ 'X-GAPT-PIN':pin, 'Content-Type':'application/json' }, body: JSON.stringify({ url, name, contacts, mode: entDeliveryMode, message, clientPin: cpin, fromEmail, sendAt: sendAtIso }) });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
    } else {
      const totalSize = entSelectedFiles.reduce((s,f) => s+f.size, 0);
      if (totalSize <= 90*1024*1024) {
        btn.textContent = 'Subiendo...';
        let pct = 0;
        const ticker = setInterval(() => { pct = Math.min(pct + Math.random()*6, 88); pb.style.width = pct+'%'; }, 350);
        const fd = new FormData();
        entSelectedFiles.forEach(f => fd.append('file', f));
        fd.append('contacts', JSON.stringify(contacts)); fd.append('mode', entDeliveryMode); fd.append('message', message);
        fd.append('clientPin', cpin); fd.append('fromEmail', fromEmail);
        if (sendAtIso) fd.append('sendAt', sendAtIso);
        const res = await fetch(WORKER + '/entregas/upload', { method:'POST', headers:{ 'X-GAPT-PIN':pin }, body: fd });
        clearInterval(ticker); pb.style.width = '100%';
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
      } else {
        data = await sendChunked({ contacts, cpin, message, fromEmail, sendAt: sendAtIso, pb, btn });
      }
    }
    entLastLink = data.link;
    const names = contacts.map(c => c.name || c.email).join(', ');
    const scheduled = data.status === 'pending';
    let successText = scheduled
      ? `Archivos guardados. El email se enviar\u{e1} el ${new Date(sendAt).toLocaleString('es-MX')} a: ${names}. PIN: ${cpin}`
      : `Email${contacts.length>1?'s enviados':' enviado'} a: ${names}. PIN de descarga: ${cpin}`;
    if (data.emailError) successText = `\u{26a0} Archivo subido pero el email no se pudo enviar: ${data.emailError}\nPIN: ${cpin} \u{b7} Link: ${data.link}`;
    $e('ent-success-msg').textContent = successText;
    $e('ent-success-link').textContent = data.link;
    $e('ent-success-box').style.display = 'block';
    btn.style.display = 'none';
    loadHistory();
  } catch(err) {
    pw.style.display = 'none';
    showToast('\u{26a0} Error: ' + err.message, '#FF5A1F');
    btn.disabled = false; btn.textContent = 'Enviar entrega \u{2192}';
  }
}

async function sendChunked({ contacts, cpin, message, fromEmail, sendAt, pb, btn }) {
  const totalBytes = entSelectedFiles.reduce((s,f) => s+f.size, 0);
  let uploaded = 0;
  btn.textContent = 'Iniciando subida...';
  let startRes;
  try {
    startRes = await fetch(WORKER + '/entregas/upload-start', { method:'POST', headers:{ 'X-GAPT-PIN':pin, 'Content-Type':'application/json' }, body: JSON.stringify({ files: entSelectedFiles.map(f => ({ filename:f.name, size:f.size })), contacts, mode: entDeliveryMode, message, clientPin: cpin, fromEmail, sendAt }) });
  } catch(e) { throw new Error('PASO 1 (iniciar): ' + e.message); }
  const startData = await startRes.json();
  if (!startRes.ok) throw new Error('PASO 1: ' + (startData.error || startRes.status));
  const { id } = startData;
  const allParts = [];
  for (let fi=0; fi<entSelectedFiles.length; fi++) {
    const file = entSelectedFiles[fi];
    const fileParts = []; const totalChunks = Math.ceil(file.size / ENT_CHUNK_SIZE);
    for (let partNum=1; partNum<=totalChunks; partNum++) {
      btn.textContent = entSelectedFiles.length>1 ? `Archivo ${fi+1}/${entSelectedFiles.length} \u{b7} parte ${partNum}/${totalChunks}` : `Parte ${partNum} de ${totalChunks}`;
      const chunk = file.slice((partNum-1)*ENT_CHUNK_SIZE, partNum*ENT_CHUNK_SIZE);
      let partRes;
      try { partRes = await fetch(`${WORKER}/entregas/upload-part/${id}/${fi}/${partNum}`, { method:'POST', headers:{ 'X-GAPT-PIN':pin, 'Content-Type':'application/octet-stream' }, body: chunk }); }
      catch(e) { throw new Error(`PASO 2 (chunk ${partNum}): ` + e.message); }
      const partData = await partRes.json();
      if (!partRes.ok) throw new Error(`PASO 2 (chunk ${partNum}): ` + (partData.error || partRes.status));
      fileParts.push({ partNumber: partData.partNumber, etag: partData.etag });
      uploaded += chunk.size; pb.style.width = Math.round((uploaded/totalBytes)*95)+'%';
    }
    allParts.push({ fileIdx: fi, parts: fileParts });
  }
  btn.textContent = 'Finalizando...';
  let finRes;
  try { finRes = await fetch(`${WORKER}/entregas/upload-finish/${id}`, { method:'POST', headers:{ 'X-GAPT-PIN':pin, 'Content-Type':'application/json' }, body: JSON.stringify({ parts: allParts }) }); }
  catch(e) { throw new Error('PASO 3 (finalizar): ' + e.message); }
  const finData = await finRes.json();
  if (!finRes.ok) throw new Error('PASO 3: ' + (finData.error || finRes.status));
  pb.style.width = '100%';
  return finData;
}

function copyLink() { navigator.clipboard.writeText(entLastLink).then(() => showToast('\u{2713} Enlace copiado', '#19A85B')); }

function resetEntForm() {
  clearEntFile();
  $e('ent-contacts-list').innerHTML = ''; addContactRow();
  $e('ent-f-msg').value = ''; $e('ent-group-sel').value = '';
  genPin(); setSendOpt('now');
  $e('ent-success-box').style.display = 'none';
  $e('ent-prog-wrap').style.display = 'none'; $e('ent-prog-bar').style.width = '0%';
  const btn = $e('ent-btn-send'); btn.style.display='block'; btn.disabled=false; btn.textContent='Enviar entrega \u{2192}';
  setMode('individual');
}

async function loadHistory() {
  const c = $e('ent-hist-list');
  try {
    const res = await fetch(WORKER + '/entregas/list', { headers: { 'X-GAPT-PIN': pin } });
    const list = await res.json();
    if (!list.length) { c.innerHTML = '<div class="empty">No hay entregas a\u{fa}n.</div>'; return; }
    const now = Date.now();
    const rows = list.map(d => {
      const expired = now > d.expiresAt;
      const status = expired ? 'expired' : d.status;
      const label = { sent:'\u{2713} Enviado', pending:'\u{23f3} Pendiente', expired:'\u{2715} Expirado' }[status] || d.status;
      const downloaded = d.downloadedAt && !expired;
      const names = (d.contacts||[]).map(c => c.name || c.email).join(', ');
      const sendDate = new Date(d.sendAt || d.createdAt).toLocaleDateString('es-MX', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      return `<tr>
        <td><div class="ent-fname">${esc(d.filename)}</div><div class="ent-fsub">${esc(names)}</div></td>
        <td><span class="ent-badge ${status}">${label}</span>${downloaded?'<span class="ent-badge downloaded" style="margin-left:4px">\u{2193}</span>':''}</td>
        <td><div class="ent-fsub">${sendDate}</div></td>
        <td><button class="ent-btn-sm" onclick="openDetail('${d.id}')">Ver \u{2192}</button></td>
        <td><button class="ent-btn-sm red" onclick="deleteDelivery('${d.id}',this)">\u{1f5d1}</button></td>
      </tr>`;
    }).join('');
    c.innerHTML = `<table class="ent-dl-table"><thead><tr><th>Archivo / Para</th><th>Estado</th><th>Env\u{ed}o</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch { c.innerHTML = '<div class="empty">Error al cargar historial.</div>'; }
}

async function deleteDelivery(id, btn) {
  if (!(await gConfirm('\u{bf}Eliminar esta entrega permanentemente?', { confirmLabel: 'Eliminar', danger: true }))) return;
  btn.textContent = '...';
  await fetch(WORKER + '/entregas/delete/' + id, { method:'DELETE', headers:{ 'X-GAPT-PIN': pin } });
  loadHistory();
}

async function openDetail(id) {
  entActiveDetailId = id;
  $e('ent-drawer-msg').textContent = ''; $e('ent-drawer-msg').className = 'ent-drawer-msg';
  $e('ent-btn-resend').disabled = false; $e('ent-btn-resend').textContent = 'Reenviar email \u{2192}';
  $e('ent-d-filename').textContent = '...'; $e('ent-d-contacts').textContent = '...';
  $e('ent-d-link').textContent = '...'; $e('ent-d-pin').textContent = '...';
  $e('ent-d-dl-status').innerHTML = '<div class="ent-dl-dot no"></div><span>Cargando...</span>';
  $e('ent-drawer-overlay').classList.add('open'); $e('ent-detail-drawer').classList.add('open');
  try {
    const res = await fetch(WORKER + '/entregas/detail/' + id, { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) throw new Error('No encontrado');
    const d = await res.json();
    const files = d.files || [];
    const fileLabel = files.length === 1 ? files[0].filename : `${files.length} archivos`;
    const names = (d.contacts||[]).map(c => c.name ? `${c.name} <${c.email}>` : c.email).join(' \u{b7} ');
    const expired = Date.now() > d.expiresAt;
    $e('ent-drawer-title').textContent = fileLabel;
    $e('ent-d-filename').textContent = fileLabel;
    $e('ent-d-contacts').textContent = names || '\u{2014}';
    $e('ent-d-link').textContent = d.link;
    $e('ent-d-pin').textContent = d.clientPin;
    let dlHtml;
    if (expired) dlHtml = '<div class="ent-dl-dot no"></div><span style="color:#FF6B6B">Entrega expirada</span>';
    else if (d.downloadedAt) {
      const dlDate = new Date(d.downloadedAt).toLocaleString('es-MX', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      const count = d.downloadCount > 1 ? ` \u{b7} ${d.downloadCount} veces` : '';
      dlHtml = `<div class="ent-dl-dot yes"></div><span style="color:var(--green)">Descargado el ${dlDate}${count}</span>`;
    } else dlHtml = '<div class="ent-dl-dot no"></div><span>Sin descargar a\u{fa}n</span>';
    $e('ent-d-dl-status').innerHTML = dlHtml;
    if (expired) { $e('ent-btn-resend').disabled = true; $e('ent-btn-resend').textContent = 'Entrega expirada'; }
  } catch (e) { $e('ent-d-filename').textContent = 'Error al cargar'; }
}
function closeDetail() { $e('ent-drawer-overlay').classList.remove('open'); $e('ent-detail-drawer').classList.remove('open'); entActiveDetailId = null; }
function copyDetail(elId, isPin=false) {
  const val = document.getElementById(elId).textContent.trim();
  navigator.clipboard.writeText(val).then(() => {
    const msg = $e('ent-drawer-msg');
    msg.textContent = isPin ? '\u{2713} PIN copiado' : '\u{2713} Link copiado'; msg.className = 'ent-drawer-msg ok';
    setTimeout(() => { msg.textContent=''; msg.className='ent-drawer-msg'; }, 2000);
  });
}
async function resendDelivery() {
  if (!entActiveDetailId) return;
  const btn = $e('ent-btn-resend'), msg = $e('ent-drawer-msg');
  btn.disabled = true; btn.textContent = 'Enviando...'; msg.textContent=''; msg.className='ent-drawer-msg';
  try {
    const res = await fetch(WORKER + '/entregas/resend/' + entActiveDetailId, { method:'POST', headers:{ 'X-GAPT-PIN': pin } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    msg.textContent = '\u{2713} Email reenviado'; msg.className='ent-drawer-msg ok'; btn.textContent='\u{2713} Enviado';
  } catch (e) {
    msg.textContent = '\u{2717} ' + e.message; msg.className='ent-drawer-msg err';
    btn.disabled = false; btn.textContent = 'Reenviar email \u{2192}';
  }
}

/* \u{2500}\u{2500} ENTREGAS INIT \u{2500}\u{2500} */
function initEntregasTab() {
  if (entInited) return;
  entInited = true;
  const dropZone = $e('ent-drop-zone'), fileInput = $e('ent-file-input');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) addFiles(fileInput.files); });
  $e('ent-file-input-extra').addEventListener('change', function() { if (this.files.length) addFiles(this.files); });

  genPin(); initSchedule(); addContactRow();
  loadGroups();
  document.addEventListener('change', e => { if (e.target.id === 'ent-f-time' || e.target.id === 'ent-f-sendat') updateSendPreview(); });
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}
   CLIENTES TAB (CRM)
   \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */
const CLI_LS = 'gapt-clients';
let cliEditingId = null, cliInited = false;
function $c(id) { return document.getElementById(id); }
function cliGet() { try { return JSON.parse(localStorage.getItem(CLI_LS)) || []; } catch(_) { return []; } }
function cliSet(list) { try { localStorage.setItem(CLI_LS, JSON.stringify(list)); } catch(_) {} }

function initClientesTab() {
  if (cliInited) return;
  cliInited = true;
  renderClientList();
}

function openNewClientModal() {
  cliEditingId = null;
  $c('cli-modal-title').textContent = 'Nuevo cliente.';
  $c('cli-nombre').value = ''; $c('cli-rfc').value = ''; $c('cli-email').value = ''; $c('cli-tel').value = '';
  $c('cli-status').textContent = '';
  $c('cli-modalBg').classList.add('show');
}
function openEditClientModal(id) {
  const cli = cliGet().find(c => c.id === id);
  if (!cli) return;
  cliEditingId = id;
  $c('cli-modal-title').textContent = 'Editar cliente.';
  $c('cli-nombre').value = cli.nombre || ''; $c('cli-rfc').value = cli.rfc || '';
  $c('cli-email').value = cli.email || ''; $c('cli-tel').value = cli.tel || '';
  $c('cli-status').textContent = '';
  $c('cli-modalBg').classList.add('show');
}
function closeClientModal() { $c('cli-modalBg').classList.remove('show'); }

function saveClient() {
  const nombre = $c('cli-nombre').value.trim();
  const email = $c('cli-email').value.trim();
  if (!nombre) { $c('cli-status').textContent = '\u{26a0} El nombre es obligatorio.'; return; }
  const list = cliGet();
  if (cliEditingId) {
    const i = list.findIndex(c => c.id === cliEditingId);
    if (i >= 0) list[i] = { ...list[i], nombre, rfc: $c('cli-rfc').value.trim(), email, tel: $c('cli-tel').value.trim() };
  } else {
    list.push({ id: 'cli-'+Date.now().toString(36), nombre, rfc: $c('cli-rfc').value.trim(), email, tel: $c('cli-tel').value.trim(), createdAt: Date.now() });
  }
  cliSet(list);
  closeClientModal();
  renderClientList();
}

async function deleteClient(id) {
  if (!(await gConfirm('\u{bf}Eliminar este cliente? (no borra su historial de documentos/entregas)', { confirmLabel: 'Eliminar', danger: true }))) return;
  cliSet(cliGet().filter(c => c.id !== id));
  renderClientList();
}

function cliHistoryFor(email) {
  if (!email) return { docs: [], entregas: [] };
  const docs = facLsGet(FAC_LS_DOCS, []).filter(d => (d.cliente?.mail || '').toLowerCase() === email.toLowerCase());
  const entregas = entData.filter(e => (e.contacts||[]).some(c => (c.email||'').toLowerCase() === email.toLowerCase()));
  return { docs, entregas };
}

function renderClientList() {
  const list = cliGet();
  const el = $c('cli-list');
  if (!list.length) { el.innerHTML = '<div class="empty">Sin clientes a\u{fa}n. Agrega el primero.</div>'; return; }
  el.innerHTML = list.map(c => {
    const { docs, entregas } = cliHistoryFor(c.email);
    return `<div class="cli-card" onclick="openClientDetail('${c.id}')">
      <div class="cli-name">${esc(c.nombre)}</div>
      <div class="cli-meta">${c.rfc ? esc(c.rfc) + ' \u{b7} ' : ''}${esc(c.email || 'sin email')}${c.tel ? ' \u{b7} ' + esc(c.tel) : ''}</div>
      <div class="cli-stats-mini"><span><b>${docs.length}</b> docs</span><span><b>${entregas.length}</b> entregas</span></div>
    </div>`;
  }).join('');
}

function openClientDetail(id) {
  const cli = cliGet().find(c => c.id === id);
  if (!cli) return;
  const { docs, entregas } = cliHistoryFor(cli.email);
  $c('cli-list-view').style.display = 'none';
  const dv = $c('cli-detail-view');
  dv.style.display = 'block';

  const docsHtml = docs.length ? docs.slice().reverse().map(d => {
    const old = facDoc; facDoc = d; const tot = facCalc().total; facDoc = old;
    return `<div class="cli-hist-item"><div class="h-main"><div class="h-title">${esc(FAC_TIPOS[d.tipo]?.nombre || d.tipo)} \u{b7} ${esc(d.folio)}</div><div class="h-sub">${esc(d.status)} \u{b7} ${new Date(d.updatedAt||0).toLocaleDateString('es-MX')}</div></div><div class="h-amt">${facFmt(tot)}</div></div>`;
  }).join('') : '<div class="empty">Sin documentos de facturaci\u{f3}n</div>';

  const entHtml = entregas.length ? entregas.slice().reverse().map(e => {
    const expired = e.expiresAt < Date.now();
    return `<div class="cli-hist-item"><div class="h-main"><div class="h-title">${esc(e.filename)}</div><div class="h-sub">${expired?'Expirada':'Activa'} \u{b7} ${timeAgo(e.createdAt)}</div></div></div>`;
  }).join('') : '<div class="empty">Sin entregas enviadas</div>';

  dv.innerHTML = `
    <span class="cli-detail-back" onclick="closeClientDetail()">\u{2190} Volver a clientes</span>
    <div class="cli-detail-head">
      <h2>${esc(cli.nombre)}</h2>
      <div class="cli-meta">${cli.rfc ? esc(cli.rfc) + ' \u{b7} ' : ''}${esc(cli.email || 'sin email')}${cli.tel ? ' \u{b7} ' + esc(cli.tel) : ''}</div>
      <div class="fac-actions-row" style="margin-top:14px;margin-bottom:0">
        <button class="gbtn" onclick="openEditClientModal('${cli.id}')">Editar</button>
        <button class="gbtn" onclick="deleteClient('${cli.id}')">Eliminar</button>
      </div>
    </div>
    <div class="section-label">_ Cotizaciones / Facturas</div>
    ${docsHtml}
    <div class="section-label" style="margin-top:20px">_ Entregas enviadas</div>
    ${entHtml}
  `;
}
function closeClientDetail() { $c('cli-detail-view').style.display = 'none'; $c('cli-list-view').style.display = 'block'; renderClientList(); }

/* ── PROYECTOS (obra) — dashboard de progreso/presupuesto que alimenta el portal ── */
const PROY_STATUS_LABEL = { lead: 'Lead', cotizado: 'Cotizado', activo: 'Activo', en_obra: 'En obra', cerrado: 'Cerrado', cancelado: 'Cancelado' };
const PROY_STATUS_COLOR = { lead: 'var(--warn)', cotizado: 'var(--blue)', activo: '#60a5fa', en_obra: 'var(--warn)', cerrado: 'var(--green)', cancelado: 'var(--muted)' };

async function loadProyectosAdmin() {
  const list = $c('proy-list');
  try {
    const res = await fetch(WORKER + '/obra/admin/proyectos', { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) throw new Error('PIN incorrecto o error de red');
    const data = await res.json();
    window.__proyAdminCache = data.proyectos || [];
    renderProyectosAdminList();
  } catch (e) {
    list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function renderProyectosAdminList() {
  const list = $c('proy-list');
  const proyectos = window.__proyAdminCache || [];
  if (!proyectos.length) { list.innerHTML = '<div class="empty">Sin proyectos todav\u{ed}a</div>'; return; }
  list.innerHTML = proyectos.map(p => `
    <div class="cli-card" onclick="openProyectoAdminDetail('${p.id}')">
      <div class="cli-name">${esc(p.nombre)}</div>
      <div class="cli-meta">${esc(p.cliente_nombre || '')} \u{b7} ${esc(p.cliente_email || '')}</div>
      <div class="cli-stats-mini">
        <span class="status-badge" style="border-color:${PROY_STATUS_COLOR[p.status] || 'var(--muted)'};color:${PROY_STATUS_COLOR[p.status] || 'var(--muted)'}">${esc(PROY_STATUS_LABEL[p.status] || p.status)}</span>
        <span>Avance <b>${p.progress}%</b></span>
        <span>Presupuesto <b>$${Number(p.budget_total || 0).toLocaleString('es-MX')}</b></span>
      </div>
    </div>`).join('');
}

function openProyectoAdminDetail(id) {
  const p = (window.__proyAdminCache || []).find(x => x.id === id);
  if (!p) return;
  $c('proy-list-view').style.display = 'none';
  const dv = $c('proy-detail-view');
  dv.style.display = 'block';
  dv.innerHTML = `
    <button class="fac-btn-sm" style="width:auto;padding:8px 14px;margin-bottom:16px" onclick="closeProyectoAdminDetail()">\u{2190} Volver</button>
    <div class="section-label">_ ${esc(p.nombre)}</div>
    <div class="cli-meta" style="margin-bottom:16px">${esc(p.cliente_nombre || '')} \u{b7} ${esc(p.cliente_email || '')} \u{b7} ${esc(p.direccion_inmueble || '')}</div>
    <div class="fac-field"><label>Nombre del proyecto</label><input id="proy-e-nombre" value="${esc(p.nombre)}"></div>
    <div class="fac-field"><label>Status</label>
      <select id="proy-e-status">
        ${Object.entries(PROY_STATUS_LABEL).map(([k, l]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="fac-field"><label>Avance (%)</label><input id="proy-e-progress" type="number" min="0" max="100" value="${p.progress}"></div>
    <div class="fac-field"><label>Presupuesto total</label><input id="proy-e-budget-total" type="number" min="0" value="${p.budget_total}"></div>
    <div class="fac-field"><label>Presupuesto pagado</label><input id="proy-e-budget-paid" type="number" min="0" value="${p.budget_paid}"></div>
    <button class="fac-btn" onclick="saveProyectoAdmin('${p.id}')" style="width:100%;margin-top:8px">Guardar cambios</button>
    <div id="proy-e-status-msg" style="font-family:monospace;font-size:10px;margin-top:8px;display:none"></div>
  `;
}

function closeProyectoAdminDetail() {
  $c('proy-detail-view').style.display = 'none';
  $c('proy-list-view').style.display = 'block';
}

async function saveProyectoAdmin(id) {
  const nombre = $c('proy-e-nombre').value.trim();
  const status = $c('proy-e-status').value;
  const progress = Number($c('proy-e-progress').value) || 0;
  const budget_total = Number($c('proy-e-budget-total').value) || 0;
  const budget_paid = Number($c('proy-e-budget-paid').value) || 0;
  const msgEl = $c('proy-e-status-msg');
  msgEl.style.display = 'block'; msgEl.style.color = 'var(--muted)'; msgEl.textContent = 'Guardando\u{2026}';
  try {
    const res = await fetch(`${WORKER}/obra/admin/proyectos/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
      body: JSON.stringify({ nombre, status, progress, budget_total, budget_paid }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    msgEl.style.color = 'var(--green)'; msgEl.textContent = '\u{2713} Guardado';
    const idx = (window.__proyAdminCache || []).findIndex(x => x.id === id);
    if (idx >= 0) window.__proyAdminCache[idx] = { ...window.__proyAdminCache[idx], ...data.proyecto };
  } catch (e) {
    msgEl.style.color = 'var(--bad)'; msgEl.textContent = '\u{2717} ' + e.message;
  }
}

/* ── MENSAJES (obra) — conversaciones cliente \u{2194} GAPT, por proyecto ── */
async function loadMensajesAdmin() {
  const list = $c('msg-admin-list');
  try {
    const res = await fetch(WORKER + '/obra/admin/mensajes', { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) throw new Error('PIN incorrecto o error de red');
    const data = await res.json();
    window.__msgAdminCache = data.hilos || [];
    renderMensajesAdminList();
  } catch (e) {
    list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function renderMensajesAdminList() {
  const list = $c('msg-admin-list');
  const hilos = window.__msgAdminCache || [];
  if (!hilos.length) { list.innerHTML = '<div class="empty">Sin conversaciones todav\u{ed}a</div>'; return; }
  list.innerHTML = hilos.map(h => `
    <div class="cli-hist-item" style="cursor:pointer" onclick="openMensajeAdminDetail('${h.id}')">
      <div class="h-main">
        <div class="h-title">${esc(h.topic)} ${h.unread ? `<span class="status-badge" style="border-color:var(--orange);color:var(--orange);margin-left:6px">${h.unread} nuevo${h.unread > 1 ? 's' : ''}</span>` : ''}</div>
        <div class="h-sub">${esc(h.cliente_nombre || '')} \u{b7} ${esc(h.proyecto_nombre || '')} \u{b7} ${timeAgo(new Date(h.last_message_at).getTime())}</div>
      </div>
    </div>`).join('');
}

async function openMensajeAdminDetail(id) {
  $c('msg-list-view').style.display = 'none';
  const dv = $c('msg-detail-view');
  dv.style.display = 'block';
  dv.innerHTML = '<div class="empty">Cargando\u{2026}</div>';
  try {
    const res = await fetch(`${WORKER}/obra/admin/mensajes/${id}`, { headers: { 'X-GAPT-PIN': pin } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar');
    const h = data.hilo;
    const msgsHtml = (data.mensajes || []).map(m => `
      <div class="cli-hist-item">
        <div class="h-main">
          <div class="h-sub" style="margin-bottom:3px">${m.from_type === 'gapt' ? 'T\u{fa}' : esc(h.cliente_nombre || 'Cliente')} \u{b7} ${new Date(m.created_at).toLocaleString('es-MX')}</div>
          <div class="h-title" style="font-weight:400">${esc(m.body)}</div>
        </div>
      </div>`).join('');
    dv.innerHTML = `
      <button class="fac-btn-sm" style="width:auto;padding:8px 14px;margin-bottom:16px" onclick="closeMensajeAdminDetail()">\u{2190} Volver</button>
      <div class="section-label">_ ${esc(h.topic)}</div>
      <div class="cli-meta" style="margin-bottom:16px">${esc(h.cliente_nombre || '')} \u{b7} ${esc(h.cliente_email || '')} \u{b7} ${esc(h.proyecto_nombre || '')}</div>
      <div id="msg-thread-msgs">${msgsHtml}</div>
      <div class="fac-field" style="margin-top:16px"><label>Responder</label><textarea id="msg-e-reply" rows="3" placeholder="Escribe tu respuesta..."></textarea></div>
      <button class="fac-btn" style="width:100%" onclick="sendMensajeAdminReply('${id}')">Enviar respuesta</button>
      <div id="msg-e-status" style="font-family:monospace;font-size:10px;margin-top:8px;display:none"></div>
    `;
  } catch (e) {
    dv.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function closeMensajeAdminDetail() {
  $c('msg-detail-view').style.display = 'none';
  $c('msg-list-view').style.display = 'block';
  loadMensajesAdmin();
}

/* ── INVITACIONES privadas a Alta de Proyecto (/nuevo/?t=token) ── */
const INVITE_STATUS_LABEL = { pendiente: 'Pendiente', usada: 'Usada', cancelada: 'Cancelada' };
const INVITE_STATUS_COLOR = { pendiente: 'var(--warn)', usada: 'var(--green)', cancelada: 'var(--muted)' };

function openInviteModal() {
  $c('invite-nombre').value = ''; $c('invite-email').value = ''; $c('invite-tel').value = '';
  $c('invite-medio').value = ''; $c('invite-fecha').value = new Date().toISOString().slice(0, 10);
  $c('invite-is-test').checked = false;
  $c('invite-status').textContent = '';
  $c('invite-form-view').style.display = 'block';
  $c('invite-result-view').style.display = 'none';
  $c('invite-modalBg').classList.add('show');
}
function closeInviteModal() {
  $c('invite-modalBg').classList.remove('show');
  loadInvitesAdmin();
}

async function createInvite() {
  const statusEl = $c('invite-status');
  statusEl.style.color = 'var(--muted)'; statusEl.textContent = 'Generando…';
  try {
    const res = await fetch(WORKER + '/obra/admin/invites', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
      body: JSON.stringify({
        nombre: $c('invite-nombre').value.trim(),
        email: $c('invite-email').value.trim(),
        telefono: $c('invite-tel').value.trim(),
        medio_contacto_previo: $c('invite-medio').value,
        fecha_contacto: $c('invite-fecha').value || null,
        is_test: $c('invite-is-test').checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al generar la invitaci\u{f3}n');
    $c('invite-form-view').style.display = 'none';
    $c('invite-result-view').style.display = 'block';
    $c('invite-result-url').value = data.url;
    const wa = $c('invite-whatsapp-link');
    wa.href = `https://wa.me/?text=${encodeURIComponent(data.url)}`;
    $c('invite-copy-status').textContent = `Folio reservado: ${data.invite.folio}`;
  } catch (e) {
    statusEl.style.color = 'var(--bad)'; statusEl.textContent = '\u{2717} ' + e.message;
  }
}

function copyInviteLink() {
  const input = $c('invite-result-url');
  input.select();
  try {
    navigator.clipboard.writeText(input.value);
    $c('invite-copy-status').textContent = '\u{2713} Copiado';
  } catch (e) {
    document.execCommand('copy');
  }
}

async function loadInvitesAdmin() {
  const list = $c('invite-list');
  try {
    const res = await fetch(WORKER + '/obra/admin/invites', { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) throw new Error('PIN incorrecto o error de red');
    const data = await res.json();
    const invites = (data.invites || []).filter(i => i.status === 'pendiente').slice(0, 10);
    if (!invites.length) { list.innerHTML = '<div class="empty">Sin invitaciones pendientes</div>'; return; }
    list.innerHTML = invites.map(i => `
      <div class="cli-hist-item">
        <div class="h-main">
          <div class="h-title">${esc(i.nombre_prefill || i.email_prefill || 'Sin nombre')} <span class="status-badge" style="border-color:${INVITE_STATUS_COLOR[i.status]};color:${INVITE_STATUS_COLOR[i.status]};margin-left:6px">${INVITE_STATUS_LABEL[i.status]}</span></div>
          <div class="h-sub">${esc(i.folio)} \u{b7} ${timeAgo(new Date(i.created_at).getTime())}</div>
        </div>
        <button class="gbtn" onclick="copyInviteUrlFromList('${i.token}')">Copiar link</button>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function copyInviteUrlFromList(token) {
  const url = `https://thegaptproject.com/nuevo/?t=${token}`;
  try { navigator.clipboard.writeText(url); } catch (e) {}
}

async function sendMensajeAdminReply(threadId) {
  const text = $c('msg-e-reply').value.trim();
  if (!text) return;
  const statusEl = $c('msg-e-status');
  statusEl.style.display = 'block'; statusEl.style.color = 'var(--muted)'; statusEl.textContent = 'Enviando\u{2026}';
  try {
    const res = await fetch(`${WORKER}/obra/admin/mensajes/${threadId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin },
      body: JSON.stringify({ body: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al enviar');
    statusEl.style.color = 'var(--green)'; statusEl.textContent = '\u{2713} Enviado';
    openMensajeAdminDetail(threadId);
  } catch (e) {
    statusEl.style.color = 'var(--bad)'; statusEl.textContent = '\u{2717} ' + e.message;
  }
}

/* \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}
   CREDENCIALES / ID + EXPEDIENTES
   \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550} */
const CRED_VERIFY_ORIGIN = 'https://thegaptproject.com/id/';
let credList = [], expList = [];
let credSearch = '', credFilterTipo = 'todos';
let credModalMode = null; // 'view' | 'edit' | 'create'
let credEditId = null;
let credForm = null;
let credPreviewSide = 'front';
let credFotoPendingBase64 = null;
let expEditId = null;
let expForm = null;
let expFotoPendingBase64 = null;

function credStatusColor(status) {
  return { ACTIVA: '#5fbf8a', VIGENTE: '#5fbf8a', BAJA: '#e05a4a', EXPIRADA: '#e05a4a', 'SIN ASIGNAR': '#e0a83c' }[status] || '#9c9890';
}
function credFmtDate(iso) {
  if (!iso) return '\u{2014}';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function credFmtMonthYear(iso) {
  if (!iso) return '__-__';
  const d = new Date(iso + 'T00:00:00');
  const p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + String(d.getFullYear()).slice(-2);
}
function credVerifyUrl(codigo) { return CRED_VERIFY_ORIGIN + '?c=' + encodeURIComponent(codigo); }
function credLocalStatus(f) {
  if (f.tipo === 'colaborador') return f.activo ? 'ACTIVA' : 'BAJA';
  if (!f.asignada || !f.fecha_vigencia) return 'SIN ASIGNAR';
  const hoy = new Date().toISOString().slice(0, 10);
  return f.fecha_vigencia >= hoy ? 'VIGENTE' : 'EXPIRADA';
}

async function fetchEntityFotoBase64(tabla, id) {
  try {
    const res = await fetch(`${WORKER}/${tabla}/${id}/foto`, { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  } catch (_) { return null; }
}
async function loadEntityFotoInto(tabla, id, imgId, placeholderId) {
  try {
    const res = await fetch(`${WORKER}/${tabla}/${id}/foto`, { headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    $c(imgId).src = url; $c(imgId).style.display = 'block';
    if (placeholderId) $c(placeholderId).style.display = 'none';
  } catch (_) {}
}

/* \u{2500}\u{2500} Credenciales: lista \u{2500}\u{2500} */
async function loadCredenciales() {
  $c('cred-rows').innerHTML = '<div class="empty">Cargando\u{2026}</div>';
  try {
    const res = await fetch(`${WORKER}/credenciales`, { headers: { 'X-GAPT-PIN': pin } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    credList = data.credenciales || [];
    renderCredFilterChips();
    renderCredRows();
  } catch (e) {
    $c('cred-rows').innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}
function renderCredFilterChips() {
  const defs = [{ key: 'todos', label: 'Todos' }, { key: 'colaborador', label: 'Colaborador' }, { key: 'contratista', label: 'Contratista' }];
  $c('cred-filter-chips').innerHTML = defs.map(d => `<button type="button" class="cred-chip${d.key === credFilterTipo ? ' active' : ''}" onclick="setCredFilter('${d.key}')">${d.label}</button>`).join('');
}
function setCredFilter(tipo) { credFilterTipo = tipo; renderCredFilterChips(); renderCredRows(); }
function onCredSearch(v) { credSearch = v; renderCredRows(); }
function renderCredRows() {
  const q = credSearch.trim().toLowerCase();
  const rows = credList.filter(c => {
    if (credFilterTipo !== 'todos' && c.tipo !== credFilterTipo) return false;
    if (!q) return true;
    return [c.folio, c.nombre, c.empresa].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  if (!rows.length) { $c('cred-rows').innerHTML = '<div class="empty">No se encontraron credenciales.</div>'; return; }
  $c('cred-rows').innerHTML = rows.map(c => {
    const tipoColor = c.tipo === 'colaborador' ? '#ff5a1f' : '#3d4dff';
    const subLabel = c.tipo === 'colaborador'
      ? esc(c.puesto || '\u{2014}')
      : esc([c.empresa, (c.proyecto && c.proyecto !== '\u{2014} Sin proyecto \u{2014}') ? c.proyecto : null].filter(Boolean).join(' \u{b7} ') || '\u{2014}');
    const statusColor = credStatusColor(c.status);
    return `<div class="cred-row cred-cred-cols">
      <span class="mono">${esc(c.folio)}</span>
      <span class="nm">${esc(c.nombre || '\u{2014} Sin asignar \u{2014}')}</span>
      <span class="cred-pill" style="border-color:${tipoColor};color:${tipoColor}">${c.tipo === 'colaborador' ? 'COLABORADOR' : 'CONTRATISTA'}</span>
      <span class="sub">${subLabel}</span>
      <span class="cred-pill" style="border-color:${statusColor};color:${statusColor}">${esc(c.status)}</span>
      <div class="cred-row-actions">
        <button onclick="openCredView('${c.id}')">Ver</button>
        <button onclick="openCredEdit('${c.id}')">Editar</button>
        <button class="danger" onclick="deleteCredencial('${c.id}')">Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

/* \u{2500}\u{2500} Credenciales: modal detalle/edici\u{f3}n/creaci\u{f3}n \u{2500}\u{2500} */
function blankCredForm(tipo) {
  return tipo === 'colaborador'
    ? { id: null, folio: null, codigo: null, tipo, nombre: '', puesto: '', num_empleado: null, tipo_sangre: 'O+', contacto_nombre: '', contacto_parentesco: '', contacto_telefono: '', fecha_inicio: '', fecha_vigencia: '', activo: true, foto_r2_key: null, status: 'ACTIVA' }
    : { id: null, folio: null, codigo: null, tipo, nombre: '', empresa: '', proyecto: '\u{2014} Sin proyecto \u{2014}', puesto: '', num_identificacion: '', fecha_inicio: '', fecha_vigencia: '', contacto: '', asignada: false, foto_r2_key: null, status: 'SIN ASIGNAR' };
}
function openCredPicker() { $c('cred-picker-modalBg').classList.add('show'); }
function closeCredPicker() { $c('cred-picker-modalBg').classList.remove('show'); }
function pickCredTipo(tipo) { closeCredPicker(); openCredCreate(tipo); }

function openCredCreate(tipo, prefill, fotoBase64) {
  credModalMode = 'create'; credEditId = null;
  credForm = blankCredForm(tipo);
  if (prefill) Object.assign(credForm, prefill);
  credFotoPendingBase64 = fotoBase64 || null;
  credPreviewSide = 'front';
  renderCredModal();
  $c('cred-modalBg').classList.add('show');
}
function openCredView(id) {
  const c = credList.find(x => x.id === id);
  if (!c) return;
  credModalMode = 'view'; credEditId = id; credForm = { ...c }; credFotoPendingBase64 = null; credPreviewSide = 'front';
  renderCredModal();
  $c('cred-modalBg').classList.add('show');
  if (c.foto_r2_key) loadEntityFotoInto('credenciales', id, 'cred-foto-thumb', 'cred-foto-placeholder');
}
function openCredEdit(id) { openCredView(id); credModalMode = 'edit'; renderCredModal(); }
function enableCredEdit() { credModalMode = 'edit'; renderCredModal(); }
function closeCredModal() { $c('cred-modalBg').classList.remove('show'); credForm = null; credEditId = null; credModalMode = null; }

function renderCredModal() {
  const f = credForm, isColab = f.tipo === 'colaborador', readOnly = credModalMode === 'view';
  $c('cred-fields-colaborador').style.display = isColab ? 'block' : 'none';
  $c('cred-fields-contratista').style.display = isColab ? 'none' : 'block';
  $c('cred-m-eyebrow').textContent = `${f.folio || '(nuevo)'} \u{b7} ${isColab ? 'COLABORADOR' : 'CONTRATISTA'}`;
  $c('cred-m-title').textContent = credModalMode === 'create' ? 'Nueva credencial' : (readOnly ? 'Detalle de credencial' : 'Editar credencial');

  document.querySelectorAll('#cred-fields-colaborador input, #cred-fields-colaborador select, #cred-fields-contratista input, #cred-fields-contratista select')
    .forEach(el => { if (el.id !== 'cred-f-numempleado') el.disabled = readOnly; });

  if (isColab) {
    $c('cred-f-nombre-col').value = f.nombre || '';
    $c('cred-f-puesto-col').value = f.puesto || '';
    $c('cred-f-numempleado').value = f.num_empleado || '(se asigna al guardar)';
    $c('cred-f-tiposangre').value = f.tipo_sangre || 'O+';
    $c('cred-f-inicio-col').value = f.fecha_inicio || '';
    $c('cred-f-vigencia-col').value = f.fecha_vigencia || '';
    $c('cred-f-cnombre').value = f.contacto_nombre || '';
    $c('cred-f-cparentesco').value = f.contacto_parentesco || '';
    $c('cred-f-ctelefono').value = f.contacto_telefono || '';
    renderCredActivoBtn();
  } else {
    $c('cred-f-nombre-ctr').value = f.nombre || '';
    $c('cred-f-empresa').value = f.empresa || '';
    $c('cred-f-proyecto').value = f.proyecto || '\u{2014} Sin proyecto \u{2014}';
    $c('cred-f-puesto-ctr').value = f.puesto || '';
    $c('cred-f-numid').value = f.num_identificacion || '';
    $c('cred-f-inicio-ctr').value = f.fecha_inicio || '';
    $c('cred-f-vigencia-ctr').value = f.fecha_vigencia || '';
    $c('cred-f-contacto').value = f.contacto || '';
    renderCredAsignadaBtn();
  }

  $c('cred-btn-edit').style.display = readOnly ? 'inline-block' : 'none';
  $c('cred-btn-pdf').style.display = readOnly ? 'inline-block' : 'none';
  $c('cred-btn-save').style.display = readOnly ? 'none' : 'inline-block';
  $c('cred-modal-status').textContent = '';

  if (credFotoPendingBase64) {
    $c('cred-foto-thumb').src = credFotoPendingBase64; $c('cred-foto-thumb').style.display = 'block'; $c('cred-foto-placeholder').style.display = 'none';
  } else if (!f.foto_r2_key) {
    $c('cred-foto-thumb').style.display = 'none'; $c('cred-foto-thumb').removeAttribute('src'); $c('cred-foto-placeholder').style.display = 'block';
  }

  renderCredCardPreview();
  showCredSide(credPreviewSide);
}

function renderCredActivoBtn() {
  const on = !!credForm.activo, btn = $c('cred-f-activo-btn');
  btn.textContent = on ? 'Activa' : 'Dada de baja';
  btn.style.background = on ? 'rgba(95,191,138,.12)' : 'rgba(224,90,74,.12)';
  btn.style.borderColor = on ? '#5fbf8a' : '#e05a4a';
  btn.style.color = on ? '#5fbf8a' : '#e05a4a';
  btn.disabled = credModalMode === 'view';
}
function toggleCredActivo() { credForm.activo = !credForm.activo; renderCredActivoBtn(); renderCredCardPreview(); }
function renderCredAsignadaBtn() {
  const on = !!credForm.asignada, btn = $c('cred-f-asignada-btn');
  btn.textContent = on ? 'Asignada' : 'Sin asignar';
  btn.style.background = on ? 'rgba(95,191,138,.12)' : 'rgba(224,168,60,.12)';
  btn.style.borderColor = on ? '#5fbf8a' : '#e0a83c';
  btn.style.color = on ? '#5fbf8a' : '#e0a83c';
  btn.disabled = credModalMode === 'view';
}
function toggleCredAsignada() { credForm.asignada = !credForm.asignada; renderCredAsignadaBtn(); renderCredCardPreview(); }
function onCredFieldInput(key, value) { credForm[key] = value; renderCredCardPreview(); }

function renderCredCardPreview() {
  const f = credForm, isColab = f.tipo === 'colaborador';
  if (isColab) {
    $c('cred-ov-nombre-front').textContent = (f.nombre || '').toUpperCase();
    $c('cred-ov-puesto-front').textContent = (f.puesto || '').toUpperCase();
    $c('cred-ov-numemp-front').textContent = f.num_empleado || '';
    $c('cred-ov-cn').textContent = f.contacto_nombre || '';
    $c('cred-ov-cp').textContent = f.contacto_parentesco || '';
    $c('cred-ov-ct').textContent = f.contacto_telefono || '';
    $c('cred-ov-ts').textContent = f.tipo_sangre || '';
    $c('cred-ov-vig-back').textContent = credFmtMonthYear(f.fecha_inicio) + ' / ' + credFmtMonthYear(f.fecha_vigencia);
    const fotoImg = $c('cred-ov-foto-front');
    if (credFotoPendingBase64) { fotoImg.src = credFotoPendingBase64; fotoImg.style.display = 'block'; }
    else if (!f.foto_r2_key) { fotoImg.style.display = 'none'; }
  } else {
    $c('cred-ov-folio-front').textContent = f.folio || '';
    $c('cred-ov-folio-back').textContent = f.folio || '';
  }

  const qrImg = isColab ? $c('cred-ov-qr-colab') : $c('cred-ov-qr-ctr');
  const otherQr = isColab ? $c('cred-ov-qr-ctr') : $c('cred-ov-qr-colab');
  otherQr.style.display = 'none';
  if (f.codigo) {
    qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&ecc=H&data=' + encodeURIComponent(credVerifyUrl(f.codigo));
    qrImg.style.display = 'block';
  } else {
    qrImg.style.display = 'none';
  }

  const qp = $c('cred-qr-preview');
  if (!isColab) {
    qp.style.display = 'flex';
    $c('cred-qp-nombre').textContent = f.nombre || '\u{2014} Sin asignar \u{2014}';
    const st = credLocalStatus(f);
    $c('cred-qp-status').textContent = st;
    $c('cred-qp-status').style.borderColor = credStatusColor(st);
    $c('cred-qp-status').style.color = credStatusColor(st);
    $c('cred-qp-empresa').textContent = (f.empresa || '\u{2014}') + ' \u{b7} ' + (f.puesto || '\u{2014}');
    $c('cred-qp-meta').textContent = 'Proyecto: ' + (f.proyecto || '\u{2014}') + ' \u{b7} Vigencia: ' + credFmtDate(f.fecha_vigencia);
  } else {
    qp.style.display = 'none';
  }
}

function showCredSide(side) {
  credPreviewSide = side;
  const isColab = credForm.tipo === 'colaborador';
  $c('cred-card-colaborador-front').style.display = (isColab && side === 'front') ? 'block' : 'none';
  $c('cred-card-colaborador-back').style.display = (isColab && side === 'back') ? 'block' : 'none';
  $c('cred-card-contratista-front').style.display = (!isColab && side === 'front') ? 'block' : 'none';
  $c('cred-card-contratista-back').style.display = (!isColab && side === 'back') ? 'block' : 'none';
  $c('cred-side-front-btn').classList.toggle('active', side === 'front');
  $c('cred-side-back-btn').classList.toggle('active', side === 'back');
}

function onCredFotoChange(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { credFotoPendingBase64 = reader.result; renderCredModal(); };
  reader.readAsDataURL(file);
}

async function saveCredForm() {
  const f = credForm, statusEl = $c('cred-modal-status');
  statusEl.textContent = 'Guardando\u{2026}'; statusEl.className = 'gstatus';
  const body = { tipo: f.tipo, nombre: f.nombre, puesto: f.puesto, fecha_inicio: f.fecha_inicio || null, fecha_vigencia: f.fecha_vigencia || null };
  if (f.tipo === 'colaborador') {
    Object.assign(body, { tipo_sangre: f.tipo_sangre, contacto_nombre: f.contacto_nombre, contacto_parentesco: f.contacto_parentesco, contacto_telefono: f.contacto_telefono, activo: !!f.activo });
  } else {
    Object.assign(body, { empresa: f.empresa, proyecto: f.proyecto, num_identificacion: f.num_identificacion, contacto: f.contacto, asignada: !!f.asignada });
  }
  if (credFotoPendingBase64) body.foto_base64 = credFotoPendingBase64;
  try {
    const url = credEditId ? `${WORKER}/credenciales/${credEditId}` : `${WORKER}/credenciales`;
    const res = await fetch(url, { method: credEditId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    closeCredModal();
    loadCredenciales();
  } catch (e) {
    statusEl.textContent = '\u{2717} ' + e.message; statusEl.className = 'gstatus err';
  }
}

async function deleteCredencial(id) {
  if (!(await gConfirm('\u{bf}Eliminar esta credencial?', { confirmLabel: 'Eliminar', danger: true }))) return;
  try {
    const res = await fetch(`${WORKER}/credenciales/${id}`, { method: 'DELETE', headers: { 'X-GAPT-PIN': pin } });
    if (!res.ok) throw new Error();
    loadCredenciales();
  } catch (_) {}
}

function printCredCard() {
  const card = document.getElementById(`cred-card-${credForm.tipo}-${credPreviewSide}`);
  if (!card) return;
  card.classList.add('cred-print-host');
  document.body.classList.add('cred-printing');
  setTimeout(() => window.print(), 30);
}
window.addEventListener('afterprint', () => {
  document.body.classList.remove('cred-printing');
  document.querySelectorAll('.cred-print-host').forEach(el => el.classList.remove('cred-print-host'));
});

/* \u{2500}\u{2500} Expedientes \u{2500}\u{2500} */
const EXP_FILE_DOCS = [['contrato', 'Contrato firmado'], ['ine', 'INE'], ['comprobante_domicilio', 'Comprobante de domicilio'], ['acta_nacimiento', 'Acta de nacimiento']];
const EXP_TEXT_DOCS = [['rfc', 'RFC'], ['curp', 'CURP'], ['imss', 'No. IMSS'], ['clabe', 'CLABE']];

function expMissing(e) {
  const missing = [];
  EXP_FILE_DOCS.forEach(([k, label]) => { if (!e[k]) missing.push(label); });
  EXP_TEXT_DOCS.forEach(([k, label]) => { if (!e[k] || !String(e[k]).trim()) missing.push(label); });
  return missing;
}

async function loadExpedientes() {
  $c('exp-rows').innerHTML = '<div class="empty">Cargando\u{2026}</div>';
  try {
    const res = await fetch(`${WORKER}/expedientes`, { headers: { 'X-GAPT-PIN': pin } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    expList = data.expedientes || [];
    renderExpRows();
  } catch (e) {
    $c('exp-rows').innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}
function renderExpRows() {
  if (!expList.length) { $c('exp-rows').innerHTML = '<div class="empty">Sin expedientes a\u{fa}n.</div>'; return; }
  $c('exp-rows').innerHTML = expList.map(e => {
    const missing = expMissing(e), complete = missing.length === 0;
    const label = complete ? 'COMPLETO' : `${8 - missing.length}/8 DOCUMENTOS`;
    const color = complete ? '#5fbf8a' : '#e0a83c';
    return `<div class="cred-row cred-exp-cols">
      <span class="nm">${esc(e.nombre || '\u{2014}')}</span>
      <span class="sub">${esc(e.puesto || '\u{2014}')}</span>
      <span class="cred-pill" style="border-color:${color};color:${color}">${label}</span>
      <div class="cred-row-actions">
        <button onclick="openEditExpediente('${e.id}')">Editar</button>
        <button ${complete ? '' : 'disabled'} style="${complete ? 'background:var(--orange);border:none;color:#fff;font-weight:700' : 'opacity:.4;cursor:not-allowed'}" onclick="${complete ? `generarCredencialFromRow('${e.id}')` : ''}">Generar credencial</button>
      </div>
    </div>`;
  }).join('');
}

function blankExpForm() {
  return { id: null, folio: null, nombre: '', puesto: '', celular: '', direccion: '', contacto_nombre: '', contacto_parentesco: '', contacto_telefono: '', contrato: false, ine: false, comprobante_domicilio: false, acta_nacimiento: false, otros_docs: [], rfc: '', curp: '', imss: '', clabe: '', foto_r2_key: null };
}
function openNewExpediente() {
  expEditId = null; expForm = blankExpForm(); expFotoPendingBase64 = null;
  fillExpModalFields();
  $c('exp-modalBg').classList.add('show');
}
function openEditExpediente(id) {
  const e = expList.find(x => x.id === id);
  if (!e) return;
  expEditId = id; expForm = { ...e, otros_docs: (e.otros_docs || []).map(o => ({ ...o })) }; expFotoPendingBase64 = null;
  fillExpModalFields();
  $c('exp-modalBg').classList.add('show');
  if (e.foto_r2_key) loadEntityFotoInto('expedientes', id, 'exp-foto-thumb', 'exp-foto-placeholder');
}
function closeExpModal() { $c('exp-modalBg').classList.remove('show'); expForm = null; expEditId = null; }

function fillExpModalFields() {
  $c('exp-f-nombre').value = expForm.nombre || '';
  $c('exp-f-puesto').value = expForm.puesto || '';
  $c('exp-f-celular').value = expForm.celular || '';
  $c('exp-f-direccion').value = expForm.direccion || '';
  $c('exp-f-cnombre').value = expForm.contacto_nombre || '';
  $c('exp-f-cparentesco').value = expForm.contacto_parentesco || '';
  $c('exp-f-ctelefono').value = expForm.contacto_telefono || '';
  $c('exp-f-rfc').value = expForm.rfc || '';
  $c('exp-f-curp').value = expForm.curp || '';
  $c('exp-f-imss').value = expForm.imss || '';
  $c('exp-f-clabe').value = expForm.clabe || '';
  $c('exp-nuevo-otro').value = '';
  $c('exp-foto-thumb').style.display = 'none'; $c('exp-foto-thumb').removeAttribute('src');
  $c('exp-foto-placeholder').style.display = 'block';
  $c('exp-modal-status').textContent = '';
  renderExpFileDocs();
  renderExpOtrosDocs();
  renderExpMissingBanner();
}
function renderExpFileDocs() {
  $c('exp-file-docs').innerHTML = EXP_FILE_DOCS.map(([k, label]) => {
    const on = !!expForm[k];
    return `<div class="cred-doc-row"><span class="lbl">${label}</span><button type="button" class="cred-doc-toggle" style="border-color:${on ? '#5fbf8a' : 'var(--border)'};color:${on ? '#5fbf8a' : 'var(--cream)'};background:${on ? 'rgba(95,191,138,.12)' : 'none'}" onclick="toggleExpDoc('${k}')">${on ? 'Adjunto \u{2713}' : 'Adjuntar'}</button></div>`;
  }).join('');
}
function toggleExpDoc(key) { expForm[key] = !expForm[key]; renderExpFileDocs(); renderExpMissingBanner(); }
function renderExpOtrosDocs() {
  const list = expForm.otros_docs || [];
  $c('exp-otros-docs').innerHTML = list.map((o, idx) => {
    const on = !!o.attached;
    return `<div class="cred-doc-row"><span class="lbl">${esc(o.label)}</span><button type="button" class="cred-doc-toggle" style="border-color:${on ? '#5fbf8a' : 'var(--border)'};color:${on ? '#5fbf8a' : 'var(--cream)'};background:${on ? 'rgba(95,191,138,.12)' : 'none'}" onclick="toggleExpOtroDoc(${idx})">${on ? 'Adjunto \u{2713}' : 'Adjuntar'}</button><button type="button" class="cred-doc-remove" onclick="removeExpOtroDoc(${idx})">\u{2715}</button></div>`;
  }).join('');
}
function addExpOtroDoc() {
  const label = $c('exp-nuevo-otro').value.trim();
  if (!label) return;
  expForm.otros_docs = [...(expForm.otros_docs || []), { label, attached: false }];
  $c('exp-nuevo-otro').value = '';
  renderExpOtrosDocs();
}
function toggleExpOtroDoc(idx) { expForm.otros_docs[idx].attached = !expForm.otros_docs[idx].attached; renderExpOtrosDocs(); }
function removeExpOtroDoc(idx) { expForm.otros_docs.splice(idx, 1); renderExpOtrosDocs(); }

function collectExpFormFromDom() {
  return {
    ...expForm,
    nombre: $c('exp-f-nombre').value.trim(), puesto: $c('exp-f-puesto').value.trim(),
    celular: $c('exp-f-celular').value.trim(), direccion: $c('exp-f-direccion').value.trim(),
    contacto_nombre: $c('exp-f-cnombre').value.trim(), contacto_parentesco: $c('exp-f-cparentesco').value.trim(), contacto_telefono: $c('exp-f-ctelefono').value.trim(),
    rfc: $c('exp-f-rfc').value.trim(), curp: $c('exp-f-curp').value.trim(), imss: $c('exp-f-imss').value.trim(), clabe: $c('exp-f-clabe').value.trim(),
  };
}
function renderExpMissingBanner() {
  const missing = expMissing(collectExpFormFromDom());
  const banner = $c('exp-missing-banner');
  if (missing.length) { banner.style.display = 'block'; banner.textContent = 'Falta: ' + missing.join(', '); }
  else banner.style.display = 'none';
  const btn = $c('exp-btn-generar');
  btn.disabled = missing.length > 0;
  btn.style.opacity = missing.length ? '.4' : '1';
  btn.style.cursor = missing.length ? 'not-allowed' : 'pointer';
}

function onExpFotoChange(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    expFotoPendingBase64 = reader.result;
    $c('exp-foto-thumb').src = reader.result; $c('exp-foto-thumb').style.display = 'block';
    $c('exp-foto-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function saveExpediente() {
  const body = collectExpFormFromDom();
  if (expFotoPendingBase64) body.foto_base64 = expFotoPendingBase64;
  const statusEl = $c('exp-modal-status');
  statusEl.textContent = 'Guardando\u{2026}'; statusEl.className = 'gstatus';
  try {
    const url = expEditId ? `${WORKER}/expedientes/${expEditId}` : `${WORKER}/expedientes`;
    const res = await fetch(url, { method: expEditId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'X-GAPT-PIN': pin }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    closeExpModal();
    loadExpedientes();
  } catch (e) {
    statusEl.textContent = '\u{2717} ' + e.message; statusEl.className = 'gstatus err';
  }
}

async function generarCredencialFromExpediente() {
  const nombre = $c('exp-f-nombre').value.trim();
  const puesto = $c('exp-f-puesto').value.trim();
  if (expMissing(collectExpFormFromDom()).length) return;
  let fotoBase64 = expFotoPendingBase64;
  if (!fotoBase64 && expEditId) fotoBase64 = await fetchEntityFotoBase64('expedientes', expEditId);
  closeExpModal();
  switchTab('credenciales');
  openCredCreate('colaborador', { nombre, puesto }, fotoBase64);
}
async function generarCredencialFromRow(id) {
  const e = expList.find(x => x.id === id);
  if (!e) return;
  const fotoBase64 = e.foto_r2_key ? await fetchEntityFotoBase64('expedientes', id) : null;
  switchTab('credenciales');
  openCredCreate('colaborador', { nombre: e.nombre, puesto: e.puesto }, fotoBase64);
}
