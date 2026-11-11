import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { buildHandoffUrl, parseReturnUrl } from "../lib/connectWrench";
import { C } from "../styles";

// Hands the signed-in session to ELK Wrench. Sits inside AuthGate, so only a
// signed-in family member reaches it. The return URL must be allow-listed.

export default function ConnectWrench() {
  const [params] = useSearchParams();
  const returnUrl = parseReturnUrl(params.get("return"), import.meta.env.DEV);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (!returnUrl) return;
    setBusy(true);
    let { data, error } = await supabase.auth.getSession();
    // Wrench only gets the access token (src/lib/connectWrench.ts), so give it a fresh one: close to a full hour.
    if (!error && data.session && (data.session.expires_at ?? 0) * 1000 < Date.now() + 30 * 60_000) ({ data, error } = await supabase.auth.refreshSession());
    const s = data.session;
    if (error || !s) { setError(error?.message ?? "You're not signed in."); setBusy(false); return; }
    window.location.assign(buildHandoffUrl(returnUrl, {
      access_token: s.access_token,
      expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in,
    }));
  }

  function cancel() {
    if (returnUrl) window.location.assign(returnUrl.href);
    else window.location.assign("/");
  }

  const btn = (bg: string): React.CSSProperties => ({ background: bg, color: C.text, border: "none", borderRadius: 8, padding: "14px 20px", fontSize: 16, fontWeight: 700, cursor: busy ? "wait" : "pointer", flex: 1 });

  return (
    <div style={{ maxWidth: 480, margin: "48px auto", padding: "0 20px", color: C.text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <h1 style={{ color: C.amber, fontSize: 22 }}>Connect ELK Wrench to your Inventory?</h1>
      {!returnUrl ? (
        <p style={{ color: C.red }}>This link isn't from ELK Wrench, so it was refused. Open the connect button inside Wrench instead.</p>
      ) : (
        <>
          <p style={{ color: C.textMid }}>
            It will read items, add shopping-list drafts, and record supplies you confirm using.
            Wrench never changes quantities on its own.
          </p>
          <p style={{ color: C.textMid, fontSize: 14 }}>The connection lasts about an hour; after that Wrench asks you to connect again.</p>
          <p style={{ color: C.textMid, fontSize: 14 }}>You'll be sent back to <strong>{returnUrl.host}</strong>.</p>
          {error && <p style={{ color: C.red }}>{error}</p>}
          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <button disabled={busy} style={btn(C.bgCard)} onClick={cancel}>Cancel</button>
            <button disabled={busy} style={btn(C.green)} onClick={connect}>Connect</button>
          </div>
        </>
      )}
    </div>
  );
}
