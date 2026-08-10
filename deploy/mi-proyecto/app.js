const WORKER = 'https://gapt-mail.hvfgc6bp2r.workers.dev';
const TOKEN_KEY = 'gapt_obra_token';

const loginView = document.getElementById('mpLogin');
const dashView = document.getElementById('mpDash');
const loginForm = document.getElementById('loginForm');
const loginSubmit = document.getElementById('loginSubmit');
const forgotBtn = document.getElementById('forgotBtn');
const loginFatal = document.getElementById('mpLoginFatal');
const loginOk = document.getElementById('mpLoginOk');
const whoName = document.getElementById('whoName');
const logoutBtn = document.getElementById('logoutBtn');
const proyectosList = document.getElementById('proyectosList');
const docsList = document.getElementById('docsList');

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function authFetch(path, opts = {}) {
  const token = getToken();
  return fetch(`${WORKER}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), 'Authorization': `Bearer ${token}` },
  });
}

function showLogin() {
  dashView.style.display = 'none';
  loginView.style.display = 'block';
}
function showDash() {
  loginView.style.display = 'none';
  dashView.style.display = 'block';
}

const TIPO_LABEL = { residencial: 'Residencial', comercial: 'Comercial', remodelacion: 'Remodelación', obra_nueva: 'Obra nueva' };
const STATUS_LABEL = { lead: 'Lead', cotizado: 'Cotizado', activo: 'Activo', en_obra: 'En obra', cerrado: 'Cerrado', cancelado: 'Cancelado' };
const DOC_STATUS_LABEL = {
  borrador: 'Borrador', publicado: 'Publicado', archivado: 'Archivado',
  pendiente_aprobacion: 'Pendiente de aprobación', aprobado: 'Aprobado', rechazado: 'Rechazado',
  generado_para_firma: 'Generado para firma', firmado_escaneado: 'Firmado', cancelado: 'Cancelado',
};
const DOC_TIPO_LABEL = {
  REQ: 'Requisición de datos', COT: 'Cotización', CON: 'Contrato', OC: 'Orden de cambio',
  BIT: 'Bitácora de obra', ENT: 'Entrega de partidas', RF: 'Reporte fotográfico',
  ACT: 'Acta de entrega-recepción', CC: 'Catálogo de conceptos', CAL: 'Calendario de obra',
};
const AREA_LABEL = { cocina: 'Cocina', banos: 'Baños', fachada: 'Fachada', ampliacion: 'Ampliación', remodelacion_integral: 'Remodelación integral', otro: 'Otro' };
const CONTACTO_LABEL = { whatsapp: 'WhatsApp', llamada: 'Llamada', email: 'Correo' };

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return iso; }
}

function renderReqFields(data) {
  const rows = [
    ['Tipo de proyecto', TIPO_LABEL[data.tipo_proyecto] || data.tipo_proyecto],
    ['Dirección del inmueble', data.direccion_inmueble, true],
    ['Superficie aproximada', data.superficie_m2 ? `${data.superficie_m2} m²` : '—'],
    ['Áreas de intervención', (data.areas_intervencion || []).map(a => AREA_LABEL[a] || a).join(', ') || '—'],
    ['Descripción del alcance', data.descripcion_alcance, true],
    ['Presupuesto estimado', data.presupuesto_estimado || '—'],
    ['Plazo deseado', data.plazo_deseado || '—'],
    ['Medio de contacto', CONTACTO_LABEL[data.medio_contacto] || data.medio_contacto],
    ['Archivos adjuntos', (data.archivos || []).length ? `${data.archivos.length} archivo(s)` : 'Ninguno'],
  ];
  return rows.map(([k, v, full]) => `
    <div class="mp-doc__f${full ? ' full' : ''}">
      <span class="mp-doc__f-k">_ ${k}</span>
      <span class="mp-doc__f-v${full ? ' full' : ''}">${escapeHtml(String(v ?? '—'))}</span>
    </div>`).join('');
}

function renderGenericFields(data) {
  return Object.entries(data || {}).map(([k, v]) => `
    <div class="mp-doc__f">
      <span class="mp-doc__f-k">_ ${escapeHtml(k)}</span>
      <span class="mp-doc__f-v">${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—'))}</span>
    </div>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderDoc(doc) {
  const fieldsHtml = doc.tipo === 'REQ' ? renderReqFields(doc.data || {}) : renderGenericFields(doc.data || {});
  return `
    <div class="mp-doc">
      <div class="mp-doc__head">
        <div>
          <div class="mp-doc__tipo">${escapeHtml(DOC_TIPO_LABEL[doc.tipo] || doc.tipo)} · ${escapeHtml(DOC_STATUS_LABEL[doc.status] || doc.status)}</div>
          <div class="mp-doc__folio">${escapeHtml(doc.folio)}</div>
        </div>
        <div class="mp-doc__fecha">${fmtDate(doc.published_at || doc.created_at)}</div>
      </div>
      <div class="mp-doc__fields">${fieldsHtml}</div>
    </div>`;
}

async function loadDocumentos(proyectoId) {
  docsList.innerHTML = '<div class="mp-empty">Cargando…</div>';
  try {
    const res = await authFetch(`/obra/documentos?proyecto_id=${encodeURIComponent(proyectoId)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'No se pudieron cargar los documentos.');
    if (!json.documentos.length) {
      docsList.innerHTML = '<div class="mp-empty">Este proyecto todavía no tiene documentos publicados.</div>';
      return;
    }
    docsList.innerHTML = json.documentos.map(renderDoc).join('');
  } catch (err) {
    docsList.innerHTML = `<div class="mp-empty">⚠ ${escapeHtml(err.message)}</div>`;
  }
}

function renderProyectos(proyectos) {
  if (!proyectos.length) {
    proyectosList.innerHTML = '<div class="mp-empty">Todavía no tienes proyectos registrados.</div>';
    return;
  }
  proyectosList.innerHTML = proyectos.map((p, i) => `
    <div class="mp-proyecto${i === 0 ? ' active' : ''}" data-id="${escapeHtml(p.id)}" data-hover>
      <span class="mp-proyecto__nombre">${escapeHtml(p.nombre)}</span>
      <span class="mp-proyecto__status">${escapeHtml(STATUS_LABEL[p.status] || p.status)}</span>
    </div>`).join('');

  proyectosList.querySelectorAll('.mp-proyecto').forEach(el => {
    el.addEventListener('click', () => {
      proyectosList.querySelectorAll('.mp-proyecto').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      loadDocumentos(el.dataset.id);
    });
  });

  if (proyectos[0]) loadDocumentos(proyectos[0].id);
}

async function loadDashboard(cliente) {
  whoName.textContent = cliente.nombre_completo || cliente.email;
  showDash();
  try {
    const res = await authFetch('/obra/proyectos');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'No se pudieron cargar tus proyectos.');
    renderProyectos(json.proyectos);
  } catch (err) {
    proyectosList.innerHTML = `<div class="mp-empty">⚠ ${escapeHtml(err.message)}</div>`;
  }
}

async function checkExistingSession() {
  const token = getToken();
  if (!token) return showLogin();
  try {
    const res = await authFetch('/obra/session');
    const json = await res.json();
    if (!res.ok) throw new Error();
    await loadDashboard(json.cliente);
  } catch {
    clearToken();
    showLogin();
  }
}

function setErr(fieldId, errId, msg) {
  const field = document.getElementById(fieldId);
  if (field) field.classList.toggle('err', !!msg);
  const errEl = document.getElementById(errId);
  if (errEl) errEl.textContent = msg ? '⚠ ' + msg : '';
}

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginFatal.style.display = 'none';
  loginOk.style.display = 'none';
  setErr('field-login-email', 'err-login-email', '');
  setErr('field-login-pin', 'err-login-pin', '');

  const email = loginForm.email.value.trim();
  const pin = loginForm.pin.value.trim();
  if (!email) { setErr('field-login-email', 'err-login-email', 'Ingresa tu correo.'); return; }
  if (!pin) { setErr('field-login-pin', 'err-login-pin', 'Ingresa tu PIN.'); return; }

  loginSubmit.disabled = true;
  try {
    const res = await fetch(`${WORKER}/obra/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, pin }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'No se pudo iniciar sesión.');
    setToken(json.token);
    await loadDashboard(json.cliente);
  } catch (err) {
    loginFatal.textContent = '⚠ ' + err.message;
    loginFatal.style.display = 'block';
  } finally {
    loginSubmit.disabled = false;
  }
});

forgotBtn.addEventListener('click', async () => {
  const email = loginForm.email.value.trim();
  if (!email) { setErr('field-login-email', 'err-login-email', 'Escribe tu correo primero.'); return; }
  loginFatal.style.display = 'none';
  loginOk.style.display = 'none';
  try {
    const res = await fetch(`${WORKER}/obra/login/forgot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    loginOk.textContent = json.message || 'Si el correo existe, se envió un PIN nuevo.';
    loginOk.style.display = 'block';
  } catch {
    loginFatal.textContent = '⚠ No se pudo procesar la solicitud.';
    loginFatal.style.display = 'block';
  }
});

logoutBtn.addEventListener('click', async () => {
  try { await authFetch('/obra/logout', { method: 'POST' }); } catch {}
  clearToken();
  showLogin();
  loginForm.reset();
});

checkExistingSession();
