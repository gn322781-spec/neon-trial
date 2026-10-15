"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

let browserClient: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;
  const config = getSupabaseConfig();
  browserClient = config ? createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  }) : null;
  return browserClient;
}

export async function getAccessToken(createAnonymousUser = false) {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const existing = await client.auth.getSession();
  if (existing.error) throw existing.error;
  if (existing.data.session) return existing.data.session.access_token;
  if (!createAnonymousUser) return null;
  const created = await client.auth.signInAnonymously();
  if (created.error) throw created.error;
  return created.data.session?.access_token ?? null;
}
