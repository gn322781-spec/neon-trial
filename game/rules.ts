export const GAME_VERSION = "neon-trial-0.2.0";
export const STARTING_LIVES = 4;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_DAMAGE_PER_HIT = 25;
export const SURVIVAL_SCORE_PER_SECOND = 1;

export const SCORE = {
  section: 100,
  crystal: 25,
  target: 50,
  zone: 250,
  death: -50,
} as const;

export type ScoreEvent = "section" | "crystal" | "target" | "zone" | "death";

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
