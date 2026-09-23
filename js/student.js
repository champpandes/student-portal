(function (App) {
  'use strict';

  const state = App.state;

  App.initializeStudentDropdowns = function (subjectsArr) {
    const sySelect = document.getElementById('student-sy-selector');
    const subjSelect = document.getElementById('student-subject-selector');

    const years = [];
    const seen = {};
    let hasSYFormat = false;

    subjectsArr.forEach(s => {
      const match = s.match(/\(SY.*?\)/i);
      let key;
      if (match) { key = match[0]; hasSYFormat = true; }
      else key = "General Subjects";
      if (!seen[key]) { seen[key] = true; years.push(key); }
    });

    if (hasSYFormat) {
      sySelect.classList.remove('hidden');
      const sorted = years.slice().sort().reverse();
      sySelect.innerHTML = sorted.map(y =>
        '<option value="' + App.esc(y) + '">' + App.esc(y) + '</option>').join('');
      App.changeStudentSY(sorted[0]);
    } else {
      sySelect.classList.add('hidden');
      subjSelect.innerHTML = subjectsArr.map(s =>
        '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');
      App.changeStudentSubject(subjectsArr[0]);
    }
  };

  App.changeStudentSY = function (selectedYear) {
    const subjSelect = document.getElementById('student-subject-selector');
    const allSubjects = Object.keys(state.currentStudentData.subjects);
    let filtered;

    if (selectedYear === "General Subjects") {
      filtered = allSubjects.filter(s => !s.match(/\(SY.*?\)/i));
    } else {
      filtered = allSubjects.filter(s => s.indexOf(selectedYear) !== -1);
    }

    if (filtered.length === 0) {
      subjSelect.innerHTML = '<option>No subjects found</option>';
      document.getElementById('student-main-grades').innerHTML = '';
      return;
    }

    subjSelect.innerHTML = filtered.map(s => {
      const label = s.replace(' ' + selectedYear, '').replace(selectedYear, '');
      return '<option value="' + App.esc(s) + '">' + App.esc(label) + '</option>';
    }).join('');
    App.changeStudentSubject(filtered[0]);
  };

  App.changeStudentSubject = function (subject) {
    state.activeStudentSubject = subject;
    App.renderStudentDashboard(subject);
  };

  App.renderStudentDashboard = function (subject) {
    const g = state.currentStudentData.subjects[subject].grades;
    const q1 = App.getEquivalentGrade(g.q1);
    const q2 = App.getEquivalentGrade(g.q2);
    const q3 = App.getEquivalentGrade(g.q3);
    const q4 = App.getEquivalentGrade(g.q4);
    const fin = App.getEquivalentGrade(g.final);

    const card = (label, val, eqv, quarter) =>
      '<button type="button" data-quarter="' + quarter + '" data-subject="' + App.esc(subject) + '" ' +
             'class="bg-white border border-slate-200 hover:border-indigo-300 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md flex flex-col items-center justify-center cursor-pointer transition-colors text-left">' +
        '<span class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">' + label + '</span>' +
        '<span class="text-2xl sm:text-3xl font-black text-slate-800">' + (App.esc(val) || '-') + '</span>' +
        '<span class="text-[11px] font-bold text-indigo-600 mt-1">Eqv: ' + eqv + '</span>' +
      '</button>';

    document.getElementById('student-main-grades').innerHTML =
      '<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-6">' +
        card('1st Quarter', g.q1, q1, '1st') +
        card('2nd Quarter', g.q2, q2, '2nd') +
        card('3rd Quarter', g.q3, q3, '3rd') +
        card('4th Quarter', g.q4, q4, '4th') +
        '<div class="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl p-4 sm:p-5 shadow-md flex flex-col items-center justify-center text-white">' +
          '<span class="text-[10px] sm:text-xs font-bold text-indigo-100 uppercase tracking-wider mb-1">Final Grade</span>' +
          '<span class="text-3xl sm:text-4xl font-black">' + (App.esc(g.final) || '-') + '</span>' +
          '<span class="text-[11px] font-bold text-indigo-200 mt-1">Eqv: ' + fin + '</span>' +
        '</div>' +
        '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center">' +
          '<span class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Status</span>' +
          App.remarksBadge(g.remarks) +
        '</div>' +
      '</div>';
  };

  /* ============================================================
     PRINT — Student grade report
     ============================================================ */
  App.printStudentGrades = function () {
    if (!state.currentStudentData || !state.activeStudentSubject) {
      App.showToast("No grades to print yet.", "error");
      return;
    }

    const subject = state.activeStudentSubject;
    const data = state.currentStudentData.subjects[subject];
    if (!data) {
      App.showToast("Subject data not found.", "error");
      return;
    }

    const g = data.grades;
    const clean = subject.replace(/\(SY.*?\)/i, '').trim();
    const student = state.currentStudentData;
    const credit = App.DEVELOPER_CREDIT;

    const rows = [
      ['1st Quarter', g.q1],
      ['2nd Quarter', g.q2],
      ['3rd Quarter', g.q3],
      ['4th Quarter', g.q4]
    ];

    const html =
      '<div class="gs-print-doc">' +
        '<div style="text-align:center; font-weight:bold; font-size:15px;">' + App.esc(credit.school) + '</div>' +
        '<div style="text-align:center; font-size:11px; margin-bottom:2px;">' + App.esc(credit.schoolLocation) + '</div>' +
        '<div style="text-align:center; font-weight:bold; font-size:13px; margin-bottom:16px; text-decoration:underline;">STUDENT GRADE REPORT</div>' +

        '<table style="width:100%; font-size:12px; margin-bottom:14px;">' +
          '<tr>' +
            '<td style="text-align:left; padding:3px 0;"><b>Student:</b> ' + App.esc(student.name) + '</td>' +
            '<td style="text-align:right; padding:3px 0;"><b>ID:</b> ' + App.esc(student.studentNumber) + '</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="text-align:left; padding:3px 0;"><b>Subject:</b> ' + App.esc(clean) + '</td>' +
            '<td style="text-align:right; padding:3px 0;"><b>Section:</b> ' + App.esc(student.section || '-') + '</td>' +
          '</tr>' +
        '</table>' +

        '<table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:16px;">' +
          '<thead>' +
            '<tr>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:left;">Period</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:100px;">Grade</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:110px;">Equivalent</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' +
            rows.map(r =>
              '<tr>' +
                '<td style="border:1px solid #000; padding:6px;">' + r[0] + '</td>' +
                '<td style="border:1px solid #000; padding:6px; text-align:center;">' + (App.esc(r[1]) || '-') + '</td>' +
                '<td style="border:1px solid #000; padding:6px; text-align:center;">' + App.getEquivalentGrade(r[1]) + '</td>' +
              '</tr>'
            ).join('') +
            '<tr style="background:#f8fafc; font-weight:bold;">' +
              '<td style="border:1px solid #000; padding:6px;">FINAL GRADE</td>' +
              '<td style="border:1px solid #000; padding:6px; text-align:center;">' + (App.esc(g.final) || '-') + '</td>' +
              '<td style="border:1px solid #000; padding:6px; text-align:center;">' + App.getEquivalentGrade(g.final) + '</td>' +
            '</tr>' +
          '</tbody>' +
        '</table>' +

        '<div style="font-size:12px; margin-bottom:20px;">' +
          '<b>Remarks:</b> ' + (App.esc(g.remarks) || '-') +
        '</div>' +

        '<div style="font-size:10px; color:#666; margin-top:30px; padding-top:10px; border-top:1px solid #ccc;">' +
          'Generated: ' + new Date().toLocaleString() +
        '</div>' +

        '<div style="font-size:9px; color:#888; margin-top:8px; text-align:center;">' +
          'Web Application developed by <b>' + App.esc(credit.developer) + '</b>' +
          ' &bull; ' + App.esc(credit.school) +
        '</div>' +
      '</div>';

    const printArea = document.getElementById('student-print-area');
    if (!printArea) return;
    printArea.innerHTML = html;
    window.print();
  };

  // ---------- Breakdown ----------
  App.openAdminBreakdown = async function (cell, studentNumber, subject, quarter) {
    const original = cell.textContent;
    cell.textContent = "...";
    try {
      const res = await App.apiCall({
        action: "getStudent", studentNumber: studentNumber
      }, { retries: 1 });

      if (res && res.studentNumber) {
        state.currentStudentData = res;
        App.openBreakdown(quarter, subject);
      } else {
        App.showToast((res && res.message) || "Could not load breakdown.", "error");
      }
    } catch (e) {
      App.showToast("Could not load breakdown.", "error");
    } finally {
      cell.textContent = original;
    }
  };

  App.openBreakdown = function (quarter, subject) {
    const qNum = quarter.replace(/\D/g, '');
    const breakdown = state.currentStudentData.subjects[subject].breakdowns
      .find(b => String(b.quarter).indexOf(qNum) !== -1);

    document.getElementById('breakdown-title').textContent = quarter + ' Quarter Details';
    document.getElementById('breakdown-subject-label').textContent =
      subject.replace(/\(SY.*?\)/i, '').trim() + ' Component View';

    const w = state.subjectWeights[subject] || { quizzes: 35, participation: 15, attendance: 10, exams: 40 };
    const val = k => {
      if (!breakdown || breakdown[k] === "" || breakdown[k] === null || breakdown[k] === undefined) return '-';
      return breakdown[k];
    };

    let html = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4" id="breakdown-grid-row">' +
      '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center" data-field="quizzes">' +
        '<span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">Quizzes (' + App.esc(w.quizzes) + '%)</span>' +
        '<span class="text-xl sm:text-2xl font-black text-slate-800 value-text">' + App.esc(val('quizzes')) + '</span>' +
      '</div>' +
      '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center" data-field="participation">' +
        '<span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">Participation (' + App.esc(w.participation) + '%)</span>' +
        '<span class="text-xl sm:text-2xl font-black text-slate-800 value-text">' + App.esc(val('participation')) + '</span>' +
      '</div>' +
      '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center" data-field="attendance">' +
        '<span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">Attendance (' + App.esc(w.attendance) + '%)</span>' +
        '<span class="text-xl sm:text-2xl font-black text-slate-800 value-text">' + App.esc(val('attendance')) + '</span>' +
      '</div>' +
      '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center" data-field="exams">' +
        '<span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">Exams (' + App.esc(w.exams) + '%)</span>' +
        '<span class="text-xl sm:text-2xl font-black text-slate-800 value-text">' + App.esc(val('exams')) + '</span>' +
      '</div>' +
      '<div class="col-span-2 sm:col-span-1 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center">' +
        '<span class="text-[10px] sm:text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1 sm:mb-2">Total</span>' +
        '<span class="text-2xl sm:text-3xl font-black text-indigo-700" id="bd-total">' + App.esc(val('total')) + '</span>' +
      '</div>' +
    '</div>';

    if (state.adminPin !== "") {
      html += '<div class="mt-8 pt-6 border-t border-slate-100 flex justify-end no-print">' +
        '<button data-action="toggle-edit" data-quarter="' + App.esc(quarter) + '" data-subject="' + App.esc(subject) + '" ' +
                'class="w-full sm:w-auto bg-white border border-slate-200 text-slate-700 px-6 py-2.5 rounded-xl hover:bg-slate-50 shadow-sm font-semibold transition-colors text-sm">' +
          'Edit Breakdown' +
        '</button>' +
      '</div>';
    }

    document.getElementById('breakdown-content').innerHTML = html;
    App.showScreen('breakdown');
  };

  App.toggleBreakdownEdit = async function (btn, quarter, subject) {
    const grid = document.getElementById('breakdown-grid-row');
    const isEditing = btn.textContent.indexOf('Save') === -1;

    if (isEditing) {
      ['quizzes','participation','attendance','exams'].forEach(f => {
        const t = grid.querySelector('div[data-field="' + f + '"] .value-text');
        const current = t.textContent === '-' ? '' : t.textContent;
        t.innerHTML = '<input type="number" class="w-16 sm:w-20 border-2 border-indigo-200 rounded-lg px-2 py-1 text-center bg-white outline-none text-base" value="' + App.esc(current) + '">';
      });
      btn.textContent = "Save Changes";
      btn.className = "w-full sm:w-auto bg-emerald-600 text-white px-6 py-2.5 rounded-xl hover:bg-emerald-700 shadow-md font-semibold transition-colors text-sm";
      return;
    }

    btn.textContent = "Saving...";
    btn.disabled = true;

    const bd = {};
    ['quizzes','participation','attendance','exams'].forEach(f => {
      bd[f] = Number(grid.querySelector('div[data-field="' + f + '"] .value-text input').value || 0);
    });
    const weights = state.subjectWeights[subject] || { quizzes: 35, participation: 15, attendance: 10, exams: 40 };

    const res = await App.apiCall({
      action: "saveBreakdown", pin: state.adminPin,
      studentNumber: state.currentStudentData.studentNumber,
      subject: subject, quarter: quarter, breakdown: bd, weights: weights
    }, { retries: 1 });

    if (res.success) {
      document.getElementById('bd-total').textContent = res.newTotal;
      ['quizzes','participation','attendance','exams'].forEach(f => {
        grid.querySelector('div[data-field="' + f + '"] .value-text').textContent = bd[f];
      });
      btn.textContent = "Edit Breakdown";
      btn.className = "w-full sm:w-auto bg-white border border-slate-200 text-slate-700 px-6 py-2.5 rounded-xl hover:bg-slate-50 shadow-sm font-semibold transition-colors text-sm";
      btn.disabled = false;
      App.showToast("Breakdown updated.");
      App.invalidateActiveCache();
      App.updateLastSavedTimestamp();
      await App.loadAdminDashboard();
    } else {
      App.showToast(res.message || "Failed to save.", "error");
      btn.textContent = "Save Changes";
      btn.disabled = false;
    }
  };

})(window.App);