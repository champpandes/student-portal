(function (App) {
  'use strict';

  const state = App.state;

  let loginRole = 'student';

  App.setLoginRole = function (role) {
    loginRole = role;
    const input = document.getElementById('login-input');
    const hint = document.getElementById('login-hint');
    const toggle = document.getElementById('login-show-toggle');
    const sTab = document.getElementById('role-tab-student');
    const tTab = document.getElementById('role-tab-teacher');

    const inactive = "flex-1 px-4 py-2 rounded-xl text-xs font-bold transition-all text-slate-500 hover:text-slate-800";
    const active = "flex-1 px-4 py-2 rounded-xl text-xs font-bold transition-all bg-white text-indigo-700 shadow-sm";

    if (role === 'teacher') {
      input.type = 'password';
      input.placeholder = '••••';
      input.value = '';
      hint.textContent = 'Enter your Teacher PIN';
      toggle.classList.remove('hidden');
      sTab.className = inactive; tTab.className = active;
      sTab.setAttribute('aria-selected', 'false');
      tTab.setAttribute('aria-selected', 'true');
    } else {
      input.type = 'text';
      input.placeholder = 'e.g. 26-02448';
      input.value = '';
      hint.textContent = 'Enter your Student Number';
      toggle.classList.add('hidden');
      sTab.className = active; tTab.className = inactive;
      sTab.setAttribute('aria-selected', 'true');
      tTab.setAttribute('aria-selected', 'false');
    }
    input.focus();
  };

  App.toggleLoginVisibility = function () {
    const input = document.getElementById('login-input');
    const btn = document.getElementById('login-show-toggle');
    if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
    else { input.type = 'password'; btn.textContent = '👁'; }
  };

  /** Safely set textContent on an element if it exists. */
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  App.handleLogin = async function () {
    const btn = document.getElementById('login-btn');
    const inputVal = document.getElementById('login-input').value.trim();
    if (!inputVal) return;

    btn.innerText = "Authenticating...";
    btn.disabled = true;
    document.getElementById('login-error').classList.add('hidden-screen');

    try {
      if (loginRole === 'teacher') {
        const res = await App.apiCall({
          action: "adminLogin", pin: inputVal, deviceId: App.getDeviceId()
        });
        if (!res.success) throw new Error(res.message || "Invalid Teacher PIN.");

        state.adminPin = inputVal;
        state.sessionToken = App.newSessionToken();
        App.saveSession({ role: 'teacher', pin: inputVal });

        App.showToast("Welcome back!");
        await App.loadAnnouncement();
        await App.fetchAllSectionsForDropdowns();
        await App.loadAdminDashboard();
        App.showScreen('admin');
      } else {
        const res = await App.apiCall({
          action: "getStudent", studentNumber: inputVal
        }, { retries: 1 });

        if (!res || !res.subjects || Object.keys(res.subjects).length === 0) {
          throw new Error((res && res.message) || "Student not found or has no enrolled subjects.");
        }
        state.currentStudentData = res;
        state.sessionToken = App.newSessionToken();
        App.saveSession({ role: 'student', studentNumber: res.studentNumber });

        setText('student-info-header', 'ID: ' + res.studentNumber + ' • ' + res.name);

        App.initializeStudentDropdowns(Object.keys(res.subjects));
        App.showToast("Logged in as " + res.name);
        await App.loadAnnouncement();
        App.showScreen('student');
      }
    } catch (error) {
      App.showToast(error.message || 'Login failed.', 'error');
    }
    btn.innerText = "Log In";
    btn.disabled = false;
  };

  App.handleLogout = function () {
    App.clearSession();

    state.adminPin = "";
    state.currentStudentData = null;
    state.currentAdminData = [];
    state.allAdminGradesCache = {};
    state.pendingImportData = [];
    state.sessionToken = "";
    App.invalidateAllCache();
    document.getElementById('login-input').value = "";
    const adminInput = document.getElementById('admin-announcement-input');
    if (adminInput) adminInput.value = '';
    App.showScreen('login');
  };

  App.restoreSession = async function () {
    const session = App.loadSession();
    if (!session) return false;

    if (session.role === 'teacher' && session.pin) {
      const res = await App.apiCall({
        action: "adminLogin",
        pin: session.pin,
        deviceId: App.getDeviceId()
      });
      if (!res.success) {
        App.clearSession();
        return false;
      }

      state.adminPin = session.pin;
      state.sessionToken = App.newSessionToken();

      try {
        await App.loadAnnouncement();
        await App.fetchAllSectionsForDropdowns();
        await App.loadAdminDashboard();
        App.showScreen('admin');
        return true;
      } catch (e) {
        console.warn("Session restore failed", e);
        return false;
      }
    }

    if (session.role === 'student' && session.studentNumber) {
      const res = await App.apiCall({
        action: "getStudent",
        studentNumber: session.studentNumber
      }, { retries: 1 });

      if (!res || !res.subjects || Object.keys(res.subjects).length === 0) {
        App.clearSession();
        return false;
      }

      state.currentStudentData = res;
      state.sessionToken = App.newSessionToken();

      setText('student-info-header', 'ID: ' + res.studentNumber + ' • ' + res.name);

      App.initializeStudentDropdowns(Object.keys(res.subjects));

      try {
        await App.loadAnnouncement();
        App.showScreen('student');
        return true;
      } catch (e) {
        console.warn("Session restore failed", e);
        return false;
      }
    }

    return false;
  };

  App.openRegisterModal = function () {
    document.getElementById('reg-error').classList.add('hidden');
    App.openModal(document.getElementById('register-modal'));
  };

  App.closeRegisterModal = function () {
    App.closeModal(document.getElementById('register-modal'));
  };

  App.submitRegistration = async function () {
    const id = document.getElementById('reg-student-id').value.trim();
    const name = document.getElementById('reg-student-name').value.trim();
    const sec = document.getElementById('reg-student-section').value;
    const subjects = Array.prototype.slice.call(
      document.querySelectorAll('#reg-subject-checkboxes input:checked')
    ).map(cb => cb.value);

    const errorBox = document.getElementById('reg-error');
    errorBox.classList.add('hidden');
    errorBox.textContent = "";

    if (!id || !name || !sec || subjects.length === 0) {
      errorBox.textContent = "Please fill in all fields and select a section and at least one subject.";
      errorBox.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('submit-reg-btn');
    const original = btn.innerText;
    btn.innerText = "Registering...";
    btn.disabled = true;

    try {
      const res = await App.apiCall({
        action: "registerStudent",
        studentData: { studentNumber: id, name: name, section: sec, enrolledSubjects: subjects }
      }, { retries: 1 });

      if (res.success) {
        App.closeRegisterModal();
        App.showToast("Registration successful! Logging you in...");
        App.setLoginRole('student');
        document.getElementById('login-input').value = id;
        await App.handleLogin();
      } else {
        errorBox.textContent = res.message || "Registration failed.";
        errorBox.classList.remove('hidden');
        App.showToast(res.message || "Registration failed.", "error");
      }
    } catch (err) {
      errorBox.textContent = "Network error. Please try again.";
      errorBox.classList.remove('hidden');
    }
    btn.innerText = original;
    btn.disabled = false;
  };

})(window.App);