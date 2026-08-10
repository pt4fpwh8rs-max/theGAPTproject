const WORKER = 'https://gapt-mail.hvfgc6bp2r.workers.dev';
const MAX_FILES = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const CONFETTI_COLORS = ['#FF5A1F', '#2563FF', '#6234E6', '#FF3D8B', '#FFB300', '#19A85B'];
const CONTACTO_PREVIO_LABEL = { whatsapp: 'WhatsApp', llamada: 'Llamada', correo: 'Correo' };

const viewGate = document.getElementById('view-gate');
const viewForm = document.getElementById('view-form');
const viewConfirm = document.getElementById('view-confirm');

function showOnly(view) {
  [viewGate, viewForm, viewConfirm].forEach(v => v.style.display = 'none');
  view.style.display = view === viewConfirm ? 'flex' : 'block';
}

function fmtDateShort(d) {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

let invite = null;
let selectedFiles = [];

async function init() {
  const token = new URLSearchParams(location.search).get('t');
  if (!token) {
    showOnly(viewGate);
    return;
  }
  try {
    const res = await fetch(`${WORKER}/obra/invite/${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('gate-title').textContent = res.status === 410 ? 'Este enlace ya no está disponible' : 'Enlace no válido';
      document.getElementById('gate-msg').textContent = data.error || 'Si crees que esto es un error, contáctanos y te ayudamos.';
      showOnly(viewGate);
      return;
    }
    invite = data.invite;
    invite.token = token;
    renderInviteContext();
    showOnly(viewForm);
  } catch (e) {
    document.getElementById('gate-title').textContent = 'No se pudo cargar el formulario';
    document.getElementById('gate-msg').textContent = 'Error de conexión — intenta de nuevo en unos minutos.';
    showOnly(viewGate);
  }
}

function renderInviteContext() {
  const previoEl = document.getElementById('hero-contacto-previo');
  if (invite.medio_contacto_previo) {
    const label = CONTACTO_PREVIO_LABEL[invite.medio_contacto_previo] || invite.medio_contacto_previo;
    previoEl.textContent = `Vía ${label}${invite.fecha_contacto ? ' · ' + fmtDateShort(invite.fecha_contacto) : ''}`;
  } else {
    previoEl.textContent = '—';
  }
  document.getElementById('hero-folio').textContent = invite.folio;

  const form = document.getElementById('reqForm');
  if (invite.nombre_prefill) form.nombre_completo.value = invite.nombre_prefill;
  if (invite.email_prefill) form.email.value = invite.email_prefill;
  if (invite.telefono_prefill) form.telefono.value = invite.telefono_prefill;
}

/* ── áreas de intervención: opcional para consultoría/planos ── */
const tipoSelect = document.querySelector('select[name="tipo_proyecto"]');
tipoSelect.addEventListener('change', updateAreasRequirement);
function updateAreasRequirement() {
  const isConsultoria = tipoSelect.value === 'consultoria_planos';
  document.getElementById('areas-opt-hint').style.display = isConsultoria ? 'inline' : 'none';
}
updateAreasRequirement();

/* ── archivos ── */
const filesInput = document.getElementById('archivosInput');
const filesDrop = document.getElementById('filesDrop');
const fileList = document.getElementById('fileList');

function renderFileList() {
  fileList.innerHTML = '';
  selectedFiles.forEach((file, i) => {
    const row = document.createElement('div');
    row.className = 'filelist-item';
    const kb = Math.round(file.size / 1024);
    row.innerHTML = `<span>${file.name} · ${kb} KB</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Quitar';
    btn.addEventListener('click', () => { selectedFiles.splice(i, 1); renderFileList(); });
    row.appendChild(btn);
    fileList.appendChild(row);
  });
}

function addFiles(fileArr) {
  for (const f of fileArr) {
    if (selectedFiles.length >= MAX_FILES) break;
    if (!ALLOWED_TYPES.includes(f.type)) continue;
    if (f.size > MAX_FILE_BYTES) continue;
    selectedFiles.push(f);
  }
  renderFileList();
}

filesDrop.addEventListener('click', () => filesInput.click());
filesInput.addEventListener('change', () => { addFiles(Array.from(filesInput.files || [])); filesInput.value = ''; });
['dragenter', 'dragover'].forEach(evt => filesDrop.addEventListener(evt, e => { e.preventDefault(); filesDrop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(evt => filesDrop.addEventListener(evt, e => { e.preventDefault(); filesDrop.classList.remove('drag'); }));
filesDrop.addEventListener('drop', e => addFiles(Array.from(e.dataTransfer.files || [])));

/* ── validación + envío ── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const form = document.getElementById('reqForm');
const submitBtn = document.getElementById('reqSubmit');
const fatalBox = document.getElementById('reqFatal');

function setErr(fieldId, msg) {
  const field = document.getElementById(fieldId);
  if (field) field.classList.toggle('err', !!msg);
}

function validate() {
  const v = name => form[name] ? form[name].value.trim() : '';
  const areas = Array.from(form.querySelectorAll('input[name="areas_intervencion"]:checked'));
  const areasRequired = v('tipo_proyecto') !== 'consultoria_planos';

  const checks = [
    !!v('nombre_completo'), !!v('email') && EMAIL_RE.test(v('email')), !!v('telefono'),
    !!v('tipo_proyecto'), !!v('descripcion_alcance'), !!v('medio_contacto'),
  ];
  setErr('field-nombre_completo', !checks[0]);
  setErr('field-email', !checks[1]);
  setErr('field-telefono', !checks[2]);
  setErr('field-tipo_proyecto', !checks[3]);
  setErr('field-medio_contacto', !checks[5]);

  const descField = form.descripcion_alcance.closest('.field');
  descField.classList.toggle('err', !checks[4]);

  const areasOk = !areasRequired || areas.length > 0;
  document.getElementById('err-areas').style.display = areasOk ? 'none' : 'block';
  checks.push(areasOk);

  return !checks.includes(false);
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  fatalBox.style.display = 'none';
  if (!validate()) {
    form.querySelector('.field.err input, .field.err select, .field.err textarea')?.focus();
    return;
  }

  const fd = new FormData();
  fd.append('token', invite.token);
  ['nombre_completo', 'rfc', 'email', 'telefono', 'direccion_inmueble', 'tipo_proyecto', 'alcance_extension',
   'descripcion_alcance', 'presupuesto_estimado', 'fecha_inicio_deseada', 'plazo_deseado', 'medio_contacto']
    .forEach(name => fd.append(name, form[name] ? form[name].value : ''));
  Array.from(form.querySelectorAll('input[name="areas_intervencion"]:checked')).forEach(cb => fd.append('areas_intervencion', cb.value));
  selectedFiles.forEach(f => fd.append('archivos', f, f.name));

  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando…';

  try {
    const res = await fetch(`${WORKER}/obra/req`, { method: 'POST', body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'No se pudo enviar el formulario.');

    document.getElementById('confirmFolio').textContent = `Folio: ${json.folio || invite.folio}`;
    showOnly(viewConfirm);
    fireConfettiLoop();
  } catch (err) {
    fatalBox.textContent = '⚠ ' + err.message;
    fatalBox.style.display = 'block';
    fatalBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar proyecto →';
  }
});

function fireConfettiLoop() {
  const layer = document.getElementById('confettiLayer');
  layer.innerHTML = '';
  for (let i = 0; i < 28; i++) {
    const left = Math.round((i / 28) * 100 + (Math.random() * 4 - 2));
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const delay = (Math.random() * 2.5).toFixed(2);
    const duration = (2.2 + Math.random() * 1.4).toFixed(2);
    const size = 6 + Math.round(Math.random() * 5);
    const rounded = i % 3 === 0;
    const div = document.createElement('div');
    div.className = 'confetti-piece';
    div.style.left = left + '%';
    div.style.width = size + 'px';
    div.style.height = (size * 0.45) + 'px';
    div.style.background = color;
    div.style.borderRadius = rounded ? '50%' : '1px';
    div.style.animation = `gaptConfetti ${duration}s linear ${delay}s infinite`;
    layer.appendChild(div);
  }
}

init();
