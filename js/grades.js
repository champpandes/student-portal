(function (App) {
  'use strict';

  const TRANSMUTATION = [
    [100, '1.0'], [99, '1.0'], [98, '1.1'], [97, '1.2'], [95, '1.3'],
    [94, '1.4'],  [93, '1.5'], [92, '1.6'], [91, '1.7'], [89, '1.8'],
    [88, '1.9'],  [87, '2.0'], [86, '2.1'], [85, '2.2'], [83, '2.3'],
    [82, '2.4'],  [81, '2.5'], [80, '2.6'], [79, '2.7'], [77, '2.8'],
    [76, '2.9'],  [75, '3.0'], [74, '4.0']
  ];

  App.getEquivalentGrade = function (v) {
    if (v === '' || v === null || v === undefined) return '-';
    const g = Math.round(Number(v));
    if (!isFinite(g) || g <= 0) return '-';
    for (let i = 0; i < TRANSMUTATION.length; i++) {
      if (g >= TRANSMUTATION[i][0]) return TRANSMUTATION[i][1];
    }
    return '5.0';
  };

  App.remarksBadge = function (remarks) {
    if (remarks === 'Passed') {
      return '<span class="badge-passed px-3 py-1 rounded-md text-[11px] font-bold">' +
        '<svg class="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> PASSED' +
      '</span>';
    }
    if (remarks === 'Failed') {
      return '<span class="badge-failed px-3 py-1 rounded-md text-[11px] font-bold">' +
        '<svg class="w-3.5 h-3.5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> FAILED' +
      '</span>';
    }
    return '<span class="text-slate-400 font-semibold">-</span>';
  };

})(window.App);