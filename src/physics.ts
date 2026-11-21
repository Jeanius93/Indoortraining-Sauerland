// Fahrphysik: aus Leistung und Steigung wird die virtuelle Geschwindigkeit.
export interface RiderSettings {
  riderKg: number;
  bikeKg: number;
  cda: number; // Luftwiderstandsfläche m²
  crr: number; // Rollwiderstandsbeiwert
}

export const defaultRider: RiderSettings = { riderKg: 80, bikeKg: 8.5, cda: 0.32, crr: 0.005 };

const G = 9.81, RHO = 1.2;

/** Ein Zeitschritt; liefert neue Geschwindigkeit in m/s. */
export function stepSpeed(v: number, powerW: number, gradePct: number, s: RiderSettings, dt: number) {
  const m = s.riderKg + s.bikeKg, th = Math.atan(gradePct / 100);
  const fGrav = m * G * Math.sin(th);
  const fRoll = m * G * Math.cos(th) * s.crr;
  const fAir = 0.5 * RHO * s.cda * v * Math.abs(v);
  const fDrive = powerW * 0.976 / Math.max(v, 1.0); // 2,4 % Antriebsverlust; unter 1 m/s begrenzt
  const mEff = m + 1.4; // rotierende Massen
  let a = (fDrive - fGrav - fRoll - fAir) / mEff;
  if (powerW <= 0 && v < 0.3 && a < 0) a = -v / dt; // ohne Treten stehenbleiben statt rückwärts rollen
  return Math.max(0, v + a * dt);
}

/** Stationäre Geschwindigkeit (für Prognosen). */
export function steadySpeed(powerW: number, gradePct: number, s: RiderSettings) {
  let v = 5;
  for (let i = 0; i < 400; i++) v = stepSpeed(v, powerW, gradePct, s, 0.25);
  return v;
}
