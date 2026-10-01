window.App = window.App || {};

// ============================================================
// Backend
// ============================================================
// Supabase direct connection (fast path — no Apps Script)
// ============================================================
App.SUPABASE_URL = 'https://frxxbthgjawmptjgfco.supabase.co';
App.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZycnhidGhnamF3bXB0bGdmamNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4MzcwMTMsImV4cCI6MjEwNjQxMzAxM30.rJHKn8bzx7EUkEwiICV8VWRdZud4q9cZOnU6Oi1MTKw';
// ============================================================
// Credits
// ============================================================
// Shown at the bottom of every printed student grade report.
App.DEVELOPER_CREDIT = {
  developer: "Carl Harry M. Pandes",
  school: "Pili Capital College, Inc.",
  schoolLocation: "San Isidro, Pili, Camarines Sur"
};

// ============================================================
// Persistent login session
// ============================================================
// Session is stored in localStorage so it survives closing the
// browser. It expires after 30 days, or when the user logs out.
App.SESSION_KEY = "sp_persistent_session";
App.SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

App.state = {
  // Curriculum
  availableSubjects: [],
  subjectDescriptions: {},
  subjectWeights: {},

  // Data
  currentAdminData: [],
  allAdminGradesCache: {},     // subject -> array of grade rows
  currentStudentData: null,

  // Session (transient, per-tab)
  adminPin: "",
  sessionToken: "",

  // UI
  pendingImportData: [],
  activeManageStudentId: null,
  activeAdminSubject: "",
  activeManageSubject: "",
  activeStudentSubject: "",
  activeQuarterFilter: "All",

  // Concurrency
  reqSeq: 0,

  // Screens map (populated by initScreens)
  screens: {}
};