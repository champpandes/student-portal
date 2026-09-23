(function (App) {
  'use strict';

  const state = App.state;

  function wireLoginEvents() {
    document.getElementById('role-tab-student').addEventListener('click', () => App.setLoginRole('student'));
    document.getElementById('role-tab-teacher').addEventListener('click', () => App.setLoginRole('teacher'));
    document.getElementById('login-show-toggle').addEventListener('click', App.toggleLoginVisibility);
    document.getElementById('login-btn').addEventListener('click', App.handleLogin);
    document.getElementById('login-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') App.handleLogin();
    });
    document.getElementById('open-register-btn').addEventListener('click', App.openRegisterModal);
    document.getElementById('register-cancel-btn').addEventListener('click', App.closeRegisterModal);
    document.getElementById('submit-reg-btn').addEventListener('click', App.submitRegistration);
    App.setLoginRole('student');
  }

  function wireAdminEvents() {
    document.querySelectorAll('.logout-btn').forEach(btn =>
      btn.addEventListener('click', App.handleLogout));

    document.getElementById('sidebar-toggle').addEventListener('click', App.toggleSidebar);
    document.getElementById('sidebar-toggle-desktop').addEventListener('click', App.toggleSidebar);
    document.getElementById('sidebar-backdrop').addEventListener('click', App.toggleSidebar);

    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => App.switchAdminTab(btn.dataset.tab, btn));
    });

    document.getElementById('admin-subject-filter').addEventListener('change', e => {
      state.activeAdminSubject = e.target.value;
      App.loadAdminDashboard();
    });
    document.getElementById('admin-search').addEventListener('input',
      App.debounce(App.applyAdminFilters, 250));
    document.getElementById('section-filter').addEventListener('change', App.applyAdminFilters);

    document.getElementById('sort-by-no').addEventListener('click', App.sortByStudentNo);
    document.getElementById('sort-by-name').addEventListener('click', App.sortByName);

    document.querySelectorAll('.quarter-pill').forEach(pill => {
      pill.addEventListener('click', () => App.filterByQuarter(pill.dataset.quarter));
    });

    const handleRowClick = e => {
      const tr = e.target.closest('[data-id][data-subject]');
      if (!tr) return;
      const id = tr.dataset.id;
      const subject = tr.dataset.subject;

      const qBtn = e.target.closest('[data-quarter]');
      if (qBtn) { App.openAdminBreakdown(qBtn, id, subject, qBtn.dataset.quarter); return; }

      const manage = e.target.closest('[data-action="manage"]');
      if (manage) { App.openSlidePanel(id, subject); return; }

      const toggle = e.target.closest('[data-action="toggle"]');
      if (toggle) App.toggleMobileCard(tr.dataset.idx);
    };

    const handleRowKey = e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target.closest('[data-quarter]');
      if (!target) return;
      const tr = target.closest('[data-id][data-subject]');
      if (!tr) return;
      e.preventDefault();
      App.openAdminBreakdown(target, tr.dataset.id, tr.dataset.subject, target.dataset.quarter);
    };

    document.getElementById('admin-table-body').addEventListener('click', handleRowClick);
    document.getElementById('admin-table-body').addEventListener('keydown', handleRowKey);
    document.getElementById('admin-mobile-card-list').addEventListener('click', handleRowClick);
    document.getElementById('admin-mobile-card-list').addEventListener('keydown', handleRowKey);

    document.getElementById('open-add-student-btn').addEventListener('click', App.openAddStudentModal);
    document.getElementById('add-student-cancel-btn').addEventListener('click', App.closeAddStudentModal);
    document.getElementById('save-new-student-btn').addEventListener('click', App.saveNewStudent);

    document.getElementById('panel-close-btn').addEventListener('click', App.closeSlidePanel);
    document.getElementById('slide-panel-backdrop').addEventListener('click', App.closeSlidePanel);
    document.getElementById('panel-save-info-btn').addEventListener('click', App.savePanelInfo);
    document.getElementById('panel-save-grades-btn').addEventListener('click', App.savePanelGrades);
    document.getElementById('panel-delete-btn').addEventListener('click', App.deleteStudentFromPanel);

    document.getElementById('subjects-list-ui').addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit') App.prepareEditSubject(btn.dataset.subject);
      else if (btn.dataset.action === 'delete') App.handleDeleteSubject(btn.dataset.subject);
    });
    document.getElementById('subject-submit-btn').addEventListener('click', App.handleSaveSubject);
    document.getElementById('subject-cancel-edit-btn').addEventListener('click', App.resetSubjectForm);

    document.getElementById('broadcast-btn').addEventListener('click', App.broadcastAnnouncement);
    document.getElementById('admin-send-comment-btn').addEventListener('click', App.submitAdminComment);
    document.getElementById('admin-new-comment-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') App.submitAdminComment();
    });
    document.getElementById('clear-comments-btn').addEventListener('click', App.clearClassComments);

    document.getElementById('open-import-btn').addEventListener('click', App.openImportModal);
    document.getElementById('csv-export-btn').addEventListener('click',
      () => App.exportTableToCSV('student_records_backup.csv'));
    document.getElementById('import-action').addEventListener('change', App.toggleImportUI);
    document.getElementById('preview-btn').addEventListener('click', App.previewDataTransfer);
    document.getElementById('confirm-btn').addEventListener('click', App.confirmDataTransfer);
    document.getElementById('import-cancel-btn').addEventListener('click', App.closeImportModal);
    document.getElementById('import-close-x').addEventListener('click', App.closeImportModal);

    document.getElementById('gs-subject').addEventListener('change', App.updateGradingSheetPreview);
    document.getElementById('gs-section').addEventListener('change', App.updateGradingSheetPreview);
    document.getElementById('gs-semester').addEventListener('change', App.updateGradingSheetPreview);
    document.getElementById('gs-print-btn').addEventListener('click', App.printGradingSheets);
  }

  function wireStudentEvents() {
    document.getElementById('student-subject-selector').addEventListener('change',
      e => App.changeStudentSubject(e.target.value));
    document.getElementById('student-sy-selector').addEventListener('change',
      e => App.changeStudentSY(e.target.value));
    document.getElementById('student-send-comment-btn').addEventListener('click', App.submitStudentComment);
    document.getElementById('new-comment-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') App.submitStudentComment();
    });

    // Print grades button (student dashboard)
    document.getElementById('student-print-btn').addEventListener('click', App.printStudentGrades);

    document.getElementById('student-main-grades').addEventListener('click', e => {
      const btn = e.target.closest('button[data-quarter]');
      if (!btn) return;
      App.openBreakdown(btn.dataset.quarter, btn.dataset.subject);
    });

    document.getElementById('breakdown-content').addEventListener('click', e => {
      const btn = e.target.closest('button[data-action="toggle-edit"]');
      if (!btn) return;
      App.toggleBreakdownEdit(btn, btn.dataset.quarter, btn.dataset.subject);
    });

    document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
      App.showScreen(state.adminPin !== '' ? 'admin' : 'student');
    });
  }

  async function boot() {
    App.initScreens();
    state.sessionToken = App.newSessionToken();

    wireLoginEvents();
    wireAdminEvents();
    wireStudentEvents();

    await App.fetchSubjects();
    await App.fetchAllSectionsForDropdowns();
    App.loadComments();

    const sidebar = document.getElementById('admin-sidebar');
    if (sidebar) sidebar.classList.remove('collapsed');

    await App.restoreSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.App);