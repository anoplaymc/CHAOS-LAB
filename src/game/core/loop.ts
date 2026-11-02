export const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.1;
const MAX_STEPS = 5;

/** Fixed-timestep accumulator. Excess time is dropped rather than simulated, preventing a spiral of death. */
export class FixedStepper {
  private accumulator = 0;
  droppedTime = 0;

  /** Returns how many fixed steps to run for this frame. */
  advance(frameDt: number): number {
    const dt = Math.min(Math.max(0, frameDt), MAX_FRAME);
    this.droppedTime += Math.max(0, frameDt - dt);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS && this.accumulator >= FIXED_DT) {
      this.droppedTime += this.accumulator;
      this.accumulator = 0;
    }
    return steps;
  }

  /** Blend factor between the previous and the current physics state. */
  get alpha(): number {
    return this.accumulator / FIXED_DT;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
