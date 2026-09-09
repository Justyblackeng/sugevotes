// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { checkAdminKey } from "../_shared/admin.ts";
import { getPollSettings } from "../_shared/settings.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const authFail = checkAdminKey(req);
  if (authFail) return authFail;

  try {
    const settings = await getPollSettings(supabase);

    const { count: turnout, error: turnoutErr } = await supabase
      .from("voted_log")
      .select("matric", { count: "exact", head: true });
    if (turnoutErr) throw turnoutErr;

    const { count: rollCount, error: rollErr } = await supabase
      .from("voter_roll")
      .select("matric", { count: "exact", head: true });
    if (rollErr) throw rollErr;

    const rollLoaded = !!rollCount && rollCount > 0;
    const totalRoll = rollLoaded
      ? rollCount
      : Number(Deno.env.get("TOTAL_ROLL_FALLBACK") || 320);

    const { data: positions, error: posErr } = await supabase
      .from("positions")
      .select("id, title, sort_order")
      .order("sort_order", { ascending: true });
    if (posErr) throw posErr;

    const { data: candidates, error: candErr } = await supabase
      .from("candidates")
      .select("id, position_id, name, tag");
    if (candErr) throw candErr;

    const { data: votes, error: voteErr } = await supabase
      .from("votes")
      .select("position_id, candidate_id");
    if (voteErr) throw voteErr;

    const tally: Record<string, number> = {};
    (votes || []).forEach((v: any) => {
      const key = `${v.position_id}:${v.candidate_id}`;
      tally[key] = (tally[key] || 0) + 1;
    });

    const results = (positions || []).map((pos: any) => ({
      id: pos.id,
      title: pos.title,
      sortOrder: pos.sort_order,
      candidates: (candidates || [])
        .filter((c: any) => c.position_id === pos.id)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          tag: c.tag,
          votes: tally[`${pos.id}:${c.id}`] || 0,
        })),
    }));

    return jsonResponse({
      ok: true,
      now: new Date().toISOString(),
      settings: {
        pollOpenAt: settings.pollOpenAt,
        pollCloseAt: settings.pollCloseAt,
        resultsPublic: settings.resultsPublic,
      },
      turnout: turnout || 0,
      totalRoll,
      rollLoaded,
      results,
    }, 200);
  } catch (_e) {
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
});
