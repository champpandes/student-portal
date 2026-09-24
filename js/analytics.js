(function (App) {
  'use strict';

  const state = App.state;

  App.refreshAnalytics = async function () {
    const subjectFilter = document.getElementById('analytics-subject-filter').value;
    const sectionFilter = document.getElementById('analytics-section-filter').value;

    const subjectToFetch = subjectFilter === 'All' ? 'All' : subjectFilter;

    let data;
    try {
      const res = await App.apiCall({
        action: "getAllGrades",
        pin: state.adminPin,
        subject: subjectToFetch
      }, { retries: 1, timeout: 30000 });
      data = Array.isArray(res) ? res : [];
    } catch (e) {
      console.error(e);
      App.showToast("Could not load analytics data.", "error");
      return;
    }

    // Filter
    const filtered = data.filter(s =>
      (subjectFilter === 'All' || s.subject === subjectFilter) &&
      (sectionFilter === 'All' || s.section === sectionFilter)
    );

    renderKPIs(filtered);
    renderDistribution(filtered);
    renderSections(filtered);
    renderRisk(filtered);
  };

  function renderKPIs(data) {
    const total = data.length;
    document.getElementById('analytics-total').textContent = total;

    const finals = data.map(s => Number(s.final)).filter(n => !isNaN(n) && n > 0);

    if (finals.length === 0) {
      document.getElementById('analytics-avg').textContent = '-';
      document.getElementById('analytics-pass').textContent = '0%';
      document.getElementById('analytics-risk').textContent = '0';
      return;
    }

    const avg = Math.round(finals.reduce((a, b) => a + b, 0) / finals.length);
    document.getElementById('analytics-avg').textContent = avg;

    const passed = finals.filter(f => f >= 75).length;
    document.getElementById('analytics-pass').textContent =
      Math.round((passed / finals.length) * 100) + '%';

    const atRisk = finals.filter(f => f < 78).length;
    document.getElementById('analytics-risk').textContent = atRisk;
  }

  function renderDistribution(data) {
    const container = document.getElementById('analytics-distribution');
    const finals = data.map(s => Number(s.final)).filter(n => !isNaN(n) && n > 0);

    if (finals.length === 0) {
      container.innerHTML = '<div class="text-xs text-slate-400 italic">No grade data available.</div>';
      return;
    }

    // Buckets: 0-59, 60-69, 70-74, 75-79, 80-84, 85-89, 90-94, 95-100
    const buckets = [
      { label: '95-100', min: 95, max: 100, color: 'bg-emerald-500' },
      { label: '90-94',  min: 90, max: 94,  color: 'bg-emerald-400' },
      { label: '85-89',  min: 85, max: 89,  color: 'bg-blue-400' },
      { label: '80-84',  min: 80, max: 84,  color: 'bg-indigo-400' },
      { label: '75-79',  min: 75, max: 79,  color: 'bg-amber-400' },
      { label: '70-74',  min: 70, max: 74,  color: 'bg-orange-400' },
      { label: '60-69',  min: 60, max: 69,  color: 'bg-rose-400' },
      { label: '0-59',   min: 0,  max: 59,  color: 'bg-rose-600' }
    ];

    const counts = buckets.map(b => ({
      ...b,
      count: finals.filter(f => f >= b.min && f <= b.max).length
    }));

    const max = Math.max(1, ...counts.map(c => c.count));

    container.innerHTML = counts.map(b => {
      const pct = (b.count / max) * 100;
      return '<div class="flex items-center gap-3">' +
        '<div class="w-16 text-xs font-bold text-slate-500 text-right shrink-0">' + b.label + '</div>' +
        '<div class="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">' +
          '<div class="' + b.color + ' h-full rounded-full transition-all" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="w-10 text-xs font-bold text-slate-700 shrink-0 text-right">' + b.count + '</div>' +
      '</div>';
    }).join('');
  }

  function renderSections(data) {
    const tbody = document.getElementById('analytics-sections-tbody');
    const bySection = {};

    data.forEach(s => {
      const sec = s.section || 'Unassigned';
      if (!bySection[sec]) bySection[sec] = [];
      bySection[sec].push(Number(s.final));
    });

    const rows = Object.keys(bySection).sort().map(sec => {
      const finals = bySection[sec].filter(n => !isNaN(n) && n > 0);
      const total = bySection[sec].length;
      const avg = finals.length ? Math.round(finals.reduce((a, b) => a + b, 0) / finals.length) : '-';
      const pass = finals.length
        ? Math.round((finals.filter(f => f >= 75).length / finals.length) * 100) + '%'
        : '-';
      const risk = finals.filter(f => f < 78).length;

      return '<tr class="hover:bg-slate-50">' +
        '<td class="p-3 font-bold text-slate-800">' + App.esc(sec) + '</td>' +
        '<td class="p-3 text-center font-semibold text-slate-600">' + total + '</td>' +
        '<td class="p-3 text-center font-bold text-blue-600">' + avg + '</td>' +
        '<td class="p-3 text-center font-bold text-emerald-600">' + pass + '</td>' +
        '<td class="p-3 text-center font-bold text-rose-600">' + risk + '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = rows || '<tr><td colspan="5" class="p-6 text-center text-slate-400 text-xs font-bold">No section data.</td></tr>';
  }

  function renderRisk(data) {
    const container = document.getElementById('analytics-risk-list');
    const countEl = document.getElementById('analytics-risk-count');

    const atRisk = data
      .filter(s => Number(s.final) > 0 && Number(s.final) < 78)
      .sort((a, b) => Number(a.final) - Number(b.final));

    countEl.textContent = atRisk.length + ' student' + (atRisk.length === 1 ? '' : 's');

    if (atRisk.length === 0) {
      container.innerHTML = '<div class="text-xs text-emerald-600 font-bold text-center py-6">🎉 No students below 78.</div>';
      return;
    }

    container.innerHTML = atRisk.map(s =>
      '<div class="flex items-center justify-between bg-rose-50 border border-rose-100 rounded-xl p-3">' +
        '<div>' +
          '<div class="font-bold text-sm text-slate-800">' + App.esc(s.name) + '</div>' +
          '<div class="text-[11px] text-slate-500 font-semibold">' + App.esc(s.studentNumber) + ' &bull; ' + App.esc(s.section || '-') + ' &bull; ' + App.esc(s.subject) + '</div>' +
        '</div>' +
        '<div class="text-right">' +
          '<div class="text-lg font-black text-rose-600">' + App.esc(s.final) + '</div>' +
          '<div class="text-[10px] uppercase font-bold text-rose-500">' + App.esc(s.remarks || '-') + '</div>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  App.populateAnalyticsFilters = function (subjects, sections) {
    const subjSel = document.getElementById('analytics-subject-filter');
    const secSel = document.getElementById('analytics-section-filter');
    if (!subjSel || !secSel) return;

    const currentSubj = subjSel.value;
    const currentSec = secSel.value;

    subjSel.innerHTML = '<option value="All">All Subjects</option>' +
      subjects.map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');
    secSel.innerHTML = '<option value="All">All Sections</option>' +
      sections.map(s => '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>').join('');

    if (currentSubj && Array.from(subjSel.options).some(o => o.value === currentSubj)) subjSel.value = currentSubj;
    if (currentSec && Array.from(secSel.options).some(o => o.value === currentSec)) secSel.value = currentSec;
  };

})(window.App);