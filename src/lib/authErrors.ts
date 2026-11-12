// ── Sign-in error messages ────────────────────────────────────────────────────
// Supabase errors can arrive as an Error, a plain object, a string, or an empty
// object. Showing one raw produced a red box saying "{}". Everything here ends
// in a sentence a family member can act on.

type Shape = { message?: unknown; msg?: unknown; error_description?: unknown; code?: unknown; error_code?: unknown; status?: unknown; name?: unknown };

const GENERIC = "Something went wrong sending your sign-in link. Please try again in a minute.";

export function describeAuthError(err: unknown): string {
  const e: Shape = typeof err === "object" && err !== null ? err as Shape : {};
  const text = [typeof err === "string" ? err : "", e.message, e.msg, e.error_description]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "").join(" ");
  const code = String(e.code ?? e.error_code ?? "");
  const status = Number(e.status ?? 0);

  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429 || /rate limit|too many/i.test(text))
    return "Too many sign-in emails were requested. Wait a few minutes, then use the newest email.";
  if (code === "otp_expired" || /expired|invalid.*(link|token)/i.test(text))
    return "That sign-in link has expired or was already used. Request a new one below and open only the newest email.";
  if (code === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(text))
    return "That email address doesn't look right. Check it and try again.";
  if (code === "signup_disabled" || /signups? not allowed/i.test(text))
    return "This email can't sign in yet. Ask whoever runs ELK to invite it.";
  if (/database error saving new user/i.test(text) || code === "unexpected_failure" || status >= 500)
    return "We couldn't set up your account just now. This is a problem on our side, not yours. Wait a minute and try again, and if it keeps happening tell whoever runs ELK.";
  if (e.name === "AuthRetryableFetchError" || status === 0 && /fetch|network|load failed/i.test(text) || /failed to fetch|network|load failed/i.test(text))
    return "Couldn't reach the sign-in service. Check your connection and try again.";
  if (/error sending|smtp|email.*(not|couldn).*sen|sending.*email/i.test(text))
    return "The sign-in email couldn't be sent. Check the address and try again in a minute.";
  return text ? `Sign-in failed: ${text}` : GENERIC;
}

// Supabase reports a bad emailed link in the URL fragment (or query), e.g.
//   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
export function linkErrorFromUrl(hash: string, search = ""): string | null {
  const p = new URLSearchParams(hash.replace(/^#/, "") || search.replace(/^\?/, ""));
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const error = p.get("error") ?? q.get("error");
  if (!error) return null;
  return describeAuthError({
    error_code: p.get("error_code") ?? q.get("error_code"),
    error_description: p.get("error_description") ?? q.get("error_description") ?? error,
  });
}
