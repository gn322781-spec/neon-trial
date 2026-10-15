import { NextResponse, type NextRequest } from "next/server";
import { authenticateAnonymousRequest, bearerToken, createPublicServerClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  if (!getSupabaseConfig()) return NextResponse.json({ code: "supabase_unconfigured" }, { status: 503 });
  const page = Number(request.nextUrl.searchParams.get("page") ?? "0");
  if (!Number.isInteger(page) || page < 0 || page > 100_000) return NextResponse.json({ code: "invalid_page" }, { status: 400 });
  const client = createPublicServerClient();
  if (!client) return NextResponse.json({ code: "supabase_unconfigured" }, { status: 503 });
  try {
    const pageSize = 10;
    const { data, error } = await client.rpc("rank_page", { p_offset: page * pageSize, p_limit: pageSize + 1 });
    if (error) return NextResponse.json({ code: "ranking_unavailable" }, { status: 503 });
    const rows = (data ?? []) as Array<{ position: number; nickname: string; best_score: number }>;
    const items = rows.slice(0, pageSize);
    let me: { position: number; nickname: string; best_score: number } | null = null;
    const token = bearerToken(request);
    if (token) {
      const identity = await authenticateAnonymousRequest(token);
      if (identity) {
        const personal = await identity.client.rpc("my_rank");
        if (!personal.error && Array.isArray(personal.data) && personal.data.length) me = personal.data[0];
      }
    }
    return NextResponse.json({ items, me, page, hasMore: rows.length > pageSize });
  } catch {
    return NextResponse.json({ code: "ranking_unavailable" }, { status: 503 });
  }
}
