import { sb, hashPassword, AuthContext } from "./utils.ts";

export async function listTeachers() {
  const rows = await sb.from("teachers").select("*").order("created_at", { ascending: false });
  return { success: true, teachers: (rows.data || []).map((t: any) => ({
    id: t.id, email: t.email, displayName: t.display_name, role: t.role, status: t.status,
    isActive: t.is_active, createdAt: t.created_at, approvedAt: t.approved_at, lastLoginAt: t.last_login_at
  }))};
}

export async function approveTeacher(p: any, auth: AuthContext) {
  const { error } = await sb.from("teachers").update({ status: "approved", role: p.role || "teacher", approved_at: new Date().toISOString(), approved_by: auth.teacher.id }).eq("id", p.teacherId);
  if (error) throw error;
  return { success: true };
}

export async function rejectTeacher(p: any) {
  const { error } = await sb.from("teachers").update({ status: "rejected" }).eq("id", p.teacherId);
  if (error) throw error;
  return { success: true };
}

export async function setTeacherRole(p: any) {
  if (p.role === "teacher") {
    const current = await sb.from("teachers").select("role").eq("id", p.teacherId).limit(1);
    if (current.data?.[0]?.role === "super_admin") {
      const others = await sb.from("teachers").select("id", { count: "exact", head: true }).eq("role", "super_admin").neq("id", p.teacherId);
      if (!others.count) return { success: false, message: "Cannot demote the last super admin." };
    }
  }
  const { error } = await sb.from("teachers").update({ role: p.role }).eq("id", p.teacherId);
  if (error) throw error;
  return { success: true };
}

export async function setTeacherActive(p: any) {
  const { error } = await sb.from("teachers").update({ is_active: p.isActive }).eq("id", p.teacherId);
  if (error) throw error;
  if (!p.isActive) await sb.from("teacher_sessions").delete().eq("teacher_id", p.teacherId);
  return { success: true };
}

export async function resetTeacherPassword(p: any) {
  const { hash, salt } = await hashPassword(p.password);
  const { error } = await sb.from("teachers").update({ password_hash: hash, password_salt: salt }).eq("id", p.teacherId);
  if (error) throw error;
  await sb.from("teacher_sessions").delete().eq("teacher_id", p.teacherId);
  return { success: true };
}

export async function deleteTeacher(p: any, auth: AuthContext) {
  if (p.teacherId === auth.teacher.id) return { success: false, message: "You cannot delete your own account." };
  const { error } = await sb.from("teachers").delete().eq("id", p.teacherId);
  if (error) throw error;
  return { success: true };
}