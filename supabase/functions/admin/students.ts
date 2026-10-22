import { sb, scopeByTeacher, determineRemarks, stripTags, AuthContext } from "./utils.ts";

export async function getAllGradesScoped(p: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  const subject = String(p.subject || "");

  let gq = sb.from("grades").select("*").order("student_number", { ascending: true });
  if (subject && subject !== "All") gq = gq.eq("subject_name", subject);
  gq = scopeByTeacher(gq, teacherId);

  const gRows = await gq;
  if (!gRows.data) return [];

  let sq = sb.from("students").select("student_number,name,section");
  const sRows = await sq;

  const sMap: Record<string, any> = {};
  (sRows.data || []).forEach((s: any) => { sMap[s.student_number] = s; });

  const results: any[] = [];
  const seen = new Set();

  gRows.data.forEach((r: any) => {
    const sNo = String(r.student_number);
    const stu = sMap[sNo] || {};
    seen.add(sNo);
    results.push({
      studentNumber: sNo, name: stu.name || "", section: stu.section || "Section A",
      subject: r.subject_name, q1: r.q1, q2: r.q2, q3: r.q3, q4: r.q4,
      final: r.final, remarks: r.remarks || determineRemarks(r.final)
    });
  });

  if (subject === "All") {
    for (const sNo of Object.keys(sMap)) {
      if (!seen.has(sNo)) {
        const stu = sMap[sNo];
        results.push({
          studentNumber: sNo, name: stu.name || "", section: stu.section || "Section A",
          subject: "No subjects enrolled", q1: "", q2: "", q3: "", q4: "", final: "", remarks: ""
        });
      }
    }
  }

  return results.filter((r: any) => !(String(r.studentNumber).includes("T-")));
}

export async function addStudent(p: any, auth: AuthContext, isBulk: boolean) {
  if (auth.teacher && auth.teacher.role !== 'super_admin') return { success: false, message: "Only the Super Admin can add students to the pool." };

  const list = isBulk ? (p.studentsArray || []) : [p.studentData];
  let processed = 0;
  for (const sData of list) {
    if (!sData) continue;
    const sNo = String(sData.studentNumber || "").trim();
    const name = stripTags(String(sData.name || "").trim());
    const section = stripTags(String(sData.section || "Section A"));
    if (!sNo || !name) continue;

    const studentPayload: any = { student_number: sNo, name, section };
    if (auth.teacher) studentPayload.teacher_id = auth.teacher.id;

    let { error } = await sb.from("students").upsert(studentPayload, { onConflict: "student_number" });
    if (error) throw error;
    processed++;
  }
  return { success: true, processed };
}

export async function syncStudentEnrollments(p: any, auth: AuthContext) {
  const sNo = String(p.studentNumber || "");
  const newSubjects: string[] = p.subjects || [];
  const teacherId = auth.teacher?.id || null;

  let q = sb.from("enrollments").select("subject_name").eq("student_number", sNo);
  if (teacherId) q = q.eq("teacher_id", teacherId);
  const current = await q;
  const currentSubjects = (current.data || []).map((e: any) => e.subject_name);

  const toAdd = newSubjects.filter(s => !currentSubjects.includes(s));
  const toRemove = currentSubjects.filter(s => !newSubjects.includes(s));

  if (toRemove.length > 0) {
    let delQ = sb.from("enrollments").delete().eq("student_number", sNo).in("subject_name", toRemove);
    if (teacherId) delQ = delQ.eq("teacher_id", teacherId);
    await delQ;
    
    let delG = sb.from("grades").delete().eq("student_number", sNo).in("subject_name", toRemove);
    if (teacherId) delG = delG.eq("teacher_id", teacherId);
    await delG;
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map(s => {
      const row: any = { student_number: sNo, subject_name: s };
      if (teacherId) row.teacher_id = teacherId;
      return row;
    });
    await sb.from("enrollments").insert(rows);

    const gradeRows = toAdd.map(s => {
      const row: any = { student_number: sNo, subject_name: s, q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: [] };
      if (teacherId) row.teacher_id = teacherId;
      return row;
    });
    await sb.from("grades").upsert(gradeRows, { onConflict: "student_number,subject_name" });
  }
  return { success: true };
}

export async function updateStudentInfo(p: any) {
  const oldId = String(p.oldStudentNumber || "");
  const newId = String(p.newData?.studentNumber || oldId);
  const newName = stripTags(p.newData?.name || "");
  const newSection = stripTags(p.newData?.section || "");

  let { error } = await sb.from("students").update({ student_number: newId, name: newName, section: newSection }).eq("student_number", oldId);
  if (error) throw error;

  if (oldId !== newId) {
    await sb.from("grades").update({ student_number: newId }).eq("student_number", oldId);
    await sb.from("enrollments").update({ student_number: newId }).eq("student_number", oldId);
    await sb.from("scores").update({ student_number: newId }).eq("student_number", oldId);
    await sb.from("pending_registrations").update({ student_number: newId }).eq("student_number", oldId);
    await sb.from("comments").update({ student_number: newId }).eq("student_number", oldId);
  }
  if (newName) await sb.from("comments").update({ student_name: newName }).eq("student_number", newId);

  return { success: true };
}

export async function deleteStudent(p: any) {
  const sNo = String(p.studentNumber || "");
  await sb.from("scores").delete().eq("student_number", sNo);
  await sb.from("grades").delete().eq("student_number", sNo);
  await sb.from("enrollments").delete().eq("student_number", sNo);
  await sb.from("comments").delete().eq("student_number", sNo);
  await sb.from("pending_registrations").delete().eq("student_number", sNo);
  await sb.from("students").delete().eq("student_number", sNo);
  return { success: true };
}

export async function getStudent(p: any) {
  const sNo = String(p.studentNumber || '');
  if (!sNo) return { success: false, message: 'No student number.' };
  const sRows = await sb.from("students").select("*").eq("student_number", sNo);
  
  if (!sRows.data || sRows.data.length === 0) {
    const pRows = await sb.from("pending_registrations").select("*").eq("student_number", sNo).order("id", { ascending: false }).limit(1);
    if (pRows.data && pRows.data.length > 0) {
      const pr = pRows.data[0];
      if (pr.status === "pending") return { success: false, pending: true, message: "Your registration is awaiting teacher approval.", submittedName: pr.name };
      if (pr.status === "rejected") return { success: false, rejected: true, message: "Your registration was not approved. Please contact your teacher." };
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

export async function registerStudent(p: any) {
  const sNo = String(p.studentData?.studentNumber || "").trim();
  const name = stripTags(String(p.studentData?.name || "").trim());
  const teacherId = String(p.studentData?.teacherId || "").trim();
  if (!sNo || !name) return { success: false, message: "Please enter your name and student number." };
  if (!teacherId) return { success: false, message: "Please select a teacher." };

  const teacherRes = await sb.from("teachers").select("id, status, is_active").eq("id", teacherId).limit(1);
  if (!teacherRes.data || teacherRes.data.length === 0 || teacherRes.data[0].status !== "approved" || !teacherRes.data[0].is_active) {
    return { success: false, message: "Selected teacher is not available." };
  }

  const enrolled = await sb.from("students").select("student_number").eq("student_number", sNo);
  if (enrolled.data && enrolled.data.length > 0) return { success: false, message: "You are already enrolled. Please log in instead." };
  
  const pend = await sb.from("pending_registrations").select("id").eq("student_number", sNo).eq("status", "pending");
  if (pend.data && pend.data.length > 0) return { success: false, message: "You already have a pending registration. Please wait for teacher approval." };

  const ins = await sb.from("pending_registrations").insert({
    timestamp: new Date().toISOString(), student_number: sNo, name, section: '',
    enrolled_subjects: [], status: 'pending', reviewed_at: '', teacher_id: teacherId
  });
  if (ins.error) throw ins.error;
  return { success: true, pending: true, message: "Registration submitted. Awaiting teacher approval." };
}