(function (App) {
  'use strict';

  const state = App.state;

  state._classRecord = null;

  state._crFilters = {
    search: '',
    section: 'All',
    sort: 'name-asc'
  };

  // NEW: pagination state
  state._crPage = 1;
  state._crPageSize = 25;

  // ============================================================
  // Subject dropdown
  // ============================================================
  App.populateClassRecordFilters = async function () {
    const sel = document.getElementById('cr-subject');
    if (!sel) return;

    if (!state.availableSubjects || state.availableSubjects.length === 0) {
      try { await App.fetchSubjects(); } catch (e) { console.warn(e); }
    }

    if (!state.availableSubjects || state.availableSubjects.length === 0) {
      sel.innerHTML = '<option value="">No subjects available</option>';
      return;
    }

    const prev = sel.value;
    sel.innerHTML = state.availableSubjects
      .map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>')
      .join('');

    if (prev && state.availableSubjects.indexOf(prev) !== -1) sel.value = prev;
    else if (state.availableSubjects.length > 0) sel.value = state.availableSubjects[0];
  };

  // ============================================================
  // Load
  // ============================================================
  App.loadClassRecord = async function () {
    const subjSel = document.getElementById('cr-subject');
    const qtrSel = document.getElementById('cr-quarter');
    const body = document.getElementById('cr-body');
    if (!subjSel || !qtrSel || !body) return;

    const subject = subjSel.value;
    const quarter = qtrSel.value;
    if (!subject) {
      body.innerHTML = '<div class="text-center text-slate-400 py-12 text-sm font-medium">No subject selected.</div>';
      return;
    }

    body.innerHTML = '<div class="text-center text-slate-400 py-12 text-sm font-medium">Loading…</div>';

    try {
      const res = await App.apiCall({
        action: 'getClassRecord',
        subject: subject,
        quarter: quarter
      });
      if (!res.success) throw new Error(res.message || 'Failed to load.');

      state._classRecord = res;
      // Reset filters on subject change
      const secSel = document.getElementById('cr-section-filter');
      if (secSel) secSel.value = 'All';
      state._crFilters.section = 'All';
      state._crPage = 1;

      App.populateClassRecordSectionFilter();
      App.renderClassRecord();
    } catch (e) {
      console.error(e);
      body.innerHTML = '<div class="text-center text-rose-500 py-12 text-sm font-medium">Failed to load. Check console.</div>';
    }
  };

  // ============================================================
  // Section filter populate
  // ============================================================
  App.populateClassRecordSectionFilter = function () {
    const sel = document.getElementById('cr-section-filter');
    if (!sel || !state._classRecord) return;

    const sections = [];
    const seen = {};
    (state._classRecord.students || []).forEach(s => {
      const sec = String(s.section || '').trim();
      if (sec && !seen[sec]) { seen[sec] = true; sections.push(sec); }
    });
    sections.sort();

    const prev = sel.value;
    sel.innerHTML = '<option value="All">All Sections</option>' +
      sections.map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');

    if (prev && sections.indexOf(prev) !== -1) sel.value = prev;
    else sel.value = 'All';
  };

  // ============================================================
  // Filters — reset page on change
  // ============================================================
  App.crApplyFilters = function () {
    const searchEl = document.getElementById('cr-search');
    const secEl = document.getElementById('cr-section-filter');
    const sortEl = document.getElementById('cr-sort');

    state._crFilters.search = (searchEl ? searchEl.value : '').toLowerCase().trim();
    state._crFilters.section = secEl ? secEl.value : 'All';
    state._crFilters.sort = sortEl ? sortEl.value : 'name-asc';

    state._crPage = 1;  // reset to first page
    App.renderClassRecord();
  };

  App.crGotoPage = function (page) {
    const totalPages = App._crTotalPages();
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    state._crPage = page;
    App.renderClassRecord();
  };

  App.crSetPageSize = function (size) {
    state._crPageSize = Number(size) || 25;
    state._crPage = 1;
    App.renderClassRecord();
  };

  App._crFilteredStudents = function () {
    if (!state._classRecord) return [];
    let list = (state._classRecord.students || []).slice();
    const f = state._crFilters;

    if (f.search) {
      list = list.filter(s =>
        String(s.name || '').toLowerCase().indexOf(f.search) !== -1 ||
        String(s.student_number || '').toLowerCase().indexOf(f.search) !== -1
      );
    }
    if (f.section && f.section !== 'All') {
      list = list.filter(s => String(s.section || '') === f.section);
    }

    const sortKey = f.sort || 'name-asc';
    list.sort((a, b) => {
      const nameA = String(a.name || '').toLowerCase();
      const nameB = String(b.name || '').toLowerCase();
      const noA = String(a.student_number || '').toLowerCase();
      const noB = String(b.student_number || '').toLowerCase();
      const secA = String(a.section || '').toLowerCase();
      const secB = String(b.section || '').toLowerCase();

      switch (sortKey) {
        case 'name-desc':   return nameB < nameA ? -1 : (nameB > nameA ? 1 : 0);
        case 'number-asc':  return noA < noB ? -1 : (noA > noB ? 1 : 0);
        case 'number-desc': return noB < noA ? -1 : (noB > noA ? 1 : 0);
        case 'section-asc': return secA < secB ? -1 : (secA > secB ? 1 : (nameA < nameB ? -1 : 1));
        case 'name-asc':
        default:            return nameA < nameB ? -1 : (nameA > nameB ? 1 : 0);
      }
    });
    return list;
  };

  App._crTotalPages = function () {
    const total = App._crFilteredStudents().length;
    return Math.max(1, Math.ceil(total / state._crPageSize));
  };

  // ============================================================
  // Render
  // ============================================================
  App.renderClassRecord = function () {
    const body = document.getElementById('cr-body');
    const rec = state._classRecord;
    if (!body || !rec) return;

    App.populateClassRecordSectionFilter();

    const { categories, assessments, scores } = rec;

    if (!rec.students || rec.students.length === 0) {
      body.innerHTML = '<div class="bg-white p-12 rounded-2xl border border-slate-200/80 shadow-sm text-center text-slate-400 text-sm font-medium">No students enrolled in this subject yet. Add students first.</div>';
      return;
    }

    if (categories.length === 0) {
      body.innerHTML = '<div class="bg-white p-12 rounded-2xl border border-slate-200/80 shadow-sm text-center text-slate-400 text-sm font-medium">No categories configured for this subject. Add categories in the Subjects tab.</div>';
      return;
    }

    // Paginate
    const allFiltered = App._crFilteredStudents();
    const totalPages = Math.max(1, Math.ceil(allFiltered.length / state._crPageSize));
    if (state._crPage > totalPages) state._crPage = totalPages;
    const startIdx = (state._crPage - 1) * state._crPageSize;
    const students = allFiltered.slice(startIdx, startIdx + state._crPageSize);

    const scoreMap = {};
    (scores || []).forEach(s => {
      scoreMap[s.assessment_id + '|' + s.student_number] = s.score;
    });

    const assessByCat = {};
    (assessments || []).forEach(a => {
      const k = String(a.category_id);
      if (!assessByCat[k]) assessByCat[k] = [];
      assessByCat[k].push(a);
    });
    Object.keys(assessByCat).forEach(k => {
      assessByCat[k].sort((a, b) => (a.position || 0) - (b.position || 0));
    });

    const filterInfo = App._crFilterSummary(allFiltered.length, rec.students.length);

    const categoryBlocks = categories
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(cat => App.buildCategoryBlock(cat, assessByCat[String(cat.id)] || [], students, scoreMap))
      .join('');

    const pagination = App._crPaginationUI(startIdx, students.length, allFiltered.length, totalPages);

    body.innerHTML = filterInfo + categoryBlocks + pagination;
  };

  App._crFilterSummary = function (visible, total) {
    const f = state._crFilters;
    const hasFilter = f.search || (f.section && f.section !== 'All');
    if (!hasFilter) return '';
    return '<div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-xs font-bold text-indigo-700">' +
      'Showing <b>' + visible + '</b> of <b>' + total + '</b> students' +
      (f.search ? ' · Search: "' + App.esc(f.search) + '"' : '') +
      (f.section && f.section !== 'All' ? ' · Section: ' + App.esc(f.section) : '') +
      '</div>';
  };

  // ============================================================
  // Pagination UI
  // ============================================================
  App._crPaginationUI = function (startIdx, shown, total, totalPages) {
    if (total === 0) return '';

    const from = total === 0 ? 0 : startIdx + 1;
    const to = startIdx + shown;

    // Page numbers (show up to 7, with ellipsis)
    const p = state._crPage;
    const nums = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) nums.push(i);
    } else {
      if (p <= 4) {
        nums.push(1,2,3,4,5,'...',totalPages);
      } else if (p >= totalPages - 3) {
        nums.push(1,'...',totalPages-4,totalPages-3,totalPages-2,totalPages-1,totalPages);
      } else {
        nums.push(1,'...',p-1,p,p+1,'...',totalPages);
      }
    }

    const btnCls = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-colors';
    const numBtn = (n) => {
      if (n === '...') return '<span class="px-2 py-1.5 text-xs text-slate-400">…</span>';
      if (n === p) return '<span class="' + btnCls + ' bg-indigo-600 text-white">' + n + '</span>';
      return '<button type="button" data-cr-page="' + n + '" class="' + btnCls + ' bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">' + n + '</button>';
    };

    return '<div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">' +
      '<div class="text-xs font-bold text-slate-500">Showing <b>' + from + '–' + to + '</b> of <b>' + total + '</b></div>' +
      '<div class="flex items-center gap-2">' +
        (p > 1
          ? '<button type="button" data-cr-page="' + (p-1) + '" class="' + btnCls + ' bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">← Prev</button>'
          : '<span class="' + btnCls + ' bg-slate-100 text-slate-300 cursor-not-allowed">← Prev</span>') +
        nums.map(numBtn).join('') +
        (p < totalPages
          ? '<button type="button" data-cr-page="' + (p+1) + '" class="' + btnCls + ' bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">Next →</button>'
          : '<span class="' + btnCls + ' bg-slate-100 text-slate-300 cursor-not-allowed">Next →</span>') +
      '</div>' +
      '<div class="flex items-center gap-2">' +
        '<label for="cr-page-size" class="text-[11px] font-bold text-slate-500">Rows:</label>' +
        '<select id="cr-page-size" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:border-indigo-600">' +
          [10,25,50,100].map(n => '<option value="' + n + '"' + (n === state._crPageSize ? ' selected' : '') + '>' + n + '</option>').join('') +
        '</select>' +
      '</div>' +
    '</div>';
  };

  // ============================================================
  // Category block
  // ============================================================
  App.buildCategoryBlock = function (cat, assessments, students, scoreMap) {
    const computeAvg = (studentNo) => {
      let got = 0, total = 0;
      assessments.forEach(a => {
        const v = scoreMap[a.id + '|' + studentNo];
        if (v !== undefined && v !== null && v !== '') {
          got += Number(v);
          total += Number(a.total_points);
        }
      });
      if (total === 0) return '-';
      return (Math.round((got / total) * 100 * 100) / 100).toFixed(2);
    };

    let html = '<div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">';

    html += '<div class="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">' +
      '<div class="flex items-center gap-3">' +
        '<div class="font-black text-slate-900 text-sm">' + App.esc(cat.name) + '</div>' +
        '<span class="text-[11px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md">' + App.esc(cat.weight) + '%</span>' +
      '</div>' +
      '<button type="button" data-action="add-assessment" data-category-id="' + cat.id + '" data-category-name="' + App.esc(cat.name) + '" ' +
              'class="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all">' +
        '+ Add Assessment' +
      '</button>' +
    '</div>';

    if (assessments.length === 0) {
      html += '<div class="p-6 text-center text-slate-400 text-xs italic">No assessments yet.</div></div>';
      return html;
    }
    if (students.length === 0) {
      html += '<div class="p-6 text-center text-slate-400 text-xs italic">No students match the current filter.</div></div>';
      return html;
    }

    html += '<div class="overflow-x-auto"><table class="w-full text-left text-sm border-collapse">';
    html += '<thead><tr class="bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-wider">';
    html += '<th class="p-3 min-w-[180px]">Student</th>';

    assessments.forEach(a => {
      html += '<th class="p-3 text-center min-w-[100px]">' +
        '<div class="flex flex-col items-center gap-1">' +
          '<span class="text-slate-700 text-xs font-black normal-case">' + App.esc(a.name) + '</span>' +
          '<span class="text-[10px] text-slate-400 font-bold">/' + App.esc(a.total_points) + '</span>' +
          '<div class="flex items-center gap-1 mt-1">' +
            '<button type="button" data-action="edit-assessment" data-id="' + a.id + '" ' +
                    'data-name="' + App.esc(a.name) + '" data-total="' + App.esc(a.total_points) + '" ' +
                    'data-category-id="' + a.category_id + '" data-category-name="' + App.esc(cat.name) + '" ' +
                    'class="text-[10px] text-slate-500 hover:text-indigo-600 font-bold px-1.5 py-0.5 rounded hover:bg-indigo-50">Edit</button>' +
            '<button type="button" data-action="delete-assessment" data-id="' + a.id + '" data-name="' + App.esc(a.name) + '" ' +
                    'class="text-[10px] text-rose-500 hover:text-rose-700 font-bold px-1.5 py-0.5 rounded hover:bg-rose-50">×</button>' +
          '</div>' +
        '</div>' +
      '</th>';
    });
    html += '<th class="p-3 text-center min-w-[80px] bg-indigo-50/50">Avg</th>';
    html += '</tr></thead>';

    html += '<tbody class="divide-y divide-slate-100">';
    students.forEach(stu => {
      html += '<tr class="hover:bg-slate-50/40 transition-colors">';
      html += '<td class="p-3">' +
        '<div class="font-bold text-slate-800 text-xs">' + App.esc(stu.name) + '</div>' +
        '<div class="text-[10px] text-slate-400 font-semibold">' + App.esc(stu.student_number) + ' &bull; ' + App.esc(stu.section || '-') + '</div>' +
      '</td>';

      assessments.forEach(a => {
        const val = scoreMap[a.id + '|' + stu.student_number];
        const display = (val === undefined || val === null || val === '') ? '' : val;
        html += '<td class="p-2 text-center">' +
          '<input type="number" step="any" min="0" max="' + App.esc(a.total_points) + '" ' +
                 'data-assessment-id="' + a.id + '" ' +
                 'data-student-number="' + App.esc(stu.student_number) + '" ' +
                 'data-total-points="' + App.esc(a.total_points) + '" ' +
                 'value="' + App.esc(display) + '" ' +
                 'class="cr-score-input w-20 text-center bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">' +
        '</td>';
      });

      const avg = computeAvg(stu.student_number);
      const avgColor = avg === '-' ? 'text-slate-400' : (Number(avg) >= 75 ? 'text-emerald-600' : 'text-rose-600');
      html += '<td class="p-3 text-center bg-indigo-50/30"><span class="font-black text-sm ' + avgColor + '">' + avg + '</span></td>';

      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  };

  // ============================================================
  // Assessment modal
  // ============================================================
  App.openAssessmentModal = function (categoryId, categoryName, quarter, editId, name, totalPoints) {
    document.getElementById('assessment-modal-title').textContent = editId ? 'Edit Assessment' : 'Add Assessment';
    document.getElementById('assessment-edit-id').value = editId || '';
    document.getElementById('assessment-category-id').value = categoryId;
    document.getElementById('assessment-quarter').value = quarter;
    document.getElementById('assessment-category-label').textContent = categoryName;
    document.getElementById('assessment-name').value = name || '';
    document.getElementById('assessment-total').value = totalPoints || 100;
    document.getElementById('assessment-error').classList.add('hidden');
    App.openModal(document.getElementById('assessment-modal'));
  };

  App.closeAssessmentModal = function () {
    App.closeModal(document.getElementById('assessment-modal'));
  };

  App.saveAssessment = async function () {
    const btn = document.getElementById('assessment-save-btn');
    const editId = document.getElementById('assessment-edit-id').value;
    const categoryId = Number(document.getElementById('assessment-category-id').value);
    const quarter = document.getElementById('assessment-quarter').value;
    const subject = document.getElementById('cr-subject').value;
    const name = document.getElementById('assessment-name').value.trim();
    const totalPoints = Number(document.getElementById('assessment-total').value);

    const err = document.getElementById('assessment-error');
    err.classList.add('hidden');
    err.textContent = '';

    if (!name) { err.textContent = 'Enter a name.'; err.classList.remove('hidden'); return; }
    if (!totalPoints || totalPoints <= 0) { err.textContent = 'Total points must be > 0.'; err.classList.remove('hidden'); return; }

    await App.withButtonLoading(btn, async () => {
      let res;
      if (editId) {
        res = await App.apiCall({
          action: 'renameAssessment', pin: state.adminPin,
          id: Number(editId), name: name, totalPoints: totalPoints
        }, { retries: 1 });
      } else {
        res = await App.apiCall({
          action: 'addAssessment', pin: state.adminPin,
          subject: subject, quarter: quarter, categoryId: categoryId,
          name: name, totalPoints: totalPoints
        }, { retries: 1 });
      }
      if (!res.success) {
        err.textContent = res.message || 'Failed to save.';
        err.classList.remove('hidden');
        return;
      }
      App.closeAssessmentModal();
      App.showToast(editId ? 'Assessment updated.' : 'Assessment added.');
      await App.loadClassRecord();
    }, { text: 'Saving...' });
  };

  App.deleteAssessment = async function (id, name) {
    if (!confirm('Delete assessment "' + name + '"?\n\nAll scores for this assessment will be deleted. This cannot be undone.')) return;

    const res = await App.apiCall({
      action: 'deleteAssessment', pin: state.adminPin, id: id
    }, { retries: 1 });

    if (res.success) {
      App.showToast('Assessment deleted.');
      await App.loadClassRecord();
    } else {
      App.showToast(res.message || 'Failed to delete.', 'error');
    }
  };

  // ============================================================
  // Inline score saving
  // ============================================================
  App.saveScoreInline = async function (input) {
    const assessmentId = Number(input.dataset.assessmentId);
    const studentNumber = input.dataset.studentNumber;
    const totalPoints = Number(input.dataset.totalPoints);
    const raw = input.value.trim();

    let value = raw === '' ? '' : Number(raw);
    if (value !== '' && (isNaN(value) || value < 0)) {
      App.showToast('Invalid score.', 'error');
      input.value = input.dataset.originalValue || '';
      return;
    }
    if (value !== '' && value > totalPoints) {
      App.showToast('Score cannot exceed ' + totalPoints + '.', 'error');
      input.value = input.dataset.originalValue || '';
      return;
    }

    if (String(value) === String(input.dataset.originalValue || '')) return;

    const original = input.style.borderColor;
    input.style.borderColor = '#a5b4fc';

    const res = await App.apiCall({
      action: 'saveScore', pin: state.adminPin,
      assessmentId: assessmentId, studentNumber: studentNumber, score: value
    }, { retries: 1 });

    input.style.borderColor = original;

    if (res.success) {
      input.dataset.originalValue = value;
      if (state._classRecord) {
        const idx = state._classRecord.scores.findIndex(s =>
          s.assessment_id === assessmentId && s.student_number === studentNumber);
        if (idx >= 0) state._classRecord.scores[idx].score = value;
        else state._classRecord.scores.push({
          assessment_id: assessmentId, student_number: studentNumber, score: value
        });
      }
      App.renderClassRecord();
    } else {
      App.showToast(res.message || 'Failed to save score.', 'error');
      input.value = input.dataset.originalValue || '';
    }
  };

  // ============================================================
  // Apply
  // ============================================================
  App.applyClassRecord = async function () {
    const subject = document.getElementById('cr-subject').value;
    const quarter = document.getElementById('cr-quarter').value;

    if (!subject) { App.showToast('Pick a subject first.', 'error'); return; }

    const msg =
      'Apply class record averages to the grade sheet?\n\n' +
      'Subject: ' + subject + '\n' +
      'Quarter: ' + quarter + '\n\n' +
      'Every student in this subject will have their grade sheet\'s breakdown overwritten with the averages from this class record.\n\n' +
      'Continue?';

    if (!confirm(msg)) return;

    const btn = document.getElementById('cr-apply-btn');
    await App.withButtonLoading(btn, async () => {
      const res = await App.apiCall({
        action: 'applyClassRecordToGrades', pin: state.adminPin,
        subject: subject, quarter: quarter
      }, { retries: 0, timeout: 120000 });

      if (res.success) {
        App.showToast('Applied to ' + res.updated + ' student(s).');
        App.invalidateAllCache();
      } else {
        App.showToast(res.message || 'Failed to apply.', 'error');
      }
    }, { text: 'Applying...' });
  };

})(window.App);