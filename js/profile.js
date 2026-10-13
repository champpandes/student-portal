// js/profile.js — Teacher profile page
(function (App) {
  'use strict';

  const state = App.state;

  App.loadProfileTab = async function () {
    const teacher = state.currentTeacher;

    if (!teacher) {
      document.getElementById('profile-avatar').textContent = '?';
      document.getElementById('profile-display-name').textContent = 'Not logged in as a teacher';
      document.getElementById('profile-email').textContent = 'Log in with email + password to see your profile.';
      document.getElementById('profile-role-badge').classList.add('hidden-screen');
      document.getElementById('profile-since').textContent = '';
      document.getElementById('profile-stat-students').textContent = '-';
      document.getElementById('profile-stat-subjects').textContent = '-';
      document.getElementById('profile-stat-sections').textContent = '-';
      document.getElementById('profile-name-input').value = '';
      return;
    }

    const initial = (teacher.displayName || teacher.email || 'T').charAt(0).toUpperCase();
    document.getElementById('profile-avatar').textContent = initial;
    document.getElementById('profile-display-name').textContent = teacher.displayName || 'Teacher';
    document.getElementById('profile-email').textContent = teacher.email || '';

    const badge = document.getElementById('profile-role-badge');
    badge.classList.remove('hidden-screen');
    if (teacher.role === 'super_admin') {
      badge.textContent = 'Super Admin';
      badge.className = 'text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md';
    } else {
      badge.textContent = 'Teacher';
      badge.className = 'text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md';
    }

    document.getElementById('profile-since').textContent = teacher.createdAt
      ? 'Member since ' + App.formatTimestamp(teacher.createdAt)
      : '';
    document.getElementById('profile-name-input').value = teacher.displayName || '';

    document.getElementById('profile-current-pw').value = '';
    document.getElementById('profile-new-pw').value = '';
    document.getElementById('profile-confirm-pw').value = '';
    document.getElementById('profile-pw-error').classList.add('hidden-screen');
    document.getElementById('profile-pw-error').textContent = '';

    try {
      const res = await App.apiCall({ action: 'getMyStats' });
      if (res && res.success) {
        document.getElementById('profile-stat-students').textContent = res.students || 0;
        document.getElementById('profile-stat-subjects').textContent = res.subjects || 0;
        document.getElementById('profile-stat-sections').textContent = res.sections || 0;
      }
    } catch (e) {
      console.warn('Could not load profile stats', e);
    }
  };

  App.saveProfileName = async function () {
    const btn = document.getElementById('profile-save-name-btn');
    const input = document.getElementById('profile-name-input');
    const name = input.value.trim();
    if (!name) { App.showToast('Name cannot be empty.', 'error'); return; }
    if (name === (state.currentTeacher?.displayName || '')) {
      App.showToast('No changes to save.');
      return;
    }

    await App.withButtonLoading(btn, async () => {
      const res = await App.apiCall({ action: 'saveTeacherName', name });
      if (res && res.success) {
        if (state.currentTeacher) state.currentTeacher.displayName = res.name || name;
        App.showToast('Display name updated.');
        App.loadProfileTab();
        if (App.loadTeacherName) App.loadTeacherName();
      } else {
        App.showToast((res && res.message) || 'Failed to save.', 'error');
      }
    }, { text: 'Saving...' });
  };

  App.changeMyPassword = async function () {
    const btn = document.getElementById('profile-change-pw-btn');
    const cur = document.getElementById('profile-current-pw').value;
    const nw = document.getElementById('profile-new-pw').value;
    const cf = document.getElementById('profile-confirm-pw').value;
    const errBox = document.getElementById('profile-pw-error');

    errBox.classList.add('hidden-screen');
    errBox.textContent = '';

    if (!cur || !nw || !cf) {
      errBox.textContent = 'Fill in all three fields.';
      errBox.classList.remove('hidden-screen');
      return;
    }
    if (nw.length < 6) {
      errBox.textContent = 'New password must be at least 6 characters.';
      errBox.classList.remove('hidden-screen');
      return;
    }
    if (nw !== cf) {
      errBox.textContent = 'New passwords do not match.';
      errBox.classList.remove('hidden-screen');
      return;
    }
    if (nw === cur) {
      errBox.textContent = 'New password must be different from the current one.';
      errBox.classList.remove('hidden-screen');
      return;
    }

    await App.withButtonLoading(btn, async () => {
      const res = await App.apiCall({
        action: 'changeMyPassword',
        currentPassword: cur,
        newPassword: nw
      }, { retries: 0 });

      if (res && res.success) {
        document.getElementById('profile-current-pw').value = '';
        document.getElementById('profile-new-pw').value = '';
        document.getElementById('profile-confirm-pw').value = '';
        App.showToast('Password changed. Other devices signed out.');
      } else {
        errBox.textContent = (res && res.message) || 'Failed to change password.';
        errBox.classList.remove('hidden-screen');
      }
    }, { text: 'Changing...' });
  };

})(window.App);