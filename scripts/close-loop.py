"""Rundkurs nahtlos schließen: letzter Punkt = erster Punkt, Höhe/Lage/Breite über ±100 m an der Naht angeglichen.
Markiert die Strecke als Rundkurs (route.json: "loop": true)."""
import json, os, sys
d = sys.argv[1]; p = os.path.join(d, 'route.json'); r = json.load(open(p))
n = len(r['x']); K = min(20, n // 10)
for key in ('x', 'y', 'h', 'width'):
    a = r.get(key)
    if not a: continue
    mid = (a[0] + a[-1]) / 2
    # lineare Angleichung: Versatz an der Naht gleichmäßig auf die letzten/ersten K Punkte verteilen
    off0, off1 = mid - a[0], mid - a[-1]
    for k in range(K):
        w = 1 - k / K
        a[k] = round(a[k] + off0 * w, 2); a[n - 1 - k] = round(a[n - 1 - k] + off1 * w, 2)
r['loop'] = True
json.dump(r, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))
print(f"Rundkurs geschlossen: {r['name']}, {r['length'] / 1000:.2f} km")
