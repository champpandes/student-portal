(function (App) {
  'use strict';

  const state = App.state;

  // No longer needed since we removed the dropdowns
  App.initializeStudentDropdowns = function () {};

  App.renderStudentDashboard = function () {
    const container = document.getElementById('student-main-grades');
    if (!container) return;

    if (!state.currentStudentData || !state.currentStudentData.subjects) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold">No subjects assigned.</div>';
      return;
    }

    const subjects = Object.entries(state.currentStudentData.subjects);
    if (subjects.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold">You are not enrolled in any subjects yet. Please contact your teacher.</div>';
      return;
    }

    let html = '<div class="overflow-x-auto w-full">';
    html += '<table class="w-full text-left border-collapse">';
    html += '<thead><tr class="bg-slate-50 border-b border-slate-200 text-slate-400 text-[11px] font-black uppercase tracking-wider">';
    html += '<th class="p-4">Subject</th>';
    html += '<th class="p-4 text-center">1st Qtr</th><th class="p-4 text-center">2nd Qtr</th><th class="p-4 text-center">3rd Qtr</th><th class="p-4 text-center">4th Qtr</th>';
    html += '<th class="p-4 text-center">Final</th><th class="p-4 text-center">Remarks</th>';
    html += '</tr></thead><tbody class="divide-y divide-slate-100 text-sm">';

    subjects.forEach(([subjName, data]) => {
      const g = data.grades;
      
      const qCell = (quarter, val) => {
        const display = (val === undefined || val === null || val === '') ? '-' : val;
        return '<td class="p-4 text-center col-q col-q-' + quarter.toLowerCase() + '">' +
          '<button type="button" data-quarter="' + quarter + '" data-subject="' + App.esc(subjName) + '" class="text-indigo-600 font-bold hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1">' +
            App.esc(display) +
          '</button></td>';
      };

      html += '<tr class="hover:bg-slate-50/50 transition-colors">';
      html += '<td class="p-4 font-bold text-slate-800">' + App.esc(subjName) + '</td>';
      html += qCell('1st', g.q1) + qCell('2nd', g.q2) + qCell('3rd', g.q3) + qCell('4th', g.q4);
      html += '<td class="p-4 text-center font-black text-lg">' + (App.esc(g.final) || '-') + '</td>';
      html += '<td class="p-4 text-center">' + App.remarksBadge(g.remarks) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  };

  App.printStudentGrades = function () {
    if (!state.currentStudentData || !state.currentStudentData.subjects) {
      App.showToast("No grades to print yet.", "error");
      return;
    }

    const student = state.currentStudentData;
    const credit = App.DEVELOPER_CREDIT;
    const subjects = Object.entries(student.subjects);

    if (subjects.length === 0) {
      App.showToast("No subjects to print.", "error");
      return;
    }

    let rowsHtml = '';
    subjects.forEach(([subjName, data]) => {
      const g = data.grades;
      const clean = subjName.replace(/\(SY.*?\)/i, '').trim();
      rowsHtml += '<tr>' +
        '<td style="border:1px solid #000; padding:6px; text-align:left;">' + App.esc(clean) + '</td>' +
        '<td style="border:1px solid #000; padding:6px; text-align:center;">' + (App.esc(g.q1) || '-') + '</td>' +
        '<td style="border:1px solid #000; padding:6px; text-align:center;">' + (App.esc(g.q2) || '-') + '</td>' +
        '<td style="border:1px solid #000; padding:6px; text-align:center;">' + (App.esc(g.q3) || '-') + '</td>' +
        '<td style="border:1px solid #000; padding:6px; text-align:center;">' + (App.esc(g.q4) || '-') + '</td>' +
        '<td style="border:1px solid #000; padding:6px; text-align:center; font-weight:bold;">' + (App.esc(g.final) || '-') + '</td>' +
        '<td style="border:1px solid #000; padding:6px; text-align:center; font-weight:bold;">' + App.getEquivalentGrade(g.final) + '</td>' +
        '<td style="border:1px solid #000; padding:6px; text-align:center;">' + (App.esc(g.remarks) || '-') + '</td>' +
      '</tr>';
    });

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
            '<td style="text-align:left; padding:3px 0;"><b>Section:</b> ' + App.esc(student.section || '-') + '</td>' +
          '</tr>' +
        '</table>' +
        '<table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">' +
          '<thead>' +
            '<tr>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:left;">Subject</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:50px;">1st</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:50px;">2nd</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:50px;">3rd</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:50px;">4th</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:50px;">Final</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:50px;">EQV</th>' +
              '<th style="border:1px solid #000; padding:6px; background:#f1f5f9; text-align:center; width:70px;">Remarks</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
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
    const breakdowns = state.currentStudentData.subjects[subject].breakdowns || [];
    const breakdown = breakdowns.find(b => String(b.quarter).indexOf(qNum) !== -1);

    document.getElementById('breakdown-title').textContent = quarter + ' Quarter Details';
    document.getElementById('breakdown-subject-label').textContent =
      subject.replace(/\(SY.*?\)/i, '').trim() + ' Component View';

    const cats = state.subjectCategories[subject] || [];
    if (cats.length === 0) {
      document.getElementById('breakdown-content').innerHTML =
        '<div class="p-8 text-center text-slate-400 font-bold">No categories configured for this subject. Add categories in the Subjects tab.</div>';
      App.showScreen('breakdown');
      return;
    }

    const catValues = (breakdown && breakdown.categories) ? breakdown.categories : {};
    const val = (id) => {
      const v = catValues[String(id)];
      if (v === undefined || v === null || v === '') return '-';
      return v;
    };
    const totalVal = (breakdown && breakdown.total !== undefined && breakdown.total !== '')
      ? breakdown.total : '-';

    let html = '<div id="breakdown-grid-row" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem;">';
    cats.forEach(c => {
      html += '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center min-h-[100px]" data-field="' + c.id + '">' +
        '<span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2 text-center leading-tight">' +
          App.esc(c.name) + ' (' + App.esc(c.weight) + '%)' +
        '</span>' +
        '<span class="text-xl sm:text-2xl font-black text-slate-800 value-text">' + App.esc(val(c.id)) + '</span>' +
      '</div>';
    });
    html += '</div>';

    html += '<div class="mt-3 bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4 flex items-center justify-between">' +
      '<span class="text-xs sm:text-sm font-black text-indigo-600 uppercase tracking-wider">Weighted Total</span>' +
      '<span class="text-3xl sm:text-4xl font-black text-indigo-700" id="bd-total">' + App.esc(totalVal) + '</span>' +
    '</div>';

    if (state.adminPin !== "" || state.currentTeacher) {
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
    const cats = state.subjectCategories[subject] || [];

    if (cats.length === 0) return;

    if (isEditing) {
      cats.forEach(c => {
        const t = grid.querySelector('div[data-field="' + c.id + '"] .value-text');
        const current = t.textContent === '-' ? '' : t.textContent;
        t.innerHTML = '<input type="number" data-cat-id="' + c.id + '" ' +
          'class="w-20 border-2 border-indigo-200 rounded-lg px-2 py-1 text-center bg-white outline-none text-base" ' +
          'value="' + App.esc(current) + '">';
      });
      btn.textContent = "Save Changes";
      btn.className = "w-full sm:w-auto bg-emerald-600 text-white px-6 py-2.5 rounded-xl hover:bg-emerald-700 shadow-md font-semibold transition-colors text-sm";
      return;
    }

    const originalText = btn.textContent;
    const originalClass = btn.className;
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-wait');
    btn.innerHTML = '<span class="inline-flex items-center gap-2"><span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span><span>Saving...</span></span>';

    try {
      const entries = cats.map(c => {
        const inp = grid.querySelector('input[data-cat-id="' + c.id + '"]');
        const raw = inp ? inp.value.trim() : '';
        return { categoryId: c.id, value: raw === '' ? '' : Number(raw) };
      });

      const res = await App.apiCall({
        action: "saveBreakdown",
        pin: state.adminPin,
        studentNumber: state.currentStudentData.studentNumber,
        subject: subject,
        quarter: quarter,
        entries: entries
      }, { retries: 1 });

      if (res.success) {
        document.getElementById('bd-total').textContent = res.newTotal;
        cats.forEach(c => {
          const t = grid.querySelector('div[data-field="' + c.id + '"] .value-text');
          const e = entries.find(x => String(x.categoryId) === String(c.id));
          t.textContent = (e.value === '' || e.value === null) ? '-' : e.value;
        });
        App.showToast("Breakdown updated.");
        App.invalidateActiveCache();
        App.updateLastSavedTimestamp();
        await App.loadAdminDashboard();

        btn.textContent = "Edit Breakdown";
        btn.className = "w-full sm:w-auto bg-white border border-slate-200 text-slate-700 px-6 py-2.5 rounded-xl hover:bg-slate-50 shadow-sm font-semibold transition-colors text-sm";
      } else {
        App.showToast(res.message || "Failed to save.", "error");
        btn.textContent = originalText;
        btn.className = originalClass;
      }
    } catch (e) {
      App.showToast(e.message || "Failed to save.", "error");
      btn.textContent = originalText;
      btn.className = originalClass;
    } finally {
      btn.disabled = false;
      btn.classList.remove('opacity-60', 'cursor-wait');
    }
  };

})(window.App);