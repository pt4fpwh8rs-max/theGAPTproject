const WORKER = 'https://gapt-mail.hvfgc6bp2r.workers.dev';

const STATUS_META = {
  ACTIVA: { color: '#5fbf8a', bg: 'rgba(95,191,138,0.1)', label: 'CREDENCIAL VÁLIDA' },
  VIGENTE: { color: '#5fbf8a', bg: 'rgba(95,191,138,0.1)', label: 'CREDENCIAL VÁLIDA' },
  BAJA: { color: '#e05a4a', bg: 'rgba(224,90,74,0.1)', label: 'COLABORADOR DADO DE BAJA' },
  EXPIRADA: { color: '#e05a4a', bg: 'rgba(224,90,74,0.1)', label: 'CREDENCIAL EXPIRADA' },
  'SIN ASIGNAR': { color: '#e0a83c', bg: 'rgba(224,168,60,0.1)', label: 'TARJETA SIN ASIGNAR' },
};

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function verify() {
  const codigo = new URLSearchParams(window.location.search).get('c');
  if (!codigo) return showNotFound();

  let data;
  try {
    const res = await fetch(`${WORKER}/verificar/${encodeURIComponent(codigo)}`);
    data = await res.json();
    if (!res.ok || !data.found) return showNotFound();
  } catch (_) {
    return showNotFound();
  }

  const meta = STATUS_META[data.status] || { color: '#9c9890', bg: 'rgba(156,152,144,0.1)', label: 'ESTADO DESCONOCIDO' };
  const isColab = data.tipo === 'colaborador';
  const tipoColor = isColab ? '#ff5a1f' : '#3d4dff';

  document.getElementById('view-found').classList.remove('hidden');
  document.getElementById('v-photo').style.setProperty('--st-color', meta.color);
  document.getElementById('v-nombre').textContent = data.nombre || '— Sin asignar —';
  const tipoEl = document.getElementById('v-tipo');
  tipoEl.textContent = isColab ? 'COLABORADOR' : 'CONTRATISTA';
  tipoEl.style.borderColor = tipoColor; tipoEl.style.color = tipoColor;

  const banner = document.getElementById('v-status-banner');
  banner.style.background = meta.bg; banner.style.borderColor = meta.color; banner.style.color = meta.color;
  document.getElementById('v-status-dot').style.background = meta.color;
  document.getElementById('v-status-label').textContent = meta.label;

  if (data.fotoUrl) {
    const img = document.getElementById('v-photo-img');
    img.src = WORKER + data.fotoUrl;
    img.onload = () => { img.style.display = 'block'; };
  }

  if (isColab) {
    document.getElementById('v-rows-colaborador').innerHTML = `
      <div class="row"><span class="lbl">Puesto</span><span class="val">${esc(data.puesto || '—')}</span></div>
      <div class="row"><span class="lbl">No. de empleado</span><span class="val mono">${esc(data.num_empleado || '—')}</span></div>
      <div class="row"><span class="lbl">Tipo de sangre</span><span class="val">${esc(data.tipo_sangre || '—')}</span></div>
      <div class="row"><span class="lbl">Vigencia</span><span class="val">${esc(fmtDate(data.fecha_vigencia))}</span></div>
      <div class="row"><span class="lbl">Contacto de emergencia</span><span class="val">${esc(data.contacto_nombre || '—')} (${esc(data.contacto_parentesco || '—')}) · ${esc(data.contacto_telefono || '—')}</span></div>
    `;
  } else {
    document.getElementById('v-rows-contratista').innerHTML = `
      <div class="row"><span class="lbl">Empresa</span><span class="val">${esc(data.empresa || '—')}</span></div>
      <div class="row"><span class="lbl">Proyecto asignado</span><span class="val">${esc(data.proyecto || '—')}</span></div>
      <div class="row"><span class="lbl">Puesto / oficio</span><span class="val">${esc(data.puesto || '—')}</span></div>
      <div class="row"><span class="lbl">No. de identificación</span><span class="val mono">${esc(data.num_identificacion || '—')}</span></div>
      <div class="row"><span class="lbl">Vigencia</span><span class="val">${esc(fmtDate(data.fecha_vigencia))}</span></div>
      <div class="row"><span class="lbl">Contacto de emergencia</span><span class="val">${esc(data.contacto || '—')}</span></div>
    `;
  }

  const now = new Date();
  document.getElementById('v-footer').textContent = `ID ${data.id} · VERIFICADO ${now.toLocaleDateString('es-MX')} ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
}

function showNotFound() {
  document.getElementById('view-notfound').classList.remove('hidden');
}

verify();
