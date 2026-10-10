import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { classifyAccess, type FamilyAccess } from "../lib/familyAccess";
import { C } from "../styles";
import LoginPage from "./LoginPage";

interface Props {
  children: React.ReactNode;
}

export default function AuthGate({ children }: Props) {
  const [user,    setUser]    = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [access,  setAccess]  = useState<FamilyAccess | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Check if there's an existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // React to sign-in / sign-out events (including magic link redirect)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Re-check whenever the signed-in account changes.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) { setAccess(null); return; }
    let cancelled = false;
    setAccess(null);
    supabase.rpc("elk_is_family_member").then(({ data, error }) => {
      if (!cancelled) setAccess(classifyAccess(data, error));
    });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  if (loading || (user && !access)) {
    return (
      <div style={{
        minHeight: "100vh",
        background: C.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Berkeley Mono', 'Fira Mono', monospace",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "24px", fontWeight: 900, color: C.amber, letterSpacing: "0.15em" }}>
            ELK
          </div>
          <div style={{ fontSize: "13px", color: C.textMid, marginTop: "8px" }}>
            Loading…
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (access?.status === "not-member" || access?.status === "error") {
    return (
      <div style={{
        minHeight: "100vh", background: C.bg, color: C.text,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <div style={{ maxWidth: "420px", width: "100%", padding: "0 24px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", fontWeight: 900, letterSpacing: "0.15em", color: C.amber, marginBottom: "20px" }}>
            ELK
          </div>
          {access.status === "not-member" ? (
            <>
              <h2 style={{ margin: "0 0 10px", fontSize: "20px" }}>You're not on the family list yet</h2>
              <p style={{ margin: "0 0 20px", color: C.textMid, lineHeight: 1.6 }}>
                You're signed in as <strong>{user.email}</strong>. Ask whoever runs ELK to add this
                email, then reload this page.
              </p>
            </>
          ) : (
            <>
              <h2 style={{ margin: "0 0 10px", fontSize: "20px" }}>Couldn't check your access</h2>
              <p style={{ margin: "0 0 20px", color: C.textMid, lineHeight: 1.6 }}>{access.error}</p>
              <button onClick={() => setAttempt(n => n + 1)} style={gateBtn}>Try again</button>{" "}
            </>
          )}
          <button onClick={() => supabase.auth.signOut()} style={gateBtn}>Sign out</button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

const gateBtn: React.CSSProperties = {
  background: "transparent", border: `1px solid ${C.border}`, color: C.textMid,
  borderRadius: "6px", padding: "8px 14px", fontSize: "14px", cursor: "pointer",
};
