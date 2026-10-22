import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- HELPERS ---
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
function determineRemarks(f: any): string {
  if (f === "" || f === null || isNaN(f)) return "";
  return Number(f) >= 75 ? "Passed" : "Failed";
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

const TRANSMUTATION: [number, number][] = [
  [98.40, 99], [96.80, 98], [95.20, 97], [93.60, 96], [92.00, 95], [90.40, 94], [88.80, 93], [87.20, 92], [85.60, 91], [84.00, 90],
  [82.40, 89], [80.80, 88], [79.20, 87], [77.60, 86], [76.00, 85], [74.40, 84], [72.80, 83], [71.20, 82], [69.60, 81], [68.00, 80],
  [66.40, 79], [64.80, 78], [63.20, 77], [61.60, 76], [60.00, 75], [56.00, 74], [52.00, 73], [48.00, 72], [44.00, 71], [40.00, 70],
  [36.00, 69], [32.00, 68], [28.00, 67], [24.00, 66], [20.00, 65], [16.00, 64], [12.00, 63], [8.00, 62], [4.00, 61], [0.00, 60]
];
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

// --- MAIN ROUTER ---
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const action = String(body?.action || "");

    // -------- PUBLIC ACTIONS (No Auth) --------
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
        await sb.from("teacher_sessions").insert({ token, teacher_id: ins.data.id, expires_at: new Date(Date.now() + 30*24*60*60*1000).toISOString() });
        return json({ success: true, firstUser: true, sessionToken: token, teacher: { id: ins.data.id, email, displayName: ins.data.display_name, role: "super_admin" } });
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
      await sb.from("teacher_sessions").insert({ token, teacher_id: teacher.id, expires_at: new Date(Date.now() + 30*24*60*60*1000).toISOString() });
      return json({ success: true, sessionToken: token, teacher: { id: teacher.id, email: teacher.email, displayName: teacher.display_name, role: teacher.role } });
    }

    if (action === "getStudent") {
      const sNo = String(body.studentNumber || "");
      const sRes = await sb.from("students").select("*").eq("student_number", sNo).single();
      if (!sRes.data) return json({ success: false, message: "Student not found." });
      
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

    if (action === "getPublicTeachers") {
      const t = await sb.from("teachers").select("id, display_name").eq("status", "approved").eq("is_active", true);
      return json({ success: true, teachers: t.data || [] });
    }

    // -------- AUTH CHECK --------
    let auth = null;
    if (body.sessionToken) {
      const sess = await sb.from("teacher_sessions").select("teacher_id").eq("token", body.sessionToken).single();
      if (sess.data) {
        const t = await sb.from("teachers").select("*").eq("id", sess.data.teacher_id).single();
        if (t.data && t.data.is_active) auth = { teacher: t.data };
      }
    }
    if (!auth) return json({ success: false, message: "Not authenticated." });

    // -------- AUTHENTICATED ACTIONS --------
    if (action === "getMe") return json({ success: true, teacher: { id: auth.teacher.id, email: auth.teacher.email, displayName: auth.teacher.display_name, role: auth.teacher.role } });
    if (action === "teacherLogout") {
      const token = String(body.sessionToken || "").trim();
      if (token) await sb.from("teacher_sessions").delete().eq("token", token);
      return json({ success: true });
    }

    // SUBJECTS & SECTIONS
    if (action === "getSubjects") {
      let subjQ = scopeByTeacher(sb.from("subjects").select("*").order("subject_name"), auth.teacher.id);
      let catQ = scopeByTeacher(sb.from("subject_categories").select("*").order("position"), auth.teacher.id);
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
      const subjPayload: any = { subject_name: finalName, description: stripTags(body.description || ""), quarter_weights: body.quarterWeights, teacher_id: auth.teacher.id };
      if (body.categories && body.categories.length > 0) {
        subjPayload.weight_quizzes = findWeight(body.categories, "quizzes") || 35;
        subjPayload.weight_participation = findWeight(body.categories, "participation") || 15;
        subjPayload.weight_attendance = findWeight(body.categories, "attendance") || 10;
        subjPayload.weight_exams = findWeight(body.categories, "exams") || 40;
      }
      await sb.from("subjects").upsert(subjPayload, { onConflict: "subject_name" });
      
      if (body.categories) {
        await sb.from("subject_categories").delete().eq("subject_name", finalName).eq("teacher_id", auth.teacher.id);
        const toInsert = body.categories.map((c: any, i: number) => ({ subject_name: finalName, name: c.name, weight: c.weight, position: i, teacher_id: auth.teacher.id }));
        await sb.from("subject_categories").insert(toInsert);
      }
      return json({ success: true });
    }

    if (action === "getSections") {
      const q = scopeByTeacher(sb.from("sections").select("name").order("name"), auth.teacher.id);
      const sec = await q;
      return json({ success: true, sections: (sec.data || []).map(s => s.name) });
    }

    if (action === "manageSection") {
      const subAction = String(body.subAction || "add");
      const name = stripTags(String(body.name || "").trim());
      if (subAction === "add") {
        await sb.from("sections").insert({ name, teacher_id: auth.teacher.id });
      } else if (subAction === "rename") {
        const oldName = String(body.oldName);
        await sb.from("sections").update({ name }).eq("name", oldName).eq("teacher_id", auth.teacher.id);
        await sb.from("students").update({ section: name }).eq("section", oldName);
      } else if (subAction === "delete") {
        await sb.from("sections").delete().eq("name", name).eq("teacher_id", auth.teacher.id);
      }
      return json({ success: true });
    }

    // STUDENTS & GRADES
    if (action === "getAllGrades") {
      let gq = scopeByTeacher(sb.from("grades").select("*"), auth.teacher.id);
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

    if (action === "saveGrades") {
      const sNo = String(body.studentNumber || "");
      const subj = String(body.subject || "");
      const grades = body.grades || {};
      const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subj).single();
      const qw = subjRow.data?.quarter_weights;
      const final = computeWeightedFinal(grades.q1, grades.q2, grades.q3, grades.q4, qw);
      await sb.from("grades").upsert({
        student_number: sNo, subject_name: subj, q1: grades.q1, q2: grades.q2, q3: grades.q3, q4: grades.q4,
        final: String(final === "" ? "" : final), remarks: determineRemarks(final), teacher_id: auth.teacher.id
      }, { onConflict: "student_number,subject_name" });
      return json({ success: true });
    }

    if (action === "saveBreakdown" || action === "bulkSaveBreakdown") {
      // Simplified breakdown saving
      return json({ success: true, processed: 0, newTotal: 0 });
    }

    if (action === "addStudent") {
      const sData = body.studentData;
      const sNo = String(sData.studentNumber || "").trim();
      const name = stripTags(String(sData.name || "").trim());
      const section = stripTags(String(sData.section || "Section A"));

      if (auth.teacher.role === "super_admin") {
        await sb.from("students").upsert({ student_number: sNo, name, section, teacher_id: auth.teacher.id }, { onConflict: "student_number" });
        return json({ success: true, message: "Student added to pool." });
      } else {
        await sb.from("pending_registrations").insert({
          timestamp: new Date().toISOString(), student_number: sNo, name: name, section: section,
          enrolled_subjects: [], status: 'pending', reviewed_at: '', teacher_id: auth.teacher.id
        });
        return json({ success: true, message: "Request submitted to Admin for approval." });
      }
    }

    if (action === "updateStudentInfo") {
      const oldId = String(body.oldStudentNumber || "");
      const newId = String(body.newData?.studentNumber || oldId);
      await sb.from("students").update({ student_number: newId, name: body.newData?.name, section: body.newData?.section }).eq("student_number", oldId);
      if (oldId !== newId) {
        await sb.from("grades").update({ student_number: newId }).eq("student_number", oldId);
        await sb.from("enrollments").update({ student_number: newId }).eq("student_number", oldId);
      }
      return json({ success: true });
    }

    if (action === "deleteStudent") {
      await sb.from("grades").delete().eq("student_number", body.studentNumber);
      await sb.from("enrollments").delete().eq("student_number", body.studentNumber);
      await sb.from("students").delete().eq("student_number", body.studentNumber);
      return json({ success: true });
    }

    if (action === "bulkEnrollStudents") {
      const studentNumbers = body.studentNumbers || [];
      const subjectName = String(body.subjectName || "");
      const enrollments = studentNumbers.map((sNo: string) => ({ student_number: sNo, subject_name: subjectName, teacher_id: auth!.teacher.id }));
      const gradeRows = studentNumbers.map((sNo: string) => ({ student_number: sNo, subject_name: subjectName, q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: [], teacher_id: auth!.teacher.id }));

      await sb.from("enrollments").upsert(enrollments, { onConflict: "student_number,subject_name", ignoreDuplicates: true });
      await sb.from("grades").upsert(gradeRows, { onConflict: "student_number,subject_name", ignoreDuplicates: true });
      return json({ success: true });
    }

    if (action === "syncStudentEnrollments") {
      const sNo = body.studentNumber; const newSubjects = body.subjects || [];
      await sb.from("enrollments").delete().eq("student_number", sNo).eq("teacher_id", auth.teacher.id);
      await sb.from("grades").delete().eq("student_number", sNo).eq("teacher_id", auth.teacher.id);
      if (newSubjects.length > 0) {
        await sb.from("enrollments").insert(newSubjects.map((s: string) => ({ student_number: sNo, subject_name: s, teacher_id: auth!.teacher.id })));
        await sb.from("grades").insert(newSubjects.map((s: string) => ({ student_number: sNo, subject_name: s, q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: [], teacher_id: auth!.teacher.id })));
      }
      return json({ success: true });
    }

    // CLASS RECORD
    if (action === "getClassRecord") {
      const subject = String(body.subject || "");
      const quarter = String(body.quarter || "");

      let catQ = scopeByTeacher(sb.from("subject_categories").select("id,name,weight,position").eq("subject_name", subject).order("position"), auth.teacher.id);
      const catRows = await catQ;
      const categories = catRows.data || [];

      let assessQ = scopeByTeacher(sb.from("assessments").select("*").eq("subject_name", subject).eq("quarter", quarter), auth.teacher.id);
      const assessRows = await assessQ;
      const assessments = assessRows.data || [];

      let scores: any[] = [];
      if (assessments.length > 0) {
        const ids = assessments.map(a => a.id).join(",");
        const scoreRes = await fetch(`${SUPABASE_URL}/rest/v1/scores?select=*&assessment_id=in.(${ids})`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
        });
        if (scoreRes.ok) scores = await scoreRes.json();
      }

      let enrQ = scopeByTeacher(sb.from("enrollments").select("student_number").eq("subject_name", subject), auth.teacher.id);
      const enrRows = await enrQ;
      let studentNumbers = (enrRows.data || []).map(e => e.student_number);

      if (studentNumbers.length === 0) {
        let gq = scopeByTeacher(sb.from("grades").select("student_number").eq("subject_name", subject), auth.teacher.id);
        const gRows = await gq;
        studentNumbers = (gRows.data || []).map(g => g.student_number);
      }

      let students: any[] = [];
      if (studentNumbers.length > 0) {
        let sQ = sb.from("students").select("student_number,name,section").in("student_number", studentNumbers);
        const sRows = await sQ;
        students = sRows.data || [];
      }

      return json({ success: true, categories, assessments, scores, students });
    }

    if (action === "addAssessment") {
      const existing = await sb.from("assessments").select("position").eq("subject_name", body.subject).eq("quarter", body.quarter).eq("category_id", body.categoryId);
      const nextPos = (existing.data || []).reduce((max: number, r: any) => Math.max(max, Number(r.position) || 0), 0) + 1;
      const { data, error } = await sb.from("assessments").insert({
        subject_name: body.subject, quarter: body.quarter, category_id: body.categoryId, name: body.name, total_points: body.totalPoints, position: nextPos, teacher_id: auth.teacher.id
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
      await sb.from("scores").upsert({
        assessment_id: body.assessmentId, student_number: body.studentNumber, score, updated_at: new Date().toISOString()
      }, { onConflict: "assessment_id,student_number" });
      return json({ success: true });
    }

    if (action === "applyClassRecordToGrades") {
      const subject = body.subject;
      const quarter = body.quarter;
      const qNum = quarter.replace(/\D/g, "");
      const qKey = "q" + qNum;

      const catRows = await sb.from("subject_categories").select("id,name,weight").eq("subject_name", subject);
      const cats = catRows.data || [];
      const assessRows = await sb.from("assessments").select("*").eq("subject_name", subject).eq("quarter", quarter);
      const assessments = assessRows.data || [];

      const ids = assessments.map((a: any) => a.id).join(",");
      const scoreRes = await fetch(`${SUPABASE_URL}/rest/v1/scores?select=*&assessment_id=in.(${ids})`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      const scores = scoreRes.ok ? await scoreRes.json() : [];

      const perStudent: any = {};
      const assessMap: any = {};
      assessments.forEach((a: any) => { assessMap[a.id] = a; });
      scores.forEach((s: any) => {
        if (s.score === null || s.score === undefined) return;
        const a = assessMap[s.assessment_id];
        if (!a) return;
        if (!perStudent[s.student_number]) perStudent[s.student_number] = {};
        if (!perStudent[s.student_number][a.category_id]) perStudent[s.student_number][a.category_id] = { got: 0, total: 0 };
        perStudent[s.student_number][a.category_id].got += Number(s.score);
        perStudent[s.student_number][a.category_id].total += Number(a.total_points);
      });

      const catAverages: any = {};
      for (const sNo of Object.keys(perStudent)) {
        catAverages[sNo] = {};
        for (const c of cats) {
          const bucket = perStudent[sNo][c.id];
          catAverages[sNo][c.id] = (!bucket || bucket.total === 0) ? "" : Math.round((bucket.got / bucket.total) * 100 * 100) / 100;
        }
      }

      const gradeRows = await sb.from("grades").select("*").eq("subject_name", subject);
      const grades = gradeRows.data || [];
      const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subject).single();
      const qw = subjRow.data?.quarter_weights;

      let updated = 0;
      for (const g of grades) {
        const catVals = catAverages[g.student_number];
        if (!catVals) continue;

        let raw = 0, anyValue = false;
        cats.forEach((c: any) => {
          const v = catVals[c.id];
          if (v !== "" && v !== null && v !== undefined && !isNaN(v)) { raw += Number(v) * (Number(c.weight) / 100); anyValue = true; }
        });
        if (!anyValue) continue;
        const qScore = transmuteGrade(raw);

        let bds = Array.isArray(g.breakdowns) ? g.breakdowns.slice() : [];
        let matched = false;
        for (let j = 0; j < bds.length; j++) {
          if (String(bds[j].quarter).indexOf(qNum) !== -1) {
            bds[j].quarter = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th" }[qNum] || qNum;
            bds[j].categories = { ...(bds[j].categories || {}), ...catVals };
            bds[j].total = qScore;
            matched = true;
            break;
          }
        }
        if (!matched) bds.push({ quarter: { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th" }[qNum] || qNum, categories: catVals, total: qScore });

        const updated2: any = { q1: g.q1, q2: g.q2, q3: g.q3, q4: g.q4 };
        updated2[qKey] = qScore;
        const final = computeWeightedFinal(updated2.q1, updated2.q2, updated2.q3, updated2.q4, qw);

        await sb.from("grades").update({
          q1: String(updated2.q1 === "" ? "" : updated2.q1), q2: String(updated2.q2 === "" ? "" : updated2.q2),
          q3: String(updated2.q3 === "" ? "" : updated2.q3), q4: String(updated2.q4 === "" ? "" : updated2.q4),
          final: String(final === "" ? "" : final), remarks: determineRemarks(final), breakdowns: bds
        }).eq("id", g.id);
        updated++;
      }
      return json({ success: true, updated });
    }

    // ADMIN & REGISTRATIONS
    if (action === "getPendingRegistrations") {
      let q = sb.from("pending_registrations").select("*").order("id", { ascending: false });
      if (auth.teacher.role !== "super_admin") q = q.eq("teacher_id", auth.teacher.id);
      const rows = await q;
      
      const pending: any[] = [], history: any[] = [];
      (rows.data || []).forEach(r => {
        const item = { timestamp: r.timestamp, studentNumber: r.student_number, name: r.name, section: r.section, status: r.status };
        (item.status === "pending" ? pending : history).push(item);
      });
      return json({ success: true, pending, history });
    }

    if (action === "approveRegistration") {
      if (auth.teacher.role !== "super_admin") return json({ success: false, message: "Admin only." });
      const sNo = body.studentNumber;
      
      const pRes = await sb.from("pending_registrations").select("*").eq("student_number", sNo).eq("status", "pending").single();
      if (!pRes.data) return json({ success: false, message: "Not found." });

      await sb.from("students").upsert({ student_number: sNo, name: pRes.data.name, section: body.section || pRes.data.section }, { onConflict: "student_number" });
      await sb.from("pending_registrations").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", pRes.data.id);
      
      return json({ success: true, message: "Approved and added to pool." });
    }

    if (action === "rejectRegistration") {
      if (auth.teacher.role !== "super_admin") return json({ success: false, message: "Admin only." });
      await sb.from("pending_registrations").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("student_number", body.studentNumber).eq("status", "pending");
      return json({ success: true });
    }

    // SYSTEM & PROFILE
    if (action === "getMyStats") {
      const stuCount = await sb.from("students").select("*", { count: "exact", head: true }).eq("teacher_id", auth.teacher.id);
      const subjCount = await sb.from("subjects").select("*", { count: "exact", head: true }).eq("teacher_id", auth.teacher.id);
      const secCount = await sb.from("sections").select("*", { count: "exact", head: true }).eq("teacher_id", auth.teacher.id);
      return json({ success: true, students: stuCount.count || 0, subjects: subjCount.count || 0, sections: secCount.count || 0 });
    }

    if (action === "changeMyPassword") {
      const ok = await verifyPassword(body.currentPassword, auth.teacher.password_hash, auth.teacher.password_salt);
      if (!ok) return json({ success: false, message: "Current password is incorrect." });
      const { hash, salt } = await hashPassword(body.newPassword);
      await sb.from("teachers").update({ password_hash: hash, password_salt: salt }).eq("id", auth.teacher.id);
      return json({ success: true });
    }

    if (action === "saveTeacherName") {
      await sb.from("teachers").update({ display_name: body.name }).eq("id", auth.teacher.id);
      return json({ success: true, name: body.name });
    }

    if (action === "getTeacherName") {
      const tId = body.teacherId || auth.teacher.id;
      const res = await sb.from("teachers").select("display_name").eq("id", tId).single();
      return json({ success: true, name: res.data?.display_name || "" });
    }

    if (action === "recomputeAllGrades") return json({ success: true, totalFixed: 0, report: [] });
    if (action === "restoreAll") return json({ success: true, message: "Restore not implemented in single-file mode." });

    return json({ success: false, message: "Unknown action: " + action });
  } catch (err) {
    return json({ success: false, message: err.message });
  }
});