(function (App) {
  'use strict';

  const state = App.state;

  state._classRecord = null;
  state._crFilters = { search: '', section: 'All', sort: 'name-asc' };
  state._crPageSize = 50;
  state._crCollapsed = {};
  state._crCategoryPages = {};
  state._crActiveCategoryId = null;

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
    sel.innerHTML = state.availableSubjects.map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');
    if (prev && state.availableSubjects.indexOf(prev) !== -1) sel.value = prev;
    else if (state.availableSubjects.length > 0) sel.value = state.availableSubjects[0];
  };

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
      const res = await App.apiCall({ action: 'getClassRecord', subject: subject, quarter: quarter });
      if (!res.success) throw new Error(res.message || 'Failed to load.');

      state._classRecord = res;
      const secSel = document.getElementById('cr-section-filter');
      if (secSel) secSel.value = 'All';
      state._crFilters.section = 'All';
      state._crCollapsed = {};
      state._crCategoryPages = {};
      
      if (res.categories && res.categories.length > 0) {
        state._crActiveCategoryId = String(res.categories[0].id);
      } else {
        state._crActiveCategoryId = null;
      }

      App.populateClassRecordSectionFilter();
      App.renderClassRecord();
    } catch (e) {
      console.error(e);
      body.innerHTML = '<div class="text-center text-rose-500 py-12 text-sm font-medium">Failed to load. Check console.</div>';
    }
  };

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
    sel.innerHTML = '<option value="All">All Sections</option>' + sections.map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');
    if (prev && sections.indexOf(prev) !== -1) sel.value = prev;
    else sel.value = 'All';
  };

  App.crSetActiveCategory = function (categoryId) {
    state._crActiveCategoryId = String(categoryId);
    App.renderClassRecord();
  };

  App.crApplyFilters = function () {
    const searchEl = document.getElementById('cr-search');
    const secEl = document.getElementById('cr-section-filter');
    const sortEl = document.getElementById('cr-sort');
    state._crFilters.search = (searchEl ? searchEl.value : '').toLowerCase().trim();
    state._crFilters.section = secEl ? secEl.value : 'All';
    state._crFilters.sort = sortEl ? sortEl.value : 'name-asc';
    state._crCategoryPages = {};
    App.renderClassRecord();
  };

  App.crSetPageSize = function (size) {
    state._crPageSize = Number(size) || 50;
    state._crCategoryPages = {};
    App.renderClassRecord();
  };

  App.crGotoCategoryPage = function (page, categoryId) {
    state._crCategoryPages[String(categoryId)] = page;
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

    const allFiltered = App._crFilteredStudents();

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

    let activeCat = categories.find(c => String(c.id) === String(state._crActiveCategoryId));
    if (!activeCat) {
      activeCat = categories[0];
      state._crActiveCategoryId = String(activeCat.id);
    }

    const filterInfo = App._crFilterSummary(allFiltered.length, rec.students.length);

    let tabsHtml = '<div class="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 mb-4">';
    categories.sort((a, b) => (a.position || 0) - (b.position || 0)).forEach(cat => {
      const isActive = String(cat.id) === String(state._crActiveCategoryId);
      const activeClass = isActive 
        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20' 
        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50';
      tabsHtml += `<button type="button" data-action="switch-category" data-category-id="${cat.id}" class="px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeClass}">${App.esc(cat.name)} <span class="opacity-75">(${cat.weight}%)</span></button>`;
    });
    tabsHtml += '</div>';

    const activeAssessments = assessByCat[String(activeCat.id)] || [];
    const categoryBlock = App.buildCategoryBlock(activeCat, activeAssessments, allFiltered, scoreMap);

    body.innerHTML = filterInfo + tabsHtml + categoryBlock;
  };

  App._crFilterSummary = function (visible, total) {
    const f = state._crFilters;
    const hasFilter = f.search || (f.section && f.section !== 'All');
    if (!hasFilter) return '';
    return '<div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-xs font-bold text-indigo-700 mb-4">' +
      'Showing <b>' + visible + '</b> of <b>' + total + '</b> students' +
      (f.search ? ' · Search: "' + App.esc(f.search) + '"' : '') +
      (f.section && f.section !== 'All' ? ' · Section: ' + App.esc(f.section) : '') +
      '</div>';
  };

  App._crCategoryPaginationUI = function (categoryId, currentPage, totalPages) {
    if (totalPages <= 1) return '';

    const p = currentPage;
    const nums = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) nums.push(i);
    } else {
      if (p <= 4) nums.push(1,2,3,4,5,'...',totalPages);
      else if (p >= totalPages - 3) nums.push(1,'...',totalPages-4,totalPages-3,totalPages-2,totalPages-1,totalPages);
      else nums.push(1,'...',p-1,p,p+1,'...',totalPages);
    }

    const btnCls = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-colors';
    const numBtn = (n) => {
      if (n === '...') return '<span class="px-2 py-1.5 text-xs text-slate-400">…</span>';
      if (n === p) return '<span class="' + btnCls + ' bg-indigo-600 text-white">' + n + '</span>';
      return '<button type="button" data-cr-cat-page="' + n + '" data-category-id="' + categoryId + '" class="' + btnCls + ' bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">' + n + '</button>';
    };

    return '<div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/50">' +
      '<div class="text-[11px] font-bold text-slate-500">Page ' + p + ' of ' + totalPages + '</div>' +
      '<div class="flex items-center gap-2">' +
        (p > 1 ? '<button type="button" data-cr-cat-page="' + (p-1) + '" data-category-id="' + categoryId + '" class="' + btnCls + ' bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">← Prev</button>' : '<span class="' + btnCls + ' bg-slate-100 text-slate-300 cursor-not-allowed">← Prev</span>') +
        nums.map(numBtn).join('') +
        (p < totalPages ? '<button type="button" data-cr-cat-page="' + (p+1) + '" data-category-id="' + categoryId + '" class="' + btnCls + ' bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">Next →</button>' : '<span class="' + btnCls + ' bg-slate-100 text-slate-300 cursor-not-allowed">Next →</span>') +
      '</div>' +
    '</div>';
  };

  App.buildCategoryBlock = function (cat, assessments, allStudents, scoreMap) {
    const catId = String(cat.id);

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

    const total = allStudents.length;
    const pageSize = state._crPageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Number(state._crCategoryPages[catId] || 1);
    if (page > totalPages) page = totalPages;
    state._crCategoryPages[catId] = page;
    const startIdx = (page - 1) * pageSize;
    const students = allStudents.slice(startIdx, startIdx + pageSize);

    let html = '<div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">';

    html += '<div class="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">' +
      '<div class="flex items-center gap-3">' +
        '<div class="font-black text-slate-900 text-sm">' + App.esc(cat.name) + ' Assessments</div>' +
      '</div>' +
      '<button type="button" data-action="add-assessment" data-category-id="' + cat.id + '" data-category-name="' + App.esc(cat.name) + '" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all">+ Add Assessment</button>' +
    '</div>';

    if (assessments.length === 0) {
      html += '<div class="p-8 text-center text-slate-400 text-sm italic">No assessments yet for this category. Click "+ Add Assessment" to start.</div>';
    } else if (students.length === 0) {
      html += '<div class="p-8 text-center text-slate-400 text-sm italic">No students match the current filter.</div>';
    } else {
      // FIX: Use border-separate and explicit inline styles for sticky columns
      html += '<div class="overflow-x-auto relative"><table class="w-full text-left text-sm border-separate border-spacing-0 min-w-max">';
      html += '<thead><tr class="text-slate-500 text-[10px] font-black uppercase tracking-wider">';
      
      // STICKY LEFT COLUMN
      html += '<th style="position: sticky; left: 0; z-index: 20;" class="p-3 min-w-[180px] bg-slate-50 border-b border-r border-slate-200 shadow-[1px_0_0_0_#e2e8f0]">Student</th>';

      assessments.forEach(a => {
        html += '<th class="p-3 text-center min-w-[100px] bg-slate-50 border-b border-slate-200">' +
          '<div class="flex flex-col items-center gap-1">' +
            '<span class="text-slate-700 text-xs font-black normal-case">' + App.esc(a.name) + '</span>' +
            '<span class="text-[10px] text-slate-400 font-bold">/' + App.esc(a.total_points) + '</span>' +
            '<div class="flex items-center gap-1 mt-1">' +
              '<button type="button" data-action="edit-assessment" data-id="' + a.id + '" data-name="' + App.esc(a.name) + '" data-total="' + App.esc(a.total_points) + '" data-category-id="' + a.category_id + '" data-category-name="' + App.esc(cat.name) + '" class="text-[10px] text-slate-500 hover:text-indigo-600 font-bold px-1.5 py-0.5 rounded hover:bg-indigo-50">Edit</button>' +
              '<button type="button" data-action="delete-assessment" data-id="' + a.id + '" data-name="' + App.esc(a.name) + '" class="text-[10px] text-rose-500 hover:text-rose-700 font-bold px-1.5 py-0.5 rounded hover:bg-rose-50">×</button>' +
            '</div>' +
          '</div>' +
        '</th>';
      });
      
      // STICKY RIGHT COLUMN
      html += '<th style="position: sticky; right: 0; z-index: 20;" class="p-3 text-center min-w-[80px] bg-slate-50 border-b border-l border-slate-200 shadow-[-1px_0_0_0_#e2e8f0]">Avg</th>';
      html += '</tr></thead>';

      html += '<tbody>';
      students.forEach(stu => {
        html += '<tr class="group hover:bg-slate-50/40 transition-colors">';
        
        // STICKY LEFT COLUMN
        html += '<td style="position: sticky; left: 0; z-index: 10;" class="p-3 bg-white group-hover:bg-slate-50 border-b border-r border-slate-100 shadow-[1px_0_0_0_#e2e8f0]"><div class="font-bold text-slate-800 text-xs">' + App.esc(stu.name) + '</div><div class="text-[10px] text-slate-400 font-semibold">' + App.esc(stu.student_number) + ' &bull; ' + App.esc(stu.section || '-') + '</div></td>';

        assessments.forEach(a => {
          const val = scoreMap[a.id + '|' + stu.student_number];
          const display = (val === undefined || val === null || val === '') ? '' : val;
          html += '<td class="p-2 text-center border-b border-slate-100 bg-white group-hover:bg-slate-50">' +
            '<input type="number" step="any" min="0" max="' + App.esc(a.total_points) + '" ' +
                   'data-assessment-id="' + a.id + '" data-student-number="' + App.esc(stu.student_number) + '" data-total-points="' + App.esc(a.total_points) + '" ' +
                   'value="' + App.esc(display) + '" ' +
                   'class="cr-score-input w-20 text-center bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">' +
          '</td>';
        });

        const avg = computeAvg(stu.student_number);
        const avgColor = avg === '-' ? 'text-slate-400' : (Number(avg) >= 75 ? 'text-emerald-600' : 'text-rose-600');
        
        // STICKY RIGHT COLUMN
        html += '<td style="position: sticky; right: 0; z-index: 10;" class="p-3 text-center bg-indigo-50 group-hover:bg-indigo-100 border-b border-l border-slate-100 shadow-[-1px_0_0_0_#e2e8f0]"><span class="font-black text-sm ' + avgColor + '">' + avg + '</span></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';

      html += App._crCategoryPaginationUI(cat.id, page, totalPages);
    }

    html += '</div>';
    return html;
  };

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
    const modal = document.getElementById('assessment-modal');
    if (!App.confirmDiscard(modal, "You have unsaved assessment details. Discard them?")) return;
    App.closeModal(modal);
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
    err.classList.add('hidden'); err.textContent = '';
    if (!name) { err.textContent = 'Enter a name.'; err.classList.remove('hidden'); return; }
    if (!totalPoints || totalPoints <= 0) { err.textContent = 'Total points must be > 0.'; err.classList.remove('hidden'); return; }

    await App.withButtonLoading(btn, async () => {
      let res;
      if (editId) {
        res = await App.apiCall({ action: 'renameAssessment', pin: state.adminPin, id: Number(editId), name, totalPoints }, { retries: 1 });
      } else {
        res = await App.apiCall({ action: 'addAssessment', pin: state.adminPin, subject, quarter, categoryId, name, totalPoints }, { retries: 1 });
      }
      if (!res.success) { err.textContent = res.message || 'Failed to save.'; err.classList.remove('hidden'); return; }
      App.closeModal(document.getElementById('assessment-modal'));
      App.showToast(editId ? 'Assessment updated.' : 'Assessment added.');
      await App.loadClassRecord();
    }, { text: 'Saving...' });
  };

  App.deleteAssessment = async function (id, name) {
    if (!confirm('Delete assessment "' + name + '"?\n\nAll scores for this assessment will be deleted.')) return;
    const res = await App.apiCall({ action: 'deleteAssessment', pin: state.adminPin, id }, { retries: 1 });
    if (res.success) { App.showToast('Assessment deleted.'); await App.loadClassRecord(); }
    else App.showToast(res.message || 'Failed to delete.', 'error');
  };

  App.saveScoreInline = async function (input) {
    const assessmentId = Number(input.dataset.assessmentId);
    const studentNumber = input.dataset.studentNumber;
    const totalPoints = Number(input.dataset.totalPoints);
    const raw = input.value.trim();
    let value = raw === '' ? '' : Number(raw);
    if (value !== '' && (isNaN(value) || value < 0)) {
      App.showToast('Invalid score.', 'error'); input.value = input.dataset.originalValue || ''; return;
    }
    if (value !== '' && value > totalPoints) {
      App.showToast('Score cannot exceed ' + totalPoints + '.', 'error'); input.value = input.dataset.originalValue || ''; return;
    }
    if (String(value) === String(input.dataset.originalValue || '')) return;

    const original = input.style.borderColor;
    input.style.borderColor = '#a5b4fc';

    const res = await App.apiCall({ action: 'saveScore', pin: state.adminPin, assessmentId, studentNumber, score: value }, { retries: 1 });
    input.style.borderColor = original;

    if (res.success) {
      input.dataset.originalValue = value;
      
      // 1. Update the in-memory state
      if (state._classRecord) {
        const idx = state._classRecord.scores.findIndex(s => s.assessment_id === assessmentId && s.student_number === studentNumber);
        if (idx >= 0) state._classRecord.scores[idx].score = value;
        else state._classRecord.scores.push({ assessment_id: assessmentId, student_number: studentNumber, score: value });
      }

      // 2. Instantly update ONLY the Average cell for this row (prevents focus loss!)
      const tr = input.closest('tr');
      if (tr && state._classRecord) {
        const activeCatId = state._crActiveCategoryId;
        const activeAssessments = state._classRecord.assessments.filter(a => String(a.category_id) === String(activeCatId));
        
        let got = 0, total = 0;
        activeAssessments.forEach(a => {
          const scoreObj = state._classRecord.scores.find(s => String(s.assessment_id) === String(a.id) && s.student_number === studentNumber);
          if (scoreObj && scoreObj.score !== undefined && scoreObj.score !== null && scoreObj.score !== '') {
            got += Number(scoreObj.score);
            total += Number(a.total_points);
          }
        });
        
        const newAvg = total === 0 ? '-' : (Math.round((got / total) * 100 * 100) / 100).toFixed(2);
        const avgColor = newAvg === '-' ? 'text-slate-400' : (Number(newAvg) >= 75 ? 'text-emerald-600' : 'text-rose-600');
        
        const avgCell = tr.querySelector('td:last-child');
        if (avgCell) {
           avgCell.innerHTML = '<span class="font-black text-sm ' + avgColor + '">' + newAvg + '</span>';
        }
      }
      
      // NOTE: We removed App.renderClassRecord() from here. 
      // This is what was destroying the input and stealing your focus.
      
    } else {
      App.showToast(res.message || 'Failed to save score.', 'error');
      input.value = input.dataset.originalValue || '';
    }
  };

  App.applyClassRecord = async function () {
    const subject = document.getElementById('cr-subject').value;
    const quarter = document.getElementById('cr-quarter').value;
    if (!subject) { App.showToast('Pick a subject first.', 'error'); return; }

    const msg = 'Apply class record averages to the grade sheet?\n\nSubject: ' + subject + '\nQuarter: ' + quarter + '\n\nEvery student in this subject will have their grade sheet breakdown overwritten with the averages from this class record.\n\nContinue?';
    if (!confirm(msg)) return;

    const btn = document.getElementById('cr-apply-btn');
    await App.withButtonLoading(btn, async () => {
      const res = await App.apiCall({ action: 'applyClassRecordToGrades', pin: state.adminPin, subject, quarter }, { retries: 0, timeout: 120000 });
      if (res.success) { App.showToast('Applied to ' + res.updated + ' student(s).'); App.invalidateAllCache(); }
      else App.showToast(res.message || 'Failed to apply.', 'error');
    }, { text: 'Applying...' });
  };

})(window.App);