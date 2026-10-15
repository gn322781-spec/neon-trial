export type Action = "left" | "right" | "jump" | "dash" | "attack";

/** Tracks each physical source separately so releasing one finger won't cancel another. */
export class Controls {
  private readonly sources = new Map<string, Action>();

  press(source: string, action: Action) {
    this.sources.set(source, action);
  }

  release(source: string) {
    this.sources.delete(source);
  }

  releaseAll() {
    this.sources.clear();
  }

  isDown(action: Action) {
    for (const value of this.sources.values()) if (value === action) return true;
    return false;
  }

  snapshot() {
    return {
      left: this.isDown("left"),
      right: this.isDown("right"),
      jump: this.isDown("jump"),
      dash: this.isDown("dash"),
      attack: this.isDown("attack"),
    };
  }
}
