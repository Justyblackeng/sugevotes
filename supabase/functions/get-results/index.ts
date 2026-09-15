// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { getPollSettings, isPollClosed } from "../_shared/settings.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const settings = await getPollSettings(supabase);

    // Defaults to visible if the setting row is missing, so the demo
    // works out of the box. Set results_public to 'false' in the
    // election_settings table to hide results until polls close.
    // Once poll_close_at passes, results are revealed regardless of
    // results_public.
    const resultsPublic = settings.resultsPublic || isPollClosed(settings);

    if (!resultsPublic) {
      return jsonResponse({ visible: false, pollCloseAt: settings.pollCloseAt }, 200);
    }

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
      candidates: (candidates || [])
        .filter((c: any) => c.position_id === pos.id)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          tag: c.tag,
          votes: tally[`${pos.id}:${c.id}`] || 0,
        })),
    }));

    return jsonResponse({ visible: true, results }, 200);
  } catch (_e) {
    return jsonResponse({ error: "server_error" }, 500);
  }
});
