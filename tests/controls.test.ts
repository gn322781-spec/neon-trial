import { describe, expect, it } from "vitest";
import { Controls } from "../game/controls";

describe("multitouch controls", () => {
  it("accepts movement and jump at the same time", () => {
    const controls = new Controls();
    controls.press("touch:1", "right");
    controls.press("touch:2", "jump");
    expect(controls.snapshot()).toMatchObject({ right: true, jump: true });
  });

  it("releasing one pointer does not cancel another held action", () => {
    const controls = new Controls();
    controls.press("touch:1", "right");
    controls.press("touch:2", "dash");
    controls.release("touch:1");
    expect(controls.snapshot()).toMatchObject({ right: false, dash: true });
  });

  it("can release every held action after an interrupted touch", () => {
    const controls = new Controls();
    controls.press("touch:4", "left");
    controls.press("touch:7", "attack");
    controls.releaseAll();
    expect(Object.values(controls.snapshot()).every((pressed) => !pressed)).toBe(true);
  });
});
