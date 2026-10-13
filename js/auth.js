(function (App) {
  'use strict';

  const state = App.state;

  let loginRole = 'student';
  let lastLoginInput = '';
  let legacyPinMode = false;

  App.getLoginRole = function () { return loginRole; };

  App.setLoginRole = function (role) {
    loginRole = role;
    legacyPinMode = false;

    const sTab = document.getElementById('role-tab-student');
    const tTab = document.getElementById('role-tab-teacher');
    const hint = document.getElementById('login-hint');

    const inactive = "flex-1 px-4 py-2 rounded-xl text-xs font-bold transition-all text-slate-500 hover:text-slate-800";
    const active = "flex-1 px-4 py-2 rounded-xl text-xs font-bold transition-all bg-white text-indigo-700 shadow-sm";

    const studentField = document.getElementById('login-input-wrapper');
    const emailField   = document.getElementById('login-email-wrapper');
    const passField    = document.getElementById('login-password-wrapper');
    const legacyToggle = document.getElementById('legacy-pin-toggle');
    const studRegRow   = document.getElementById('student-register-row');
    const teachRegRow  = document.getElementById('teacher-register-row');

    document.getElementById('login-error').classList.add('hidden-screen');

    if (role === 'teacher') {
      studentField.classList.add('hidden-screen');
      emailField.classList.remove('hidden-screen');
      passField.classList.remove('hidden-screen');
      legacyToggle.classList.remove('hidden-screen');
      studRegRow.classList.add('hidden-screen');
      teachRegRow.classList.remove('hidden-screen');
      hint.textContent = 'Enter your teacher email and password';
      sTab.className = inactive; tTab.className = active;
      sTab.setAttribute('aria-selected', 'false');
      tTab.setAttribute('aria-selected', 'true');
      document.getElementById('login-email').value = '';
      document.getElementById('login-password').value = '';
      document.getElementById('login-email').focus();
    } else {
      studentField.classList.remove('hidden-screen');
      emailField.classList.add('hidden-screen');
      passField.classList.add('hidden-screen');
      legacyToggle.classList.add('hidden-screen');
      studRegRow.classList.remove('hidden-screen');
      teachRegRow.classList.add('hidden-screen');
      hint.textContent = 'Enter your Student Number';
      sTab.className = active; tTab.className = inactive;
      sTab.setAttribute('aria-selected', 'true');
      tTab.setAttribute('aria-selected', 'false');
      document.getElementById('login-input').value = '';
      document.getElementById('login-input').focus();
    }
  };

  App.toggleLoginVisibility = function () {
    const input = document.getElementById('login-password');
    const btn = document.getElementById('login-show-toggle');
    if (!input || !btn) return;
    if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
    else { input.type = 'password'; btn.textContent = '👁'; }
  };

  // Legacy PIN toggle (teacher tab only)
  App.toggleLegacyPin = function () {
    legacyPinMode = !legacyPinMode;
    const emailField = document.getElementById('login-email-wrapper');
    const passField  = document.getElementById('login-password-wrapper');
    const hint = document.getElementById('login-hint');
    const btn = document.getElementById('legacy-pin-toggle');

    if (legacyPinMode) {
      emailField.classList.add('hidden-screen');
      passField.classList.add('hidden-screen');
      hint.textContent = 'Enter your legacy teacher PIN';
      btn.textContent = 'Use email & password instead';
      // Reuse the student number field for PIN entry
      const pinInput = document.getElementById('login-input');
      pinInput.type = 'password';
      pinInput.placeholder = '••••';
      pinInput.setAttribute('inputmode', 'numeric');
      document.getElementById('login-input-wrapper').classList.remove('hidden-screen');
      pinInput.value = '';
      pinInput.focus();
    } else {
      emailField.classList.remove('hidden-screen');
      passField.classList.remove('hidden-screen');
      hint.textContent = 'Enter your teacher email and password';
      btn.textContent = 'Use legacy PIN instead';
      document.getElementById('login-input-wrapper').classList.add('hidden-screen');
      document.getElementById('login-email').focus();
    }
  };

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function showLoginError(msg) {
    const box = document.getElementById('login-error');
    box.textContent = msg;
    box.classList.remove('hidden-screen');
  }

  function clearLoginError() {
    document.getElementById('login-error').classList.add('hidden-screen');
  }

  // ============================================================
  // After a successful teacher login (either fresh or restored)
  // ============================================================
App.afterTeacherLogin = function () {
    const profileTab = document.querySelector('[data-tab="profile"]');
  if (profileTab) {
    profileTab.classList.toggle('hidden-screen', !state.currentTeacher);
  }
  const teacherTab = document.getElementById('tab-btn-teachers');
  if (teacherTab) {
    const isSuper = state.currentTeacher && state.currentTeacher.role === 'super_admin';
    teacherTab.classList.toggle('hidden-screen', !isSuper);
  }

  const legacyToggle = document.getElementById('legacy-pin-toggle');
  if (legacyToggle && state.sessionToken) legacyToggle.classList.add('hidden-screen');

  App.showScreen('admin');
  App.loadTeacherName();
  App.loadAnnouncement();
  App.fetchAllSectionsForDropdowns();
  App.loadAdminDashboard();
  if (App.loadPendingRegistrations) App.loadPendingRegistrations();
  if (App.renderTeacherManagementTab) App.renderTeacherManagementTab();
};

  // ============================================================
  // Login
  // ============================================================
  App.handleLogin = async function () {
    const btn = document.getElementById('login-btn');
    clearLoginError();

    await App.withButtonLoading(btn, async () => {
      try {
        if (loginRole === 'teacher') {
          if (legacyPinMode) {
            // Legacy PIN path
            const pin = document.getElementById('login-input').value.trim();
            if (!pin) return;
            const res = await App.apiCall({
              action: 'adminLogin',
              pin,
              deviceId: App.getDeviceId()
            }, { timeout: 45000 });
            if (!res.success) throw new Error(res.message || 'Invalid PIN.');

            state.adminPin = pin;
            state.sessionToken = '';
            state.currentTeacher = null;
            App.saveSession({ role: 'teacher', pin });
            App.showToast('Welcome back!');
            App.afterTeacherLogin();
          } else {
            // Email + password
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            if (!email || !password) throw new Error('Enter your email and password.');

            const res = await App.apiCall({
              action: 'teacherLogin',
              email, password
            }, { timeout: 45000 });

            if (res.pending) {
              if (App.showPendingModal) {
                App.showPendingModal({
                  message: res.message || 'Your registration is awaiting approval.',
                  submittedName: '',
                  studentNumber: '',
                  email
                });
              }
              return;
            }
            if (res.rejected) throw new Error(res.message || 'Your registration was not approved.');
            if (!res.success) throw new Error(res.message || 'Login failed.');

            state.sessionToken = res.sessionToken;
            state.adminPin = '';
            state.currentTeacher = res.teacher;
            App.saveSession({
              role: 'teacher',
              sessionToken: res.sessionToken,
              teacher: res.teacher
            });

            App.showToast('Welcome, ' + (res.teacher.displayName || 'teacher') + '!');
            App.afterTeacherLogin();
          }
        } else {
          // Student path (unchanged)
          const inputVal = document.getElementById('login-input').value.trim();
          if (!inputVal) return;
          lastLoginInput = inputVal;

          const res = await App.apiCall({
            action: 'getStudent',
            studentNumber: inputVal
          }, { retries: 1, timeout: 45000 });

          if (res && res.pending) {
            if (App.showPendingModal) {
              App.showPendingModal({
                message: res.message,
                submittedName: res.submittedName,
                studentNumber: inputVal
              });
            }
            return;
          }
          if (res && res.rejected) throw new Error(res.message || 'Your registration was not approved.');
          if (!res || !res.subjects || Object.keys(res.subjects).length === 0) {
            throw new Error((res && res.message) || 'Student not found or has no enrolled subjects.');
          }

          state.currentStudentData = res;
          state.sessionToken = App.newSessionToken();
          App.saveSession({ role: 'student', studentNumber: res.studentNumber });

          setText('student-info-header', 'ID: ' + res.studentNumber + ' • ' + res.name);
          App.initializeStudentDropdowns(Object.keys(res.subjects));
          App.showToast('Logged in as ' + res.name);
          App.showScreen('student');
          App.loadAnnouncement();
        }
      } catch (error) {
        showLoginError(error.message || 'Login failed.');
      }
    }, { text: 'Logging in...' });
  };

  // ============================================================
  // Logout
  // ============================================================
  App.handleLogout = async function () {
    // Revoke the session server-side if we have one.
    if (state.sessionToken) {
      try {
        await App.apiCall({ action: 'teacherLogout', sessionToken: state.sessionToken }, { retries: 0 });
      } catch (e) { /* best effort */ }
    }

    App.clearSession();
    state.adminPin = '';
    state.sessionToken = '';
    state.currentTeacher = null;
    state.currentStudentData = null;
    state.currentAdminData = [];
    state.allAdminGradesCache = {};
    state.pendingImportData = [];
    App.invalidateAllCache();

    sessionStorage.removeItem('sp_subjects_cache');
    sessionStorage.removeItem('sp_sections_cache');

    const loginInput = document.getElementById('login-input');
    if (loginInput) loginInput.value = '';
    const emailInput = document.getElementById('login-email');
    if (emailInput) emailInput.value = '';
    const passInput = document.getElementById('login-password');
    if (passInput) passInput.value = '';

    App.showScreen('login');
    App.setLoginRole('student');
  };

  // ============================================================
  // Session restore
  // ============================================================
  App.restoreSession = async function () {
    const session = App.loadSession();
    if (!session) return false;

    // ---- Teacher (new session token) ----
    if (session.role === 'teacher' && session.sessionToken) {
      state.sessionToken = session.sessionToken;
      const res = await App.apiCall({ action: 'getMe' }, { timeout: 45000 });

      if (res && res.success) {
        if (res.teacher) {
          state.currentTeacher = res.teacher;
        } else if (session.teacher) {
          // Legacy super admin, no teacher row yet
          state.currentTeacher = session.teacher;
        }
        App.afterTeacherLogin();
        return true;
      }

      // If the token is definitively invalid, clear it.
      const msg = String((res && res.message) || '').toLowerCase();
      if (msg.indexOf('not authenticated') !== -1) {
        App.clearSession();
      }
      return false;
    }

    // ---- Teacher (legacy PIN) ----
    if (session.role === 'teacher' && session.pin) {
      const res = await App.apiCall({
        action: 'adminLogin',
        pin: session.pin,
        deviceId: App.getDeviceId()
      }, { timeout: 45000 });

      if (!res.success) {
        const m = String(res.message || '').toLowerCase();
        if (m.indexOf('invalid') !== -1 || m.indexOf('too many') !== -1) {
          App.clearSession();
        }
        return false;
      }
      state.adminPin = session.pin;
      App.afterTeacherLogin();
      return true;
    }

    // ---- Student ----
    if (session.role === 'student' && session.studentNumber) {
      const res = await App.apiCall({
        action: 'getStudent',
        studentNumber: session.studentNumber
      }, { retries: 1, timeout: 45000 });

      if (!res || !res.subjects || Object.keys(res.subjects).length === 0) {
        App.clearSession();
        return false;
      }
      state.currentStudentData = res;
      state.sessionToken = App.newSessionToken();
      setText('student-info-header', 'ID: ' + res.studentNumber + ' • ' + res.name);
      App.initializeStudentDropdowns(Object.keys(res.subjects));
      App.showScreen('student');
      App.loadAnnouncement();
      return true;
    }

    return false;
  };

  // ============================================================
  // Student registration
  // ============================================================
  App.openRegisterModal = async function () {
    document.getElementById('reg-error').classList.add('hidden');
    // Load teachers list for the dropdown.
    const select = document.getElementById('reg-teacher-select');
    if (select) {
      select.innerHTML = '<option value="">Loading...</option>';
      try {
        const res = await App.apiCall({ action: 'getPublicTeachers' });
        const teachers = (res && res.teachers) || [];
        if (teachers.length === 0) {
          select.innerHTML = '<option value="">No teachers available yet</option>';
        } else {
          select.innerHTML = '<option value="">Select your teacher...</option>' +
            teachers.map(t => '<option value="' + App.esc(t.id) + '">' + App.esc(t.displayName) + '</option>').join('');
        }
      } catch (e) {
        select.innerHTML = '<option value="">Could not load teachers</option>';
      }
    }
    App.openModal(document.getElementById('register-modal'));
  };

  App.closeRegisterModal = function () {
    const modal = document.getElementById('register-modal');
    if (!App.confirmDiscard(modal, "You have unsaved registration details. Discard them?")) return;
    App.closeModal(modal);
  };

  App.submitRegistration = async function () {
    const btn = document.getElementById('submit-reg-btn');
    const id = document.getElementById('reg-student-id').value.trim();
    const name = document.getElementById('reg-student-name').value.trim();
    const teacherId = (document.getElementById('reg-teacher-select') || {}).value || '';

    const errorBox = document.getElementById('reg-error');
    errorBox.classList.add('hidden');
    errorBox.textContent = '';

    if (!id || !name) {
      errorBox.textContent = 'Please enter your name and student number.';
      errorBox.classList.remove('hidden');
      return;
    }
    if (!teacherId) {
      errorBox.textContent = 'Please select your teacher.';
      errorBox.classList.remove('hidden');
      return;
    }

    await App.withButtonLoading(btn, async () => {
      try {
        const res = await App.apiCall({
          action: 'registerStudent',
          studentData: { studentNumber: id, name: name, teacherId: teacherId }
        }, { retries: 1 });

        if (res.success && res.pending) {
          App.closeModal(document.getElementById('register-modal'));
          App.showToast('Registration submitted for approval.');
          if (App.showPendingModal) {
            App.showPendingModal({
              message: 'Your registration has been submitted. Your teacher will review it and assign your section and subjects before you can log in.',
              submittedName: name,
              studentNumber: id
            });
          }
        } else {
          errorBox.textContent = res.message || 'Registration failed.';
          errorBox.classList.remove('hidden');
        }
      } catch (err) {
        errorBox.textContent = 'Network error. Please try again.';
        errorBox.classList.remove('hidden');
      }
    }, { text: 'Submitting...' });
  };

  // ============================================================
  // Teacher registration
  // ============================================================
  App.openTeacherRegisterModal = function () {
    document.getElementById('reg-teacher-error').classList.add('hidden');
    ['reg-teacher-name', 'reg-teacher-email', 'reg-teacher-password', 'reg-teacher-password2']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    App.openModal(document.getElementById('register-teacher-modal'));
  };

  App.closeTeacherRegisterModal = function () {
    const modal = document.getElementById('register-teacher-modal');
    if (!App.confirmDiscard(modal, "You have unsaved registration details. Discard them?")) return;
    App.closeModal(modal);
  };

  App.submitTeacherRegistration = async function () {
    const btn = document.getElementById('submit-teacher-reg-btn');
    const displayName = document.getElementById('reg-teacher-name').value.trim();
    const email = document.getElementById('reg-teacher-email').value.trim();
    const password = document.getElementById('reg-teacher-password').value;
    const password2 = document.getElementById('reg-teacher-password2').value;

    const errorBox = document.getElementById('reg-teacher-error');
    errorBox.classList.add('hidden');
    errorBox.textContent = '';

    if (!displayName) { errorBox.textContent = 'Enter your name.'; errorBox.classList.remove('hidden'); return; }
    if (!email)       { errorBox.textContent = 'Enter your email.'; errorBox.classList.remove('hidden'); return; }
    if (password.length < 6) { errorBox.textContent = 'Password must be at least 6 characters.'; errorBox.classList.remove('hidden'); return; }
    if (password !== password2) { errorBox.textContent = 'Passwords do not match.'; errorBox.classList.remove('hidden'); return; }

    await App.withButtonLoading(btn, async () => {
      try {
        const res = await App.apiCall({
          action: 'registerTeacher',
          email, displayName, password
        }, { retries: 0 });

        if (res.success && res.firstUser) {
          // Bootstrap: first user is super admin. Auto-login.
          App.closeModal(document.getElementById('register-teacher-modal'));
          state.sessionToken = res.sessionToken;
          state.currentTeacher = res.teacher;
          App.saveSession({
            role: 'teacher',
            sessionToken: res.sessionToken,
            teacher: res.teacher
          });
          App.showToast('Welcome! You are the super admin.');
          App.afterTeacherLogin();
          return;
        }

        if (res.success && res.pending) {
          App.closeModal(document.getElementById('register-teacher-modal'));
          App.showToast('Registration submitted for approval.');
          if (App.showPendingModal) {
            App.showPendingModal({
              message: 'Your registration has been submitted. A super admin will review it and set your access level before you can log in.',
              submittedName: displayName,
              studentNumber: '',
              email
            });
          }
          return;
        }

        errorBox.textContent = res.message || 'Registration failed.';
        errorBox.classList.remove('hidden');
      } catch (err) {
        errorBox.textContent = 'Network error. Please try again.';
        errorBox.classList.remove('hidden');
      }
    }, { text: 'Registering...' });
  };

  // ============================================================
  // Pending registration status check
  // ============================================================
  App.checkPendingStatus = async function () {
    const btn = document.getElementById('pending-check-btn');
    await App.withButtonLoading(btn, async () => {
      try {
        if (loginRole === 'teacher') {
          const email = document.getElementById('login-email').value.trim();
          if (!email) { App.closePendingModal(); return; }
          // Re-check by trying to log in without password is not possible;
          // instead, just close and let the user retry the login.
          App.closePendingModal();
          App.showToast('Please try logging in again to check your status.', 'error');
          return;
        }

        if (!lastLoginInput) { App.closePendingModal(); return; }
        const res = await App.apiCall({
          action: 'getStudent',
          studentNumber: lastLoginInput
        }, { retries: 1 });

        if (res && res.pending) {
          App.showToast("Still pending. Please wait for your teacher's approval.", 'error');
        } else if (res && res.rejected) {
          App.closePendingModal();
          App.showToast(res.message || 'Your registration was not approved.', 'error');
        } else if (res && res.subjects && Object.keys(res.subjects).length > 0) {
          App.closePendingModal();
          App.showToast("You've been approved! Logging in...");
          document.getElementById('login-input').value = lastLoginInput;
          await App.handleLogin();
        } else {
          App.showToast('Still not found. Please contact your teacher.', 'error');
        }
      } catch (e) {
        App.showToast('Check failed. Try again later.', 'error');
      }
    }, { text: 'Checking...' });
  };

})(window.App);