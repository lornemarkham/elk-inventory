import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAccess } from "../src/lib/familyAccess.ts";

test("access gate: only an explicit true from the database means 'member'", () => {
  assert.deepEqual(classifyAccess(true, null), { status: "member" });
  for (const v of [false, null, undefined, "true", 1, {}]) {
    assert.deepEqual(classifyAccess(v, null), { status: "not-member" }, String(v));
  }
});

test("access gate: a missing function means the access migration hasn't run; other errors stay errors", () => {
  assert.deepEqual(classifyAccess(null, { code: "PGRST202", message: "Could not find the function public.elk_is_family_member" }),
                   { status: "not-set-up" });
  assert.deepEqual(classifyAccess(null, { code: "42501", message: "permission denied" }),
                   { status: "error", error: "permission denied" });
  assert.deepEqual(classifyAccess(null, { message: "Failed to fetch" }), { status: "error", error: "Failed to fetch" });
});
