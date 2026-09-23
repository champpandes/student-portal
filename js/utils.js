(function (App) {
  'use strict';

  // ---------- Escaping ----------
  App.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
    ));
  };

  // ---------- Debounce ----------
  App.debounce = function (fn, wait) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  // ---------- Tokens ----------
  App.newSessionToken = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  };

  App.getDeviceId = function () {
    let id = localStorage.getItem('sp_device_id');
    if (!id) {
      id = App.newSessionToken();
      localStorage.setItem('sp_device_id', id);
    }
    return id;
  };

  // ---------- Persistent session ----------
  App.saveSession = function (data) {
    const session = Object.assign({}, data, {
      savedAt: Date.now(),
      expiresAt: Date.now() + App.SESSION_DURATION_MS
    });
    try {
      localStorage.setItem(App.SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      console.warn("Could not persist session", e);
    }
  };

  App.loadSession = function () {
    try {
      const raw = localStorage.getItem(App.SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !session.role) return null;
      if (session.expiresAt && Date.now() > session.expiresAt) {
        localStorage.removeItem(App.SESSION_KEY);
        return null;
      }
      return session;
    } catch (e) {
      localStorage.removeItem(App.SESSION_KEY);
      return null;
    }
  };

  App.clearSession = function () {
    try { localStorage.removeItem(App.SESSION_KEY); } catch (e) {}
  };

  // ---------- Toast ----------
  App.showToast = function (message, type) {
    type = type || 'success';
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bg = type === 'success' ? 'bg-emerald-600'
             : type === 'error'   ? 'bg-rose-600'
             : 'bg-slate-800';
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');

    toast.className = bg + ' text-white px-5 py-3.5 rounded-2xl shadow-lg transform transition-all duration-300 translate-y-10 opacity-0 flex items-center gap-3 text-sm font-bold w-max max-w-sm border border-white/10';

    const i = document.createElement('span');
    i.className = 'text-lg';
    i.textContent = icon;

    const t = document.createElement('span');
    t.textContent = message;

    toast.appendChild(i);
    toast.appendChild(t);
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.remove('translate-y-10', 'opacity-0'));
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };

  // ---------- Screens ----------
  App.initScreens = function () {
    App.state.screens = {
      login: document.getElementById('login-screen'),
      admin: document.getElementById('admin-dashboard'),
      student: document.getElementById('student-dashboard'),
      breakdown: document.getElementById('breakdown-screen')
    };
  };

  App.showScreen = function (name) {
    const map = App.state.screens;
    Object.keys(map).forEach(k => {
      const el = map[k];
      if (el) el.classList.add('hidden-screen');
    });
    if (map[name]) map[name].classList.remove('hidden-screen');
  };

  // ---------- Accessible Modal ----------
  const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let activeModal = null;
  let lastFocused = null;

  function getFocusable(el) {
    return Array.from(el.querySelectorAll(FOCUSABLE)).filter(n => n.offsetParent !== null);
  }

  function handleGlobalKeydown(e) {
    if (!activeModal) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      App.closeModal(activeModal);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = getFocusable(activeModal);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  App.openModal = function (el) {
    if (!el) return;
    lastFocused = document.activeElement;
    activeModal = el;
    el.classList.remove('hidden-screen');
    el.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', handleGlobalKeydown);
    requestAnimationFrame(() => {
      const first = getFocusable(el)[0];
      if (first) first.focus();
    });
  };

  App.closeModal = function (el) {
    if (!el) return;
    el.classList.add('hidden-screen');
    el.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', handleGlobalKeydown);
    if (activeModal === el) activeModal = null;
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  };

  // ---------- Cache ----------
  App.cacheKey = function (subject) {
    return 'sp_adminData_' + App.state.sessionToken + '_' + subject;
  };

  App.invalidateActiveCache = function () {
    sessionStorage.removeItem(App.cacheKey(App.state.activeAdminSubject));
  };

  App.invalidateAllCache = function () {
    Object.keys(sessionStorage).forEach(k => {
      if (k.indexOf('sp_adminData_') === 0) sessionStorage.removeItem(k);
    });
  };

})(window.App);