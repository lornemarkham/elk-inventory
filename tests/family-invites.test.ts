// Family invitations (supabase-family-invites.sql) against PGlite shaped like
// production. OWNER is in; NEWBIE is invited; STRANGER is not.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";

const OWNER    = "00000000-0000-0000-0000-0000000000a1";
const NEWBIE   = "00000000-0000-0000-0000-0000000000b1";
const PWUSER   = "00000000-0000-0000-0000-0000000000b2";
const STRANGER = "00000000-0000-0000-0000-0000000000f1";

let db: PGlite;
let as: ReturnType<typeof asUser>;
const admin = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

before(async () => {
  db = await supabaseLikeDb();
  as = asUser(db);
  await db.exec(`
    ALTER TABLE auth.users ADD COLUMN encrypted_password TEXT, ADD COLUMN last_sign_in_at TIMESTAMPTZ;
    INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
      ('${OWNER}', 'owner@example.com', now()), ('${NEWBIE}', 'Kathy@Example.com', now()),
      ('${STRANGER}', 'stranger@example.com', now());
    INSERT INTO auth.users (id, email, encrypted_password, last_sign_in_at) VALUES ('${PWUSER}', 'pw@example.com', 'x', now());
  `);
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "tests/fixtures/legacy-open-policies.sql");
  await db.exec(`INSERT INTO inventory_items (id, name, quantity) VALUES ('t-drill-1', 'Cordless Drill', 1);`);
  await runFile(db, "supabase-family-access.sql");
  await addMember(db, OWNER, "Owner");
});

test("invites migration refuses to run before the access migration", async () => {
  const fresh = await supabaseLikeDb();
  await assert.rejects(runFile(fresh, "supabase-family-invites.sql"), /Run supabase-family-access.sql first/);
});

test("migration promotes the earliest member to owner, re-runs safely, keeps inventory", async () => {
  await runFile(db, "supabase-family-invites.sql");
  await runFile(db, "supabase-family-invites.sql");
  assert.deepEqual(await as(OWNER, "SELECT public.elk_is_family_owner() AS o"), [{ o: true }]);
  assert.equal((await admin("SELECT count(*)::int AS n FROM inventory_items"))[0].n, 1);
});

test("only the owner can invite, list or withdraw", async () => {
  for (const uid of [NEWBIE, STRANGER, null]) {
    await assert.rejects(as(uid, "SELECT * FROM elk_invite_family_member('x@example.com', 'X')"), /owner|permission denied/i);
    await assert.rejects(as(uid, "SELECT * FROM elk_list_family_invites()"), /owner|permission denied/i);
    await assert.rejects(as(uid, "SELECT elk_revoke_family_invite('x@example.com')"), /owner|permission denied/i);
  }
  await addMember(db, STRANGER, "Not owner");   // a plain member is still not an owner
  await assert.rejects(as(STRANGER, "SELECT * FROM elk_invite_family_member('x@example.com')"), /owner/i);
  await db.exec(`DELETE FROM elk_family_members WHERE user_id = '${STRANGER}'`);
});

test("invite table is invisible to API roles; bad emails rejected", async () => {
  await assert.rejects(as(OWNER, "SELECT * FROM elk_family_invites"), /permission denied/);
  await assert.rejects(as(null, "SELECT * FROM elk_family_invites"), /permission denied/);
  await assert.rejects(as(OWNER, "SELECT * FROM elk_invite_family_member('not-an-email')"), /does not look like an email/);
});

test("invited person (email case-insensitive) joins on first sign-in and then sees the family inventory", async () => {
  const [inv] = await as<{ email: string }>(OWNER, "SELECT * FROM elk_invite_family_member('  KATHY@example.com ', 'Kathy')");
  assert.equal(inv.email, "kathy@example.com");
  assert.equal((await as(NEWBIE, "SELECT * FROM inventory_items")).length, 0);          // invited ≠ in
  assert.deepEqual(await as(NEWBIE, "SELECT elk_claim_family_invite() AS r"), [{ r: "joined" }]);
  assert.deepEqual(await as(NEWBIE, "SELECT elk_claim_family_invite() AS r"), [{ r: "member" }]);
  assert.equal((await as(NEWBIE, "SELECT * FROM inventory_items")).length, 1);
  assert.equal((await as<{ display_name: string; is_owner: boolean }>(OWNER,
    `SELECT display_name, is_owner FROM elk_family_members WHERE user_id = '${NEWBIE}'`))[0].display_name, "Kathy");
  assert.equal((await as(NEWBIE, "SELECT * FROM elk_family_members WHERE is_owner")).length, 1);
  await assert.rejects(as(NEWBIE, "SELECT * FROM elk_invite_family_member('y@example.com')"), /owner/i);
});

test("an uninvited account, a signed-out caller and a password account get nothing", async () => {
  assert.deepEqual(await as(STRANGER, "SELECT elk_claim_family_invite() AS r"), [{ r: "none" }]);
  assert.equal((await as(STRANGER, "SELECT * FROM inventory_items")).length, 0);
  await assert.rejects(as(null, "SELECT elk_claim_family_invite()"), /permission denied/);
  await as(OWNER, "SELECT * FROM elk_invite_family_member('pw@example.com')");
  assert.deepEqual(await as(PWUSER, "SELECT elk_claim_family_invite() AS r"), [{ r: "none" }]);
  assert.equal((await as(PWUSER, "SELECT * FROM inventory_items")).length, 0);
});

test("expired and withdrawn invites cannot be claimed; the owner can list and re-invite", async () => {
  await db.exec(`UPDATE elk_family_invites SET expires_at = now() - interval '1 day' WHERE email = 'pw@example.com'`);
  await db.exec(`UPDATE auth.users SET encrypted_password = NULL WHERE id = '${PWUSER}'`);
  assert.deepEqual(await as(PWUSER, "SELECT elk_claim_family_invite() AS r"), [{ r: "none" }]);
  await as(OWNER, "SELECT * FROM elk_invite_family_member('pw@example.com')");            // refresh
  assert.equal((await as(OWNER, "SELECT * FROM elk_list_family_invites()")).length, 2);
  assert.deepEqual(await as(OWNER, "SELECT elk_revoke_family_invite('pw@example.com') AS r"), [{ r: true }]);
  assert.deepEqual(await as(PWUSER, "SELECT elk_claim_family_invite() AS r"), [{ r: "none" }]);
});
