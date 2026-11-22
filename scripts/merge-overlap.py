"""Doppelt befahrene Abschnitte (gleiche Straße zweimal, z. B. hin und zurück) zusammenführen:
die spätere Durchfahrt wird auf Lage und Höhe der früheren gelegt (weich übergeblendet),
route.json bekommt "overlap": [[von, bis], …] (Streckenmeter der späteren Durchfahrt) – dort zeichnet
die App keine zweite Fahrbahn und keine doppelte Straßenausstattung.
Aufruf: python3 scripts/merge-overlap.py public/routes/<id>"""
import json, os, sys
import numpy as np
from scipy.spatial import cKDTree
p = os.path.join(sys.argv[1], 'route.json'); r = json.load(open(p))
X, Y, H = (np.array(r[k], float) for k in ('x', 'y', 'h')); n = len(X); s = r['step']
D = np.gradient(np.c_[X, Y], axis=0); D /= np.linalg.norm(D, axis=1, keepdims=True) + 1e-9
tree = cKDTree(np.c_[X, Y])
match = np.full(n, -1)
for k in range(n):
    for d, j in zip(*tree.query([X[k], Y[k]], k=40, distance_upper_bound=4.5)):
        if np.isfinite(d) and j < k - 60 and not (k > n - 60 and j < 60) and abs(D[k] @ D[j]) > 0.85: match[k] = j; break
runs, k = [], 0
while k < n:
    if match[k] < 0: k += 1; continue
    e = k
    while e + 1 < n and (match[e + 1] >= 0 or (e + 2 < n and match[e + 2] >= 0)): e += 1
    if e - k >= 6: runs.append((k, e))
    k = e + 1
delta = np.zeros((n, 3)); w = np.zeros(n); overlap = []
for a, b in runs:
    ks = [k for k in range(a, b + 1) if match[k] >= 0]
    dh = np.array([H[k] - H[match[k]] for k in ks])
    if np.median(np.abs(dh)) > 2.5: print(f'  übersprungen {a * s / 1000:.2f}–{b * s / 1000:.2f} km (Höhenunterschied {np.median(np.abs(dh)):.1f} m, wohl Brücke)'); continue
    for k in range(a, b + 1):
        j = match[k] if match[k] >= 0 else match[k - 1]
        # auf die Polylinie der früheren Durchfahrt projizieren
        best = None
        for j0 in (j - 1, j):
            if j0 < 0 or j0 + 1 >= n: continue
            ax, ay = X[j0], Y[j0]; dx, dy = X[j0 + 1] - ax, Y[j0 + 1] - ay; l2 = dx * dx + dy * dy or 1
            t = min(1, max(0, ((X[k] - ax) * dx + (Y[k] - ay) * dy) / l2)); px, py = ax + dx * t, ay + dy * t
            dd = (px - X[k]) ** 2 + (py - Y[k]) ** 2
            if best is None or dd < best[0]: best = (dd, px, py, H[j0] + (H[j0 + 1] - H[j0]) * t)
        delta[k] = [best[1] - X[k], best[2] - Y[k], best[3] - H[k]]; w[k] = 1
    for side, k0, step_ in ((0, a, -1), (1, b, 1)):              # 12 Punkte weich übergehen
        for i in range(1, 13):
            k = k0 + step_ * i
            if 0 <= k < n and w[k] < 1: f = 1 - i / 13; delta[k] = delta[k0] * f; w[k] = f
    overlap.append([int(a * s), int(b * s)])
    print(f'  zusammengeführt {a * s / 1000:.2f}–{b * s / 1000:.2f} km mit {match[a] * s / 1000:.2f} km, Höhe ±{np.median(np.abs(dh)):.1f} m')
X += delta[:, 0]; Y += delta[:, 1]; H += delta[:, 2]
r['x'] = [round(v, 2) for v in X]; r['y'] = [round(v, 2) for v in Y]; r['h'] = [round(v, 2) for v in H]; r['overlap'] = overlap
json.dump(r, open(p, 'w'), separators=(',', ':'))
print(f'{len(overlap)} doppelte Abschnitte')
