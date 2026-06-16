import { useState } from "react";
import { supabase } from "../lib/supabase";
import { C } from "../styles";

export default function LoginPage() {
  const [email,   setEmail]   = useState("");
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: "400px", width: "100%", padding: "0 24px" }}>

        {/* Branding */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{
            fontSize: "40px",
            fontWeight: 900,
            letterSpacing: "0.15em",
            color: C.amber,
            marginBottom: "8px",
          }}>
            ELK
          </div>
          <div style={{ fontSize: "12px", color: C.textMid, letterSpacing: "0.12em", fontWeight: 600 }}>
            LIFE INVENTORY SYSTEM
          </div>
          <div style={{
            marginTop: "10px",
            fontSize: "13px",
            color: C.textMid,
            fontStyle: "italic",
          }}>
            Reduce friction. Increase capability. Create calm.
          </div>
        </div>

        {sent ? (
          /* ── Magic link sent ── */
          <div style={{
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            borderRadius: "10px",
            padding: "32px 28px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "32px", marginBottom: "14px" }}>📬</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: C.text, marginBottom: "10px" }}>
              Check your inbox
            </div>
            <div style={{ fontSize: "14px", color: C.textMid, lineHeight: 1.6 }}>
              Magic link sent to<br />
              <strong style={{ color: C.text }}>{email}</strong>
            </div>
            <div style={{ marginTop: "16px", fontSize: "13px", color: C.textMid, lineHeight: 1.6 }}>
              Click the link in the email to sign in.<br />No password needed.
            </div>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              style={{
                marginTop: "20px",
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: "6px",
                color: C.textMid,
                fontSize: "13px",
                padding: "8px 16px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          /* ── Login form ── */
          <div style={{
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            borderRadius: "10px",
            padding: "32px 28px",
          }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: C.text, marginBottom: "6px" }}>
              Sign in with a magic link
            </div>
            <div style={{ fontSize: "13px", color: C.textMid, marginBottom: "22px", lineHeight: 1.6 }}>
              Enter your email — we'll send a one-click sign-in link. No password needed.
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoFocus
                style={{
                  background: C.bgInset,
                  border: `1px solid ${C.border}`,
                  borderRadius: "6px",
                  color: C.text,
                  fontSize: "14px",
                  padding: "11px 14px",
                  fontFamily: "inherit",
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />

              {error && (
                <div style={{
                  background: "#3d1515",
                  border: "1px solid #7a2020",
                  borderRadius: "6px",
                  color: "#f87171",
                  fontSize: "13px",
                  padding: "10px 14px",
                  lineHeight: 1.5,
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim()}
                style={{
                  background: loading || !email.trim() ? C.border : C.amber,
                  border: "none",
                  borderRadius: "6px",
                  color: loading || !email.trim() ? C.textMid : "#1c1a17",
                  fontSize: "14px",
                  fontWeight: 700,
                  padding: "12px 16px",
                  cursor: loading || !email.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "0.02em",
                  transition: "background 0.15s",
                }}
              >
                {loading ? "Sending…" : "Send magic link →"}
              </button>
            </form>
          </div>
        )}

        <div style={{
          marginTop: "20px",
          textAlign: "center",
          fontSize: "12px",
          color: C.textDim,
        }}>
          Private inventory — by invite only
        </div>
      </div>
    </div>
  );
}
