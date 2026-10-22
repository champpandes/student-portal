import { sb, json, stripTags, normalizeEmail, isValidEmail, hashPassword, verifyPassword, sha256, AuthContext } from "./utils.ts";

const SESSION_DAYS = 30;

export async function registerTeacher(p: any) {
  const email = normalizeEmail(p.email);
  const displayName = stripTags(String(p.displayName || "").trim()).slice(0, 120);
  const password = String(p.password || "");

  if (!email || !isValidEmail(email)) return { success: false, message: "Enter a valid email." };
  if (!displayName) return { success: false, message: "Enter your name." };
  if (password.length < 6) return { success: false, message: "Password must be at least 6 characters." };

  const countRes = await sb.from("teachers").select("id", { count: "exact", head: true });
  const isFirst = !countRes.count || countRes.count === 0;

  const existing = await sb.from("teachers").select("id").eq("email", email).limit(1);
  if (existing.data && existing.data.length > 0) return { success: false, message: "That email is already registered." };

  const { hash, salt } = await hashPassword(password);
  const now = new Date().toISOString();

  const payload: any = {
    email, display_name: displayName, password_hash: hash, password_salt: salt,
    role: isFirst ? "super_admin" : "teacher", status: isFirst ? "approved" : "pending",
    is_active: true, created_at: now
  };
  if (isFirst) payload.approved_at = now;

  const ins = await sb.from("teachers").insert(payload).select();
  if (ins.error) throw ins.error;
  const teacher = ins.data[0];

  if (isFirst) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await sb.from("teacher_sessions").insert({ token, teacher_id: teacher.id, expires_at: expiresAt });
    return { success: true, firstUser: true, sessionToken: token, teacher: publicTeacher(teacher) };
  }

  return { success: true, pending: true, message: "Your registration was submitted. A super admin will review it shortly." };
}

export async function teacherLogin(p: any) {
  const email = normalizeEmail(p.email);
  const password = String(p.password || "");
  if (!email || !password) return { success: false, message: "Enter your email and password." };

  const rows = await sb.from("teachers").select("*").eq("email", email).limit(1);
  if (!rows.data || rows.data.length === 0) return { success: false, message: "Invalid email or password." };

  const teacher = rows.data[0];
  const ok = await verifyPassword(password, teacher.password_hash, teacher.password_salt);
  if (!ok) return { success: false, message: "Invalid email or password." };

  if (teacher.status === "pending") return { success: false, pending: true, message: "Your registration is awaiting approval." };
  if (teacher.status === "rejected") return { success: false, rejected: true, message: "Your registration was not approved." };
  if (!teacher.is_active) return { success: false, message: "Your account has been deactivated." };

  await sb.from("teacher_sessions").delete().eq("teacher_id", teacher.id).lt("expires_at", new Date().toISOString());

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sess = await sb.from("teacher_sessions").insert({ token, teacher_id: teacher.id, expires_at: expiresAt });
  if (sess.error) throw sess.error;

  await sb.from("teachers").update({ last_login_at: new Date().toISOString() }).eq("id", teacher.id);
  return { success: true, sessionToken: token, teacher: publicTeacher(teacher) };
}

export async function teacherLogout(p: any) {
  const token = String(p.sessionToken || "").trim();
  if (token) await sb.from("teacher_sessions").delete().eq("token", token);
  return { success: true };
}

export async function getMe(auth: AuthContext) {
  if (!auth.teacher) return { success: true, legacy: true, teacher: null };
  return { success: true, teacher: publicTeacher(auth.teacher) };
}

export async function markWalkthroughSeen(auth: AuthContext) {
  if (auth.teacher) await sb.from("teachers").update({ has_seen_walkthrough: true }).eq("id", auth.teacher.id);
  return { success: true };
}

export function publicTeacher(t: any) {
  return {
    id: t.id, email: t.email, displayName: t.display_name, role: t.role, status: t.status,
    isActive: t.is_active, hasSeenWalkthrough: t.has_seen_walkthrough, createdAt: t.created_at, lastLoginAt: t.last_login_at
  };
}

export async function getPublicTeachers() {
  const rows = await sb.from("teachers").select("id, display_name").eq("status", "approved").eq("is_active", true).order("display_name", { ascending: true });
  return { success: true, teachers: (rows.data || []).map((r: any) => ({ id: r.id, displayName: r.display_name })) };
}

export async function adminLogin(p: any) {
  const input = String(p.pin || "");
  const deviceId = String(p.deviceId || "unknown").slice(0, 64);
  if (!input) return { success: false, message: "Enter your PIN." };

  const lockRows = await sb.from("login_attempts").select("*").eq("device_id", deviceId);
  const existing = (lockRows.data && lockRows.data.length) ? lockRows.data[0] : null;
  const now = new Date();

  if (existing && existing.locked_until && new Date(existing.locked_until) > now) {
    const secsLeft = Math.ceil((new Date(existing.locked_until).getTime() - now.getTime()) / 1000);
    const minsLeft = Math.ceil(secsLeft / 60);
    return { success: false, message: `Too many failed attempts. Try again in ${minsLeft} minute${minsLeft === 1 ? "" : "s"}.` };
  }

  const rows = await sb.from("settings").select("value").eq("key", "admin_pin_hash").limit(1);
  if (!rows.data || rows.data.length === 0) return { success: false, message: "Admin PIN not configured in database." };

  const hash = await sha256(input);
  if (hash === rows.data[0].value) {
    await sb.from("login_attempts").upsert({ device_id: deviceId, attempts: 0, locked_until: null, updated_at: now.toISOString() }, { onConflict: "device_id" });
    return { success: true };
  }

  const curAttempts = (existing?.attempts || 0) + 1;
  let lockedUntil: string | null = null;
  if (curAttempts >= 5) lockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  
  await sb.from("login_attempts").upsert({ device_id: deviceId, attempts: curAttempts, locked_until: lockedUntil, updated_at: now.toISOString() }, { onConflict: "device_id" });

  if (lockedUntil) return { success: false, message: "Too many failed attempts. Locked out for 15 minutes." };
  return { success: false, message: `Invalid PIN. ${5 - curAttempts} attempt${(5 - curAttempts) === 1 ? "" : "s"} remaining.` };
}