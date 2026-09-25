(function (App) {
  'use strict';

  const state = App.state;

  let sortDirNo = 1;
  let sortDirName = 1;

  // ---------- Sidebar ----------
  App.toggleSidebar = function () {
    const sidebar = document.getElementById('admin-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (window.innerWidth < 768) {
      const open = sidebar.classList.toggle('mobile-open');
      if (backdrop) {
        if (open) {
          backdrop.classList.remove('hidden', 'pointer-events-none');
          setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
        } else {
          backdrop.classList.add('opacity-0', 'pointer-events-none');
          setTimeout(() => backdrop.classList.add('hidden'), 300);
        }
      }
    } else {
      sidebar.classList.toggle('collapsed');
    }
  };

  App.closeMobileSidebar = function () {
    if (window.innerWidth < 768) {
      const sidebar = document.getElementById('admin-sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar) sidebar.classList.remove('mobile-open');
      if (backdrop) {
        backdrop.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => backdrop.classList.add('hidden'), 300);
      }
    }
  };

  // ---------- Tabs ----------
  App.switchAdminTab = function (tabName, btnElement) {
    document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.add('hidden-screen'));
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.className = "admin-tab-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all hover:bg-slate-800 text-slate-400 hover:text-white";
    });

    const active = document.getElementById('tab-' + tabName);
    if (active) active.classList.remove('hidden-screen');
    if (btnElement) {
      btnElement.className = "admin-tab-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all bg-indigo-600 text-white shadow-md shadow-indigo-600/20";
    }
    App.closeMobileSidebar();

    if (tabName === 'grading-sheet') {
      const sections = [];
      const seen = {};
      state.currentAdminData.forEach(s => {
        if (s.section && !seen[s.section]) { seen[s.section] = true; sections.push(s.section); }
      });
      sections.sort();
      const gsSec = document.getElementById('gs-section');
      if (gsSec) {
        const current = gsSec.value;
        const list = sections.length ? sections : ["Section A", "Section B", "Block 1", "Block 2"];
        gsSec.innerHTML = '<option value="All">All Sections</option>' +
          list.map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');
        if (current) gsSec.value = current;
      }
      App.updateGradingSheetPreview();
    }

    if (tabName === 'analytics') {
      if (App.refreshAnalytics) App.refreshAnalytics();
    }

    if (tabName === 'announcements') {
      if (App.loadAnnouncement) App.loadAnnouncement();
      if (App.loadAnnouncementHistory) App.loadAnnouncementHistory();
    }

    if (tabName === 'registrations') {
      if (App.loadPendingRegistrations) App.loadPendingRegistrations();
    }
  };

  // ---------- Refresh ----------
  App.refreshDashboard = async function () {
    const btn = document.getElementById('refresh-dashboard-btn');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-wait');

    App.invalidateAllCache();
    state.allAdminGradesCache = {};

    try {
      await App.loadAdminDashboard();
      if (App.loadPendingRegistrations) App.loadPendingRegistrations();
      App.showToast("Dashboard refreshed.");
    } catch (e) {
      console.error(e);
      App.showToast("Refresh failed. Try again.", "error");
    } finally {
      btn.classList.remove('opacity-50', 'cursor-wait');
      btn.disabled = false;
    }
  };

  // ---------- Timestamp ----------
  App.updateLastSavedTimestamp = function () {
    const badge = document.getElementById('last-saved-badge');
    const text = document.getElementById('last-saved-text');
    if (!badge || !text) return;
    text.textContent = new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    badge.classList.remove('hidden');
    badge.classList.add('flex');
  };

  // ---------- Dashboard ----------
  App.loadAdminDashboard = async function () {
    const tbody = document.getElementById('admin-table-body');
    const mobileList = document.getElementById('admin-mobile-card-list');
    const sync = document.getElementById('sync-indicator');

    if (state.availableSubjects.length === 0) {
      tbody.innerHTML = '<tr><td class="p-8 text-center text-slate-400 font-bold" colspan="9">Please add a subject to start managing students.</td></tr>';
      mobileList.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold bg-white rounded-2xl border border-slate-100">Please add a subject to start managing students.</div>';
      return;
    }

    const key = App.cacheKey(state.activeAdminSubject);
    const cached = sessionStorage.getItem(key);
    const myReq = ++state.reqSeq;

    if (cached) {
      try {
        state.currentAdminData = JSON.parse(cached);
        App.populateSectionFilter();
        App.updateSummaryMetrics(state.currentAdminData);
        App.applyAdminFilters();
        if (sync) { sync.classList.remove('hidden'); sync.classList.add('flex'); }
      } catch (e) { console.warn("Cache read error", e); }
    } else {
      const skeleton = '<tr class="animate-pulse border-b border-slate-100">' +
        '<td class="p-4"><div class="h-4 bg-slate-200 rounded w-20"></div></td>' +
        '<td class="p-4"><div class="h-4 bg-slate-200 rounded w-32 mb-1"></div><div class="h-3 bg-slate-100 rounded w-24"></div></td>' +
        '<td class="p-4"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>' +
        '<td class="p-4"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>' +
        '<td class="p-4"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>' +
        '<td class="p-4"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>' +
        '<td class="p-4"><div class="h-5 bg-slate-300 rounded w-10 mx-auto"></div></td>' +
        '<td class="p-4"><div class="h-5 bg-slate-200 rounded-full w-16 mx-auto"></div></td>' +
        '<td class="p-4"><div class="h-8 bg-slate-200 rounded-lg w-20 mx-auto"></div></td>' +
      '</tr>';
      tbody.innerHTML = skeleton.repeat(6);
      mobileList.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold bg-white rounded-2xl animate-pulse">Loading students...</div>';
    }

    try {
      const res = await App.apiCall({
        action: "getAllGrades",
        pin: state.adminPin,
        subject: state.activeAdminSubject
      }, { retries: 1, timeout: 30000 });

      if (myReq !== state.reqSeq) return;

      if (Array.isArray(res)) {
        sessionStorage.setItem(key, JSON.stringify(res));
        state.currentAdminData = res;
        App.populateSectionFilter();
        App.updateSummaryMetrics(state.currentAdminData);
        App.applyAdminFilters();
        App.updateLastSavedTimestamp();

        const sections = [];
        const seen = {};
        res.forEach(s => {
          if (s.section && !seen[s.section]) { seen[s.section] = true; sections.push(s.section); }
        });
        sections.sort();
        state.sectionsCache = sections;
        App.populateSectionDropdownsUI(sections);

        const gsSec = document.getElementById('gs-section');
        if (gsSec) {
          const current = gsSec.value;
          gsSec.innerHTML = '<option value="All">All Sections</option>' +
            sections.map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');
          if (current) gsSec.value = current;
        }

        if (App.populateAnalyticsFilters) {
          App.populateAnalyticsFilters(state.availableSubjects, sections);
        }
      } else if (!cached) {
        const msg = App.esc(res && res.message || 'Could not load data.');
        tbody.innerHTML = '<tr><td class="p-8 text-center text-rose-500 font-bold" colspan="9">' + msg + '</td></tr>';
        mobileList.innerHTML = '<div class="p-8 text-center text-rose-500 font-bold bg-white rounded-2xl">' + msg + '</div>';
      } else {
        App.showToast("Offline: showing cached data.", "error");
      }
    } catch (error) {
      if (!cached) {
        tbody.innerHTML = '<tr><td class="p-8 text-center text-rose-500 font-bold" colspan="9">Network error.</td></tr>';
        mobileList.innerHTML = '<div class="p-8 text-center text-rose-500 font-bold bg-white rounded-2xl">Network error.</div>';
        App.showToast("Network error loading dashboard.", "error");
      } else {
        App.showToast("Offline: showing cached data.", "error");
      }
    } finally {
      if (sync && myReq === state.reqSeq) { sync.classList.add('hidden'); sync.classList.remove('flex'); }
    }
  };

  App.updateSummaryMetrics = function (data) {
    const total = data.length;
    document.getElementById('stat-total-students').textContent = total;

    if (total === 0) {
      document.getElementById('stat-passing-rate').textContent = "0%";
      document.getElementById('stat-class-average').textContent = "-";
      return;
    }

    let passed = 0;
    data.forEach(s => { if (s.remarks === 'Passed') passed++; });
    document.getElementById('stat-passing-rate').textContent = Math.round((passed / total) * 100) + '%';

    let sum = 0, count = 0;
    data.forEach(s => {
      const f = Number(s.final);
      if (!isNaN(f) && f > 0) { sum += f; count++; }
    });
    document.getElementById('stat-class-average').textContent = count ? Math.round(sum / count) : "-";
  };

  // ---------- Quarter filter ----------
  App.filterByQuarter = function (q) {
    state.activeQuarterFilter = q;
    document.querySelectorAll('.quarter-pill').forEach(btn => {
      btn.className = "quarter-pill px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-600 border border-slate-200 shadow-sm transition-all hover:bg-slate-50";
    });
    const active = document.getElementById('q-pill-' + q);
    if (active) {
      active.className = "quarter-pill px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-sm transition-all";
    }

    ['1st','2nd','3rd','4th'].forEach(qtr => {
      document.querySelectorAll('.col-q-' + qtr).forEach(el => {
        if (q === 'All' || q === qtr) el.classList.remove('hidden');
        else el.classList.add('hidden');
      });
    });
    App.applyAdminFilters();
  };

  // ---------- Table render ----------
  App.renderAdminTable = function (data) {
    const tbody = document.getElementById('admin-table-body');
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td class="p-8 text-center text-slate-400 font-bold" colspan="9">No students found for this subject.</td></tr>';
      return;
    }

    const qCell = (student, quarter, val) => {
      const hidden = (state.activeQuarterFilter !== 'All' && state.activeQuarterFilter !== quarter) ? 'hidden' : '';
      return '<td class="p-4 text-center col-q col-q-' + quarter + ' ' + hidden + '">' +
        '<button type="button" data-quarter="' + quarter + '" class="text-indigo-600 font-bold hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1" aria-label="View ' + quarter + ' quarter breakdown">' +
          (App.esc(val) || '-') +
        '</button></td>';
    };

    tbody.innerHTML = data.map(student =>
      '<tr class="hover:bg-indigo-50/30 transition-colors group" data-id="' + App.esc(student.studentNumber) + '" data-subject="' + App.esc(student.subject) + '">' +
        '<td class="p-4 font-semibold text-slate-600">' + App.esc(student.studentNumber) + '</td>' +
        '<td class="p-4">' +
          '<div class="font-bold text-slate-800">' + App.esc(student.name) + '</div>' +
          '<div class="text-[11px] font-bold text-slate-400 mt-0.5">' + App.esc(student.section) + ' &bull; <span class="text-indigo-500">' + App.esc(student.subject) + '</span></div>' +
        '</td>' +
        qCell(student, '1st', student.q1) +
        qCell(student, '2nd', student.q2) +
        qCell(student, '3rd', student.q3) +
        qCell(student, '4th', student.q4) +
        '<td class="p-4 text-center font-black">' + (App.esc(student.final) || '-') + '</td>' +
        '<td class="p-4">' + App.remarksBadge(student.remarks) + '</td>' +
        '<td class="p-4 text-center">' +
          '<button type="button" data-action="manage" class="text-indigo-600 bg-indigo-50 px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-600 hover:text-white transition-colors border border-indigo-100">Manage</button>' +
        '</td>' +
      '</tr>'
    ).join('');
  };

  App.renderAdminMobileCards = function (data) {
    const list = document.getElementById('admin-mobile-card-list');
    if (data.length === 0) {
      list.innerHTML = '<div class="p-6 text-center text-slate-400 font-bold bg-white rounded-2xl border border-slate-100">No students found.</div>';
      return;
    }

    list.innerHTML = data.map((student, index) => {
      const qBox = (quarter, label, val) => {
        const hidden = (state.activeQuarterFilter !== 'All' && state.activeQuarterFilter !== quarter) ? 'hidden' : '';
        return '<button type="button" data-quarter="' + quarter + '" class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 ' + hidden + ' hover:bg-indigo-50 transition-colors text-left w-full" aria-label="View ' + quarter + ' breakdown">' +
          '<div class="text-[10px] font-bold text-slate-400 uppercase">' + label + '</div>' +
          '<div class="text-sm font-black text-slate-700 mt-0.5">' + (App.esc(val) || '-') + '</div>' +
        '</button>';
      };

      return '<div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 transition-all" data-id="' + App.esc(student.studentNumber) + '" data-subject="' + App.esc(student.subject) + '" data-idx="' + index + '">' +
        '<div class="flex items-center justify-between cursor-pointer select-none" data-action="toggle">' +
          '<div class="overflow-hidden pr-2">' +
            '<div class="text-xs font-bold text-slate-400">ID: ' + App.esc(student.studentNumber) + '</div>' +
            '<div class="text-base font-bold text-slate-800 truncate">' + App.esc(student.name) + '</div>' +
            '<div class="text-[11px] font-semibold text-indigo-500 mt-0.5">' + App.esc(student.section) + ' &bull; ' + App.esc(student.subject) + '</div>' +
          '</div>' +
          '<div class="flex items-center gap-3 shrink-0">' +
            '<div class="text-right">' +
              '<div class="text-[10px] uppercase font-bold text-slate-400">Final</div>' +
              '<div class="text-lg font-black text-indigo-600">' + (App.esc(student.final) || '-') + '</div>' +
            '</div>' +
            '<div id="mobile-arrow-' + index + '" class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 transition-transform duration-200">' +
              '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="mobile-drawer-' + index + '" class="hidden pt-4 mt-4 border-t border-slate-100">' +
          '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">' +
            qBox('1st', '1st Qtr', student.q1) +
            qBox('2nd', '2nd Qtr', student.q2) +
            qBox('3rd', '3rd Qtr', student.q3) +
            qBox('4th', '4th Qtr', student.q4) +
          '</div>' +
          '<div class="flex items-center justify-between pt-2">' +
            '<div>' + App.remarksBadge(student.remarks) + '</div>' +
            '<button type="button" data-action="manage" class="text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-600 hover:text-white transition-colors border border-indigo-100 shadow-sm">Manage Grades</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  };

  App.toggleMobileCard = function (index) {
    const drawer = document.getElementById('mobile-drawer-' + index);
    const arrow = document.getElementById('mobile-arrow-' + index);
    if (!drawer) return;
    if (drawer.classList.contains('hidden')) {
      drawer.classList.remove('hidden');
      arrow.style.transform = 'rotate(180deg)';
      arrow.classList.add('bg-indigo-50', 'text-indigo-600');
    } else {
      drawer.classList.add('hidden');
      arrow.style.transform = 'rotate(0deg)';
      arrow.classList.remove('bg-indigo-50', 'text-indigo-600');
    }
  };

  // ---------- Filters ----------
  App.applyAdminFilters = function () {
    const search = (document.getElementById('admin-search').value || '').toLowerCase().trim();
    const sec = document.getElementById('section-filter').value;
    const filtered = state.currentAdminData.filter(s =>
      (s.name.toLowerCase().indexOf(search) !== -1 ||
       String(s.studentNumber).indexOf(search) !== -1) &&
      (sec === "All" || s.section === sec)
    );
    App.updateSummaryMetrics(filtered);
    App.renderAdminTable(filtered);
    App.renderAdminMobileCards(filtered);
  };

  App.populateSectionFilter = function () {
    const sections = [];
    const seen = {};
    state.currentAdminData.forEach(s => {
      if (s.section && !seen[s.section]) { seen[s.section] = true; sections.push(s.section); }
    });
    sections.sort();
    document.getElementById('section-filter').innerHTML =
      '<option value="All">All Sections</option>' +
      sections.map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');
  };

  // ---------- Sorting ----------
  App.sortByStudentNo = function () {
    sortDirNo *= -1;
    state.currentAdminData.sort((a, b) => {
      const x = String(a.studentNumber).toLowerCase();
      const y = String(b.studentNumber).toLowerCase();
      return x < y ? -1 * sortDirNo : (x > y ? 1 * sortDirNo : 0);
    });
    document.getElementById('student-no-sort-icon').innerHTML = sortDirNo === 1 ? '&#8593;' : '&#8595;';
    document.getElementById('name-sort-icon').innerHTML = '&#8597;';
    App.applyAdminFilters();
  };

  App.sortByName = function () {
    sortDirName *= -1;
    state.currentAdminData.sort((a, b) => {
      const x = String(a.name).toLowerCase();
      const y = String(b.name).toLowerCase();
      return x < y ? -1 * sortDirName : (x > y ? 1 * sortDirName : 0);
    });
    document.getElementById('name-sort-icon').innerHTML = sortDirName === 1 ? '&#8593;' : '&#8595;';
    document.getElementById('student-no-sort-icon').innerHTML = '&#8597;';
    App.applyAdminFilters();
  };

  // ---------- Slide panel ----------
  App.openSlidePanel = function (studentNo, subject) {
    let student = null;
    for (let i = 0; i < state.currentAdminData.length; i++) {
      const s = state.currentAdminData[i];
      if (String(s.studentNumber) === String(studentNo) && s.subject === subject) {
        student = s;
        break;
      }
    }
    if (!student) return;

    state.activeManageStudentId = studentNo;
    state.activeManageSubject = subject;

    document.getElementById('panel-old-student-id').value = student.studentNumber;
    document.getElementById('panel-student-id').value = student.studentNumber;
    document.getElementById('panel-old-student-subject').value = subject;
    document.getElementById('panel-student-name').value = student.name;
    document.getElementById('panel-student-section').value = student.section;
    document.getElementById('panel-student-subject').innerHTML =
      state.availableSubjects.map(s =>
        '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');
    document.getElementById('panel-student-subject').value = subject;
    document.getElementById('panel-subject-label').textContent = state.activeManageSubject;

    ['q1','q2','q3','q4'].forEach(q => {
      document.getElementById('panel-' + q).value = student[q] || '';
    });
    document.getElementById('panel-header-name').textContent = student.name;
    document.getElementById('panel-header-id').textContent = 'ID: ' + student.studentNumber;

    const b = document.getElementById('slide-panel-backdrop');
    const p = document.getElementById('slide-panel');
    b.classList.remove('hidden-screen');
    b.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      b.classList.remove('opacity-0');
      p.classList.remove('translate-x-full');
    }, 10);
    p.focus();
  };

  App.closeSlidePanel = function () {
    const p = document.getElementById('slide-panel');
    const b = document.getElementById('slide-panel-backdrop');
    p.classList.add('translate-x-full');
    b.classList.add('opacity-0');
    b.setAttribute('aria-hidden', 'true');
    setTimeout(() => b.classList.add('hidden-screen'), 300);
  };

  App.savePanelInfo = async function () {
    const btn = document.getElementById('panel-save-info-btn');
    const original = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const newId = document.getElementById('panel-student-id').value.trim();
    const oldId = document.getElementById('panel-old-student-id').value;
    const newSubject = document.getElementById('panel-student-subject').value;
    const oldSubject = document.getElementById('panel-old-student-subject').value;

    const newData = {
      studentNumber: newId,
      name: document.getElementById('panel-student-name').value.trim(),
      section: document.getElementById('panel-student-section').value,
      subject: newSubject
    };

    const res = await App.apiCall({
      action: "updateStudentInfo", pin: state.adminPin,
      oldStudentNumber: oldId, oldSubject: oldSubject, newData: newData
    }, { retries: 1 });

    if (res.success) {
      App.invalidateActiveCache();
      await App.loadAdminDashboard();
      state.activeManageStudentId = newId;
      state.activeManageSubject = newSubject;
      document.getElementById('panel-old-student-id').value = newId;
      document.getElementById('panel-old-student-subject').value = newSubject;
      document.getElementById('panel-subject-label').textContent = newSubject;
      App.showToast("Profile updated.");
      App.updateLastSavedTimestamp();
      btn.innerText = "Update Profile & Subject";
      btn.disabled = false;
      return;
    }
    App.showToast(res.message || "Failed to save.", "error");
    btn.innerText = original;
    btn.disabled = false;
  };

  App.savePanelGrades = async function () {
    const btn = document.getElementById('panel-save-grades-btn');
    const original = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const grades = {
      q1: document.getElementById('panel-q1').value,
      q2: document.getElementById('panel-q2').value,
      q3: document.getElementById('panel-q3').value,
      q4: document.getElementById('panel-q4').value
    };

    const res = await App.apiCall({
      action: "saveGrades", pin: state.adminPin,
      studentNumber: state.activeManageStudentId,
      subject: state.activeManageSubject,
      grades: grades
    }, { retries: 1 });

    if (res.success) {
      App.invalidateActiveCache();
      await App.loadAdminDashboard();
      App.showToast("Grades saved.");
      App.updateLastSavedTimestamp();
      btn.innerText = "Save Grades";
      btn.disabled = false;
      return;
    }
    App.showToast(res.message || "Failed to save.", "error");
    btn.innerText = original;
    btn.disabled = false;
  };

  App.deleteStudentFromPanel = async function () {
    if (!confirm("Erase this student profile completely? This cannot be undone.")) return;
    App.invalidateAllCache();
    const res = await App.apiCall({
      action: "deleteStudent", pin: state.adminPin,
      studentNumber: state.activeManageStudentId
    }, { retries: 1 });

    if (res.success) {
      App.showToast("Student deleted.");
      App.updateLastSavedTimestamp();
      await App.loadAdminDashboard();
      App.closeSlidePanel();
    } else {
      App.showToast(res.message || "Delete failed.", "error");
    }
  };

  // ---------- Add student ----------
  App.openAddStudentModal = function () {
    document.getElementById('new-student-id').value = '';
    document.getElementById('new-student-name').value = '';
    document.getElementById('new-student-section').value = '';
    App.openModal(document.getElementById('add-student-modal'));
  };

  App.closeAddStudentModal = function () {
    App.closeModal(document.getElementById('add-student-modal'));
  };

  App.saveNewStudent = async function () {
    const id = document.getElementById('new-student-id').value.trim();
    const name = document.getElementById('new-student-name').value.trim();
    const sec = document.getElementById('new-student-section').value;
    const subjects = Array.prototype.slice.call(
      document.querySelectorAll('#add-subject-checkboxes input:checked')
    ).map(cb => cb.value);

    if (!id || !name || !sec || subjects.length === 0) {
      App.showToast("Fill all fields and select a section and subject.", "error");
      return;
    }

    const btn = document.getElementById('save-new-student-btn');
    const original = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const res = await App.apiCall({
      action: "addStudent", pin: state.adminPin,
      studentData: { studentNumber: id, name: name, section: sec, enrolledSubjects: subjects }
    }, { retries: 1 });

    if (res.success) {
      App.showToast("Student " + name + " enrolled.");
      App.closeAddStudentModal();
      App.invalidateActiveCache();
      await App.loadAdminDashboard();
      App.updateLastSavedTimestamp();
    } else {
      App.showToast(res.message || "Failed to save new student.", "error");
    }
    btn.innerText = original;
    btn.disabled = false;
  };

})(window.App);