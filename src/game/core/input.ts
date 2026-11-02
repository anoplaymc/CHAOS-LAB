export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'crouch' | 'interact' | 'flight'
  | 'reload' | 'spawnMenu' | 'quickMenu' | 'delete' | 'respawn' | 'pin' | 'debug' | 'aiDebug'
  | 'undo' | 'redo' | 'gridSnap' | 'angleSnap' | 'surfaceAlign' | 'anchorNext' | 'partPrev' | 'partNext' | 'controls' | 'modMenu' | 'console';

const BINDINGS: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint', ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
  KeyE: 'interact', KeyF: 'flight', KeyR: 'reload', KeyG: 'spawnMenu', KeyQ: 'quickMenu', Delete: 'delete', KeyK: 'respawn', KeyT: 'pin',
  F3: 'debug', F4: 'aiDebug', KeyZ: 'undo', KeyY: 'redo', KeyB: 'gridSnap', KeyN: 'angleSnap', KeyV: 'surfaceAlign', KeyH: 'anchorNext',
  BracketLeft: 'partPrev', BracketRight: 'partNext', F1: 'controls', KeyM: 'modMenu', Backquote: 'console',
};

/** Keys a mod can't bind: the game's own, the hotbar's, and ones the browser or the debug tools need. */
export function reservedKey(code: string): boolean {
  return code in BINDINGS || /^Digit\d$/.test(code) || ['Minus', 'Equal', 'Escape', 'Tab', 'Enter', 'F5', 'F11', 'F12'].includes(code);
}

/** Keys whose browser default would interrupt play. Ctrl+W cannot be blocked: see the leave-page guard in App. */
const SWALLOW = new Set(['Space', 'Tab', 'F1', 'F3', 'F4', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyR']);

function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export class Input {
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private lmb = false;
  private rmb = false;
  private lmbPressed = false;
  private rmbPressed = false;
  private lmbReleased = false;
  private rmbReleased = false;
  private wheel = 0;
  private dx = 0;
  private dy = 0;
  private escapeArmed = false;
  private digit: number | null = null;
  /** Gameplay reads nothing unless this is on. UI overlays switch it off. */
  enabled = false;
  locked = false;
  /** Automated tests and machines without pointer lock can play as if the pointer were locked. */
  virtualLock = false;
  onEscape: (() => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  onLockRefused: (() => void) | null = null;
  onGlobalAction: ((a: Action) => boolean) | null = null;
  /** A key a mod has bound. Returns true when it was used. */
  onModKey: ((code: string) => boolean) | null = null;
  private target: HTMLElement | null = null;

  attach(target: HTMLElement): void {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', this.onContext);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
  }

  detach(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
    this.target?.removeEventListener('mousedown', this.onMouseDown);
    this.target?.removeEventListener('wheel', this.onWheel);
    this.target?.removeEventListener('contextmenu', this.onContext);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    this.target = null;
  }

  requestLock(): void {
    if (this.virtualLock || !this.target) {
      this.setLocked(true);
      return;
    }
    if (document.pointerLockElement === this.target) return;
    try {
      const r = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      // Browsers reject re-locking shortly after Esc. pointerlockerror shows the click-to-resume hint.
      r?.catch?.(() => undefined);
    } catch {
      // Handled in the same way as a rejected promise.
    }
  }

  exitLock(): void {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
    if (this.virtualLock) this.setLocked(false);
  }

  private setLocked(v: boolean) {
    if (this.locked === v) return;
    this.locked = v;
    this.onLockChange?.(v);
  }

  private onPointerLock = () => {
    if (this.virtualLock) return;
    this.setLocked(document.pointerLockElement === this.target);
  };
  private onPointerLockError = () => {
    this.onLockRefused?.();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      // Acted on at keyup: Firefox ends pointer lock on the Esc keyup, which would undo a lock taken at keydown.
      this.escapeArmed = !isTyping(e.target) || (e.target as HTMLInputElement).value === '';
      return;
    }
    // Function keys type nothing, so a menu with a text box focused can still be closed with its own key.
    if (!e.repeat && (!isTyping(e.target) || /^F\d+$/.test(e.code)) && this.onModKey?.(e.code)) {
      e.preventDefault();
      return;
    }
    if (isTyping(e.target)) return;
    const action = BINDINGS[e.code];
    if (action && !e.repeat && this.onGlobalAction?.(action)) {
      e.preventDefault();
      return;
    }
    if (!this.enabled) return;
    if (SWALLOW.has(e.code) || e.ctrlKey) e.preventDefault();
    if (e.repeat) return;
    const d = /^Digit(\d)$/.exec(e.code);
    if (d) this.digit = d[1] === '0' ? 9 : Number(d[1]) - 1;
    if (e.code === 'Minus') this.digit = 10;
    if (e.code === 'Equal') this.digit = 11;
    if (!action) return;
    this.held.add(action);
    this.pressed.add(action);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      if (this.escapeArmed) this.onEscape?.();
      this.escapeArmed = false;
      return;
    }
    const action = BINDINGS[e.code];
    if (!action) return;
    if (this.held.delete(action)) this.released.add(action);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.locked && this.enabled) {
      // Browsers occasionally deliver huge spurious deltas when pointer lock engages.
      if (Math.abs(e.movementX) < 600) this.dx += e.movementX;
      if (Math.abs(e.movementY) < 600) this.dy += e.movementY;
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (!this.locked) {
      this.requestLock();
      return;
    }
    if (e.button === 0) this.pressButton(0);
    if (e.button === 2) this.pressButton(2);
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.releaseButton(0);
    if (e.button === 2) this.releaseButton(2);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.enabled) this.wheel += Math.sign(e.deltaY);
  };

  private onContext = (e: Event) => e.preventDefault();

  private onBlur = () => this.releaseAll();

  releaseAll(): void {
    for (const a of this.held) this.released.add(a);
    this.held.clear();
    this.releaseButton(0);
    this.releaseButton(2);
  }

  // ── Programmatic control. Used by automation and by the mouse handlers above.
  pressButton(b: 0 | 2): void {
    if (b === 0 && !this.lmb) { this.lmb = true; this.lmbPressed = true; }
    if (b === 2 && !this.rmb) { this.rmb = true; this.rmbPressed = true; }
  }
  releaseButton(b: 0 | 2): void {
    if (b === 0 && this.lmb) { this.lmb = false; this.lmbReleased = true; }
    if (b === 2 && this.rmb) { this.rmb = false; this.rmbReleased = true; }
  }
  pressAction(a: Action): void {
    this.held.add(a);
    this.pressed.add(a);
  }
  releaseAction(a: Action): void {
    if (this.held.delete(a)) this.released.add(a);
  }

  isDown(a: Action): boolean { return this.enabled && this.held.has(a); }
  wasPressed(a: Action): boolean { return this.enabled && this.pressed.has(a); }
  get primaryDown() { return this.enabled && this.lmb; }
  get secondaryDown() { return this.enabled && this.rmb; }
  get primaryPressed() { return this.enabled && this.lmbPressed; }
  get secondaryPressed() { return this.enabled && this.rmbPressed; }
  get primaryReleased() { return this.lmbReleased; }
  get secondaryReleased() { return this.rmbReleased; }
  get wheelDelta() { return this.enabled ? this.wheel : 0; }
  get digitPressed() { return this.enabled ? this.digit : null; }

  consumeMouse(): { dx: number; dy: number } {
    const out = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return out;
  }

  /** Called at the end of each rendered frame: edge-triggered state lives exactly one frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.lmbPressed = this.rmbPressed = this.lmbReleased = this.rmbReleased = false;
    this.wheel = 0;
    this.digit = null;
  }
}
