// Controller (MSI Claw, Xbox-Layout): Steuerkreuz ±, Schultertasten Kamera, A/Start Pause
export type PadAction = 'up' | 'down' | 'camNext' | 'camPrev' | 'pause' | 'mode';
const MAP: Record<number, PadAction> = { 12: 'up', 13: 'down', 5: 'camNext', 4: 'camPrev', 0: 'pause', 9: 'pause', 3: 'mode' };

export class GamepadInput {
  private prev = new Map<number, boolean>();
  private repeatAt = new Map<number, number>();
  constructor(private onAction: (a: PadAction) => void) {}
  poll(now: number) {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      for (const [iStr, action] of Object.entries(MAP)) {
        const i = +iStr, pressed = !!p.buttons[i]?.pressed, was = this.prev.get(i) ?? false;
        if (pressed && !was) { this.onAction(action); this.repeatAt.set(i, now + 450); }
        else if (pressed && (action === 'up' || action === 'down') && now > (this.repeatAt.get(i) ?? Infinity)) { this.onAction(action); this.repeatAt.set(i, now + 120); }
        this.prev.set(i, pressed);
      }
      break;
    }
  }
}
