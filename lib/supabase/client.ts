"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

let browserClient: SupabaseClient | null | undefined;
const AUTH_TIMEOUT_MS = 5_000;

function withAuthTimeout<T>(request: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("supabase_auth_timeout")), AUTH_TIMEOUT_MS);
  });
  return Promise.race([request, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

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
  return withAuthTimeout((async () => {
    const existing = await client.auth.getSession();
    if (existing.error) throw existing.error;
    if (existing.data.session) return existing.data.session.access_token;
    if (!createAnonymousUser) return null;
    const created = await client.auth.signInAnonymously();
    if (created.error) throw created.error;
    return created.data.session?.access_token ?? null;
  })());
}

