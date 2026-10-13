// ============================================================
// api.js — Direct Supabase client + edge function wrapper
// Multi-teacher version (Phase 1C)
// ============================================================
(function (App) {
  'use strict';

  const SB_URL = App.SUPABASE_URL;
  const SB_KEY = App.SUPABASE_ANON_KEY;
  const state = App.state;

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
  function sbGet(t, q)              { return sbFetch('GET',    t + (q ? '?' + q : '')); }
  function sbInsert(t, d)           { return sbFetch('POST',   t, d, { 'Prefer': 'return=representation' }); }
  function sbUpsert(t, d, conflict) {
    const p = t + (conflict ? '?on_conflict=' + conflict : '');
    return sbFetch('POST', p, d, { 'Prefer': 'resolution=merge-duplicates,return=representation' });
  }
  function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }
  function stripTags(s) { return String(s == null ? '' : s).replace(/[<>]/g, ''); }

  // ------------------------------------------------------------
  // Admin Edge Function caller
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

  function determineRemarks(f) {
    if (f === '' || f === null || isNaN(f)) return '';
    return Number(f) >= 75 ? 'Passed' : 'Failed';
  }

  // ------------------------------------------------------------
  // Action handlers
  // ------------------------------------------------------------
  const handlers = {

    // ============================================================
    // TEACHER AUTH
    // ============================================================

    registerTeacher: async (p) => callAdmin({
      action: 'registerTeacher',
      email: p.email,
      displayName: p.displayName,
      password: p.password
    }),

    teacherLogin: async (p) => callAdmin({
      action: 'teacherLogin',
      email: p.email,
      password: p.password
    }),

    teacherLogout: async (p) => callAdmin({
      action: 'teacherLogout',
      sessionToken: p.sessionToken
    }),

    getMe: async () => callAdmin({ action: 'getMe' }),

    markWalkthroughSeen: async () => callAdmin({ action: 'markWalkthroughSeen' }),

    // Legacy PIN login (still works during migration)
    adminLogin: async (p) => callAdmin({
      action: 'adminLogin',
      pin: p.pin,
      deviceId: p.deviceId
    }),

    // ============================================================
    // SUPER ADMIN — TEACHER MANAGEMENT
    // ============================================================

    listTeachers: async () => callAdmin({ action: 'listTeachers' }),

    approveTeacher: async (p) => callAdmin({
      action: 'approveTeacher',
      teacherId: p.teacherId,
      role: p.role
    }),

    rejectTeacher: async (p) => callAdmin({
      action: 'rejectTeacher',
      teacherId: p.teacherId
    }),

    setTeacherRole: async (p) => callAdmin({
      action: 'setTeacherRole',
      teacherId: p.teacherId,
      role: p.role
    }),

    setTeacherActive: async (p) => callAdmin({
      action: 'setTeacherActive',
      teacherId: p.teacherId,
      isActive: p.isActive
    }),

    resetTeacherPassword: async (p) => callAdmin({
      action: 'resetTeacherPassword',
      teacherId: p.teacherId,
      password: p.password
    }),

    deleteTeacher: async (p) => callAdmin({
      action: 'deleteTeacher',
      teacherId: p.teacherId
    }),

    // ============================================================
    // PUBLIC — teacher list for student registration
    // ============================================================

    getPublicTeachers: async () => callAdmin({ action: 'getPublicTeachers' }),

    // ============================================================
    // SUBJECTS
    // ============================================================

    getSubjects: async () => {
      const subjRows = await sbGet('subjects', 'select=*&order=subject_name.asc');
      const catRows  = await sbGet('subject_categories', 'select=*&order=subject_name.asc&order=position.asc');

      const subjects = [], descriptions = {}, weights = {};
      const categories = {}, quarterWeights = {};

      (Array.isArray(subjRows) ? subjRows : []).forEach(r => {
        subjects.push(r.subject_name);
        descriptions[r.subject_name] = r.description || '';
        weights[r.subject_name] = {
          quizzes: r.weight_quizzes || 35, participation: r.weight_participation || 15,
          attendance: r.weight_attendance || 10, exams: r.weight_exams || 40
        };
        quarterWeights[r.subject_name] = r.quarter_weights || { '1st': 25, '2nd': 25, '3rd': 25, '4th': 25 };
        categories[r.subject_name] = [];
      });

      (Array.isArray(catRows) ? catRows : []).forEach(c => {
        if (!categories[c.subject_name]) categories[c.subject_name] = [];
        categories[c.subject_name].push({
          id: c.id, name: c.name, weight: Number(c.weight), position: c.position
        });
      });

      return { success: true, subjects, descriptions, weights, categories, quarterWeights };
    },

    manageSubject: async (p) => callAdmin({
      action: 'manageSubject',
      subAction: p.subAction,
      oldName: p.oldName,
      newName: p.newName,
      subjectName: p.subjectName,
      description: p.description,
      categories: p.categories,
      quarterWeights: p.quarterWeights,
      confirmDelete: p.confirmDelete
    }),

    // ============================================================
    // SECTIONS
    // ============================================================

    getSections: async () => {
      const rows = await sbGet('sections', 'select=name&order=name.asc');
      const list = (Array.isArray(rows) ? rows : []).map(r => String(r.name));
      return { success: true, sections: list };
    },

    manageSection: async (p) => callAdmin({
      action: 'manageSection',
      subAction: p.subAction,
      name: p.name,
      oldName: p.oldName
    }),

    // ============================================================
    // STUDENT LOOKUP / REGISTRATION
    // ============================================================

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
        const fin = (g.final !== '' && g.final !== null && g.final !== undefined) ? Number(g.final) : '';
        subjects[g.subject_name] = {
          grades: { q1, q2, q3, q4, final: fin, remarks: g.remarks || determineRemarks(fin) },
          breakdowns: Array.isArray(g.breakdowns) ? g.breakdowns : []
        };
      });
      return {
        success: true,
        studentNumber: s.student_number,
        name: s.name,
        section: s.section,
        teacherId: s.teacher_id || null,
        subjects
      };
    },

    registerStudent: async (p) => callAdmin({
      action: 'registerStudent',
      studentData: p.studentData
    }),

    getPendingRegistrations: async () => {
      const rows = await sbGet('pending_registrations', 'select=*&order=id.desc');
      const pending = [], history = [];
      (Array.isArray(rows) ? rows : []).forEach(r => {
        const item = {
          timestamp: r.timestamp || '', studentNumber: r.student_number || '',
          name: r.name || '', section: r.section || '',
          subjects: Array.isArray(r.enrolled_subjects) ? r.enrolled_subjects : [],
          status: r.status || 'pending', reviewedAt: r.reviewed_at || '',
          teacherId: r.teacher_id || null
        };
        if (item.status === 'pending') pending.push(item); else history.push(item);
      });
      return { success: true, pending, history };
    },

    approveRegistration: async (p) => callAdmin({
      action: 'approveRegistration',
      studentNumber: p.studentNumber,
      section: p.section,
      subjects: p.subjects
    }),

    rejectRegistration: async (p) => callAdmin({
      action: 'rejectRegistration',
      studentNumber: p.studentNumber
    }),

    // ============================================================
    // GRADES
    // ============================================================

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

    saveGrades: async (p) => callAdmin({
      action: 'saveGrades',
      studentNumber: p.studentNumber,
      subject: p.subject,
      grades: p.grades
    }),

    saveBreakdown: async (p) => callAdmin({
      action: 'saveBreakdown',
      studentNumber: p.studentNumber,
      subject: p.subject,
      quarter: p.quarter,
      entries: p.entries
    }),

    bulkSaveBreakdown: async (p) => callAdmin({
      action: 'bulkSaveBreakdown',
      subject: p.subject,
      quarter: p.quarter,
      items: p.items
    }),

    // ============================================================
    // STUDENTS — CRUD
    // ============================================================

    addStudent: async (p) => callAdmin({
      action: 'addStudent',
      studentData: p.studentData
    }),

    bulkAddStudents: async (p) => callAdmin({
      action: 'bulkAddStudents',
      studentsArray: p.studentsArray
    }),

    updateStudentInfo: async (p) => callAdmin({
      action: 'updateStudentInfo',
      oldStudentNumber: p.oldStudentNumber,
      oldSubject: p.oldSubject,
      newData: p.newData
    }),

    deleteStudent: async (p) => callAdmin({
      action: 'deleteStudent',
      studentNumber: p.studentNumber
    }),

    // ============================================================
    // COMMENTS
    // ============================================================

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

    postComment: async (p) => callAdmin({
      action: 'postComment',
      studentNumber: p.studentNumber,
      commentText: p.commentText
    }),

    clearComments: async () => callAdmin({ action: 'clearComments' }),

    // ============================================================
    // ANNOUNCEMENTS
    // ============================================================

    getAnnouncement: async (p) => {
      let q = 'select=*&is_active=eq.true&order=id.desc&limit=1';
      const teacherId = p && p.teacherId ? String(p.teacherId) : '';
      if (teacherId) q += '&teacher_id=eq.' + enc(teacherId);
      const rows = await sbGet('announcements', q);
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
      rowIndex: p.rowIndex
    }),

    getTeacherName: async (p) => {
      const teacherId = p && p.teacherId ? String(p.teacherId) : '';
      return callAdmin({ action: 'getTeacherName', teacherId });
    },

    saveTeacherName: async (p) => callAdmin({
      action: 'saveTeacherName',
      name: p.name
    }),

    // ============================================================
    // BACKUP
    // ============================================================

    backupAll: async () => {
      const [subjects, students, enrollments, grades, comments, announcements, pending, assessments, scores] = await Promise.all([
        sbGet('subjects', 'select=*'), sbGet('students', 'select=*'),
        sbGet('enrollments', 'select=*'), sbGet('grades', 'select=*'),
        sbGet('comments', 'select=*'), sbGet('announcements', 'select=*'),
        sbGet('pending_registrations', 'select=*'),
        sbGet('assessments', 'select=*'), sbGet('scores', 'select=*')
      ]);
      return {
        success: true,
        backup: {
          version: '2.2', exportedAt: new Date().toISOString(), source: 'supabase',
          subjects, students, enrollments, grades, comments, announcements,
          pending_registrations: pending, assessments, scores
        }
      };
    },

    restoreAll: async (p) => callAdmin({
      action: 'restoreAll',
      backup: p.backup
    }),

    recomputeAllGrades: async () => callAdmin({ action: 'recomputeAllGrades' }),

    // ============================================================
    // CLASS RECORD
    // ============================================================

    getClassRecord: async (p) => {
      const subject = String(p.subject || '');
      const quarter = String(p.quarter || '');
      if (!subject || !quarter) return { success: false, message: 'Subject and quarter required.' };

      const catRows = await sbGet('subject_categories',
        'select=id,name,weight,position&subject_name=eq.' + enc(subject) + '&order=position.asc');
      const categories = Array.isArray(catRows) ? catRows : [];

      const assessRows = await sbGet('assessments',
        'select=*&subject_name=eq.' + enc(subject) + '&quarter=eq.' + enc(quarter) + '&order=category_id.asc&order=position.asc');
      const assessments = Array.isArray(assessRows) ? assessRows : [];

      let scores = [];
      if (assessments.length > 0) {
        const ids = assessments.map(a => a.id).join(',');
        const scoreRows = await sbGet('scores', 'select=*&assessment_id=in.(' + ids + ')');
        scores = Array.isArray(scoreRows) ? scoreRows : [];
      }

      const enrRows = await sbGet('enrollments',
        'select=student_number&subject_name=eq.' + enc(subject));
      const studentNumbers = (Array.isArray(enrRows) ? enrRows : []).map(e => String(e.student_number));

      let students = [];
      if (studentNumbers.length > 0) {
        const inList = studentNumbers.map(s => '"' + s.replace(/"/g, '') + '"').join(',');
        const sRows = await sbGet('students',
          'select=student_number,name,section&student_number=in.(' + inList + ')');
        students = Array.isArray(sRows) ? sRows : [];
      }

      return { success: true, categories, assessments, scores, students };
    },

    addAssessment: async (p) => callAdmin({
      action: 'addAssessment',
      subject: p.subject,
      quarter: p.quarter,
      categoryId: p.categoryId,
      name: p.name,
      totalPoints: p.totalPoints
    }),

    renameAssessment: async (p) => callAdmin({
      action: 'renameAssessment',
      id: p.id,
      name: p.name,
      totalPoints: p.totalPoints
    }),

    deleteAssessment: async (p) => callAdmin({
      action: 'deleteAssessment',
      id: p.id
    }),

    saveScore: async (p) => callAdmin({
      action: 'saveScore',
      assessmentId: p.assessmentId,
      studentNumber: p.studentNumber,
      score: p.score
    }),

    saveScoresBatch: async (p) => callAdmin({
      action: 'saveScoresBatch',
      items: p.items
    }),

    applyClassRecordToGrades: async (p) => callAdmin({
      action: 'applyClassRecordToGrades',
      subject: p.subject,
      quarter: p.quarter
    })
  };

  // ============================================================
  // apiCall — auto-attaches sessionToken / pin
  // ============================================================
  App.apiCall = async function (payload, opts) {
    const merged = Object.assign({}, payload || {});

    // Auto-attach credentials. sessionToken takes priority; edge function
    // prefers it over PIN anyway when both are present.
    if (state.sessionToken && !merged.sessionToken) merged.sessionToken = state.sessionToken;
    if (state.adminPin && !merged.pin) merged.pin = state.adminPin;

    const action = String(merged.action || '');
    const handler = handlers[action];
    if (!handler) {
      console.warn('[apiCall] Unknown action:', action);
      return { success: false, message: 'Unknown action: ' + action };
    }
    try {
      return await handler(merged);
    } catch (err) {
      console.error('[apiCall]', action, err);
      return { success: false, message: err.message || String(err) };
    }
  };

})(window.App);