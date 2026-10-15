import { NextResponse, type NextRequest } from "next/server";
import { GAME_VERSION } from "@/game/rules";
import { authenticateAnonymousRequest, bearerToken } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function POST(request: NextRequest) {
  if (!getSupabaseConfig()) return NextResponse.json({ code: "supabase_unconfigured" }, { status: 503 });
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  try {
    const identity = await authenticateAnonymousRequest(token);
    if (!identity) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
    const body: unknown = await request.json();
    const version = typeof body === "object" && body !== null && "gameVersion" in body ? (body as { gameVersion: unknown }).gameVersion : null;
    if (version !== GAME_VERSION) return NextResponse.json({ code: "unsupported_game_version" }, { status: 400 });
    const { data, error } = await identity.client.rpc("start_attempt", { p_game_version: GAME_VERSION });
    if (error) {
      if (error.code === "P0001") return NextResponse.json({ code: "attempt_rate_limited" }, { status: 429 });
      if (error.code === "P0002") return NextResponse.json({ code: "profile_required" }, { status: 409 });
      return NextResponse.json({ code: "attempt_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ attemptId: data, gameVersion: GAME_VERSION });
  } catch {
    return NextResponse.json({ code: "attempt_unavailable" }, { status: 503 });
  }
}
