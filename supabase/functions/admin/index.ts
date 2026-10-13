// ============================================================
// Edge Function: admin
// Handles all privileged operations for the Teacher Portal.
// Runs server-side with the service_role key.
// Multi-teacher version (Phase 1C — scoped reads, legacy-safe).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SESSION_DAYS = 30;

const TRANSMUTATION: [number, number][] = [
  [98.40, 99], [96.80, 98], [95.20, 97], [93.60, 96], [92.00, 95],
  [90.40, 94], [88.80, 93], [87.20, 92], [85.60, 91], [84.00, 90],
  [82.40, 89], [80.80, 88], [79.20, 87], [77.60, 86], [76.00, 85],
  [74.40, 84], [72.80, 83], [71.20, 82], [69.60, 81], [68.00, 80],
  [66.40, 79], [64.80, 78], [63.20, 77], [61.60, 76], [60.00, 75],
  [56.00, 74], [52.00, 73], [48.00, 72], [44.00, 71], [40.00, 70],
  [36.00, 69], [32.00, 68], [28.00, 67], [24.00, 66], [20.00, 65],
  [16.00, 64], [12.00, 63], [8.00, 62],  [4.00, 61],  [0.00, 60]
];

const QUARTER_ORDINAL: Record<string, string> = {
  "1": "1st", "2": "2nd", "3": "3rd", "4": "4th"
};

function normalizeQuarterLabel(q: any): string {
  const s = String(q || "").toLowerCase().trim();
  if (!s) return "";
  const m = s.match(/^([1-4])/);
  return m ? QUARTER_ORDINAL[m[1]] : s;
}

// ============================================================
// Legacy rows created before the multi-teacher upgrade have NULL
// teacher_id. We still want the first teacher to see them, so
// the filter is: "mine OR unassigned".
// ============================================================
function scopeByTeacher(query: any, teacherId: string | null) {
  if (!teacherId) return query;
  return query.or(`teacher_id.eq.${teacherId},teacher_id.is.null`);
}

// ============================================================
// Generic helpers
// ============================================================

function transmuteGrade(score: any): number | "" {
  if (score === "" || score === null || isNaN(score)) return "";
  const s = Number(score);
  if (s >= 100) return 100;
  for (const [lo, hi] of TRANSMUTATION) {
    if (s >= lo) return hi;
  }
  return 60;
}

function determineRemarks(f: any): string {
  if (f === "" || f === null || isNaN(f)) return "";
  return Number(f) >= 75 ? "Passed" : "Failed";
}

function stripTags(s: any) { return String(s ?? "").replace(/[<>]/g, ""); }
function normalizeEmail(s: any) { return String(s || "").trim().toLowerCase(); }
function isValidEmail(s: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function json(data: any, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password),
    { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  try {
    const { hash: computed } = await hashPassword(password, salt);
    if (computed.length !== hash.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(buf));
}

function computeWeightedFinal(q1: any, q2: any, q3: any, q4: any, quarterWeights: any): number | "" {
  const w = quarterWeights || { "1st": 25, "2nd": 25, "3rd": 25, "4th": 25 };
  const pairs: [any, number][] = [
    [q1, Number(w["1st"] || 0)],
    [q2, Number(w["2nd"] || 0)],
    [q3, Number(w["3rd"] || 0)],
    [q4, Number(w["4th"] || 0)]
  ];
  const valid = pairs.filter(([v]) => v !== null && v !== undefined && v !== "" && !isNaN(v));
  if (valid.length === 0) return "";
  let totalWeight = 0, sum = 0;
  for (const [v, weight] of valid) {
    sum += Number(v) * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return "";
  return Math.round(sum / totalWeight);
}

// ============================================================
// Session / auth helpers
// ============================================================

interface AuthContext {
  teacher: any;
  legacy: boolean;
}

async function resolveAuth(sb: any, body: any): Promise<AuthContext | null> {
  const token = String(body?.sessionToken || "").trim();
  if (token) {
    const rows = await sb.from("teacher_sessions")
      .select("teacher_id, expires_at").eq("token", token).limit(1);
    if (rows.data && rows.data.length > 0) {
      const session = rows.data[0];
      if (new Date(session.expires_at) > new Date()) {
        const tRes = await sb.from("teachers")
          .select("*").eq("id", session.teacher_id).limit(1);
        if (tRes.data && tRes.data.length > 0) {
          const teacher = tRes.data[0];
          if (teacher.is_active && teacher.status === "approved") {
            return { teacher, legacy: false };
          }
        }
      }
    }
  }

  const pin = String(body?.pin || "").trim();
  if (pin) {
    const pinRows = await sb.from("settings")
      .select("value").eq("key", "admin_pin_hash").limit(1);
    if (pinRows.data && pinRows.data.length > 0) {
      const hash = await sha256(pin);
      if (hash === pinRows.data[0].value) {
        const saRes = await sb.from("teachers")
          .select("*").eq("role", "super_admin")
          .eq("status", "approved").eq("is_active", true).limit(1);
        const teacher = (saRes.data && saRes.data.length > 0) ? saRes.data[0] : null;
        return { teacher, legacy: true };
      }
    }
  }

  return null;
}

function requireSuperAdmin(auth: AuthContext | null): boolean {
  if (!auth || !auth.teacher) return false;
  return auth.teacher.role === "super_admin";
}

// ============================================================
// Entry point
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const body = await req.json();
    const action = String(body?.action || "");

    // -------- Public actions (no auth) --------
    switch (action) {
      case "registerTeacher":   return json(await registerTeacher(sb, body), 200);
      case "teacherLogin":      return json(await teacherLogin(sb, body), 200);
      case "getPublicTeachers": return json(await getPublicTeachers(sb), 200);
      case "getStudent":        return json(await getStudent(sb, body), 200);
      case "registerStudent":   return json(await registerStudent(sb, body), 200);
      case "getTeacherName":    return json(await getTeacherName(sb, body), 200);
    }

    // -------- Everything else requires auth --------
    const auth = await resolveAuth(sb, body);
    if (!auth) {
      return json({ success: false, message: "Not authenticated. Please log in again." }, 200);
    }

    const SUPER_ONLY = new Set([
      "listTeachers", "approveTeacher", "rejectTeacher",
      "setTeacherRole", "setTeacherActive", "resetTeacherPassword", "deleteTeacher"
    ]);
    if (SUPER_ONLY.has(action)) {
      if (!requireSuperAdmin(auth)) {
        return json({ success: false, message: "Super admin access required." }, 200);
      }
    }

    let result: any;
    switch (action) {
      // Auth / session
      case "getMe":                 result = await getMe(sb, auth); break;
      case "teacherLogout":         result = await teacherLogout(sb, body); break;
      case "markWalkthroughSeen":   result = await markWalkthroughSeen(sb, auth); break;

      // Super admin — teacher management
      case "listTeachers":          result = await listTeachers(sb); break;
      case "approveTeacher":        result = await approveTeacher(sb, body, auth); break;
      case "rejectTeacher":         result = await rejectTeacher(sb, body); break;
      case "setTeacherRole":        result = await setTeacherRole(sb, body); break;
      case "setTeacherActive":      result = await setTeacherActive(sb, body); break;
      case "resetTeacherPassword":  result = await resetTeacherPassword(sb, body); break;
      case "deleteTeacher":         result = await deleteTeacher(sb, body, auth); break;

      // ===== SCOPED READS =====
      case "getAllGrades":          result = await getAllGradesScoped(sb, body, auth); break;
      case "getSections":           result = await buildSectionsPayload(sb, auth.teacher?.id || null); break;
      case "getPendingRegistrations": result = await getPendingRegistrationsScoped(sb, auth); break;
      case "getComments":           result = await getCommentsScoped(sb, auth); break;
      case "getAnnouncement":       result = await getAnnouncementScoped(sb, body, auth); break;
      case "getAnnouncementHistory": result = await getAnnouncementHistoryScoped(sb, auth); break;
      case "getClassRecord":        result = await getClassRecordScoped(sb, body, auth); break;

      // ===== SCOPED WRITES / other =====
      case "adminLogin":            result = await adminLogin(sb, body); break;
      case "saveGrades":            result = await saveGrades(sb, body, auth); break;
      case "saveBreakdown":         result = await saveBreakdown(sb, body, auth, false); break;
      case "bulkSaveBreakdown":     result = await saveBreakdown(sb, body, auth, true); break;
      case "addStudent":            result = await addStudent(sb, body, auth, false); break;
      case "bulkAddStudents":       result = await addStudent(sb, body, auth, true); break;
      case "updateStudentInfo":     result = await updateStudentInfo(sb, body, auth); break;
      case "deleteStudent":         result = await deleteStudent(sb, body, auth); break;
      case "clearComments":         result = await clearComments(sb, auth); break;
      case "saveAnnouncement":      result = await saveAnnouncement(sb, body, auth); break;
      case "deleteAnnouncement":    result = await deleteAnnouncement(sb, body, auth); break;
      case "manageSubject":         result = await manageSubject(sb, body, auth); break;
      case "manageSection":         result = await manageSection(sb, body, auth); break;
      case "approveRegistration":   result = await approveRegistration(sb, body, auth); break;
      case "rejectRegistration":    result = await rejectRegistration(sb, body, auth); break;
      case "recomputeAllGrades":    result = await recomputeAllGrades(sb, auth); break;
      case "restoreAll":            result = await restoreAll(sb, body, auth); break;
      case "postComment":           result = await postComment(sb, body, auth); break;
      case "addAssessment":         result = await addAssessment(sb, body, auth); break;
      case "renameAssessment":      result = await renameAssessment(sb, body, auth); break;
      case "deleteAssessment":      result = await deleteAssessment(sb, body, auth); break;
      case "saveScore":             result = await saveScore(sb, body, auth); break;
      case "saveScoresBatch":       result = await saveScoresBatch(sb, body, auth); break;
      case "applyClassRecordToGrades": result = await applyClassRecordToGrades(sb, body, auth); break;
      case "saveTeacherName":       result = await saveTeacherName(sb, body, auth); break;

      default:
        return json({ success: false, message: "Unknown action: " + action }, 200);
    }

    return json(result, 200);
  } catch (err) {
    console.error("[admin fn]", err);
    return json({ success: false, message: (err as Error).message || String(err) }, 200);
  }
});

// ============================================================
// Scoped reads
// ============================================================

async function getAllGradesScoped(sb: any, p: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  const subject = String(p.subject || "");

  let gq = sb.from("grades").select("*").order("student_number", { ascending: true });
  if (subject && subject !== "All") gq = gq.eq("subject_name", subject);
  gq = scopeByTeacher(gq, teacherId);

  const gRows = await gq;
  if (!gRows.data) return [];

  let sq = sb.from("students").select("student_number,name,section");
  sq = scopeByTeacher(sq, teacherId);
  const sRows = await sq;
  const sMap: Record<string, any> = {};
  (sRows.data || []).forEach((s: any) => { sMap[s.student_number] = s; });

  return gRows.data
    .filter((r: any) => {
      const sNo = String(r.student_number);
      return !(sNo.indexOf("T") !== -1 && sNo.indexOf("-") !== -1);
    })
    .map((r: any) => {
      const stu = sMap[r.student_number] || {};
      return {
        studentNumber: String(r.student_number),
        name: stu.name || "",
        section: stu.section || "Section A",
        subject: r.subject_name,
        q1: r.q1, q2: r.q2, q3: r.q3, q4: r.q4,
        final: r.final,
        remarks: r.remarks || determineRemarks(r.final)
      };
    });
}

async function getPendingRegistrationsScoped(sb: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  let q = sb.from("pending_registrations").select("*").order("id", { ascending: false });
  q = scopeByTeacher(q, teacherId);
  const rows = await q;

  const pending: any[] = [], history: any[] = [];
  (rows.data || []).forEach((r: any) => {
    const item = {
      timestamp: r.timestamp || "",
      studentNumber: r.student_number || "",
      name: r.name || "",
      section: r.section || "",
      subjects: Array.isArray(r.enrolled_subjects) ? r.enrolled_subjects : [],
      status: r.status || "pending",
      reviewedAt: r.reviewed_at || "",
      teacherId: r.teacher_id || null
    };
    (item.status === "pending" ? pending : history).push(item);
  });
  return { success: true, pending, history };
}

async function getCommentsScoped(sb: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  let q = sb.from("comments").select("*").order("id", { ascending: true });
  q = scopeByTeacher(q, teacherId);
  const rows = await q;
  return {
    success: true,
    comments: (rows.data || []).map((r: any) => ({
      timestamp: r.timestamp || "",
      studentNumber: r.student_number || "",
      studentName: r.student_name || "",
      text: r.comment_text || ""
    }))
  };
}

async function getAnnouncementScoped(sb: any, p: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || String(p?.teacherId || "").trim() || null;
  let query = sb.from("announcements").select("*")
    .eq("is_active", true).order("id", { ascending: false }).limit(1);
  query = scopeByTeacher(query, teacherId);
  const rows = await query;
  if (rows.data && rows.data.length > 0) {
    return {
      success: true,
      message: rows.data[0].message || "",
      timestamp: rows.data[0].timestamp || "",
      postedBy: rows.data[0].posted_by || ""
    };
  }
  return { success: true, message: "" };
}

async function getAnnouncementHistoryScoped(sb: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  let q = sb.from("announcements").select("*").order("id", { ascending: false });
  q = scopeByTeacher(q, teacherId);
  const rows = await q;
  return {
    success: true,
    history: (rows.data || []).map((r: any) => ({
      rowIndex: r.id,
      timestamp: r.timestamp || "",
      message: r.message || "",
      postedBy: r.posted_by || "",
      active: !!r.is_active
    }))
  };
}

async function getClassRecordScoped(sb: any, p: any, auth: AuthContext) {
  const subject = String(p.subject || "");
  const quarter = String(p.quarter || "");
  const teacherId = auth.teacher?.id || null;
  if (!subject || !quarter) return { success: false, message: "Subject and quarter required." };

  let catQ = sb.from("subject_categories")
    .select("id,name,weight,position").eq("subject_name", subject)
    .order("position", { ascending: true });
  catQ = scopeByTeacher(catQ, teacherId);
  const catRows = await catQ;
  const categories = Array.isArray(catRows.data) ? catRows.data : [];

  let assessQ = sb.from("assessments").select("*")
    .eq("subject_name", subject).eq("quarter", quarter)
    .order("category_id", { ascending: true }).order("position", { ascending: true });
  assessQ = scopeByTeacher(assessQ, teacherId);
  const assessRows = await assessQ;
  const assessments = Array.isArray(assessRows.data) ? assessRows.data : [];

  let scores: any[] = [];
  if (assessments.length > 0) {
    const ids = assessments.map((a: any) => a.id).join(",");
    scores = await sbGet(sb, "scores", "select=*&assessment_id=in.(" + ids + ")");
  }

  let enrQ = sb.from("enrollments").select("student_number").eq("subject_name", subject);
  enrQ = scopeByTeacher(enrQ, teacherId);
  const enrRows = await enrQ;
  const studentNumbers = (Array.isArray(enrRows.data) ? enrRows.data : [])
    .map((e: any) => String(e.student_number));

  let students: any[] = [];
  if (studentNumbers.length > 0) {
    let sQ = sb.from("students")
      .select("student_number,name,section").in("student_number", studentNumbers);
    sQ = scopeByTeacher(sQ, teacherId);
    const sRows = await sQ;
    students = Array.isArray(sRows.data) ? sRows.data : [];
  }

  return { success: true, categories, assessments, scores, students };
}

// Tiny helper so scoped reads don't need to re-import PostgREST
async function sbGet(sb: any, table: string, query: string) {
  const url = new URL(SUPABASE_URL + "/rest/v1/" + table + (query ? "?" + query : ""));
  const res = await fetch(url.toString(), {
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) return [];
  try { return await res.json(); } catch { return []; }
}

// ============================================================
// Teacher auth
// ============================================================

async function registerTeacher(sb: any, p: any) {
  const email = normalizeEmail(p.email);
  const displayName = stripTags(String(p.displayName || "").trim()).slice(0, 120);
  const password = String(p.password || "");

  if (!email || !isValidEmail(email)) return { success: false, message: "Enter a valid email." };
  if (!displayName) return { success: false, message: "Enter your name." };
  if (password.length < 6) return { success: false, message: "Password must be at least 6 characters." };

  const countRes = await sb.from("teachers").select("id", { count: "exact", head: true });
  const isFirst = !countRes.count || countRes.count === 0;

  const existing = await sb.from("teachers").select("id").eq("email", email).limit(1);
  if (existing.data && existing.data.length > 0) {
    return { success: false, message: "That email is already registered." };
  }

  const { hash, salt } = await hashPassword(password);
  const now = new Date().toISOString();

  const payload: any = {
    email, display_name: displayName,
    password_hash: hash, password_salt: salt,
    role: isFirst ? "super_admin" : "teacher",
    status: isFirst ? "approved" : "pending",
    is_active: true,
    created_at: now
  };
  if (isFirst) payload.approved_at = now;

  const ins = await sb.from("teachers").insert(payload).select();
  if (ins.error) throw ins.error;

  const teacher = ins.data[0];

  if (isFirst) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await sb.from("teacher_sessions").insert({ token, teacher_id: teacher.id, expires_at: expiresAt });
    return { success: true, firstUser: true, sessionToken: token, teacher: publicTeacher(teacher) };
  }

  return {
    success: true,
    pending: true,
    message: "Your registration was submitted. A super admin will review it shortly."
  };
}

async function teacherLogin(sb: any, p: any) {
  const email = normalizeEmail(p.email);
  const password = String(p.password || "");
  if (!email || !password) return { success: false, message: "Enter your email and password." };

  const rows = await sb.from("teachers").select("*").eq("email", email).limit(1);
  if (!rows.data || rows.data.length === 0) {
    return { success: false, message: "Invalid email or password." };
  }

  const teacher = rows.data[0];
  const ok = await verifyPassword(password, teacher.password_hash, teacher.password_salt);
  if (!ok) return { success: false, message: "Invalid email or password." };

  if (teacher.status === "pending") {
    return { success: false, pending: true, message: "Your registration is awaiting approval." };
  }
  if (teacher.status === "rejected") {
    return { success: false, rejected: true, message: "Your registration was not approved." };
  }
  if (!teacher.is_active) {
    return { success: false, message: "Your account has been deactivated." };
  }

  await sb.from("teacher_sessions")
    .delete().eq("teacher_id", teacher.id)
    .lt("expires_at", new Date().toISOString());

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sess = await sb.from("teacher_sessions").insert({
    token, teacher_id: teacher.id, expires_at: expiresAt
  });
  if (sess.error) throw sess.error;

  await sb.from("teachers").update({ last_login_at: new Date().toISOString() }).eq("id", teacher.id);

  return { success: true, sessionToken: token, teacher: publicTeacher(teacher) };
}

async function teacherLogout(sb: any, p: any) {
  const token = String(p.sessionToken || "").trim();
  if (token) await sb.from("teacher_sessions").delete().eq("token", token);
  return { success: true };
}

async function getMe(sb: any, auth: AuthContext) {
  if (!auth.teacher) return { success: true, legacy: true, teacher: null };
  return { success: true, teacher: publicTeacher(auth.teacher) };
}

async function markWalkthroughSeen(sb: any, auth: AuthContext) {
  if (auth.teacher) {
    await sb.from("teachers").update({ has_seen_walkthrough: true }).eq("id", auth.teacher.id);
  }
  return { success: true };
}

function publicTeacher(t: any) {
  return {
    id: t.id,
    email: t.email,
    displayName: t.display_name,
    role: t.role,
    status: t.status,
    isActive: t.is_active,
    hasSeenWalkthrough: t.has_seen_walkthrough,
    createdAt: t.created_at,
    lastLoginAt: t.last_login_at
  };
}

// ============================================================
// Public teachers list
// ============================================================

async function getPublicTeachers(sb: any) {
  const rows = await sb.from("teachers")
    .select("id, display_name")
    .eq("status", "approved").eq("is_active", true)
    .order("display_name", { ascending: true });
  return {
    success: true,
    teachers: (rows.data || []).map((r: any) => ({ id: r.id, displayName: r.display_name }))
  };
}

// ============================================================
// Super admin — teacher management
// ============================================================

async function listTeachers(sb: any) {
  const rows = await sb.from("teachers").select("*").order("created_at", { ascending: false });
  return {
    success: true,
    teachers: (rows.data || []).map((t: any) => ({
      id: t.id, email: t.email, displayName: t.display_name,
      role: t.role, status: t.status, isActive: t.is_active,
      createdAt: t.created_at, approvedAt: t.approved_at, lastLoginAt: t.last_login_at
    }))
  };
}

async function approveTeacher(sb: any, p: any, auth: AuthContext) {
  const id = String(p.teacherId || "");
  const role = String(p.role || "teacher");
  if (!id) return { success: false, message: "Missing teacher id." };
  if (role !== "teacher" && role !== "super_admin") {
    return { success: false, message: "Invalid role." };
  }
  const { error } = await sb.from("teachers").update({
    status: "approved", role,
    approved_at: new Date().toISOString(),
    approved_by: auth.teacher.id
  }).eq("id", id);
  if (error) throw error;
  return { success: true };
}

async function rejectTeacher(sb: any, p: any) {
  const id = String(p.teacherId || "");
  if (!id) return { success: false, message: "Missing teacher id." };
  const { error } = await sb.from("teachers").update({ status: "rejected" }).eq("id", id);
  if (error) throw error;
  return { success: true };
}

async function setTeacherRole(sb: any, p: any) {
  const id = String(p.teacherId || "");
  const role = String(p.role || "");
  if (!id) return { success: false, message: "Missing teacher id." };
  if (role !== "teacher" && role !== "super_admin") {
    return { success: false, message: "Invalid role." };
  }
  if (role === "teacher") {
    const current = await sb.from("teachers").select("role").eq("id", id).limit(1);
    if (current.data && current.data.length > 0 && current.data[0].role === "super_admin") {
      const others = await sb.from("teachers")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin").neq("id", id);
      if (!others.count || others.count === 0) {
        return { success: false, message: "Cannot demote the last super admin." };
      }
    }
  }
  const { error } = await sb.from("teachers").update({ role }).eq("id", id);
  if (error) throw error;
  return { success: true };
}

async function setTeacherActive(sb: any, p: any) {
  const id = String(p.teacherId || "");
  const active = !!p.isActive;
  if (!id) return { success: false, message: "Missing teacher id." };
  const { error } = await sb.from("teachers").update({ is_active: active }).eq("id", id);
  if (error) throw error;
  if (!active) await sb.from("teacher_sessions").delete().eq("teacher_id", id);
  return { success: true };
}

async function resetTeacherPassword(sb: any, p: any) {
  const id = String(p.teacherId || "");
  const password = String(p.password || "");
  if (!id) return { success: false, message: "Missing teacher id." };
  if (password.length < 6) return { success: false, message: "Password must be at least 6 characters." };
  const { hash, salt } = await hashPassword(password);
  const { error } = await sb.from("teachers").update({
    password_hash: hash, password_salt: salt
  }).eq("id", id);
  if (error) throw error;
  await sb.from("teacher_sessions").delete().eq("teacher_id", id);
  return { success: true };
}

async function deleteTeacher(sb: any, p: any, auth: AuthContext) {
  const id = String(p.teacherId || "");
  if (!id) return { success: false, message: "Missing teacher id." };
  if (id === auth.teacher.id) {
    return { success: false, message: "You cannot delete your own account." };
  }
  const { error } = await sb.from("teachers").delete().eq("id", id);
  if (error) throw error;
  return { success: true };
}

// ============================================================
// Legacy admin login
// ============================================================

async function adminLogin(sb: any, p: any) {
  const input = String(p.pin || "");
  const deviceId = String(p.deviceId || "unknown").slice(0, 64);
  if (!input) return { success: false, message: "Enter your PIN." };

  const lockRows = await sb.from("login_attempts").select("*").eq("device_id", deviceId);
  const existing = (lockRows.data && lockRows.data.length) ? lockRows.data[0] : null;
  const now = new Date();

  if (existing && existing.locked_until && new Date(existing.locked_until) > now) {
    const secsLeft = Math.ceil((new Date(existing.locked_until).getTime() - now.getTime()) / 1000);
    const minsLeft = Math.ceil(secsLeft / 60);
    return {
      success: false,
      message: `Too many failed attempts. Try again in ${minsLeft} minute${minsLeft === 1 ? "" : "s"}.`
    };
  }

  const rows = await sb.from("settings").select("value").eq("key", "admin_pin_hash").limit(1);
  if (!rows.data || rows.data.length === 0) {
    return { success: false, message: "Admin PIN not configured in database." };
  }

  const hash = await sha256(input);
  if (hash === rows.data[0].value) {
    await sb.from("login_attempts").upsert(
      { device_id: deviceId, attempts: 0, locked_until: null, updated_at: now.toISOString() },
      { onConflict: "device_id" }
    );
    return { success: true };
  }

  const curAttempts = (existing?.attempts || 0) + 1;
  let lockedUntil: string | null = null;
  if (curAttempts >= 5) {
    lockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  }
  await sb.from("login_attempts").upsert(
    { device_id: deviceId, attempts: curAttempts, locked_until: lockedUntil, updated_at: now.toISOString() },
    { onConflict: "device_id" }
  );

  if (lockedUntil) {
    return { success: false, message: "Too many failed attempts. Locked out for 15 minutes." };
  }
  const remaining = 5 - curAttempts;
  return {
    success: false,
    message: `Invalid PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
  };
}

// ============================================================
// Grades
// ============================================================

async function saveGrades(sb: any, p: any, auth: AuthContext) {
  const sNo = String(p.studentNumber || "");
  const subj = String(p.subject || "");
  const grades = p.grades || {};

  const existing = await sb.from("grades").select("*")
    .eq("student_number", sNo).eq("subject_name", subj);
  const row = existing.data?.[0] || null;

  function pick(inp: any, old: any) {
    if (inp !== "" && inp !== undefined && inp !== null) return Number(inp);
    if (old !== "" && old !== undefined && old !== null && !isNaN(old)) return Number(old);
    return "";
  }

  const q1 = pick(grades.q1, row?.q1);
  const q2 = pick(grades.q2, row?.q2);
  const q3 = pick(grades.q3, row?.q3);
  const q4 = pick(grades.q4, row?.q4);

  const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subj).limit(1);
  const qw = (subjRow.data && subjRow.data[0]) ? subjRow.data[0].quarter_weights : null;
  const final = computeWeightedFinal(q1, q2, q3, q4, qw);

  const payload: any = {
    student_number: sNo, subject_name: subj,
    q1: String(q1 === "" ? "" : q1), q2: String(q2 === "" ? "" : q2),
    q3: String(q3 === "" ? "" : q3), q4: String(q4 === "" ? "" : q4),
    final: String(final === "" ? "" : final),
    remarks: determineRemarks(final),
    breakdowns: row?.breakdowns || []
  };
  if (auth.teacher) payload.teacher_id = auth.teacher.id;

  const { error } = await sb.from("grades").upsert(payload, {
    onConflict: "student_number,subject_name"
  });
  if (error) throw error;
  return { success: true };
}

async function saveBreakdown(sb: any, p: any, auth: AuthContext, isBulk: boolean) {
  const subj = String(p.subject || "");
  const qNum = String(p.quarter || "").replace(/\D/g, "");
  const qKey = "q" + qNum;

  let catQ = sb.from("subject_categories").select("id,name,weight").eq("subject_name", subj);
  if (auth.teacher) catQ = catQ.eq("teacher_id", auth.teacher.id);
  const catRows = await catQ;
  const cats: any[] = catRows.data || [];
  if (cats.length === 0) {
    return { success: false, message: "No categories configured for this subject." };
  }
  const catByName: Record<string, any> = {};
  cats.forEach((c: any) => { catByName[String(c.name).toLowerCase()] = c; });

  const items = isBulk
    ? (p.items || [])
    : [{ studentNumber: p.studentNumber, entries: p.entries, breakdown: p.breakdown }];
  if (items.length === 0) return { success: true, newTotal: "", processed: 0 };

  let gq = sb.from("grades").select("*").eq("subject_name", subj);
  if (auth.teacher) gq = gq.eq("teacher_id", auth.teacher.id);
  const rows = await gq;
  const byStudent: Record<string, any> = {};
  (rows.data || []).forEach((r: any) => { byStudent[r.student_number] = r; });

  const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subj).limit(1);
  const qw = (subjRow.data && subjRow.data[0]) ? subjRow.data[0].quarter_weights : null;

  let processed = 0, lastNewTotal: any = "";
  const updates: any[] = [];

  for (const item of items) {
    const sNo = String(item.studentNumber);
    const row = byStudent[sNo];
    if (!row) continue;

    const valuesById: Record<string, any> = {};
    if (Array.isArray(item.entries)) {
      item.entries.forEach((e: any) => { valuesById[String(e.categoryId)] = e.value; });
    } else if (item.breakdown) {
      ["quizzes","participation","attendance","exams"].forEach(name => {
        const cat = catByName[name];
        if (cat && item.breakdown[name] !== undefined) {
          valuesById[String(cat.id)] = item.breakdown[name];
        }
      });
    }

    let raw = 0, anyValue = false;
    cats.forEach((c: any) => {
      const v = valuesById[String(c.id)];
      if (v !== "" && v !== null && v !== undefined && !isNaN(v)) {
        raw += Number(v) * (Number(c.weight) / 100);
        anyValue = true;
      }
    });

    let qScore: any;
    if (anyValue) qScore = transmuteGrade(raw);
    else {
      const cur = row[qKey];
      qScore = (cur !== "" && !isNaN(cur)) ? Number(cur) : 0;
    }
    lastNewTotal = qScore;

    const targetLabel = QUARTER_ORDINAL[qNum] || qNum;
    let bds = Array.isArray(row.breakdowns) ? row.breakdowns.slice() : [];
    let matched = false;
    for (let j = 0; j < bds.length; j++) {
      if (normalizeQuarterLabel(bds[j].quarter) === targetLabel) {
        bds[j].quarter = targetLabel;
        bds[j].categories = { ...(bds[j].categories || {}), ...valuesById };
        bds[j].total = qScore;
        matched = true;
        break;
      }
    }
    if (!matched) bds.push({ quarter: targetLabel, categories: valuesById, total: qScore });

    const updated: any = { q1: row.q1, q2: row.q2, q3: row.q3, q4: row.q4 };
    updated[qKey] = qScore;
    const final = computeWeightedFinal(updated.q1, updated.q2, updated.q3, updated.q4, qw);

    const payload: any = {
      student_number: sNo, subject_name: subj,
      q1: String(updated.q1 === "" ? "" : updated.q1),
      q2: String(updated.q2 === "" ? "" : updated.q2),
      q3: String(updated.q3 === "" ? "" : updated.q3),
      q4: String(updated.q4 === "" ? "" : updated.q4),
      final: String(final === "" ? "" : final),
      remarks: determineRemarks(final),
      breakdowns: bds
    };
    if (auth.teacher) payload.teacher_id = auth.teacher.id;
    updates.push(payload);
    processed++;
  }

  if (updates.length === 0) return { success: true, newTotal: lastNewTotal, processed: 0 };

  const { error } = await sb.from("grades").upsert(updates, {
    onConflict: "student_number,subject_name"
  });
  if (error) throw error;

  return { success: true, newTotal: lastNewTotal, processed };
}

// ============================================================
// Students
// ============================================================

async function addStudent(sb: any, p: any, auth: AuthContext, isBulk: boolean) {
  const list = isBulk ? (p.studentsArray || []) : [p.studentData];
  let processed = 0;
  for (const sData of list) {
    if (!sData) continue;
    const sNo = String(sData.studentNumber || "").trim();
    const name = stripTags(String(sData.name || "").trim());
    const section = stripTags(String(sData.section || "Section A"));
    const subjects = sData.enrolledSubjects || [];
    if (!sNo || !name) continue;

    const studentPayload: any = { student_number: sNo, name, section };
    if (auth.teacher) studentPayload.teacher_id = auth.teacher.id;

    let { error } = await sb.from("students").upsert(studentPayload, { onConflict: "student_number" });
    if (error) throw error;

    for (const sub of subjects) {
      const subName = String(sub);
      const ex = await sb.from("enrollments").select("id")
        .eq("student_number", sNo).eq("subject_name", subName);
      if (!ex.data || ex.data.length === 0) {
        const enrollPayload: any = { student_number: sNo, subject_name: subName };
        if (auth.teacher) enrollPayload.teacher_id = auth.teacher.id;
        const ins = await sb.from("enrollments").insert(enrollPayload);
        if (ins.error) throw ins.error;
      }
      const gradePayload: any = {
        student_number: sNo, subject_name: subName,
        q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: []
      };
      if (auth.teacher) gradePayload.teacher_id = auth.teacher.id;
      const g = await sb.from("grades").upsert(gradePayload, {
        onConflict: "student_number,subject_name"
      });
      if (g.error) throw g.error;
    }
    processed++;
  }
  return { success: true, processed };
}

async function updateStudentInfo(sb: any, p: any, auth: AuthContext) {
  const oldId = String(p.oldStudentNumber || "");
  const oldSubj = String(p.oldSubject || "");
  const nData = p.newData || {};
  const newId = String(nData.studentNumber || oldId);
  const newName = stripTags(nData.name || "");
  const newSection = stripTags(nData.section || "");
  const newSubj = String(nData.subject || oldSubj);

  let { error } = await sb.from("students")
    .update({ student_number: newId, name: newName, section: newSection })
    .eq("student_number", oldId);
  if (error) throw error;

  if (oldId !== newId) {
    await sb.from("grades").update({ student_number: newId }).eq("student_number", oldId);
    await sb.from("enrollments").update({ student_number: newId }).eq("student_number", oldId);
    await sb.from("scores").update({ student_number: newId }).eq("student_number", oldId);
    await sb.from("pending_registrations").update({ student_number: newId }).eq("student_number", oldId);
  }

  const commentUpdate: any = {};
  if (oldId !== newId) commentUpdate.student_number = newId;
  if (newName) commentUpdate.student_name = newName;
  if (Object.keys(commentUpdate).length > 0) {
    await sb.from("comments").update(commentUpdate).eq("student_number", oldId);
  }

  if (oldSubj !== newSubj) {
    await sb.from("grades").update({ subject_name: newSubj })
      .eq("student_number", newId).eq("subject_name", oldSubj);
    await sb.from("enrollments").update({ subject_name: newSubj })
      .eq("student_number", newId).eq("subject_name", oldSubj);
  }
  return { success: true };
}

async function deleteStudent(sb: any, p: any, auth: AuthContext) {
  const sNo = String(p.studentNumber || "");
  await sb.from("scores").delete().eq("student_number", sNo);
  await sb.from("grades").delete().eq("student_number", sNo);
  await sb.from("enrollments").delete().eq("student_number", sNo);
  await sb.from("comments").delete().eq("student_number", sNo);
  await sb.from("pending_registrations").delete().eq("student_number", sNo);
  await sb.from("students").delete().eq("student_number", sNo);
  return { success: true };
}

// ============================================================
// Student lookup (public)
// ============================================================

async function getStudent(sb: any, p: any) {
  const sNo = String(p.studentNumber || '');
  if (!sNo) return { success: false, message: 'No student number.' };
  const sRows = await sb.from("students").select("*").eq("student_number", sNo);
  if (!sRows.data || sRows.data.length === 0) {
    const pRows = await sb.from("pending_registrations")
      .select("*").eq("student_number", sNo).order("id", { ascending: false }).limit(1);
    if (pRows.data && pRows.data.length > 0) {
      const pr = pRows.data[0];
      if (pr.status === "pending") {
        return { success: false, pending: true, message: "Your registration is awaiting teacher approval.", submittedName: pr.name };
      }
      if (pr.status === "rejected") {
        return { success: false, rejected: true, message: "Your registration was not approved. Please contact your teacher." };
      }
    }
    return { success: false, message: "Student not found." };
  }
  const s = sRows.data[0];
  const gRows = await sb.from("grades").select("*").eq("student_number", sNo);
  const subjects: any = {};
  (gRows.data || []).forEach((g: any) => {
    const q1 = g.q1 === "" ? null : Number(g.q1);
    const q2 = g.q2 === "" ? null : Number(g.q2);
    const q3 = g.q3 === "" ? null : Number(g.q3);
    const q4 = g.q4 === "" ? null : Number(g.q4);
    const fin = (g.final !== "" && g.final !== null && g.final !== undefined) ? Number(g.final) : "";
    subjects[g.subject_name] = {
      grades: { q1, q2, q3, q4, final: fin, remarks: g.remarks || determineRemarks(fin) },
      breakdowns: Array.isArray(g.breakdowns) ? g.breakdowns : []
    };
  });
  return { success: true, studentNumber: s.student_number, name: s.name, section: s.section, subjects };
}

// ============================================================
// Student registration
// ============================================================

async function registerStudent(sb: any, p: any) {
  const sData = p.studentData || {};
  const sNo = String(sData.studentNumber || "").trim();
  const name = stripTags(String(sData.name || "").trim());
  const teacherId = String(sData.teacherId || "").trim();
  if (!sNo || !name) return { success: false, message: "Please enter your name and student number." };
  if (!teacherId) return { success: false, message: "Please select a teacher." };

  const teacherRes = await sb.from("teachers").select("id, status, is_active").eq("id", teacherId).limit(1);
  if (!teacherRes.data || teacherRes.data.length === 0) {
    return { success: false, message: "Selected teacher not found." };
  }
  if (teacherRes.data[0].status !== "approved" || !teacherRes.data[0].is_active) {
    return { success: false, message: "Selected teacher is not available." };
  }

  const enrolled = await sb.from("students").select("student_number").eq("student_number", sNo);
  if (enrolled.data && enrolled.data.length > 0) {
    return { success: false, message: "You are already enrolled. Please log in instead." };
  }
  const pend = await sb.from("pending_registrations")
    .select("id").eq("student_number", sNo).eq("status", "pending");
  if (pend.data && pend.data.length > 0) {
    return { success: false, message: "You already have a pending registration. Please wait for teacher approval." };
  }

  const ins = await sb.from("pending_registrations").insert({
    timestamp: new Date().toISOString(),
    student_number: sNo, name, section: '',
    enrolled_subjects: [], status: 'pending',
    reviewed_at: '', teacher_id: teacherId
  });
  if (ins.error) throw ins.error;

  return { success: true, pending: true, message: "Registration submitted. Awaiting teacher approval." };
}

// ============================================================
// Comments
// ============================================================

async function postComment(sb: any, p: any, auth: AuthContext) {
  const sNo = String(p.studentNumber || "UNKNOWN");
  const text = stripTags(String(p.commentText || "").trim());
  if (!text) return { success: true };

  let name = "Teacher Admin";
  if (sNo !== "TEACHER_ADMIN") {
    name = "Student";
    const rows = await sb.from("students").select("name").eq("student_number", sNo);
    if (rows.data && rows.data.length && rows.data[0].name) name = rows.data[0].name;
  }

  const payload: any = {
    timestamp: new Date().toISOString(),
    student_number: sNo,
    student_name: stripTags(name),
    comment_text: text
  };
  if (auth.teacher) payload.teacher_id = auth.teacher.id;

  const { error } = await sb.from("comments").insert(payload);
  if (error) throw error;
  return { success: true };
}

async function clearComments(sb: any, auth: AuthContext) {
  let query = sb.from("comments").delete().gt("id", 0);
  if (auth.teacher) query = query.eq("teacher_id", auth.teacher.id);
  const { error } = await query;
  if (error) throw error;
  return { success: true };
}

// ============================================================
// Announcements
// ============================================================

async function saveAnnouncement(sb: any, p: any, auth: AuthContext) {
  const msg = stripTags(String(p.message || "").trim());
  if (!msg) return { success: false, message: "Announcement cannot be empty." };

  let deactivate = sb.from("announcements").update({ is_active: false }).eq("is_active", true);
  if (auth.teacher) deactivate = deactivate.eq("teacher_id", auth.teacher.id);
  await deactivate;

  const ts = new Date().toISOString();
  const payload: any = {
    timestamp: ts, message: msg, posted_by: "TEACHER_ADMIN", is_active: true
  };
  if (auth.teacher) payload.teacher_id = auth.teacher.id;

  const { error } = await sb.from("announcements").insert(payload);
  if (error) throw error;
  return { success: true, timestamp: ts, message: msg };
}

async function deleteAnnouncement(sb: any, p: any, auth: AuthContext) {
  const id = Number(p.rowIndex);
  if (!id) return { success: false, message: "Invalid id." };
  let query = sb.from("announcements").delete().eq("id", id);
  if (auth.teacher) query = query.eq("teacher_id", auth.teacher.id);
  const { error } = await query;
  if (error) throw error;
  return { success: true };
}

async function getTeacherName(sb: any, p: any) {
  const teacherId = String(p?.teacherId || "").trim();
  if (teacherId) {
    const rows = await sb.from("teachers").select("display_name").eq("id", teacherId).limit(1);
    if (rows.data && rows.data.length > 0) {
      return { success: true, name: rows.data[0].display_name || "" };
    }
  }
  const rows = await sb.from("settings").select("value").eq("key", "teacher_display_name").limit(1);
  const name = (rows.data && rows.data[0]) ? String(rows.data[0].value || "") : "";
  return { success: true, name };
}

async function saveTeacherName(sb: any, p: any, auth: AuthContext) {
  const name = stripTags(String(p.name || "").trim()).slice(0, 120);
  if (!name) return { success: false, message: "Name cannot be empty." };

  if (auth.teacher) {
    const { error } = await sb.from("teachers").update({ display_name: name }).eq("id", auth.teacher.id);
    if (error) throw error;
    return { success: true, name };
  }

  const { error } = await sb.from("settings").upsert(
    { key: "teacher_display_name", value: name }, { onConflict: "key" }
  );
  if (error) throw error;
  return { success: true, name };
}

// ============================================================
// Subjects
// ============================================================

function findWeight(categories: any[], name: string): number {
  const found = categories.find((c: any) => String(c.name).toLowerCase() === name.toLowerCase());
  return found ? Number(found.weight) : 0;
}

async function buildSubjectsResponse(sb: any, teacherId: string | null) {
  let subjQuery = sb.from("subjects").select("*").order("subject_name");
  let catQuery = sb.from("subject_categories").select("*").order("subject_name").order("position");
  if (teacherId) {
    subjQuery = subjQuery.eq("teacher_id", teacherId);
    catQuery = catQuery.eq("teacher_id", teacherId);
  }
  const subjRows = await subjQuery;
  const catRows = await catQuery;

  const subjects: string[] = [];
  const descriptions: Record<string, string> = {};
  const weights: Record<string, any> = {};
  const categories: Record<string, any[]> = {};
  const quarterWeights: Record<string, any> = {};

  (subjRows.data || []).forEach((r: any) => {
    subjects.push(r.subject_name);
    descriptions[r.subject_name] = r.description || "";
    quarterWeights[r.subject_name] = r.quarter_weights || { "1st": 25, "2nd": 25, "3rd": 25, "4th": 25 };
    categories[r.subject_name] = [];
    weights[r.subject_name] = {
      quizzes: r.weight_quizzes || 35, participation: r.weight_participation || 15,
      attendance: r.weight_attendance || 10, exams: r.weight_exams || 40
    };
  });

  (catRows.data || []).forEach((c: any) => {
    if (!categories[c.subject_name]) categories[c.subject_name] = [];
    categories[c.subject_name].push({
      id: c.id, name: c.name, weight: Number(c.weight), position: c.position
    });
  });

  return { success: true, subjects, descriptions, weights, categories, quarterWeights };
}

async function manageSubject(sb: any, p: any, auth: AuthContext) {
  const subAction = String(p.subAction || "add");

  if (subAction === "delete") {
    const t = String(p.subjectName);
    await sb.from("subject_categories").delete().eq("subject_name", t);
    await sb.from("subjects").delete().eq("subject_name", t);
    await sb.from("grades").delete().eq("subject_name", t);
    await sb.from("enrollments").delete().eq("subject_name", t);
    await sb.from("assessments").delete().eq("subject_name", t);
    return await buildSubjectsResponse(sb, auth.teacher?.id || null);
  }

  const categories = Array.isArray(p.categories) ? p.categories : null;
  if (categories && categories.length > 0) {
    const sum = categories.reduce((acc: number, c: any) => acc + Number(c.weight || 0), 0);
    if (sum !== 100) {
      return { success: false, message: "Category weights must total exactly 100% (currently " + sum + "%)." };
    }
    const seen = new Set<string>();
    for (const c of categories) {
      const n = String(c.name || "").trim();
      if (!n) return { success: false, message: "Every category needs a name." };
      const lower = n.toLowerCase();
      if (seen.has(lower)) return { success: false, message: "Duplicate category: " + n };
      seen.add(lower);
    }
  }

  const qw = p.quarterWeights;
  if (qw) {
    const sum = Number(qw["1st"] || 0) + Number(qw["2nd"] || 0) + Number(qw["3rd"] || 0) + Number(qw["4th"] || 0);
    if (sum !== 100) {
      return { success: false, message: "Quarter weights must total exactly 100% (currently " + sum + "%)." };
    }
  }

  const finalName = subAction === "update" ? String(p.newName) : String(p.subjectName);
  const desc = stripTags(p.description || "");
  const teacherId = auth.teacher?.id || null;

  const lookupName = String(p.oldName || finalName);
  let existingCatQuery = sb.from("subject_categories").select("id,name").eq("subject_name", lookupName);
  if (teacherId) existingCatQuery = existingCatQuery.eq("teacher_id", teacherId);
  const existingCatsResult = await existingCatQuery;
  const existingCats: any[] = existingCatsResult.data || [];

  if (categories && categories.length > 0 && existingCats.length > 0) {
    const keepNames = new Set(categories.map((c: any) => String(c.name).toLowerCase()));
    const toDelete = existingCats.filter((c: any) => !keepNames.has(String(c.name).toLowerCase()));

    if (toDelete.length > 0 && !p.confirmDelete) {
      const deleting: any[] = [];
      let totalAssessments = 0, totalScores = 0;

      for (const c of toDelete) {
        const assessRows = await sb.from("assessments").select("id").eq("category_id", c.id);
        const aIds = (assessRows.data || []).map((a: any) => a.id);

        let scores = 0;
        if (aIds.length > 0) {
          const scoreRows = await sb.from("scores")
            .select("id", { count: "exact", head: true }).in("assessment_id", aIds);
          scores = Number(scoreRows.count) || 0;
        }

        deleting.push({ name: c.name, assessments: aIds.length, scores });
        totalAssessments += aIds.length;
        totalScores += scores;
      }

      if (totalAssessments > 0) {
        return {
          success: false, needsConfirm: true,
          message: "Some categories being removed still contain assessments and scores.",
          deleting, totalAssessments, totalScores
        };
      }
    }
  }

  if (subAction === "update" && p.oldName && p.oldName !== finalName) {
    await sb.from("subjects").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("subject_categories").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("grades").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("enrollments").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("assessments").update({ subject_name: finalName }).eq("subject_name", p.oldName);
  }

  const subjPayload: any = { subject_name: finalName, description: desc };
  if (teacherId) subjPayload.teacher_id = teacherId;
  if (qw) subjPayload.quarter_weights = qw;
  if (categories && categories.length > 0) {
    subjPayload.weight_quizzes = findWeight(categories, "quizzes") || 35;
    subjPayload.weight_participation = findWeight(categories, "participation") || 15;
    subjPayload.weight_attendance = findWeight(categories, "attendance") || 10;
    subjPayload.weight_exams = findWeight(categories, "exams") || 40;
  }

  const { error: subjErr } = await sb.from("subjects").upsert(subjPayload, { onConflict: "subject_name" });
  if (subjErr) throw subjErr;

  if (categories && categories.length > 0) {
    let afterQuery = sb.from("subject_categories").select("id,name").eq("subject_name", finalName);
    if (teacherId) afterQuery = afterQuery.eq("teacher_id", teacherId);
    const afterRename = await afterQuery;
    const catsUnderFinalName: any[] = afterRename.data || [];

    const byName: Record<string, any> = {};
    catsUnderFinalName.forEach((c: any) => { byName[String(c.name).toLowerCase()] = c; });

    const toInsert: any[] = [];
    const toUpdate: any[] = [];
    categories.forEach((c: any, i: number) => {
      const n = String(c.name).trim();
      const existing = byName[n.toLowerCase()];
      if (existing) {
        toUpdate.push({ id: existing.id, subject_name: finalName, name: n, weight: Number(c.weight), position: i });
      } else {
        const newRow: any = { subject_name: finalName, name: n, weight: Number(c.weight), position: i };
        if (teacherId) newRow.teacher_id = teacherId;
        toInsert.push(newRow);
      }
    });

    for (const c of toUpdate) {
      await sb.from("subject_categories").update({
        name: c.name, weight: c.weight, position: c.position
      }).eq("id", c.id);
    }
    if (toInsert.length > 0) await sb.from("subject_categories").insert(toInsert);

    const keepNamesFinal = new Set(categories.map((c: any) => String(c.name).toLowerCase()));
    for (const c of catsUnderFinalName) {
      if (!keepNamesFinal.has(String(c.name).toLowerCase())) {
        await sb.from("subject_categories").delete().eq("id", c.id);
      }
    }
  }

  return await buildSubjectsResponse(sb, teacherId);
}

// ============================================================
// Sections
// ============================================================

async function buildSectionsPayload(sb: any, teacherId: string | null) {
  let query = sb.from("sections").select("*").order("name");
  if (teacherId) query = query.eq("teacher_id", teacherId);
  const rows = await query;
  return { success: true, sections: (rows.data || []).map((r: any) => String(r.name)) };
}

async function manageSection(sb: any, p: any, auth: AuthContext) {
  const subAction = String(p.subAction || "add");
  const name = stripTags(String(p.name || "").trim());
  const teacherId = auth.teacher?.id || null;

  if (!name) return { success: false, message: "Section name is required." };

  if (subAction === "add") {
    const payload: any = { name };
    if (teacherId) payload.teacher_id = teacherId;
    const { error } = await sb.from("sections").insert(payload);
    if (error) {
      if (String(error.message).toLowerCase().includes("duplicate")) {
        return { success: false, message: "A section with that name already exists." };
      }
      throw error;
    }
    return await buildSectionsPayload(sb, teacherId);
  }

  if (subAction === "rename") {
    const oldName = stripTags(String(p.oldName || "").trim());
    if (!oldName) return { success: false, message: "Original name is required." };
    if (oldName === name) return await buildSectionsPayload(sb, teacherId);

    let updateQ = sb.from("sections").update({ name }).eq("name", oldName);
    if (teacherId) updateQ = updateQ.eq("teacher_id", teacherId);
    const { error } = await updateQ;
    if (error) {
      if (String(error.message).toLowerCase().includes("duplicate")) {
        return { success: false, message: "A section with that name already exists." };
      }
      throw error;
    }
    let stuUpdate = sb.from("students").update({ section: name }).eq("section", oldName);
    if (teacherId) stuUpdate = stuUpdate.eq("teacher_id", teacherId);
    await stuUpdate;
    return await buildSectionsPayload(sb, teacherId);
  }

  if (subAction === "delete") {
    let stuQuery = sb.from("students").select("student_number").eq("section", name).limit(1);
    if (teacherId) stuQuery = stuQuery.eq("teacher_id", teacherId);
    const rows = await stuQuery;
    if (rows.data && rows.data.length > 0) {
      return { success: false, message: "Cannot delete: students are still assigned to this section. Move them first." };
    }
    let delQuery = sb.from("sections").delete().eq("name", name);
    if (teacherId) delQuery = delQuery.eq("teacher_id", teacherId);
    const { error } = await delQuery;
    if (error) throw error;
    return await buildSectionsPayload(sb, teacherId);
  }

  return { success: false, message: "Unknown subAction." };
}

// ============================================================
// Registration approval
// ============================================================

async function approveRegistration(sb: any, p: any, auth: AuthContext) {
  const sNo = String(p.studentNumber || "");
  const section = stripTags(String(p.section || "").trim());
  const subjects: string[] = (p.subjects || []).map((s: any) => String(s));
  const teacherId = auth.teacher?.id || null;

  if (!section) return { success: false, message: "Section is required." };
  if (subjects.length === 0) return { success: false, message: "Select at least one subject." };

  let prQuery = sb.from("pending_registrations").select("*")
    .eq("student_number", sNo).eq("status", "pending");
  if (teacherId) prQuery = prQuery.eq("teacher_id", teacherId);
  const pRows = await prQuery;
  if (!pRows.data || pRows.data.length === 0) {
    return { success: false, message: "Pending registration not found." };
  }
  const pr = pRows.data[0];

  const studentPayload: any = { student_number: sNo, name: pr.name, section };
  if (teacherId) studentPayload.teacher_id = teacherId;
  const sRes = await sb.from("students").upsert(studentPayload, { onConflict: "student_number" });
  if (sRes.error) return { success: false, message: "Could not create student: " + sRes.error.message };

  const existingEnroll = await sb.from("enrollments")
    .select("subject_name").eq("student_number", sNo).in("subject_name", subjects);
  if (existingEnroll.error) {
    return { success: false, message: "Could not check enrollments: " + existingEnroll.error.message };
  }

  const have = new Set((existingEnroll.data || []).map((e: any) => String(e.subject_name)));
  const missing = subjects.filter(s => !have.has(s));

  if (missing.length > 0) {
    const rows = missing.map(s => {
      const row: any = { student_number: sNo, subject_name: s };
      if (teacherId) row.teacher_id = teacherId;
      return row;
    });
    const ins = await sb.from("enrollments").insert(rows);
    if (ins.error) {
      return { success: false, message: "Could not enroll in " + missing.join(", ") + ": " + ins.error.message };
    }
  }

  const gradeRows = subjects.map(s => {
    const row: any = {
      student_number: sNo, subject_name: s,
      q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: []
    };
    if (teacherId) row.teacher_id = teacherId;
    return row;
  });

  const gr = await sb.from("grades").upsert(gradeRows, {
    onConflict: "student_number,subject_name", ignoreDuplicates: false
  });
  if (gr.error) return { success: false, message: "Could not prepare grade sheet: " + gr.error.message };

  const { error: upErr } = await sb.from("pending_registrations").update({
    section, enrolled_subjects: subjects,
    status: "approved", reviewed_at: new Date().toISOString()
  }).eq("id", pr.id);
  if (upErr) return { success: false, message: "Could not finalize approval: " + upErr.message };

  return { success: true, studentNumber: sNo, message: pr.name + " approved and enrolled." };
}

async function rejectRegistration(sb: any, p: any, auth: AuthContext) {
  const sNo = String(p.studentNumber || "");
  const teacherId = auth.teacher?.id || null;
  let query = sb.from("pending_registrations").select("id")
    .eq("student_number", sNo).eq("status", "pending");
  if (teacherId) query = query.eq("teacher_id", teacherId);
  const rows = await query;
  if (!rows.data || rows.data.length === 0) {
    return { success: false, message: "Pending registration not found." };
  }
  const { error } = await sb.from("pending_registrations").update({
    status: "rejected", reviewed_at: new Date().toISOString()
  }).eq("id", rows.data[0].id);
  if (error) throw error;
  return { success: true };
}

// ============================================================
// Recompute
// ============================================================

async function recomputeAllGrades(sb: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;

  let gradesQuery = sb.from("grades").select("*");
  let subjQuery = sb.from("subjects").select("subject_name,quarter_weights");
  let catQuery = sb.from("subject_categories").select("id,subject_name,weight");
  if (teacherId) {
    gradesQuery = gradesQuery.eq("teacher_id", teacherId);
    subjQuery = subjQuery.eq("teacher_id", teacherId);
    catQuery = catQuery.eq("teacher_id", teacherId);
  }

  const allGrades = await gradesQuery;
  if (!allGrades.data) return { success: true, totalFixed: 0, report: [] };

  const subjRows = await subjQuery;
  const qwMap: Record<string, any> = {};
  (subjRows.data || []).forEach((r: any) => { qwMap[r.subject_name] = r.quarter_weights; });

  const catRows = await catQuery;
  const catsBySubject: Record<string, any[]> = {};
  (catRows.data || []).forEach((c: any) => {
    if (!catsBySubject[c.subject_name]) catsBySubject[c.subject_name] = [];
    catsBySubject[c.subject_name].push(c);
  });

  let totalFixed = 0;
  const report: any[] = [];
  const bySubject: Record<string, any[]> = {};
  allGrades.data.forEach((g: any) => {
    if (!bySubject[g.subject_name]) bySubject[g.subject_name] = [];
    bySubject[g.subject_name].push(g);
  });

  for (const subjName of Object.keys(bySubject)) {
    const qw = qwMap[subjName];
    const cats = catsBySubject[subjName] || [];
    let fixed = 0;

    for (const row of bySubject[subjName]) {
      const updates: any = {};
      let rowChanged = false;

      const clamped: Record<string, any> = {};
      ["q1", "q2", "q3", "q4"].forEach(k => {
        const v = row[k];
        if (v === "" || v === null || v === undefined || isNaN(v)) { clamped[k] = v; return; }
        const n = Number(v);
        if (n > 0 && n < 60) { clamped[k] = 60; rowChanged = true; }
        else { clamped[k] = n; }
      });

      if (Array.isArray(row.breakdowns) && row.breakdowns.length > 0) {
        const newBds: any[] = [];
        let bdsChanged = false;

        for (const bd of row.breakdowns) {
          const qNum = String(bd.quarter || "").replace(/\D/g, "");
          const normalized = QUARTER_ORDINAL[qNum] || bd.quarter;

          let total = bd.total;
          if (cats.length > 0 && bd.categories && typeof bd.categories === "object") {
            let raw = 0, anyValue = false;
            cats.forEach((c: any) => {
              const v = bd.categories[String(c.id)];
              if (v !== "" && v !== null && v !== undefined && !isNaN(v)) {
                raw += Number(v) * (Number(c.weight) / 100);
                anyValue = true;
              }
            });
            if (anyValue) {
              const newTotal = transmuteGrade(raw);
              if (String(newTotal) !== String(total)) { total = newTotal; bdsChanged = true; }
            }
          }
          if (normalized !== bd.quarter) bdsChanged = true;
          newBds.push({ ...bd, quarter: normalized, total });
        }

        if (bdsChanged) { updates.breakdowns = newBds; rowChanged = true; }
      }

      ["q1", "q2", "q3", "q4"].forEach(k => {
        if (String(row[k]) !== String(clamped[k])) {
          updates[k] = String(clamped[k] === "" ? "" : clamped[k]);
          rowChanged = true;
        }
      });

      const newFinal = computeWeightedFinal(clamped.q1, clamped.q2, clamped.q3, clamped.q4, qw);
      const newRemarks = determineRemarks(newFinal);

      if (String(row.final) !== String(newFinal)) {
        updates.final = String(newFinal === "" ? "" : newFinal); rowChanged = true;
      }
      if (row.remarks !== newRemarks) { updates.remarks = newRemarks; rowChanged = true; }

      if (rowChanged) {
        const { error } = await sb.from("grades").update(updates).eq("id", row.id);
        if (error) throw error;
        fixed++;
      }
    }
    if (fixed > 0) { report.push({ subject: subjName, fixed }); totalFixed += fixed; }
  }
  return { success: true, totalFixed, report };
}

// ============================================================
// Class Recorder
// ============================================================

async function addAssessment(sb: any, p: any, auth: AuthContext) {
  const subject = String(p.subject || "");
  const quarter = String(p.quarter || "");
  const categoryId = Number(p.categoryId);
  const name = stripTags(String(p.name || "").trim());
  const totalPoints = Number(p.totalPoints);

  if (!subject || !quarter || !categoryId || !name || !totalPoints || totalPoints <= 0) {
    return { success: false, message: "All fields required. Total points must be > 0." };
  }

  const cat = await sb.from("subject_categories").select("subject_name").eq("id", categoryId).limit(1);
  if (!cat.data || cat.data.length === 0 || cat.data[0].subject_name !== subject) {
    return { success: false, message: "Category does not belong to this subject." };
  }

  const existing = await sb.from("assessments")
    .select("position").eq("subject_name", subject).eq("quarter", quarter).eq("category_id", categoryId);
  const nextPos = (existing.data || []).reduce((max: number, r: any) => Math.max(max, Number(r.position) || 0), 0) + 1;

  const payload: any = {
    subject_name: subject, quarter, category_id: categoryId,
    name, total_points: totalPoints, position: nextPos
  };
  if (auth.teacher) payload.teacher_id = auth.teacher.id;

  const { data, error } = await sb.from("assessments").insert(payload).select();
  if (error) throw error;
  return { success: true, assessment: data[0] };
}

async function renameAssessment(sb: any, p: any) {
  const id = Number(p.id);
  const name = stripTags(String(p.name || "").trim());
  const totalPoints = Number(p.totalPoints);
  if (!id || !name || !totalPoints || totalPoints <= 0) {
    return { success: false, message: "Name and total points required. Total must be > 0." };
  }
  const { error } = await sb.from("assessments").update({ name, total_points: totalPoints }).eq("id", id);
  if (error) throw error;
  return { success: true };
}

async function deleteAssessment(sb: any, p: any) {
  const id = Number(p.id);
  if (!id) return { success: false, message: "Invalid id." };
  const { error } = await sb.from("assessments").delete().eq("id", id);
  if (error) throw error;
  return { success: true };
}

async function saveScore(sb: any, p: any) {
  const assessmentId = Number(p.assessmentId);
  const studentNumber = String(p.studentNumber || "");
  const scoreRaw = p.score;
  if (!assessmentId || !studentNumber) return { success: false, message: "Missing fields." };
  const score = (scoreRaw === "" || scoreRaw === null || scoreRaw === undefined) ? null : Number(scoreRaw);
  const { error } = await sb.from("scores").upsert({
    assessment_id: assessmentId, student_number: studentNumber, score,
    updated_at: new Date().toISOString()
  }, { onConflict: "assessment_id,student_number" });
  if (error) throw error;
  return { success: true };
}

async function saveScoresBatch(sb: any, p: any) {
  const items = p.items || [];
  if (!Array.isArray(items) || items.length === 0) return { success: true, processed: 0 };
  const rows = items.map((it: any) => ({
    assessment_id: Number(it.assessmentId),
    student_number: String(it.studentNumber),
    score: (it.score === "" || it.score === null || it.score === undefined) ? null : Number(it.score),
    updated_at: new Date().toISOString()
  }));
  const { error } = await sb.from("scores").upsert(rows, { onConflict: "assessment_id,student_number" });
  if (error) throw error;
  return { success: true, processed: rows.length };
}

async function applyClassRecordToGrades(sb: any, p: any, auth: AuthContext) {
  const subject = String(p.subject || "");
  const quarter = String(p.quarter || "");
  const qNum = quarter.replace(/\D/g, "");
  const qKey = "q" + qNum;
  if (!subject || !quarter) return { success: false, message: "Subject and quarter required." };

  const catRows = await sb.from("subject_categories").select("id,name,weight").eq("subject_name", subject);
  const cats: any[] = catRows.data || [];
  if (cats.length === 0) return { success: false, message: "No categories configured for this subject." };

  const assessRows = await sb.from("assessments")
    .select("*").eq("subject_name", subject).eq("quarter", quarter);
  const assessments: any[] = assessRows.data || [];
  if (assessments.length === 0) return { success: false, message: "No assessments created for this quarter yet." };

  const assessIds = assessments.map((a: any) => a.id);
  const scoreRows = await sb.from("scores").select("*").in("assessment_id", assessIds);
  const scores: any[] = scoreRows.data || [];

  const perStudent: Record<string, Record<string, { got: number; total: number }>> = {};
  const assessmentById: Record<string, any> = {};
  assessments.forEach((a: any) => { assessmentById[String(a.id)] = a; });

  scores.forEach((s: any) => {
    if (s.score === null || s.score === undefined) return;
    const a = assessmentById[String(s.assessment_id)];
    if (!a) return;
    const catKey = String(a.category_id);
    if (!perStudent[s.student_number]) perStudent[s.student_number] = {};
    if (!perStudent[s.student_number][catKey]) perStudent[s.student_number][catKey] = { got: 0, total: 0 };
    perStudent[s.student_number][catKey].got += Number(s.score);
    perStudent[s.student_number][catKey].total += Number(a.total_points);
  });

  const catAverages: Record<string, Record<string, number | "">> = {};
  for (const sNo of Object.keys(perStudent)) {
    catAverages[sNo] = {};
    for (const c of cats) {
      const bucket = perStudent[sNo][String(c.id)];
      catAverages[sNo][String(c.id)] = (!bucket || bucket.total === 0)
        ? ""
        : Math.round((bucket.got / bucket.total) * 100 * 100) / 100;
    }
  }

  const gradeRows = await sb.from("grades").select("*").eq("subject_name", subject);
  const grades: any[] = gradeRows.data || [];
  const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subject).limit(1);
  const qw = (subjRow.data && subjRow.data[0]) ? subjRow.data[0].quarter_weights : null;
  const teacherId = auth.teacher?.id || null;

  let updated = 0;
  for (const g of grades) {
    const sNo = g.student_number;
    const catVals = catAverages[sNo];
    if (!catVals) continue;

    let raw = 0, anyValue = false;
    cats.forEach((c: any) => {
      const v = catVals[String(c.id)];
      if (v !== "" && v !== null && v !== undefined && !isNaN(v)) {
        raw += Number(v) * (Number(c.weight) / 100);
        anyValue = true;
      }
    });
    if (!anyValue) continue;
    const qScore = transmuteGrade(raw);

    const targetLabel = QUARTER_ORDINAL[qNum] || qNum;
    let bds = Array.isArray(g.breakdowns) ? g.breakdowns.slice() : [];
    let matched = false;
    for (let j = 0; j < bds.length; j++) {
      if (normalizeQuarterLabel(bds[j].quarter) === targetLabel) {
        bds[j].quarter = targetLabel;
        bds[j].categories = { ...(bds[j].categories || {}), ...catVals };
        bds[j].total = qScore;
        matched = true;
        break;
      }
    }
    if (!matched) bds.push({ quarter: targetLabel, categories: catVals, total: qScore });

    const updated2: any = { q1: g.q1, q2: g.q2, q3: g.q3, q4: g.q4 };
    updated2[qKey] = qScore;
    const final = computeWeightedFinal(updated2.q1, updated2.q2, updated2.q3, updated2.q4, qw);

    const updPayload: any = {
      q1: String(updated2.q1 === "" ? "" : updated2.q1),
      q2: String(updated2.q2 === "" ? "" : updated2.q2),
      q3: String(updated2.q3 === "" ? "" : updated2.q3),
      q4: String(updated2.q4 === "" ? "" : updated2.q4),
      final: String(final === "" ? "" : final),
      remarks: determineRemarks(final),
      breakdowns: bds
    };
    if (teacherId) updPayload.teacher_id = teacherId;

    const { error } = await sb.from("grades").update(updPayload).eq("id", g.id);
    if (error) throw error;
    updated++;
  }
  return { success: true, updated };
}

// ============================================================
// Restore (legacy JSON)
// ============================================================

function extractStudentsFromSubjectData(sd: any) {
  const map: Record<string, any> = {};
  Object.keys(sd).forEach((subject) => {
    const rows = sd[subject];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue;
      const sNo = String(row[0]);
      if (!map[sNo]) map[sNo] = { student_number: sNo, name: String(row[1] || ""), section: String(row[2] || "Section A") };
    }
  });
  return Object.keys(map).map(k => map[k]);
}

function extractEnrollmentsFromSubjectData(sd: any) {
  const seen: Record<string, boolean> = {};
  const list: any[] = [];
  Object.keys(sd).forEach((subject) => {
    const rows = sd[subject];
    for (let i = 1; i < rows.length; i++) {
      const sNo = String(rows[i][0] || "");
      if (!sNo) continue;
      const key = sNo + "|" + subject;
      if (!seen[key]) { seen[key] = true; list.push({ student_number: sNo, subject_name: subject }); }
    }
  });
  return list;
}

function extractGradesFromSubjectData(sd: any) {
  const list: any[] = [];
  Object.keys(sd).forEach((subject) => {
    const rows = sd[subject];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue;
      let bd: any[] = [];
      try { if (row[9]) bd = JSON.parse(String(row[9])); } catch (e) { /* ignore */ }
      list.push({
        student_number: String(row[0]), subject_name: subject,
        q1: row[3] === "" ? "" : String(row[3]),
        q2: row[4] === "" ? "" : String(row[4]),
        q3: row[5] === "" ? "" : String(row[5]),
        q4: row[6] === "" ? "" : String(row[6]),
        final: row[7] === "" ? "" : String(row[7]),
        remarks: String(row[8] || ""),
        breakdowns: bd
      });
    }
  });
  return list;
}

async function restoreAll(sb: any, p: any, auth: AuthContext) {
  const backup = p.backup;
  if (!backup) return { success: false, message: "Invalid backup file." };

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

  const teacherId = auth.teacher?.id || null;

  const wipe = async (table: string, filterCol: string) => {
    try {
      let q = sb.from(table).delete().not(filterCol, "is", null);
      if (teacherId) q = q.eq("teacher_id", teacherId);
      const { error } = await q;
      if (error) console.warn("[restoreAll] wipe " + table + ":", error.message);
    } catch (e) {
      console.warn("[restoreAll] wipe " + table + " threw:", e);
    }
  };

  await wipe("scores", "id");
  await wipe("assessments", "id");
  await wipe("grades", "id");
  await wipe("enrollments", "id");
  await wipe("students", "student_number");
  await wipe("subjects", "id");
  await wipe("subject_categories", "id");
  await wipe("comments", "id");
  await wipe("announcements", "id");
  await wipe("pending_registrations", "id");

  const restoreOrder = [
    "subjects", "students", "enrollments", "grades",
    "comments", "announcements", "pending_registrations"
  ];

  let restoredRows = 0;
  for (const table of restoreOrder) {
    const rows = t[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map((r: any) => {
        if (teacherId) return { ...r, teacher_id: teacherId };
        return r;
      });
      const { error } = await sb.from(table).insert(chunk);
      if (error) {
        return { success: false, message: "Restore failed on " + table + " at row " + i + ": " + error.message };
      }
      restoredRows += chunk.length;
    }
  }
  return { success: true, message: "Restored " + restoredRows + " rows." };
}