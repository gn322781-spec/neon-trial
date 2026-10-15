import type { TrialResult } from "@/game/TrialScene";
import { getAccessToken } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase/config";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

type PendingSubmission = { attemptId: string; result: TrialResult };
const PENDING_KEY = "neon-trial-pending-submissions";

function readPending(): PendingSubmission[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingSubmission => typeof item === "object" && item !== null
      && "attemptId" in item && typeof item.attemptId === "string" && "result" in item
      && typeof item.result === "object" && item.result !== null && "events" in item.result);
  } catch {
    return [];
  }
}

function writePending(items: PendingSubmission[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(PENDING_KEY, JSON.stringify(items.slice(-5)));
}

export function rememberPendingSubmission(attemptId: string, result: TrialResult) {
  writePending([...readPending().filter((item) => item.attemptId !== attemptId), { attemptId, result }]);
}

export function forgetPendingSubmission(attemptId: string) {
  writePending(readPending().filter((item) => item.attemptId !== attemptId));
}

export async function retryPendingSubmissions() {
  if (!getSupabaseConfig()) return;
  const token = await getAccessToken(false);
  if (!token) return;
  const pending = readPending();
  for (const item of pending) {
    try {
      const response = await submitRemoteAttempt(item.attemptId, token, item.result);
      forgetPendingSubmission(item.attemptId);
      window.dispatchEvent(new CustomEvent("neon-trial-pending-synced", { detail: { attemptId: item.attemptId, response } }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) forgetPendingSubmission(item.attemptId);
    }
  }
}

async function postWithToken(path: string, body: unknown, token: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6_000),
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data === "object" && data !== null && "code" in data && typeof data.code === "string" ? data.code : "request_failed";
    throw new ApiError(code, response.status);
  }
  return data as Record<string, unknown>;
}

export async function claimRemoteNickname(nickname: string) {
  if (!getSupabaseConfig()) return null;
  const token = await getAccessToken(true);
  if (!token) throw new ApiError("anonymous_auth_unavailable", 503);
  const response = await postWithToken("/api/profile", { nickname }, token);
  return typeof response.nickname === "string" ? response.nickname : nickname;
}

export async function createRemoteAttempt(nickname: string, gameVersion: string) {
  if (!getSupabaseConfig()) return null;
  const token = await getAccessToken(true);
  if (!token) return null;
  await postWithToken("/api/profile", { nickname }, token);
  const response = await postWithToken("/api/attempt", { gameVersion }, token);
  return typeof response.attemptId === "string" ? { id: response.attemptId, token } : null;
}

export async function submitRemoteAttempt(attemptId: string, token: string, result: TrialResult) {
  return postWithToken("/api/attempt/submit", {
    attemptId,
    gameVersion: result.gameVersion,
    score: result.score,
    deaths: result.deaths,
    zonesCompleted: result.zonesCompleted,
    completed: result.completed,
    elapsedMs: result.elapsedMs,
    events: result.events,
  }, token);
}

export async function fetchRanking(page: number) {
  const token = await getAccessToken(false);
  const response = await fetch(`/api/ranking?page=${page}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data === "object" && data !== null && "code" in data && typeof data.code === "string" ? data.code : "ranking_unavailable";
    throw new ApiError(code, response.status);
  }
  return data as {
    items: Array<{ position: number; nickname: string; best_score: number }>;
    me: { position: number; nickname: string; best_score: number } | null;
    page: number;
    hasMore: boolean;
  };
}
