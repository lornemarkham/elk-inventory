import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAuthError, linkErrorFromUrl } from "../src/lib/authErrors";

test("an empty object never becomes '{}'", () => {
  for (const v of [{}, null, undefined, "", { message: "" }, []]) {
    const m = describeAuthError(v);
    assert.doesNotMatch(m, /^\{/);
    assert.match(m, /try again/i);
  }
});
test("the production sign-up failure reads as our problem, not the user's", () => {
  assert.match(describeAuthError({ code: 500, error_code: "unexpected_failure", msg: "Database error saving new user" }), /our side/);
  assert.match(describeAuthError({ message: "Database error saving new user", status: 500 }), /our side/);
});
test("rate limit, bad email, expired, network, signup disabled", () => {
  assert.match(describeAuthError({ code: "over_email_send_rate_limit", status: 429, message: "x" }), /Wait a few minutes/);
  assert.match(describeAuthError({ message: "Unable to validate email address: invalid format" }), /doesn't look right/);
  assert.match(describeAuthError({ code: "otp_expired" }), /expired or was already used/);
  assert.match(describeAuthError(new TypeError("Failed to fetch")), /Couldn't reach/);
  assert.match(describeAuthError({ message: "Signups not allowed for otp" }), /invite/);
});
test("unknown errors keep their text", () => {
  assert.equal(describeAuthError(new Error("boom")), "Sign-in failed: boom");
});
test("expired-link redirect in the URL fragment is explained", () => {
  const m = linkErrorFromUrl("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.match(m ?? "", /expired or was already used/);
  assert.equal(linkErrorFromUrl("#access_token=abc&type=magiclink"), null);
  assert.equal(linkErrorFromUrl("", ""), null);
});
