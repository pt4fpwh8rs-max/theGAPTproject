const WORKER = 'https://gapt-mail.hvfgc6bp2r.workers.dev';
const TOKEN_KEY = 'gapt_obra_token';

/* ── AUTH ── */
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }
function authFetch(path, opts = {}) {
  return fetch(`${WORKER}${path}`, { ...opts, headers: { ...(opts.headers || {}), 'Authorization': `Bearer ${getToken()}` } });
}

/* ── HELPERS ── */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtMoney(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-MX'); }
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d.length <= 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}
const STATUS_COLOR = {
  pagada: '#5fbf8a', pagado: '#5fbf8a', pendiente: '#e0a83c', vencida: '#e05a4a', cancelada: '#9c9890',
  Firmado: '#5fbf8a', firmado_escaneado: '#5fbf8a', publicado: '#5fbf8a',
  Pendiente: '#e0a83c', pendiente_aprobacion: '#e0a83c', 'En obra': '#e0a83c', lead: '#e0a83c',
  Aprobada: '#5fbf8a', aprobado: '#5fbf8a', activo: '#e0a83c', en_obra: '#e0a83c',
  Rechazada: '#e05a4a', rechazado: '#e05a4a', Cierre: '#5fbf8a', cerrado: '#5fbf8a', cancelado: '#9c9890',
};
function statusColor(s) { return STATUS_COLOR[s] || '#9c9890'; }

const PROY_STATUS_LABEL = { lead: 'Lead', cotizado: 'Cotizado', activo: 'Activo', en_obra: 'En obra', cerrado: 'Cierre', cancelado: 'Cancelado' };
const DOC_TIPO_LABEL = {
  REQ: 'Requisición de datos', COT: 'Cotización', CON: 'Contrato de Servicios', OC: 'Orden de Cambio',
  BIT: 'Bitácora de Obra', ENT: 'Registro de Entrega de Partidas', RF: 'Reporte Fotográfico de Avance',
  ACT: 'Acta de Entrega-Recepción', CC: 'Catálogo de Conceptos', CAL: 'Calendario de Obra',
};
const DOC_STATUS_LABEL = {
  borrador: 'Borrador', publicado: 'Publicado', archivado: 'Archivado', pendiente_aprobacion: 'Pendiente',
  aprobado: 'Aprobada', rechazado: 'Rechazada', generado_para_firma: 'Generado para firma',
  firmado_escaneado: 'Firmado', cancelado: 'Cancelado',
};
const DOC_CATEGORY = {
  COT: 'Inicio del proyecto', CON: 'Inicio del proyecto', CC: 'Inicio del proyecto', CAL: 'Inicio del proyecto',
  OC: 'Durante la obra', BIT: 'Durante la obra', ENT: 'Durante la obra', RF: 'Durante la obra',
  ACT: 'Cierre del proyecto',
};
const DOC_CATEGORY_ORDER = ['Inicio del proyecto', 'Durante la obra', 'Cierre del proyecto'];
const AREA_LABEL = { cocina: 'Cocina', banos: 'Baños', fachada: 'Fachada', ampliacion: 'Ampliación', remodelacion_integral: 'Remodelación integral', otro: 'Otro' };

/* ── STATE ── */
const state = {
  screen: 'dashboard',
  cliente: null,
  proyectos: [],
  activeProyectoIdx: 0,
  showAllProjects: { contratos: false, aprobaciones: false, reportes: false, documentos: false, mensajes: false },
  facturas: [],
  hilos: [],
  activeThreadId: null,
  activeThreadDetail: null,
  payInvoiceId: null,
  coDoc: null,
  coDecided: null, // {status,signer_name} once approved/rejected locally-known
  docPreview: null,
  hasSignature: false,
  logoClicks: 0,
  modoObra: false,
};

function activeProyecto() { return state.proyectos[state.activeProyectoIdx] || null; }

/* ── LOGIN ── */
const lgEmail = document.getElementById('lg-email');
const lgPin = document.getElementById('lg-pin');
const lgErr = document.getElementById('lg-err');
const lgSubmit = document.getElementById('lg-submit');

lgSubmit.addEventListener('click', async () => {
  const email = lgEmail.value.trim();
  const pin = lgPin.value.trim();
  lgErr.textContent = '';
  if (!email || !email.includes('@')) { lgErr.textContent = 'Ingresa un correo válido.'; return; }
  if (!/^\d{6}$/.test(pin)) { lgErr.textContent = 'El PIN debe tener 6 dígitos.'; return; }
  lgSubmit.disabled = true;
  try {
    const res = await fetch(`${WORKER}/obra/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, pin }) });
    const data = await res.json();
    if (!res.ok) { lgErr.textContent = data.error || 'No se pudo iniciar sesión.'; return; }
    setToken(data.token);
    state.cliente = data.cliente;
    await enterApp();
  } catch (e) {
    lgErr.textContent = 'Error de conexión.';
  } finally {
    lgSubmit.disabled = false;
  }
});
lgPin.addEventListener('keydown', e => { if (e.key === 'Enter') lgSubmit.click(); });

document.getElementById('lg-forgot-link').addEventListener('click', () => {
  document.getElementById('lg-form-login').style.display = 'none';
  document.getElementById('lg-form-forgot').style.display = 'flex';
  document.getElementById('lg-forgot-notsent').style.display = 'block';
  document.getElementById('lg-forgot-sent').style.display = 'none';
  document.getElementById('lg-reset-email').value = '';
});
document.getElementById('lg-back-to-login').addEventListener('click', () => {
  document.getElementById('lg-form-forgot').style.display = 'none';
  document.getElementById('lg-form-login').style.display = 'flex';
});
document.getElementById('lg-reset-submit').addEventListener('click', async () => {
  const email = document.getElementById('lg-reset-email').value.trim();
  if (!email) return;
  try {
    await fetch(`${WORKER}/obra/login/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  } catch (e) {}
  document.getElementById('lg-forgot-notsent').style.display = 'none';
  document.getElementById('lg-forgot-sent').style.display = 'block';
});

document.getElementById('sb-logout').addEventListener('click', async () => {
  try { await authFetch('/obra/logout', { method: 'POST' }); } catch (e) {}
  clearToken();
  window.location.reload();
});

/* ── ENTER APP / NAV ── */
const NAV_DEFS = [
  { key: 'dashboard', n: '01', label: 'Resumen', short: 'Resumen' },
  { key: 'pagos', n: '02', label: 'Pagos y facturas', short: 'Pagos' },
  { key: 'contratos', n: '03', label: 'Contratos', short: 'Contratos' },
  { key: 'aprobaciones', n: '04', label: 'Aprobaciones', short: 'Aprobar' },
  { key: 'reportes', n: '05', label: 'Reportes de obra', short: 'Obra' },
  { key: 'documentos', n: '06', label: 'Documentos', short: 'Docs' },
  { key: 'mensajes', n: '07', label: 'Mensajes', short: 'Chat' },
];

function renderNav() {
  const sb = document.getElementById('sb-nav');
  const bn = document.getElementById('bottom-nav');
  sb.innerHTML = NAV_DEFS.map(it => `
    <button class="sb-nav-item${it.key === state.screen ? ' active' : ''}" data-nav="${it.key}">
      <span class="n mono">${it.n}</span><span class="lbl">${it.label}</span>
    </button>`).join('');
  bn.innerHTML = NAV_DEFS.map(it => `
    <button class="bn-item${it.key === state.screen ? ' active' : ''}" data-nav="${it.key}">
      <span class="n mono">${it.n}</span><span class="lbl">${it.short}</span>
    </button>`).join('');
  sb.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => goTo(el.dataset.nav)));
  bn.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => goTo(el.dataset.nav)));
}

function goTo(screen) {
  state.screen = screen;
  document.querySelectorAll('.pv-screen').forEach(el => el.classList.remove('active'));
  document.getElementById(`screen-${screen}`).classList.add('active');
  renderNav();
  loadScreen(screen);
}

async function loadScreen(screen) {
  if (screen === 'dashboard') return renderDashboard();
  if (screen === 'pagos') return renderPagos();
  if (screen === 'contratos') return renderContratos();
  if (screen === 'aprobaciones') return renderAprobaciones();
  if (screen === 'reportes') return renderReportes();
  if (screen === 'documentos') return renderDocumentos();
  if (screen === 'mensajes') return renderMensajes();
}

function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '--';
}

async function enterApp() {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-app').style.display = 'grid';

  const name = state.cliente?.nombre_completo || state.cliente?.email || '';
  document.getElementById('sb-user-name').textContent = name;
  document.getElementById('sb-avatar').textContent = initials(name);
  document.getElementById('topbar-avatar').textContent = initials(name);

  try {
    const res = await authFetch('/obra/proyectos');
    const data = await res.json();
    state.proyectos = (data.proyectos || []);
  } catch (e) { state.proyectos = []; }

  if (!state.proyectos.length) {
    document.getElementById('proj-switch-name').textContent = 'Sin proyectos';
  } else {
    document.getElementById('proj-switch-name').textContent = activeProyecto().nombre;
  }
  renderProjMenu();

  try {
    const fRes = await authFetch('/portal/facturas');
    const fData = await fRes.json();
    state.facturas = fData.documentos || [];
  } catch (e) { state.facturas = []; }

  renderNav();
  goTo('dashboard');
}

/* ── PROJECT SWITCHER ── */
const projMenu = document.getElementById('proj-menu');
document.getElementById('proj-switch-btn').addEventListener('click', () => projMenu.classList.toggle('show'));
document.addEventListener('click', e => {
  if (!projMenu.contains(e.target) && e.target.id !== 'proj-switch-btn') projMenu.classList.remove('show');
});

function renderProjMenu() {
  projMenu.innerHTML = state.proyectos.map((p, i) => `
    <button class="proj-menu-item" data-idx="${i}">
      <span class="name">${esc(p.nombre)}</span>
      <span class="loc">${esc(p.direccion_inmueble || '')}</span>
    </button>`).join('');
  projMenu.querySelectorAll('[data-idx]').forEach(el => el.addEventListener('click', () => {
    state.activeProyectoIdx = Number(el.dataset.idx);
    document.getElementById('proj-switch-name').textContent = activeProyecto().nombre;
    projMenu.classList.remove('show');
    loadScreen(state.screen);
  }));
}

/* ── BELL + LOGO EASTER EGGS ── */
const bellBtn = document.getElementById('bell-btn');
bellBtn.addEventListener('click', () => {
  bellBtn.classList.add('anim-bell');
  setTimeout(() => bellBtn.classList.remove('anim-bell'), 600);
});

const sbLogoBtn = document.getElementById('sb-logo-btn');
let logoClickTimer = null;
sbLogoBtn.addEventListener('click', () => {
  document.getElementById('sb-logo-svg').classList.add('anim-logo-bounce');
  setTimeout(() => document.getElementById('sb-logo-svg').classList.remove('anim-logo-bounce'), 400);
  state.logoClicks++;
  clearTimeout(logoClickTimer);
  logoClickTimer = setTimeout(() => { state.logoClicks = 0; }, 1200);
  if (state.logoClicks >= 5) {
    state.logoClicks = 0;
    state.modoObra = !state.modoObra;
    document.getElementById('hazard-bar').style.display = state.modoObra ? 'block' : 'none';
    showToast(`MODO OBRA ${state.modoObra ? 'ACTIVADO' : 'DESACTIVADO'}`);
  }
});

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function fireConfetti() {
  const layer = document.getElementById('confetti-layer');
  const pieces = Array.from({ length: 28 }, () => {
    const size = Math.round(16 + Math.random() * 10);
    const div = document.createElement('div');
    div.className = 'confetti-piece';
    div.style.left = Math.round(Math.random() * 96) + '%';
    div.style.width = size + 'px';
    div.style.height = size + 'px';
    div.style.background = Math.random() < 0.22 ? '#ff5a1f' : '#4caf7d';
    const anim = Math.random() > 0.5 ? 'confettiFall' : 'confettiFallRev';
    const duration = (1.3 + Math.random() * 1.1).toFixed(2);
    const delay = (Math.random() * 0.35).toFixed(2);
    div.style.animation = `${anim} ${duration}s linear ${delay}s forwards`;
    return div;
  });
  pieces.forEach(p => layer.appendChild(p));
  setTimeout(() => { layer.innerHTML = ''; }, 2400);
}

/* ── DASHBOARD ── */
async function renderDashboard() {
  const grid = document.getElementById('dash-grid');
  grid.innerHTML = state.proyectos.map(p => {
    const color = statusColor(p.status);
    const paidPct = p.budget_total > 0 ? Math.round((p.budget_paid / p.budget_total) * 100) : 0;
    const almostDone = p.progress >= 90 && p.progress < 100;
    return `
    <div class="proj-card">
      <div class="proj-card-head">
        <div style="min-width:0">
          <div class="proj-card-name">${esc(p.nombre)}</div>
          <div class="proj-card-loc">${esc(p.direccion_inmueble || '')}</div>
        </div>
        <span class="pill" style="border-color:${color};color:${color}">${esc(PROY_STATUS_LABEL[p.status] || p.status)}</span>
      </div>
      <div>
        <div class="progress-row"><span>Avance</span><span>${p.progress}%</span></div>
        <div class="progress-track"><div class="progress-fill" data-w="${p.progress}%"></div></div>
        ${almostDone ? '<span class="almost-done">◆ Casi listo</span>' : ''}
      </div>
      <div class="proj-card-foot">
        <span style="color:var(--muted-5)">Pagado ${paidPct}%</span>
        <span class="amt mono">${fmtMoney(p.budget_total)}</span>
      </div>
    </div>`;
  }).join('') || '<div class="pv-empty">Todavía no tienes proyectos registrados.</div>';

  setTimeout(() => grid.querySelectorAll('.progress-fill').forEach(el => { el.style.width = el.dataset.w; }), 120);

  const unpaid = state.facturas.filter(f => f.status !== 'pagada' && f.status !== 'pagado').slice(0, 3);
  document.getElementById('dash-next-payments').innerHTML = unpaid.length
    ? unpaid.map(f => `
      <div class="pay-row">
        <div><div class="pay-row-concept">${esc(f.tipo === 'cotizacion' ? 'Cotización' : 'Factura')} ${esc(f.folio)}</div>
        <div class="pay-row-meta">vence ${fmtDate(f.fecha_vencimiento || f.fecha_emision)}</div></div>
        <div style="display:flex;align-items:center;gap:14px">
          <span class="mono" style="font-size:13px">${fmtMoney(f.total)}</span>
          <button class="btn-mini" data-pay="${esc(f.id)}">Pagar</button>
        </div>
      </div>`).join('')
    : '<div class="pv-empty">No tienes pagos pendientes.</div>';
  document.getElementById('dash-next-payments').querySelectorAll('[data-pay]').forEach(el => el.addEventListener('click', () => openPayDrawer(el.dataset.pay)));

  let recent = [];
  try {
    const res = await authFetch('/obra/mis-documentos');
    const data = await res.json();
    recent = (data.documentos || []).slice(0, 3);
  } catch (e) {}
  document.getElementById('dash-recent-activity').innerHTML = recent.length
    ? recent.map(d => `
      <div class="report-row">
        <div class="report-date mono">${fmtDate(d.published_at || d.created_at)}</div>
        <div class="report-note">${esc(DOC_TIPO_LABEL[d.tipo] || d.tipo)} publicado — ${esc(d.proyecto_nombre)}</div>
      </div>`).join('')
    : '<div class="pv-empty">Sin actividad reciente.</div>';
}

/* ── PAGOS ── */
function renderPagos() {
  document.getElementById('pagos-filter-lbl').textContent = 'Mostrando todas tus facturas';
  const rows = document.getElementById('pagos-rows');
  const empty = document.getElementById('pagos-empty');
  if (!state.facturas.length) {
    rows.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const tipoLabel = { factura: 'Factura', cotizacion: 'Cotización' };
  rows.innerHTML = state.facturas.map(f => {
    const color = statusColor(f.status);
    const payable = f.status !== 'pagada' && f.status !== 'pagado';
    return `
    <div class="tbl-row">
      <span class="tbl-cell-mono">${esc(f.folio)}</span>
      <span class="tbl-cell" style="color:var(--muted-6)">—</span>
      <span class="tbl-cell">${esc(tipoLabel[f.tipo] || f.tipo)}</span>
      <span class="tbl-cell-mono">${fmtMoney(f.total)}</span>
      <span class="tbl-cell" style="color:var(--muted-6);font-size:12.5px">${fmtDate(f.fecha_vencimiento || f.fecha_emision)}</span>
      <span class="pill" style="border-color:${color};color:${color};text-align:center">${esc(f.status)}</span>
      ${payable
        ? `<button class="tbl-pay-btn" data-pay="${esc(f.id)}" style="margin-left:14px">Pagar</button>`
        : `<span class="tbl-dl" style="margin-left:14px">Descargar</span>`}
    </div>`;
  }).join('');
  rows.querySelectorAll('[data-pay]').forEach(el => el.addEventListener('click', () => openPayDrawer(el.dataset.pay)));
}

/* ── PAY DRAWER (Stripe real + SPEI real) ── */
let stripeClient = null, stripeElements = null;
const payBg = document.getElementById('pay-drawer-bg');
document.getElementById('pay-close-btn').addEventListener('click', closePayDrawer);
payBg.addEventListener('click', e => { if (e.target === payBg) closePayDrawer(); });

async function openPayDrawer(invoiceId) {
  const inv = state.facturas.find(f => f.id === invoiceId);
  if (!inv) return;
  state.payInvoiceId = invoiceId;
  document.getElementById('pay-inv-id').textContent = inv.folio;
  document.getElementById('pay-inv-id-2').textContent = inv.folio;
  document.getElementById('pay-inv-concept').textContent = inv.tipo === 'cotizacion' ? 'Cotización' : 'Factura';
  document.getElementById('pay-inv-amount').textContent = fmtMoney(inv.total);
  document.getElementById('pay-card-err').textContent = '';
  document.getElementById('pay-spei-status').textContent = '';
  document.getElementById('pay-element').innerHTML = '<div style="color:var(--muted-5);font-size:13px">Preparando pago…</div>';
  document.getElementById('pay-card-btn').style.display = 'none';
  payBg.classList.add('show');

  try {
    const res = await authFetch('/portal/payment-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentoId: invoiceId }),
    });
    const data = await res.json();
    if (data.bankDetails) {
      document.getElementById('pay-bank-details').innerHTML = `
        <div class="spei-row"><span>Beneficiario</span><span>${esc(data.bankDetails.beneficiario)}</span></div>
        <div class="spei-row"><span>CLABE</span><span class="mono">${esc(data.bankDetails.clabe)}</span></div>
        <div class="spei-row"><span>Banco</span><span>${esc(data.bankDetails.banco)}</span></div>
        <div class="spei-row"><span>Referencia</span><span class="mono">${esc(inv.folio)}</span></div>`;
    }
    if (!data.clientSecret) {
      document.getElementById('pay-element').innerHTML = '';
      document.getElementById('pay-card-err').textContent = data.error || 'No se pudo preparar el pago con tarjeta.';
      return;
    }
    if (!stripeClient) stripeClient = Stripe(data.publishableKey);
    stripeElements = stripeClient.elements({
      clientSecret: data.clientSecret,
      appearance: { theme: 'night', variables: { colorPrimary: '#ff5a1f', colorBackground: '#201f1d', fontFamily: 'Inter, sans-serif' } },
    });
    document.getElementById('pay-element').innerHTML = '';
    stripeElements.create('payment').mount('#pay-element');
    document.getElementById('pay-card-btn').style.display = 'block';
  } catch (e) {
    document.getElementById('pay-element').innerHTML = '';
    document.getElementById('pay-card-err').textContent = 'Error de conexión.';
  }
}

function closePayDrawer() {
  payBg.classList.remove('show');
  document.getElementById('pay-element').innerHTML = '';
  stripeElements = null;
  state.payInvoiceId = null;
}

document.getElementById('pay-card-btn').addEventListener('click', async () => {
  if (!stripeClient || !stripeElements) return;
  const btn = document.getElementById('pay-card-btn');
  const errEl = document.getElementById('pay-card-err');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Procesando…';
  const { error, paymentIntent } = await stripeClient.confirmPayment({
    elements: stripeElements, confirmParams: { return_url: window.location.href }, redirect: 'if_required',
  });
  btn.disabled = false; btn.textContent = 'Pagar';
  if (error) { errEl.textContent = error.message || 'No se pudo procesar el pago.'; return; }
  if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
    fireConfetti();
    showToast('¡Pago recibido!');
    closePayDrawer();
    setTimeout(refreshFacturasAndRerender, 1200);
  }
});

document.getElementById('pay-spei-btn').addEventListener('click', () => {
  document.getElementById('pay-comprobante-file').click();
});
document.getElementById('pay-comprobante-file').addEventListener('change', async () => {
  const fileInput = document.getElementById('pay-comprobante-file');
  const statusEl = document.getElementById('pay-spei-status');
  const file = fileInput.files[0];
  if (!file || !state.payInvoiceId) return;
  statusEl.style.color = 'var(--muted-5)';
  statusEl.textContent = 'Subiendo y verificando…';
  try {
    const form = new FormData();
    form.append('documentoId', state.payInvoiceId);
    form.append('file', file);
    const res = await authFetch('/portal/comprobante', { method: 'POST', body: form });
    const data = await res.json();
    if (!data.ok) { statusEl.style.color = 'var(--red)'; statusEl.textContent = data.error || 'No se pudo subir el comprobante.'; return; }
    if (data.status === 'confirmado') {
      fireConfetti();
      statusEl.style.color = 'var(--green)'; statusEl.textContent = '¡Pago confirmado!';
      showToast('¡Pago confirmado!');
      setTimeout(() => { closePayDrawer(); refreshFacturasAndRerender(); }, 900);
    } else {
      statusEl.style.color = 'var(--green)'; statusEl.textContent = 'Comprobante recibido — lo estamos verificando.';
    }
  } catch (e) {
    statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Error de conexión.';
  }
  fileInput.value = '';
});

async function refreshFacturasAndRerender() {
  try {
    const res = await authFetch('/portal/facturas');
    const data = await res.json();
    state.facturas = data.documentos || [];
  } catch (e) {}
  loadScreen(state.screen);
}

/* ── CONTRATOS ── */
function filterToggleLabel(showAll, name) { return showAll ? `Filtrar por ${name}` : 'Ver todos los proyectos'; }
function filterLabel(showAll, name) { return showAll ? 'Viendo todos los proyectos' : `Viendo: ${name}`; }

async function fetchMisDocumentos(tipos, showAll) {
  const proy = activeProyecto();
  if (!state.proyectos.length) return [];
  let q = `/obra/mis-documentos?tipo=${tipos.join(',')}`;
  if (!showAll && proy) q += `&proyecto_id=${encodeURIComponent(proy.id)}`;
  try {
    const res = await authFetch(q);
    const data = await res.json();
    return data.documentos || [];
  } catch (e) { return []; }
}

async function renderContratos() {
  const proy = activeProyecto();
  const showAll = state.showAllProjects.contratos;
  document.getElementById('contratos-filter-lbl').textContent = proy ? filterLabel(showAll, proy.nombre) : '';
  const toggle = document.getElementById('contratos-filter-toggle');
  toggle.textContent = proy ? filterToggleLabel(showAll, proy.nombre) : 'Ver todos los proyectos';
  toggle.onclick = () => { state.showAllProjects.contratos = !state.showAllProjects.contratos; renderContratos(); };

  const docs = await fetchMisDocumentos(['CON'], showAll);
  const list = document.getElementById('contratos-list');
  const empty = document.getElementById('contratos-empty');
  if (!docs.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  list.innerHTML = docs.map(d => {
    const color = statusColor(d.status);
    return `
    <div class="contract-card">
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <span class="contract-name">${esc(d.data?.objeto_contrato || DOC_TIPO_LABEL.CON)}</span>
          <span class="pill" style="border-color:${color};color:${color}">${esc(DOC_STATUS_LABEL[d.status] || d.status)}</span>
        </div>
        <p class="contract-scope">${esc(d.data?.objeto_contrato || '')}</p>
        <div class="contract-meta">
          <span>Firmado el ${fmtDate(d.data?.fecha_firma || d.published_at)}</span>
          <span class="mono" style="color:rgba(244,241,236,.85)">Monto total ${fmtMoney(d.data?.monto_total)}</span>
        </div>
      </div>
      <div class="contract-actions">
        <button class="gbtn">Ver documento</button>
        <button class="lg-btn-ghost" style="color:var(--accent)">Descargar PDF</button>
      </div>
    </div>`;
  }).join('');
}

/* ── APROBACIONES ── */
async function renderAprobaciones() {
  const proy = activeProyecto();
  const showAll = state.showAllProjects.aprobaciones;
  document.getElementById('aprob-filter-lbl').textContent = proy ? filterLabel(showAll, proy.nombre) : '';
  const toggle = document.getElementById('aprob-filter-toggle');
  toggle.textContent = proy ? filterToggleLabel(showAll, proy.nombre) : 'Ver todos los proyectos';
  toggle.onclick = () => { state.showAllProjects.aprobaciones = !state.showAllProjects.aprobaciones; renderAprobaciones(); };

  const docs = await fetchMisDocumentos(['COT', 'OC'], showAll);
  const actionable = docs.filter(d => ['pendiente_aprobacion', 'aprobado', 'rechazado'].includes(d.status));
  const pending = actionable.filter(d => d.status === 'pendiente_aprobacion');
  const history = actionable.filter(d => d.status !== 'pendiente_aprobacion');

  const pendList = document.getElementById('aprob-pending-list');
  const pendEmpty = document.getElementById('aprob-empty');
  if (!pending.length) { pendList.innerHTML = ''; pendEmpty.style.display = 'block'; }
  else {
    pendEmpty.style.display = 'none';
    pendList.innerHTML = pending.map(d => {
      const delta = Number(d.data?.impacto_monto || d.data?.monto_total || 0);
      const deltaColor = delta >= 0 ? '#e0a83c' : '#5fbf8a';
      return `
      <button class="approval-row" data-doc="${esc(d.id)}">
        <span class="tbl-cell-mono" style="color:var(--muted-6)">${esc(d.folio)}</span>
        <span class="mono" style="font-size:10px;letter-spacing:.04em;color:var(--muted-4);text-transform:uppercase">${esc(DOC_TIPO_LABEL[d.tipo] || d.tipo)}</span>
        <span style="font-size:14px;font-weight:600">${esc(d.data?.descripcion_cambio || d.data?.objeto_contrato || d.folio)}</span>
        <span style="font-size:12.5px;color:var(--muted-5)">${esc(d.proyecto_nombre)}</span>
        <span class="mono" style="font-size:13px;color:${deltaColor}">${delta >= 0 ? '+' : '−'}${fmtMoney(Math.abs(delta))}</span>
        <span class="pill" style="border-color:${statusColor(d.status)};color:${statusColor(d.status)};justify-self:start">${esc(DOC_STATUS_LABEL[d.status])}</span>
      </button>`;
    }).join('');
    pendList.querySelectorAll('[data-doc]').forEach(el => el.addEventListener('click', () => openApprovalModal(el.dataset.doc, actionable)));
  }

  const histList = document.getElementById('aprob-history-list');
  const histEmpty = document.getElementById('aprob-history-empty');
  if (!history.length) { histList.innerHTML = ''; histEmpty.style.display = 'block'; }
  else {
    histEmpty.style.display = 'none';
    histList.innerHTML = history.map(d => `
      <div class="approval-row history">
        <span class="mono" style="font-size:12px;color:var(--muted-5)">${esc(d.folio)}</span>
        <span class="mono" style="font-size:9.5px;letter-spacing:.04em;color:var(--muted-4);text-transform:uppercase">${esc(DOC_TIPO_LABEL[d.tipo] || d.tipo)}</span>
        <span style="font-size:13px;color:rgba(244,241,236,.75)">${esc(d.data?.descripcion_cambio || d.folio)}</span>
        <span style="font-size:12px;color:var(--muted-45)">${esc(d.proyecto_nombre)}</span>
        <span style="font-size:11.5px;color:var(--muted-4)">${esc(d.data?.signer_name || '')}</span>
        <span class="pill" style="border-color:${statusColor(d.status)};color:${statusColor(d.status)};justify-self:start">${esc(DOC_STATUS_LABEL[d.status])}</span>
      </div>`).join('');
  }
}

/* ── APROBACIÓN: modal con firma ── */
const coBg = document.getElementById('co-modal-bg');
document.getElementById('co-close-btn').addEventListener('click', closeApprovalModal);
coBg.addEventListener('click', e => { if (e.target === coBg) closeApprovalModal(); });
document.getElementById('co-modal-panel').addEventListener('click', e => e.stopPropagation());

function openApprovalModal(docId, pool) {
  const doc = pool.find(d => d.id === docId);
  if (!doc) return;
  state.coDoc = doc;
  document.getElementById('co-meta').textContent = `${doc.folio} · ${DOC_TIPO_LABEL[doc.tipo] || doc.tipo} · ${doc.proyecto_nombre}`;
  document.getElementById('co-title').textContent = doc.data?.descripcion_cambio || doc.data?.objeto_contrato || doc.folio;
  document.getElementById('co-desc').textContent = doc.data?.motivo_cambio || doc.data?.descripcion_alcance || '';
  document.getElementById('co-pdf-label').textContent = `${doc.folio}.pdf`;

  const items = doc.data?.items;
  const itemsBlock = document.getElementById('co-items');
  if (Array.isArray(items) && items.length) {
    itemsBlock.style.display = 'block';
    document.getElementById('co-items-rows').innerHTML = items.map(it => `
      <div class="co-items-row">
        <span style="color:var(--text)">${esc(it.name)}</span>
        <span style="color:var(--muted-6)">${esc(it.spec || '')}</span>
        <span style="color:var(--muted-6)">${esc(it.qty)}</span>
        <span class="mono" style="color:rgba(244,241,236,.85)">${fmtMoney((it.price || 0) * (it.qty || 1))}</span>
      </div>`).join('');
  } else itemsBlock.style.display = 'none';

  const delta = Number(doc.data?.impacto_monto || 0);
  document.getElementById('co-cost').textContent = (delta >= 0 ? '+' : '−') + fmtMoney(Math.abs(delta));
  document.getElementById('co-cost').style.color = delta >= 0 ? '#e0a83c' : '#5fbf8a';
  document.getElementById('co-date').textContent = fmtDate(doc.published_at || doc.created_at);

  const pending = doc.status === 'pendiente_aprobacion';
  document.getElementById('co-pending-block').style.display = pending ? 'flex' : 'none';
  document.getElementById('co-decided-block').style.display = pending ? 'none' : 'flex';
  if (!pending) {
    const color = statusColor(doc.status);
    const stamp = document.getElementById('co-stamp');
    stamp.textContent = DOC_STATUS_LABEL[doc.status];
    stamp.style.borderColor = color; stamp.style.color = color;
    document.getElementById('co-signed-by').textContent = doc.data?.signer_name ? `Firmado por ${doc.data.signer_name}` : '';
    document.getElementById('co-signed-by').style.color = color;
  } else {
    document.getElementById('co-signer-name').value = '';
    state.hasSignature = false;
    clearSignatureCanvas();
    updateApproveBtnState();
  }

  coBg.classList.add('show');
}
function closeApprovalModal() { coBg.classList.remove('show'); state.coDoc = null; }

document.getElementById('co-signer-name').addEventListener('input', updateApproveBtnState);
function updateApproveBtnState() {
  const btn = document.getElementById('co-approve-btn');
  const ready = document.getElementById('co-signer-name').value.trim() && state.hasSignature;
  btn.disabled = !ready;
  btn.classList.toggle('ready', !!ready);
}

/* signature canvas */
const coCanvas = document.getElementById('co-canvas');
const coCtx = coCanvas.getContext('2d');
let drawing = false, lastPos = null;
function getPos(e, rect) {
  const t = e.touches && e.touches[0];
  const clientX = t ? t.clientX : e.clientX;
  const clientY = t ? t.clientY : e.clientY;
  const scaleX = coCanvas.width / rect.width;
  const scaleY = coCanvas.height / rect.height;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}
function startDraw(e) { e.preventDefault(); drawing = true; lastPos = getPos(e, coCanvas.getBoundingClientRect()); }
function moveDraw(e) {
  if (!drawing) return;
  e.preventDefault();
  const rect = coCanvas.getBoundingClientRect();
  coCtx.strokeStyle = '#f4f1ec'; coCtx.lineWidth = 2.5; coCtx.lineCap = 'round';
  const pos = getPos(e, rect);
  coCtx.beginPath(); coCtx.moveTo(lastPos.x, lastPos.y); coCtx.lineTo(pos.x, pos.y); coCtx.stroke();
  lastPos = pos;
  if (!state.hasSignature) { state.hasSignature = true; updateApproveBtnState(); }
}
function endDraw() { drawing = false; }
function clearSignatureCanvas() { coCtx.clearRect(0, 0, coCanvas.width, coCanvas.height); }
coCanvas.addEventListener('mousedown', startDraw);
coCanvas.addEventListener('mousemove', moveDraw);
coCanvas.addEventListener('mouseup', endDraw);
coCanvas.addEventListener('mouseleave', endDraw);
coCanvas.addEventListener('touchstart', startDraw);
coCanvas.addEventListener('touchmove', moveDraw);
coCanvas.addEventListener('touchend', endDraw);
document.getElementById('co-clear-sig').addEventListener('click', () => { clearSignatureCanvas(); state.hasSignature = false; updateApproveBtnState(); });

async function submitDecision(decision) {
  if (!state.coDoc) return;
  const signerName = document.getElementById('co-signer-name').value.trim() || 'Cliente';
  const signatureDataUrl = state.hasSignature ? coCanvas.toDataURL('image/png') : null;
  try {
    const res = await authFetch(`/obra/documentos/${state.coDoc.id}/decidir`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, signerName, signatureDataUrl }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'No se pudo registrar la decisión'); return; }
    if (decision === 'aprobado') fireConfetti();
    showToast(decision === 'aprobado' ? '¡Aprobado y firmado!' : 'Rechazado');
    closeApprovalModal();
    renderAprobaciones();
  } catch (e) { showToast('Error de conexión'); }
}
document.getElementById('co-approve-btn').addEventListener('click', () => submitDecision('aprobado'));
document.getElementById('co-reject-btn').addEventListener('click', () => submitDecision('rechazado'));

/* ── REPORTES ── */
async function renderReportes() {
  const proy = activeProyecto();
  const showAll = state.showAllProjects.reportes;
  document.getElementById('reportes-filter-lbl').textContent = proy ? filterLabel(showAll, proy.nombre) : '';
  const toggle = document.getElementById('reportes-filter-toggle');
  toggle.textContent = proy ? filterToggleLabel(showAll, proy.nombre) : 'Ver todos los proyectos';
  toggle.onclick = () => { state.showAllProjects.reportes = !state.showAllProjects.reportes; renderReportes(); };

  const docs = await fetchMisDocumentos(['RF'], showAll);
  const list = document.getElementById('reportes-list');
  const empty = document.getElementById('reportes-empty');
  if (!docs.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  list.innerHTML = docs.map(d => {
    const photos = Array.isArray(d.data?.archivos) ? d.data.archivos : [];
    return `
    <div class="report-entry">
      <div>
        <div class="report-entry-date mono">${fmtDate(d.published_at || d.created_at)}</div>
        <div class="report-entry-pct mono">${d.data?.porcentaje_avance || ''}${d.data?.porcentaje_avance ? '%' : ''}</div>
      </div>
      <div>
        <div class="report-entry-proj">${esc(d.proyecto_nombre)}</div>
        <p class="report-entry-note">${esc(d.data?.descripcion_por_foto || '')}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${photos.map((_, i) => `<div class="photo-block"><span>FOTO ${i + 1}</span></div>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ── DOCUMENTOS ── */
async function renderDocumentos() {
  const proy = activeProyecto();
  const showAll = state.showAllProjects.documentos;
  document.getElementById('docs-filter-lbl').textContent = proy ? filterLabel(showAll, proy.nombre) : '';
  const toggle = document.getElementById('docs-filter-toggle');
  toggle.textContent = proy ? filterToggleLabel(showAll, proy.nombre) : 'Ver todos los proyectos';
  toggle.onclick = () => { state.showAllProjects.documentos = !state.showAllProjects.documentos; renderDocumentos(); };

  const docs = await fetchMisDocumentos(['COT', 'CON', 'CC', 'CAL', 'OC', 'BIT', 'ENT', 'RF', 'ACT'], showAll);
  const cats = DOC_CATEGORY_ORDER.map(cat => ({ cat, files: docs.filter(d => DOC_CATEGORY[d.tipo] === cat) })).filter(c => c.files.length);
  const wrap = document.getElementById('docs-cats');
  const empty = document.getElementById('docs-empty');
  if (!cats.length) { wrap.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  wrap.innerHTML = cats.map(c => `
    <div class="doc-cat">
      <div class="doc-cat-title">${esc(c.cat)}</div>
      <div class="doc-cat-list">
        ${c.files.map(d => `
          <div class="doc-file-row">
            <div class="doc-file-left">
              <span class="pdf-badge">PDF</span>
              <span style="font-size:13.5px">${esc(DOC_TIPO_LABEL[d.tipo] || d.tipo)} — ${esc(d.folio)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:16px">
              <span class="doc-file-meta">${fmtDate(d.published_at || d.created_at)}</span>
              <button class="gbtn" data-preview="${esc(d.id)}">Ver</button>
              <span class="tbl-dl">Descargar</span>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
  wrap.querySelectorAll('[data-preview]').forEach(el => el.addEventListener('click', () => {
    const doc = docs.find(d => d.id === el.dataset.preview);
    if (!doc) return;
    document.getElementById('doc-preview-name').textContent = `${DOC_TIPO_LABEL[doc.tipo] || doc.tipo} — ${doc.folio}`;
    document.getElementById('doc-preview-bg').classList.add('show');
  }));
}
document.getElementById('doc-preview-close').addEventListener('click', () => document.getElementById('doc-preview-bg').classList.remove('show'));
document.getElementById('doc-preview-bg').addEventListener('click', e => { if (e.target.id === 'doc-preview-bg') e.currentTarget.classList.remove('show'); });

/* ── MENSAJES ── */
async function renderMensajes() {
  const proy = activeProyecto();
  document.getElementById('msg-filter-lbl').textContent = proy ? `Viendo: ${proy.nombre}` : '';

  try {
    const res = await authFetch('/obra/mensajes/hilos');
    const data = await res.json();
    state.hilos = data.hilos || [];
  } catch (e) { state.hilos = []; }

  const scoped = proy ? state.hilos.filter(h => h.proyecto_id === proy.id) : state.hilos;
  const empty = document.getElementById('msg-empty');
  const grid = document.getElementById('msg-grid');
  if (!scoped.length) { empty.style.display = 'flex'; grid.style.display = 'none'; return; }
  empty.style.display = 'none'; grid.style.display = 'grid';

  if (!scoped.find(h => h.id === state.activeThreadId)) state.activeThreadId = scoped[0].id;

  const list = document.getElementById('thread-list');
  list.innerHTML = scoped.map(h => `
    <button class="thread-item${h.id === state.activeThreadId ? ' active' : ''}" data-thread="${esc(h.id)}">
      <div class="thread-item-top">
        <span class="thread-topic">${esc(h.topic)}</span>
        ${h.unread > 0 ? '<span class="unread-dot"></span>' : ''}
      </div>
      <span class="thread-proj">${esc(h.proyecto_nombre)}</span>
    </button>`).join('');
  list.querySelectorAll('[data-thread]').forEach(el => el.addEventListener('click', () => { state.activeThreadId = el.dataset.thread; renderMensajes(); }));

  await loadThreadDetail(state.activeThreadId);
}

async function loadThreadDetail(threadId) {
  try {
    const res = await authFetch(`/obra/mensajes/hilos/${threadId}`);
    const data = await res.json();
    state.activeThreadDetail = data;
  } catch (e) { state.activeThreadDetail = null; }

  const d = state.activeThreadDetail;
  if (!d) return;
  document.getElementById('thread-head').innerHTML = `<div class="topic">${esc(d.hilo.topic)}</div><div class="proj">${esc(d.hilo.proyecto_nombre)}</div>`;
  document.getElementById('thread-body').innerHTML = (d.mensajes || []).map(m => `
    <div class="bubble-row ${m.from_type === 'client' ? 'client' : 'gapt'}">
      <div class="bubble ${m.from_type === 'client' ? 'client' : 'gapt'}">
        ${esc(m.body)}
        <div class="bubble-time">${new Date(m.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </div>`).join('');
  const body = document.getElementById('thread-body');
  body.scrollTop = body.scrollHeight;
}

document.getElementById('thread-send-btn').addEventListener('click', sendThreadMessage);
document.getElementById('thread-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendThreadMessage(); });
async function sendThreadMessage() {
  const input = document.getElementById('thread-input');
  const text = input.value.trim();
  if (!text || !state.activeThreadId) return;
  input.value = '';
  try {
    await authFetch(`/obra/mensajes/hilos/${state.activeThreadId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }),
    });
  } catch (e) {}
  await loadThreadDetail(state.activeThreadId);
}

/* new thread modal */
const ntBg = document.getElementById('nt-modal-bg');
document.getElementById('msg-new-thread-btn').addEventListener('click', () => {
  const sel = document.getElementById('nt-proyecto');
  sel.innerHTML = state.proyectos.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('');
  document.getElementById('nt-topic').value = '';
  document.getElementById('nt-body').value = '';
  document.getElementById('nt-err').textContent = '';
  ntBg.classList.add('show');
});
document.getElementById('nt-close-btn').addEventListener('click', () => ntBg.classList.remove('show'));
ntBg.addEventListener('click', e => { if (e.target === ntBg) ntBg.classList.remove('show'); });
document.getElementById('nt-submit').addEventListener('click', async () => {
  const proyecto_id = document.getElementById('nt-proyecto').value;
  const topic = document.getElementById('nt-topic').value.trim();
  const body = document.getElementById('nt-body').value.trim();
  const errEl = document.getElementById('nt-err');
  if (!topic || !body) { errEl.textContent = 'Escribe un tema y un mensaje.'; return; }
  try {
    const res = await authFetch('/obra/mensajes/hilos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proyecto_id, topic, body }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'No se pudo enviar.'; return; }
    ntBg.classList.remove('show');
    state.activeThreadId = data.hilo.id;
    renderMensajes();
  } catch (e) { errEl.textContent = 'Error de conexión.'; }
});

/* ── INIT ── */
async function checkExistingSession() {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${WORKER}/obra/session`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error();
    state.cliente = data.cliente;
    await enterApp();
  } catch (e) { clearToken(); }
}
checkExistingSession();
