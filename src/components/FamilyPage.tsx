import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { C } from "../styles";

// ── Family ─────────────────────────────────────────────────────────────────────
// The owner invites family by email; the invited person signs in with an emailed
// link on the login screen and is added automatically (supabase-family-invites.sql).
// All checks happen in the database; this page is only the form.

interface Invite { email: string; display_name: string | null; invited_at: string; expires_at: string; claimed_at: string | null }

const input: React.CSSProperties = {
  fontSize: "16px", padding: "12px 14px", borderRadius: "8px", border: `1px solid ${C.border}`,
  background: C.bgInput, color: C.text, fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  background: C.amber, border: "none", borderRadius: "8px", color: "#1c1a17", fontSize: "15px",
  fontWeight: 700, padding: "12px 18px", cursor: "pointer", fontFamily: "inherit",
};

export default function FamilyPage() {
  const [owner,   setOwner]   = useState<boolean | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email,   setEmail]   = useState("");
  const [name,    setName]    = useState("");
  const [busy,    setBusy]    = useState(false);
  const [note,    setNote]    = useState<{ text: string; bad?: boolean } | null>(null);

  const load = useCallback(async () => {
    const own = await supabase.rpc("elk_is_family_owner");
    if (own.error) { setOwner(false); setNote({ text: "Invitations aren't switched on yet. The owner needs to run supabase-family-invites.sql (see docs/family-access.md).", bad: true }); return; }
    setOwner(own.data === true);
    if (own.data !== true) return;
    const list = await supabase.rpc("elk_list_family_invites");
    if (list.error) setNote({ text: list.error.message || "Couldn't load invitations.", bad: true });
    else setInvites((list.data ?? []) as Invite[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setNote(null);
    const { error } = await supabase.rpc("elk_invite_family_member", { p_email: email, p_name: name || null });
    setBusy(false);
    if (error) { setNote({ text: error.message || "Couldn't save the invitation. Try again.", bad: true }); return; }
    setNote({ text: `Invited ${email.trim().toLowerCase()}. Tell them to open ${window.location.origin} on their phone, type that email, and tap the link we send them.` });
    setEmail(""); setName("");
    await load();
  }

  async function withdraw(addr: string) {
    const { error } = await supabase.rpc("elk_revoke_family_invite", { p_email: addr });
    if (error) setNote({ text: error.message || "Couldn't withdraw that invitation.", bad: true });
    await load();
  }

  const status = (i: Invite) => i.claimed_at ? "Joined" : new Date(i.expires_at) < new Date() ? "Expired — invite again" : "Waiting for them to sign in";

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px", color: C.text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <h2 style={{ margin: "0 0 6px" }}>Family</h2>
      {owner === null && <p style={{ color: C.textMid }}>Loading…</p>}
      {owner === false && !note && <p style={{ color: C.textMid }}>Only the ELK owner can invite people. Ask them to add your email.</p>}
      {owner && (
        <>
          <p style={{ color: C.textMid, lineHeight: 1.6, margin: "0 0 16px" }}>
            Invite someone by email. They sign in with an emailed link, no password, and then see the same inventory as you.
          </p>
          <form onSubmit={invite} style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
            <input style={input} type="email" required placeholder="their@email.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" />
            <input style={input} type="text" maxLength={60} placeholder="Name (shown in history)" value={name} onChange={e => setName(e.target.value)} />
            <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy || !email.trim()} type="submit">{busy ? "Inviting…" : "Send invitation"}</button>
          </form>
        </>
      )}
      {note && (
        <div style={{ background: note.bad ? "#3d1515" : C.bgCard, border: `1px solid ${note.bad ? "#7a2020" : C.border}`, color: note.bad ? "#f87171" : C.text, borderRadius: "8px", padding: "10px 14px", lineHeight: 1.5, marginBottom: "16px", fontSize: "14px" }}>
          {note.text}
        </div>
      )}
      {owner && invites.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: "15px", color: C.textMid }}>Invitations</h3>
          {invites.map(i => (
            <div key={i.email} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ overflowWrap: "anywhere" }}>{i.display_name ? `${i.display_name} · ` : ""}{i.email}</div>
                <div style={{ fontSize: "12px", color: C.textMid }}>{status(i)}</div>
              </div>
              {!i.claimed_at && (
                <button onClick={() => void withdraw(i.email)} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMid, borderRadius: "6px", padding: "6px 10px", cursor: "pointer" }}>Withdraw</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
