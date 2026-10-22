import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function stripTags(s: any) { return String(s ?? "").replace(/[<>]/g, ""); }

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

    // --- NEW: ADD STUDENT / REQUEST STUDENT ---
    if (action === "addStudent") {
      const sData = body.studentData;
      const sNo = String(sData.studentNumber || "").trim();
      const name = stripTags(String(sData.name || "").trim());
      const section = stripTags(String(sData.section || "Section A"));

      if (auth.teacher.role === "super_admin") {
        // Admin adds directly to the pool
        await sb.from("students").upsert({ student_number: sNo, name, section, teacher_id: auth.teacher.id }, { onConflict: "student_number" });
        return json({ success: true, message: "Student added to pool." });
      } else {
        // Teacher requests addition (goes to Pending Registrations)
        await sb.from("pending_registrations").insert({
          timestamp: new Date().toISOString(), student_number: sNo, name: name, section: section,
          enrolled_subjects: [], status: 'pending', reviewed_at: '', teacher_id: auth.teacher.id
        });
        return json({ success: true, message: "Request submitted to Admin for approval." });
      }
    }

        // --- NEW: BULK ADD STUDENTS ---
    if (action === "bulkAddStudents") {
      const studentsArray = body.studentsArray || [];
      if (studentsArray.length === 0) return json({ success: false, message: "No students provided." });

      if (auth.teacher.role === "super_admin") {
        // Admin adds directly to the pool
        const payloads = studentsArray.map((s: any) => ({
          student_number: s.studentNumber, 
          name: stripTags(s.name), 
          section: s.section || "Section A", 
          teacher_id: auth!.teacher.id
        }));
        await sb.from("students").upsert(payloads, { onConflict: "student_number" });
        return json({ success: true, processed: payloads.length });
      } else {
        // Teacher requests addition (goes to Pending Registrations)
        const payloads = studentsArray.map((s: any) => ({
          timestamp: new Date().toISOString(), 
          student_number: s.studentNumber, 
          name: stripTags(s.name), 
          section: s.section || "Section A",
          enrolled_subjects: [], 
          status: 'pending', 
          reviewed_at: '', 
          teacher_id: auth!.teacher.id
        }));
        await sb.from("pending_registrations").insert(payloads);
        return json({ success: true, processed: payloads.length });
      }
    }

    // --- NEW: ADMIN REGISTRATIONS ---
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