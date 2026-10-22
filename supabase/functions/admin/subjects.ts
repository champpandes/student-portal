import { sb, stripTags, AuthContext } from "./utils.ts";

function findWeight(categories: any[], name: string): number {
  const found = categories.find((c: any) => String(c.name).toLowerCase() === name.toLowerCase());
  return found ? Number(found.weight) : 0;
}

export async function buildSubjectsResponse(teacherId: string | null) {
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
    categories[c.subject_name].push({ id: c.id, name: c.name, weight: Number(c.weight), position: c.position });
  });

  return { success: true, subjects, descriptions, weights, categories, quarterWeights };
}

export async function manageSubject(p: any, auth: AuthContext) {
  const subAction = String(p.subAction || "add");
  const teacherId = auth.teacher?.id || null;

  if (subAction === "delete") {
    const t = String(p.subjectName);
    await sb.from("subject_categories").delete().eq("subject_name", t);
    await sb.from("subjects").delete().eq("subject_name", t);
    await sb.from("grades").delete().eq("subject_name", t);
    await sb.from("enrollments").delete().eq("subject_name", t);
    await sb.from("assessments").delete().eq("subject_name", t);
    return await buildSubjectsResponse(teacherId);
  }

  const categories = Array.isArray(p.categories) ? p.categories : null;
  if (categories && categories.length > 0) {
    const sum = categories.reduce((acc: number, c: any) => acc + Number(c.weight || 0), 0);
    if (sum !== 100) return { success: false, message: "Category weights must total exactly 100% (currently " + sum + "%)." };
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
    if (sum !== 100) return { success: false, message: "Quarter weights must total exactly 100% (currently " + sum + "%)." };
  }

  const finalName = subAction === "update" ? String(p.newName) : String(p.subjectName);
  const desc = stripTags(p.description || "");

  const lookupName = String(p.oldName || finalName);
  let existingCatQuery = sb.from("subject_categories").select("id,name").eq("subject_name", lookupName);
  if (teacherId) existingCatQuery = existingCatQuery.eq("teacher_id", teacherId);
  const existingCatsResult = await existingCatQuery;
  const existingCats: any[] = existingCatsResult.data || [];

  if (categories && categories.length > 0 && existingCats.length > 0) {
    const keepNames = new Set(categories.map((c: any) => String(c.name).toLowerCase()));
    const toDelete = existingCats.filter((c: any) => !keepNames.has(String(c.name).toLowerCase()));

    if (toDelete.length > 0 && !p.confirmDelete) {
      const deleting: any[] = []; let totalAssessments = 0, totalScores = 0;
      for (const c of toDelete) {
        const assessRows = await sb.from("assessments").select("id").eq("category_id", c.id);
        const aIds = (assessRows.data || []).map((a: any) => a.id);
        let scores = 0;
        if (aIds.length > 0) {
          const scoreRows = await sb.from("scores").select("id", { count: "exact", head: true }).in("assessment_id", aIds);
          scores = Number(scoreRows.count) || 0;
        }
        deleting.push({ name: c.name, assessments: aIds.length, scores });
        totalAssessments += aIds.length; totalScores += scores;
      }
      if (totalAssessments > 0) {
        return { success: false, needsConfirm: true, message: "Some categories being removed still contain assessments and scores.", deleting, totalAssessments, totalScores };
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

    const toInsert: any[] = []; const toUpdate: any[] = [];
    categories.forEach((c: any, i: number) => {
      const n = String(c.name).trim(); const existing = byName[n.toLowerCase()];
      if (existing) toUpdate.push({ id: existing.id, subject_name: finalName, name: n, weight: Number(c.weight), position: i });
      else {
        const newRow: any = { subject_name: finalName, name: n, weight: Number(c.weight), position: i };
        if (teacherId) newRow.teacher_id = teacherId;
        toInsert.push(newRow);
      }
    });

    for (const c of toUpdate) await sb.from("subject_categories").update({ name: c.name, weight: c.weight, position: c.position }).eq("id", c.id);
    if (toInsert.length > 0) await sb.from("subject_categories").insert(toInsert);

    const keepNamesFinal = new Set(categories.map((c: any) => String(c.name).toLowerCase()));
    for (const c of catsUnderFinalName) {
      if (!keepNamesFinal.has(String(c.name).toLowerCase())) await sb.from("subject_categories").delete().eq("id", c.id);
    }
  }

  return await buildSubjectsResponse(teacherId);
}

export async function buildSectionsPayload(teacherId: string | null) {
  let query = sb.from("sections").select("*").order("name");
  if (teacherId) query = query.eq("teacher_id", teacherId);
  const rows = await query;
  return { success: true, sections: (rows.data || []).map((r: any) => String(r.name)) };
}

export async function manageSection(p: any, auth: AuthContext) {
  const subAction = String(p.subAction || "add");
  const name = stripTags(String(p.name || "").trim());
  const teacherId = auth.teacher?.id || null;
  if (!name) return { success: false, message: "Section name is required." };

  if (subAction === "add") {
    const payload: any = { name };
    if (teacherId) payload.teacher_id = teacherId;
    const { error } = await sb.from("sections").insert(payload);
    if (error && String(error.message).toLowerCase().includes("duplicate")) return { success: false, message: "A section with that name already exists." };
    if (error) throw error;
    return await buildSectionsPayload(teacherId);
  }

  if (subAction === "rename") {
    const oldName = stripTags(String(p.oldName || "").trim());
    if (!oldName) return { success: false, message: "Original name is required." };
    if (oldName === name) return await buildSectionsPayload(teacherId);

    let updateQ = sb.from("sections").update({ name }).eq("name", oldName);
    if (teacherId) updateQ = updateQ.eq("teacher_id", teacherId);
    const { error } = await updateQ;
    if (error && String(error.message).toLowerCase().includes("duplicate")) return { success: false, message: "A section with that name already exists." };
    if (error) throw error;
    
    let stuUpdate = sb.from("students").update({ section: name }).eq("section", oldName);
    if (teacherId) stuUpdate = stuUpdate.eq("teacher_id", teacherId);
    await stuUpdate;
    return await buildSectionsPayload(teacherId);
  }

  if (subAction === "delete") {
    let stuQuery = sb.from("students").select("student_number").eq("section", name).limit(1);
    if (teacherId) stuQuery = stuQuery.eq("teacher_id", teacherId);
    const rows = await stuQuery;
    if (rows.data && rows.data.length > 0) return { success: false, message: "Cannot delete: students are still assigned to this section. Move them first." };
    
    let delQuery = sb.from("sections").delete().eq("name", name);
    if (teacherId) delQuery = delQuery.eq("teacher_id", teacherId);
    const { error } = await delQuery;
    if (error) throw error;
    return await buildSectionsPayload(teacherId);
  }
  return { success: false, message: "Unknown subAction." };
}