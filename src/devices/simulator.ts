// Simulierter Trainer: zum Ausprobieren ohne Rad (z. B. am Handy).
// Die Leistung kommt vom Schieberegler, im ERG-Modus vom Zielwert.
import type { Trainer, TrainerData } from './types';

export class SimulatedTrainer implements Trainer {
  readonly name = 'Simulator';
  readonly simulated = true;
  onData: (d: TrainerData) => void = () => {};
  onDisconnect: () => void = () => {};
  manualPower = 180;
  private erg: number | null = null;
  private power = 0;
  private hr = 75;
  private timer: number;

  constructor() {
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  private tick() {
    const target = this.erg ?? this.manualPower;
    this.power += (target - this.power) * 0.35;
    const p = Math.max(0, Math.round(this.power + (Math.random() - 0.5) * 8));
    const cadence = p < 5 ? 0 : Math.round(84 + Math.min(10, p / 40) + (Math.random() - 0.5) * 3);
    this.hr += (62 + p * 0.42 - this.hr) * 0.01;
    this.onData({ power: p, cadence, hr: Math.round(this.hr) });
  }

  async setErg(watts: number) { this.erg = watts; }
  async setSim() { this.erg = null; }
  disconnect() { clearInterval(this.timer); }
}
