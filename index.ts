// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
// into every edge function's environment by Supabase — no need to set
// them yourself as secrets.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const { data: positions, error: posErr } = await supabase
      .from("positions")
      .select("id, title, sort_order")
      .order("sort_order", { ascending: true });
    if (posErr) throw posErr;

    const { data: candidates, error: candErr } = await supabase
      .from("candidates")
      .select("id, position_id, name, tag");
    if (candErr) throw candErr;

    const ballot = (positions || []).map((pos: any) => ({
      id: pos.id,
      title: pos.title,
      sub: "Vote for one",
      candidates: (candidates || [])
        .filter((c: any) => c.position_id === pos.id)
        .map((c: any) => ({ id: c.id, name: c.name, tag: c.tag })),
    }));

    return jsonResponse(ballot, 200);
  } catch (_e) {
    return jsonResponse({ error: "Could not load ballot" }, 500);
  }
});
