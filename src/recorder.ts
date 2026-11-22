// Zeichnet die Fahrt sekündlich auf.
export interface Sample {
  t: number;        // Unix-ms
  dist: number;     // m
  speed: number;    // m/s
  power: number;
  cadence: number;
  hr?: number;
  lat: number; lon: number; alt: number;
}

export class Recorder {
  samples: Sample[] = [];
  add(s: Sample) { this.samples.push(s); }

  summary() {
    const s = this.samples;
    if (!s.length) return null;
    const avg = (f: (x: Sample) => number | undefined) => {
      const v = s.map(f).filter((x): x is number => x !== undefined && x > 0);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    };
    // Normalized Power: 30-s-Mittel, 4. Potenz
    let np = 0;
    if (s.length >= 30) {
      let sum = 0; const roll: number[] = [];
      for (let i = 0; i < s.length; i++) { sum += s[i].power; if (i >= 30) sum -= s[i - 30].power; if (i >= 29) roll.push(sum / 30); }
      np = Math.pow(roll.reduce((a, b) => a + b ** 4, 0) / roll.length, 0.25);
    }
    let ascent = 0;
    for (let i = 1; i < s.length; i++) ascent += Math.max(0, s[i].alt - s[i - 1].alt);
    const kj = s.reduce((a, x) => a + x.power, 0) / 1000;
    return {
      duration: s.length, distance: s.at(-1)!.dist - s[0].dist,
      avgPower: avg(x => x.power), maxPower: Math.max(...s.map(x => x.power)), np,
      avgCadence: avg(x => x.cadence), avgHr: avg(x => x.hr), maxHr: Math.max(0, ...s.map(x => x.hr ?? 0)),
      avgSpeed: avg(x => x.speed), maxSpeed: Math.max(...s.map(x => x.speed)), ascent, kj,
    };
  }
}
