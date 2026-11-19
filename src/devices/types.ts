export interface TrainerData {
  power?: number;   // W
  cadence?: number; // U/min
  speed?: number;   // km/h (vom Trainer, nur Info)
  hr?: number;
}

export interface Trainer {
  readonly name: string;
  readonly simulated: boolean;
  onData: (d: TrainerData) => void;
  onDisconnect: () => void;
  setErg(watts: number): Promise<void>;
  setSim(gradePct: number, crr: number, cwKgPerM: number): Promise<void>;
  disconnect(): void;
}
