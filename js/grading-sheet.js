(function (App) {
  'use strict';

  const state = App.state;
  const ROWS_PER_PREVIEW_PAGE = 30;

  async function getGradesFor(subject) {
    // Never fetch if not logged in as admin. This prevents a wasted
    // request at page load that returns Unauthorized and gets cached.
    if (!state.adminPin) return [];

    // Serve from cache if we have a valid (successful) previous result.
    if (state.allAdminGradesCache[subject]) {
      return state.allAdminGradesCache[subject];
    }

    const res = await App.apiCall({
      action: "getAllGrades",
      pin: state.adminPin,
      subject: subject
    }, { retries: 1, timeout: 45000 });

    // Only cache actual arrays. If the response was an error object
    // (Unauthorized, Server busy, etc.), do NOT cache it — otherwise
    // a single failure would permanently empty this subject's preview.
    if (!Array.isArray(res)) {
      console.warn("getGradesFor: non-array response for", subject, res);
      return [];
    }

    state.allAdminGradesCache[subject] = res;
    return res;
  }

  function docHeader(cleanSubject, description, semester, schoolYear) {
    return '<div style="text-align:center; font-weight:bold; font-size:15px;">Pili Capital College, Inc.</div>' +
      '<div style="text-align:center; font-size:11px; margin-bottom:2px;">San Isidro, Pili, Camarines Sur</div>' +
      '<div style="text-align:center; font-weight:bold; font-size:13px; margin-bottom:12px; text-decoration:underline;">COLLEGE GRADING SHEET</div>' +
      '<table style="width:100%; font-size:11px; margin-bottom:8px;">' +
        '<tr>' +
          '<td style="text-align:left; border:none;"><b>Subject:</b> ' + App.esc(cleanSubject) + '</td>' +
          '<td style="text-align:right; border:none;"><b>Semester:</b> ' + App.esc(semester) + '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="text-align:left; border:none;"><b>Description:</b> ' + App.esc(description) + '</td>' +
          '<td style="text-align:right; border:none;"><b>School Year:</b> ' + App.esc(schoolYear || '----------------') + '</td>' +
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
    return '<table style="width:100%; margin-top:25px; font-size:11px; border:none;">' +
      '<tr>' +
        '<td style="text-align:left; border:none;">Submitted by: <b>Carl Harry M. Pandes</b></td>' +
        '<td style="text-align:left; border:none;">Received by: _______________________</td>' +
      '</tr>' +
    '</table>';
  }

  async function buildGradingSheetHTML(subject, section, semester, mode) {
    mode = mode || 'preview';
    const all = await getGradesFor(subject);
    const students = all.filter(s =>
      s.subject === subject && (section === 'All' || s.section === section));

    if (students.length === 0) {
      return '<div class="p-8 text-center text-slate-400 bg-white rounded-xl font-bold">No students found matching this Subject and Section.</div>';
    }

    const syMatch = subject.match(/\(SY.*?\)/i);
    const schoolYear = syMatch ? syMatch[0].replace(/- Sem \d/i, '').replace(/[()]/g, '').trim() : '';
    const cleanSubject = subject.replace(/\s*\(SY.*?\)/i, '').trim();
    const description = state.subjectDescriptions[subject] || '----------------';

    if (mode === 'print') {
      const rows = students.map((s, i) => studentRow(i + 1, s)).join('');
      return '<div class="gs-print-doc">' +
        docHeader(cleanSubject, description, semester, schoolYear) +
        tableStart() + rows + '</tbody></table>' +
        docFooter() +
      '</div>';
    }

    let html = '';
    for (let i = 0; i < students.length; i += ROWS_PER_PREVIEW_PAGE) {
      const chunk = students.slice(i, i + ROWS_PER_PREVIEW_PAGE);
      let rows = '';
      for (let k = 0; k < ROWS_PER_PREVIEW_PAGE; k++) rows += studentRow(i + k + 1, chunk[k]);
      html += '<div class="gs-preview-page">' +
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

    // Skip entirely when not logged in. Prevents a wasted request on
    // page load that would return Unauthorized.
    if (!state.adminPin) {
      container.innerHTML = '<div class="text-center text-slate-400 py-12">Log in as teacher to preview.</div>';
      return;
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