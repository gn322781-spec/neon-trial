import { describe, expect, it } from "vitest";
import { awardScore, createScoreState } from "../game/rules";

describe("score rules", () => {
  it("awards each event once by its stable identifier", () => {
    const score = createScoreState();
    expect(awardScore(score, "crystal", "crystal:1")).toBe(true);
    expect(awardScore(score, "crystal", "crystal:1")).toBe(false);
    expect(score.value).toBe(25);
  });

  it("never lets the score fall below zero", () => {
    const score = createScoreState();
    awardScore(score, "death", "death:1");
    expect(score.value).toBe(0);
  });

  it("keeps distinct events independent", () => {
    const score = createScoreState();
    awardScore(score, "section", "section:1");
    awardScore(score, "zone", "zone:1");
    expect(score.value).toBe(350);
  });
});
