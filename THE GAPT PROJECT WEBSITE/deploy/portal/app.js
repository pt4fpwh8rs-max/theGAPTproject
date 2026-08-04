const SUPABASE_URL = 'https://gmtfilgvukrylncfshos.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DPO8kJNLi3ljOaTGCoMuZw_gtVtO1-P';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let empresa = null;
let documentos = [];
let docFilter = 'todos';

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

/* ── AUTH ── */
async function sendMagicLink() {
  const email = document.getElementById('auth-email').value.trim();
  const errEl = document.getElementById('auth-err');
  errEl.textContent = '';
  if (!email || !email.includes('@')) { errEl.textContent = 'Escribe un correo válido'; return; }
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });
  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('auth-form').style.display = 'none';
  document.getElementById('auth-sent').style.display = 'block';
  document.getElementById('auth-sent-email').textContent = email;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.reload();
}

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { await enterApp(); return; }
  sb.auth.onAuthStateChange((event, sess) => {
    if (event === 'SIGNED_IN' && sess) enterApp();
  });
}

async function enterApp() {
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  await loadEmpresa();
}

/* ── PERFIL EMPRESA ── */
async function loadEmpresa() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data, error } = await sb.from('empresas').select('*').eq('auth_user_id', user.id).maybeSingle();
  if (error) { showToast('Error cargando perfil: ' + error.message); return; }
  if (!data) {
    openPerfilModal('onboarding');
    return;
  }
  empresa = data;
  renderGreeting();
  await loadDocumentos();
}

function openPerfilModal(mode) {
  const isEdit = mode === 'edit';
  document.getElementById('pf-modal-title').textContent = isEdit ? 'Mi perfil fiscal' : 'Completa tu perfil fiscal';
  document.getElementById('pf-modal-sub').textContent = isEdit ? 'Actualiza tus datos cuando lo necesites.' : 'Lo llenas una sola vez — después pedir tu CFDI es un clic.';
  document.getElementById('pf-close-btn').style.display = isEdit ? 'block' : 'none';
  document.getElementById('pf-save-btn').textContent = isEdit ? 'Guardar cambios' : 'Guardar perfil';
  document.getElementById('pf-status').textContent = '';
  document.getElementById('pf-status').className = 'gstatus';
  document.getElementById('pf-csf').value = '';

  if (isEdit && empresa) {
    document.getElementById('pf-nombre').value = empresa.nombre || '';
    document.getElementById('pf-rfc').value = empresa.rfc || '';
    document.getElementById('pf-cp').value = empresa.codigo_postal || '';
    document.getElementById('pf-regimen').value = empresa.regimen_fiscal || '';
    document.getElementById('pf-uso').value = empresa.uso_cfdi_default || '';
    document.getElementById('pf-csf-hint').textContent = empresa.csf_url ? 'Ya tienes una CSF guardada — sube otra solo si cambió.' : '';
  } else {
    document.getElementById('pf-nombre').value = '';
    document.getElementById('pf-rfc').value = '';
    document.getElementById('pf-cp').value = '';
    document.getElementById('pf-regimen').value = '';
    document.getElementById('pf-uso').value = '';
    document.getElementById('pf-csf-hint').textContent = '';
  }
  document.getElementById('modal-perfil').classList.add('show');
}

function openMiPerfil() { openPerfilModal('edit'); }
function closePerfilModal() {
  if (!empresa) return; // no cerrar sin perfil en onboarding
  document.getElementById('modal-perfil').classList.remove('show');
}

async function guardarPerfil() {
  const { data: { user } } = await sb.auth.getUser();
  const nombre = document.getElementById('pf-nombre').value.trim();
  const rfc = document.getElementById('pf-rfc').value.trim().toUpperCase();
  const cp = document.getElementById('pf-cp').value.trim();
  const regimen = document.getElementById('pf-regimen').value.trim();
  const uso = document.getElementById('pf-uso').value.trim();
  const csfFile = document.getElementById('pf-csf').files[0];
  const statusEl = document.getElementById('pf-status');
  const btn = document.getElementById('pf-save-btn');

  if (!nombre || !rfc) { statusEl.textContent = 'Falta razón social o RFC'; statusEl.className = 'gstatus err'; return; }

  btn.disabled = true;
  statusEl.textContent = 'Guardando...'; statusEl.className = 'gstatus';

  let csfUrl = empresa ? empresa.csf_url : null;
  if (csfFile) {
    const path = `${user.id}/csf.pdf`;
    const { error: upErr } = await sb.storage.from('csf').upload(path, csfFile, { upsert: true });
    if (upErr) { statusEl.textContent = 'Error subiendo CSF: ' + upErr.message; statusEl.className = 'gstatus err'; btn.disabled = false; return; }
    csfUrl = path;
  }

  const payload = {
    nombre, rfc, codigo_postal: cp, regimen_fiscal: regimen,
    uso_cfdi_default: uso, email: user.email, csf_url: csfUrl
  };

  const query = empresa
    ? sb.from('empresas').update(payload).eq('id', empresa.id).select().single()
    : sb.from('empresas').insert({ ...payload, auth_user_id: user.id }).select().single();
  const { data, error } = await query;

  btn.disabled = false;
  if (error) { statusEl.textContent = error.message; statusEl.className = 'gstatus err'; return; }

  const wasNew = !empresa;
  statusEl.textContent = 'Perfil guardado ✓'; statusEl.className = 'gstatus ok';
  empresa = data;
  renderGreeting();
  setTimeout(() => {
    document.getElementById('modal-perfil').classList.remove('show');
    if (wasNew) loadDocumentos(); else renderDocumentos();
  }, 500);
}

/* ── SALUDO + STATS ── */
function renderGreeting() {
  if (!empresa) return;
  const h = new Date().getHours();
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('greeting-hi').textContent = saludo;
  document.getElementById('greeting-name').textContent = empresa.nombre;
  const initials = empresa.nombre.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('avatar-btn').textContent = initials || '--';
}

function renderStats() {
  const pend = documentos.filter(d => d.status === 'pendiente' || d.status === 'vencida');
  document.getElementById('stat-pendientes').textContent = pend.length;
  document.getElementById('stat-total-pendiente').textContent = fmtMoney(pend.reduce((s, d) => s + Number(d.total || 0), 0));
}

/* ── DOCUMENTOS ── */
async function loadDocumentos() {
  const { data, error } = await sb.from('documentos').select('*').eq('empresa_id', empresa.id).order('fecha_emision', { ascending: false });
  if (error) { showToast('Error cargando documentos: ' + error.message); return; }
  documentos = data || [];
  renderDocumentos();
  renderStats();
}

function fmtMoney(n) { return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtFecha(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; }

function renderDocumentos() {
  const list = docFilter === 'todos' ? documentos : documentos.filter(d => d.tipo === docFilter);
  const el = document.getElementById('doc-list');
  if (!list.length) {
    el.innerHTML = '<div class="empty">Sin documentos por ahora</div>';
    return;
  }
  el.innerHTML = list.map(d => `
    <div class="doc-card" onclick="openDoc('${d.id}')">
      <div class="doc-card-head">
        <div>
          <div class="doc-folio mono">${escHtml(d.folio)}</div>
          <div class="doc-tipo">${d.tipo}</div>
          <div class="doc-meta">${fmtFecha(d.fecha_emision)}</div>
        </div>
        <div style="text-align:right">
          <div class="doc-total">${fmtMoney(d.total)}</div>
          <span class="status-badge ${d.status}" style="margin-top:6px">${d.status}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function openDoc(id) {
  const d = documentos.find(x => x.id === id);
  if (!d) return;
  const canPagar = d.status === 'pendiente' || d.status === 'vencida';
  const canCfdi = !d.uuid_cfdi;
  document.getElementById('modal-doc-body').innerHTML = `
    <h3>${escHtml(d.folio)}</h3>
    <div class="sub">${d.tipo} · ${fmtFecha(d.fecha_emision)}</div>
    <div class="dd-row"><span>Subtotal</span><span>${fmtMoney(d.subtotal)}</span></div>
    ${d.iva ? `<div class="dd-row"><span>IVA</span><span>${fmtMoney(d.iva)}</span></div>` : ''}
    ${d.ret_iva ? `<div class="dd-row"><span>Ret. IVA</span><span>−${fmtMoney(d.ret_iva)}</span></div>` : ''}
    ${d.ret_isr ? `<div class="dd-row"><span>Ret. ISR</span><span>−${fmtMoney(d.ret_isr)}</span></div>` : ''}
    <div class="dd-row total"><span>Total</span><span>${fmtMoney(d.total)}</span></div>
    <div class="dd-actions">
      ${canPagar ? `<button class="gbtn solid" onclick="showToast('Pagos en construcción — llega con la integración de Stripe')">Pagar ahora</button>` : ''}
      ${canPagar ? `<button class="gbtn" onclick="showToast('Subida de comprobante en construcción')">Subir comprobante SPEI</button>` : ''}
      ${canCfdi ? `<button class="gbtn" onclick="showToast('Solicitud de CFDI en construcción')">Solicitar CFDI de este documento</button>` : `<button class="gbtn" disabled>CFDI ya timbrado</button>`}
      ${d.pdf_url ? `<a class="gbtn" href="${d.pdf_url}" target="_blank" style="text-align:center;text-decoration:none">Descargar PDF</a>` : ''}
    </div>
  `;
  document.getElementById('modal-doc').classList.add('show');
}

document.addEventListener('click', e => {
  if (e.target.id === 'modal-doc') document.getElementById('modal-doc').classList.remove('show');
  if (e.target.id === 'modal-perfil') closePerfilModal();
});

/* ── EASTER EGG: modo blueprint (3 taps al logo) — un plano que se dibuja solo ── */
function buildBlueprintSVG() {
  return `
  <svg viewBox="0 0 480 300" xmlns="http://www.w3.org/2000/svg">
    <rect class="bp-draw" x="20" y="20" width="440" height="260" style="animation-delay:0ms"/>
    <line class="bp-draw" x1="220" y1="20" x2="220" y2="280" style="animation-delay:280ms"/>
    <line class="bp-draw" x1="220" y1="150" x2="460" y2="150" style="animation-delay:480ms"/>
    <path class="bp-draw" d="M 60 280 A 40 40 0 0 1 100 240" style="animation-delay:700ms"/>
    <line class="bp-draw" x1="60" y1="280" x2="100" y2="240" style="animation-delay:760ms;stroke-dasharray:90;stroke-dashoffset:90"/>
    <line class="bp-draw" x1="20" y1="4" x2="460" y2="4" style="animation-delay:920ms"/>
    <line class="bp-draw" x1="20" y1="0" x2="20" y2="8" style="animation-delay:920ms;stroke-dasharray:10;stroke-dashoffset:10"/>
    <line class="bp-draw" x1="460" y1="0" x2="460" y2="8" style="animation-delay:1000ms;stroke-dasharray:10;stroke-dashoffset:10"/>
    <text class="bp-txt" x="240" y="-8" text-anchor="middle" font-size="9" style="animation-delay:1300ms">12.40 M</text>
    <circle class="bp-draw" cx="430" cy="40" r="18" style="animation-delay:1100ms;stroke-dasharray:120;stroke-dashoffset:120"/>
    <line class="bp-draw" x1="430" y1="54" x2="430" y2="26" style="animation-delay:1250ms;stroke-dasharray:30;stroke-dashoffset:30"/>
    <text class="bp-txt" x="430" y="22" text-anchor="middle" font-size="9" style="animation-delay:1450ms">N</text>
    <text class="bp-txt" x="20" y="298" font-size="9" letter-spacing="2" style="animation-delay:1600ms">GAPT STUDIO — PLANTA ARQUITECTÓNICA</text>
    <g style="animation-delay:2000ms">
      <rect class="bp-draw" x="205" y="130" width="15" height="15" style="animation-delay:2000ms;stroke-width:2.4;stroke-dasharray:60;stroke-dashoffset:60"/>
      <line class="bp-draw" x1="213.5" y1="130" x2="213.5" y2="145" style="animation-delay:2150ms;stroke-width:2.4;stroke-dasharray:15;stroke-dashoffset:15"/>
      <text class="bp-txt" x="228" y="143" font-size="16" font-weight="700" letter-spacing="1" style="animation-delay:2300ms;fill:#F4EFE4">GAPT<tspan fill="#FF5A1F">.</tspan></text>
    </g>
  </svg>`;
}

/* Sonido de lápiz sobre papel — ráfagas de ruido filtrado, sincronizadas con el trazo */
function playPencilSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const scratchAt = [0, 0.30, 0.50, 0.72, 0.95, 1.12, 1.28, 1.45, 2.02, 2.18, 2.35];
    scratchAt.forEach(t => {
      const dur = 0.10 + Math.random() * 0.09;
      const bufferSize = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2800 + Math.random() * 2200;
      filter.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(ctx.currentTime + t);
    });
  } catch (e) { /* audio no disponible, no pasa nada */ }
}

let logoTapCount = 0, logoTapTimer = null;
function tapLogo() {
  logoTapCount++;
  clearTimeout(logoTapTimer);
  logoTapTimer = setTimeout(() => { logoTapCount = 0; }, 700);
  if (logoTapCount >= 3) {
    logoTapCount = 0;
    const bp = document.getElementById('blueprint-overlay');
    document.getElementById('bp-svg-wrap').innerHTML = buildBlueprintSVG();
    bp.classList.add('show');
    playPencilSound();
    setTimeout(() => bp.classList.remove('show'), 5400);
  }
}

/* ── EASTER EGG: konami code → crawl estilo cine ── */
/* Fanfarria + pad orquestal original, compuesta desde cero — no es el tema de Star Wars (derechos de autor). */
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1700;
    lp.Q.value = 0.7;
    lp.connect(ctx.destination);

    // Nota tipo "metal" (sección de bronces) — dos osciladores desafinados + filtro, envolvente ligada, no percusiva
    function brassNote(freq, start, dur, peak) {
      [1, 1.007].forEach(detune => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * detune;
        const gain = ctx.createGain();
        const s = now + start;
        gain.gain.setValueAtTime(0, s);
        gain.gain.linearRampToValueAtTime(peak, s + 0.10);
        gain.gain.linearRampToValueAtTime(peak * 0.82, s + dur * 0.65);
        gain.gain.linearRampToValueAtTime(0, s + dur);
        osc.connect(gain).connect(lp);
        osc.start(s);
        osc.stop(s + dur + 0.05);
      });
    }

    // Fanfarria original — frases largas y ligadas (no el tema de ninguna película)
    [
      [196.00, 0.00, 0.95, 0.10], [246.94, 0.85, 0.90, 0.11],
      [293.66, 1.65, 1.25, 0.12], [392.00, 2.85, 1.90, 0.14],
    ].forEach(([f, s, d, p]) => brassNote(f, s, d, p));

    // Pad orquestal evolutivo — 3 acordes que se relevan a lo largo de ~95s, luego silencio
    const stages = [
      { freqs: [98.00, 146.83, 196.00], start: 0, hold: 30 },
      { freqs: [116.54, 174.61, 233.08], start: 26, hold: 34 },
      { freqs: [98.00, 146.83, 246.94], start: 56, hold: 36 },
    ];
    stages.forEach(stage => {
      stage.freqs.forEach(freq => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        const s = now + stage.start;
        gain.gain.setValueAtTime(0, s);
        gain.gain.linearRampToValueAtTime(0.045, s + 3);
        gain.gain.linearRampToValueAtTime(0.045, s + stage.hold - 4);
        gain.gain.linearRampToValueAtTime(0, s + stage.hold);
        osc.connect(gain).connect(lp);
        osc.start(s);
        osc.stop(s + stage.hold + 0.2);
      });
    });
  } catch (e) { /* audio no disponible, no pasa nada */ }
}

const CRAWL_HTML = `
  <div class="sw-kicker">EPISODIO I</div>
  <h2>EL PORTAL DE GAPT</h2>
  <p>Todo estudio empieza con una pregunta simple que resulta no serlo: ¿qué significa construir bien? No rápido, no barato, no impresionante desde lejos — bien, de cerca, con los años. THE GAPT PROJECT nació de esa pregunta, sin respuesta cerrada todavía, porque las preguntas buenas no se cierran: se persiguen proyecto tras proyecto.</p>
  <p>Empezó pequeño. Un escritorio, un rollo de papel para bocetar, una ciudad —Cuernavaca, Morelos— que enseña algo distinto sobre el clima, la luz y los materiales que las escuelas de arquitectura rara vez enseñan bien: que el diseño no vive en el papel, vive en cómo cae el sol a las cuatro de la tarde sobre un muro de piedra volcánica en octubre.</p>
  <p>No hubo un manifiesto fundacional pegado en la pared el primer día. Hubo, eso sí, una intuición que se volvió costumbre: cada proyecto merece ser tratado como si fuera el único que el estudio hará jamás. No hay plantillas que se reciclan de un cliente a otro. No hay un estilo de la casa que se le imponga al terreno, al presupuesto, a la familia que va a vivir ahí. Hay, en cambio, una manera de trabajar — lenta al principio, exigente siempre, honesta sobre todo.</p>
  <p>Ese principio se volvió, con el tiempo, la única marca registrada que le importó al estudio: NO TWO ALIKE. Ningún proyecto igual a otro. No porque la repetición esté prohibida por decreto, sino porque cada terreno, cada presupuesto, cada familia, cada luz de la tarde es distinta, y fingir que no lo es —copiar y pegar una solución— es la forma más silenciosa de faltarle el respeto al trabajo.</p>
  <p>Los primeros años fueron de aprender a decir que no. No a los plazos que sacrifican el detalle. No a los materiales que se ven bien en el render pero envejecen mal bajo el sol real. No a la tentación de crecer rápido a costa de la atención que cada proyecto necesita. Decir que no, con la frecuencia suficiente, terminó siendo la decisión de diseño más importante del estudio — más que cualquier fachada, cualquier planta, cualquier corte.</p>
  <p>Con el tiempo llegaron los primeros clientes que entendieron el ritmo. No los más grandes, no los más rápidos en pagar, sino los que hacían la pregunta correcta en la primera junta —"¿por qué así y no de otra forma?"— y se quedaban a escuchar la respuesta completa, no solo el resumen.</p>
  <p>De esas juntas, de esos terrenos, de esos años de decir que no cuando hacía falta, salió lo que hoy es THE GAPT PROJECT: un estudio de arquitectura y diseño construido, como cualquier obra que vale la pena, un ladrillo a la vez.</p>

  <h2>CAPÍTULO II</h2>
  <div class="sw-kicker">EL NOMBRE</div>
  <p>GAPT no es un acrónimo elegante ni una palabra inventada por un comité de marca. Son las iniciales de una persona y de una manera de pensar: Gustavo A. Pastrana T. Un nombre propio convertido en promesa pública, lo cual es una decisión arriesgada — porque cuando el nombre del estudio es también tu nombre, no hay dónde esconder un trabajo mediocre.</p>
  <p>Esa exposición, lejos de ser un problema, se volvió el mecanismo de control de calidad más eficiente que el estudio jamás implementó. No hace falta un comité de revisión cuando cada plano que sale lleva, aunque sea implícito, tu apellido.</p>
  <p>"The Project" se agregó después, y no por vanidad, sino por honestidad: ningún estudio, por bueno que sea, termina de construirse nunca. Siempre hay un proyecto más, una lección más, una manera de hacerlo mejor la próxima vez. Llamarse "el proyecto" es aceptar, en el nombre mismo, que esto sigue en obra permanente.</p>
  <p>Hay algo casi arquitectónico en pensar la identidad de una marca de esta manera: una casa nunca está "terminada" del todo tampoco — se habita, se ajusta, envejece bien o mal según cómo se construyó. Un estudio es lo mismo, a otra escala.</p>
  <p>El nombre completo, THE GAPT PROJECT, aparece siempre acompañado de una frase corta que funciona casi como una cláusula de contrato: NO TWO ALIKE. Ningún cliente lee eso y piensa que es publicidad. Lo leen, con el tiempo, como una advertencia amable de que aquí no hay atajos ni recetas — solo el trabajo de averiguar, otra vez, qué es lo correcto para este terreno específico, este presupuesto específico, esta familia específica.</p>
  <p>Un nombre corto, una frase corta, una promesa que no cabe en un eslogan de verdad porque no es un eslogan: es una manera de operar que resultó, con los años, ser también una buena manera de presentarse.</p>

  <h2>CAPÍTULO III</h2>
  <div class="sw-kicker">EL SÍMBOLO</div>
  <p>El símbolo de GAPT es, a propósito, casi aburrido de tan simple: un cuadrado con una costura. Una línea vertical que divide el bloque naranja en dos partes desiguales, como la sombra que proyecta un muro a media tarde, o como el corte de una planta arquitectónica visto desde arriba.</p>
  <p>No es un logo que necesite explicación en una junta de ventas. No hay un animal, ni una montaña estilizada, ni una metáfora forzada sobre "construir el futuro". Es una forma que se sostiene sola, como debería sostenerse cualquier buen diseño: sin necesitar que alguien te explique por qué funciona.</p>
  <p>El naranja no fue una decisión de paleta de colores de temporada. Es, casi literalmente, el color de la hora dorada en Cuernavaca — esa media hora antes de que se meta el sol, cuando la luz entra rasante y todo lo que toca se vuelve cálido y un poco más honesto de lo que se ve al mediodía. Ese es el color que el estudio decidió llevar consigo a todas partes: correos, facturas, el punto que remata el wordmark GAPT como si fuera el sol mismo, pequeño, en la esquina de cada palabra.</p>
  <p>La costura al centro del símbolo tiene una lectura doble, y ambas son intencionales. Por un lado, es la línea de una junta constructiva — el lugar exacto donde dos materiales se encuentran y hay que decidir, con cuidado, cómo resolver ese encuentro sin que se note el esfuerzo. Por otro lado, es una advertencia visual de la filosofía completa del estudio: nada es un bloque monolítico y perfecto desde el principio. Todo es dos piezas que se aprenden a encontrar bien.</p>
  <p>Ese símbolo aparece en la esquina de cada correo, en el sello de cada factura, en la pantalla de bienvenida de este mismo portal — y ahora, si llegaste hasta aquí, también aparece dibujándose a mano en el modo plano que escondimos detrás de tres toques en el logo. Un guiño dentro de otro guiño, como debe ser.</p>

  <h2>CAPÍTULO IV</h2>
  <div class="sw-kicker">CUERNAVACA</div>
  <p>Le dicen "la ciudad de la eterna primavera" desde hace más de un siglo, y como todo apodo que sobrevive tanto tiempo, es cierto a medias: el clima es amable casi todo el año, pero la luz cambia más de lo que promete el sobrenombre. Cuernavaca tiene una manera particular de iluminar los espacios — barrancas profundas que cortan la ciudad, vegetación que nunca termina de irse del todo aunque construyas encima, un cielo que en temporada de lluvias se pone de un gris casi morado antes de la tormenta.</p>
  <p>Diseñar en Morelos obliga a pensar distinto a como enseñan los libros de texto escritos para climas templados del norte. Aquí el sol pega fuerte y hay que darle sombra al espacio antes de darle ventanas. Aquí llueve con una intensidad que en otros lados llamarían emergencia y aquí es martes por la tarde. Aquí la vegetación no es un elemento decorativo del render: es una fuerza que va a reclamar cualquier espacio que dejes descuidado, y hay que diseñar sabiendo que vas a convivir con ella, no contra ella.</p>
  <p>El estudio decidió, desde el principio, no pelearse con el lugar donde nació. No importar soluciones de otros climas, de otras ciudades, de otros países, solo porque se ven bien en una revista de arquitectura editada en un continente distinto. Cada material se elige pensando en cómo va a envejecer aquí, bajo esta luz, con esta humedad, con esta vegetación empujando desde las orillas.</p>
  <p>Esa terquedad regional —diseñar para el lugar real y no para el lugar ideal de las fotografías— es, probablemente, la decisión menos visible y más importante de todo el trabajo del estudio. Nadie la nota en un primer vistazo. Todos la agradecen, sin saber que la están agradeciendo, cinco años después, cuando la casa sigue viéndose bien y el muro de piedra volcánica no se ha manchado de humedad y el patio interior sigue siendo el lugar más fresco de toda la propiedad en mayo.</p>
  <p>Cuernavaca, Morelos, 2026. Ahí es donde vive el estudio. Ahí es donde se dibujó, a mano, el primer boceto de este mismo portal que estás usando ahora mismo para ver tus facturas.</p>

  <h2>CAPÍTULO V</h2>
  <div class="sw-kicker">EL OFICIO</div>
  <p>Antes de que exista un render, antes de que exista un plano en computadora, existe un lápiz y un rollo de papel albanene. Esa secuencia no es nostalgia por métodos antiguos: es una decisión deliberada, porque la mano piensa distinto a como piensa el mouse. El lápiz obliga a decidir antes de trazar, porque borrar cuesta trabajo. El mouse permite corregir infinitas veces sin costo, y esa facilidad, paradójicamente, produce diseños menos decididos.</p>
  <p>El proceso empieza siempre igual: una visita al terreno, antes que cualquier otra cosa. No fotos enviadas por WhatsApp, no coordenadas en un mapa satelital, sino caminar el lugar, sentir hacia dónde entra el viento, notar en qué esquina se junta el agua cuando llueve, ver a qué hora exacta el sol entra por dónde. Ningún software sustituye esa hora caminando un terreno vacío.</p>
  <p>De ahí salen los primeros bocetos — torpes, exploratorios, casi todos destinados a la basura. Esa es la parte del oficio que menos se enseña y más importa: la disposición a dibujar diez ideas malas para encontrar una buena, en vez de aferrarse a la primera idea decente solo porque llegó rápido y ya hay ganas de avanzar.</p>
  <p>Luego vienen las plantas, los cortes, las elevaciones — el vocabulario técnico que traduce una intuición espacial en un documento que un albañil, un ingeniero estructural y un cliente sin formación técnica puedan leer, cada uno a su manera, y entender lo mismo. Ese es quizás el ejercicio de traducción más difícil del oficio: un mismo plano tiene que hablarle con precisión matemática al ingeniero y con claridad emocional al cliente que va a vivir ahí.</p>
  <p>Las cotas, esas pequeñas líneas con números que le indican a la obra exactamente cuánto mide cada cosa, no son un detalle burocrático. Son la diferencia entre un espacio que se siente exactamente como se pensó y uno que se siente "casi". Un estudio que se toma en serio las cotas es un estudio que entiende que la arquitectura se vive en centímetros, no en intenciones.</p>
  <p>Y al final, después de las plantas, los cortes, las cotas, las juntas resueltas una por una — llega la obra. Ahí es donde el plano se encuentra con la realidad, con el clima, con los materiales disponibles esa semana, con los imprevistos que ningún dibujo anticipa del todo. Ahí es donde se demuestra si el cuidado de las etapas anteriores realmente importó.</p>

  <h2>CAPÍTULO VI</h2>
  <div class="sw-kicker">LA LUZ Y LA SOMBRA</div>
  <p>Hay una diferencia enorme entre diseñar un espacio para que se vea bien en una fotografía tomada a las once de la mañana con cielo despejado, y diseñar un espacio para que se sienta bien a las siete de la tarde, un martes cualquiera, con nubes, sin nadie fotografiando nada.</p>
  <p>El estudio aprendió, con los años, a desconfiar un poco de sus propios renders. Un render siempre muestra la mejor luz posible, el mejor ángulo posible, el día perfecto del año. La arquitectura real no tiene ese lujo: tiene que funcionar en el peor día de lluvia de septiembre y en el mediodía más caluroso de abril, no solo en la imagen que convence al cliente de firmar.</p>
  <p>Por eso cada proyecto se piensa, desde el principio, en términos de sombra antes que de forma. Dónde va a caer la sombra a las diez de la mañana. Dónde va a caer a las cuatro de la tarde. Qué parte de la casa se va a sentir fresca en mayo y cuál se va a sentir fresca en diciembre, porque no son la misma parte, y un buen estudio lo sabe desde el boceto, no lo descubre después de construido.</p>
  <p>La luz indirecta, la que rebota en un muro claro antes de entrar a un cuarto, se usa más que la luz directa, la que entra sin filtro por una ventana grande orientada al poniente. No porque la luz directa esté prohibida, sino porque hay que ganársela — orientarla, filtrarla, invitarla solo cuando conviene y no de golpe, todo el día, sin control.</p>
  <p>Esa manera de pensar la luz como material de construcción, tan real como el concreto o la piedra, es una de las pocas cosas que el estudio sí heredó de los libros de texto — solo que aquí se aplica con la latitud, la altitud y el clima específicos de Morelos, no con los del libro escrito en otro hemisferio.</p>

  <h2>CAPÍTULO VII</h2>
  <div class="sw-kicker">LOS MATERIALES</div>
  <p>Un material bueno no es el más caro ni el más nuevo. Es el que envejece con dignidad. Hay materiales que a los dos años se ven peor que el día en que se instalaron, y hay materiales que a los veinte años se ven mejor, con una pátina que ningún catálogo de acabados puede simular de fábrica.</p>
  <p>El estudio prefiere, casi siempre, materiales de la región — piedra volcánica, madera trabajada por talleres locales, tabique que respira con el clima en vez de sellarlo por completo. No por un romanticismo vago con lo "artesanal", sino porque un material que se produce cerca del sitio donde se va a usar generalmente ya viene probado por generaciones de gente que construyó con él antes, bajo el mismo sol, la misma lluvia, la misma humedad.</p>
  <p>Los acabados industriales, cuando se usan, se usan con la misma exigencia: que no finjan ser otra cosa. Un concreto aparente tiene que verse orgulloso de ser concreto, no avergonzado, escondido detrás de un aplanado que trata de disimularlo. Esa honestidad de materiales —que cada superficie se vea como lo que realmente es— termina siendo, casi sin proponérselo, una postura ética tanto como estética.</p>
  <p>Hay una prueba simple que el estudio usa para decidir si un material vale la pena: imaginarlo diez años después, sin mantenimiento perfecto, tocado por el sol y la lluvia reales de Cuernavaca, no por el mantenimiento ideal que promete el fabricante en su ficha técnica. Si esa imagen mental sigue viéndose bien, el material pasa la prueba. Si no, no importa lo que diga el catálogo.</p>
  <p>Esa misma exigencia —pensar en cómo envejece algo, no solo en cómo se ve el primer día— es la que, con los años, terminó aplicándose también a cosas que no son ladrillo ni piedra: a la manera en que el estudio trata a sus clientes, a la manera en que factura, a la manera en que responde un correo. Envejecer bien, en cualquier oficio, es la métrica que de verdad importa.</p>

  <h2>CAPÍTULO VIII</h2>
  <div class="sw-kicker">EL CLIENTE</div>
  <p>Hay una tentación, en cualquier oficio creativo, de tratar al cliente como un obstáculo entre el arquitecto y su visión pura. El estudio decidió, desde temprano, rechazar esa tentación por completo. El cliente no es un obstáculo: es la razón por la que el edificio existe.</p>
  <p>Eso no significa decir siempre que sí. Significa escuchar de verdad —no la versión resumida de lo que el cliente pide, sino la necesidad real que hay debajo de la petición— y después tener el criterio profesional para proponer algo mejor cuando la petición literal no serviría bien al proyecto.</p>
  <p>Un cliente que pide "una ventana más grande" a veces en realidad está pidiendo "más luz en la mañana", y esas dos peticiones no siempre se resuelven de la misma manera. Traducir bien esa diferencia, sin condescendencia, es parte del trabajo tanto como cualquier cálculo estructural.</p>
  <p>La relación con un cliente rara vez termina cuando se entrega la obra. Sigue en las dudas de mantenimiento un año después, en la recomendación a un amigo que también está construyendo, en la factura que hay que pedir para hacer bien su contabilidad, en el comprobante de pago que hay que subir sin que sea un dolor de cabeza. Todo eso también es arquitectura, aunque no lo enseñen así en la escuela.</p>
  <p>Ese fue, exactamente, el origen de este portal que estás viendo ahora. No un capricho tecnológico ni una moda de "digitalizar todo". Nació de una pregunta directa: si el cuidado que le ponemos a una junta constructiva es real, ¿por qué el cliente tendría que sufrir para encontrar su factura o para saber si ya se registró su pago? La respuesta correcta era construir algo con el mismo estándar, aunque fuera software y no concreto.</p>

  <h2>CAPÍTULO IX</h2>
  <div class="sw-kicker">LOS NÚMEROS</div>
  <p>No hay parte menos romántica del oficio que una factura. Nadie sueña con ser arquitecto para calcular IVA retenido o para perseguir un comprobante de pago por SPEI. Y sin embargo, ahí también se decide si un estudio es serio o no lo es.</p>
  <p>Un cliente que tiene que pedir tres veces su factura, que no sabe si su pago ya se registró, que no encuentra su CFDI cuando su contador se lo pide con urgencia — ese cliente, sin importar qué tan bonita haya quedado su casa, se queda con una sensación de desorden que le resta valor a todo lo demás. Los números descuidados manchan hasta el trabajo mejor hecho.</p>
  <p>Por eso el estudio decidió, en algún momento, tratar el IVA trasladado, la retención de IVA, la retención de ISR, el folio fiscal y el régimen fiscal del cliente con la misma seriedad que una cota en un plano. No son un mal necesario del negocio: son, también, una forma de cuidado.</p>
  <p>1.25% de retención de ISR. 10.6667% de retención de IVA. 16% de IVA trasladado. Números que no dicen nada emocionante en voz alta, pero que si están mal, generan meses de dolores de cabeza contables para alguien que confió en este estudio. Que estén bien, siempre, en cada documento, es una forma silenciosa de respeto.</p>
  <p>Este portal existe, en el fondo, para que esa parte del trabajo —la menos visible, la menos fotografiable, la que nunca sale en una revista de arquitectura— también reciba la atención que merece. Porque un cliente que confía sus facturas a este estudio merece la misma precisión que un cliente que confía su casa.</p>

  <h2>CAPÍTULO X</h2>
  <div class="sw-kicker">EL PORTAL</div>
  <p>Este portal no se construyó con planos en papel albanene, mucho menos con piedra volcánica, pero se construyó con la misma disciplina: bocetar antes de decidir, decidir antes de construir, revisar antes de entregar.</p>
  <p>Cada pantalla que ves aquí pasó, primero, por una pregunta simple: ¿esto se siente tan cuidado como el resto de lo que hace el estudio? Si la respuesta era "casi", se volvía a intentar. La misma terquedad que aplica a una junta constructiva mal resuelta se aplicó aquí a un botón que no se sentía del todo bien, a un color que no calzaba con la paleta, a una animación que se sentía plana en vez de intencional.</p>
  <p>El sistema visual que usa este portal —la tipografía mono en mayúsculas, los acentos cálidos, el fondo oscuro, las etiquetas técnicas tipo "_ 01 / Mis documentos"— no se inventó desde cero para esta herramienta. Es el mismo lenguaje que usa el estudio en todos lados, porque un cliente que entra aquí después de recibir un correo o de ver una factura debería sentir que sigue en el mismo lugar, no que saltó a una aplicación genérica hecha por otra empresa.</p>
  <p>Puedes ver tus facturas y cotizaciones. Puedes pagar en línea o subir tu comprobante cuando pagas por transferencia. Puedes, en cuanto esa pieza esté lista, pedir tu CFDI con un solo clic, sin llenar el mismo formulario cada vez, porque tus datos fiscales ya quedaron guardados la primera vez que los diste.</p>
  <p>Y puedes, como acabas de descubrir, encontrarte con un easter egg completamente innecesario para el funcionamiento del portal, pero absolutamente necesario para la manera en que este estudio entiende su propio trabajo: los detalles que nadie pide son, casi siempre, los que de verdad importan.</p>

  <h2>CAPÍTULO XI</h2>
  <div class="sw-kicker">EL FUTURO</div>
  <p>2026 es apenas el principio. El estudio se sigue construyendo, literalmente, mientras lees esto — un portafolio completo, un proceso documentado, un manifiesto más largo que este texto escondido, todo llegando a lo largo del año, con el mismo ritmo paciente con el que se construye cualquier otra cosa aquí.</p>
  <p>Este portal también seguirá creciendo. Pagos en línea con confirmación instantánea. Comprobantes de pago que se revisan y se aprueban sin fricción. Solicitudes de CFDI con vista previa antes de timbrar, aprobadas desde el teléfono, con la misma seriedad que cualquier otro documento que sale de este estudio.</p>
  <p>Nada de eso se va a construir rápido solo por construirlo rápido. Se va a construir con el mismo estándar que un muro de piedra volcánica: pensado para envejecer bien, no solo para verse bien el día que se lanza.</p>
  <p>Si algún día vuelves a encontrar este mensaje, es probable que ya no diga exactamente lo mismo — porque el estudio tampoco es exactamente el mismo que era cuando se escribió esto. Eso también es parte del principio fundacional: NO TWO ALIKE aplica también en el tiempo, no solo entre proyectos distintos.</p>

  <h2>CAPÍTULO XII</h2>
  <div class="sw-kicker">LOS ERRORES</div>
  <p>Ningún estudio que diga no haberse equivocado nunca está diciendo la verdad. GAPT se ha equivocado —en una cimentación que hubo que revisar dos veces, en un presupuesto que se calculó corto, en una fecha de entrega que se prometió con más optimismo del que merecía la obra—. La diferencia entre un estudio confiable y uno que no lo es rara vez está en la ausencia de errores. Está en qué se hace después del error.</p>
  <p>Aquí la regla es simple, aunque incómoda de cumplir: el error se dice primero, se explica después, y se resuelve sin que el cliente tenga que perseguir la respuesta. Nadie disfruta dar esa llamada. Se da de todas formas, porque la alternativa —dejar que el cliente descubra el problema por su cuenta— es peor para la relación y, francamente, una falta de respeto.</p>
  <p>Cada error que el estudio ha cometido se quedó, de alguna manera, integrado al proceso siguiente: una revisión nueva, una pregunta adicional en la primera junta, un paso extra antes de mandar un plano a obra. El oficio no se aprende solamente de lo que sale bien. Se aprende, más lento y con más trabajo, de lo que sale mal y se corrige con honestidad.</p>
  <p>Este portal probablemente tiene errores también, en algún rincón que todavía no se ha probado lo suficiente. Si los encuentras, avísanos. No porque sea un favor que nos haces — porque es exactamente el tipo de atención al detalle que este estudio más valora, y que este mismo texto lleva once capítulos tratando de explicar sin decirlo tan directamente.</p>
  <p>Hay una honestidad incómoda en admitir, en un texto que casi nadie va a leer completo, que la perfección nunca fue el objetivo real. El objetivo siempre fue el cuidado constante — que es distinto, más difícil de sostener, y muchísimo más valioso a largo plazo que cualquier promesa de perfección inmediata.</p>

  <h2>CAPÍTULO XIII</h2>
  <div class="sw-kicker">EL SILENCIO</div>
  <p>Hay una virtud subestimada en cualquier oficio creativo: saber cuándo no hablar. Un plano que necesita una hoja de notas explicando cada decisión probablemente no resolvió bien esas decisiones. Un espacio que necesita que alguien te diga "aquí se sintió el cuidado" probablemente no lo comunicó solo.</p>
  <p>El estudio aprendió, con los años, a confiar en que el trabajo bien hecho no necesita anunciarse a gritos. Una junta constructiva resuelta con precisión no lleva una placa que diga "aquí hubo esfuerzo". Simplemente funciona, silenciosamente, durante los siguientes veinte años, sin que nadie que viva ahí sepa cuánto costó resolverla bien.</p>
  <p>Ese mismo silencio aplica a este portal. La mayoría de las decisiones que se tomaron aquí —qué tan rápido se abre un modal, qué tan preciso es el color de un estado "pendiente" contra uno "vencido", cuánto debe medir un botón para que se sienta cómodo bajo un pulgar— nunca se van a notar de manera consciente. Se van a sentir, sin nombre, como una especie de calma que uno no sabe explicar del todo.</p>
  <p>Ese es, en el fondo, el estándar más alto al que puede aspirar cualquier trabajo de diseño: que la ausencia de fricción se confunda con la ausencia de esfuerzo, cuando en realidad es exactamente lo contrario. Cuesta más trabajo hacer algo que se sienta simple que hacer algo que se sienta complicado. Ese costo, el estudio lo paga con gusto, en silencio, proyecto tras proyecto.</p>
  <p>Por eso este texto es la excepción, no la regla. Un easter egg escondido detrás de ocho teclas es, precisamente, el único lugar donde el estudio se permite hablar de sí mismo en voz alta durante varios miles de palabras — porque nadie tropieza con él sin querer, y porque quien llega hasta aquí ya demostró que le interesa escuchar la historia completa, no solo el resumen de una junta de ventas.</p>

  <h2>CAPÍTULO XIV</h2>
  <div class="sw-kicker">LOS COLABORADORES</div>
  <p>Ningún edificio lo levanta una sola persona, sin importar cuántas veces aparezca un solo nombre en la fachada de un proyecto. Detrás de cada obra de GAPT hay albañiles que entienden una junta constructiva mejor de lo que cualquier plano puede explicarla, ingenieros estructurales que revisan cada cálculo con una paciencia que rara vez se reconoce en público, proveedores locales que separan el material bueno del material que solo se ve bueno en la tienda.</p>
  <p>Ese mismo principio aplica, ahora, al software. Este portal no lo construyó una sola persona sola frente a una pantalla en silencio absoluto. Se construyó en conversación —pidiendo, corrigiendo, señalando lo que no se sentía bien, insistiendo en que la primera versión de un botón, de un color, de una animación, casi nunca es la versión final que merece salir al mundo—.</p>
  <p>Hay algo honesto en reconocer eso dentro de un texto que, en teoría, nadie más que tú va a leer completo. El trabajo bueno rara vez es obra de una sola mano. Es obra de suficiente gente terca insistiendo en que algo puede estar mejor, una y otra vez, hasta que efectivamente lo está.</p>
  <p>Si alguna vez colaboras con este estudio —como cliente, como proveedor, o simplemente como alguien que encontró este easter egg por curiosidad y se quedó a leerlo entero— ya formas parte, en algún grado pequeño pero real, de esa manera terca de hacer las cosas.</p>
  <p>La próxima vez que abras una factura en este portal, que subas un comprobante, que pidas un CFDI con un solo clic, va a haber, detrás de esa acción sencilla, la misma cantidad de terquedad colectiva que hay detrás de cualquier muro de piedra volcánica que este estudio haya levantado alguna vez. No se nota. No tiene por qué notarse. Pero ahí está.</p>

  <h2>CAPÍTULO XV</h2>
  <div class="sw-kicker">AGRADECIMIENTO</div>
  <p>Si llegaste hasta aquí, hiciste algo que casi nadie hace: encontraste un Konami code escondido en un portal de facturación, y en vez de cerrarlo a los tres segundos, te quedaste a leer varios miles de palabras sobre un estudio de arquitectura en Cuernavaca, Morelos.</p>
  <p>Eso dice algo de ti. Probablemente eres exactamente el tipo de persona que este estudio más disfruta tener como cliente: alguien que nota los detalles, que no se conforma con la superficie, que entiende que las cosas bien hechas casi nunca gritan lo bien hechas que están — simplemente lo están, calladamente, esperando a que alguien preste la atención suficiente para notarlo.</p>
  <p>Gracias por prestar esa atención. Gracias por pagar tus facturas, por subir tus comprobantes, por confiar tus documentos fiscales a esta herramienta que se construyó pensando en ti tanto como en cualquier plano arquitectónico. Gracias, sobre todo, por llegar hasta el final de este texto completamente innecesario que existe únicamente porque alguien pidió, un día, "algo con mucho más movimiento".</p>
  <p><strong>GRACIAS POR ESTAR AQUÍ.</strong></p>

  <h2>P. D.</h2>
  <div class="sw-kicker">UNA NOTA TÉCNICA, PORQUE SE VALE CERRAR CON UN GUIÑO</div>
  <p>Si de verdad llegaste hasta este punto, mereces saber cómo se construyó lo que acabas de leer. Este texto no viene de una base de datos de frases genéricas ni de un generador de relleno: se escribió a propósito, de una sola vez, pensando en este estudio específico, para este easter egg específico, porque alguien pidió expresamente "un texto muy muy largo" y la única manera honesta de cumplir esa petición era escribir algo que valiera la pena leer, no solo algo que ocupara espacio.</p>
  <p>La música que estás escuchando, si tienes el volumen activado, tampoco es una pista prestada de ningún lado. Es una composición corta, hecha con osciladores generados en tiempo real directamente en tu navegador — una fanfarria breve al principio y un fondo armónico que cambia de acorde tres veces a lo largo de poco más de un minuto, pensado para sonar cinematográfico sin copiar la melodía de ninguna película en particular. Nada de xilófono. Nada prestado. Todo compuesto para este momento específico.</p>
  <p>La velocidad a la que este texto sube por tu pantalla tampoco es un número fijo escrito a mano. Se calcula justo antes de empezar, midiendo cuánto mide realmente este bloque de texto en tu dispositivo, para que la duración de la crawl coincida con su tamaño real en vez de cortarse a la mitad o quedarse esperando en blanco al final. Ese tipo de ajuste silencioso —invisible si funciona bien, molesto si no— es, otra vez, el mismo principio del capítulo del silencio: el mejor trabajo técnico es el que nadie tiene que notar para que exista.</p>
  <p>Y ahora sí, esto termina aquí. Puedes cerrar esta ventana con el botón de arriba a la derecha, con la tecla Escape, o simplemente dejar que termine de subir sola. Cualquiera de las tres opciones está perfectamente bien. Gracias, de nuevo, por llegar hasta el final.</p>

  <p>— El equipo de GAPT<br>THE GAPT PROJECT · NO TWO ALIKE<br>Cuernavaca, Morelos · Est. 2026<br>thegaptproject.com</p>
`;

let crawlTimer = null, crawlAnim = null;
function openCrawl() {
  const overlay = document.getElementById('sw-overlay');
  const crawl = document.getElementById('sw-crawl-text');
  if (crawlAnim) crawlAnim.cancel();
  clearTimeout(crawlTimer);
  crawl.style.top = '100%';
  crawl.innerHTML = CRAWL_HTML;
  overlay.classList.add('show');
  playChime();

  // Leer scrollHeight fuerza el reflow síncrono — no depende de requestAnimationFrame
  const distance = crawl.scrollHeight + window.innerHeight * 1.4;
  const speedPxPerSec = 150; // largo de verdad, pero sin llegar a los 7+ minutos
  const durationMs = Math.round((distance / speedPxPerSec) * 1000);
  crawlAnim = crawl.animate(
    [{ top: '100%' }, { top: `-${distance}px` }],
    { duration: durationMs, easing: 'linear', fill: 'forwards' }
  );
  crawlTimer = setTimeout(closeCrawl, durationMs + 400);
}
function closeCrawl() {
  if (crawlAnim) crawlAnim.cancel();
  document.getElementById('sw-overlay').classList.remove('show');
  clearTimeout(crawlTimer);
}

const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight'];
let konamiProgress = 0;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCrawl();
  konamiProgress = e.key === KONAMI[konamiProgress] ? konamiProgress + 1 : (e.key === KONAMI[0] ? 1 : 0);
  if (konamiProgress === KONAMI.length) {
    konamiProgress = 0;
    openCrawl();
  }
});

/* ── INTRO: blur-text logo reveal ── */
function playIntro() {
  const word = 'GAPT';
  const letters = document.getElementById('intro-letters');
  letters.innerHTML = word.split('').map((ch, i) =>
    `<span class="blur-letter" style="animation-delay:${i * 130}ms">${ch}</span>`
  ).join('') + `<span class="blur-letter" style="animation-delay:${word.length * 130}ms;width:.17em;height:.17em;background:#FF5A1F;display:inline-block;margin-left:.07em;margin-bottom:.06em;border-radius:50%"></span>`;
  const lettersFinish = (word.length + 1) * 130 + 550;
  const subFinish = 550 + 450;
  const holdAfter = 350;
  const totalMs = Math.max(lettersFinish, subFinish, 900) + holdAfter;
  setTimeout(() => {
    document.getElementById('state-intro').classList.add('gone');
    initAuth();
  }, totalMs);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('doc-filters').addEventListener('click', e => {
    const btn = e.target.closest('.ftab');
    if (!btn) return;
    document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    docFilter = btn.dataset.f;
    renderDocumentos();
  });
  playIntro();
});
