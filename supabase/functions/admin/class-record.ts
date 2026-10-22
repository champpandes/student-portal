import { sb, sbGet, scopeByTeacher, transmuteGrade, determineRemarks, computeWeightedFinal, stripTags, AuthContext } from "./utils.ts";

export async function getClassRecordScoped(p: any, auth: AuthContext) {
  const subject = String(p.subject || "");
  const quarter = String(p.quarter || "");
  const teacherId = auth.teacher?.id || null;
  if (!subject || !quarter) return { success: false, message: "Subject and quarter required." };

  let catQ = sb.from("subject_categories").select("id,name,weight,position").eq("subject_name", subject).order("position", { ascending: true });
  catQ = scopeByTeacher(catQ, teacherId);
  const catRows = await catQ;
  const categories = Array.isArray(catRows.data) ? catRows.data : [];

  let assessQ = sb.from("assessments").select("*").eq("subject_name", subject).eq("quarter", quarter).order("category_id", { ascending: true }).order("position", { ascending: true });
  assessQ = scopeByTeacher(assessQ, teacherId);
  const assessRows = await assessQ;
  const assessments = Array.isArray(assessRows.data) ? assessRows.data : [];

  let scores: any[] = [];
  if (assessments.length > 0) {
    const ids = assessments.map((a: any) => a.id).join(",");
    scores = await sbGet("scores", "select=*&assessment_id=in.(" + ids + ")");
  }

  let enrQ = sb.from("enrollments").select("student_number").eq("subject_name", subject);
  enrQ = scopeByTeacher(enrQ, teacherId);
  const enrRows = await enrQ;
  const studentNumbers = (Array.isArray(enrRows.data) ? enrRows.data : []).map((e: any) => String(e.student_number));

  let students: any[] = [];
  if (studentNumbers.length > 0) {
    let sQ = sb.from("students").select("student_number,name,section").in("student_number", studentNumbers);
    sQ = scopeByTeacher(sQ, teacherId);
    const sRows = await sQ;
    students = Array.isArray(sRows.data) ? sRows.data : [];
  }

  return { success: true, categories, assessments, scores, students };
}

export async function addAssessment(p: any, auth: AuthContext) {
  const subject = String(p.subject || "");
  const quarter = String(p.quarter || "");
  const categoryId = Number(p.categoryId);
  const name = stripTags(String(p.name || "").trim());
  const totalPoints = Number(p.totalPoints);

  if (!subject || !quarter || !categoryId || !name || !totalPoints || totalPoints <= 0) return { success: false, message: "All fields required. Total points must be > 0." };

  const cat = await sb.from("subject_categories").select("subject_name").eq("id", categoryId).limit(1);
  if (!cat.data || cat.data.length === 0 || cat.data[0].subject_name !== subject) return { success: false, message: "Category does not belong to this subject." };

  const existing = await sb.from("assessments").select("position").eq("subject_name", subject).eq("quarter", quarter).eq("category_id", categoryId);
  const nextPos = (existing.data || []).reduce((max: number, r: any) => Math.max(max, Number(r.position) || 0), 0) + 1;

  const payload: any = { subject_name: subject, quarter, category_id: categoryId, name, total_points: totalPoints, position: nextPos };
  if (auth.teacher) payload.teacher_id = auth.teacher.id;

  const { data, error } = await sb.from("assessments").insert(payload).select();
  if (error) throw error;
  return { success: true, assessment: data[0] };
}

export async function renameAssessment(p: any) {
  const id = Number(p.id);
  const name = stripTags(String(p.name || "").trim());
  const totalPoints = Number(p.totalPoints);
  if (!id || !name || !totalPoints || totalPoints <= 0) return { success: false, message: "Name and total points required. Total must be > 0." };
  const { error } = await sb.from("assessments").update({ name, total_points: totalPoints }).eq("id", id);
  if (error) throw error;
  return { success: true };
}

export async function deleteAssessment(p: any) {
  const id = Number(p.id);
  if (!id) return { success: false, message: "Invalid id." };
  const { error } = await sb.from("assessments").delete().eq("id", id);
  if (error) throw error;
  return { success: true };
}

export async function saveScore(p: any) {
  const assessmentId = Number(p.assessmentId);
  const studentNumber = String(p.studentNumber || "");
  const scoreRaw = p.score;
  if (!assessmentId || !studentNumber) return { success: false, message: "Missing fields." };
  const score = (scoreRaw === "" || scoreRaw === null || scoreRaw === undefined) ? null : Number(scoreRaw);
  const { error } = await sb.from("scores").upsert({ assessment_id: assessmentId, student_number: studentNumber, score, updated_at: new Date().toISOString() }, { onConflict: "assessment_id,student_number" });
  if (error) throw error;
  return { success: true };
}

export async function saveScoresBatch(p: any) {
  const items = p.items || [];
  if (!Array.isArray(items) || items.length === 0) return { success: true, processed: 0 };
  const rows = items.map((it: any) => ({
    assessment_id: Number(it.assessmentId), student_number: String(it.studentNumber),
    score: (it.score === "" || it.score === null || it.score === undefined) ? null : Number(it.score),
    updated_at: new Date().toISOString()
  }));
  const { error } = await sb.from("scores").upsert(rows, { onConflict: "assessment_id,student_number" });
  if (error) throw error;
  return { success: true, processed: rows.length };
}

export async function applyClassRecordToGrades(p: any, auth: AuthContext) {
  const subject = String(p.subject || "");
  const quarter = String(p.quarter || "");
  const qNum = quarter.replace(/\D/g, "");
  const qKey = "q" + qNum;
  if (!subject || !quarter) return { success: false, message: "Subject and quarter required." };

  const catRows = await sb.from("subject_categories").select("id,name,weight").eq("subject_name", subject);
  const cats: any[] = catRows.data || [];
  if (cats.length === 0) return { success: false, message: "No categories configured for this subject." };

  const assessRows = await sb.from("assessments").select("*").eq("subject_name", subject).eq("quarter", quarter);
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
      catAverages[sNo][String(c.id)] = (!bucket || bucket.total === 0) ? "" : Math.round((bucket.got / bucket.total) * 100 * 100) / 100;
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
      if (v !== "" && v !== null && v !== undefined && !isNaN(v)) { raw += Number(v) * (Number(c.weight) / 100); anyValue = true; }
    });
    if (!anyValue) continue;
    const qScore = transmuteGrade(raw);

    const targetLabel = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th" }[qNum] || qNum;
    let bds = Array.isArray(g.breakdowns) ? g.breakdowns.slice() : [];
    let matched = false;
    for (let j = 0; j < bds.length; j++) {
      if (String(bds[j].quarter).indexOf(qNum) !== -1) {
        bds[j].quarter = targetLabel; bds[j].categories = { ...(bds[j].categories || {}), ...catVals }; bds[j].total = qScore; matched = true; break;
      }
    }
    if (!matched) bds.push({ quarter: targetLabel, categories: catVals, total: qScore });

    const updated2: any = { q1: g.q1, q2: g.q2, q3: g.q3, q4: g.q4 };
    updated2[qKey] = qScore;
    const final = computeWeightedFinal(updated2.q1, updated2.q2, updated2.q3, updated2.q4, qw);

    const updPayload: any = {
      q1: String(updated2.q1 === "" ? "" : updated2.q1), q2: String(updated2.q2 === "" ? "" : updated2.q2),
      q3: String(updated2.q3 === "" ? "" : updated2.q3), q4: String(updated2.q4 === "" ? "" : updated2.q4),
      final: String(final === "" ? "" : final), remarks: determineRemarks(final), breakdowns: bds
    };
    if (teacherId) updPayload.teacher_id = teacherId;

    const { error } = await sb.from("grades").update(updPayload).eq("id", g.id);
    if (error) throw error;
    updated++;
  }
  return { success: true, updated };
}