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
    adminLogin: async (p) => {
      const input = String(p.pin || '');
      if (!input) return { success: false, message: 'Enter your PIN.' };
      const rows = await sbGet('settings', 'select=value&key=eq.admin_pin_hash&limit=1');
      if (!Array.isArray(rows) || rows.length === 0) {
        return { success: false, message: 'Admin PIN not configured in database.' };
      }
      const hash = await sha256(input);
      if (hash === rows[0].value) return { success: true };
      return { success: false, message: 'Invalid PIN.' };
    },

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

    manageSubject: async (p) => {
      const v = validateWeights(p.weights || defaultWeights());
      if (!v.ok) return { success: false, message: v.message };
      const w = v.weights;

      if (p.subAction === 'delete') {
        const t = String(p.subjectName);
        await sbDelete('subjects', 'subject_name=eq.' + enc(t));
        await sbDelete('grades', 'subject_name=eq.' + enc(t));
        await sbDelete('enrollments', 'subject_name=eq.' + enc(t));
      } else if (p.subAction === 'update' && p.oldName) {
        await sbUpdate('subjects', 'subject_name=eq.' + enc(p.oldName), {
          subject_name: p.newName, description: stripTags(p.description || ''),
          weight_quizzes: w.quizzes, weight_participation: w.participation,
          weight_attendance: w.attendance, weight_exams: w.exams
        });
        if (p.oldName !== p.newName) {
          await sbUpdate('grades', 'subject_name=eq.' + enc(p.oldName), { subject_name: p.newName });
          await sbUpdate('enrollments', 'subject_name=eq.' + enc(p.oldName), { subject_name: p.newName });
        }
      } else {
        await sbUpsert('subjects', {
          subject_name: p.subjectName, description: stripTags(p.description || ''),
          weight_quizzes: w.quizzes, weight_participation: w.participation,
          weight_attendance: w.attendance, weight_exams: w.exams
        }, 'subject_name');
      }
      return handlers.getSubjects();
    },

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
      (Array.isArray(gRows) ? gRows : []).forEach(g => {
        const q1 = g.q1 === '' ? null : Number(g.q1);
        const q2 = g.q2 === '' ? null : Number(g.q2);
        const q3 = g.q3 === '' ? null : Number(g.q3);
        const q4 = g.q4 === '' ? null : Number(g.q4);
        const fin = g.final !== '' ? Number(g.final) : calculateFinal([q1, q2, q3, q4]);
        subjects[g.subject_name] = {
          grades: { q1, q2, q3, q4, final: fin, remarks: g.remarks || determineRemarks(fin) },
          breakdowns: Array.isArray(g.breakdowns) ? g.breakdowns : []
        };
      });
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
      const sNo = String(p.studentNumber || '');
      const subj = String(p.subject || '');
      const grades = p.grades || {};
      const existing = await sbGet('grades',
        'select=*&student_number=eq.' + enc(sNo) + '&subject_name=eq.' + enc(subj));
      const row = Array.isArray(existing) && existing.length ? existing[0] : null;
      function pick(inp, old) {
        if (inp !== '' && inp !== undefined && inp !== null) return Number(inp);
        if (old !== '' && old !== undefined && old !== null && !isNaN(old)) return Number(old);
        return '';
      }
      const q1 = pick(grades.q1, row ? row.q1 : '');
      const q2 = pick(grades.q2, row ? row.q2 : '');
      const q3 = pick(grades.q3, row ? row.q3 : '');
      const q4 = pick(grades.q4, row ? row.q4 : '');
      const final = calculateFinal([q1, q2, q3, q4]);
      await sbUpsert('grades', {
        student_number: sNo, subject_name: subj,
        q1: String(q1 === '' ? '' : q1), q2: String(q2 === '' ? '' : q2),
        q3: String(q3 === '' ? '' : q3), q4: String(q4 === '' ? '' : q4),
        final: String(final === '' ? '' : final),
        remarks: determineRemarks(final),
        breakdowns: row ? (row.breakdowns || []) : generateDefaultBreakdowns(q1, q2, q3, q4)
      }, 'student_number,subject_name');
      return { success: true };
    },

    saveBreakdown: async (p) => saveBreakdownImpl(p, false),
    bulkSaveBreakdown: async (p) => saveBreakdownImpl(p, true),

    addStudent: async (p) => addStudentImpl(p, false),
    bulkAddStudents: async (p) => addStudentImpl(p, true),

    updateStudentInfo: async (p) => {
      const oldId = String(p.oldStudentNumber || '');
      const oldSubj = String(p.oldSubject || '');
      const nData = p.newData || {};
      const newId = String(nData.studentNumber || oldId);
      const newName = stripTags(nData.name || '');
      const newSection = stripTags(nData.section || '');
      const newSubj = String(nData.subject || oldSubj);
      await sbUpdate('students', 'student_number=eq.' + enc(oldId), {
        student_number: newId, name: newName, section: newSection
      });
      if (oldId !== newId) {
        await sbUpdate('grades', 'student_number=eq.' + enc(oldId), { student_number: newId });
        await sbUpdate('enrollments', 'student_number=eq.' + enc(oldId), { student_number: newId });
      }
      if (oldSubj !== newSubj) {
        await sbUpdate('grades',
          'student_number=eq.' + enc(newId) + '&subject_name=eq.' + enc(oldSubj),
          { subject_name: newSubj });
        await sbUpdate('enrollments',
          'student_number=eq.' + enc(newId) + '&subject_name=eq.' + enc(oldSubj),
          { subject_name: newSubj });
      }
      return { success: true };
    },

    deleteStudent: async (p) => {
      const sNo = String(p.studentNumber || '');
      await sbDelete('grades', 'student_number=eq.' + enc(sNo));
      await sbDelete('enrollments', 'student_number=eq.' + enc(sNo));
      await sbDelete('students', 'student_number=eq.' + enc(sNo));
      return { success: true };
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
      const sNo = String(p.studentNumber || 'UNKNOWN');
      const text = stripTags(String(p.commentText || '').trim());
      if (!text) return { success: true };
      let name = 'Teacher Admin';
      if (sNo !== 'TEACHER_ADMIN') {
        name = 'Student';
        const rows = await sbGet('students', 'select=name&student_number=eq.' + enc(sNo));
        if (Array.isArray(rows) && rows.length && rows[0].name) name = rows[0].name;
      }
      await sbInsert('comments', {
        timestamp: new Date().toLocaleString(), student_number: sNo,
        student_name: stripTags(name), comment_text: text
      });
      return { success: true };
    },

    clearComments: async () => {
      await sbDelete('comments', 'id=gt.0');
      return { success: true };
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

    saveAnnouncement: async (p) => {
      const msg = stripTags(String(p.message || '').trim());
      if (!msg) return { success: false, message: 'Announcement cannot be empty.' };
      await sbUpdate('announcements', 'is_active=eq.true', { is_active: false });
      const ts = new Date().toLocaleString();
      await sbInsert('announcements', { timestamp: ts, message: msg, posted_by: 'TEACHER_ADMIN', is_active: true });
      return { success: true, timestamp: ts, message: msg };
    },

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

    deleteAnnouncement: async (p) => {
      const id = Number(p.rowIndex);
      if (!id) return { success: false, message: 'Invalid id.' };
      await sbDelete('announcements', 'id=eq.' + id);
      return { success: true };
    },

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

    approveRegistration: async (p) => {
      const sNo = String(p.studentNumber || '');
      const section = stripTags(String(p.section || '').trim());
      const subjects = p.subjects || [];
      if (!section) return { success: false, message: 'Section is required.' };
      if (!subjects || subjects.length === 0) return { success: false, message: 'Select at least one subject.' };
      const pRows = await sbGet('pending_registrations',
        'select=*&student_number=eq.' + enc(sNo) + '&status=eq.pending');
      if (!Array.isArray(pRows) || pRows.length === 0) {
        return { success: false, message: 'Pending registration not found.' };
      }
      const pr = pRows[0];
      await sbUpsert('students', { student_number: sNo, name: pr.name, section }, 'student_number');
      for (const sub of subjects) {
        const subName = String(sub);
        const ex = await sbGet('enrollments',
          'select=id&student_number=eq.' + enc(sNo) + '&subject_name=eq.' + enc(subName));
        if (!Array.isArray(ex) || ex.length === 0) {
          await sbInsert('enrollments', { student_number: sNo, subject_name: subName });
        }
        await sbUpsert('grades', {
          student_number: sNo, subject_name: subName,
          q1: '', q2: '', q3: '', q4: '', final: '', remarks: '', breakdowns: []
        }, 'student_number,subject_name');
      }
      await sbUpdate('pending_registrations', 'id=eq.' + pr.id, {
        section, enrolled_subjects: subjects,
        status: 'approved', reviewed_at: new Date().toLocaleString()
      });
      return { success: true, studentNumber: sNo, message: pr.name + ' approved and enrolled.' };
    },

    rejectRegistration: async (p) => {
      const sNo = String(p.studentNumber || '');
      const rows = await sbGet('pending_registrations',
        'select=id&student_number=eq.' + enc(sNo) + '&status=eq.pending');
      if (!Array.isArray(rows) || rows.length === 0) {
        return { success: false, message: 'Pending registration not found.' };
      }
      await sbUpdate('pending_registrations', 'id=eq.' + rows[0].id, {
        status: 'rejected', reviewed_at: new Date().toLocaleString()
      });
      return { success: true };
    },

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
      if (!backup || !backup.tables) {
        return { success: false, message: 'Invalid backup file: missing tables.' };
      }

      const t = backup.tables;

      // ---- 1. Wipe everything ----
      // Order matters less here because there are no FK constraints,
      // but we still wipe in reverse-dependency order for cleanliness.
      const tablesToWipe = [
        'grades', 'enrollments', 'students', 'subjects',
        'comments', 'announcements', 'pending_registrations', 'settings'
      ];
      for (const table of tablesToWipe) {
        try {
          await sbDelete(table, 'id=gt.0');
        } catch (e) {
          console.warn('Wipe ' + table + ' (id):', e);
        }
        // Some tables use a non-id primary key
        try {
          await sbDelete(table, 'student_number=not.is.null');
        } catch (e) { /* only students uses this */ }
        try {
          await sbDelete(table, 'subject_name=not.is.null');
        } catch (e) { /* only subjects uses this */ }
        try {
          await sbDelete(table, 'key=not.is.null');
        } catch (e) { /* only settings uses this */ }
      }

      // ---- 2. Restore in dependency order ----
      const restoreOrder = [
        'subjects', 'students', 'enrollments', 'grades',
        'comments', 'announcements', 'pending_registrations', 'settings'
      ];

      let restoredRows = 0;

      for (const table of restoreOrder) {
        const rows = t[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        // Insert in chunks of 100 to avoid hitting request size limits
        for (let i = 0; i < rows.length; i += 100) {
          const chunk = rows.slice(i, i + 100);
          try {
            await sbInsert(table, chunk);
            restoredRows += chunk.length;
          } catch (e) {
            console.error('Restore chunk failed for ' + table + ':', e);
            return {
              success: false,
              message: 'Failed to restore ' + table + ' at row ' + i + ': ' + e.message
            };
          }
        }
      }

      return {
        success: true,
        message: 'Restored ' + restoredRows + ' rows across ' +
                 restoreOrder.filter(x => (t[x] && t[x].length)).length + ' tables.'
      };
    },

    recomputeAllGrades: async () => {
      const allGrades = await sbGet('grades', 'select=*');
      if (!Array.isArray(allGrades)) return { success: true, totalFixed: 0, report: [] };
      let totalFixed = 0;
      const report = [];
      const bySubject = {};
      allGrades.forEach(g => {
        if (!bySubject[g.subject_name]) bySubject[g.subject_name] = [];
        bySubject[g.subject_name].push(g);
      });
      for (const subjName of Object.keys(bySubject)) {
        let fixed = 0;
        for (const row of bySubject[subjName]) {
          const newFinal = calculateFinal([row.q1, row.q2, row.q3, row.q4]);
          const newRemarks = determineRemarks(newFinal);
          if (String(row.final) !== String(newFinal) || row.remarks !== newRemarks) {
            await sbUpdate('grades', 'id=eq.' + row.id, {
              final: String(newFinal === '' ? '' : newFinal), remarks: newRemarks
            });
            fixed++;
          }
        }
        if (fixed > 0) { report.push({ subject: subjName, fixed }); totalFixed += fixed; }
      }
      return { success: true, totalFixed, report };
    }
  };

  // ------------------------------------------------------------
  // Shared implementation helpers
  // ------------------------------------------------------------
  async function saveBreakdownImpl(p, isBulk) {
    const v = validateWeights(p.weights || defaultWeights());
    if (!v.ok) return { success: false, message: v.message };
    const w = v.weights;
    const subj = String(p.subject || '');
    const qNum = String(p.quarter || '').replace(/\D/g, '');
    const qKey = 'q' + qNum;

    const items = isBulk ? (p.items || []) : [{ studentNumber: p.studentNumber, breakdown: p.breakdown }];
    if (items.length === 0) return { success: true, newTotal: '', processed: 0 };

    const rows = await sbGet('grades', 'select=*&subject_name=eq.' + enc(subj));
    const byStudent = {};
    (Array.isArray(rows) ? rows : []).forEach(r => { byStudent[r.student_number] = r; });

    let processed = 0, lastNewTotal = '';
    for (const item of items) {
      const sNo = String(item.studentNumber);
      const row = byStudent[sNo];
      if (!row) continue;
      const bd = item.breakdown || {};
      const has = (bd.quizzes !== '' && bd.quizzes != null && !isNaN(bd.quizzes)) ||
                  (bd.participation !== '' && bd.participation != null && !isNaN(bd.participation)) ||
                  (bd.attendance !== '' && bd.attendance != null && !isNaN(bd.attendance)) ||
                  (bd.exams !== '' && bd.exams != null && !isNaN(bd.exams));
      let qScore;
      if (has) {
        const raw = Number(bd.quizzes || 0) * (w.quizzes / 100) +
                    Number(bd.participation || 0) * (w.participation / 100) +
                    Number(bd.attendance || 0) * (w.attendance / 100) +
                    Number(bd.exams || 0) * (w.exams / 100);
        qScore = transmuteGrade(raw);
      } else {
        const cur = row[qKey];
        qScore = (cur !== '' && !isNaN(cur)) ? Number(cur) : 0;
      }
      lastNewTotal = qScore;
      let bds = Array.isArray(row.breakdowns) ? row.breakdowns.slice() : [];
      if (bds.length === 0) bds = generateDefaultBreakdowns(row.q1, row.q2, row.q3, row.q4);
      let matched = false;
      for (let j = 0; j < bds.length; j++) {
        if (String(bds[j].quarter || '').indexOf(qNum) !== -1) {
          bds[j].quizzes = bd.quizzes; bds[j].participation = bd.participation;
          bds[j].attendance = bd.attendance; bds[j].exams = bd.exams;
          bds[j].total = qScore; matched = true; break;
        }
      }
      if (!matched) {
        bds.push({ quarter: qNum + 'st', quizzes: bd.quizzes,
          participation: bd.participation, attendance: bd.attendance,
          exams: bd.exams, total: qScore });
      }
      const updated = { q1: row.q1, q2: row.q2, q3: row.q3, q4: row.q4 };
      updated[qKey] = qScore;
      const final = calculateFinal([
        updated.q1 === '' ? null : Number(updated.q1),
        updated.q2 === '' ? null : Number(updated.q2),
        updated.q3 === '' ? null : Number(updated.q3),
        updated.q4 === '' ? null : Number(updated.q4)
      ]);
      await sbUpdate('grades', 'student_number=eq.' + enc(sNo) + '&subject_name=eq.' + enc(subj), {
        q1: String(updated.q1 === '' ? '' : updated.q1),
        q2: String(updated.q2 === '' ? '' : updated.q2),
        q3: String(updated.q3 === '' ? '' : updated.q3),
        q4: String(updated.q4 === '' ? '' : updated.q4),
        final: String(final === '' ? '' : final),
        remarks: determineRemarks(final), breakdowns: bds
      });
      processed++;
    }
    return { success: true, newTotal: lastNewTotal, processed };
  }

  async function addStudentImpl(p, isBulk) {
    const list = isBulk ? (p.studentsArray || []) : [p.studentData];
    let processed = 0;
    for (const sData of list) {
      if (!sData) continue;
      const sNo = String(sData.studentNumber || '').trim();
      const name = stripTags(String(sData.name || '').trim());
      const section = stripTags(String(sData.section || 'Section A'));
      const subjects = sData.enrolledSubjects || [];
      if (!sNo || !name) continue;
      await sbUpsert('students', { student_number: sNo, name, section }, 'student_number');
      for (const sub of subjects) {
        const subName = String(sub);
        const ex = await sbGet('enrollments',
          'select=id&student_number=eq.' + enc(sNo) + '&subject_name=eq.' + enc(subName));
        if (!Array.isArray(ex) || ex.length === 0) {
          await sbInsert('enrollments', { student_number: sNo, subject_name: subName });
        }
        await sbUpsert('grades', {
          student_number: sNo, subject_name: subName,
          q1: '', q2: '', q3: '', q4: '', final: '', remarks: '', breakdowns: []
        }, 'student_number,subject_name');
      }
      processed++;
    }
    return { success: true, processed };
  }

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

})(window.App);