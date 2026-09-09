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

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: "invalid_body" }, 400);
  }

  const matric = String(body.matric || "").trim().toUpperCase();
  const selections = body.selections;

  if (!matric || !selections || typeof selections !== "object") {
    return jsonResponse({ ok: false, error: "missing_fields" }, 400);
  }

  const entries = Object.entries(selections);
  if (entries.length === 0) {
    return jsonResponse({ ok: false, error: "empty_ballot" }, 400);
  }

  try {
    const settings = await getPollSettings(supabase);
    if (isPollClosed(settings)) {
      return jsonResponse({ ok: false, error: "poll_closed" }, 200);
    }

    // Require a valid, unexpired ticket issued by verify-otp. Without
    // this, a student who never completed OTP verification (or whose
    // ticket already expired) cannot submit a vote no matter what the
    // browser sends.
    const { data: authRow, error: authErr } = await supabase
      .from("vote_authorizations")
      .select("expires_at")
      .eq("matric", matric)
      .maybeSingle();
    if (authErr) throw authErr;

    if (!authRow) {
      return jsonResponse({ ok: false, error: "not_verified" }, 200);
    }
    if (new Date(authRow.expires_at) < new Date()) {
      await supabase.from("vote_authorizations").delete().eq("matric", matric);
      return jsonResponse({ ok: false, error: "verification_expired" }, 200);
    }

    // Validate every selection against real position/candidate pairs,
    // so a tampered request can't stuff votes for fake IDs.
    const { data: candidates, error: candErr } = await supabase
      .from("candidates")
      .select("id, position_id");
    if (candErr) throw candErr;

    const validPairs = new Set(
      (candidates || []).map((c: any) => `${c.position_id}:${c.id}`),
    );
    for (const [positionId, candidateId] of entries) {
      if (!validPairs.has(`${positionId}:${candidateId}`)) {
        return jsonResponse({ ok: false, error: "invalid_selection" }, 400);
      }
    }

    // Atomically claim this matric number as having voted.
    // voted_log.matric has a unique constraint, so a second attempt
    // (double click, retry, or repeat submission) fails safely here
    // before any vote rows are written.
    const { error: claimErr } = await supabase
      .from("voted_log")
      .insert({ matric });

    if (claimErr) {
      if ((claimErr as any).code === "23505") {
        return jsonResponse({ ok: false, error: "already_voted" }, 200);
      }
      throw claimErr;
    }

    // Record anonymous vote rows — no matric or voter id attached,
    // so an individual ballot can never be traced back to a student.
    const rows = entries.map(([positionId, candidateId]) => ({
      position_id: positionId,
      candidate_id: candidateId,
    }));

    const { error: voteErr } = await supabase.from("votes").insert(rows);
    if (voteErr) throw voteErr;

    // One-time ticket — remove it now that it's been used.
    await supabase.from("vote_authorizations").delete().eq("matric", matric);

    return jsonResponse({ ok: true }, 200);
  } catch (_e) {
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
});
