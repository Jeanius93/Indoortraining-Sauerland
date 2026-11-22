"""Macht aus einer aufgezeichneten Runde (Start/Ziel zu Hause) einen geschlossenen Rundkurs ohne Haustür:
1. Zubringer abschneiden: Hin- und Rückweg verlaufen am Anfang/Ende oft auf derselben Straße („Stiel“).
   Der Rundkurs beginnt dort, wo sich Hin- und Rückweg trennen.
2. Startpunkt verlegen: an die erste Stelle des Rundkurses, die mindestens MIN_DIST Luftlinie vom Zuhause entfernt ist.
3. Zeit, Puls, Temperatur entfernen. Erster Punkt = letzter Punkt (deckungsgleich).
Aufruf: python3 scripts/make-loop.py eingabe.gpx routes/<name>.gpx "<Name>" [MIN_DIST=1500]
"""
import math, re, sys
inp, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
MIN_DIST = float(sys.argv[4]) if len(sys.argv) > 4 else 1500
s = open(inp, encoding='utf-8').read()
P = [(float(a), float(b), float(c)) for a, b, c in re.findall(r'<trkpt lat="([\d.\-]+)" lon="([\d.\-]+)">\s*<ele>([\d.\-]+)', s)]
R = 6371000.0
def d(p, q): return R * math.hypot((q[1] - p[1]) * math.radians(1) * math.cos(math.radians(p[0])), (q[0] - p[0]) * math.radians(1))
home = P[0]
n = len(P)
# Stiel: wie weit verlaufen Anfang und Ende gemeinsam?  i läuft vorwärts, j rückwärts
far = max(range(n), key=lambda k: d(home, P[k]))
inbound = list(range(far, n))
def nearest_in(p):
    best, bj = 1e18, -1
    for q in inbound[::2]:
        dd = d(p, P[q])
        if dd < best: best, bj = dd, q
    return best, bj
# gemeinsamer Abschnitt ab Start (kleine Aussetzer bis 6 Punkte erlaubt, z. B. GPS-Rauschen)
i0, j0, miss, i = 0, n - 1, 0, 0
while i < far and miss <= 6:
    dd, jj = nearest_in(P[i])
    if dd < 22: i0, j0, miss = i, jj, 0
    else: miss += 1
    i += 1
stick = sum(d(P[k], P[k + 1]) for k in range(i0))
loop = P[i0:j0 + 1]
gap = d(loop[0], loop[-1])
print(f'Gemeinsamer Hin-/Rückweg (Stiel): {stick:.0f} m, verbleibende Lücke {gap:.0f} m')
# Start an die erste Stelle mit Abstand >= MIN_DIST vom Zuhause
k0 = next((k for k, p in enumerate(loop) if d(home, p) >= MIN_DIST), 0)
loop = loop[k0:] + loop[1:k0 + 1]
loop.append(loop[0])
L = sum(d(loop[k], loop[k + 1]) for k in range(len(loop) - 1))
print(f'  Start {d(home, loop[0]):.0f} m Luftlinie vom Zuhause, Länge {L / 1000:.2f} km')
body = '\n'.join(f'   <trkpt lat="{la:.6f}" lon="{lo:.6f}"><ele>{e:.1f}</ele></trkpt>' for la, lo, e in loop)
open(out, 'w').write(f'''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Indoortraining-Sauerland" xmlns="http://www.topografix.com/GPX/1/1">
 <trk>
  <name>{name}</name>
  <type>cycling</type>
  <trkseg>
{body}
  </trkseg>
 </trk>
</gpx>
''')
