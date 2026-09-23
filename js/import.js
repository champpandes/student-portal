(function (App) {
  'use strict';

  const state = App.state;

  // ---------- Modal ----------
  App.openImportModal = function () {
    document.getElementById('transfer-status').classList.add('hidden');
    document.getElementById('preview-section').classList.add('hidden');
    document.getElementById('progress-container').classList.add('hidden');
    document.getElementById('preview-btn').classList.remove('hidden');
    document.getElementById('confirm-btn').classList.add('hidden');

    const cancel = document.getElementById('import-cancel-btn');
    cancel.innerText = "Cancel";
    cancel.disabled = false;

    document.getElementById('csv-file-input').value = '';
    document.getElementById('smart-paste-input').value = '';

    ['col-id-reg','col-name','col-sec','col-id-grades','col-quiz','col-part','col-att','col-exam']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

    state.pendingImportData = [];
    App.toggleImportUI();
    App.openModal(document.getElementById('import-modal'));
  };

  App.closeImportModal = function () {
    App.closeModal(document.getElementById('import-modal'));
  };

  App.toggleImportUI = function () {
    const isGrades = document.getElementById('import-action').value === 'grades';
    document.getElementById('import-quarter-container').classList.toggle('hidden', !isGrades);
    document.getElementById('col-mapping-register').classList.toggle('hidden', isGrades);
    document.getElementById('col-mapping-grades').classList.toggle('hidden', !isGrades);
  };

  // ---------- Parsers ----------
  function readCSVFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = () => reject(new Error("Could not read file."));
      r.readAsText(file);
    });
  }

  function parseCSV(str) {
    const result = [];
    let cell = '', inQuotes = false;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '"' && str[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = !inQuotes;
      else if (c === ',' && !inQuotes) { result.push(cell.trim()); cell = ''; }
      else cell += c;
    }
    result.push(cell.trim());
    return result;
  }

  function colToIndex(id) {
    const v = document.getElementById(id).value.trim().toUpperCase();
    if (!v) return -1;
    return v.charCodeAt(0) - 65;
  }

  // ---------- Preview ----------
  App.previewDataTransfer = async function () {
    const action = document.getElementById('import-action').value;
    const fileInput = document.getElementById('csv-file-input');
    const pasteInput = document.getElementById('smart-paste-input').value;
    const status = document.getElementById('transfer-status');
    const previewSection = document.getElementById('preview-section');
    const thead = document.getElementById('preview-thead');
    const tbody = document.getElementById('preview-table-body');
    const btn = document.getElementById('preview-btn');

    status.classList.add('hidden');
    previewSection.classList.add('hidden');
    state.pendingImportData = [];

    if (!fileInput.files.length && !pasteInput.trim()) {
      App.showToast("Provide a CSV file or paste data.", "error");
      return;
    }

    const original = btn.innerHTML;
    btn.innerHTML = "Reading...";
    btn.disabled = true;

    try {
      const subj = document.getElementById('import-subject').value;
      let rawRows = [];
      let isPaste = false;

      if (pasteInput.trim()) {
        rawRows = pasteInput.trim().split('\n');
        isPaste = true;
      } else {
        rawRows = (await readCSVFile(fileInput.files[0])).split('\n');
      }

      tbody.innerHTML = '';
      const startRow = isPaste ? 0 : 1;

      if (action === 'register') {
        const cId = colToIndex('col-id-reg');
        const cName = colToIndex('col-name');
        const cSec = colToIndex('col-sec');
        if (cId < 0 || cName < 0) throw new Error("ID and Name columns are required.");

        thead.innerHTML = '<tr>' +
          '<th class="p-3 font-bold">Student No.</th>' +
          '<th class="p-3 font-bold">Name</th>' +
          (cSec >= 0 ? '<th class="p-3 font-bold">Section</th>' : '') +
        '</tr>';

        for (let i = startRow; i < rawRows.length; i++) {
          if (!rawRows[i].trim()) continue;
          const cols = isPaste
            ? rawRows[i].split('\t').map(c => c.trim().replace(/^"|"$/g, ''))
            : parseCSV(rawRows[i]);
          if (!cols[cId] || !cols[cName]) continue;
          if (String(cols[cId]).toLowerCase().indexOf('student') !== -1) continue;

          const cleanNo = String(cols[cId]).trim();
          const name = String(cols[cName]).trim();
          const sec = cSec >= 0 ? String(cols[cSec] || '').trim() : '';

          state.pendingImportData.push({
            studentNumber: cleanNo, name: name, section: sec, enrolledSubjects: [subj]
          });

          tbody.insertAdjacentHTML('beforeend',
            '<tr class="hover:bg-slate-50 transition-colors">' +
              '<td class="p-3 border-b border-slate-100 font-semibold">' + App.esc(cleanNo) + '</td>' +
              '<td class="p-3 border-b border-slate-100 font-bold text-slate-700">' + App.esc(name) + '</td>' +
              (cSec >= 0 ? '<td class="p-3 border-b border-slate-100 text-slate-500">' + App.esc(sec) + '</td>' : '') +
            '</tr>');
        }
      } else {
        const cId = colToIndex('col-id-grades');
        const cQz = colToIndex('col-quiz');
        const cPa = colToIndex('col-part');
        const cAt = colToIndex('col-att');
        const cEx = colToIndex('col-exam');

        if (cId < 0) throw new Error("Student ID column is required.");
        if (cQz < 0 && cPa < 0 && cAt < 0 && cEx < 0) throw new Error("Map at least one grade category.");

        let headHTML = '<tr><th class="p-3 font-bold">Student No.</th>';
        if (cQz >= 0) headHTML += '<th class="p-3 font-bold text-center">Quizzes</th>';
        if (cPa >= 0) headHTML += '<th class="p-3 font-bold text-center">Part.</th>';
        if (cAt >= 0) headHTML += '<th class="p-3 font-bold text-center">Att.</th>';
        if (cEx >= 0) headHTML += '<th class="p-3 font-bold text-center">Exams</th>';
        headHTML += '</tr>';
        thead.innerHTML = headHTML;

        for (let i = startRow; i < rawRows.length; i++) {
          if (!rawRows[i].trim()) continue;
          const cols = isPaste
            ? rawRows[i].split('\t').map(c => c.trim().replace(/^"|"$/g, ''))
            : parseCSV(rawRows[i]);
          if (!cols[cId]) continue;
          if (String(cols[cId]).toLowerCase().indexOf('student') !== -1) continue;

          const cleanNo = String(cols[cId]).trim();
          const item = {
            studentNumber: cleanNo,
            quizzes: cQz >= 0 ? (Number(cols[cQz]) || 0) : null,
            participation: cPa >= 0 ? (Number(cols[cPa]) || 0) : null,
            attendance: cAt >= 0 ? (Number(cols[cAt]) || 0) : null,
            exams: cEx >= 0 ? (Number(cols[cEx]) || 0) : null
          };
          state.pendingImportData.push(item);

          let rowHTML = '<tr class="hover:bg-slate-50 transition-colors">' +
            '<td class="p-3 border-b border-slate-100 font-semibold">' + App.esc(cleanNo) + '</td>';
          if (cQz >= 0) rowHTML += '<td class="p-3 border-b border-slate-100 font-bold text-center">' + App.esc(item.quizzes) + '</td>';
          if (cPa >= 0) rowHTML += '<td class="p-3 border-b border-slate-100 font-bold text-center">' + App.esc(item.participation) + '</td>';
          if (cAt >= 0) rowHTML += '<td class="p-3 border-b border-slate-100 font-bold text-center">' + App.esc(item.attendance) + '</td>';
          if (cEx >= 0) rowHTML += '<td class="p-3 border-b border-slate-100 font-bold text-center">' + App.esc(item.exams) + '</td>';
          rowHTML += '</tr>';
          tbody.insertAdjacentHTML('beforeend', rowHTML);
        }
      }

      if (state.pendingImportData.length > 0) {
        status.textContent = 'Found ' + state.pendingImportData.length + ' valid entries to process.';
        status.className = "bg-emerald-50 border border-emerald-200 text-emerald-700 mt-4 p-3 rounded-xl font-bold text-sm text-center";
        status.classList.remove('hidden');
        previewSection.classList.remove('hidden');
        btn.classList.add('hidden');
        document.getElementById('confirm-btn').classList.remove('hidden');
      } else {
        App.showToast("No valid data found. Check columns.", "error");
      }
    } catch (e) {
      App.showToast(e.message, "error");
    }
    btn.innerHTML = original;
    btn.disabled = false;
  };

  // ---------- Confirm ----------
  App.confirmDataTransfer = async function () {
    const btn = document.getElementById('confirm-btn');
    const cancelBtn = document.getElementById('import-cancel-btn');
    const status = document.getElementById('transfer-status');
    const progressContainer = document.getElementById('progress-container');

    btn.classList.add('hidden');
    cancelBtn.disabled = true;
    status.classList.add('hidden');
    progressContainer.classList.remove('hidden');

    const action = document.getElementById('import-action').value;
    const subj = document.getElementById('import-subject').value;
    const qtr = document.getElementById('import-quarter').value;
    const total = state.pendingImportData.length;

    const bar = document.getElementById('progress-bar-fill');
    const pctEl = document.getElementById('progress-percentage');
    const countEl = document.getElementById('progress-count');
    const etaEl = document.getElementById('progress-eta');

    const setProgress = (pct, label, eta) => {
      bar.style.width = pct + '%';
      pctEl.innerText = pct + '%';
      countEl.innerText = label;
      if (eta) etaEl.innerText = eta;
    };

    try {
      if (action === 'register') {
        setProgress(30, "Sending batch registration…", "Waiting for server…");
        const res = await App.apiCall({
          action: "bulkAddStudents", pin: state.adminPin,
          studentsArray: state.pendingImportData
        }, { retries: 1, timeout: 120000 });

        if (!res.success) throw new Error(res.message || "Bulk registration failed.");
        setProgress(100, 'Registered ' + total + ' entries.', "Done.");
      } else {
        setProgress(20, 'Saving ' + total + ' grade entries…', "One batch request…");

        const weights = state.subjectWeights[subj] || { quizzes: 35, participation: 15, attendance: 10, exams: 40 };
        const items = state.pendingImportData.map(item => ({
          studentNumber: item.studentNumber,
          breakdown: {
            quizzes: item.quizzes,
            participation: item.participation,
            attendance: item.attendance,
            exams: item.exams
          }
        }));

        const res = await App.apiCall({
          action: "bulkSaveBreakdown", pin: state.adminPin,
          subject: subj, quarter: qtr, weights: weights, items: items
        }, { retries: 1, timeout: 180000 });

        if (!res.success) throw new Error(res.message || "Bulk grade import failed.");
        setProgress(100, 'Processed ' + (res.processed || total) + ' of ' + total + '.', "Done.");
      }

      status.textContent = "Import complete.";
      status.className = "bg-emerald-50 border border-emerald-200 text-emerald-700 mt-4 p-3 rounded-xl font-bold text-sm text-center";
      status.classList.remove('hidden');
      cancelBtn.innerText = "Close";
      cancelBtn.disabled = false;

      App.showToast("Import complete!");
      App.invalidateActiveCache();
      await App.loadAdminDashboard();
      App.updateLastSavedTimestamp();

    } catch (error) {
      App.showToast("Import error: " + error.message, "error");
      status.textContent = error.message || "Import failed.";
      status.className = "bg-rose-50 border border-rose-200 text-rose-700 mt-4 p-3 rounded-xl font-bold text-sm text-center";
      status.classList.remove('hidden');
      btn.classList.remove('hidden');
      cancelBtn.disabled = false;
    }
  };

  // ---------- Export ----------
  App.exportTableToCSV = function (filename) {
    if (!state.currentAdminData || state.currentAdminData.length === 0) {
      App.showToast("No data to export.", "error");
      return;
    }

    const csv = [];
    csv.push([
      "Student Number","Full Name","Section","Subject",
      "1st Quarter","2nd Quarter","3rd Quarter","4th Quarter",
      "Final Grade","Remarks"
    ].join(","));

    state.currentAdminData.forEach(s => {
      csv.push([
        '"' + (s.studentNumber || '') + '"',
        '"' + String(s.name || '').replace(/"/g, '""') + '"',
        '"' + String(s.section || '').replace(/"/g, '""') + '"',
        '"' + String(s.subject || '').replace(/"/g, '""') + '"',
        s.q1 || '', s.q2 || '', s.q3 || '', s.q4 || '', s.final || '',
        '"' + (s.remarks || '') + '"'
      ].join(","));
    });

    // BOM + CRLF so Excel handles accents correctly.
    const blob = new Blob(["\uFEFF" + csv.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    App.showToast("Backup exported!");
  };

})(window.App);