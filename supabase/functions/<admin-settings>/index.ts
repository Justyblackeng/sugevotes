import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { checkAdminKey } from "../_shared/admin.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function isValidIsoOrNull(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  return !isNaN(new Date(v).getTime());
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const authFail = checkAdminKey(req);
  if (authFail) return authFail;

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: "invalid_body" }, 400);
  }

  const resultsPublic = !!body.resultsPublic;
  const pollOpenAt = body.pollOpenAt ?? null;
  const pollCloseAt = body.pollCloseAt ?? null;

  if (!isValidIsoOrNull(pollOpenAt) || !isValidIsoOrNull(pollCloseAt)) {
    return jsonResponse({ ok: false, error: "invalid_dates" }, 400);
  }
  if (
    pollOpenAt && pollCloseAt &&
    new Date(pollCloseAt) <= new Date(pollOpenAt)
  ) {
    return jsonResponse({ ok: false, error: "close_before_open" }, 400);
  }

  try {
    const { error } = await supabase.from("election_settings").upsert([
      { key: "results_public", value: resultsPublic ? "true" : "false" },
      { key: "poll_open_at", value: pollOpenAt },
      { key: "poll_close_at", value: pollCloseAt },
    ]);
    if (error) throw error;

    return jsonResponse({ ok: true }, 200);
  } catch (_e) {
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
});
