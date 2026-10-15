import { describe, expect, it } from "vitest";
import { AudioFeedback } from "../game/audio";

describe("audio preferences", () => {
  it("starts at an audible default volume", () => {
    expect(new AudioFeedback().volume).toBe(0.65);
  });

  it("clamps volume to the supported range", () => {
    const audio = new AudioFeedback();
    audio.setVolume(1.5);
    expect(audio.volume).toBe(1);
    audio.setVolume(-0.5);
    expect(audio.volume).toBe(0);
  });
});
