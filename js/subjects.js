(function (App) {
  'use strict';

  const state = App.state;

  App.fetchSubjects = async function () {
    try {
      const res = await App.apiCall({ action: "getSubjects" });
      if (res.success) {
        state.availableSubjects = res.subjects || [];
        if (res.descriptions) state.subjectDescriptions = res.descriptions;
        if (res.weights) state.subjectWeights = res.weights;
        App.populateSubjectUIs();
        App.renderSubjectsListUI();
      }
    } catch (err) {
      console.error("Could not fetch subjects.", err);
      App.showToast("Could not load subjects. Please refresh.", "error");
      const adminFilter = document.getElementById('admin-subject-filter');
      if (adminFilter) adminFilter.innerHTML = '<option>Error Connecting</option>';
    }
  };

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
      adminFilter.value = state.activeAdminSubject;
    }
    if (importSubject) importSubject.innerHTML = optionsHTML;
    if (gsSubject) {
      gsSubject.innerHTML = optionsHTML;
      App.updateGradingSheetPreview();
    }
    if (addCheckboxes) addCheckboxes.innerHTML = checkboxesHTML;
    if (regCheckboxes) regCheckboxes.innerHTML = checkboxesHTML;

    // Keep the Analytics tab's Subject dropdown in sync.
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

    // Track the latest known section list for other dropdowns.
    if (sections && sections.length > 0) {
      state.sectionsCache = sections;
      if (App.populateAnalyticsFilters) {
        App.populateAnalyticsFilters(state.availableSubjects, sections);
      }
    }
  };

  App.fetchAllSectionsForDropdowns = async function () {
    try {
      const res = await App.apiCall({ action: "getSections" });
      const sections = Array.isArray(res) ? res : (res && res.sections ? res.sections : []);
      App.populateSectionDropdownsUI(sections);
    } catch (e) {
      console.warn("Could not load sections; using fallback.", e);
      App.populateSectionDropdownsUI([]);
    }
  };

  App.renderSubjectsListUI = function () {
    const listUI = document.getElementById('subjects-list-ui');
    if (!listUI) return;

    if (state.availableSubjects.length === 0) {
      listUI.innerHTML = '<li class="p-8 text-center text-slate-400 text-sm font-medium">No subjects found in curriculum.</li>';
      return;
    }

    listUI.innerHTML = state.availableSubjects.map(s => {
      const desc = state.subjectDescriptions[s] || '';
      const w = state.subjectWeights[s] || { quizzes: 35, participation: 15, attendance: 10, exams: 40 };
      return '<li class="px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-slate-50/60 transition-colors">' +
        '<div class="overflow-hidden pr-2">' +
          '<div class="font-bold text-slate-800 text-sm">' + App.esc(s) + '</div>' +
          '<div class="text-xs text-slate-500 font-medium mt-0.5">Description: <span class="italic text-indigo-600 font-semibold">' + (App.esc(desc) || 'None assigned') + '</span></div>' +
          '<div class="text-[11px] text-slate-400 mt-1">Weights: Qz: ' + App.esc(w.quizzes) + '% | Part: ' + App.esc(w.participation) + '% | Att: ' + App.esc(w.attendance) + '% | Exam: ' + App.esc(w.exams) + '%</div>' +
        '</div>' +
        '<div class="flex items-center gap-2 shrink-0">' +
          '<button type="button" data-action="edit" data-subject="' + App.esc(s) + '" class="px-3.5 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 rounded-lg text-xs font-bold transition-colors border border-slate-200/60">Edit</button>' +
          '<button type="button" data-action="delete" data-subject="' + App.esc(s) + '" class="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-bold transition-colors border border-rose-100">Delete</button>' +
        '</div>' +
      '</li>';
    }).join('');
  };

  App.prepareEditSubject = function (subjectName) {
    document.getElementById('new-subject-input').value = subjectName;
    document.getElementById('new-subject-desc-input').value = state.subjectDescriptions[subjectName] || '';
    document.getElementById('editing-original-subject').value = subjectName;

    const w = state.subjectWeights[subjectName] || { quizzes: 35, participation: 15, attendance: 10, exams: 40 };
    document.getElementById('weight-quizzes').value = w.quizzes;
    document.getElementById('weight-participation').value = w.participation;
    document.getElementById('weight-attendance').value = w.attendance;
    document.getElementById('weight-exams').value = w.exams;

    const submit = document.getElementById('subject-submit-btn');
    submit.innerText = "Update Subject";
    submit.className = "w-full sm:w-auto bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-md transition-all whitespace-nowrap";
    document.getElementById('subject-cancel-edit-btn').classList.remove('hidden');
    document.getElementById('new-subject-input').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  App.resetSubjectForm = function () {
    document.getElementById('new-subject-input').value = '';
    document.getElementById('new-subject-desc-input').value = '';
    document.getElementById('editing-original-subject').value = '';
    document.getElementById('weight-quizzes').value = 35;
    document.getElementById('weight-participation').value = 15;
    document.getElementById('weight-attendance').value = 10;
    document.getElementById('weight-exams').value = 40;

    const submit = document.getElementById('subject-submit-btn');
    submit.innerText = "+ Add Subject";
    submit.className = "w-full sm:w-auto bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-md shadow-indigo-600/20 transition-all whitespace-nowrap";
    document.getElementById('subject-cancel-edit-btn').classList.add('hidden');
  };

  App.handleSaveSubject = async function () {
    const newName = document.getElementById('new-subject-input').value.trim();
    const descVal = document.getElementById('new-subject-desc-input').value.trim();
    const oldName = document.getElementById('editing-original-subject').value;

    const qW = Number(document.getElementById('weight-quizzes').value) || 0;
    const pW = Number(document.getElementById('weight-participation').value) || 0;
    const aW = Number(document.getElementById('weight-attendance').value) || 0;
    const eW = Number(document.getElementById('weight-exams').value) || 0;

    if ((qW + pW + aW + eW) !== 100) { App.showToast("Component weights must add up to exactly 100%.", "error"); return; }
    if (!newName) { App.showToast("Please enter a subject name.", "error"); return; }

    const res = await App.apiCall({
      action: "manageSubject",
      pin: state.adminPin,
      subAction: oldName ? "update" : "add",
      oldName: oldName,
      newName: newName,
      subjectName: newName,
      description: descVal,
      weights: { quizzes: qW, participation: pW, attendance: aW, exams: eW }
    }, { retries: 1 });

    if (!res.success) { App.showToast(res.message || "Failed to save subject.", "error"); return; }

    if (res.subjects) state.availableSubjects = res.subjects;
    if (res.descriptions) state.subjectDescriptions = res.descriptions;
    if (res.weights) state.subjectWeights = res.weights;

    App.populateSubjectUIs();
    App.renderSubjectsListUI();
    App.invalidateAllCache();
    await App.loadAdminDashboard();

    App.showToast(oldName ? "Subject '" + newName + "' updated!" : "Subject '" + newName + "' added!");
    App.resetSubjectForm();
  };

  App.handleDeleteSubject = async function (name) {
    if (!confirm("WARNING: Deleting '" + name + "' will also delete ALL grades for this subject.\n\nProceed?")) return;

    const res = await App.apiCall({
      action: "manageSubject", pin: state.adminPin, subAction: "delete", subjectName: name
    }, { retries: 1 });

    if (res.success) {
      if (state.activeAdminSubject === name) state.activeAdminSubject = "All";
      if (res.subjects) state.availableSubjects = res.subjects;
      if (res.descriptions) state.subjectDescriptions = res.descriptions;
      if (res.weights) state.subjectWeights = res.weights;
      App.showToast("Subject '" + name + "' deleted.");
      App.populateSubjectUIs();
      App.renderSubjectsListUI();
      App.invalidateAllCache();
      await App.loadAdminDashboard();
    } else {
      App.showToast(res.message || "Failed to delete subject.", "error");
    }
  };

})(window.App);