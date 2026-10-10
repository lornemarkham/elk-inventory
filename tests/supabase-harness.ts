// A Supabase-shaped Postgres for SQL tests (PGlite, in-process): the anon /
// authenticated roles, a stub auth schema with auth.uid() driven by the JWT
// claim setting, and Supabase's default privileges (API roles get ALL on new
// tables and functions in public; RLS and explicit REVOKEs decide the rest).
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export async function supabaseLikeDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT);
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
      $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
  `);
  return db;
}

export const runFile = (db: PGlite, path: string) => db.exec(readFileSync(path, "utf8"));

// Run as an API caller: uid = signed-in user (role authenticated, RLS applies),
// null = not signed in (role anon).
export function asUser(db: PGlite) {
  return async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
    await db.exec(uid ? "SET ROLE authenticated" : "SET ROLE anon");
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec("RESET ROLE");
    }
  };
}

export async function addMember(db: PGlite, uid: string, name: string) {
  await db.query("INSERT INTO public.elk_family_members (user_id, display_name) VALUES ($1, $2)", [uid, name]);
}
