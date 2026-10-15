export const GAME_VERSION = "neon-trial-0.1.0";

export const SCORE = {
  section: 100,
  crystal: 25,
  target: 50,
  zone: 250,
  death: -50,
  finish: 1_000,
} as const;

export type ScoreEvent = "section" | "crystal" | "target" | "zone" | "death" | "finish";

export type ScoreState = {
  value: number;
  awarded: Set<string>;
};

export function createScoreState(): ScoreState {
  return { value: 0, awarded: new Set() };
}

/** Applies a one-time event reward. Stable event keys prevent reward farming. */
export function awardScore(state: ScoreState, event: ScoreEvent, key: string): boolean {
  if (!key || state.awarded.has(key)) return false;
  state.awarded.add(key);
  state.value = Math.max(0, state.value + SCORE[event]);
  return true;
}
