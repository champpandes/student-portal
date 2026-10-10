(function (App) {
  'use strict';

  const state = App.state;

  // ============================================================
  // Modal open/close
  // ============================================================
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

    ['col-id-reg','col-name','col-sec','col-id-grades'].forEach(id => {
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

  // ============================================================
  // Toggle UI + populate grade columns
  // ============================================================
  App.toggleImportUI = function () {
    const isGrades = document.getElementById('import-action').value === 'grades';
    document.getElementById('import-quarter-container').classList.toggle('hidden', !isGrades);
    document.getElementById('col-mapping-register').classList.toggle('hidden', isGrades);
    document.getElementById('col-mapping-grades').classList.toggle('hidden', !isGrades);
    if (isGrades) App.populateGradeColumnMappings();
  };

  App.populateGradeColumnMappings = function () {
    const container = document.getElementById('grade-category-cols');
    if (!container) return;

    const subject = document.getElementById('import-subject').value;
    const cats = (state.subjectCategories && state.subjectCategories[subject]) || [];

    if (!subject || cats.length === 0) {
      container.innerHTML = '<div class="text-xs text-rose-500 font-bold py-2">Pick a subject with at least one category first.</div>';
      return;
    }

    // Preserve existing input values by category ID
    const existing = {};
    container.querySelectorAll('[data-category-id]').forEach(inp => {
      existing[inp.dataset.categoryId] = inp.value;
    });

    // Render one row per category
    container.innerHTML = cats
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((cat, idx) => {
        const inputId = 'gcol-' + cat.id;
        const prevVal = existing[String(cat.id)] || '';
        return '<div class="flex items-center gap-3">' +
          '<label for="' + inputId + '" class="flex-1 min-w-0 text-xs font-bold text-slate-700 truncate" title="' + App.esc(cat.name) + '">' +
            App.esc(cat.name) +
            ' <span class="text-slate-400 font-medium">(' + App.esc(cat.weight) + '%)</span>' +
          '</label>' +
          '<input type="text" id="' + inputId + '" ' +
                 'data-category-id="' + cat.id + '" ' +
                 'placeholder="' + String.fromCharCode(66 + idx) + '" ' +
                 'value="' + App.esc(prevVal) + '" ' +
                 'class="w-20 shrink-0 bg-white border border-slate-200 rounded-lg p-2 text-center text-xs font-bold uppercase outline-none focus:border-indigo-600">' +
        '</div>';
      })
      .join('');
  };

  // ============================================================
  // Parsers
  // ============================================================
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

  // Convert "A" → 0, "B" → 1, "AA" → 26, etc.
  function colLetterToIndex(letter) {
    const v = String(letter || '').trim().toUpperCase();
    if (!v) return -1;
    let n = 0;
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c < 65 || c > 90) return -1;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  function getInputColIndex(id) {
    const el = document.getElementById(id);
    if (!el) return -1;
    return colLetterToIndex(el.value);
  }

  // ============================================================
  // Preview
  // ============================================================
  App.previewDataTransfer = async function () {
    const btn = document.getElementById('preview-btn');
    const action = document.getElementById('import-action').value;
    const fileInput = document.getElementById('csv-file-input');
    const pasteInput = document.getElementById('smart-paste-input').value;
    const status = document.getElementById('transfer-status');
    const previewSection = document.getElementById('preview-section');
    const thead = document.getElementById('preview-thead');
    const tbody = document.getElementById('preview-table-body');

    status.classList.add('hidden');
    previewSection.classList.add('hidden');
    state.pendingImportData = [];

    if (!fileInput.files.length && !pasteInput.trim()) {
      App.showToast("Provide a CSV file or paste data.", "error");
      return;
    }

    await App.withButtonLoading(btn, async () => {
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
          const cId = getInputColIndex('col-id-reg');
          const cName = getInputColIndex('col-name');
          const cSec = getInputColIndex('col-sec');
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
          const cId = getInputColIndex('col-id-grades');
          if (cId < 0) throw new Error("Student ID column is required.");

          const catInputs = Array.from(document.querySelectorAll('#grade-category-cols [data-category-id]'));
          const catCols = catInputs.map(inp => ({
            categoryId: Number(inp.dataset.categoryId),
            name: (state.subjectCategories[subj] || []).find(c => String(c.id) === inp.dataset.categoryId)?.name || 'Category',
            colIndex: colLetterToIndex(inp.value)
          })).filter(c => c.colIndex >= 0);

          if (catCols.length === 0) {
            throw new Error("Map at least one category column.");
          }

          let headHTML = '<tr><th class="p-3 font-bold">Student No.</th>';
          catCols.forEach(c => {
            headHTML += '<th class="p-3 font-bold text-center">' + App.esc(c.name) + '</th>';
          });
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

            const entries = catCols.map(c => ({
              categoryId: c.categoryId,
              value: c.colIndex >= 0 && cols[c.colIndex] !== undefined && cols[c.colIndex] !== ''
                ? Number(cols[c.colIndex]) || 0
                : ''
            }));

            state.pendingImportData.push({
              studentNumber: cleanNo,
              entries: entries
            });

            let rowHTML = '<tr class="hover:bg-slate-50 transition-colors">' +
              '<td class="p-3 border-b border-slate-100 font-semibold">' + App.esc(cleanNo) + '</td>';
            entries.forEach(e => {
              rowHTML += '<td class="p-3 border-b border-slate-100 font-bold text-center">' +
                (e.value === '' ? '—' : App.esc(e.value)) +
              '</td>';
            });
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
    }, { text: 'Reading...' });
  };

  // ============================================================
  // Confirm / Import
  // ============================================================
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

        const res = await App.apiCall({
          action: "bulkSaveBreakdown", pin: state.adminPin,
          subject: subj, quarter: qtr,
          items: state.pendingImportData
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

  // ============================================================
  // CSV Export
  // ============================================================
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

  // ============================================================
  // XLSX Export
  // ============================================================
  const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';

  function loadSheetJS() {
    return new Promise((resolve, reject) => {
      if (window.XLSX) return resolve(window.XLSX);
      const existing = document.querySelector('script[data-sheetjs]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.XLSX));
        existing.addEventListener('error', () => reject(new Error("SheetJS failed to load.")));
        return;
      }
      const script = document.createElement('script');
      script.src = SHEETJS_URL;
      script.async = true;
      script.setAttribute('data-sheetjs', '1');
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => reject(new Error("Could not load SheetJS from CDN."));
      document.head.appendChild(script);
    });
  }

  App.exportTableToXLSX = async function (filename) {
    if (!state.currentAdminData || state.currentAdminData.length === 0) {
      App.showToast("No data to export.", "error");
      return;
    }

    const btn = document.getElementById('xlsx-export-btn');

    await App.withButtonLoading(btn, async () => {
      try {
        const XLSX = await loadSheetJS();

        const headers = [
          "Student Number","Full Name","Section","Subject",
          "1st Quarter","2nd Quarter","3rd Quarter","4th Quarter",
          "Final Grade","Remarks"
        ];

        const rows = [headers];
        state.currentAdminData.forEach(s => {
          rows.push([
            s.studentNumber || '',
            s.name || '',
            s.section || '',
            s.subject || '',
            s.q1 || '', s.q2 || '', s.q3 || '', s.q4 || '',
            s.final || '',
            s.remarks || ''
          ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);

        ws['!cols'] = [
          { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 24 },
          { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
          { wch: 10 }, { wch: 10 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Records');

        XLSX.writeFile(wb, filename);
        App.showToast("Excel file downloaded!");
      } catch (e) {
        console.error(e);
        App.showToast(e.message || 'XLSX export failed.', 'error');
      }
    }, { text: 'Building...' });
  };

})(window.App);