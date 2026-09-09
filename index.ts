import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const { count: turnout, error: turnoutErr } = await supabase
      .from("voted_log")
      .select("matric", { count: "exact", head: true });
    if (turnoutErr) throw turnoutErr;

    const { count: rollCount, error: rollErr } = await supabase
      .from("voter_roll")
      .select("matric", { count: "exact", head: true });
    if (rollErr) throw rollErr;

    // TOTAL_ROLL_FALLBACK is a plain function secret, same idea as the
    // Netlify env var it replaces.
    const totalRoll = rollCount && rollCount > 0
      ? rollCount
      : Number(Deno.env.get("TOTAL_ROLL_FALLBACK") || 320);

    return jsonResponse({ turnout: turnout || 0, totalRoll }, 200);
  } catch (_e) {
    return jsonResponse({ error: "server_error" }, 500);
  }
});
