export interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

/** Bounded undo history. Pushing after an undo discards the redo branch. */
export class UndoStack {
  private done: Command[] = [];
  private undone: Command[] = [];
  constructor(private limit = 100) {}

  push(cmd: Command): void {
    this.done.push(cmd);
    if (this.done.length > this.limit) this.done.shift();
    this.undone.length = 0;
  }

  undo(): Command | null {
    const cmd = this.done.pop();
    if (!cmd) return null;
    cmd.undo();
    this.undone.push(cmd);
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.undone.pop();
    if (!cmd) return null;
    cmd.redo();
    this.done.push(cmd);
    return cmd;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
  }
}
