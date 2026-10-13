(function (App) {
  'use strict';

  const state = App.state;
  const ROWS_PER_PREVIEW_PAGE = 35;

  async function getGradesFor(subject) {
    if (!state.adminPin) return [];
    if (state.allAdminGradesCache[subject]) return state.allAdminGradesCache[subject];
    const res = await App.apiCall({ action: "getAllGrades", pin: state.adminPin, subject }, { retries: 1, timeout: 45000 });
    if (!Array.isArray(res)) return [];
    state.allAdminGradesCache[subject] = res;
    return res;
  }

  // Auto-fill the editable detail fields from the current subject.
  App.gsPrefillDetails = function () {
    const subjEl = document.getElementById('gs-subject');
    if (!subjEl) return;
    const subject = subjEl.value;
    if (!subject) return;

    const subjInput = document.getElementById('gs-display-subject');
    const descInput = document.getElementById('gs-display-desc');
    const syInput = document.getElementById('gs-display-sy');
    if (!subjInput || !descInput || !syInput) return;

    subjInput.value = subject.replace(/\s*\(SY.*?\)/i, '').trim();
    descInput.value = state.subjectDescriptions[subject] || '';
    const syMatch = subject.match(/\(SY\s*([\d-]+)/i);
    syInput.value = syMatch ? syMatch[1] : '';
  };

  function sortStudents(students, sortKey) {
    const list = students.slice();
    list.sort((a, b) => {
      const nameA = String(a.name || '').toLowerCase();
      const nameB = String(b.name || '').toLowerCase();
      const noA = String(a.studentNumber || '').toLowerCase();
      const noB = String(b.studentNumber || '').toLowerCase();
      switch (sortKey) {
        case 'name-desc':   return nameB < nameA ? -1 : (nameB > nameA ? 1 : 0);
        case 'number-asc':  return noA < noB ? -1 : (noA > noB ? 1 : 0);
        case 'number-desc': return noB < noA ? -1 : (noB > noA ? 1 : 0);
        case 'name-asc':
        default:            return nameA < nameB ? -1 : (nameA > nameB ? 1 : 0);
      }
    });
    return list;
  }

  function docHeader(cleanSubject, description, semester, schoolYear) {
    return '<div style="text-align:center; font-weight:bold; font-size:15px;">Pili Capital College, Inc.</div>' +
      '<div style="text-align:center; font-size:11px; margin-bottom:2px;">San Isidro, Pili, Camarines Sur</div>' +
      '<div style="text-align:center; font-weight:bold; font-size:13px; margin-bottom:10px; text-decoration:underline;">COLLEGE GRADING SHEET</div>' +
      '<table style="width:100%; font-size:11px; margin-bottom:6px;">' +
        '<tr>' +
          '<td style="text-align:left; border:none; padding:2px 0;"><b>Subject:</b> ' + App.esc(cleanSubject || '') + '</td>' +
          '<td style="text-align:right; border:none; padding:2px 0;"><b>Semester:</b> ' + App.esc(semester || '') + '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="text-align:left; border:none; padding:2px 0;"><b>Description:</b> ' + App.esc(description || '') + '</td>' +
          '<td style="text-align:right; border:none; padding:2px 0;"><b>School Year:</b> ' + App.esc(schoolYear || '') + '</td>' +
        '</tr>' +
      '</table>';
  }

  function tableStart() {
    return '<table class="gs-table">' +
      '<thead>' +
        '<tr>' +
          '<th rowspan="2" style="width:30px;">#</th>' +
          '<th rowspan="2">Name of Student</th>' +
          '<th rowspan="2" style="width:48px;">Prelims</th>' +
          '<th rowspan="2" style="width:48px;">Midterm</th>' +
          '<th rowspan="2" style="width:48px;">Semi Final</th>' +
          '<th rowspan="2" style="width:48px;">Finals</th>' +
          '<th colspan="2" style="width:84px;">Gen. Ave.</th>' +
          '<th rowspan="2" style="width:65px;">Remarks</th>' +
        '</tr>' +
        '<tr>' +
          '<th style="width:42px;">GWA</th>' +
          '<th style="width:42px;">EQV.</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>';
  }

  function studentRow(num, s) {
    if (!s) {
      return '<tr><td>' + num + '</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
    }
    return '<tr>' +
      '<td>' + num + '</td>' +
      '<td style="text-align:left; padding-left:6px;">' + App.esc(s.name) + '</td>' +
      '<td>' + (App.esc(s.q1) || '') + '</td>' +
      '<td>' + (App.esc(s.q2) || '') + '</td>' +
      '<td>' + (App.esc(s.q3) || '') + '</td>' +
      '<td>' + (App.esc(s.q4) || '') + '</td>' +
      '<td>' + (App.esc(s.final) || '') + '</td>' +
      '<td>' + App.getEquivalentGrade(s.final) + '</td>' +
      '<td>' + (App.esc(s.remarks) || '') + '</td>' +
    '</tr>';
  }

  function docFooter() {
    return '<table style="width:100%; margin-top:20px; font-size:11px; border:none;">' +
      '<tr>' +
        '<td style="text-align:left; border:none;">Submitted by: <b>Carl Harry M. Pandes</b></td>' +
        '<td style="text-align:left; border:none;">Received by: _______________________</td>' +
      '</tr>' +
    '</table>';
  }

  async function buildGradingSheetHTML(subject, section, semester, mode) {
    mode = mode || 'preview';
    const all = await getGradesFor(subject);
    let students = all.filter(s => s.subject === subject && (section === 'All' || s.section === section));

    if (students.length === 0) {
      return '<div class="p-8 text-center text-slate-400 bg-white rounded-xl font-bold">No students found matching this Subject and Section.</div>';
    }

    // Sort students
    const sortEl = document.getElementById('gs-sort');
    const sortKey = sortEl ? sortEl.value : 'name-asc';
    students = sortStudents(students, sortKey);

    // Read editable details
    const subjOverrideEl = document.getElementById('gs-display-subject');
    const descOverrideEl = document.getElementById('gs-display-desc');
    const syOverrideEl = document.getElementById('gs-display-sy');

    const cleanSubjectFallback = subject.replace(/\s*\(SY.*?\)/i, '').trim();
    const cleanSubject = (subjOverrideEl && subjOverrideEl.value.trim()) || cleanSubjectFallback;

    const descriptionFallback = state.subjectDescriptions[subject] || '';
    const description = (descOverrideEl && descOverrideEl.value.trim()) || descriptionFallback;

    const syMatch = subject.match(/\(SY\s*([\d-]+)/i);
    const syFallback = syMatch ? syMatch[1] : '';
    const schoolYear = (syOverrideEl && syOverrideEl.value.trim()) || syFallback;

    // Chunked output — same structure for preview and print
    const pageClass = mode === 'print' ? 'gs-print-page' : 'gs-preview-page';
    let html = '';
    for (let i = 0; i < students.length; i += ROWS_PER_PREVIEW_PAGE) {
      const chunk = students.slice(i, i + ROWS_PER_PREVIEW_PAGE);
      let rows = '';
      for (let k = 0; k < ROWS_PER_PREVIEW_PAGE; k++) {
        rows += studentRow(i + k + 1, chunk[k]);
      }
      html += '<div class="' + pageClass + '">' +
        docHeader(cleanSubject, description, semester, schoolYear) +
        tableStart() + rows + '</tbody></table>' +
        docFooter() +
      '</div>';
    }
    return html;
  }

  App.updateGradingSheetPreview = async function () {
    const subjEl = document.getElementById('gs-subject');
    const secEl = document.getElementById('gs-section');
    const semEl = document.getElementById('gs-semester');
    const container = document.getElementById('gs-preview-container');
    if (!subjEl || !secEl || !semEl || !container) return;

    const subject = subjEl.value;
    if (!subject) return;
    if (!state.adminPin) {
      container.innerHTML = '<div class="text-center text-slate-400 py-12">Log in as teacher to preview.</div>';
      return;
    }

    // Auto-fill detail fields if empty (first time on this tab)
    const subjInput = document.getElementById('gs-display-subject');
    if (subjInput && !subjInput.value.trim()) {
      App.gsPrefillDetails();
    }

    container.innerHTML = '<div class="text-center text-slate-400 py-12">Loading preview…</div>';
    try {
      container.innerHTML = await buildGradingSheetHTML(subject, secEl.value, semEl.value, 'preview');
    } catch (e) {
      console.error(e);
      container.innerHTML = '<div class="text-center text-rose-500 py-12">Failed to load preview.</div>';
      App.showToast("Could not load grading sheet.", "error");
    }
  };

  App.printGradingSheets = async function () {
    const subjEl = document.getElementById('gs-subject');
    const secEl = document.getElementById('gs-section');
    const semEl = document.getElementById('gs-semester');
    const printArea = document.getElementById('grading-sheet-print-area');
    if (!subjEl || !printArea) return;

    const subject = subjEl.value;
    if (!subject) { App.showToast("Pick a subject first.", "error"); return; }

    printArea.innerHTML = '<div class="text-center text-slate-400 py-6">Preparing…</div>';
    try {
      printArea.innerHTML = await buildGradingSheetHTML(subject, secEl.value, semEl.value, 'print');
      window.print();
    } catch (e) {
      console.error(e);
      App.showToast("Could not prepare print view.", "error");
      printArea.innerHTML = '';
    }
  };

})(window.App);