// ============================================================
// Edge Function: admin
// Handles all privileged operations for the Teacher Portal.
// Runs server-side with the service_role key.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

// Quarter label helpers (fixes "2st", "3st", "4st" bug)
const QUARTER_ORDINAL: Record<string, string> = {
  "1": "1st",
  "2": "2nd",
  "3": "3rd",
  "4": "4th"
};

function normalizeQuarterLabel(q: any): string {
  const s = String(q || "").toLowerCase().trim();
  if (!s) return "";
  const m = s.match(/^([1-4])/);
  return m ? QUARTER_ORDINAL[m[1]] : s;
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

function calculateFinal(g: any[]): number | "" {
  const v = g.filter(x => x !== null && x !== undefined && x !== "" && !isNaN(x));
  if (v.length === 0) return "";
  return Math.round(v.reduce((a, b) => a + Number(b), 0) / v.length);
}

function determineRemarks(f: any): string {
  if (f === "" || f === null || isNaN(f)) return "";
  return Number(f) >= 75 ? "Passed" : "Failed";
}

function stripTags(s: any) { return String(s ?? "").replace(/[<>]/g, ""); }

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function json(data: any, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

// Weighted-quarter final computation
function computeWeightedFinal(
  q1: any, q2: any, q3: any, q4: any,
  quarterWeights: any
): number | "" {
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
// Entry point
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false }
  });

  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const pin = String(body?.pin || "");

    const WRITE_ACTIONS = new Set([
      "manageSubject", "manageSection", "saveGrades", "saveBreakdown", "bulkSaveBreakdown",
      "addStudent", "bulkAddStudents", "updateStudentInfo", "deleteStudent",
      "clearComments", "saveAnnouncement", "deleteAnnouncement",
      "approveRegistration", "rejectRegistration", "restoreAll",
      "recomputeAllGrades",
      "addAssessment", "renameAssessment", "deleteAssessment",
      "saveScore", "saveScoresBatch", "applyClassRecordToGrades"
    ]);

    if (WRITE_ACTIONS.has(action)) {
      const rows = await sb.from("settings").select("value").eq("key", "admin_pin_hash").limit(1);
      if (!rows.data || rows.data.length === 0) {
        return json({ success: false, message: "Admin PIN not configured." }, 200);
      }
      const hash = await sha256(pin);
      if (hash !== rows.data[0].value) {
        return json({ success: false, message: "Invalid PIN." }, 200);
      }
    }

    let result: any;
    switch (action) {
      case "adminLogin":            result = await adminLogin(sb, body); break;
      case "saveGrades":            result = await saveGrades(sb, body); break;
      case "saveBreakdown":         result = await saveBreakdown(sb, body, false); break;
      case "bulkSaveBreakdown":     result = await saveBreakdown(sb, body, true); break;
      case "addStudent":            result = await addStudent(sb, body, false); break;
      case "bulkAddStudents":       result = await addStudent(sb, body, true); break;
      case "updateStudentInfo":     result = await updateStudentInfo(sb, body); break;
      case "deleteStudent":         result = await deleteStudent(sb, body); break;
      case "clearComments":         result = await clearComments(sb); break;
      case "saveAnnouncement":      result = await saveAnnouncement(sb, body); break;
      case "deleteAnnouncement":    result = await deleteAnnouncement(sb, body); break;
      case "manageSubject":         result = await manageSubject(sb, body); break;
      case "manageSection":         result = await manageSection(sb, body); break;
      case "approveRegistration":   result = await approveRegistration(sb, body); break;
      case "rejectRegistration":    result = await rejectRegistration(sb, body); break;
      case "recomputeAllGrades":    result = await recomputeAllGrades(sb); break;
      case "restoreAll":            result = await restoreAll(sb, body); break;
      case "postComment":           result = await postComment(sb, body); break;
      case "addAssessment":         result = await addAssessment(sb, body); break;
      case "renameAssessment":      result = await renameAssessment(sb, body); break;
      case "deleteAssessment":      result = await deleteAssessment(sb, body); break;
      case "saveScore":             result = await saveScore(sb, body); break;
      case "saveScoresBatch":       result = await saveScoresBatch(sb, body); break;
      case "applyClassRecordToGrades": result = await applyClassRecordToGrades(sb, body); break;
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
// Auth
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

async function saveGrades(sb: any, p: any) {
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

  const payload = {
    student_number: sNo, subject_name: subj,
    q1: String(q1 === "" ? "" : q1), q2: String(q2 === "" ? "" : q2),
    q3: String(q3 === "" ? "" : q3), q4: String(q4 === "" ? "" : q4),
    final: String(final === "" ? "" : final),
    remarks: determineRemarks(final),
    breakdowns: row?.breakdowns || []
  };

  const { error } = await sb.from("grades").upsert(payload, {
    onConflict: "student_number,subject_name"
  });
  if (error) throw error;
  return { success: true };
}

async function saveBreakdown(sb: any, p: any, isBulk: boolean) {
  const subj = String(p.subject || "");
  const qNum = String(p.quarter || "").replace(/\D/g, "");
  const qKey = "q" + qNum;

  const catRows = await sb.from("subject_categories")
    .select("id,name,weight").eq("subject_name", subj);
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

  const rows = await sb.from("grades").select("*").eq("subject_name", subj);
  const byStudent: Record<string, any> = {};
  (rows.data || []).forEach((r: any) => { byStudent[r.student_number] = r; });

  const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subj).limit(1);
  const qw = (subjRow.data && subjRow.data[0]) ? subjRow.data[0].quarter_weights : null;

  let processed = 0, lastNewTotal: any = "";

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
    if (!matched) {
      bds.push({ quarter: targetLabel, categories: valuesById, total: qScore });
    }

    const updated: any = { q1: row.q1, q2: row.q2, q3: row.q3, q4: row.q4 };
    updated[qKey] = qScore;
    const final = computeWeightedFinal(updated.q1, updated.q2, updated.q3, updated.q4, qw);

    const { error } = await sb.from("grades")
      .update({
        q1: String(updated.q1 === "" ? "" : updated.q1),
        q2: String(updated.q2 === "" ? "" : updated.q2),
        q3: String(updated.q3 === "" ? "" : updated.q3),
        q4: String(updated.q4 === "" ? "" : updated.q4),
        final: String(final === "" ? "" : final),
        remarks: determineRemarks(final),
        breakdowns: bds
      })
      .eq("student_number", sNo).eq("subject_name", subj);
    if (error) throw error;
    processed++;
  }
  return { success: true, newTotal: lastNewTotal, processed };
}

// ============================================================
// Students
// ============================================================

async function addStudent(sb: any, p: any, isBulk: boolean) {
  const list = isBulk ? (p.studentsArray || []) : [p.studentData];
  let processed = 0;
  for (const sData of list) {
    if (!sData) continue;
    const sNo = String(sData.studentNumber || "").trim();
    const name = stripTags(String(sData.name || "").trim());
    const section = stripTags(String(sData.section || "Section A"));
    const subjects = sData.enrolledSubjects || [];
    if (!sNo || !name) continue;

    let { error } = await sb.from("students").upsert(
      { student_number: sNo, name, section },
      { onConflict: "student_number" }
    );
    if (error) throw error;

    for (const sub of subjects) {
      const subName = String(sub);
      const ex = await sb.from("enrollments").select("id")
        .eq("student_number", sNo).eq("subject_name", subName);
      if (!ex.data || ex.data.length === 0) {
        const ins = await sb.from("enrollments").insert({ student_number: sNo, subject_name: subName });
        if (ins.error) throw ins.error;
      }
      const g = await sb.from("grades").upsert({
        student_number: sNo, subject_name: subName,
        q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: []
      }, { onConflict: "student_number,subject_name" });
      if (g.error) throw g.error;
    }
    processed++;
  }
  return { success: true, processed };
}

async function updateStudentInfo(sb: any, p: any) {
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

  // Keep comments in sync: renumber (if ID changed) and refresh the displayed name
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

async function deleteStudent(sb: any, p: any) {
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
// Comments
// ============================================================

async function clearComments(sb: any) {
  const { error } = await sb.from("comments").delete().gt("id", 0);
  if (error) throw error;
  return { success: true };
}

async function postComment(sb: any, p: any) {
  const sNo = String(p.studentNumber || "UNKNOWN");
  const text = stripTags(String(p.commentText || "").trim());
  if (!text) return { success: true };

  let name = "Teacher Admin";
  if (sNo !== "TEACHER_ADMIN") {
    name = "Student";
    const rows = await sb.from("students").select("name").eq("student_number", sNo);
    if (rows.data && rows.data.length && rows.data[0].name) name = rows.data[0].name;
  }

  const { error } = await sb.from("comments").insert({
    timestamp: new Date().toLocaleString(),
    student_number: sNo,
    student_name: stripTags(name),
    comment_text: text
  });
  if (error) throw error;
  return { success: true };
}

// ============================================================
// Announcements
// ============================================================

async function saveAnnouncement(sb: any, p: any) {
  const msg = stripTags(String(p.message || "").trim());
  if (!msg) return { success: false, message: "Announcement cannot be empty." };
  await sb.from("announcements").update({ is_active: false }).eq("is_active", true);
  const ts = new Date().toLocaleString();
  const { error } = await sb.from("announcements").insert({
    timestamp: ts, message: msg, posted_by: "TEACHER_ADMIN", is_active: true
  });
  if (error) throw error;
  return { success: true, timestamp: ts, message: msg };
}

async function deleteAnnouncement(sb: any, p: any) {
  const id = Number(p.rowIndex);
  if (!id) return { success: false, message: "Invalid id." };
  const { error } = await sb.from("announcements").delete().eq("id", id);
  if (error) throw error;
  return { success: true };
}

// ============================================================
// Subjects
// ============================================================

function findWeight(categories: any[], name: string): number {
  const found = categories.find((c: any) => String(c.name).toLowerCase() === name.toLowerCase());
  return found ? Number(found.weight) : 0;
}

async function buildSubjectsResponse(sb: any) {
  const subjRows = await sb.from("subjects").select("*").order("subject_name");
  const catRows = await sb.from("subject_categories").select("*").order("subject_name").order("position");

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
      quizzes: r.weight_quizzes || 35,
      participation: r.weight_participation || 15,
      attendance: r.weight_attendance || 10,
      exams: r.weight_exams || 40
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

async function manageSubject(sb: any, p: any) {
  const subAction = String(p.subAction || "add");

  if (subAction === "delete") {
    const t = String(p.subjectName);
    await sb.from("subject_categories").delete().eq("subject_name", t);
    await sb.from("subjects").delete().eq("subject_name", t);
    await sb.from("grades").delete().eq("subject_name", t);
    await sb.from("enrollments").delete().eq("subject_name", t);
    await sb.from("assessments").delete().eq("subject_name", t);
    return await buildSubjectsResponse(sb);
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

  if (subAction === "update" && p.oldName && p.oldName !== finalName) {
    await sb.from("subjects").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("subject_categories").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("grades").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("enrollments").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("assessments").update({ subject_name: finalName }).eq("subject_name", p.oldName);
  }

  const subjPayload: any = { subject_name: finalName, description: desc };
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
    const existingCats = await sb.from("subject_categories")
      .select("id,name").eq("subject_name", finalName);
    const byName: Record<string, any> = {};
    (existingCats.data || []).forEach((c: any) => { byName[String(c.name).toLowerCase()] = c; });

    const toInsert: any[] = [];
    const toUpdate: any[] = [];
    categories.forEach((c: any, i: number) => {
      const n = String(c.name).trim();
      const existing = byName[n.toLowerCase()];
      if (existing) {
        toUpdate.push({ id: existing.id, subject_name: finalName, name: n, weight: Number(c.weight), position: i });
      } else {
        toInsert.push({ subject_name: finalName, name: n, weight: Number(c.weight), position: i });
      }
    });

    for (const c of toUpdate) {
      await sb.from("subject_categories").update({
        name: c.name, weight: c.weight, position: c.position
      }).eq("id", c.id);
    }
    if (toInsert.length > 0) {
      await sb.from("subject_categories").insert(toInsert);
    }

    const keepNames = new Set(categories.map((c: any) => String(c.name).toLowerCase()));
    for (const c of (existingCats.data || [])) {
      if (!keepNames.has(String(c.name).toLowerCase())) {
        await sb.from("subject_categories").delete().eq("id", c.id);
      }
    }
  }

  return await buildSubjectsResponse(sb);
}

// ============================================================
// Sections
// ============================================================

async function buildSectionsPayload(sb: any) {
  const rows = await sb.from("sections").select("*").order("name");
  return { success: true, sections: (rows.data || []).map((r: any) => String(r.name)) };
}

async function manageSection(sb: any, p: any) {
  const subAction = String(p.subAction || "add");
  const name = stripTags(String(p.name || "").trim());

  if (!name) return { success: false, message: "Section name is required." };

  if (subAction === "add") {
    const { error } = await sb.from("sections").insert({ name });
    if (error) {
      if (String(error.message).toLowerCase().includes("duplicate")) {
        return { success: false, message: "A section with that name already exists." };
      }
      throw error;
    }
    return await buildSectionsPayload(sb);
  }

  if (subAction === "rename") {
    const oldName = stripTags(String(p.oldName || "").trim());
    if (!oldName) return { success: false, message: "Original name is required." };
    if (oldName === name) return await buildSectionsPayload(sb);

    const { error } = await sb.from("sections").update({ name }).eq("name", oldName);
    if (error) {
      if (String(error.message).toLowerCase().includes("duplicate")) {
        return { success: false, message: "A section with that name already exists." };
      }
      throw error;
    }
    await sb.from("students").update({ section: name }).eq("section", oldName);
    return await buildSectionsPayload(sb);
  }

  if (subAction === "delete") {
    const rows = await sb.from("students").select("student_number").eq("section", name).limit(1);
    if (rows.data && rows.data.length > 0) {
      return { success: false, message: "Cannot delete: students are still assigned to this section. Move them first." };
    }
    const { error } = await sb.from("sections").delete().eq("name", name);
    if (error) throw error;
    return await buildSectionsPayload(sb);
  }

  return { success: false, message: "Unknown subAction." };
}

// ============================================================
// Registration approval
// ============================================================

async function approveRegistration(sb: any, p: any) {
  const sNo = String(p.studentNumber || "");
  const section = stripTags(String(p.section || "").trim());
  const subjects = p.subjects || [];
  if (!section) return { success: false, message: "Section is required." };
  if (!subjects || subjects.length === 0) return { success: false, message: "Select at least one subject." };

  const pRows = await sb.from("pending_registrations").select("*")
    .eq("student_number", sNo).eq("status", "pending");
  if (!pRows.data || pRows.data.length === 0) {
    return { success: false, message: "Pending registration not found." };
  }
  const pr = pRows.data[0];

  const s = await sb.from("students").upsert(
    { student_number: sNo, name: pr.name, section },
    { onConflict: "student_number" }
  );
  if (s.error) throw s.error;

  for (const sub of subjects) {
    const subName = String(sub);
    const ex = await sb.from("enrollments").select("id")
      .eq("student_number", sNo).eq("subject_name", subName);
    if (!ex.data || ex.data.length === 0) {
      await sb.from("enrollments").insert({ student_number: sNo, subject_name: subName });
    }
    await sb.from("grades").upsert({
      student_number: sNo, subject_name: subName,
      q1: "", q2: "", q3: "", q4: "", final: "", remarks: "", breakdowns: []
    }, { onConflict: "student_number,subject_name" });
  }

  const { error } = await sb.from("pending_registrations").update({
    section, enrolled_subjects: subjects,
    status: "approved", reviewed_at: new Date().toLocaleString()
  }).eq("id", pr.id);
  if (error) throw error;

  return { success: true, studentNumber: sNo, message: pr.name + " approved and enrolled." };
}

async function rejectRegistration(sb: any, p: any) {
  const sNo = String(p.studentNumber || "");
  const rows = await sb.from("pending_registrations").select("id")
    .eq("student_number", sNo).eq("status", "pending");
  if (!rows.data || rows.data.length === 0) {
    return { success: false, message: "Pending registration not found." };
  }
  const { error } = await sb.from("pending_registrations").update({
    status: "rejected", reviewed_at: new Date().toLocaleString()
  }).eq("id", rows.data[0].id);
  if (error) throw error;
  return { success: true };
}

// ============================================================
// Recompute
// ============================================================

async function recomputeAllGrades(sb: any) {
  const allGrades = await sb.from("grades").select("*");
  if (!allGrades.data) return { success: true, totalFixed: 0, report: [] };

  const subjRows = await sb.from("subjects").select("subject_name,quarter_weights");
  const qwMap: Record<string, any> = {};
  (subjRows.data || []).forEach((r: any) => { qwMap[r.subject_name] = r.quarter_weights; });

  let totalFixed = 0;
  const report: any[] = [];
  const bySubject: Record<string, any[]> = {};
  allGrades.data.forEach((g: any) => {
    if (!bySubject[g.subject_name]) bySubject[g.subject_name] = [];
    bySubject[g.subject_name].push(g);
  });

  for (const subjName of Object.keys(bySubject)) {
    let fixed = 0;
    const qw = qwMap[subjName];
    for (const row of bySubject[subjName]) {
      const newFinal = computeWeightedFinal(row.q1, row.q2, row.q3, row.q4, qw);
      const newRemarks = determineRemarks(newFinal);
      if (String(row.final) !== String(newFinal) || row.remarks !== newRemarks) {
        await sb.from("grades").update({
          final: String(newFinal === "" ? "" : newFinal), remarks: newRemarks
        }).eq("id", row.id);
        fixed++;
      }
    }
    if (fixed > 0) { report.push({ subject: subjName, fixed }); totalFixed += fixed; }
  }
  return { success: true, totalFixed, report };
}

// ============================================================
// Class Recorder — assessments + scores
// ============================================================

async function addAssessment(sb: any, p: any) {
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

  const { data, error } = await sb.from("assessments").insert({
    subject_name: subject, quarter, category_id: categoryId,
    name, total_points: totalPoints, position: nextPos
  }).select();
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

  const { error } = await sb.from("assessments")
    .update({ name, total_points: totalPoints })
    .eq("id", id);
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
    assessment_id: assessmentId,
    student_number: studentNumber,
    score,
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

  const { error } = await sb.from("scores").upsert(rows, {
    onConflict: "assessment_id,student_number"
  });
  if (error) throw error;
  return { success: true, processed: rows.length };
}

async function applyClassRecordToGrades(sb: any, p: any) {
  const subject = String(p.subject || "");
  const quarter = String(p.quarter || "");
  const qNum = quarter.replace(/\D/g, "");
  const qKey = "q" + qNum;

  if (!subject || !quarter) return { success: false, message: "Subject and quarter required." };

  const catRows = await sb.from("subject_categories")
    .select("id,name,weight").eq("subject_name", subject);
  const cats: any[] = catRows.data || [];
  if (cats.length === 0) {
    return { success: false, message: "No categories configured for this subject." };
  }

  const assessRows = await sb.from("assessments")
    .select("*").eq("subject_name", subject).eq("quarter", quarter);
  const assessments: any[] = assessRows.data || [];
  if (assessments.length === 0) {
    return { success: false, message: "No assessments created for this quarter yet." };
  }

  const assessIds = assessments.map((a: any) => a.id);
  const scoreRows = await sb.from("scores")
    .select("*").in("assessment_id", assessIds);
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
      if (!bucket || bucket.total === 0) {
        catAverages[sNo][String(c.id)] = "";
      } else {
        catAverages[sNo][String(c.id)] = Math.round((bucket.got / bucket.total) * 100 * 100) / 100;
      }
    }
  }

  const gradeRows = await sb.from("grades").select("*").eq("subject_name", subject);
  const grades: any[] = gradeRows.data || [];
  const subjRow = await sb.from("subjects").select("quarter_weights").eq("subject_name", subject).limit(1);
  const qw = (subjRow.data && subjRow.data[0]) ? subjRow.data[0].quarter_weights : null;

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
    if (!matched) {
      bds.push({ quarter: targetLabel, categories: catVals, total: qScore });
    }

    const updated2: any = { q1: g.q1, q2: g.q2, q3: g.q3, q4: g.q4 };
    updated2[qKey] = qScore;
    const final = computeWeightedFinal(updated2.q1, updated2.q2, updated2.q3, updated2.q4, qw);

    const { error } = await sb.from("grades").update({
      q1: String(updated2.q1 === "" ? "" : updated2.q1),
      q2: String(updated2.q2 === "" ? "" : updated2.q2),
      q3: String(updated2.q3 === "" ? "" : updated2.q3),
      q4: String(updated2.q4 === "" ? "" : updated2.q4),
      final: String(final === "" ? "" : final),
      remarks: determineRemarks(final),
      breakdowns: bds
    }).eq("id", g.id);
    if (error) throw error;
    updated++;
  }

  return { success: true, updated };
}

// ============================================================
// Restore (from backup JSON)
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
        student_number: String(row[0]),
        subject_name: subject,
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

async function restoreAll(sb: any, p: any) {
  const backup = p.backup;
  if (!backup) {
    return { success: false, message: "Invalid backup file." };
  }

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

  const wipe = async (table: string, filterCol: string) => {
    try {
      const { error } = await sb.from(table).delete().not(filterCol, "is", null);
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
      const chunk = rows.slice(i, i + 100);
      const { error } = await sb.from(table).insert(chunk);
      if (error) {
        return {
          success: false,
          message: "Restore failed on " + table + " at row " + i + ": " + error.message
        };
      }
      restoredRows += chunk.length;
    }
  }

  return { success: true, message: "Restored " + restoredRows + " rows." };
}