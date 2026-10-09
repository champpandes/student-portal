(function (App) {
  'use strict';

  const state = App.state;

  // ============================================================
  // Fetch + populate
  // ============================================================
  App.fetchSubjects = async function () {
    const CACHE_KEY = 'sp_subjects_cache';
    const TTL_MS = 5 * 60 * 1000;

    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && (Date.now() - cached.cachedAt) < TTL_MS) {
          applySubjectPayload(cached);
          App._refreshSubjectsInBackground(CACHE_KEY);
          return;
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const res = await App.apiCall({ action: "getSubjects" });
      if (res.success) {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          subjects: res.subjects || [],
          descriptions: res.descriptions || {},
          weights: res.weights || {},
          categories: res.categories || {},
          quarterWeights: res.quarterWeights || {},
          cachedAt: Date.now()
        }));
        applySubjectPayload(res);
      }
    } catch (err) {
      console.error("Could not fetch subjects.", err);
      App.showToast("Could not load subjects. Please refresh.", "error");
      const adminFilter = document.getElementById('admin-subject-filter');
      if (adminFilter) adminFilter.innerHTML = '<option>Error Connecting</option>';
    }
  };

  function applySubjectPayload(payload) {
    state.availableSubjects = payload.subjects || [];
    state.subjectDescriptions = payload.descriptions || {};
    state.subjectWeights = payload.weights || {};
    state.subjectCategories = payload.categories || {};
    state.subjectQuarterWeights = payload.quarterWeights || {};
    App.populateSubjectUIs();
    App.renderSubjectsListUI();
  }

  App._refreshSubjectsInBackground = async function (cacheKey) {
    try {
      const res = await App.apiCall({ action: "getSubjects" });
      if (res && res.success) {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          subjects: res.subjects || [],
          descriptions: res.descriptions || {},
          weights: res.weights || {},
          categories: res.categories || {},
          quarterWeights: res.quarterWeights || {},
          cachedAt: Date.now()
        }));
      }
    } catch (e) { /* silent */ }
  };

  // ============================================================
  // Populate dropdowns
  // ============================================================
  App.populateSubjectUIs = function () {
    const adminFilter = document.getElementById('admin-subject-filter');
    const importSubject = document.getElementById('import-subject');
    const addCheckboxes = document.getElementById('add-subject-checkboxes');
    const regCheckboxes = document.getElementById('reg-subject-checkboxes');
    const gsSubject = document.getElementById('gs-subject');

    if (state.availableSubjects.length === 0) {
      if (adminFilter) adminFilter.innerHTML = '<option value="All">No Subjects Added Yet</option>';
      if (importSubject) importSubject.innerHTML = '<option>No Subjects Available</option>';
      if (gsSubject) gsSubject.innerHTML = '<option>No Subjects Available</option>';
      if (addCheckboxes) addCheckboxes.innerHTML = '<span class="text-sm font-bold text-rose-500">Please add a subject first.</span>';
      if (regCheckboxes) regCheckboxes.innerHTML = '<span class="text-sm font-bold text-rose-500">No classes available.</span>';
      return;
    }

    const optionsHTML = state.availableSubjects
      .map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');

    const checkboxesHTML = state.availableSubjects
      .map(s => '<label class="font-medium text-sm text-slate-600 flex items-center cursor-pointer">' +
        '<input type="checkbox" value="' + App.esc(s) + '" class="mr-1.5 accent-indigo-600 w-4 h-4" checked> ' + App.esc(s) +
      '</label>').join('');

    if (adminFilter) {
      adminFilter.innerHTML = '<option value="All">All Subjects</option>' + optionsHTML;
      if (!state.activeAdminSubject && state.availableSubjects.length > 0) {
        state.activeAdminSubject = state.availableSubjects[0];
      }
      if (state.activeAdminSubject && state.availableSubjects.indexOf(state.activeAdminSubject) === -1) {
        state.activeAdminSubject = state.availableSubjects[0] || "All";
      }
      adminFilter.value = state.activeAdminSubject || "All";
    }
    if (importSubject) importSubject.innerHTML = optionsHTML;
    if (gsSubject) {
      gsSubject.innerHTML = optionsHTML;
      App.updateGradingSheetPreview();
    }
    if (addCheckboxes) addCheckboxes.innerHTML = checkboxesHTML;
    if (regCheckboxes) regCheckboxes.innerHTML = checkboxesHTML;

    if (App.populateAnalyticsFilters) {
      App.populateAnalyticsFilters(state.availableSubjects, state.sectionsCache || []);
    }
  };

  App.populateSectionDropdownsUI = function (sections) {
    const fallback = ["Section A", "Section B", "Block 1", "Block 2"];
    const list = (sections && sections.length > 0) ? sections : fallback;
    const optionsHTML = list.map(sec =>
      '<option value="' + App.esc(sec) + '">' + App.esc(sec) + '</option>').join('');

    const regSec = document.getElementById('reg-student-section');
    const addSec = document.getElementById('new-student-section');
    const panelSec = document.getElementById('panel-student-section');

    if (regSec) regSec.innerHTML = '<option value="">Select section...</option>' + optionsHTML;
    if (addSec) addSec.innerHTML = '<option value="">Select section...</option>' + optionsHTML;
    if (panelSec) panelSec.innerHTML = optionsHTML;

    if (sections && sections.length > 0) {
      state.sectionsCache = sections;
      if (App.populateAnalyticsFilters) {
        App.populateAnalyticsFilters(state.availableSubjects, sections);
      }
    }
  };

  App.fetchAllSectionsForDropdowns = async function () {
    const CACHE_KEY = 'sp_sections_cache';
    const TTL_MS = 5 * 60 * 1000;

    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && (Date.now() - cached.cachedAt) < TTL_MS) {
          state.sectionsCache = cached.sections || [];
          App.populateSectionDropdownsUI(state.sectionsCache);
          return;
        }
      }
    } catch (e) { /* fall through */ }

    try {
      const res = await App.apiCall({ action: "getSections" });
      const sections = Array.isArray(res) ? res : (res && res.sections ? res.sections : []);
      state.sectionsCache = sections;
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ sections, cachedAt: Date.now() }));
      App.populateSectionDropdownsUI(sections);
    } catch (e) {
      console.warn("Could not load sections; using fallback.", e);
      App.populateSectionDropdownsUI([]);
    }
  };

  // ============================================================
  // Render subject list
  // ============================================================
  App.renderSubjectsListUI = function () {
    const listUI = document.getElementById('subjects-list-ui');
    if (!listUI) return;

    if (state.availableSubjects.length === 0) {
      listUI.innerHTML = '<li class="p-8 text-center text-slate-400 text-sm font-medium">No subjects found in curriculum.</li>';
      return;
    }

    listUI.innerHTML = state.availableSubjects.map(s => {
      const desc = state.subjectDescriptions[s] || '';
      const cats = state.subjectCategories[s] || [];
      const qw = state.subjectQuarterWeights[s] || { "1st": 25, "2nd": 25, "3rd": 25, "4th": 25 };
      const catLine = cats.map(c => App.esc(c.name) + ' ' + c.weight + '%').join(' · ');
      const qwLine = '1st ' + qw['1st'] + '% · 2nd ' + qw['2nd'] + '% · 3rd ' + qw['3rd'] + '% · 4th ' + qw['4th'] + '%';

      return '<li class="px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-slate-50/60 transition-colors">' +
        '<div class="overflow-hidden pr-2">' +
          '<div class="font-bold text-slate-800 text-sm">' + App.esc(s) + '</div>' +
          '<div class="text-xs text-slate-500 font-medium mt-0.5">Description: <span class="italic text-indigo-600 font-semibold">' + (App.esc(desc) || 'None assigned') + '</span></div>' +
          '<div class="text-[11px] text-slate-500 mt-1">Categories: ' + (catLine || '<em>none</em>') + '</div>' +
          '<div class="text-[11px] text-slate-400 mt-0.5">Quarters: ' + qwLine + '</div>' +
        '</div>' +
        '<div class="flex items-center gap-2 shrink-0">' +
          '<button type="button" data-action="edit" data-subject="' + App.esc(s) + '" class="px-3.5 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 rounded-lg text-xs font-bold transition-colors border border-slate-200/60">Edit</button>' +
          '<button type="button" data-action="delete" data-subject="' + App.esc(s) + '" class="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-bold transition-colors border border-rose-100">Delete</button>' +
        '</div>' +
      '</li>';
    }).join('');
  };

  // ============================================================
  // Category editor
  // ============================================================
  App.addCategoryRow = function (name, weight) {
    const list = document.getElementById('category-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.setAttribute('data-category-row', '');
    row.innerHTML =
      '<input type="text" data-cat-name placeholder="Category name" value="' + App.esc(name || '') + '" ' +
             'class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-600">' +
      '<input type="number" data-cat-weight placeholder="0" value="' + (weight === undefined ? '' : weight) + '" ' +
             'class="w-20 border border-slate-200 rounded-xl px-3 py-2 text-sm text-center font-bold bg-white outline-none focus:border-indigo-500">' +
      '<span class="text-xs font-bold text-slate-400">%</span>' +
      '<button type="button" data-cat-remove class="w-8 h-8 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center font-bold">×</button>';

    list.appendChild(row);
    row.querySelector('[data-cat-remove]').addEventListener('click', () => {
      row.remove();
      App.updateCategoryTotals();
    });
    row.querySelector('[data-cat-weight]').addEventListener('input', App.updateCategoryTotals);
    App.updateCategoryTotals();
  };

  App.updateCategoryTotals = function () {
    const list = document.getElementById('category-list');
    if (!list) return;

    let catSum = 0;
    list.querySelectorAll('[data-cat-weight]').forEach(inp => {
      catSum += Number(inp.value) || 0;
    });
    const catTotal = document.getElementById('cat-total');
    if (catTotal) {
      catTotal.textContent = 'Total: ' + catSum + '%';
      catTotal.className = catSum === 100
        ? 'text-[11px] font-bold text-emerald-600'
        : 'text-[11px] font-bold text-rose-600';
    }

    let qwSum = 0;
    ['qw-1st','qw-2nd','qw-3rd','qw-4th'].forEach(id => {
      const el = document.getElementById(id);
      if (el) qwSum += Number(el.value) || 0;
    });
    const qwTotal = document.getElementById('qw-total');
    if (qwTotal) {
      qwTotal.textContent = 'Total: ' + qwSum + '%';
      qwTotal.className = qwSum === 100
        ? 'text-[11px] font-bold text-emerald-600'
        : 'text-[11px] font-bold text-rose-600';
    }
  };

  App.getCategoriesFromForm = function () {
    const rows = document.querySelectorAll('#category-list [data-category-row]');
    const out = [];
    rows.forEach(row => {
      const name = row.querySelector('[data-cat-name]').value.trim();
      const weight = Number(row.querySelector('[data-cat-weight]').value) || 0;
      if (name) out.push({ name, weight });
    });
    return out;
  };

  App.getQuarterWeightsFromForm = function () {
    return {
      '1st': Number(document.getElementById('qw-1st').value) || 0,
      '2nd': Number(document.getElementById('qw-2nd').value) || 0,
      '3rd': Number(document.getElementById('qw-3rd').value) || 0,
      '4th': Number(document.getElementById('qw-4th').value) || 0
    };
  };

  // ============================================================
  // Edit / Reset subject form
  // ============================================================
  App.prepareEditSubject = function (subjectName) {
    document.getElementById('new-subject-input').value = subjectName;
    document.getElementById('new-subject-desc-input').value = state.subjectDescriptions[subjectName] || '';
    document.getElementById('editing-original-subject').value = subjectName;

    const qw = state.subjectQuarterWeights[subjectName] || { "1st": 25, "2nd": 25, "3rd": 25, "4th": 25 };
    document.getElementById('qw-1st').value = qw['1st'];
    document.getElementById('qw-2nd').value = qw['2nd'];
    document.getElementById('qw-3rd').value = qw['3rd'];
    document.getElementById('qw-4th').value = qw['4th'];

    const list = document.getElementById('category-list');
    list.innerHTML = '';
    const cats = state.subjectCategories[subjectName] || [];
    cats.forEach(c => App.addCategoryRow(c.name, c.weight));
    App.updateCategoryTotals();

    const submit = document.getElementById('subject-submit-btn');
    submit.innerText = "Update Subject";
    submit.className = "bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-md shadow-emerald-600/20 transition-all";
    document.getElementById('subject-cancel-edit-btn').classList.remove('hidden');
    document.getElementById('new-subject-input').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  App.resetSubjectForm = function () {
    document.getElementById('new-subject-input').value = '';
    document.getElementById('new-subject-desc-input').value = '';
    document.getElementById('editing-original-subject').value = '';

    ['qw-1st','qw-2nd','qw-3rd','qw-4th'].forEach(id => {
      document.getElementById(id).value = 25;
    });

    const list = document.getElementById('category-list');
    list.innerHTML = '';
    App.addCategoryRow('Quizzes', 35);
    App.addCategoryRow('Participation', 15);
    App.addCategoryRow('Attendance', 10);
    App.addCategoryRow('Exams', 40);
    App.updateCategoryTotals();

    const submit = document.getElementById('subject-submit-btn');
    submit.innerText = "+ Add Subject";
    submit.className = "bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-md shadow-indigo-600/20 transition-all";
    document.getElementById('subject-cancel-edit-btn').classList.add('hidden');
  };

  // ============================================================
  // Save
  // ============================================================
  App.handleSaveSubject = async function () {
    const btn = document.getElementById('subject-submit-btn');
    const newName = document.getElementById('new-subject-input').value.trim();
    const descVal = document.getElementById('new-subject-desc-input').value.trim();
    const oldName = document.getElementById('editing-original-subject').value;

    if (!newName) { App.showToast("Please enter a subject name.", "error"); return; }

    const categories = App.getCategoriesFromForm();
    if (categories.length === 0) {
      App.showToast("Add at least one category.", "error");
      return;
    }
    const catSum = categories.reduce((a, c) => a + c.weight, 0);
    if (catSum !== 100) {
      App.showToast("Category weights must total 100% (currently " + catSum + "%).", "error");
      return;
    }

    const qw = App.getQuarterWeightsFromForm();
    const qwSum = qw['1st'] + qw['2nd'] + qw['3rd'] + qw['4th'];
    if (qwSum !== 100) {
      App.showToast("Quarter weights must total 100% (currently " + qwSum + "%).", "error");
      return;
    }

    let succeeded = false;

    await App.withButtonLoading(btn, async () => {
      const legacyWeights = {
        quizzes: (categories.find(c => c.name.toLowerCase() === 'quizzes') || {}).weight || 0,
        participation: (categories.find(c => c.name.toLowerCase() === 'participation') || {}).weight || 0,
        attendance: (categories.find(c => c.name.toLowerCase() === 'attendance') || {}).weight || 0,
        exams: (categories.find(c => c.name.toLowerCase() === 'exams') || {}).weight || 0
      };

      const res = await App.apiCall({
        action: "manageSubject",
        pin: state.adminPin,
        subAction: oldName ? "update" : "add",
        oldName: oldName,
        newName: newName,
        subjectName: newName,
        description: descVal,
        weights: legacyWeights,
        categories: categories,
        quarterWeights: qw
      }, { retries: 1 });

      if (!res.success) {
        App.showToast(res.message || "Failed to save subject.", "error");
        return;
      }

      if (res.subjects) state.availableSubjects = res.subjects;
      if (res.descriptions) state.subjectDescriptions = res.descriptions;
      if (res.weights) state.subjectWeights = res.weights;
      if (res.categories) state.subjectCategories = res.categories;
      if (res.quarterWeights) state.subjectQuarterWeights = res.quarterWeights;

      App.populateSubjectUIs();
      App.renderSubjectsListUI();
      App.invalidateAllCache();
      sessionStorage.removeItem('sp_subjects_cache');
      await App.loadAdminDashboard();

      App.showToast(oldName ? "Subject '" + newName + "' updated!" : "Subject '" + newName + "' added!");
      succeeded = true;
    }, { text: 'Saving...' });

    // Reset only after withButtonLoading finishes restoring the button
    if (succeeded) {
      App.resetSubjectForm();
    }
  };

  // ============================================================
  // Delete
  // ============================================================
  App.handleDeleteSubject = async function (name) {
    if (!confirm("WARNING: Deleting '" + name + "' will also delete ALL grades for this subject.\n\nProceed?")) return;

    const list = document.getElementById('subjects-list-ui');
    const btns = list.querySelectorAll('button');
    btns.forEach(b => { b.disabled = true; b.classList.add('opacity-60', 'cursor-wait'); });

    try {
      const res = await App.apiCall({
        action: "manageSubject", pin: state.adminPin, subAction: "delete", subjectName: name
      }, { retries: 1 });

      if (res.success) {
        if (state.activeAdminSubject === name) state.activeAdminSubject = "All";
        if (res.subjects) state.availableSubjects = res.subjects;
        if (res.descriptions) state.subjectDescriptions = res.descriptions;
        if (res.weights) state.subjectWeights = res.weights;
        if (res.categories) state.subjectCategories = res.categories;
        if (res.quarterWeights) state.subjectQuarterWeights = res.quarterWeights;

        App.showToast("Subject '" + name + "' deleted.");
        App.populateSubjectUIs();
        App.renderSubjectsListUI();
        App.invalidateAllCache();
        sessionStorage.removeItem('sp_subjects_cache');
        await App.loadAdminDashboard();
      } else {
        App.showToast(res.message || "Failed to delete subject.", "error");
      }
    } finally {
      // Old buttons were replaced by renderSubjectsListUI; this is defensive
      btns.forEach(b => {
        if (document.contains(b)) {
          b.disabled = false;
          b.classList.remove('opacity-60', 'cursor-wait');
        }
      });
    }
  };

})(window.App);