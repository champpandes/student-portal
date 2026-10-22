import { sb, scopeByTeacher, stripTags, AuthContext } from "./utils.ts";

export async function getPendingRegistrationsScoped(auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  let q = sb.from("pending_registrations").select("*").order("id", { ascending: false });
  q = scopeByTeacher(q, teacherId);
  const rows = await q;

  const pending: any[] = [], history: any[] = [];
  (rows.data || []).forEach((r: any) => {
    const item = { timestamp: r.timestamp || "", studentNumber: r.student_number || "", name: r.name || "", section: r.section || "", subjects: Array.isArray(r.enrolled_subjects) ? r.enrolled_subjects : [], status: r.status || "pending", reviewedAt: r.reviewed_at || "", teacherId: r.teacher_id || null };
    (item.status === "pending" ? pending : history).push(item);
  });
  return { success: true, pending, history };
}

export async function approveRegistration(p: any, auth: AuthContext) {
  if (auth.teacher && auth.teacher.role !== 'super_admin') return { success: false, message: "Only the Super Admin can approve registrations." };

  const sNo = String(p.studentNumber || "");
  const section = stripTags(String(p.section || "").trim());
  const teacherId = auth.teacher?.id || null;
  if (!section) return { success: false, message: "Section is required." };

  let prQuery = sb.from("pending_registrations").select("*").eq("student_number", sNo).eq("status", "pending");
  if (teacherId) prQuery = prQuery.eq("teacher_id", teacherId);
  const pRows = await prQuery;
  if (!pRows.data || pRows.data.length === 0) return { success: false, message: "Pending registration not found." };
  
  const pr = pRows.data[0];
  const studentPayload: any = { student_number: sNo, name: pr.name, section };
  if (teacherId) studentPayload.teacher_id = teacherId;
  const sRes = await sb.from("students").upsert(studentPayload, { onConflict: "student_number" });
  if (sRes.error) return { success: false, message: "Could not create student: " + sRes.error.message };

  const { error: upErr } = await sb.from("pending_registrations").update({ section, enrolled_subjects: [], status: "approved", reviewed_at: new Date().toISOString() }).eq("id", pr.id);
  if (upErr) return { success: false, message: "Could not finalize approval: " + upErr.message };
  return { success: true, studentNumber: sNo, message: pr.name + " approved. Assign subjects from the Manage menu." };
}

export async function rejectRegistration(p: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  let query = sb.from("pending_registrations").select("id").eq("student_number", String(p.studentNumber)).eq("status", "pending");
  if (teacherId) query = query.eq("teacher_id", teacherId);
  const rows = await query;
  if (!rows.data || rows.data.length === 0) return { success: false, message: "Pending registration not found." };
  
  const { error } = await sb.from("pending_registrations").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", rows.data[0].id);
  if (error) throw error;
  return { success: true };
}

export async function getCommentsScoped(auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  let q = sb.from("comments").select("*").order("id", { ascending: true });
  q = scopeByTeacher(q, teacherId);
  const rows = await q;
  return { success: true, comments: (rows.data || []).map((r: any) => ({ timestamp: r.timestamp || "", studentNumber: r.student_number || "", studentName: r.student_name || "", text: r.comment_text || "" })) };
}

export async function postComment(p: any, auth: AuthContext) {
  const sNo = String(p.studentNumber || "UNKNOWN");
  const text = stripTags(String(p.commentText || "").trim());
  if (!text) return { success: true };

  let name = "Teacher Admin";
  if (sNo !== "TEACHER_ADMIN") {
    name = "Student";
    const rows = await sb.from("students").select("name").eq("student_number", sNo);
    if (rows.data && rows.data.length && rows.data[0].name) name = rows.data[0].name;
  }

  const payload: any = { timestamp: new Date().toISOString(), student_number: sNo, student_name: stripTags(name), comment_text: text };
  if (auth.teacher) payload.teacher_id = auth.teacher.id;

  const { error } = await sb.from("comments").insert(payload);
  if (error) throw error;
  return { success: true };
}

export async function clearComments(auth: AuthContext) {
  let query = sb.from("comments").delete().gt("id", 0);
  if (auth.teacher) query = query.eq("teacher_id", auth.teacher.id);
  const { error } = await query;
  if (error) throw error;
  return { success: true };
}

export async function getAnnouncementScoped(p: any, auth: AuthContext) {
  const teacherId = auth.teacher?.id || String(p?.teacherId || "").trim() || null;
  let query = sb.from("announcements").select("*").eq("is_active", true).order("id", { ascending: false }).limit(1);
  query = scopeByTeacher(query, teacherId);
  const rows = await query;
  if (rows.data && rows.data.length > 0) return { success: true, message: rows.data[0].message || "", timestamp: rows.data[0].timestamp || "", postedBy: rows.data[0].posted_by || "" };
  return { success: true, message: "" };
}

export async function getAnnouncementHistoryScoped(auth: AuthContext) {
  const teacherId = auth.teacher?.id || null;
  let q = sb.from("announcements").select("*").order("id", { ascending: false });
  q = scopeByTeacher(q, teacherId);
  const rows = await q;
  return { success: true, history: (rows.data || []).map((r: any) => ({ rowIndex: r.id, timestamp: r.timestamp || "", message: r.message || "", postedBy: r.posted_by || "", active: !!r.is_active })) };
}

export async function saveAnnouncement(p: any, auth: AuthContext) {
  const msg = stripTags(String(p.message || "").trim());
  if (!msg) return { success: false, message: "Announcement cannot be empty." };

  let deactivate = sb.from("announcements").update({ is_active: false }).eq("is_active", true);
  if (auth.teacher) deactivate = deactivate.eq("teacher_id", auth.teacher.id);
  await deactivate;

  const ts = new Date().toISOString();
  const payload: any = { timestamp: ts, message: msg, posted_by: "TEACHER_ADMIN", is_active: true };
  if (auth.teacher) payload.teacher_id = auth.teacher.id;

  const { error } = await sb.from("announcements").insert(payload);
  if (error) throw error;
  return { success: true, timestamp: ts, message: msg };
}

export async function deleteAnnouncement(p: any, auth: AuthContext) {
  const id = Number(p.rowIndex);
  if (!id) return { success: false, message: "Invalid id." };
  let query = sb.from("announcements").delete().eq("id", id);
  if (auth.teacher) query = query.eq("teacher_id", auth.teacher.id);
  const { error } = await query;
  if (error) throw error;
  return { success: true };
}