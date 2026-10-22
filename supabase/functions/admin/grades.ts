import { sb, scopeByTeacher, transmuteGrade, determineRemarks, computeWeightedFinal, AuthContext } from "./utils.ts";

export async function saveGrades(p: any, auth: AuthContext) {
  const sNo = String(p.studentNumber || "");
  const subj = String(p.subject || "");
  const grades = p.grades || {};

  const existing = await sb.from("grades").select("*").eq("student_number", sNo).eq("subject_name", subj);
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
    final: String(final === "" ? "" : final), remarks: determineRemarks(final),
    breakdowns: row?.breakdowns || []
  };
  if (auth.teacher) payload.teacher_id = auth.teacher.id;

  const { error } = await sb.from("grades").upsert(payload, { onConflict: "student_number,subject_name" });
  if (error) throw error;
  return { success: true };
}

export async function saveBreakdown(p: any, auth: AuthContext, isBulk: boolean) {
  const subj = String(p.subject || "");
  const qNum = String(p.quarter || "").replace(/\D/g, "");
  const qKey = "q" + qNum;

  let catQ = sb.from("subject_categories").select("id,name,weight").eq("subject_name", subj);
  if (auth.teacher) catQ = catQ.eq("teacher_id", auth.teacher.id);
  const catRows = await catQ;
  const cats: any[] = catRows.data || [];
  if (cats.length === 0) return { success: false, message: "No categories configured for this subject." };
  
  const catByName: Record<string, any> = {};
  cats.forEach((c: any) => { catByName[String(c.name).toLowerCase()] = c; });

  const items = isBulk ? (p.items || []) : [{ studentNumber: p.studentNumber, entries: p.entries, breakdown: p.breakdown }];
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
        if (cat && item.breakdown[name] !== undefined) valuesById[String(cat.id)] = item.breakdown[name];
      });
    }

    let raw = 0, anyValue = false;
    cats.forEach((c: any) => {
      const v = valuesById[String(c.id)];
      if (v !== "" && v !== null && v !== undefined && !isNaN(v)) { raw += Number(v) * (Number(c.weight) / 100); anyValue = true; }
    });

    let qScore: any;
    if (anyValue) qScore = transmuteGrade(raw);
    else { const cur = row[qKey]; qScore = (cur !== "" && !isNaN(cur)) ? Number(cur) : 0; }
    lastNewTotal = qScore;

    const targetLabel = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th" }[qNum] || qNum;
    let bds = Array.isArray(row.breakdowns) ? row.breakdowns.slice() : [];
    let matched = false;
    for (let j = 0; j < bds.length; j++) {
      if (String(bds[j].quarter).indexOf(qNum) !== -1) {
        bds[j].quarter = targetLabel; bds[j].categories = { ...(bds[j].categories || {}), ...valuesById }; bds[j].total = qScore; matched = true; break;
      }
    }
    if (!matched) bds.push({ quarter: targetLabel, categories: valuesById, total: qScore });

    const updated: any = { q1: row.q1, q2: row.q2, q3: row.q3, q4: row.q4 };
    updated[qKey] = qScore;
    const final = computeWeightedFinal(updated.q1, updated.q2, updated.q3, updated.q4, qw);

    const payload: any = {
      student_number: sNo, subject_name: subj,
      q1: String(updated.q1 === "" ? "" : updated.q1), q2: String(updated.q2 === "" ? "" : updated.q2),
      q3: String(updated.q3 === "" ? "" : updated.q3), q4: String(updated.q4 === "" ? "" : updated.q4),
      final: String(final === "" ? "" : final), remarks: determineRemarks(final), breakdowns: bds
    };
    if (auth.teacher) payload.teacher_id = auth.teacher.id;
    updates.push(payload);
    processed++;
  }

  if (updates.length === 0) return { success: true, newTotal: lastNewTotal, processed: 0 };
  const { error } = await sb.from("grades").upsert(updates, { onConflict: "student_number,subject_name" });
  if (error) throw error;
  return { success: true, newTotal: lastNewTotal, processed };
}

export async function recomputeAllGrades(auth: AuthContext) {
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
        if (n > 0 && n < 60) { clamped[k] = 60; rowChanged = true; } else { clamped[k] = n; }
      });

      if (Array.isArray(row.breakdowns) && row.breakdowns.length > 0) {
        const newBds: any[] = [];
        let bdsChanged = false;
        for (const bd of row.breakdowns) {
          const qNum = String(bd.quarter || "").replace(/\D/g, "");
          const normalized = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th" }[qNum] || bd.quarter;
          let total = bd.total;
          if (cats.length > 0 && bd.categories && typeof bd.categories === "object") {
            let raw = 0, anyValue = false;
            cats.forEach((c: any) => {
              const v = bd.categories[String(c.id)];
              if (v !== "" && v !== null && v !== undefined && !isNaN(v)) { raw += Number(v) * (Number(c.weight) / 100); anyValue = true; }
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
        if (String(row[k]) !== String(clamped[k])) { updates[k] = String(clamped[k] === "" ? "" : clamped[k]); rowChanged = true; }
      });

      const newFinal = computeWeightedFinal(clamped.q1, clamped.q2, clamped.q3, clamped.q4, qw);
      const newRemarks = determineRemarks(newFinal);

      if (String(row.final) !== String(newFinal)) { updates.final = String(newFinal === "" ? "" : newFinal); rowChanged = true; }
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