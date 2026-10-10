// ── Family access ─────────────────────────────────────────────────────────────
// Who may use ELK is decided by the database (public.elk_family_members, see
// supabase-family-access.sql). This only reads the answer so a signed-in
// stranger sees "not on the family list" instead of an empty inventory —
// hiding the UI is a courtesy, not the protection.

export type FamilyAccess =
  | { status: "member" }
  | { status: "not-member" }
  // supabase-family-access.sql hasn't been run yet: the database still has
  // its old rules, so the app behaves exactly as before (Pantry stays off,
  // because its migration refuses to run before this one).
  | { status: "not-set-up" }
  | { status: "error"; error: string };

export function classifyAccess(
  data: unknown,
  error: { code?: string; message?: string } | null,
): FamilyAccess {
  if (error) {
    // PGRST202 = PostgREST can't find the function.
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
      return { status: "not-set-up" };
    }
    return { status: "error", error: error.message ?? "Unknown error" };
  }
  return data === true ? { status: "member" } : { status: "not-member" };
}
