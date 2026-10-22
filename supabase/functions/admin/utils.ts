import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface AuthContext {
  teacher: any;
  legacy: boolean;
}

export function json(data: any, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

export function scopeByTeacher(query: any, teacherId: string | null) {
  if (!teacherId) return query;
  return query.or(`teacher_id.eq.${teacherId},teacher_id.is.null`);
}

export function stripTags(s: any) { return String(s ?? "").replace(/[<>]/g, ""); }
export function normalizeEmail(s: any) { return String(s || "").trim().toLowerCase(); }
export function isValidEmail(s: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

export function determineRemarks(f: any): string {
  if (f === "" || f === null || isNaN(f)) return "";
  return Number(f) >= 75 ? "Passed" : "Failed";
}

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

export function transmuteGrade(score: any): number | "" {
  if (score === "" || score === null || isNaN(score)) return "";
  const s = Number(score);
  if (s >= 100) return 100;
  for (const [lo, hi] of TRANSMUTATION) {
    if (s >= lo) return hi;
  }
  return 60;
}

export function computeWeightedFinal(q1: any, q2: any, q3: any, q4: any, quarterWeights: any): number | "" {
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

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password),
    { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  try {
    const { hash: computed } = await hashPassword(password, salt);
    if (computed.length !== hash.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(buf));
}

export async function resolveAuth(body: any): Promise<AuthContext | null> {
  const token = String(body?.sessionToken || "").trim();
  if (token) {
    const rows = await sb.from("teacher_sessions").select("teacher_id, expires_at").eq("token", token).limit(1);
    if (rows.data && rows.data.length > 0) {
      const session = rows.data[0];
      if (new Date(session.expires_at) > new Date()) {
        const tRes = await sb.from("teachers").select("*").eq("id", session.teacher_id).limit(1);
        if (tRes.data && tRes.data.length > 0) {
          const teacher = tRes.data[0];
          if (teacher.is_active && teacher.status === "approved") {
            return { teacher, legacy: false };
          }
        }
      }
    }
  }

  const pin = String(body?.pin || "").trim();
  if (pin) {
    const pinRows = await sb.from("settings").select("value").eq("key", "admin_pin_hash").limit(1);
    if (pinRows.data && pinRows.data.length > 0) {
      const hash = await sha256(pin);
      if (hash === pinRows.data[0].value) {
        const saRes = await sb.from("teachers").select("*").eq("role", "super_admin").eq("status", "approved").eq("is_active", true).limit(1);
        const teacher = (saRes.data && saRes.data.length > 0) ? saRes.data[0] : null;
        return { teacher, legacy: true };
      }
    }
  }

  return null;
}

export function requireSuperAdmin(auth: AuthContext | null): boolean {
  if (!auth || !auth.teacher) return false;
  return auth.teacher.role === "super_admin";
}

export async function sbGet(table: string, query: string) {
  const url = new URL(SUPABASE_URL + "/rest/v1/" + table + (query ? "?" + query : ""));
  const res = await fetch(url.toString(), {
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) return [];
  try { return await res.json(); } catch { return []; }
}