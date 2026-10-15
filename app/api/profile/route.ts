import { NextResponse, type NextRequest } from "next/server";
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
    const nickname = typeof body === "object" && body !== null && "nickname" in body ? (body as { nickname: unknown }).nickname : null;
    if (typeof nickname !== "string") return NextResponse.json({ code: "invalid_nickname" }, { status: 400 });
    const { data, error } = await identity.client.rpc("claim_nickname", { p_nickname: nickname });
    if (error) {
      if (error.code === "23505") return NextResponse.json({ code: "nickname_taken" }, { status: 409 });
      if (error.code === "22023") return NextResponse.json({ code: "invalid_nickname" }, { status: 400 });
      if (error.code === "P0001") return NextResponse.json({ code: "nickname_rate_limited" }, { status: 429 });
      return NextResponse.json({ code: "profile_unavailable" }, { status: 503 });
    }
    const profile = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ nickname: profile?.nickname ?? nickname.trim() });
  } catch {
    return NextResponse.json({ code: "profile_unavailable" }, { status: 503 });
  }
}
