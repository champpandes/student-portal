// js/teachers.js — Super admin: manage teacher accounts
(function (App) {
  'use strict';

  const state = App.state;

  App.renderTeacherManagementTab = async function () {
    if (!state.currentTeacher || state.currentTeacher.role !== 'super_admin') return;

    const pendingList = document.getElementById('pending-teachers-list');
    const allList = document.getElementById('teachers-list');
    const pendingCount = document.getElementById('pending-teacher-count');
    const badge = document.getElementById('pending-teacher-badge');
    if (!pendingList || !allList) return;

    pendingList.innerHTML = '<div class="text-xs text-slate-400 italic text-center py-4">Loading…</div>';
    allList.innerHTML = '<div class="text-xs text-slate-400 italic text-center py-4">Loading…</div>';

    try {
      const res = await App.apiCall({ action: 'listTeachers' });
      if (!res.success) throw new Error(res.message || 'Could not load teachers.');

      const all = res.teachers || [];
      const pending = all.filter(t => t.status === 'pending');
      const rest = all.filter(t => t.status !== 'pending');

      if (pendingCount) pendingCount.textContent = pending.length + ' waiting';
      if (badge) {
        if (pending.length > 0) { badge.textContent = String(pending.length); badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');
      }

      pendingList.innerHTML = pending.length === 0
        ? '<div class="text-xs text-emerald-600 font-bold text-center py-6">🎉 No pending teacher registrations.</div>'
        : pending.map(t =>
            '<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">' +
              '<div>' +
                '<div class="font-black text-sm text-slate-900">' + App.esc(t.displayName) + '</div>' +
                '<div class="text-[11px] text-slate-500 font-semibold">' + App.esc(t.email) + '</div>' +
                '<div class="text-[10px] text-slate-400 mt-1">Registered: ' + App.esc(App.formatTimestamp(t.createdAt)) + '</div>' +
              '</div>' +
              '<div class="flex gap-2 shrink-0">' +
                '<button data-action="approve-teacher" data-id="' + App.esc(t.id) + '" ' +
                        'class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold">✓ Approve</button>' +
                '<button data-action="reject-teacher" data-id="' + App.esc(t.id) + '" ' +
                        'class="bg-rose-100 hover:bg-rose-200 text-rose-700 px-4 py-2 rounded-xl text-xs font-bold border border-rose-200">✗ Reject</button>' +
              '</div>' +
            '</div>'
          ).join('');

      allList.innerHTML = rest.length === 0
        ? '<div class="text-xs text-slate-400 italic text-center py-4">No approved teachers yet.</div>'
        : rest.map(t => {
            const isSuper = t.role === 'super_admin';
            const roleBadge = isSuper
              ? '<span class="text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md">Super Admin</span>'
              : '<span class="text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md">Teacher</span>';
            const statusBadge = t.isActive
              ? '<span class="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md">Active</span>'
              : '<span class="text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md">Disabled</span>';
            const isSelf = state.currentTeacher && state.currentTeacher.id === t.id;

            return '<div class="bg-slate-50 border border-slate-200 rounded-xl p-3">' +
              '<div class="flex items-center gap-2 mb-1 flex-wrap">' +
                '<span class="font-bold text-sm text-slate-800">' + App.esc(t.displayName) + '</span>' +
                roleBadge + ' ' + statusBadge +
              '</div>' +
              '<div class="text-[11px] text-slate-500 font-semibold">' + App.esc(t.email) + '</div>' +
              '<div class="flex flex-wrap gap-2 mt-3">' +
                (!isSuper ? '<button data-action="promote-teacher" data-id="' + App.esc(t.id) + '" class="text-[11px] font-bold text-indigo-600 hover:underline">Promote to super admin</button>' : '') +
                '<button data-action="toggle-active" data-id="' + App.esc(t.id) + '" data-active="' + t.isActive + '" class="text-[11px] font-bold text-slate-600 hover:underline">' + (t.isActive ? 'Disable' : 'Enable') + '</button>' +
                '<button data-action="reset-password" data-id="' + App.esc(t.id) + '" data-name="' + App.esc(t.displayName) + '" class="text-[11px] font-bold text-amber-600 hover:underline">Reset password</button>' +
                (!isSelf ? '<button data-action="delete-teacher" data-id="' + App.esc(t.id) + '" data-name="' + App.esc(t.displayName) + '" class="text-[11px] font-bold text-rose-600 hover:underline ml-auto">Delete</button>' : '') +
              '</div>' +
            '</div>';
          }).join('');
    } catch (e) {
      console.error(e);
      pendingList.innerHTML = '<div class="text-xs text-rose-500 italic text-center py-4">Failed to load.</div>';
      allList.innerHTML = '';
    }
  };

  App.handleTeacherAction = async function (action, dataset) {
    const id = dataset.id;
    if (!id) return;

    if (action === 'approve-teacher') {
      if (!confirm('Approve this teacher as a regular teacher?')) return;
      const res = await App.apiCall({ action: 'approveTeacher', teacherId: id, role: 'teacher' });
      App.showToast(res.success ? 'Teacher approved.' : (res.message || 'Failed.'), res.success ? 'success' : 'error');
      if (res.success) App.renderTeacherManagementTab();
      return;
    }

    if (action === 'reject-teacher') {
      if (!confirm('Reject this teacher registration?')) return;
      const res = await App.apiCall({ action: 'rejectTeacher', teacherId: id });
      App.showToast(res.success ? 'Rejected.' : (res.message || 'Failed.'), res.success ? 'success' : 'error');
      if (res.success) App.renderTeacherManagementTab();
      return;
    }

    if (action === 'promote-teacher') {
      if (!confirm('Promote this teacher to super admin? They will get full access.')) return;
      const res = await App.apiCall({ action: 'setTeacherRole', teacherId: id, role: 'super_admin' });
      App.showToast(res.success ? 'Promoted.' : (res.message || 'Failed.'), res.success ? 'success' : 'error');
      if (res.success) App.renderTeacherManagementTab();
      return;
    }

    if (action === 'toggle-active') {
      const isActive = dataset.active === 'true';
      const res = await App.apiCall({ action: 'setTeacherActive', teacherId: id, isActive: !isActive });
      App.showToast(res.success ? (isActive ? 'Disabled.' : 'Enabled.') : (res.message || 'Failed.'), res.success ? 'success' : 'error');
      if (res.success) App.renderTeacherManagementTab();
      return;
    }

    if (action === 'reset-password') {
      const pw = prompt('New password for ' + dataset.name + ' (min 6 characters):');
      if (!pw) return;
      if (pw.length < 6) { App.showToast('Password must be at least 6 characters.', 'error'); return; }
      const res = await App.apiCall({ action: 'resetTeacherPassword', teacherId: id, password: pw });
      App.showToast(res.success ? 'Password reset. They must log in again.' : (res.message || 'Failed.'), res.success ? 'success' : 'error');
      return;
    }

    if (action === 'delete-teacher') {
      if (!confirm('Permanently delete ' + dataset.name + '? This cannot be undone.')) return;
      const res = await App.apiCall({ action: 'deleteTeacher', teacherId: id });
      App.showToast(res.success ? 'Teacher deleted.' : (res.message || 'Failed.'), res.success ? 'success' : 'error');
      if (res.success) App.renderTeacherManagementTab();
      return;
    }
  };

})(window.App);