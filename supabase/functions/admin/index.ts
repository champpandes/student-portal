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

// NEW: map lowercase category name → id string for a subject
async function nameToIdMap(sb: any, subject: string): Promise<Record<string, string>> {
  const rows = await sb.from("subject_categories").select("id,name").eq("subject_name", subject);
  const map: Record<string, string> = {};
  (rows.data || []).forEach((r: any) => { map[String(r.name).toLowerCase()] = String(r.id); });
  return map;
}

// NEW: convert flat breakdown {quizzes, participation, ...} → {categories: {id: value, ...}}
function flatToCategories(flat: any, catMap: Record<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  ["quizzes", "participation", "attendance", "exams"].forEach(name => {
    if (catMap[name] && flat[name] !== undefined) {
      out[catMap[name]] = flat[name];
    }
  });
  return out;
}

function generateDefaultBreakdowns(_q1: any, _q2: any, _q3: any, _q4: any) {
  // Categories are now dynamic. Empty breakdowns are simply an empty array.
  return [];
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
      case "restoreAll":         result = await restoreAll(sb, body); break;
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
  const deviceId = String(p.deviceId || "unknown").slice(0, 64);
  if (!input) return { success: false, message: "Enter your PIN." };

  // Check lockout for this device
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

  // Verify PIN
  const rows = await sb.from("settings").select("value").eq("key", "admin_pin_hash").limit(1);
  if (!rows.data || rows.data.length === 0) {
    return { success: false, message: "Admin PIN not configured in database." };
  }

  const hash = await sha256(input);
  if (hash === rows.data[0].value) {
    // Success — reset attempt counter
    await sb.from("login_attempts").upsert(
      { device_id: deviceId, attempts: 0, locked_until: null, updated_at: now.toISOString() },
      { onConflict: "device_id" }
    );
    return { success: true };
  }

  // Failed — increment
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

  const catMap = await nameToIdMap(sb, subj);
  if (Object.keys(catMap).length === 0) {
    return { success: false, message: "No categories configured for this subject." };
  }

  const rows = await sb.from("grades").select("*").eq("subject_name", subj);
  const byStudent: Record<string, any> = {};
  (rows.data || []).forEach((r: any) => { byStudent[r.student_number] = r; });

  let processed = 0, lastNewTotal: any = "";

  for (const item of items) {
    const sNo = String(item.studentNumber);
    const row = byStudent[sNo];
    if (!row) continue;

    const bd = item.breakdown || {};
    const newCats = flatToCategories(bd, catMap);

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
    let matched = false;
    for (let j = 0; j < bds.length; j++) {
      if (String(bds[j].quarter || "").indexOf(qNum) !== -1) {
        bds[j].categories = { ...(bds[j].categories || {}), ...newCats };
        bds[j].total = qScore;
        matched = true;
        break;
      }
    }
    if (!matched) {
      bds.push({ quarter: qNum + "st", categories: newCats, total: qScore });
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

// ============================================================
// manageSubject — now also saves categories + quarter weights
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
    // Legacy weights — kept for backward compatibility
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
      id: c.id,
      name: c.name,
      weight: Number(c.weight),
      position: c.position
    });
  });

  return { success: true, subjects, descriptions, weights, categories, quarterWeights };
}

async function manageSubject(sb: any, p: any) {
  const subAction = String(p.subAction || "add");

  // --- DELETE ---
  if (subAction === "delete") {
    const t = String(p.subjectName);
    await sb.from("subject_categories").delete().eq("subject_name", t);
    await sb.from("subjects").delete().eq("subject_name", t);
    await sb.from("grades").delete().eq("subject_name", t);
    await sb.from("enrollments").delete().eq("subject_name", t);
    return await buildSubjectsResponse(sb);
  }

  // --- Validate categories ---
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

  // --- Validate quarter weights ---
  const qw = p.quarterWeights;
  if (qw) {
    const sum = Number(qw["1st"] || 0) + Number(qw["2nd"] || 0) + Number(qw["3rd"] || 0) + Number(qw["4th"] || 0);
    if (sum !== 100) {
      return { success: false, message: "Quarter weights must total exactly 100% (currently " + sum + "%)." };
    }
  }

  const finalName = subAction === "update" ? String(p.newName) : String(p.subjectName);
  const desc = stripTags(p.description || "");

  // --- Rename path ---
  if (subAction === "update" && p.oldName && p.oldName !== finalName) {
    await sb.from("subjects").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("subject_categories").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("grades").update({ subject_name: finalName }).eq("subject_name", p.oldName);
    await sb.from("enrollments").update({ subject_name: finalName }).eq("subject_name", p.oldName);
  }

  // --- Upsert subject row ---
  const subjPayload: any = {
    subject_name: finalName,
    description: desc
  };
  if (qw) subjPayload.quarter_weights = qw;
  if (categories && categories.length > 0) {
    subjPayload.weight_quizzes = findWeight(categories, "quizzes") || 35;
    subjPayload.weight_participation = findWeight(categories, "participation") || 15;
    subjPayload.weight_attendance = findWeight(categories, "attendance") || 10;
    subjPayload.weight_exams = findWeight(categories, "exams") || 40;
  }

  const { error: subjErr } = await sb.from("subjects").upsert(subjPayload, { onConflict: "subject_name" });
  if (subjErr) throw subjErr;

  // --- Replace categories if provided ---
  if (categories && categories.length > 0) {
    await sb.from("subject_categories").delete().eq("subject_name", finalName);
    const rows = categories.map((c: any, i: number) => ({
      subject_name: finalName,
      name: String(c.name).trim(),
      weight: Number(c.weight),
      position: i
    }));
    const { error: catErr } = await sb.from("subject_categories").insert(rows);
    if (catErr) throw catErr;
  }

  return await buildSubjectsResponse(sb);
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

// ============================================================
// restoreAll — moved into the Edge Function so RLS doesn't block it
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

  // ---- 1. Wipe existing data ----
  const wipe = async (table: string, filterCol: string) => {
    try {
      const { error } = await sb.from(table).delete().not(filterCol, "is", null);
      if (error) console.warn("[restoreAll] wipe " + table + ":", error.message);
    } catch (e) {
      console.warn("[restoreAll] wipe " + table + " threw:", e);
    }
  };

  await wipe("grades", "id");
  await wipe("enrollments", "id");
  await wipe("students", "student_number");
  await wipe("subjects", "id");
  await wipe("comments", "id");
  await wipe("announcements", "id");
  await wipe("pending_registrations", "id");
  // NOTE: settings is deliberately NOT wiped — keeps admin PIN hash

  // ---- 2. Restore in dependency order ----
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

  return {
    success: true,
    message: "Restored " + restoredRows + " rows."
  };
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