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

    const student = state.currentStudentData;
    const credit = App.DEVELOPER_CREDIT;

    const remarksCell = (remarks) => {
      if (remarks === 'Passed') return '<span class="font-bold text-emerald-700">Passed</span>';
      if (remarks === 'Failed') return '<span class="font-bold text-rose-700">Failed</span>';
      return '<span class="text-slate-400">-</span>';
    };

    let desktopRowsHtml = '';
    let mobileCardsHtml = '';

    subjects.forEach(([subjName, data]) => {
      const g = data.grades;
      const clean = subjName.replace(/\(SY.*?\)/i, '').trim();

      // --- Desktop Table Row ---
      const qCell = (quarter, val) => {
        const display = (val === undefined || val === null || val === '') ? '-' : val;
        return '<td class="p-2.5 text-center border border-slate-400 whitespace-nowrap">' +
          '<button type="button" data-quarter="' + quarter + '" data-subject="' + App.esc(subjName) + '" class="text-slate-800 font-bold hover:text-indigo-600 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1">' +
            App.esc(display) +
          '</button></td>';
      };

      desktopRowsHtml += '<tr class="hover:bg-slate-50 transition-colors">' +
        '<td class="p-2.5 border border-slate-400 font-bold text-slate-800 whitespace-nowrap">' + App.esc(clean) + '</td>' +
        qCell('1st', g.q1) + qCell('2nd', g.q2) + qCell('3rd', g.q3) + qCell('4th', g.q4) +
        '<td class="p-2.5 text-center border border-slate-400 font-black text-slate-900 whitespace-nowrap">' + (App.esc(g.final) || '-') + '</td>' +
        '<td class="p-2.5 text-center border border-slate-400 font-bold text-slate-700 whitespace-nowrap">' + App.getEquivalentGrade(g.final) + '</td>' +
        '<td class="p-2.5 text-center border border-slate-400 whitespace-nowrap">' + remarksCell(g.remarks) + '</td>' +
      '</tr>';

      // --- Mobile Stacked Card ---
      const mqBox = (quarter, label, val) => {
        const display = (val === undefined || val === null || val === '') ? '-' : val;
        return '<div class="bg-slate-50 rounded-xl p-2 border border-slate-100 flex flex-col items-center justify-center">' +
          '<span class="text-[10px] font-bold text-slate-400 uppercase mb-1">' + label + '</span>' +
          '<button type="button" data-quarter="' + quarter + '" data-subject="' + App.esc(subjName) + '" class="text-base font-black text-slate-800 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-2">' +
            App.esc(display) +
          '</button></div>';
      };

      mobileCardsHtml += 
        '<div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">' +
          '<div class="bg-slate-100 border-b border-slate-200 px-4 py-3">' +
            '<h4 class="font-black text-slate-800 text-sm">' + App.esc(clean) + '</h4>' +
          '</div>' +
          '<div class="p-4">' +
            '<div class="grid grid-cols-4 gap-2 mb-4">' +
              mqBox('1st', '1st', g.q1) +
              mqBox('2nd', '2nd', g.q2) +
              mqBox('3rd', '3rd', g.q3) +
              mqBox('4th', '4th', g.q4) +
            '</div>' +
            '<div class="flex items-center justify-between border-t border-slate-100 pt-3">' +
              '<div class="flex flex-col items-center">' +
                '<span class="text-[10px] font-bold text-slate-400 uppercase mb-1">Final</span>' +
                '<span class="font-black text-slate-900 text-lg">' + (App.esc(g.final) || '-') + '</span>' +
              '</div>' +
              '<div class="flex flex-col items-center">' +
                '<span class="text-[10px] font-bold text-slate-400 uppercase mb-1">EQV</span>' +
                '<span class="font-bold text-slate-700">' + App.getEquivalentGrade(g.final) + '</span>' +
              '</div>' +
              '<div class="flex flex-col items-end">' +
                '<span class="text-[10px] font-bold text-slate-400 uppercase mb-1">Remarks</span>' +
                '<span class="text-xs">' + remarksCell(g.remarks) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    });

    const html =
      '<div class="p-4 sm:p-6 md:p-8">' +
        // ---- Document header ----
        '<div class="text-center mb-5">' +
          '<div class="font-bold text-sm sm:text-base text-slate-900">' + App.esc(credit.school) + '</div>' +
          '<div class="text-[10px] sm:text-xs text-slate-600">' + App.esc(credit.schoolLocation) + '</div>' +
          '<div class="font-bold text-xs sm:text-sm text-slate-900 mt-3 underline">STUDENT GRADE REPORT</div>' +
        '</div>' +
        // ---- Student info block ----
        '<div class="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 text-[11px] sm:text-xs text-slate-700 mb-4 pb-3 border-b border-slate-200">' +
          '<div><b>Student:</b> ' + App.esc(student.name) + '</div>' +
          '<div><b>ID:</b> ' + App.esc(student.studentNumber) + '</div>' +
          '<div><b>Section:</b> ' + App.esc(student.section || '-') + '</div>' +
        '</div>' +
        // ---- Hint ----
        '<div class="text-[10px] sm:text-[11px] text-slate-500 mb-3 italic">Tip: click any quarter grade to see its breakdown.</div>' +
        
        // ---- DESKTOP TABLE (Hidden on Mobile) ----
        '<div class="hidden md:block overflow-x-auto w-full">' +
          '<table class="w-full border-collapse text-xs sm:text-sm">' +
            '<thead>' +
              '<tr class="bg-slate-100">' +
                '<th class="p-2.5 border border-slate-400 text-left text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">Subject</th>' +
                '<th class="p-2.5 border border-slate-400 text-center text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">1st</th>' +
                '<th class="p-2.5 border border-slate-400 text-center text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">2nd</th>' +
                '<th class="p-2.5 border border-slate-400 text-center text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">3rd</th>' +
                '<th class="p-2.5 border border-slate-400 text-center text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">4th</th>' +
                '<th class="p-2.5 border border-slate-400 text-center text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">Final</th>' +
                '<th class="p-2.5 border border-slate-400 text-center text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">EQV</th>' +
                '<th class="p-2.5 border border-slate-400 text-center text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">Remarks</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + desktopRowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +

        // ---- MOBILE CARDS (Hidden on Desktop) ----
        '<div class="block md:hidden mt-2">' +
          mobileCardsHtml +
        '</div>' +

        // ---- Footer ----
        '<div class="mt-6 pt-4 border-t border-slate-200 text-[9px] sm:text-[10px] text-slate-500">' +
          'Generated: ' + new Date().toLocaleString() +
        '</div>' +
        // NEW: Split into two lines
        '<div class="mt-2 text-[8px] sm:text-[9px] text-slate-400 text-center flex flex-col gap-0.5">' +
          '<div>Web Application developed by <b>' + App.esc(credit.developer) + '</b></div>' +
          '<div>' + App.esc(credit.school) + '</div>' +
        '</div>' +
      '</div>';

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
        '<div style="font-size:9px; color:#888; margin-top:8px; text-align:center; display:flex; flex-direction:column; gap:2px;">' +
          '<div>Web Application developed by <b>' + App.esc(credit.developer) + '</b></div>' +
          '<div>' + App.esc(credit.school) + '</div>' +
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