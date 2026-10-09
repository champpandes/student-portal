// ============================================================
// api.js — Direct Supabase client (no Apps Script middleman)
// ============================================================
(function (App) {
  'use strict';

  const SB_URL = App.SUPABASE_URL;
  const SB_KEY = App.SUPABASE_ANON_KEY;

  // ------------------------------------------------------------
  // Low-level REST helpers
  // ------------------------------------------------------------
  async function sbFetch(method, path, payload, extra) {
    const url = SB_URL + '/rest/v1/' + path;
    const headers = {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json'
    };
    if (extra) Object.assign(headers, extra);
    const opts = { method, headers };
    if (payload !== null && payload !== undefined) opts.body = JSON.stringify(payload);
    const res = await fetch(url, opts);
    const text = await res.text();
    if (!res.ok) {
      console.error('[Supabase]', method, path, res.status, text);
      throw new Error('Supabase ' + res.status + ': ' + text);
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  function sbGet(t, q)                   { return sbFetch('GET',    t + (q ? '?' + q : '')); }
  function sbInsert(t, d)                { return sbFetch('POST',   t, d, { 'Prefer': 'return=representation' }); }
  function sbUpdate(t, f, d)             { return sbFetch('PATCH',  t + '?' + f, d, { 'Prefer': 'return=representation' }); }
  function sbDelete(t, f)                { return sbFetch('DELETE', t + '?' + f); }
  function sbUpsert(t, d, conflict)      {
    const p = t + (conflict ? '?on_conflict=' + conflict : '');
    return sbFetch('POST', p, d, { 'Prefer': 'resolution=merge-duplicates,return=representation' });
  }
  function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }
  function stripTags(s) { return String(s == null ? '' : s).replace(/[<>]/g, ''); }
  function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }
  function stripTags(s) { return String(s == null ? '' : s).replace(/[<>]/g, ''); }

  // ------------------------------------------------------------
  // Category helpers — translate between DB shape and legacy shape
  // ------------------------------------------------------------
  let __catCache = {};

  async function categoriesFor(subjectName) {
    const key = String(subjectName);
    if (__catCache[key]) return __catCache[key];
    const rows = await sbGet('subject_categories',
      'select=id,name&subject_name=eq.' + enc(key));
    const map = {};
    (rows || []).forEach(r => { map[String(r.name).toLowerCase()] = String(r.id); });
    __catCache[key] = map;
    return map;
  }

  function bdToLegacy(bd, catMap) {
    const out = { quarter: bd.quarter, total: bd.total };
    for (const name of Object.keys(catMap)) {
      const id = catMap[name];
      out[name] = (bd.categories && bd.categories[id] !== undefined)
        ? bd.categories[id]
        : '';
    }
    return out;
  }

  // ------------------------------------------------------------
  // Admin Edge Function caller
  // All privileged writes go through this function, which
  // verifies the PIN server-side using the service_role key.
  // ------------------------------------------------------------
  const ADMIN_FN_URL = SB_URL + '/functions/v1/admin';


  async function callAdmin(payload) {
    const res = await fetch(ADMIN_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SB_KEY
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[callAdmin]', res.status, text);
      throw new Error('Admin function ' + res.status + ': ' + text);
    }
    try { return JSON.parse(text); } catch (e) { return { success: false, message: 'Bad response from admin function.' }; }
  }

  const TRANSMUTATION = [
    [98.40, 99], [96.80, 98], [95.20, 97], [93.60, 96], [92.00, 95],
    [90.40, 94], [88.80, 93], [87.20, 92], [85.60, 91], [84.00, 90],
    [82.40, 89], [80.80, 88], [79.20, 87], [77.60, 86], [76.00, 85],
    [74.40, 84], [72.80, 83], [71.20, 82], [69.60, 81], [68.00, 80],
    [66.40, 79], [64.80, 78], [63.20, 77], [61.60, 76], [60.00, 75],
    [56.00, 74], [52.00, 73], [48.00, 72], [44.00, 71], [40.00, 70],
    [36.00, 69], [32.00, 68], [28.00, 67], [24.00, 66], [20.00, 65],
    [16.00, 64], [12.00, 63], [8.00, 62],  [4.00, 61],  [0.00, 60]
  ];
  function transmuteGrade(score) {
    if (score === '' || score === null || isNaN(score)) return '';
    const s = Number(score);
    if (s >= 100) return 100;
    for (let i = 0; i < TRANSMUTATION.length; i++) {
      if (s >= TRANSMUTATION[i][0]) return TRANSMUTATION[i][1];
    }
    return 60;
  }
  function calculateFinal(g) {
    const v = g.filter(x => x !== null && x !== undefined && x !== '' && !isNaN(x));
    if (v.length === 0) return '';
    return Math.round(v.reduce((a, b) => a + Number(b), 0) / v.length);
  }
  function determineRemarks(f) {
    if (f === '' || f === null || isNaN(f)) return '';
    return Number(f) >= 75 ? 'Passed' : 'Failed';
  }
  function defaultWeights() { return { quizzes: 35, participation: 15, attendance: 10, exams: 40 }; }
  function validateWeights(w) {
    const q = Number(w && w.quizzes) || 0, p = Number(w && w.participation) || 0;
    const a = Number(w && w.attendance) || 0, e = Number(w && w.exams) || 0;
    if (q + p + a + e !== 100) return { ok: false, message: 'Component weights must total exactly 100%.' };
    return { ok: true, weights: { quizzes: q, participation: p, attendance: a, exams: e } };
  }
  function generateDefaultBreakdowns(q1, q2, q3, q4) {
    const vals = [q1, q2, q3, q4], names = ['1st', '2nd', '3rd', '4th'];
    return vals.map((v, i) => ({
      quarter: names[i], quizzes: '', participation: '', attendance: '', exams: '',
      total: (v !== null && v !== undefined && v !== '' && !isNaN(v)) ? v : ''
    }));
  }
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ------------------------------------------------------------
  // Action handlers
  // ------------------------------------------------------------
  const handlers = {
    adminLogin: async (p) => callAdmin({
      action: 'adminLogin',
      pin: p.pin
    }),

    getSubjects: async () => {
      const rows = await sbGet('subjects', 'select=*&order=subject_name.asc');
      const subjects = [], descriptions = {}, weights = {};
      (Array.isArray(rows) ? rows : []).forEach(r => {
        subjects.push(r.subject_name);
        descriptions[r.subject_name] = r.description || '';
        weights[r.subject_name] = {
          quizzes: r.weight_quizzes || 35, participation: r.weight_participation || 15,
          attendance: r.weight_attendance || 10, exams: r.weight_exams || 40
        };
      });
      return { success: true, subjects, descriptions, weights };
    },

    manageSubject: async (p) => callAdmin({
      action: 'manageSubject',
      pin: p.pin,
      subAction: p.subAction,
      oldName: p.oldName,
      newName: p.newName,
      subjectName: p.subjectName,
      description: p.description,
      weights: p.weights
    }),

    getSections: async () => {
      const rows = await sbGet('students', 'select=section');
      const seen = {}, list = [];
      (Array.isArray(rows) ? rows : []).forEach(r => {
        const s = String(r.section || '').trim();
        if (s && !seen[s]) { seen[s] = true; list.push(s); }
      });
      list.sort();
      return { success: true, sections: list };
    },

        getStudent: async (p) => {
      const sNo = String(p.studentNumber || '');
      if (!sNo) return { success: false, message: 'No student number.' };
      const sRows = await sbGet('students', 'select=*&student_number=eq.' + enc(sNo));
      if (!Array.isArray(sRows) || sRows.length === 0) {
        const pRows = await sbGet('pending_registrations',
          'select=*&student_number=eq.' + enc(sNo) + '&order=id.desc&limit=1');
        if (Array.isArray(pRows) && pRows.length > 0) {
          const pr = pRows[0];
          if (pr.status === 'pending') return { success: false, pending: true, message: 'Your registration is awaiting teacher approval.', submittedName: pr.name };
          if (pr.status === 'rejected') return { success: false, rejected: true, message: 'Your registration was not approved. Please contact your teacher.' };
        }
        return { success: false, message: 'Student not found.' };
      }
      const s = sRows[0];
      const gRows = await sbGet('grades', 'select=*&student_number=eq.' + enc(sNo));
      const subjects = {};
      for (const g of (Array.isArray(gRows) ? gRows : [])) {
        const q1 = g.q1 === '' ? null : Number(g.q1);
        const q2 = g.q2 === '' ? null : Number(g.q2);
        const q3 = g.q3 === '' ? null : Number(g.q3);
        const q4 = g.q4 === '' ? null : Number(g.q4);
        const fin = g.final !== '' ? Number(g.final) : calculateFinal([q1, q2, q3, q4]);

        // Translate new-shape breakdowns back to legacy shape for the UI
        const catMap = await categoriesFor(g.subject_name);
        const legacyBds = Array.isArray(g.breakdowns)
          ? g.breakdowns.map(bd => bdToLegacy(bd, catMap))
          : [];

        subjects[g.subject_name] = {
          grades: { q1, q2, q3, q4, final: fin, remarks: g.remarks || determineRemarks(fin) },
          breakdowns: legacyBds
        };
      }
      return { success: true, studentNumber: s.student_number, name: s.name, section: s.section, subjects };
    },

    getAllGrades: async (p) => {
      let query = 'select=*&order=student_number.asc';
      if (p.subject && p.subject !== 'All') query += '&subject_name=eq.' + enc(p.subject);
      const rows = await sbGet('grades', query);
      if (!Array.isArray(rows)) return [];
      const allS = await sbGet('students', 'select=student_number,name,section');
      const sMap = {};
      (Array.isArray(allS) ? allS : []).forEach(s => { sMap[s.student_number] = s; });
      return rows.filter(r => {
        const sNo = String(r.student_number);
        return !(sNo.indexOf('T') !== -1 && sNo.indexOf('-') !== -1);
      }).map(r => {
        const stu = sMap[r.student_number] || {};
        return {
          studentNumber: String(r.student_number),
          name: stu.name || '',
          section: stu.section || 'Section A',
          subject: r.subject_name,
          q1: r.q1, q2: r.q2, q3: r.q3, q4: r.q4,
          final: r.final, remarks: r.remarks || determineRemarks(r.final)
        };
      });
    },

    saveGrades: async (p) => {
      return callAdmin({
        action: 'saveGrades',
        pin: p.pin,
        studentNumber: p.studentNumber,
        subject: p.subject,
        grades: p.grades
      });
    },

    saveBreakdown: async (p) => callAdmin({
      action: 'saveBreakdown',
      pin: p.pin,
      studentNumber: p.studentNumber,
      subject: p.subject,
      quarter: p.quarter,
      breakdown: p.breakdown,
      weights: p.weights
    }),

    bulkSaveBreakdown: async (p) => callAdmin({
      action: 'bulkSaveBreakdown',
      pin: p.pin,
      subject: p.subject,
      quarter: p.quarter,
      weights: p.weights,
      items: p.items
    }),

    addStudent: async (p) => callAdmin({
      action: 'addStudent',
      pin: p.pin,
      studentData: p.studentData
    }),

    bulkAddStudents: async (p) => callAdmin({
      action: 'bulkAddStudents',
      pin: p.pin,
      studentsArray: p.studentsArray
    }),

    updateStudentInfo: async (p) => callAdmin({
      action: 'updateStudentInfo',
      pin: p.pin,
      oldStudentNumber: p.oldStudentNumber,
      oldSubject: p.oldSubject,
      newData: p.newData
    }),

    deleteStudent: async (p) => {
      return callAdmin({
        action: 'deleteStudent',
        pin: p.pin,
        studentNumber: p.studentNumber
      });
    },
    getComments: async () => {
      const rows = await sbGet('comments', 'select=*&order=id.asc');
      return {
        success: true,
        comments: (Array.isArray(rows) ? rows : []).map(r => ({
          timestamp: r.timestamp || '', studentNumber: r.student_number || '',
          studentName: r.student_name || '', text: r.comment_text || ''
        }))
      };
    },

    postComment: async (p) => {
      return callAdmin({
        action: 'postComment',
        pin: p.pin,
        studentNumber: p.studentNumber,
        commentText: p.commentText
      });
    },

    clearComments: async (p) => {
      return callAdmin({
        action: 'clearComments',
        pin: p.pin
      });
    },

    getAnnouncement: async () => {
      const rows = await sbGet('announcements', 'select=*&is_active=eq.true&order=id.desc&limit=1');
      if (Array.isArray(rows) && rows.length > 0) {
        return { success: true, message: rows[0].message || '', timestamp: rows[0].timestamp || '', postedBy: rows[0].posted_by || '' };
      }
      const last = await sbGet('announcements', 'select=*&order=id.desc&limit=1');
      if (Array.isArray(last) && last.length > 0) {
        return { success: true, message: '', latest: { message: last[0].message || '', timestamp: last[0].timestamp || '', postedBy: last[0].posted_by || '' } };
      }
      return { success: true, message: '' };
    },

    saveAnnouncement: async (p) => callAdmin({
      action: 'saveAnnouncement',
      pin: p.pin,
      message: p.message
    }),

    getAnnouncementHistory: async () => {
      const rows = await sbGet('announcements', 'select=*&order=id.desc');
      return {
        success: true,
        history: (Array.isArray(rows) ? rows : []).map(r => ({
          rowIndex: r.id, timestamp: r.timestamp || '', message: r.message || '',
          postedBy: r.posted_by || '', active: !!r.is_active
        }))
      };
    },

    deleteAnnouncement: async (p) => callAdmin({
      action: 'deleteAnnouncement',
      pin: p.pin,
      rowIndex: p.rowIndex
    }),

    registerStudent: async (p) => {
      const sData = p.studentData || {};
      const sNo = String(sData.studentNumber || '').trim();
      const name = stripTags(String(sData.name || '').trim());
      if (!sNo || !name) return { success: false, message: 'Please enter your name and student number.' };
      const enrolled = await sbGet('students', 'select=student_number&student_number=eq.' + enc(sNo));
      if (Array.isArray(enrolled) && enrolled.length > 0) {
        return { success: false, message: 'You are already enrolled. Please log in instead.' };
      }
      const pend = await sbGet('pending_registrations',
        'select=id&student_number=eq.' + enc(sNo) + '&status=eq.pending');
      if (Array.isArray(pend) && pend.length > 0) {
        return { success: false, message: 'You already have a pending registration. Please wait for teacher approval.' };
      }
      await sbInsert('pending_registrations', {
        timestamp: new Date().toLocaleString(), student_number: sNo, name,
        section: '', enrolled_subjects: [], status: 'pending', reviewed_at: ''
      });
      return { success: true, pending: true, message: 'Registration submitted. Awaiting teacher approval.' };
    },

    getPendingRegistrations: async () => {
      const rows = await sbGet('pending_registrations', 'select=*&order=id.desc');
      const pending = [], history = [];
      (Array.isArray(rows) ? rows : []).forEach(r => {
        const item = {
          timestamp: r.timestamp || '', studentNumber: r.student_number || '',
          name: r.name || '', section: r.section || '',
          subjects: Array.isArray(r.enrolled_subjects) ? r.enrolled_subjects : [],
          status: r.status || 'pending', reviewedAt: r.reviewed_at || ''
        };
        if (item.status === 'pending') pending.push(item); else history.push(item);
      });
      return { success: true, pending, history };
    },

    approveRegistration: async (p) => callAdmin({
      action: 'approveRegistration',
      pin: p.pin,
      studentNumber: p.studentNumber,
      section: p.section,
      subjects: p.subjects
    }),

    rejectRegistration: async (p) => callAdmin({
      action: 'rejectRegistration',
      pin: p.pin,
      studentNumber: p.studentNumber
    }),

    backupAll: async () => {
      const [subjects, students, enrollments, grades, comments, announcements, pending] = await Promise.all([
        sbGet('subjects', 'select=*'), sbGet('students', 'select=*'),
        sbGet('enrollments', 'select=*'), sbGet('grades', 'select=*'),
        sbGet('comments', 'select=*'), sbGet('announcements', 'select=*'),
        sbGet('pending_registrations', 'select=*')
      ]);
      return {
        success: true,
        backup: {
          version: '2.0', exportedAt: new Date().toISOString(), source: 'supabase',
          subjects, students, enrollments, grades, comments, announcements,
          pending_registrations: pending
        }
      };
    },
    restoreAll: async (p) => {
      const backup = p.backup;
      if (!backup) {
        return { success: false, message: 'Invalid backup file.' };
      }

      // Support BOTH formats:
      //   - Old: { subjectData: {...}, comments: [], announcements: [] }
      //   - New: { subjects: [...], students: [...], grades: [...], ... }
      //   - Nested: { tables: { subjects: [...], ... } }
      const t = backup.tables
        || (backup.subjectData ? {
             subjects: backup.subjects || [],
             students: extractStudentsFromSubjectData(backup.subjectData),
             enrollments: extractEnrollmentsFromSubjectData(backup.subjectData),
             grades: extractGradesFromSubjectData(backup.subjectData),
             comments: backup.comments || [],
             announcements: backup.announcements || [],
             pending_registrations: backup.pendingRegistrations || []
           } : {
             subjects: backup.subjects || [],
             students: backup.students || [],
             enrollments: backup.enrollments || [],
             grades: backup.grades || [],
             comments: backup.comments || [],
             announcements: backup.announcements || [],
             pending_registrations: backup.pending_registrations || [],
             settings: backup.settings || []
           });

      // ---- 1. Wipe existing data ----
      const wipe = async (table, filter) => {
        try { await sbDelete(table, filter); } catch (e) { /* ignore */ }
      };
      await wipe('grades', 'id=gt.0');
      await wipe('enrollments', 'id=gt.0');
      await wipe('students', 'student_number=not.is.null');
      await wipe('subjects', 'id=gt.0');
      await wipe('comments', 'id=gt.0');
      await wipe('announcements', 'id=gt.0');
      await wipe('pending_registrations', 'id=gt.0');
      // Do NOT wipe settings — keep the admin PIN hash

      // ---- 2. Restore in dependency order ----
      const restoreOrder = [
        'subjects', 'students', 'enrollments', 'grades',
        'comments', 'announcements', 'pending_registrations'
      ];

      let restoredRows = 0;

      for (const table of restoreOrder) {
        const rows = t[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        for (let i = 0; i < rows.length; i += 100) {
          const chunk = rows.slice(i, i + 100);
          try {
            await sbInsert(table, chunk);
            restoredRows += chunk.length;
          } catch (e) {
            return {
              success: false,
              message: 'Restore failed on ' + table + ' at row ' + i + ': ' + e.message
            };
          }
        }
      }

      return {
        success: true,
        message: 'Restored ' + restoredRows + ' rows.'
      };
    },

    recomputeAllGrades: async (p) => callAdmin({
      action: 'recomputeAllGrades',
      pin: p.pin
    })
  };

  // ------------------------------------------------------------
  // Shared implementation helpers
  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // Public apiCall — same signature as before
  // ------------------------------------------------------------
  App.apiCall = async function (payload, opts) {
    const action = String((payload && payload.action) || '');
    const handler = handlers[action];
    if (!handler) {
      console.warn('[apiCall] Unknown action:', action);
      return { success: false, message: 'Unknown action: ' + action };
    }
    try {
      return await handler(payload);
    } catch (err) {
      console.error('[apiCall]', action, err);
      return { success: false, message: err.message || String(err) };
    }
  };

  // ---- Helpers for old-format backup conversion ----
  function extractStudentsFromSubjectData(sd) {
    const map = {};
    Object.keys(sd).forEach(function (subject) {
      const rows = sd[subject];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;
        const sNo = String(row[0]);
        if (!map[sNo]) map[sNo] = { student_number: sNo, name: String(row[1] || ''), section: String(row[2] || 'Section A') };
      }
    });
    return Object.keys(map).map(k => map[k]);
  }

  function extractEnrollmentsFromSubjectData(sd) {
    const seen = {};
    const list = [];
    Object.keys(sd).forEach(function (subject) {
      const rows = sd[subject];
      for (let i = 1; i < rows.length; i++) {
        const sNo = String(rows[i][0] || '');
        if (!sNo) continue;
        const key = sNo + '|' + subject;
        if (!seen[key]) { seen[key] = true; list.push({ student_number: sNo, subject_name: subject }); }
      }
    });
    return list;
  }

  function extractGradesFromSubjectData(sd) {
    const list = [];
    Object.keys(sd).forEach(function (subject) {
      const rows = sd[subject];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;
        let bd = [];
        try { if (row[9]) bd = JSON.parse(String(row[9])); } catch (e) {}
        list.push({
          student_number: String(row[0]),
          subject_name: subject,
          q1: row[3] === '' ? '' : String(row[3]),
          q2: row[4] === '' ? '' : String(row[4]),
          q3: row[5] === '' ? '' : String(row[5]),
          q4: row[6] === '' ? '' : String(row[6]),
          final: row[7] === '' ? '' : String(row[7]),
          remarks: String(row[8] || ''),
          breakdowns: bd
        });
      }
    });
    return list;
  }

})(window.App);