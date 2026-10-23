// js/walkthrough.js — First-login onboarding tour for teachers
(function (App) {
  'use strict';

  const state = App.state;

  const OVERLAY_ID = 'walkthrough-overlay';
  const SPOTLIGHT_ID = 'walkthrough-spotlight';
  const TOOLTIP_ID = 'walkthrough-tooltip';

  let steps = [];
  let currentIndex = 0;
  let active = false;
  let resizeHandler = null;

  function buildSteps() {
    const isSuper = state.currentTeacher && state.currentTeacher.role === 'super_admin';

    if (isSuper) {
      return [
        { target: null, title: '👋 Welcome, Super Admin!', body: 'You have full access to the portal. Let me walk you through the key features in about a minute.' },
        { target: '[data-tab="sections"]',     title: '🏫 Sections',          body: 'Start here. Create class sections like BSIT 1A or BSIT 1B. Students can\'t be approved without a section.' },
        { target: '[data-tab="subjects"]',     title: '📚 Subjects & Weights', body: 'Create subjects and set grading weights. Category weights must total 100%, and quarter weights must total 100% too.' },
        { target: '[data-tab="roster"]',       title: '👥 Student Roster',     body: 'Your student pool. Add students one by one, import in bulk, and enroll them in subjects.' },
        { target: '[data-tab="registrations"]',title: '📝 Registrations',      body: 'When teachers request new students, they queue up here for your approval.' },
        { target: '[data-tab="teachers"]',     title: '👨‍🏫 Teachers',           body: 'Approve new teachers, reset passwords, or promote someone to Super Admin.' },
        { target: '[data-tab="class-record"]', title: '📓 Class Record',       body: 'Your daily grading tool. Add assessments per category and enter scores. Tab key saves each cell instantly.' },
        { target: '[data-tab="grades"]',       title: '📊 Grade Book',         body: 'View final quarter grades. Click any grade to see its breakdown, or use Manage to edit manually.' },
        { target: '[data-tab="grading-sheet"]',title: '🖨️ Grading Sheets',     body: 'Print official grade sheets ready for submission.' },
        { target: '[data-tab="analytics"]',    title: '📈 Analytics',          body: 'Track class performance and spot at-risk students early.' },
        { target: '[data-tab="import"]',       title: '⚡ Import & Backup',     body: 'Download full data backups here. Do this before any major change.' },
        { target: '[data-tab="profile"]',      title: '👤 My Profile',         body: 'Your account details live here. You can update your display name, change your password, and replay this tour anytime.' },
        { target: null, title: '🎉 You\'re all set!', body: 'Now get started by creating your first section. You can replay this tour from My Profile whenever you need a refresher.' }
      ];
    }

    return [
      { target: null, title: '👋 Welcome!', body: 'Your teacher account is active. Here\'s a quick tour of what you can do.' },
      { target: '[data-tab="subjects"]',     title: '📚 Subjects & Weights', body: 'Create your own subjects with grading weights. Category and quarter weights must each total 100%.' },
      { target: '[data-tab="roster"]',       title: '👥 Student Roster',     body: 'Add students here. When you add one, they go to the Admin\'s request queue for approval.' },
      { target: '[data-tab="class-record"]', title: '📓 Class Record',       body: 'Your daily grading tool. Add assessments and enter scores. Tab key saves each cell instantly.' },
      { target: '[data-tab="grades"]',       title: '📊 Grade Book',         body: 'View final quarter grades. Click a grade to see its breakdown, or Manage to edit manually.' },
      { target: '[data-tab="grading-sheet"]',title: '🖨️ Grading Sheets',     body: 'Print official grade sheets ready for submission.' },
      { target: '[data-tab="analytics"]',    title: '📈 Analytics',          body: 'Track class performance and spot at-risk students.' },
      { target: '[data-tab="import"]',       title: '⚡ Import & Backup',     body: 'Download full data backups here.' },
      { target: '[data-tab="profile"]',      title: '👤 My Profile',         body: 'Your account details live here. Update your display name, change your password, or replay this tour anytime.' },
      { target: null, title: '🎉 You\'re ready!', body: 'Start by creating a subject, then add students. You can replay this tour from My Profile whenever you need it.' }
    ];
  }

  function ensureSidebarOpen() {
    const sidebar = document.getElementById('admin-sidebar');
    if (!sidebar) return;
    if (window.innerWidth < 768 && !sidebar.classList.contains('mobile-open')) {
      App.toggleSidebar();
    }
  }

  function ensureSidebarClosed() {
    const sidebar = document.getElementById('admin-sidebar');
    if (!sidebar) return;
    if (window.innerWidth < 768 && sidebar.classList.contains('mobile-open')) {
      App.toggleSidebar();
    }
  }

  function positionTooltip(tooltip, targetRect) {
    tooltip.style.transform = 'none';
    tooltip.style.top = '';
    tooltip.style.left = '';

    requestAnimationFrame(() => {
      const tipRect = tooltip.getBoundingClientRect();
      const margin = 16;

      let left = targetRect.right + margin;
      let top  = targetRect.top + targetRect.height / 2 - tipRect.height / 2;

      if (left + tipRect.width > window.innerWidth - 8) {
        left = targetRect.left - tipRect.width - margin;
      }
      if (left < 8) left = 8;
      if (top < 8) top = 8;
      if (top + tipRect.height > window.innerHeight - 8) {
        top = window.innerHeight - tipRect.height - 8;
      }

      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
    });
  }

  function renderCurrentStep() {
    if (!active) return;
    const step = steps[currentIndex];
    if (!step) return App.endWalkthrough(true);

    const overlay   = document.getElementById(OVERLAY_ID);
    const spotlight = document.getElementById(SPOTLIGHT_ID);
    const tooltip   = document.getElementById(TOOLTIP_ID);
    if (!overlay || !spotlight || !tooltip) return;

    if (step.target) ensureSidebarOpen();
    else ensureSidebarClosed();

    const waitMs = step.target && window.innerWidth < 768 ? 350 : 40;

    setTimeout(() => {
      if (!active) return;

      if (step.target) {
        const el = document.querySelector(step.target);
        if (!el) { currentIndex++; return renderCurrentStep(); }

        const rect = el.getBoundingClientRect();
        const pad = 8;
        spotlight.style.display = 'block';
        spotlight.style.top    = (rect.top - pad) + 'px';
        spotlight.style.left   = (rect.left - pad) + 'px';
        spotlight.style.width  = (rect.width + pad * 2) + 'px';
        spotlight.style.height = (rect.height + pad * 2) + 'px';

        positionTooltip(tooltip, rect);
      } else {
        spotlight.style.display = 'none';
        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
      }

      const total = steps.length;
      const stepNum = currentIndex + 1;
      const isLast = currentIndex === total - 1;

      tooltip.innerHTML =
        '<div class="walkthrough-tooltip-inner">' +
          '<div class="walkthrough-tooltip-title">' + App.esc(step.title) + '</div>' +
          '<div class="walkthrough-tooltip-body">' + App.esc(step.body) + '</div>' +
          '<div class="walkthrough-tooltip-footer">' +
            '<div class="walkthrough-progress">' + stepNum + ' / ' + total + '</div>' +
            '<div class="walkthrough-buttons">' +
              '<button type="button" data-tour="skip" class="walkthrough-btn walkthrough-btn-ghost">Skip</button>' +
              (currentIndex > 0 ? '<button type="button" data-tour="back" class="walkthrough-btn walkthrough-btn-ghost">Back</button>' : '') +
              '<button type="button" data-tour="next" class="walkthrough-btn walkthrough-btn-primary">' +
                (isLast ? 'Finish' : 'Next →') +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      tooltip.querySelector('[data-tour="skip"]').onclick = (e) => { e.stopPropagation(); App.endWalkthrough(true); };
      tooltip.querySelector('[data-tour="next"]').onclick = (e) => {
        e.stopPropagation();
        if (!isLast) { currentIndex++; renderCurrentStep(); }
        else App.endWalkthrough(true);
      };
      const back = tooltip.querySelector('[data-tour="back"]');
      if (back) back.onclick = (e) => {
        e.stopPropagation();
        if (currentIndex > 0) { currentIndex--; renderCurrentStep(); }
      };
    }, waitMs);
  }

  App.startWalkthrough = function (force) {
    if (!state.currentTeacher) return;
    if (!force && state.currentTeacher.hasSeenWalkthrough) return;

    steps = buildSteps();
    currentIndex = 0;
    active = true;

    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'walkthrough-overlay';
      overlay.innerHTML =
        '<div id="' + SPOTLIGHT_ID + '" class="walkthrough-spotlight"></div>' +
        '<div id="' + TOOLTIP_ID + '" class="walkthrough-tooltip" role="dialog" aria-modal="true"></div>';
      document.body.appendChild(overlay);

      overlay.addEventListener('click', (e) => {
        if (e.target.closest('#' + TOOLTIP_ID)) return;
        if (currentIndex < steps.length - 1) { currentIndex++; renderCurrentStep(); }
        else App.endWalkthrough(true);
      });
    }

    overlay.style.display = 'block';

    resizeHandler = App.debounce(renderCurrentStep, 100);
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('scroll', resizeHandler, true);

    renderCurrentStep();
  };

  App.endWalkthrough = function (markSeen) {
    active = false;
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.style.display = 'none';

    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('scroll', resizeHandler, true);
      resizeHandler = null;
    }

    ensureSidebarClosed();

    if (markSeen && state.currentTeacher) {
      state.currentTeacher.hasSeenWalkthrough = true;
      App.apiCall({ action: 'markWalkthroughSeen' }).catch(() => {});
    }
  };

})(window.App);