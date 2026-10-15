import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

export function createPublicServerClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config) return null;
  return createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function authenticateAnonymousRequest(token: string): Promise<{ client: SupabaseClient; user: User } | null> {
  const config = getSupabaseConfig();
  if (!config) return null;
  const client = createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous !== true) return null;
  return { client, user: data.user };
}

export function bearerToken(request: Request) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}
