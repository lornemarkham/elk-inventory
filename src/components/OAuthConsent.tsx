import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { C } from "../styles";

// Where Supabase's OAuth server sends a signed-in person to approve an app
// (ChatGPT, for the Inventory connector). Configure it in Supabase →
// Authentication → OAuth Server → Authorization path = /oauth/consent.
// This page sits inside AuthGate, so only an ELK family member gets here.

interface Details {
  authorization_id: string;
  redirect_uri?: string;
  client: { name?: string; uri?: string };
  user: { email: string };
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authId = params.get("authorization_id");
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authId) { setError("This page needs an authorization request from an app. Start the connection from ChatGPT."); return; }
    let cancelled = false;
    supabase.auth.oauth.getAuthorizationDetails(authId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) { setError(error?.message ?? "That request has expired. Start the connection again from ChatGPT."); return; }
      // Already approved earlier: the server hands back where to send the browser.
      if ("redirect_url" in data) { window.location.assign(data.redirect_url); return; }
      setDetails(data as Details);
    });
    return () => { cancelled = true; };
  }, [authId]);

  async function decide(approve: boolean) {
    if (!authId) return;
    setBusy(true);
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authId, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) { setError(error?.message ?? "Something went wrong."); setBusy(false); return; }
    window.location.assign(data.redirect_url);
  }

  const btn = (bg: string): React.CSSProperties => ({ background: bg, color: C.text, border: "none", borderRadius: 8, padding: "14px 20px", fontSize: 16, fontWeight: 700, cursor: busy ? "wait" : "pointer", flex: 1 });

  return (
    <div style={{ maxWidth: 480, margin: "48px auto", padding: "0 20px", color: C.text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <h1 style={{ color: C.amber, fontSize: 22 }}>Connect an app to ELK Inventory</h1>
      {error && <p style={{ color: C.red }}>{error}</p>}
      {!error && !details && <p style={{ color: C.textMid }}>Loading…</p>}
      {details && (
        <>
          <p><strong>{details.client.name ?? "An app"}</strong> wants to use your ELK Inventory as <strong>{details.user.email}</strong>.</p>
          {details.redirect_uri && (
            <p style={{ color: C.textMid, fontSize: 14 }}>
              After you choose, you'll be sent back to <strong>{new URL(details.redirect_uri).host}</strong>. Only continue if you just started
              this from ChatGPT (it should be <strong>chatgpt.com</strong>).
            </p>
          )}
          <p style={{ color: C.textMid }}>
            It will be able to search the inventory and shopping list, and add items, change quantities and add shopping entries
            as you. Big or destructive changes still ask you first. You can disconnect it later in ChatGPT's connector settings.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <button disabled={busy} style={btn(C.bgCard)} onClick={() => decide(false)}>Cancel</button>
            <button disabled={busy} style={btn(C.green)} onClick={() => decide(true)}>Allow</button>
          </div>
        </>
      )}
    </div>
  );
}
