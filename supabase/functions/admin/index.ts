import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SESSION_DAYS = 30;
const TRANSMUTATION: [number, number][] = [
  [98.40, 99], [96.80, 98], [95.20, 97], [93.60, 96], [92.00, 95], [90.40, 94], [88.80, 93], [87.20, 92], [85.60, 91], [84.00, 90],
  [82.40, 89], [80.80, 88], [79.20, 87], [77.60, 86], [76.00, 85], [74.40, 84], [72.80, 83], [71.20, 82], [69.60, 81], [68.00, 80],
  [66.40, 79], [64.80, 78], [63.20, 77], [61.60, 76], [60.00, 75], [56.00, 74], [52.00, 73], [48.00, 72], [44.00, 71], [40.00, 70],
  [36.00, 69], [32.00, 68], [28.00, 67], [24.00, 66], [20.00, 65], [16.00, 64], [12.00, 63], [8.00, 62], [4.00, 61], [0.00, 60]
];
const QUARTER_ORDINAL: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}
function stripTags(s: any) { return String(s ?? "").replace(/[<>]/g, ""); }
function normalizeEmail(s: any) { return String(s || "").trim().toLowerCase(); }
function isValidEmail(s: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function scopeByTeacher(query: any, teacherId: string | null) {
  if (!teacherId) return query;
  return query.or(`teacher_id.eq.${teacherId},teacher_id.is.null`);
}
function normalizeQuarterLabel(q: any): string {
  const s = String(q || "").toLowerCase().trim();
  if (!s) return "";
  const m = s.match(/^([1-4])/);
  return m ? QUARTER_ORDINAL[m[1]] : s;
}
function determineRemarks(f: any): string {
  if (f === "" || f === null || isNaN(f)) return "";
  return Number(f) >= 75 ? "Passed" : "Failed";
}
function transmuteGrade(score: any): number | "" {
  if (score === "" || score === null || isNaN(score)) return "";
  const s = Number(score);
  if (s >= 100) return 100;
  for (const [lo, hi] of TRANSMUTATION) { if (s >= lo) return hi; }
  return 60;
}
function computeWeightedFinal(q1: any, q2: any, q3: any, q4: any, quarterWeights: any): number | "" {
  const w = quarterWeights || { "1st": 25, "2nd": 25, "3rd": 25, "4th": 25 };
  const pairs: [any, number][] = [[q1, Number(w["1st"] || 0)], [q2, Number(w["2nd"] || 0)], [q3, Number(w["3rd"] || 0)], [q4, Number(w["4th"] || 0)]];
  const valid = pairs.filter(([v]) => v !== null && v !== undefined && v !== "" && !isNaN(v));
  if (valid.length === 0) return "";
  let totalWeight = 0, sum = 0;
  for (const [v, weight] of valid) { sum += Number(v) * weight; totalWeight += weight; }
  if (totalWeight === 0) return "";
  return Math.round(sum / totalWeight);
}
function findWeight(categories: any[], name: string): number {
  const found = categories.find((c: any) => String(c.name).toLowerCase() === name.toLowerCase());
  return found ? Number(found.weight) : 0;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}
async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, keyMaterial, 256);
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}
async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  try {
    const { hash: computed } = await hashPassword(password, salt);
    if (computed.length !== hash.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(buf));
}
function publicTeacher(t: any) {
  return { id: t.id, email: t.email, displayName: t.display_name, role: t.role, status: t.status, isActive: t.is_active, createdAt: t.created_at, lastLoginAt: t.last_login_at };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const action = String(body?.action || "");

    // ==========================================
    // 1. PUBLIC ACTIONS (No Auth)
    // ==========================================
    if (action === "registerTeacher") {
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      if (!email || !isValidEmail(email)) return json({ success: false, message: "Enter a valid email." });
      
      const countRes = await sb.from("teachers").select("id", { count: "exact", head: true });
      const isFirst = !countRes.count || countRes.count === 0;

      const existing = await sb.from("teachers").select("id").eq("email", email).limit(1);
      if (existing.data && existing.data.length > 0) return json({ success: false, message: "That email is already registered." });

      const { hash, salt } = await hashPassword(password);
      const ins = await sb.from("teachers").insert({
        email, display_name: stripTags(body.displayName), password_hash: hash, password_salt: salt,
        role: isFirst ? "super_admin" : "teacher", status: isFirst ? "approved" : "pending", is_active: true, approved_at: isFirst ? new Date().toISOString() : null
      }).select().single();
      
      if (isFirst) {
        const token = crypto.randomUUID();
        await sb.from("teacher_sessions").insert({ token, teacher_id: ins.data.id, expires_at: new Date(Date.now() + SESSION_DAYS*24*60*60*1000).toISOString() });
        return json({ success: true, firstUser: true, sessionToken: token, teacher: publicTeacher(ins.data) });
      }
      return json({ success: true, pending: true, message: "Registration submitted." });
    }

    if (action === "teacherLogin") {
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      const rows = await sb.from("teachers").select("*").eq("email", email).single();
      if (!rows.data) return json({ success: false, message: "Invalid email or password." });
      
      const teacher = rows.data;
      const ok = await verifyPassword(password, teacher.password_hash, teacher.password_salt);
      if (!ok) return json({ success: false, message: "Invalid email or password." });

      if (teacher.status === "pending") return json({ success: false, pending: true, message: "Awaiting approval." });
      if (!teacher.is_active) return json({ success: false, message: "Account deactivated." });

      const token = crypto.randomUUID();
      await sb.from("teacher_sessions").insert({ token, teacher_id: teacher.id, expires_at: new Date(Date.now() + SESSION_DAYS*24*60*60*1000).toISOString() });
      await sb.from("teachers").update({ last_login_at: new Date().toISOString() }).eq("id", teacher.id);
      return json({ success: true, sessionToken: token, teacher: publicTeacher(teacher) });
    }

    if (action === "adminLogin") {
      const input = String(body.pin || "");
      const deviceId = String(body.deviceId || "unknown").slice(0, 64);
      if (!input) return json({ success: false, message: "Enter your PIN." });

      const lockRows = await sb.from("login_attempts").select("*").eq("device_id", deviceId);
      const existing = (lockRows.data && lockRows.data.length) ? lockRows.data[0] : null;
      const now = new Date();

      if (existing && existing.locked_until && new Date(existing.locked_until) > now) {
        const secsLeft = Math.ceil((new Date(existing.locked_until).getTime() - now.getTime()) / 1000);
        return json({ success: false, message: `Too many failed attempts. Try again in ${Math.ceil(secsLeft / 60)} minutes.` });
      }

      const rows = await sb.from("settings").select("value").eq("key", "admin_pin_hash").limit(1);
      if (!rows.data || rows.data.length === 0) return json({ success: false, message: "Admin PIN not configured." });

      const hash = await sha256(input);
      if (hash === rows.data[0].value) {
        await sb.from("login_attempts").upsert({ device_id: deviceId, attempts: 0, locked_until: null, updated_at: now.toISOString() }, { onConflict: "device_id" });
        return json({ success: true });
      }

      const curAttempts = (existing?.attempts || 0) + 1;
      let lockedUntil: string | null = null;
      if (curAttempts >= 5) lockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      
      await sb.from("login_attempts").upsert({ device_id: deviceId, attempts: curAttempts, locked_until: lockedUntil, updated_at: now.toISOString() }, { onConflict: "device_id" });
      return json({ success: false, message: lockedUntil ? "Locked out for 15 minutes." : `Invalid PIN. ${5 - curAttempts} attempts remaining.` });
    }

    if (action === "getPublicTeachers") {
      const t = await sb.from("teachers").select("id, display_name").eq("status", "approved").eq("is_active", true).order("display_name");
      return json({ success: true, teachers: (t.data || []).map(r => ({ id: r.id, displayName: r.display_name })) });
    }

    if (action === "getTeacherName") {
      const teacherId = String(body?.teacherId || "").trim();
      if (teacherId) {
        const rows = await sb.from("teachers").select("display_name").eq("id", teacherId).limit(1);
        if (rows.data && rows.data.length > 0) return json({ success: true, name: rows.data[0].display_name || "" });
      }
      const rows = await sb.from("settings").select("value").eq("key", "teacher_display_name").limit(1);
      return json({ success: true, name: (rows.data && rows.data[0]) ? String(rows.data[0].value || "") : "" });
    }

    if (action === "getStudent") {
      const sNo = String(body.studentNumber || "");
      const sRes = await sb.from("students").select("*").eq("student_number", sNo).single();
      if (!sRes.data) {
        const pRows = await sb.from("pending_registrations").select("*").eq("student_number", sNo).order("id", { ascending: false }).limit(1);
        if (pRows.data && pRows.data.length > 0) {
          if (pRows.data[0].status === "pending") return json({ success: false, pending: true, message: "Registration awaiting approval.", submittedName: pRows.data[0].name });
          if (pRows.data[0].status === "rejected") return json({ success: false, rejected: true, message: "Registration not approved." });
        }
        return json({ success: false, message: "Student not found." });
      }
      
      const gRes = await sb.from("grades").select("*").eq("student_number", sNo);
      const subjects: any = {};
      (gRes.data || []).forEach((g: any) => {
        subjects[g.subject_name] = { grades: { q1: g.q1, q2: g.q2, q3: g.q3, q4: g.q4, final: g.final, remarks: g.remarks }, breakdowns: g.breakdowns || [] };
      });
      return json({ success: true, studentNumber: sNo, name: sRes.data.name, section: sRes.data.section, subjects });
    }

    if (action === "registerStudent") {
      const sNo = String(body.studentData?.studentNumber || "").trim();
      const name = stripTags(String(body.studentData?.name || "").trim());
      const teacherId = String(body.studentData?.teacherId || "").trim();
      
      const ins = await sb.from("pending_registrations").insert({
        timestamp: new Date().toISOString(), student_number: sNo, name, section: '',
        enrolled_subjects: [], status: 'pending', reviewed_at: '', teacher_id: teacherId
      });
      if (ins.error) throw ins.error;
      return json({ success: true, pending: true });
    }

    // ==========================================
    // 2. AUTH CHECK
    // ==========================================
    let auth = null;
    if (body.sessionToken) {
      const sess = await sb.from("teacher_sessions").select("teacher_id").eq("token", body.sessionToken).single();
      if (sess.data) {
        const t = await sb.from("teachers").select("*").eq("id", sess.data.teacher_id).single();
        if (t.data && t.data.is_active) auth = { teacher: t.data };
      }
    }
    if (!auth) {
      const pin = String(body?.pin || "").trim();
      if (pin) {
        const pinRows = await sb.from("settings").select("value").eq("key", "admin_pin_hash").limit(1);
        if (pinRows.data && pinRows.data.length > 0) {
          const hash = await sha256(pin);
          if (hash === pinRows.data[0].value) {
            const saRes = await sb.from("teachers").select("*").eq("role", "super_admin").eq("status", "approved").eq("is_active", true).limit(1);
            auth = { teacher: (saRes.data && saRes.data.length > 0) ? saRes.data[0] : null };
          }
        }
      }
    }
    if (!auth) return json({ success: false, message: "Not authenticated." });

    // ==========================================
    // 3. SUPER ADMIN ONLY
    // ==========================================
    const SUPER_ONLY = new Set(["listTeachers", "approveTeacher", "rejectTeacher", "setTeacherRole", "setTeacherActive", "resetTeacherPassword", "deleteTeacher", "manageSection"]);
    if (SUPER_ONLY.has(action) && (!auth.teacher || auth.teacher.role !== "super_admin")) {
      return json({ success: false, message: "Super admin access required." });
    }

    if (action === "listTeachers") {
      const rows = await sb.from("teachers").select("*").order("created_at", { ascending: false });
      return json({ success: true, teachers: (rows.data || []).map(publicTeacher) });
    }
    if (action === "approveTeacher") {
      await sb.from("teachers").update({ status: "approved", role: body.role, approved_at: new Date().toISOString(), approved_by: auth.teacher.id }).eq("id", body.teacherId);
      return json({ success: true });
    }
    if (action === "rejectTeacher") {
      await sb.from("teachers").update({ status: "rejected" }).eq("id", body.teacherId);
      return json({ success: true });
    }
    if (action === "setTeacherRole") {
      await sb.from("teachers").update({ role: body.role }).eq("id", body.teacherId);
      return json({ success: true });
    }
    if (action === "setTeacherActive") {
      await sb.from("teachers").update({ is_active: body.isActive }).eq("id", body.teacherId);
      if (!body.isActive) await sb.from("teacher_sessions").delete().eq("teacher_id", body.teacherId);
      return json({ success: true });
    }
    if (action === "resetTeacherPassword") {
      const { hash, salt } = await hashPassword(body.password);
      await sb.from("teachers").update({ password_hash: hash, password_salt: salt }).eq("id", body.teacherId);
      await sb.from("teacher_sessions").delete().eq("teacher_id", body.teacherId);
      return json({ success: true });
    }
    if (action === "deleteTeacher") {
      if (body.teacherId === auth.teacher.id) return json({ success: false, message: "Cannot delete self." });
      await sb.from("teachers").delete().eq("id", body.teacherId);
      return json({ success: true });
    }

    if (action === "manageSection") {
      const subAction = String(body.subAction || "add");
      const name = stripTags(String(body.name || "").trim());

      if (subAction === "add") {
        await sb.from("sections").insert({ name, teacher_id: auth.teacher.id });
      } else if (subAction === "rename") {
        const oldName = String(body.oldName);
        await sb.from("sections").update({ name }).eq("name", oldName);
        await sb.from("students").update({ section: name }).eq("section", oldName);
      } else if (subAction === "delete") {
        await sb.from("sections").delete().eq("name", name);
      }
      return json({ success: true });
    }

    // ==========================================
    // 4. AUTHENTICATED ROUTES
    // ==========================================
    if (action === "getMe") return json({ success: true, teacher: auth.teacher ? publicTeacher(auth.teacher) : null, legacy: !auth.teacher });
    if (action === "teacherLogout") {
      const token = String(body.sessionToken || "").trim();
      if (token) await sb.from("teacher_sessions").delete().eq("token", token);
      return json({ success: true });
    }
    if (action === "markWalkthroughSeen") {
      if (auth.teacher) await sb.from("teachers").update({ has_seen_walkthrough: true }).eq("id", auth.teacher.id);
      return json({ success: true });
    }
    if (action === "getMyStats") {
      const teacherId = auth.teacher?.id || null;
      let stuQ = sb.from("students").select("*", { count: "exact", head: true });
      let subjQ = sb.from("subjects").select("*", { count: "exact", head: true });
      let secQ = sb.from("sections").select("*", { count: "exact", head: true });
      if (teacherId) { stuQ = stuQ.eq("teacher_id", teacherId); subjQ = subjQ.eq("teacher_id", teacherId); secQ = secQ.eq("teacher_id", teacherId); }
      const [stu, subj, sec] = await Promise.all([stuQ, subjQ, secQ]);
      return json({ success: true, students: stu.count || 0, subjects: subj.count || 0, sections: sec.count || 0 });
    }
    if (action === "changeMyPassword") {
      if (!auth.teacher) return json({ success: false, message: "Not authenticated." });
      const ok = await verifyPassword(body.currentPassword, auth.teacher.password_hash, auth.teacher.password_salt);
      if (!ok) return json({ success: false, message: "Current password is incorrect." });
      const { hash, salt } = await hashPassword(body.newPassword);
      await sb.from("teachers").update({ password_hash: hash, password_salt: salt }).eq("id", auth.teacher.id);
      return json({ success: true });
    }
    if (action === "saveTeacherName") {
      const name = stripTags(String(body.name || "").trim()).slice(0, 120);
      if (auth.teacher) await sb.from("teachers").update({ display_name: name }).eq("id", auth.teacher.id);
      else await sb.from("settings").upsert({ key: "teacher_display_name", value: name }, { onConflict: "key" });
      return json({ success: true, name });
    }

    // SUBJECTS
    if (action === "getSubjects") {
      let subjQ = scopeByTeacher(sb.from("subjects").select("*").order("subject_name"), auth.teacher?.id || null);
      let catQ = scopeByTeacher(sb.from("subject_categories").select("*").order("position"), auth.teacher?.id || null);
      const subj = await subjQ; const cat = await catQ;
      
      const subjects = [], descriptions: any = {}, weights: any = {}, categories: any = {}, quarterWeights: any = {};
      (subj.data || []).forEach(r => {
        subjects.push(r.subject_name); descriptions[r.subject_name] = r.description || ""; quarterWeights[r.subject_name] = r.quarter_weights; categories[r.subject_name] = [];
        weights[r.subject_name] = { quizzes: r.weight_quizzes, participation: r.weight_participation, attendance: r.weight_attendance, exams: r.weight_exams };
      });
      (cat.data || []).forEach(c => { if (!categories[c.subject_name]) categories[c.subject_name] = []; categories[c.subject_name].push({ id: c.id, name: c.name, weight: c.weight, position: c.position }); });
      return json({ success: true, subjects, descriptions, weights, categories, quarterWeights });
    }

    if (action === "manageSubject") {
      const subAction = String(body.subAction || "add");
      const teacherId = auth.teacher?.id || null;

      if (subAction === "delete") {
        const t = String(body.subjectName);
        await sb.from("subject_categories").delete().eq("subject_name", t);
        await sb.from("subjects").delete().eq("subject_name", t);
        await sb.from("grades").delete().eq("subject_name", t);
        await sb.from("enrollments").delete().eq("subject_name", t);
        await sb.from("assessments").delete().eq("subject_name", t);
        return json({ success: true });
      }

      const finalName = subAction === "update" ? String(body.newName) : String(body.subjectName);
      const subjPayload: any = { subject_name: finalName, description: stripTags(body.description || ""), quarter_weights: body.quarterWeights };
      if (teacherId) subjPayload.teacher_id = teacherId;
      if (body.categories && body.categories.length > 0) {
        subjPayload.weight_quizzes = findWeight(body.categories, "quizzes") || 35;
        subjPayload.weight_participation = findWeight(body.categories, "participation") || 15;
        subjPayload.weight_attendance = findWeight(body.categories, "attendance") || 10;
        subjPayload.weight_exams = findWeight(body.categories, "exams") || 40;
      }

      await sb.from("subjects").upsert(subjPayload, { onConflict: "subject_name" });

      if (subAction === "update" && body.oldName && body.oldName !== finalName) {
        await sb.from("subject_categories").update({ subject_name: finalName }).eq("subject_name", body.oldName);
        await sb.from("grades").update({ subject_name: finalName }).eq("subject_name", body.oldName);
        await sb.from("enrollments").update({ subject_name: finalName }).eq("subject_name", body.oldName);
        await sb.from("assessments").update({ subject_name: finalName }).eq("subject_name", body.oldName);
      }

      if (body.categories) {
        let delQ = sb.from("subject_categories").delete().eq("subject_name", finalName);
        if (teacherId) delQ = delQ.eq("teacher_id", teacherId);
        await delQ;
        
        const toInsert = body.categories.map((c: any, i: number) => {
          const row: any = { subject_name: finalName, name: c.name, weight: c.weight, position: i };
          if (teacherId) row.teacher_id = teacherId;
          return row;
        });
        await sb.from("subject_categories").insert(toInsert);
      }
      return json({ success: true });
    }

    if (action === "getSections") {
      // REMOVED scopeByTeacher so ALL sections are visible to everyone
      const sec = await sb.from("sections").select("name").order("name");
      return json({ success: true, sections: (sec.data || []).map(s => s.name) });
    }

    // STUDENTS & ROSTER
    if (action === "getAllGrades") {
      let gq = scopeByTeacher(sb.from("grades").select("*"), auth.teacher?.id || null);
      if (body.subject && body.subject !== "All") gq = gq.eq("subject_name", body.subject);
      const gRes = await gq;
      
      const sRes = await sb.from("students").select("*");
      const sMap: any = {};
      sRes.data?.forEach(s => sMap[s.student_number] = s);
      
      const results: any[] = []; const seen = new Set();
      (gRes.data || []).forEach(r => {
        seen.add(r.student_number); const stu = sMap[r.student_number] || {};
        results.push({ studentNumber: r.student_number, name: stu.name || "", section: stu.section || "", subject: r.subject_name, q1: r.q1, q2: r.q2, q3: r.q3, q4: r.q4, final: r.final, remarks: r.remarks });
      });
      
      if (body.subject === "All") {
        Object.keys(sMap).forEach(sNo => {
          if (!seen.has(sNo)) {
            const stu = sMap[sNo];
            results.push({ studentNumber: sNo, name: stu.name || "", section: stu.section || "", subject: "No subjects enrolled", q1: "", q2: "", q3: "", q4: "", final: "", remarks: "" });
          }
        });
      }
      return json(results);
    }

    if (action === "addStudent") {
      const sData = body.studentData;
      const sNo = String(sData.studentNumber || "").trim();
      const name = stripTags(String(sData.name || "").trim());
      const section = stripTags(String(sData.section || "Section A"));

      if (auth.teacher && auth.teacher.role === "super_admin") {
        await sb.from("students").upsert({ student_number: sNo, name, section, teacher_id: auth.teacher.id }, { onConflict: "student_number" });
        return json({ success: true, message: "Student added to pool." });
      } else {
        await sb.from("pending_registrations").insert({
          timestamp: new Date().toISOString(), student_number: sNo, name: name, section: section,
          enrolled_subjects: [], status: 'pending', reviewed_at: '', teacher_id: auth.teacher?.id || null
        });
        return json({ success: true, message: "Request submitted to Admin." });
      }
    }

    if (action === "bulkAddStudents") {
      if (auth.teacher && auth.teacher.role !== 'super_admin') return json({ success: false, message: "Super admin only." });
      const list = body.studentsArray || [];
      
      // VALIDATE SECTIONS
      const validSectionsRes = await sb.from("sections").select("name");
      const validSections = (validSectionsRes.data || []).map(s => s.name);

      for (const sData of list) {
        let section = stripTags(String(sData.section || "").trim());
        
        // If a section is provided but it doesn't exist in the DB, reject the import
        if (section && !validSections.includes(section)) {
            return json({ success: false, message: `The section "${section}" does not exist. Please create it in the Sections tab first.` });
        }
        
        const sNo = String(sData.studentNumber || "").trim();
        const name = stripTags(String(sData.name || "").trim());
        if (sNo && name) {
            await sb.from("students").upsert({ student_number: sNo, name, section: section || validSections[0] || "Section A", teacher_id: auth.teacher?.id || null }, { onConflict: "student_number" });
        }
      }
      return json({ success: true, processed: list.length });
    }

    if (action === "updateStudentInfo") {
      const oldId = String(body.oldStudentNumber || "");
      const newId = String(body.newData?.studentNumber || oldId);
      await sb.from("students").update({ student_number: newId, name: stripTags(body.newData?.name), section: stripTags(body.newData?.section) }).eq("student_number", oldId);
      if (oldId !== newId) {
        await sb.from("grades").update({ student_number: newId }).eq("student_number", oldId);
        await sb.from("enrollments").update({ student_number: newId }).eq("student_number", oldId);
        await sb.from("pending_registrations").update({ student_number: newId }).eq("student_number", oldId);
        await sb.from("comments").update({ student_number: newId }).eq("student_number", oldId);
      }
      return json({ success: true });
    }

    if (action === "deleteStudent") {
      const sNo = String(body.studentNumber || "");
      await sb.from("scores").delete().eq("student_number", sNo);
      await sb.from("grades").delete().eq("student_number", sNo);
      await sb.from("enrollments").delete().eq("student_number", sNo);
      await sb.from("comments").delete().eq("student_number", sNo);
      await sb.from("pending_registrations").delete().eq("student_number", sNo);
      await sb.from("students").delete().eq("student_number", sNo);
      return json({ success: true });
    }

    if (action === "bulkEnrollStudents") {
      const studentNumbers = body.studentNumbers || [];
      const subjectName = String(body.subjectName || "");
      const enrollments = studentNumbers.map((sNo: string) => ({ student_number: sNo, subject_name: subjectName, teacher_id: auth.teacher?.id || null }));
      const gradeRows = studentNumbers.map((sNo: string) => ({ student_number: sNo, subject_name: subjectName, q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: [], teacher_id: auth.teacher?.id || null }));

      await sb.from("enrollments").upsert(enrollments, { onConflict: "student_number,subject_name", ignoreDuplicates: true });
      await sb.from("grades").upsert(gradeRows, { onConflict: "student_number,subject_name", ignoreDuplicates: true });
      return json({ success: true });
    }

    if (action === "syncStudentEnrollments") {
      const sNo = body.studentNumber; const newSubjects = body.subjects || [];
      await sb.from("enrollments").delete().eq("student_number", sNo).eq("teacher_id", auth.teacher?.id);
      await sb.from("grades").delete().eq("student_number", sNo).eq("teacher_id", auth.teacher?.id);
      if (newSubjects.length > 0) {
        await sb.from("enrollments").insert(newSubjects.map((s: string) => ({ student_number: sNo, subject_name: s, teacher_id: auth.teacher?.id || null })));
        await sb.from("grades").insert(newSubjects.map((s: string) => ({ student_number: sNo, subject_name: s, q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: [], teacher_id: auth.teacher?.id || null })));
      }
      return json({ success: true });
    }

    // GRADES & BREAKDOWNS
    if (action === "saveGrades") {
      const sNo = String(body.studentNumber || "");
      const subj = String(body.subject || "");
      const grades = body.grades || {};
      const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subj).single();
      const qw = subjRow.data?.quarter_weights;
      
      function pick(inp: any, old: any) { if (inp !== "" && inp !== undefined && inp !== null) return Number(inp); if (old !== "" && old !== undefined && old !== null && !isNaN(old)) return Number(old); return ""; }
      const existing = await sb.from("grades").select("*").eq("student_number", sNo).eq("subject_name", subj).single();
      const row = existing.data;
      
      const q1 = pick(grades.q1, row?.q1), q2 = pick(grades.q2, row?.q2), q3 = pick(grades.q3, row?.q3), q4 = pick(grades.q4, row?.q4);
      const final = computeWeightedFinal(q1, q2, q3, q4, qw);
      
      const payload: any = { student_number: sNo, subject_name: subj, q1: String(q1), q2: String(q2), q3: String(q3), q4: String(q4), final: String(final), remarks: determineRemarks(final), breakdowns: row?.breakdowns || [] };
      if (auth.teacher) payload.teacher_id = auth.teacher.id;
      
      await sb.from("grades").upsert(payload, { onConflict: "student_number,subject_name" });
      return json({ success: true });
    }

    if (action === "saveBreakdown" || action === "bulkSaveBreakdown") {
      const subj = String(body.subject || "");
      const qNum = String(body.quarter || "").replace(/\D/g, "");
      const qKey = "q" + qNum;
      const items = body.items || (body.studentNumber ? [{ studentNumber: body.studentNumber, entries: body.entries, breakdown: body.breakdown }] : []);
      
      let catQ = sb.from("subject_categories").select("id,name,weight").eq("subject_name", subj);
      if (auth.teacher) catQ = catQ.eq("teacher_id", auth.teacher.id);
      const cats = (await catQ).data || [];
      
      let gq = sb.from("grades").select("*").eq("subject_name", subj);
      if (auth.teacher) gq = gq.eq("teacher_id", auth.teacher.id);
      const byStudent: any = {};
      (await gq).data?.forEach(r => byStudent[r.student_number] = r);

      const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subj).single();
      const qw = subjRow.data?.quarter_weights;
      let processed = 0, lastNewTotal = "";

      for (const item of items) {
        const row = byStudent[item.studentNumber];
        if (!row) continue;
        const valuesById: any = {};
        if (item.entries) item.entries.forEach((e: any) => valuesById[String(e.categoryId)] = e.value);
        else if (item.breakdown) ["quizzes","participation","attendance","exams"].forEach(n => { const c = cats.find((x: any) => x.name.toLowerCase() === n); if (c && item.breakdown[n] !== undefined) valuesById[String(c.id)] = item.breakdown[n]; });

        let raw = 0, anyValue = false;
        cats.forEach((c: any) => { const v = valuesById[String(c.id)]; if (v !== "" && v !== null && v !== undefined && !isNaN(v)) { raw += Number(v) * (Number(c.weight) / 100); anyValue = true; } });
        
        let qScore: any = anyValue ? transmuteGrade(raw) : (row[qKey] !== "" && !isNaN(row[qKey]) ? Number(row[qKey]) : 0);
        lastNewTotal = qScore;

        const targetLabel = QUARTER_ORDINAL[qNum] || qNum;
        let bds = Array.isArray(row.breakdowns) ? row.breakdowns.slice() : [];
        let matched = false;
        for (let j = 0; j < bds.length; j++) {
          if (normalizeQuarterLabel(bds[j].quarter) === targetLabel) { bds[j].quarter = targetLabel; bds[j].categories = { ...(bds[j].categories || {}), ...valuesById }; bds[j].total = qScore; matched = true; break; }
        }
        if (!matched) bds.push({ quarter: targetLabel, categories: valuesById, total: qScore });

        const updated: any = { q1: row.q1, q2: row.q2, q3: row.q3, q4: row.q4, [qKey]: qScore };
        const final = computeWeightedFinal(updated.q1, updated.q2, updated.q3, updated.q4, qw);
        
        const payload: any = { student_number: item.studentNumber, subject_name: subj, q1: String(updated.q1), q2: String(updated.q2), q3: String(updated.q3), q4: String(updated.q4), final: String(final), remarks: determineRemarks(final), breakdowns: bds };
        if (auth.teacher) payload.teacher_id = auth.teacher.id;
        await sb.from("grades").upsert(payload, { onConflict: "student_number,subject_name" });
        processed++;
      }
      return json({ success: true, newTotal: lastNewTotal, processed });
    }

    if (action === "recomputeAllGrades") {
      const teacherId = auth.teacher?.id || null;
      let gradesQuery = sb.from("grades").select("*");
      let subjQuery = sb.from("subjects").select("subject_name,quarter_weights");
      let catQuery = sb.from("subject_categories").select("id,subject_name,weight");
      if (teacherId) { gradesQuery = gradesQuery.eq("teacher_id", teacherId); subjQuery = subjQuery.eq("teacher_id", teacherId); catQuery = catQuery.eq("teacher_id", teacherId); }

      const allGrades = await gradesQuery;
      if (!allGrades.data) return json({ success: true, totalFixed: 0, report: [] });
      const subjRows = await subjQuery;
      const qwMap: any = {};
      (subjRows.data || []).forEach((r: any) => { qwMap[r.subject_name] = r.quarter_weights; });
      const catRows = await catQuery;
      const catsBySubject: any = {};
      (catRows.data || []).forEach((c: any) => { if (!catsBySubject[c.subject_name]) catsBySubject[c.subject_name] = []; catsBySubject[c.subject_name].push(c); });

      let totalFixed = 0; const report: any[] = [];
      const bySubject: any = {};
      allGrades.data.forEach((g: any) => { if (!bySubject[g.subject_name]) bySubject[g.subject_name] = []; bySubject[g.subject_name].push(g); });

      for (const subjName of Object.keys(bySubject)) {
        const qw = qwMap[subjName]; const cats = catsBySubject[subjName] || []; let fixed = 0;
        for (const row of bySubject[subjName]) {
          const updates: any = {}; let rowChanged = false;
          const clamped: any = {};
          ["q1", "q2", "q3", "q4"].forEach(k => { const v = row[k]; if (v === "" || v === null || v === undefined || isNaN(v)) { clamped[k] = v; return; } const n = Number(v); if (n > 0 && n < 60) { clamped[k] = 60; rowChanged = true; } else { clamped[k] = n; } });

          if (Array.isArray(row.breakdowns) && row.breakdowns.length > 0) {
            const newBds: any[] = []; let bdsChanged = false;
            for (const bd of row.breakdowns) {
              const qNum = String(bd.quarter || "").replace(/\D/g, "");
              const normalized = QUARTER_ORDINAL[qNum] || bd.quarter;
              let total = bd.total;
              if (cats.length > 0 && bd.categories && typeof bd.categories === "object") {
                let raw = 0, anyValue = false;
                cats.forEach((c: any) => { const v = bd.categories[String(c.id)]; if (v !== "" && v !== null && v !== undefined && !isNaN(v)) { raw += Number(v) * (Number(c.weight) / 100); anyValue = true; } });
                if (anyValue) { const newTotal = transmuteGrade(raw); if (String(newTotal) !== String(total)) { total = newTotal; bdsChanged = true; } }
              }
              if (normalized !== bd.quarter) bdsChanged = true;
              newBds.push({ ...bd, quarter: normalized, total });
            }
            if (bdsChanged) { updates.breakdowns = newBds; rowChanged = true; }
          }

          ["q1", "q2", "q3", "q4"].forEach(k => { if (String(row[k]) !== String(clamped[k])) { updates[k] = String(clamped[k] === "" ? "" : clamped[k]); rowChanged = true; } });
          const newFinal = computeWeightedFinal(clamped.q1, clamped.q2, clamped.q3, clamped.q4, qw);
          const newRemarks = determineRemarks(newFinal);
          if (String(row.final) !== String(newFinal)) { updates.final = String(newFinal === "" ? "" : newFinal); rowChanged = true; }
          if (row.remarks !== newRemarks) { updates.remarks = newRemarks; rowChanged = true; }

          if (rowChanged) { await sb.from("grades").update(updates).eq("id", row.id); fixed++; }
        }
        if (fixed > 0) { report.push({ subject: subjName, fixed }); totalFixed += fixed; }
      }
      return json({ success: true, totalFixed, report });
    }

    // CLASS RECORD
    if (action === "getClassRecord") {
      const subject = String(body.subject || "");
      const quarter = String(body.quarter || "");

      let catQ = scopeByTeacher(sb.from("subject_categories").select("id,name,weight,position").eq("subject_name", subject).order("position"), auth.teacher?.id || null);
      const categories = (await catQ).data || [];

      let assessQ = scopeByTeacher(sb.from("assessments").select("*").eq("subject_name", subject).eq("quarter", quarter), auth.teacher?.id || null);
      const assessments = (await assessQ).data || [];

      let scores: any[] = [];
      if (assessments.length > 0) {
        const ids = assessments.map(a => a.id).join(",");
        const scoreRes = await fetch(`${SUPABASE_URL}/rest/v1/scores?select=*&assessment_id=in.(${ids})`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
        if (scoreRes.ok) scores = await scoreRes.json();
      }

      let enrQ = scopeByTeacher(sb.from("enrollments").select("student_number").eq("subject_name", subject), auth.teacher?.id || null);
      let studentNumbers = ((await enrQ).data || []).map(e => e.student_number);
      if (studentNumbers.length === 0) {
        let gq = scopeByTeacher(sb.from("grades").select("student_number").eq("subject_name", subject), auth.teacher?.id || null);
        studentNumbers = ((await gq).data || []).map(g => g.student_number);
      }

      let students: any[] = [];
      if (studentNumbers.length > 0) {
        let sQ = sb.from("students").select("student_number,name,section").in("student_number", studentNumbers);
        students = (await sQ).data || [];
      }
      return json({ success: true, categories, assessments, scores, students });
    }

    if (action === "addAssessment") {
      const existing = await sb.from("assessments").select("position").eq("subject_name", body.subject).eq("quarter", body.quarter).eq("category_id", body.categoryId);
      const nextPos = (existing.data || []).reduce((max: number, r: any) => Math.max(max, Number(r.position) || 0), 0) + 1;
      const { data, error } = await sb.from("assessments").insert({
        subject_name: body.subject, quarter: body.quarter, category_id: body.categoryId, name: body.name, total_points: body.totalPoints, position: nextPos, teacher_id: auth.teacher?.id || null
      }).select();
      if (error) throw error;
      return json({ success: true, assessment: data[0] });
    }

    if (action === "renameAssessment") {
      await sb.from("assessments").update({ name: body.name, total_points: body.totalPoints }).eq("id", body.id);
      return json({ success: true });
    }

    if (action === "deleteAssessment") {
      await sb.from("assessments").delete().eq("id", body.id);
      return json({ success: true });
    }

    if (action === "saveScore") {
      const score = (body.score === "" || body.score === null || body.score === undefined) ? null : Number(body.score);
      await sb.from("scores").upsert({ assessment_id: body.assessmentId, student_number: body.studentNumber, score, updated_at: new Date().toISOString() }, { onConflict: "assessment_id,student_number" });
      return json({ success: true });
    }

    if (action === "saveScoresBatch") {
      const items = body.items || [];
      if (items.length === 0) return json({ success: true, processed: 0 });
      const rows = items.map((it: any) => ({ assessment_id: Number(it.assessmentId), student_number: String(it.studentNumber), score: (it.score === "" || it.score === null || it.score === undefined) ? null : Number(it.score), updated_at: new Date().toISOString() }));
      await sb.from("scores").upsert(rows, { onConflict: "assessment_id,student_number" });
      return json({ success: true, processed: rows.length });
    }

    if (action === "applyClassRecordToGrades") {
      const subject = body.subject; const quarter = body.quarter;
      const qNum = quarter.replace(/\D/g, ""); const qKey = "q" + qNum;

      const cats = (await sb.from("subject_categories").select("id,name,weight").eq("subject_name", subject)).data || [];
      const assessments = (await sb.from("assessments").select("*").eq("subject_name", subject).eq("quarter", quarter)).data || [];
      const ids = assessments.map((a: any) => a.id).join(",");
      const scoreRes = await fetch(`${SUPABASE_URL}/rest/v1/scores?select=*&assessment_id=in.(${ids})`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      const scores = scoreRes.ok ? await scoreRes.json() : [];

      const perStudent: any = {}; const assessMap: any = {};
      assessments.forEach((a: any) => { assessMap[a.id] = a; });
      scores.forEach((s: any) => {
        if (s.score === null || s.score === undefined) return;
        const a = assessMap[s.assessment_id]; if (!a) return;
        if (!perStudent[s.student_number]) perStudent[s.student_number] = {};
        if (!perStudent[s.student_number][a.category_id]) perStudent[s.student_number][a.category_id] = { got: 0, total: 0 };
        perStudent[s.student_number][a.category_id].got += Number(s.score);
        perStudent[s.student_number][a.category_id].total += Number(a.total_points);
      });

      const catAverages: any = {};
      for (const sNo of Object.keys(perStudent)) {
        catAverages[sNo] = {};
        for (const c of cats) { const bucket = perStudent[sNo][c.id]; catAverages[sNo][c.id] = (!bucket || bucket.total === 0) ? "" : Math.round((bucket.got / bucket.total) * 100 * 100) / 100; }
      }

      const grades = (await sb.from("grades").select("*").eq("subject_name", subject)).data || [];
      const qw = (await sb.from("subjects").select("quarter_weights").eq("subject_name", subject).single()).data?.quarter_weights;

      let updated = 0;
      for (const g of grades) {
        const catVals = catAverages[g.student_number]; if (!catVals) continue;
        let raw = 0, anyValue = false;
        cats.forEach((c: any) => { const v = catVals[c.id]; if (v !== "" && v !== null && v !== undefined && !isNaN(v)) { raw += Number(v) * (Number(c.weight) / 100); anyValue = true; } });
        if (!anyValue) continue;
        const qScore = transmuteGrade(raw);
        let bds = Array.isArray(g.breakdowns) ? g.breakdowns.slice() : [];
        let matched = false;
        for (let j = 0; j < bds.length; j++) {
          if (String(bds[j].quarter).indexOf(qNum) !== -1) { bds[j].quarter = QUARTER_ORDINAL[qNum] || qNum; bds[j].categories = { ...(bds[j].categories || {}), ...catVals }; bds[j].total = qScore; matched = true; break; }
        }
        if (!matched) bds.push({ quarter: QUARTER_ORDINAL[qNum] || qNum, categories: catVals, total: qScore });
        const updated2: any = { q1: g.q1, q2: g.q2, q3: g.q3, q4: g.q4, [qKey]: qScore };
        const final = computeWeightedFinal(updated2.q1, updated2.q2, updated2.q3, updated2.q4, qw);
        await sb.from("grades").update({ q1: String(updated2.q1), q2: String(updated2.q2), q3: String(updated2.q3), q4: String(updated2.q4), final: String(final), remarks: determineRemarks(final), breakdowns: bds }).eq("id", g.id);
        updated++;
      }
      return json({ success: true, updated });
    }

    // REGISTRATIONS
    if (action === "getPendingRegistrations") {
      let q = sb.from("pending_registrations").select("*").order("id", { ascending: false });
      if (auth.teacher && auth.teacher.role !== "super_admin") q = q.eq("teacher_id", auth.teacher.id);
      const rows = await q;
      const pending: any[] = [], history: any[] = [];
      (rows.data || []).forEach(r => {
        const item = { timestamp: r.timestamp, studentNumber: r.student_number, name: r.name, section: r.section, status: r.status, reviewedAt: r.reviewed_at };
        (item.status === "pending" ? pending : history).push(item);
      });
      return json({ success: true, pending, history });
    }

    if (action === "approveRegistration") {
      if (auth.teacher && auth.teacher.role !== "super_admin") return json({ success: false, message: "Admin only." });
      const sNo = body.studentNumber;
      const pRes = await sb.from("pending_registrations").select("*").eq("student_number", sNo).eq("status", "pending").single();
      if (!pRes.data) return json({ success: false, message: "Not found." });
      await sb.from("students").upsert({ student_number: sNo, name: pRes.data.name, section: body.section || pRes.data.section }, { onConflict: "student_number" });
      await sb.from("pending_registrations").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", pRes.data.id);
      return json({ success: true, message: "Approved." });
    }

    if (action === "rejectRegistration") {
      if (auth.teacher && auth.teacher.role !== "super_admin") return json({ success: false, message: "Admin only." });
      await sb.from("pending_registrations").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("student_number", body.studentNumber).eq("status", "pending");
      return json({ success: true });
    }

    // COMMENTS & ANNOUNCEMENTS
    if (action === "getComments") {
      let q = scopeByTeacher(sb.from("comments").select("*").order("id", { ascending: true }), auth.teacher?.id || null);
      const rows = await q;
      return json({ success: true, comments: (rows.data || []).map((r: any) => ({ timestamp: r.timestamp, studentNumber: r.student_number, studentName: r.student_name, text: r.comment_text })) });
    }
    if (action === "postComment") {
      let name = "Teacher Admin";
      if (body.studentNumber !== "TEACHER_ADMIN") { const s = await sb.from("students").select("name").eq("student_number", body.studentNumber).single(); name = s.data?.name || "Student"; }
      await sb.from("comments").insert({ timestamp: new Date().toISOString(), student_number: body.studentNumber, student_name: stripTags(name), comment_text: stripTags(body.commentText), teacher_id: auth.teacher?.id || null });
      return json({ success: true });
    }
    if (action === "clearComments") {
      let q = sb.from("comments").delete().gt("id", 0);
      if (auth.teacher) q = q.eq("teacher_id", auth.teacher.id);
      await q;
      return json({ success: true });
    }
    if (action === "getAnnouncement") {
      let q = sb.from("announcements").select("*").eq("is_active", true).order("id", { ascending: false }).limit(1);
      q = scopeByTeacher(q, auth.teacher?.id || body?.teacherId || null);
      const rows = await q;
      if (rows.data && rows.data.length > 0) return json({ success: true, message: rows.data[0].message, timestamp: rows.data[0].timestamp, postedBy: rows.data[0].posted_by });
      return json({ success: true, message: "" });
    }
    if (action === "getAnnouncementHistory") {
      let q = scopeByTeacher(sb.from("announcements").select("*").order("id", { ascending: false }), auth.teacher?.id || null);
      const rows = await q;
      return json({ success: true, history: (rows.data || []).map((r: any) => ({ rowIndex: r.id, timestamp: r.timestamp, message: r.message, postedBy: r.posted_by, active: !!r.is_active })) });
    }
    if (action === "saveAnnouncement") {
      let d = sb.from("announcements").update({ is_active: false }).eq("is_active", true);
      if (auth.teacher) d = d.eq("teacher_id", auth.teacher.id);
      await d;
      const ts = new Date().toISOString();
      await sb.from("announcements").insert({ timestamp: ts, message: stripTags(body.message), posted_by: "TEACHER_ADMIN", is_active: true, teacher_id: auth.teacher?.id || null });
      return json({ success: true, timestamp: ts, message: body.message });
    }
    if (action === "deleteAnnouncement") {
      let q = sb.from("announcements").delete().eq("id", body.rowIndex);
      if (auth.teacher) q = q.eq("teacher_id", auth.teacher.id);
      await q;
      return json({ success: true });
    }

    // RESTORE
    if (action === "restoreAll") {
      const backup = body.backup;
      if (!backup) return json({ success: false, message: "Invalid backup file." });
      const teacherId = auth.teacher?.id || null;

      const wipe = async (table: string, filterCol: string) => {
        let q = sb.from(table).delete().not(filterCol, "is", null);
        if (teacherId) q = q.eq("teacher_id", teacherId);
        await q;
      };

      await wipe("scores", "id"); await wipe("assessments", "id"); await wipe("grades", "id"); await wipe("enrollments", "id");
      await wipe("students", "student_number"); await wipe("subjects", "id"); await wipe("subject_categories", "id");
      await wipe("comments", "id"); await wipe("announcements", "id"); await wipe("pending_registrations", "id");

      const restoreOrder = ["subjects", "students", "enrollments", "grades", "comments", "announcements", "pending_registrations"];
      let restoredRows = 0;
      for (const table of restoreOrder) {
        const rows = backup[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        for (let i = 0; i < rows.length; i += 100) {
          const chunk = rows.slice(i, i + 100).map((r: any) => { if (teacherId) return { ...r, teacher_id: teacherId }; return r; });
          const { error } = await sb.from(table).insert(chunk);
          if (error) return json({ success: false, message: "Restore failed on " + table + ": " + error.message });
          restoredRows += chunk.length;
        }
      }
      return json({ success: true, message: "Restored " + restoredRows + " rows." });
    }

    return json({ success: false, message: "Unknown action: " + action });
  } catch (err) {
    console.error("[admin fn]", err);
    return json({ success: false, message: (err as Error).message || String(err) });
  }
});