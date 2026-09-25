(function (App) {
  'use strict';

  const state = App.state;

  // Cache of pending items so approve-modal can look them up
  state._pendingCache = [];

  App.loadPendingRegistrations = async function () {
    const pendingList = document.getElementById('pending-list');
    const historyList = document.getElementById('registration-history');
    const pendingCount = document.getElementById('pending-count');
    const badge = document.getElementById('pending-badge');

    if (!pendingList) return;

    try {
      const res = await App.apiCall({
        action: "getPendingRegistrations",
        pin: state.adminPin
      }, { retries: 1 });

      if (!res.success) throw new Error(res.message || "Could not load registrations.");

      const pending = res.pending || [];
      const history = res.history || [];
      state._pendingCache = pending;

      if (badge) {
        if (pending.length > 0) {
          badge.textContent = String(pending.length);
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }

      if (pendingCount) pendingCount.textContent = pending.length + ' waiting';

      // Pending list
      if (pending.length === 0) {
        pendingList.innerHTML = '<div class="text-xs text-emerald-600 font-bold text-center py-6">🎉 No pending registrations.</div>';
      } else {
        pendingList.innerHTML = pending.map(item =>
          '<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-2 mb-1">' +
                '<span class="font-black text-sm text-slate-900">' + App.esc(item.name) + '</span>' +
                '<span class="text-[10px] font-black uppercase tracking-wider bg-amber-200 text-amber-800 px-2 py-0.5 rounded-md">Pending</span>' +
              '</div>' +
              '<div class="text-[11px] font-semibold text-slate-500">Student No: ' + App.esc(item.studentNumber) + '</div>' +
              '<div class="text-[10px] text-slate-400 mt-1">Submitted: ' + App.esc(item.timestamp) + '</div>' +
            '</div>' +
            '<div class="flex gap-2 shrink-0">' +
              '<button type="button" data-action="approve" data-student="' + App.esc(item.studentNumber) + '" ' +
                      'class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all">' +
                '✓ Approve' +
              '</button>' +
              '<button type="button" data-action="reject" data-student="' + App.esc(item.studentNumber) + '" ' +
                      'class="bg-rose-100 hover:bg-rose-200 text-rose-700 px-4 py-2 rounded-xl text-xs font-bold transition-colors border border-rose-200">' +
                '✗ Reject' +
              '</button>' +
            '</div>' +
          '</div>'
        ).join('');
      }

      // History
      if (history.length === 0) {
        historyList.innerHTML = '<div class="text-xs text-slate-400 italic text-center py-4">No history yet.</div>';
      } else {
        historyList.innerHTML = history.map(item => {
          const isApproved = item.status === 'approved';
          const statusBadge = isApproved
            ? '<span class="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md">Approved</span>'
            : '<span class="text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md">Rejected</span>';

          const subjLine = (item.subjects && item.subjects.length)
            ? '<div class="text-[11px] text-slate-500 mt-0.5">Subjects: ' + item.subjects.map(s => App.esc(s)).join(', ') + '</div>'
            : '';
          const secLine = item.section
            ? 'Section: ' + App.esc(item.section)
            : '';

          return '<div class="bg-slate-50 border border-slate-200 rounded-xl p-3">' +
            '<div class="flex items-center justify-between mb-1">' +
              '<span class="font-bold text-sm text-slate-800">' + App.esc(item.name) + '</span>' +
              statusBadge +
            '</div>' +
            '<div class="text-[11px] text-slate-500 font-semibold">' +
              'ID: ' + App.esc(item.studentNumber) +
              (secLine ? ' &bull; ' + secLine : '') +
            '</div>' +
            subjLine +
            '<div class="text-[10px] text-slate-400 mt-0.5">' +
              'Submitted: ' + App.esc(item.timestamp) +
              (item.reviewedAt ? ' &bull; Reviewed: ' + App.esc(item.reviewedAt) : '') +
            '</div>' +
          '</div>';
        }).join('');
      }
    } catch (e) {
      console.error(e);
      pendingList.innerHTML = '<div class="text-xs text-rose-500 italic text-center py-6">Failed to load.</div>';
      if (historyList) historyList.innerHTML = '';
    }
  };

  // ============================================================
  // APPROVE — opens a modal for the teacher to assign
  // ============================================================
  App.approveRegistration = function (studentNumber) {
    const item = state._pendingCache.find(p => p.studentNumber === studentNumber);
    if (!item) {
      App.showToast("Pending registration not found. Try refreshing.", "error");
      return;
    }

    // Fill modal
    document.getElementById('approve-student-name').textContent = item.name;
    document.getElementById('approve-student-number').textContent = 'Student No: ' + item.studentNumber;
    document.getElementById('approve-pending-student-number').value = item.studentNumber;
    document.getElementById('approve-student-section').value = item.section || '';
    document.getElementById('approve-error').classList.add('hidden');

    // Section datalist (existing sections as suggestions)
    const datalist = document.getElementById('approve-section-list');
    const sections = state.sectionsCache || [];
    datalist.innerHTML = sections.map(s => '<option value="' + App.esc(s) + '"></option>').join('');

    // Subject checkboxes (all unchecked by default — teacher picks)
    const cbContainer = document.getElementById('approve-subject-checkboxes');
    if (state.availableSubjects.length === 0) {
      cbContainer.innerHTML = '<span class="text-xs text-rose-500 font-bold">No subjects available. Add a subject first.</span>';
    } else {
      cbContainer.innerHTML = state.availableSubjects.map(s =>
        '<label class="font-medium text-sm text-slate-600 flex items-center cursor-pointer">' +
          '<input type="checkbox" value="' + App.esc(s) + '" class="mr-1.5 accent-indigo-600 w-4 h-4"> ' + App.esc(s) +
        '</label>').join('');
    }

    App.openModal(document.getElementById('approve-modal'));
  };

  App.confirmApproval = async function () {
    const studentNumber = document.getElementById('approve-pending-student-number').value;
    const section = document.getElementById('approve-student-section').value.trim();
    const subjects = Array.prototype.slice.call(
      document.querySelectorAll('#approve-subject-checkboxes input:checked')
    ).map(cb => cb.value);

    const errorBox = document.getElementById('approve-error');
    errorBox.classList.add('hidden');
    errorBox.textContent = '';

    if (!section) {
      errorBox.textContent = 'Please enter a section.';
      errorBox.classList.remove('hidden');
      return;
    }
    if (subjects.length === 0) {
      errorBox.textContent = 'Select at least one subject.';
      errorBox.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('confirm-approve-btn');
    const original = btn.innerText;
    btn.innerText = 'Approving...';
    btn.disabled = true;

    try {
      const res = await App.apiCall({
        action: "approveRegistration",
        pin: state.adminPin,
        studentNumber: studentNumber,
        section: section,
        subjects: subjects
      }, { retries: 1 });

      if (res.success) {
        App.closeModal(document.getElementById('approve-modal'));
        App.showToast(res.message || "Registration approved.");
        App.invalidateAllCache();
        await App.loadPendingRegistrations();
        App.loadAdminDashboard();
      } else {
        errorBox.textContent = res.message || 'Approval failed.';
        errorBox.classList.remove('hidden');
      }
    } catch (e) {
      errorBox.textContent = e.message || 'Approval failed.';
      errorBox.classList.remove('hidden');
    }

    btn.innerText = original;
    btn.disabled = false;
  };

  App.rejectRegistration = async function (studentNumber) {
    if (!confirm("Reject this registration? The student will not be enrolled.")) return;

    try {
      const res = await App.apiCall({
        action: "rejectRegistration",
        pin: state.adminPin,
        studentNumber: studentNumber
      }, { retries: 1 });

      if (res.success) {
        App.showToast("Registration rejected.");
        await App.loadPendingRegistrations();
      } else {
        App.showToast(res.message || "Rejection failed.", "error");
      }
    } catch (e) {
      App.showToast(e.message || "Rejection failed.", "error");
    }
  };

  App.approveSelectAll = function () {
    document.querySelectorAll('#approve-subject-checkboxes input').forEach(cb => cb.checked = true);
  };

  App.approveClearAll = function () {
    document.querySelectorAll('#approve-subject-checkboxes input').forEach(cb => cb.checked = false);
  };

  // ---------- Student-side pending modal ----------
  App.showPendingModal = function (info) {
    const modal = document.getElementById('pending-modal');
    const msgEl = document.getElementById('pending-modal-message');
    const detEl = document.getElementById('pending-modal-details');
    const detContent = document.getElementById('pending-modal-details-content');

    if (msgEl) msgEl.textContent = info.message || "Your registration is awaiting teacher approval.";

    if (info.submittedName && detEl && detContent) {
      detContent.innerHTML =
        '<div><b>Name:</b> ' + App.esc(info.submittedName) + '</div>' +
        '<div><b>Student No:</b> ' + App.esc(info.studentNumber || '—') + '</div>';
      detEl.classList.remove('hidden');
    } else if (detEl) {
      detEl.classList.add('hidden');
    }

    App.openModal(modal);
  };

  App.closePendingModal = function () {
    App.closeModal(document.getElementById('pending-modal'));
  };

})(window.App);