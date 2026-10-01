window.App = window.App || {};

// ============================================================
// Backend
// ============================================================
// ⚠️ Update this URL whenever you redeploy the Apps Script Web App.
App.WEB_APP_URL = "https://script.google.com/macros/s/AKfycbz1k4WmuwEUpTwE_A1UfZ8t4jeJb6J6mXqsKH45TrNojkuHB4F-nc_NwGa9q1UMGdPT/exec";
// ============================================================
// Supabase direct connection (fast path — no Apps Script)
// ============================================================
App.SUPABASE_URL = 'https://stxupxwelxuvlqbvnfq.supabase.co';
App.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0eHV4cHdlbHh1dnNscXZibmZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4MjkzMjcsImV4cCI6MjEwNjQwNTMyN30.UC28Udo_3Sut8kuqI9cJ3BGod_Agtpmj4XMOiqm0t6c';
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