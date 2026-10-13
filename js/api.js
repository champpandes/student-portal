// ============================================================
// api.js — Direct Supabase client + edge function wrapper
// Multi-teacher version (Phase 1C — scoped reads)
// ============================================================
(function (App) {
  'use strict';

  const SB_URL = App.SUPABASE_URL;
  const SB_KEY = App.SUPABASE_ANON_KEY;
  const state = App.state;

  function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }

  // ------------------------------------------------------------
  // Admin Edge Function caller
  // ------------------------------------------------------------
  const ADMIN_FN_URL = SB_URL + '/functions/v1/admin';

async function callAdmin(payload) {
  const body = Object.assign({}, payload || {});
  if (state.sessionToken && !body.sessionToken) body.sessionToken = state.sessionToken;
  if (state.adminPin && !body.pin) body.pin = state.adminPin;

  const res = await fetch(ADMIN_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + SB_KEY
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[callAdmin]', res.status, text);
    throw new Error('Admin function ' + res.status + ': ' + text);
  }
  try { return JSON.parse(text); }
  catch (e) { return { success: false, message: 'Bad response from admin function.' }; }
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
      email: p.email, displayName: p.displayName, password: p.password
    }),

    teacherLogin: async (p) => callAdmin({
      action: 'teacherLogin', email: p.email, password: p.password
    }),

    teacherLogout: async (p) => callAdmin({
      action: 'teacherLogout', sessionToken: p.sessionToken
    }),

    getMe: async () => callAdmin({ action: 'getMe' }),

    markWalkthroughSeen: async () => callAdmin({ action: 'markWalkthroughSeen' }),

    adminLogin: async (p) => callAdmin({
      action: 'adminLogin', pin: p.pin, deviceId: p.deviceId
    }),

    // ============================================================
    // SUPER ADMIN — TEACHER MANAGEMENT
    // ============================================================

    listTeachers: async () => callAdmin({ action: 'listTeachers' }),

    approveTeacher: async (p) => callAdmin({
      action: 'approveTeacher', teacherId: p.teacherId, role: p.role
    }),

    rejectTeacher: async (p) => callAdmin({
      action: 'rejectTeacher', teacherId: p.teacherId
    }),

    setTeacherRole: async (p) => callAdmin({
      action: 'setTeacherRole', teacherId: p.teacherId, role: p.role
    }),

    setTeacherActive: async (p) => callAdmin({
      action: 'setTeacherActive', teacherId: p.teacherId, isActive: p.isActive
    }),

    resetTeacherPassword: async (p) => callAdmin({
      action: 'resetTeacherPassword', teacherId: p.teacherId, password: p.password
    }),

    deleteTeacher: async (p) => callAdmin({
      action: 'deleteTeacher', teacherId: p.teacherId
    }),

    // ============================================================
    // PUBLIC
    // ============================================================

    getPublicTeachers: async () => callAdmin({ action: 'getPublicTeachers' }),

    // ============================================================
    // SUBJECTS
    // ============================================================

getSubjects: async () => {
  const res = await callAdmin({ action: 'getSubjects' });
  return res && res.success ? res : { success: false, subjects: [], descriptions: {}, weights: {}, categories: {}, quarterWeights: {} };
},

    manageSubject: async (p) => callAdmin({
      action: 'manageSubject',
      subAction: p.subAction, oldName: p.oldName, newName: p.newName,
      subjectName: p.subjectName, description: p.description,
      categories: p.categories, quarterWeights: p.quarterWeights,
      confirmDelete: p.confirmDelete
    }),

    // ============================================================
    // SECTIONS — scoped via edge function
    // ============================================================

    getSections: async () => {
      const res = await callAdmin({ action: 'getSections' });
      return { success: true, sections: (res && res.sections) || [] };
    },

    manageSection: async (p) => callAdmin({
      action: 'manageSection', subAction: p.subAction,
      name: p.name, oldName: p.oldName
    }),

    // ============================================================
    // STUDENT LOOKUP / REGISTRATION
    // ============================================================

    getStudent: async (p) => {
      const res = await callAdmin({
        action: 'getStudent', studentNumber: p.studentNumber
      });
      return res;
    },

    registerStudent: async (p) => callAdmin({
      action: 'registerStudent', studentData: p.studentData
    }),

    getPendingRegistrations: async () => {
      const res = await callAdmin({ action: 'getPendingRegistrations' });
      return res && res.success ? res : { success: false, pending: [], history: [] };
    },

    approveRegistration: async (p) => callAdmin({
      action: 'approveRegistration',
      studentNumber: p.studentNumber, section: p.section, subjects: p.subjects
    }),

    rejectRegistration: async (p) => callAdmin({
      action: 'rejectRegistration', studentNumber: p.studentNumber
    }),

    // ============================================================
    // GRADES — scoped via edge function
    // ============================================================

    getAllGrades: async (p) => {
      const res = await callAdmin({
        action: 'getAllGrades', subject: p.subject || 'All'
      });
      if (Array.isArray(res)) return res;
      if (res && Array.isArray(res.grades)) return res.grades;
      return [];
    },

    saveGrades: async (p) => callAdmin({
      action: 'saveGrades',
      studentNumber: p.studentNumber, subject: p.subject, grades: p.grades
    }),

    saveBreakdown: async (p) => callAdmin({
      action: 'saveBreakdown',
      studentNumber: p.studentNumber, subject: p.subject,
      quarter: p.quarter, entries: p.entries
    }),

    bulkSaveBreakdown: async (p) => callAdmin({
      action: 'bulkSaveBreakdown',
      subject: p.subject, quarter: p.quarter, items: p.items
    }),

    // ============================================================
    // STUDENTS — CRUD
    // ============================================================

    addStudent: async (p) => callAdmin({
      action: 'addStudent', studentData: p.studentData
    }),

    bulkAddStudents: async (p) => callAdmin({
      action: 'bulkAddStudents', studentsArray: p.studentsArray
    }),

    updateStudentInfo: async (p) => callAdmin({
      action: 'updateStudentInfo',
      oldStudentNumber: p.oldStudentNumber, oldSubject: p.oldSubject, newData: p.newData
    }),

    deleteStudent: async (p) => callAdmin({
      action: 'deleteStudent', studentNumber: p.studentNumber
    }),

    // ============================================================
    // COMMENTS
    // ============================================================

    getComments: async () => {
      const res = await callAdmin({ action: 'getComments' });
      return res && res.success ? res : { success: false, comments: [] };
    },

    postComment: async (p) => callAdmin({
      action: 'postComment', studentNumber: p.studentNumber, commentText: p.commentText
    }),

    clearComments: async () => callAdmin({ action: 'clearComments' }),

    // ============================================================
    // ANNOUNCEMENTS
    // ============================================================

    getAnnouncement: async (p) => {
      const res = await callAdmin({
        action: 'getAnnouncement',
        teacherId: (p && p.teacherId) || ''
      });
      return res && res.success ? res : { success: true, message: '' };
    },

    saveAnnouncement: async (p) => callAdmin({
      action: 'saveAnnouncement', message: p.message
    }),

    getAnnouncementHistory: async () => {
      const res = await callAdmin({ action: 'getAnnouncementHistory' });
      return res && res.success ? res : { success: true, history: [] };
    },

    deleteAnnouncement: async (p) => callAdmin({
      action: 'deleteAnnouncement', rowIndex: p.rowIndex
    }),

    getTeacherName: async (p) => {
      const teacherId = (p && p.teacherId) || '';
      return callAdmin({ action: 'getTeacherName', teacherId });
    },

    saveTeacherName: async (p) => callAdmin({
      action: 'saveTeacherName', name: p.name
    }),

    getMyStats: async () => callAdmin({ action: 'getMyStats' }),

    changeMyPassword: async (p) => callAdmin({
      action: 'changeMyPassword',
      currentPassword: p.currentPassword,
      newPassword: p.newPassword
    }),

    // ============================================================
    // BACKUP
    // ============================================================

    backupAll: async () => {
      const [subjects, students, enrollments, grades, comments, announcements, pending, assessments, scores] = await Promise.all([
        sbGetTable('subjects'), sbGetTable('students'),
        sbGetTable('enrollments'), sbGetTable('grades'),
        sbGetTable('comments'), sbGetTable('announcements'),
        sbGetTable('pending_registrations'),
        sbGetTable('assessments'), sbGetTable('scores')
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
      action: 'restoreAll', backup: p.backup
    }),

    recomputeAllGrades: async () => callAdmin({ action: 'recomputeAllGrades' }),

    // ============================================================
    // CLASS RECORD — scoped via edge function
    // ============================================================

    getClassRecord: async (p) => {
      const res = await callAdmin({
        action: 'getClassRecord',
        subject: p.subject, quarter: p.quarter
      });
      return res && res.success ? res : { success: false, message: (res && res.message) || 'Failed.' };
    },

    addAssessment: async (p) => callAdmin({
      action: 'addAssessment', subject: p.subject, quarter: p.quarter,
      categoryId: p.categoryId, name: p.name, totalPoints: p.totalPoints
    }),

    renameAssessment: async (p) => callAdmin({
      action: 'renameAssessment', id: p.id, name: p.name, totalPoints: p.totalPoints
    }),

    deleteAssessment: async (p) => callAdmin({
      action: 'deleteAssessment', id: p.id
    }),

    saveScore: async (p) => callAdmin({
      action: 'saveScore', assessmentId: p.assessmentId,
      studentNumber: p.studentNumber, score: p.score
    }),

    saveScoresBatch: async (p) => callAdmin({
      action: 'saveScoresBatch', items: p.items
    }),

    applyClassRecordToGrades: async (p) => callAdmin({
      action: 'applyClassRecordToGrades', subject: p.subject, quarter: p.quarter
    })
  };

  // Backup helper — direct REST reads (backup is a local download, not a UI read)
  async function sbGetTable(table) {
    const res = await fetch(SB_URL + '/rest/v1/' + table + '?select=*', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
    });
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
  }

  // ============================================================
  // apiCall — auto-attaches sessionToken / pin
  // ============================================================
  App.apiCall = async function (payload, opts) {
    const merged = Object.assign({}, payload || {});
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