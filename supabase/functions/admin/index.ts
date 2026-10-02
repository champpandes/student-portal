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

function validateWeights(w: any) {
  const q = Number(w?.quizzes) || 0, p = Number(w?.participation) || 0;
  const a = Number(w?.attendance) || 0, e = Number(w?.exams) || 0;
  if (q + p + a + e !== 100) return { ok: false, message: "Component weights must total exactly 100%." };
  return { ok: true, weights: { quizzes: q, participation: p, attendance: a, exams: e } };
}

function defaultWeights() { return { quizzes: 35, participation: 15, attendance: 10, exams: 40 }; }

function stripTags(s: any) { return String(s ?? "").replace(/[<>]/g, ""); }

function generateDefaultBreakdowns(q1: any, q2: any, q3: any, q4: any) {
  const vals = [q1, q2, q3, q4], names = ["1st", "2nd", "3rd", "4th"];
  return vals.map((v, i) => ({
    quarter: names[i], quizzes: "", participation: "", attendance: "", exams: "",
    total: (v !== null && v !== undefined && v !== "" && !isNaN(v)) ? v : ""
  }));
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

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

    // ---- Verify PIN for all write actions ----
    const WRITE_ACTIONS = new Set([
      "manageSubject", "saveGrades", "saveBreakdown", "bulkSaveBreakdown",
      "addStudent", "bulkAddStudents", "updateStudentInfo", "deleteStudent",
      "clearComments", "saveAnnouncement", "deleteAnnouncement",
      "approveRegistration", "rejectRegistration", "restoreAll",
      "recomputeAllGrades"
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

    // ---- Route ----
    let result: any;
    switch (action) {
      case "adminLogin":         result = await adminLogin(sb, body); break;
      case "saveGrades":         result = await saveGrades(sb, body); break;
      case "saveBreakdown":      result = await saveBreakdown(sb, body, false); break;
      case "bulkSaveBreakdown":  result = await saveBreakdown(sb, body, true); break;
      case "addStudent":         result = await addStudent(sb, body, false); break;
      case "bulkAddStudents":    result = await addStudent(sb, body, true); break;
      case "updateStudentInfo":  result = await updateStudentInfo(sb, body); break;
      case "deleteStudent":      result = await deleteStudent(sb, body); break;
      case "clearComments":      result = await clearComments(sb); break;
      case "saveAnnouncement":   result = await saveAnnouncement(sb, body); break;
      case "deleteAnnouncement": result = await deleteAnnouncement(sb, body); break;
      case "manageSubject":      result = await manageSubject(sb, body); break;
      case "approveRegistration":result = await approveRegistration(sb, body); break;
      case "rejectRegistration": result = await rejectRegistration(sb, body); break;
      case "recomputeAllGrades": result = await recomputeAllGrades(sb); break;
      case "postComment":        result = await postComment(sb, body); break;
      default:
        return json({ success: false, message: "Unknown action: " + action }, 200);
    }

    return json(result, 200);
  } catch (err) {
    console.error("[admin fn]", err);
    return json({ success: false, message: (err as Error).message || String(err) }, 200);
  }
});

function json(data: any, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

// ============================================================
// Handlers
// ============================================================
async function adminLogin(sb: any, p: any) {
  const input = String(p.pin || "");
  if (!input) return { success: false, message: "Enter your PIN." };

  const rows = await sb.from("settings").select("value").eq("key", "admin_pin_hash").limit(1);
  if (!rows.data || rows.data.length === 0) {
    return { success: false, message: "Admin PIN not configured in database." };
  }
  const hash = await sha256(input);
  if (hash === rows.data[0].value) return { success: true };
  return { success: false, message: "Invalid PIN." };
}

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
  const final = calculateFinal([q1, q2, q3, q4]);

  const payload = {
    student_number: sNo, subject_name: subj,
    q1: String(q1 === "" ? "" : q1), q2: String(q2 === "" ? "" : q2),
    q3: String(q3 === "" ? "" : q3), q4: String(q4 === "" ? "" : q4),
    final: String(final === "" ? "" : final),
    remarks: determineRemarks(final),
    breakdowns: row?.breakdowns || generateDefaultBreakdowns(q1, q2, q3, q4)
  };

  const { error } = await sb.from("grades").upsert(payload, {
    onConflict: "student_number,subject_name"
  });
  if (error) throw error;
  return { success: true };
}

async function saveBreakdown(sb: any, p: any, isBulk: boolean) {
  const v = validateWeights(p.weights || defaultWeights());
  if (!v.ok) return { success: false, message: v.message };
  const w = v.weights;

  const subj = String(p.subject || "");
  const qNum = String(p.quarter || "").replace(/\D/g, "");
  const qKey = "q" + qNum;

  const items = isBulk ? (p.items || []) : [{ studentNumber: p.studentNumber, breakdown: p.breakdown }];
  if (items.length === 0) return { success: true, newTotal: "", processed: 0 };

  const rows = await sb.from("grades").select("*").eq("subject_name", subj);
  const byStudent: Record<string, any> = {};
  (rows.data || []).forEach((r: any) => { byStudent[r.student_number] = r; });

  let processed = 0, lastNewTotal: any = "";

  for (const item of items) {
    const sNo = String(item.studentNumber);
    const row = byStudent[sNo];
    if (!row) continue;

    const bd = item.breakdown || {};
    const has = (bd.quizzes !== "" && bd.quizzes != null && !isNaN(bd.quizzes)) ||
                (bd.participation !== "" && bd.participation != null && !isNaN(bd.participation)) ||
                (bd.attendance !== "" && bd.attendance != null && !isNaN(bd.attendance)) ||
                (bd.exams !== "" && bd.exams != null && !isNaN(bd.exams));

    let qScore: any;
    if (has) {
      const raw = Number(bd.quizzes || 0) * (w.quizzes / 100) +
                  Number(bd.participation || 0) * (w.participation / 100) +
                  Number(bd.attendance || 0) * (w.attendance / 100) +
                  Number(bd.exams || 0) * (w.exams / 100);
      qScore = transmuteGrade(raw);
    } else {
      const cur = row[qKey];
      qScore = (cur !== "" && !isNaN(cur)) ? Number(cur) : 0;
    }
    lastNewTotal = qScore;

    let bds = Array.isArray(row.breakdowns) ? row.breakdowns.slice() : [];
    if (bds.length === 0) bds = generateDefaultBreakdowns(row.q1, row.q2, row.q3, row.q4);
    let matched = false;
    for (let j = 0; j < bds.length; j++) {
      if (String(bds[j].quarter || "").indexOf(qNum) !== -1) {
        bds[j].quizzes = bd.quizzes; bds[j].participation = bd.participation;
        bds[j].attendance = bd.attendance; bds[j].exams = bd.exams;
        bds[j].total = qScore; matched = true; break;
      }
    }
    if (!matched) {
      bds.push({ quarter: qNum + "st", quizzes: bd.quizzes,
        participation: bd.participation, attendance: bd.attendance,
        exams: bd.exams, total: qScore });
    }

    const updated: any = { q1: row.q1, q2: row.q2, q3: row.q3, q4: row.q4 };
    updated[qKey] = qScore;
    const final = calculateFinal([
      updated.q1 === "" ? null : Number(updated.q1),
      updated.q2 === "" ? null : Number(updated.q2),
      updated.q3 === "" ? null : Number(updated.q3),
      updated.q4 === "" ? null : Number(updated.q4)
    ]);

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
  await sb.from("grades").delete().eq("student_number", sNo);
  await sb.from("enrollments").delete().eq("student_number", sNo);
  await sb.from("students").delete().eq("student_number", sNo);
  return { success: true };
}

async function clearComments(sb: any) {
  const { error } = await sb.from("comments").delete().gt("id", 0);
  if (error) throw error;
  return { success: true };
}

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

async function manageSubject(sb: any, p: any) {
  const v = validateWeights(p.weights || defaultWeights());
  if (!v.ok) return { success: false, message: v.message };
  const w = v.weights;

  if (p.subAction === "delete") {
    const t = String(p.subjectName);
    await sb.from("subjects").delete().eq("subject_name", t);
    await sb.from("grades").delete().eq("subject_name", t);
    await sb.from("enrollments").delete().eq("subject_name", t);
  } else if (p.subAction === "update" && p.oldName) {
    const { error } = await sb.from("subjects").update({
      subject_name: p.newName, description: stripTags(p.description || ""),
      weight_quizzes: w.quizzes, weight_participation: w.participation,
      weight_attendance: w.attendance, weight_exams: w.exams
    }).eq("subject_name", p.oldName);
    if (error) throw error;
    if (p.oldName !== p.newName) {
      await sb.from("grades").update({ subject_name: p.newName }).eq("subject_name", p.oldName);
      await sb.from("enrollments").update({ subject_name: p.newName }).eq("subject_name", p.oldName);
    }
  } else {
    const { error } = await sb.from("subjects").upsert({
      subject_name: p.subjectName, description: stripTags(p.description || ""),
      weight_quizzes: w.quizzes, weight_participation: w.participation,
      weight_attendance: w.attendance, weight_exams: w.exams
    }, { onConflict: "subject_name" });
    if (error) throw error;
  }

  // Return updated subject list
  const rows = await sb.from("subjects").select("*").order("subject_name");
  const subjects: string[] = [], descriptions: Record<string, string> = {}, weights: Record<string, any> = {};
  (rows.data || []).forEach((r: any) => {
    subjects.push(r.subject_name);
    descriptions[r.subject_name] = r.description || "";
    weights[r.subject_name] = {
      quizzes: r.weight_quizzes || 35, participation: r.weight_participation || 15,
      attendance: r.weight_attendance || 10, exams: r.weight_exams || 40
    };
  });
  return { success: true, subjects, descriptions, weights };
}

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

async function recomputeAllGrades(sb: any) {
  const allGrades = await sb.from("grades").select("*");
  if (!allGrades.data) return { success: true, totalFixed: 0, report: [] };

  let totalFixed = 0;
  const report: any[] = [];
  const bySubject: Record<string, any[]> = {};
  allGrades.data.forEach((g: any) => {
    if (!bySubject[g.subject_name]) bySubject[g.subject_name] = [];
    bySubject[g.subject_name].push(g);
  });

  for (const subjName of Object.keys(bySubject)) {
    let fixed = 0;
    for (const row of bySubject[subjName]) {
      const newFinal = calculateFinal([row.q1, row.q2, row.q3, row.q4]);
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