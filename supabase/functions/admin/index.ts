import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TRANSMUTATION: [number, number][] = [
  [98.40, 99], [96.80, 98], [95.20, 97], [93.60, 96], [92.00, 95], [90.40, 94], [88.80, 93], [87.20, 92], [85.60, 91], [84.00, 90],
  [82.40, 89], [80.80, 88], [79.20, 87], [77.60, 86], [76.00, 85], [74.40, 84], [72.80, 83], [71.20, 82], [69.60, 81], [68.00, 80],
  [66.40, 79], [64.80, 78], [63.20, 77], [61.60, 76], [60.00, 75], [56.00, 74], [52.00, 73], [48.00, 72], [44.00, 71], [40.00, 70],
  [36.00, 69], [32.00, 68], [28.00, 67], [24.00, 66], [20.00, 65], [16.00, 64], [12.00, 63], [8.00, 62], [4.00, 61], [0.00, 60]
];

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function stripTags(s: any) { return String(s ?? "").replace(/[<>]/g, ""); }

function determineRemarks(f: any): string {
  if (f === "" || f === null || isNaN(f)) return "";
  return Number(f) >= 75 ? "Passed" : "Failed";
}

function transmuteGrade(score: any): number | "" {
  if (score === "" || score === null || isNaN(score)) return "";
  const s = Number(score);
  if (s >= 100) return 100;
  for (const [lo, hi] of TRANSMUTATION) {
    if (s >= lo) return hi;
  }
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

function scopeByTeacher(query: any, teacherId: string | null) {
  if (!teacherId) return query;
  return query.or(`teacher_id.eq.${teacherId},teacher_id.is.null`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const action = String(body?.action || "");

    // -------- PUBLIC ACTIONS --------
    if (action === "teacherLogin") {
      const email = String(body.email || "").toLowerCase().trim();
      const rows = await sb.from("teachers").select("*").eq("email", email).single();
      if (!rows.data) return json({ success: false, message: "Invalid email." });
      
      const teacher = rows.data;
      if (teacher.status === "pending") return json({ success: false, pending: true, message: "Awaiting approval." });
      
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

    if (action === "getSections") {
      const q = scopeByTeacher(sb.from("sections").select("name").order("name"), auth.teacher.id);
      const sec = await q;
      return json({ success: true, sections: (sec.data || []).map(s => s.name) });
    }

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

    if (action === "getClassRecord") {
      const subject = String(body.subject || "");
      const quarter = String(body.quarter || "");
      if (!subject || !quarter) return json({ success: false, message: "Subject and quarter required." });

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

    // --- CLASS RECORD WRITE ACTIONS ---
    if (action === "addAssessment") {
      const subject = String(body.subject || "");
      const quarter = String(body.quarter || "");
      const categoryId = Number(body.categoryId);
      const name = stripTags(String(body.name || "").trim());
      const totalPoints = Number(body.totalPoints);

      const existing = await sb.from("assessments").select("position").eq("subject_name", subject).eq("quarter", quarter).eq("category_id", categoryId);
      const nextPos = (existing.data || []).reduce((max: number, r: any) => Math.max(max, Number(r.position) || 0), 0) + 1;

      const { data, error } = await sb.from("assessments").insert({
        subject_name: subject, quarter, category_id: categoryId, name, total_points: totalPoints, position: nextPos, teacher_id: auth.teacher.id
      }).select();
      if (error) throw error;
      return json({ success: true, assessment: data[0] });
    }

    if (action === "renameAssessment") {
      const id = Number(body.id);
      const { error } = await sb.from("assessments").update({ name: stripTags(body.name), total_points: Number(body.totalPoints) }).eq("id", id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "deleteAssessment") {
      const id = Number(body.id);
      const { error } = await sb.from("assessments").delete().eq("id", id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "saveScore") {
      const assessmentId = Number(body.assessmentId);
      const studentNumber = String(body.studentNumber || "");
      const score = (body.score === "" || body.score === null || body.score === undefined) ? null : Number(body.score);
      const { error } = await sb.from("scores").upsert({
        assessment_id: assessmentId, student_number: studentNumber, score, updated_at: new Date().toISOString()
      }, { onConflict: "assessment_id,student_number" });
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "saveScoresBatch") {
      const items = body.items || [];
      if (items.length === 0) return json({ success: true, processed: 0 });
      const rows = items.map((it: any) => ({
        assessment_id: Number(it.assessmentId), student_number: String(it.studentNumber),
        score: (it.score === "" || it.score === null || it.score === undefined) ? null : Number(it.score),
        updated_at: new Date().toISOString()
      }));
      const { error } = await sb.from("scores").upsert(rows, { onConflict: "assessment_id,student_number" });
      if (error) throw error;
      return json({ success: true, processed: rows.length });
    }

    if (action === "applyClassRecordToGrades") {
      const subject = String(body.subject || "");
      const quarter = String(body.quarter || "");
      const qNum = quarter.replace(/\D/g, "");
      const qKey = "q" + qNum;

      const catRows = await sb.from("subject_categories").select("id,name,weight").eq("subject_name", subject);
      const cats = catRows.data || [];
      const assessRows = await sb.from("assessments").select("*").eq("subject_name", subject).eq("quarter", quarter);
      const assessments = assessRows.data || [];

      if (assessments.length === 0) return json({ success: false, message: "No assessments created." });

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

    return json({ success: false, message: "Unknown action: " + action });
  } catch (err) {
    return json({ success: false, message: err.message });
  }
});