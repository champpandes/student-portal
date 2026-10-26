(function (App) {
  'use strict';

  const state = App.state;

  let deferredPrompt = null;

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          console.log('[PWA] Service worker registered:', reg.scope);
          reg.update().catch(() => {});
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                nw.postMessage('SKIP_WAITING');
              }
            });
          });
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    });

    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
  }

  function hidePwaBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.classList.add('hidden-screen');
  }

  function setupPwaInstall() {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone === true) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (localStorage.getItem('pwa_install_dismissed') !== '1') {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.classList.remove('hidden-screen');
      }
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      hidePwaBanner();
      localStorage.setItem('pwa_install_dismissed', '1');
    });

    document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
      if (!deferredPrompt) { hidePwaBanner(); return; }
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { }
      deferredPrompt = null;
      hidePwaBanner();
    });

    document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
      localStorage.setItem('pwa_install_dismissed', '1');
      hidePwaBanner();
    });

    document.getElementById('pwa-close-x')?.addEventListener('click', hidePwaBanner);
  }

  function wireLoginEvents() {
    document.getElementById('role-tab-student').addEventListener('click', () => App.setLoginRole('student'));
    document.getElementById('role-tab-teacher').addEventListener('click', () => App.setLoginRole('teacher'));
    document.getElementById('login-show-toggle').addEventListener('click', App.toggleLoginVisibility);
    document.getElementById('open-teacher-register-btn').addEventListener('click', App.openTeacherRegisterModal);
    document.getElementById('register-teacher-cancel-btn').addEventListener('click', App.closeTeacherRegisterModal);
    document.getElementById('submit-teacher-reg-btn').addEventListener('click', App.submitTeacherRegistration);
    document.getElementById('login-btn').addEventListener('click', App.handleLogin);
    document.getElementById('login-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') App.handleLogin();
    });

    const loginInput = document.getElementById('login-input');
    loginInput.addEventListener('input', () => {
      if (App.getLoginRole && App.getLoginRole() !== 'student') return;
      const cursorAtEnd = loginInput.selectionStart === loginInput.value.length;
      let digits = loginInput.value.replace(/\D/g, '');
      if (digits.length > 2) digits = digits.slice(0, 2) + '-' + digits.slice(2);
      if (digits !== loginInput.value) {
        loginInput.value = digits;
        if (cursorAtEnd) loginInput.setSelectionRange(digits.length, digits.length);
      }
    });

    document.getElementById('open-register-btn').addEventListener('click', App.openRegisterModal);
    document.getElementById('register-cancel-btn').addEventListener('click', App.closeRegisterModal);
    document.getElementById('submit-reg-btn').addEventListener('click', App.submitRegistration);
    document.getElementById('pending-close-btn').addEventListener('click', App.closePendingModal);
    document.getElementById('pending-check-btn').addEventListener('click', App.checkPendingStatus);
  }

  function wireAdminEvents() {
    document.querySelectorAll('.logout-btn').forEach(btn => btn.addEventListener('click', App.handleLogout));

    document.getElementById('sidebar-toggle').addEventListener('click', App.toggleSidebar);
    document.getElementById('sidebar-toggle-desktop').addEventListener('click', App.toggleSidebar);
    document.getElementById('sidebar-backdrop').addEventListener('click', App.toggleSidebar);

    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => App.switchAdminTab(btn.dataset.tab, btn));
    });

    // Roster Tab
    document.getElementById('roster-table-body').addEventListener('click', e => {
      const btn = e.target.closest('button[data-action="manage-roster"]');
      if (btn) App.openSlidePanel(btn.dataset.id, 'roster');
    });

    document.getElementById('roster-search').addEventListener('input', App.debounce(App.filterRoster, 250));
    document.getElementById('roster-section-filter').addEventListener('change', App.filterRoster);
    document.getElementById('roster-subject-filter')?.addEventListener('change', App.filterRoster);
    
    document.getElementById('roster-select-all').addEventListener('change', e => {
      document.querySelectorAll('#roster-table-body tr.roster-row').forEach(row => {
        if (!row.classList.contains('hidden')) row.querySelector('.roster-checkbox').checked = e.target.checked;
      });
      App.updateBulkActionBar();
    });

    document.getElementById('roster-table-body').addEventListener('change', e => {
      if (e.target.classList.contains('roster-checkbox')) App.updateBulkActionBar();
    });

    document.getElementById('bulk-enroll-btn').addEventListener('click', App.executeBulkEnroll);

    // Pending Requests Modal
    document.getElementById('open-pending-requests-btn').addEventListener('click', App.openTeacherPendingRequests);
    document.getElementById('close-pending-requests-btn').addEventListener('click', App.closeTeacherPendingRequests);

    // Grade Book Tab
    document.getElementById('admin-subject-filter').addEventListener('change', e => {
      state.activeAdminSubject = e.target.value;
      App.loadAdminDashboard();
    });
    document.getElementById('section-filter').addEventListener('change', App.applyAdminFilters);
    document.getElementById('admin-search').addEventListener('input', App.debounce(App.applyAdminFilters, 250));
    document.getElementById('admin-sort').addEventListener('change', App.applyAdminFilters);

    const handleRowClick = e => {
      const tr = e.target.closest('[data-id][data-subject]');
      if (!tr) return;
      const id = tr.dataset.id; const subject = tr.dataset.subject;
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

    document.getElementById('refresh-dashboard-btn').addEventListener('click', App.refreshDashboard);
    document.getElementById('save-teacher-name-btn').addEventListener('click', App.saveTeacherNameFromUI);
    document.getElementById('recompute-btn').addEventListener('click', App.recomputeAllGrades);

    // Add student modal (single)
    document.getElementById('open-add-student-btn').addEventListener('click', App.openAddStudentModal);
    document.getElementById('add-student-cancel-btn').addEventListener('click', App.closeAddStudentModal);
    document.getElementById('save-new-student-btn').addEventListener('click', App.saveNewStudent);

    // Bulk buttons
    document.getElementById('open-bulk-students-btn').addEventListener('click', () => App.openImportModal('students'));
    document.getElementById('open-bulk-grades-btn')?.addEventListener('click', () => App.openImportModal('grades'));

    // Import wizard
    document.getElementById('open-import-btn').addEventListener('click', () => App.openImportModal());
    document.getElementById('import-action').addEventListener('change', App.toggleImportUI);
    document.getElementById('preview-btn').addEventListener('click', App.previewDataTransfer);
    document.getElementById('confirm-btn').addEventListener('click', App.confirmDataTransfer);
    document.getElementById('import-cancel-btn').addEventListener('click', App.closeImportModal);
    document.getElementById('import-close-x').addEventListener('click', App.closeImportModal);
    document.getElementById('import-subject').addEventListener('change', () => {
      if (document.getElementById('import-action').value === 'grades') App.populateGradeColumnMappings();
    });

    // Registrations
    document.getElementById('refresh-registrations-btn').addEventListener('click', () => { App.loadPendingRegistrations(); App.showToast("Refreshed."); });
    document.getElementById('pending-list').addEventListener('click', e => {
      const approveBtn = e.target.closest('button[data-action="approve"]');
      const rejectBtn = e.target.closest('button[data-action="reject"]');
      if (approveBtn) App.approveRegistration(approveBtn.dataset.student);
      else if (rejectBtn) App.rejectRegistration(rejectBtn.dataset.student);
    });

    document.getElementById('approve-cancel-btn').addEventListener('click', () => {
      const modal = document.getElementById('approve-modal');
      if (!App.confirmDiscard(modal, "Discard this approval? Any changes you made will be lost.")) return;
      App.closeModal(modal);
    });
    document.getElementById('confirm-approve-btn').addEventListener('click', App.confirmApproval);

    // Teachers Tab
    const refreshTeachersBtn = document.getElementById('refresh-teachers-btn');
    if (refreshTeachersBtn) {
      refreshTeachersBtn.addEventListener('click', () => {
        App.renderTeacherManagementTab();
        App.showToast('Refreshed.');
      });
    }

    const pendingTeachersList = document.getElementById('pending-teachers-list');
    const allTeachersList = document.getElementById('teachers-list');
    [pendingTeachersList, allTeachersList].forEach(el => {
      if (!el) return;
      el.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        App.handleTeacherAction(btn.dataset.action, btn.dataset);
      });
    });

    // Slide panel
    document.getElementById('panel-close-btn').addEventListener('click', App.closeSlidePanel);
    document.getElementById('slide-panel-backdrop').addEventListener('click', App.closeSlidePanel);
    document.getElementById('panel-save-info-btn').addEventListener('click', App.savePanelInfo);
    document.getElementById('panel-save-grades-btn').addEventListener('click', App.savePanelGrades);
    document.getElementById('panel-delete-btn').addEventListener('click', App.deleteStudentFromPanel);
    const saveEnrollmentsBtn = document.getElementById('panel-save-enrollments-btn');
    if (saveEnrollmentsBtn) saveEnrollmentsBtn.addEventListener('click', App.savePanelEnrollments);

    // Subjects
    document.getElementById('subjects-list-ui').addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit') App.prepareEditSubject(btn.dataset.subject);
      else if (btn.dataset.action === 'delete') App.handleDeleteSubject(btn.dataset.subject);
    });
    document.getElementById('subject-submit-btn').addEventListener('click', App.handleSaveSubject);
    document.getElementById('subject-cancel-edit-btn').addEventListener('click', App.resetSubjectForm);
    document.getElementById('add-category-btn').addEventListener('click', () => App.addCategoryRow('', ''));
    ['qw-1st','qw-2nd','qw-3rd','qw-4th'].forEach(id => document.getElementById(id).addEventListener('input', App.updateCategoryTotals));

    // Sections
    document.getElementById('sections-list-ui').addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit') App.prepareEditSection(btn.dataset.section);
      else if (btn.dataset.action === 'delete') App.handleDeleteSection(btn.dataset.section);
    });
    document.getElementById('section-submit-btn').addEventListener('click', App.handleSaveSection);
    document.getElementById('section-cancel-edit-btn').addEventListener('click', App.resetSectionForm);

    // Class Record
    document.getElementById('cr-subject').addEventListener('change', App.loadClassRecord);
    document.getElementById('cr-quarter').addEventListener('change', App.loadClassRecord);
    document.getElementById('cr-refresh-btn').addEventListener('click', App.loadClassRecord);
    document.getElementById('cr-apply-btn').addEventListener('click', App.applyClassRecord);

    const crSearch = document.getElementById('cr-search');
    const crSection = document.getElementById('cr-section-filter');
    const crSort = document.getElementById('cr-sort');
    const crPageSize = document.getElementById('cr-page-size');
    if (crSearch) crSearch.addEventListener('input', App.debounce(App.crApplyFilters, 200));
    if (crSection) crSection.addEventListener('change', App.crApplyFilters);
    if (crSort) crSort.addEventListener('change', App.crApplyFilters);
    if (crPageSize) crPageSize.addEventListener('change', () => App.crSetPageSize(crPageSize.value));

    document.getElementById('assessment-cancel-btn').addEventListener('click', App.closeAssessmentModal);
    document.getElementById('assessment-save-btn').addEventListener('click', App.saveAssessment);

    // Class record delegated events
    document.getElementById('cr-body').addEventListener('click', (e) => {
      const addBtn = e.target.closest('button[data-action="add-assessment"]');
      if (addBtn) {
        const quarter = document.getElementById('cr-quarter').value;
        App.openAssessmentModal(Number(addBtn.dataset.categoryId), addBtn.dataset.categoryName, quarter, null, '', 100);
        return;
      }
      const editBtn = e.target.closest('button[data-action="edit-assessment"]');
      if (editBtn) {
        const quarter = document.getElementById('cr-quarter').value;
        App.openAssessmentModal(Number(editBtn.dataset.categoryId), editBtn.dataset.categoryName, quarter, Number(editBtn.dataset.id), editBtn.dataset.name, Number(editBtn.dataset.total));
        return;
      }
      const delBtn = e.target.closest('button[data-action="delete-assessment"]');
      if (delBtn) { App.deleteAssessment(Number(delBtn.dataset.id), delBtn.dataset.name); return; }
      
      const pasteBtn = e.target.closest('button[data-action="bulk-scores"]');
      if (pasteBtn) {
        App.openBulkScoresModal(Number(pasteBtn.dataset.id), pasteBtn.dataset.name, pasteBtn.dataset.total);
        return;
      }

      // NEW: Show blanks filter
      const blankBtn = e.target.closest('button[data-action="filter-blanks"]');
      if (blankBtn) {
        const id = Number(blankBtn.dataset.id);
        state._crBlankFilter = (state._crBlankFilter === id) ? null : id;
        App.renderClassRecord();
        return;
      }

      // NEW: Fill zeros
      const fillBtn = e.target.closest('button[data-action="fill-zeros"]');
      if (fillBtn) {
        App.crFillZeros(Number(fillBtn.dataset.id));
        return;
      }

      const tabBtn = e.target.closest('button[data-action="switch-category"]');
      if (tabBtn) {
        App.crSetActiveCategory(tabBtn.dataset.categoryId);
        return;
      }

      if (e.target.closest('#cr-expand-all-btn')) { App.crExpandAll(); return; }
      if (e.target.closest('#cr-collapse-all-btn')) { App.crCollapseAll(); return; }
      const pageBtn = e.target.closest('button[data-cr-cat-page]');
      if (pageBtn) { App.crGotoCategoryPage(Number(pageBtn.dataset.crCatPage), pageBtn.dataset.categoryId); }
    });
    
    document.getElementById('cr-body').addEventListener('focusin', (e) => {
      if (e.target.classList.contains('cr-score-input')) e.target.dataset.originalValue = e.target.value;
    });
    
    document.getElementById('cr-body').addEventListener('focusout', (e) => {
      if (e.target.classList.contains('cr-score-input')) App.saveScoreInline(e.target);
    });

    // Press Enter to save and move to the next student in the same column
    document.getElementById('cr-body').addEventListener('keydown', (e) => {
      if (e.target.classList.contains('cr-score-input')) {
        if (e.key === 'Enter' || e.key === 'NumpadEnter') {
          e.preventDefault();
          
          const currentInput = e.target;
          const assessmentId = currentInput.dataset.assessmentId;
          const currentRow = currentInput.closest('tr');
          
          let nextRow = currentRow.nextElementSibling;
          
          while (nextRow && !nextRow.querySelector('.cr-score-input')) {
             nextRow = nextRow.nextElementSibling;
          }

          if (nextRow) {
            const nextInput = nextRow.querySelector(`.cr-score-input[data-assessment-id="${assessmentId}"]`);
            if (nextInput) {
              currentInput.blur();
              nextInput.focus();
              nextInput.select();
            }
          } else {
            currentInput.blur();
          }
        }
      }
    });

    // Bulk Scores Modal
    document.getElementById('bulk-scores-close-x')?.addEventListener('click', () => App.closeModal(document.getElementById('bulk-scores-modal')));
    document.getElementById('bulk-scores-cancel-btn')?.addEventListener('click', () => App.closeModal(document.getElementById('bulk-scores-modal')));
    document.getElementById('bulk-scores-input')?.addEventListener('input', App.debounce(App.parseBulkText, 300));
    document.getElementById('bulk-scores-preview-btn')?.addEventListener('click', App.previewBulkScores);
    document.getElementById('bulk-scores-save-btn')?.addEventListener('click', App.saveBulkScores);

    // Analytics
    document.getElementById('analytics-subject-filter').addEventListener('change', App.refreshAnalytics);
    document.getElementById('analytics-section-filter').addEventListener('change', App.refreshAnalytics);

    // Backup
    document.getElementById('csv-export-btn').addEventListener('click', () => App.exportTableToCSV('student_records_backup.csv'));
    document.getElementById('xlsx-export-btn').addEventListener('click', () => App.exportTableToXLSX('student_records_backup.xlsx'));
    document.getElementById('backup-download-btn').addEventListener('click', App.downloadFullBackup);
    document.getElementById('backup-restore-btn').addEventListener('click', App.openBackupRestore);
    document.getElementById('backup-file-input').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) App.handleBackupRestoreFile(file);
    });

    // Grading sheet
    document.getElementById('gs-subject').addEventListener('change', () => { App.gsPrefillDetails(); App.updateGradingSheetPreview(); });
    document.getElementById('gs-section').addEventListener('change', App.updateGradingSheetPreview);
    document.getElementById('gs-sort').addEventListener('change', App.updateGradingSheetPreview);
    document.getElementById('gs-semester').addEventListener('change', App.updateGradingSheetPreview);
    document.getElementById('gs-display-subject').addEventListener('input', App.debounce(App.updateGradingSheetPreview, 300));
    document.getElementById('gs-display-desc').addEventListener('input', App.debounce(App.updateGradingSheetPreview, 300));
    document.getElementById('gs-display-sy').addEventListener('input', App.debounce(App.updateGradingSheetPreview, 300));
    document.getElementById('gs-print-btn').addEventListener('click', App.printGradingSheets);

    // Sidebar special tab wiring
    document.querySelector('[data-tab="sections"]').addEventListener('click', () => App.renderSectionsList());
    document.querySelector('[data-tab="class-record"]').addEventListener('click', async () => { await App.populateClassRecordFilters(); App.loadClassRecord(); });

    // Profile tab
    const profileSaveBtn = document.getElementById('profile-save-name-btn');
    if (profileSaveBtn) profileSaveBtn.addEventListener('click', App.saveProfileName);
    const profilePwBtn = document.getElementById('profile-change-pw-btn');
    if (profilePwBtn) profilePwBtn.addEventListener('click', App.changeMyPassword);

    // Walkthrough replay
    const replayTourBtn = document.getElementById('profile-replay-tour-btn');
    if (replayTourBtn) replayTourBtn.addEventListener('click', () => {
      if (App.startWalkthrough) App.startWalkthrough(true);
    });
  }

  function wireStudentEvents() {
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
      App.showScreen(state.currentTeacher ? 'admin' : 'student');
      if (!state.currentTeacher) {
        App.renderStudentDashboard();
      }
    });
    
    document.getElementById('print-breakdown-btn')?.addEventListener('click', () => window.print());
  }

  function hideBootScreen() {
    const boot = document.getElementById('boot-screen');
    if (boot) boot.classList.add('hidden-screen');
  }

  async function boot() {
    App.initScreens();
    state.sessionToken = App.newSessionToken();

    registerServiceWorker();
    setupPwaInstall();
    wireLoginEvents();
    wireAdminEvents();
    wireStudentEvents();

    let restored = false;
    try { restored = await App.restoreSession(); } catch (e) { console.warn("Restore session error:", e); }

    if (restored) {
      hideBootScreen();
      App.fetchSubjects().then(function () { if (App.state.currentTeacher) App.loadAdminDashboard(); });
    } else {
      App.setLoginRole('student');
      hideBootScreen();
      App.showScreen('login');
      App.fetchSubjects();
      App.fetchAllSectionsForDropdowns();
    }

    const sidebar = document.getElementById('admin-sidebar');
    if (sidebar) sidebar.classList.remove('collapsed');

    if (typeof App.resetSubjectForm === 'function') App.resetSubjectForm();
    if (typeof App.resetSectionForm === 'function') App.resetSectionForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.App);