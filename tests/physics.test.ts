import { describe, expect, it } from "vitest";
import { jumpVelocityAfterRelease, PHYSICS } from "../game/physics";

describe("precision jump", () => {
  it("keeps the full jump while held and cuts it to a useful short jump on release", () => {
    expect(jumpVelocityAfterRelease(-PHYSICS.jumpSpeed, true)).toBe(-PHYSICS.jumpSpeed);
    expect(jumpVelocityAfterRelease(-PHYSICS.jumpSpeed, false)).toBe(-PHYSICS.minimumJumpSpeed);
  });

  it("does not alter falling or already-short jumps", () => {
    expect(jumpVelocityAfterRelease(180, false)).toBe(180);
    expect(jumpVelocityAfterRelease(-250, false)).toBe(-250);
  });
});
