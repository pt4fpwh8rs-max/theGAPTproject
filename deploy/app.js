/* ====================================================
   THE GAPT PROJECT — Shared scripts
   ==================================================== */
(() => {
  const root = document.documentElement;
  const body = document.body;

  // ===== THEME =====
  try {
    const saved = localStorage.getItem('gapt-theme');
    if (saved) root.setAttribute('data-theme', saved);
  } catch (_) {}
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('gapt-theme', next); } catch (_) {}
    });
  }

  // ===== CUSTOM CURSOR =====
  const dot = document.getElementById('cursor');
  const ring = document.getElementById('cursorRing');
  if (dot && ring && matchMedia('(pointer:fine)').matches) {
    root.classList.add('cursor-ready');
    let mx = -100, my = -100, rx = -100, ry = -100;
    addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
    (function animate() {
      rx += (mx - rx) * .15;
      ry += (my - ry) * .15;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      requestAnimationFrame(animate);
    })();
    document.querySelectorAll('[data-hover], a, button, input, textarea').forEach(el => {
      el.addEventListener('mouseenter', () => { dot.classList.add('hover'); ring.classList.add('hover'); });
      el.addEventListener('mouseleave', () => { dot.classList.remove('hover'); ring.classList.remove('hover'); });
    });
  } else if (dot && ring) {
    dot.style.display = 'none';
    ring.style.display = 'none';
  }

  // ===== SCROLL PROGRESS =====
  const bar = document.getElementById('scrollBar');
  if (bar) {
    function onScroll() {
      const h = document.documentElement;
      const total = h.scrollHeight - h.clientHeight;
      const p = total > 0 ? (h.scrollTop / total) * 100 : 0;
      bar.style.width = p + '%';
    }
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ===== LIVE CLOCK =====
  const clock = document.getElementById('liveClock');
  if (clock) {
    function tick() {
      const fmt = new Intl.DateTimeFormat('es-MX', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: 'America/Mexico_City'
      }).format(new Date());
      clock.textContent = 'MX · ' + fmt;
    }
    tick(); setInterval(tick, 1000);
  }

  // ===== MENU =====
  const menuBtn = document.getElementById('menuBtn');
  const menu = document.getElementById('menu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
      body.classList.toggle('menu-open');
    });
    menu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') body.classList.remove('menu-open');
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') body.classList.remove('menu-open');
    });
  }

  // ===== SPLASH (one-shot per session, landing only) =====
  const splash = document.getElementById('splash');
  function showUtilityNow() {
    document.querySelectorAll('.menu-btn, .menu-label, .utility-bar').forEach(el => el.classList.add('ready'));
  }
  if (splash) {
    let seen = false;
    try { seen = sessionStorage.getItem('gapt-splash') === '1'; } catch (_) {}
    if (seen) {
      splash.classList.add('hide');
      setTimeout(() => splash.remove(), 50);
      showUtilityNow();
    } else {
      // Splash plays. After animations finish, hide it and reveal utility/menu.
      try { sessionStorage.setItem('gapt-splash', '1'); } catch (_) {}
      // Reveal menu/utility just as the logo finishes moving to corner
      setTimeout(showUtilityNow, 2500);
      setTimeout(() => {
        splash.classList.add('hide');
        setTimeout(() => splash.remove(), 800);
      }, 2700);
    }
  } else {
    // No splash on this page → show utility immediately
    showUtilityNow();
  }

  // ===== REVEAL ON SCROLL =====
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: .08 });
    document.querySelectorAll('.reveal-on-scroll').forEach(el => io.observe(el));
  } else {
    document.querySelectorAll('.reveal-on-scroll').forEach(el => el.classList.add('in'));
  }

  // ===== SMOOTH ANCHORS =====
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const t = document.getElementById(id);
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
})();
