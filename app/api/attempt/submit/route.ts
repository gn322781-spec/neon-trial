import { NextResponse, type NextRequest } from "next/server";
import { GAME_VERSION, type ScoreEvent } from "@/game/rules";
import { authenticateAnonymousRequest, bearerToken } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

const SCORE_EVENTS = new Set<ScoreEvent>(["section", "crystal", "target", "zone", "death", "finish"]);

export async function POST(request: NextRequest) {
  if (!getSupabaseConfig()) return NextResponse.json({ code: "supabase_unconfigured" }, { status: 503 });
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  try {
    const identity = await authenticateAnonymousRequest(token);
    if (!identity) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) return NextResponse.json({ code: "invalid_submission" }, { status: 400 });
    const value = body as Record<string, unknown>;
    if (typeof value.attemptId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.attemptId) || value.gameVersion !== GAME_VERSION
      || !Number.isInteger(value.score) || !Number.isInteger(value.deaths) || !Number.isInteger(value.zonesCompleted)
      || !Number.isInteger(value.elapsedMs) || value.completed !== true || !Array.isArray(value.events) || value.events.length > 128) {
      return NextResponse.json({ code: "invalid_submission" }, { status: 400 });
    }
    const events = value.events as Array<Record<string, unknown>>;
    const validEvents = events.every((event) => typeof event === "object" && event !== null
      && typeof event.event === "string" && SCORE_EVENTS.has(event.event as ScoreEvent)
      && typeof event.key === "string" && event.key.length <= 48
      && Number.isInteger(event.at_ms) && Number(event.at_ms) >= 0
      && Number.isInteger(event.x) && Number(event.x) >= 0 && Number(event.x) <= 4_200);
    if (!validEvents || Number(value.score) < 0 || Number(value.score) > 3_000 || Number(value.deaths) < 0 || Number(value.deaths) > 100
      || Number(value.zonesCompleted) !== 4 || Number(value.elapsedMs) < 0 || Number(value.elapsedMs) > 7_200_000) {
      return NextResponse.json({ code: "invalid_submission" }, { status: 400 });
    }
    const { data, error } = await identity.client.rpc("submit_attempt", {
      p_attempt_id: value.attemptId,
      p_game_version: GAME_VERSION,
      p_events: events,
      p_score_submitted: value.score,
      p_deaths: value.deaths,
      p_zones_completed: value.zonesCompleted,
      p_completed: value.completed,
      p_completion_time_ms: value.elapsedMs,
    });
    if (error) return NextResponse.json({ code: "submission_unavailable" }, { status: 503 });
    const submission = data as { accepted?: boolean; reason?: string; recordUpdated?: boolean; bestScore?: number; position?: number | null };
    if (!submission?.accepted) return NextResponse.json({ code: submission?.reason ?? "submission_rejected" }, { status: 409 });
    return NextResponse.json(submission);
  } catch {
    return NextResponse.json({ code: "submission_unavailable" }, { status: 503 });
  }
}
