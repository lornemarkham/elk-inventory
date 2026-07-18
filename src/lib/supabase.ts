import { createClient } from "@supabase/supabase-js";

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function assertAnonKey(key: string): void {
  try {
    const payload = JSON.parse(atob(key.split(".")[1] ?? ""));
    if (payload.role === "service_role") {
      throw new Error(
        "VITE_SUPABASE_ANON_KEY is set to the service_role (secret) key. " +
        "Use the anon / publishable key from Supabase → Settings → API."
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("service_role")) throw e;
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "[ELK] Missing Supabase env vars.\n" +
    "Copy .env.example → .env.local and fill in your project URL + anon key."
  );
} else {
  assertAnonKey(supabaseAnonKey);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
