import { sb, scopeByTeacher, verifyPassword, hashPassword, stripTags, AuthContext } from "./utils.ts";

export async function getTeacherName(p: any) {
  const teacherId = String(p?.teacherId || "").trim();
  if (teacherId) {
    const rows = await sb.from("teachers").select("display_name").eq("id", teacherId).limit(1);
    if (rows.data && rows.data.length > 0) return { success: true, name: rows.data[0].display_name || "" };
  }
  const rows = await sb.from("settings").select("value").eq("key", "teacher_display_name").limit(1);
  const name = (rows.data && rows.data[0]) ? String(rows.data[0].value || "") : "";
  return { success: true, name };
}

export async function saveTeacherName(p: any, auth: AuthContext) {
  const name = stripTags(String(p.name || "").trim()).slice(0, 120);
  if (!name) return { success: false, message: "Name cannot be empty." };

  if (auth.teacher) {
    const { error } = await sb.from("teachers").update({ display_name: name }).eq("id", auth.teacher.id);
    if (error) throw error;
    return { success: true, name };
  }
  const { error } = await sb.from("settings").upsert({ key: "teacher_display_name", value: name }, { onConflict: "key" });
  if (error) throw error;
  return { success: true, name };
}

export async function getMyStats(auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  let stuQ = sb.from("students").select("student_number", { count: "exact", head: true });
  let subjQ = sb.from("subjects").select("id", { count: "exact", head: true });
  let secQ = sb.from("sections").select("id", { count: "exact", head: true });

  if (teacherId) {
    stuQ = stuQ.eq("teacher_id", teacherId);
    subjQ = subjQ.eq("teacher_id", teacherId);
    secQ = secQ.eq("teacher_id", teacherId);
  }
  const [stu, subj, sec] = await Promise.all([stuQ, subjQ, secQ]);
  return { success: true, students: stu.count || 0, subjects: subj.count || 0, sections: sec.count || 0 };
}

export async function changeMyPassword(p: any, auth: AuthContext) {
  if (!auth.teacher) return { success: false, message: "Not authenticated as a teacher." };
  const current = String(p.currentPassword || "");
  const next = String(p.newPassword || "");
  if (!current || !next) return { success: false, message: "Enter both current and new password." };
  if (next.length < 6) return { success: false, message: "New password must be at least 6 characters." };
  if (current === next) return { success: false, message: "New password must be different from the current one." };

  const teacher = auth.teacher;
  const ok = await verifyPassword(current, teacher.password_hash, teacher.password_salt);
  if (!ok) return { success: false, message: "Current password is incorrect." };

  const { hash, salt } = await hashPassword(next);
  const { error } = await sb.from("teachers").update({ password_hash: hash, password_salt: salt }).eq("id", teacher.id);
  if (error) throw error;

  const currentToken = String(p.sessionToken || "").trim();
  let q = sb.from("teacher_sessions").delete().eq("teacher_id", teacher.id);
  if (currentToken) q = q.neq("token", currentToken);
  await q;
  return { success: true };
}

export async function restoreAll(p: any, auth: AuthContext) {
  const backup = p.backup;
  if (!backup) return { success: false, message: "Invalid backup file." };

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

  const teacherId = auth.teacher?.id || null;
  const wipe = async (table: string, filterCol: string) => {
    try {
      let q = sb.from(table).delete().not(filterCol, "is", null);
      if (teacherId) q = q.eq("teacher_id", teacherId);
      const { error } = await q;
      if (error) console.warn("[restoreAll] wipe " + table + ":", error.message);
    } catch (e) { console.warn("[restoreAll] wipe " + table + " threw:", e); }
  };

  await wipe("scores", "id"); await wipe("assessments", "id"); await wipe("grades", "id");
  await wipe("enrollments", "id"); await wipe("students", "student_number"); await wipe("subjects", "id");
  await wipe("subject_categories", "id"); await wipe("comments", "id"); await wipe("announcements", "id");
  await wipe("pending_registrations", "id");

  const restoreOrder = ["subjects", "students", "enrollments", "grades", "comments", "announcements", "pending_registrations"];
  let restoredRows = 0;
  for (const table of restoreOrder) {
    const rows = t[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map((r: any) => {
        if (teacherId) return { ...r, teacher_id: teacherId };
        return r;
      });
      const { error } = await sb.from(table).insert(chunk);
      if (error) return { success: false, message: "Restore failed on " + table + " at row " + i + ": " + error.message };
      restoredRows += chunk.length;
    }
  }
  return { success: true, message: "Restored " + restoredRows + " rows." };
}

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
  const seen: Record<string, boolean> = {}; const list: any[] = [];
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
      try { if (row[9]) bd = JSON.parse(String(row[9])); } catch (e) {}
      list.push({
        student_number: String(row[0]), subject_name: subject,
        q1: row[3] === "" ? "" : String(row[3]), q2: row[4] === "" ? "" : String(row[4]),
        q3: row[5] === "" ? "" : String(row[5]), q4: row[6] === "" ? "" : String(row[6]),
        final: row[7] === "" ? "" : String(row[7]), remarks: String(row[8] || ""), breakdowns: bd
      });
    }
  });
  return list;
}