"""Straßen, die von der Strecke abzweigen, und Radweg-Abschnitte der Strecke.

Grundlage ist die Nutzungskarte (landuse.bin, aus ALKIS): Straßenflächen werden zu Mittellinien verdünnt
(Skelett), die Breite ergibt sich aus dem Abstand zum Flächenrand. Von jeder Einmündung an der Strecke
wird das Straßennetz bis zu einer Weglänge von MAX_LEN Metern verfolgt.
Radwege: Abschnitte, in denen die Strecke in einer Wegefläche (nicht Straßenfläche) liegt.

Aufruf: python3 scripts/prepare-roads.py public/routes/hausrunde
Ausgabe: roads.json (Mittellinien + Breiten, lokale Koordinaten), route.json["surface"]
"""
import gzip, heapq, json, math, os, sys
import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

route_dir = sys.argv[1]
MAX_LEN = 450        # m Weglänge ab der Strecke
route = json.load(open(os.path.join(route_dir, 'route.json')))
L = route['landuse']; PX = L['px']; W, H = L['w'], L['h']; T = route['terrain']; x0, y0 = T['x0'], T['y0']
raw = open(os.path.join(route_dir, 'landuse.bin'), 'rb').read()
lu = np.frombuffer(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw, np.uint8).reshape(H, W)  # Zeile 0 = Süden
rx, ry = np.array(route['x']), np.array(route['y'])
ri, rj = (rx - x0) / PX, (ry - y0) / PX

# ---------- Abstand zur Strecke (Pixel) ----------
route_mask = np.zeros((H, W), bool)
ii, jj = np.clip(np.round(ri).astype(int), 0, W - 1), np.clip(np.round(rj).astype(int), 0, H - 1)
route_mask[jj, ii] = True
# Zwischenpunkte auffüllen (Abstand 5 m > 2 m Pixel)
for t in np.linspace(0, 1, 4)[1:-1]:
    route_mask[np.clip(np.round(rj[:-1] * (1 - t) + rj[1:] * t).astype(int), 0, H - 1), np.clip(np.round(ri[:-1] * (1 - t) + ri[1:] * t).astype(int), 0, W - 1)] = True
dist_route = ndimage.distance_transform_edt(~route_mask) * PX

# ---------- Radweg-Abschnitte ----------
def cls_near(i, j, r=1):
    win = lu[max(0, j - r):j + r + 1, max(0, i - r):i + r + 1].ravel()
    return np.bincount(win, minlength=16)
is_path = []
for k in range(len(rx)):
    c = cls_near(int(round(ri[k])), int(round(rj[k])), 1)
    is_path.append(c[10] > c[9] and c[10] >= 3)          # überwiegend Weg, kaum Straße
is_path = np.array(is_path)
# glätten: Mehrheit über ±40 m, Abschnitte < 80 m verwerfen
win = 8
sm = np.convolve(is_path.astype(float), np.ones(2 * win + 1) / (2 * win + 1), mode='same') > 0.5
segs, k = [], 0
while k < len(sm):
    if sm[k]:
        s = k
        while k < len(sm) and sm[k]: k += 1
        if (k - s) * route['step'] >= 80: segs.append([s * route['step'], (k - 1) * route['step']])
    else: k += 1
merged = []
for a, b in segs:  # Lücken < 120 m schließen (Einmündungen, Querungen)
    if merged and a - merged[-1][1] < 120: merged[-1][1] = b
    else: merged.append([a, b])
segs = merged
route['surface'] = [{'from': a, 'to': b, 'type': 'radweg'} for a, b in segs]
print('Radweg-Abschnitte:', ', '.join(f'{a/1000:.2f}–{b/1000:.2f} km' for a, b in segs) or 'keine', f"({sum(b - a for a, b in segs)/1000:.1f} km)")

# ---------- Straßenskelett im Umkreis der Strecke ----------
near = dist_route < MAX_LEN + 100
road = (lu == 9) & near
road = ndimage.binary_closing(road, iterations=1)
road = ndimage.binary_opening(road, iterations=1)
half = ndimage.distance_transform_edt(road) * PX           # halbe Breite an jedem Pixel
skel = skeletonize(road)
# Hauptstrecke selbst ausnehmen: Skelett innerhalb der Fahrbahn der Strecke (inkl. halber Straßenbreite)
skel &= dist_route > (3.0 + half * 0.9)
print(f'Skelett: {skel.sum()} Pixel')

# ---------- Graph und Weglängen ab der Strecke (Dijkstra) ----------
js, is_ = np.nonzero(skel)
idx = -np.ones((H, W), np.int64); idx[js, is_] = np.arange(len(js))
nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
def neighbors(n):
    j, i = js[n], is_[n]
    for dj, di in nbrs:
        jj_, ii_ = j + dj, i + di
        if 0 <= jj_ < H and 0 <= ii_ < W and idx[jj_, ii_] >= 0: yield idx[jj_, ii_], math.hypot(dj, di) * PX
# Startpunkte: Skelettpixel nahe der Fahrbahnkante der Strecke
start = np.nonzero(dist_route[js, is_] < (3.0 + half[js, is_] * 0.9) + 6)[0]
dist = np.full(len(js), np.inf); dist[start] = 0
pq = [(0.0, int(n)) for n in start]; heapq.heapify(pq)
while pq:
    d, n = heapq.heappop(pq)
    if d > dist[n] or d > MAX_LEN: continue
    for m, w in neighbors(n):
        nd = d + w
        if nd < dist[m]: dist[m] = nd; heapq.heappush(pq, (nd, m))
keep = dist <= MAX_LEN
print(f'Erreichbare Straßenpixel: {keep.sum()}')

# ---------- Kanten verfolgen → Polylinien ----------
deg = np.zeros(len(js), np.int8)
for n in np.nonzero(keep)[0]:
    deg[n] = sum(1 for m, _ in neighbors(n) if keep[m])
visited_edges = set(); lines = []
def walk(a, b):
    path = [a, b]; prev, cur = a, b
    while deg[cur] == 2:
        nxt = [m for m, _ in neighbors(cur) if keep[m] and m != prev]
        if not nxt: break
        prev, cur = cur, nxt[0]
        if (min(prev, cur), max(prev, cur)) in visited_edges: break
        visited_edges.add((min(prev, cur), max(prev, cur)))
        path.append(cur)
    return path
for n in np.nonzero(keep)[0]:
    if deg[n] == 2: continue
    for m, _ in neighbors(n):
        if not keep[m] or (min(n, m), max(n, m)) in visited_edges: continue
        visited_edges.add((min(n, m), max(n, m)))
        lines.append(walk(n, m))
# reine Schleifen ohne Knoten
for n in np.nonzero(keep & (deg == 2))[0]:
    for m, _ in neighbors(n):
        if keep[m] and (min(n, m), max(n, m)) not in visited_edges:
            visited_edges.add((min(n, m), max(n, m))); lines.append(walk(n, m))

def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); ab = b - a; L2 = float(ab @ ab)
    dmax, k = 0, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i]) - a
        d = abs(ab[0] * p[1] - ab[1] * p[0]) / math.sqrt(L2) if L2 > 0 else math.hypot(*p)
        if d > dmax: dmax, k = d, i
    return rdp(pts[:k + 1], eps)[:-1] + rdp(pts[k:], eps) if dmax > eps else [pts[0], pts[-1]]

roads = []
for path in lines:
    if len(path) < 4: continue
    pts = [(x0 + (is_[n] + 0.5) * PX, y0 + (js[n] + 0.5) * PX) for n in path]
    widths = [float(np.clip(half[js[n], is_[n]] * 2 * 0.85, 3.2, 9.0)) for n in path]
    # glätten (gleitendes Mittel, Endpunkte fest)
    xs = np.array([p[0] for p in pts]); ys = np.array([p[1] for p in pts]); k_ = 3
    if len(xs) > 2 * k_ + 1:
        ker = np.ones(2 * k_ + 1) / (2 * k_ + 1)
        xs2 = np.convolve(np.pad(xs, k_, mode='edge'), ker, 'valid'); ys2 = np.convolve(np.pad(ys, k_, mode='edge'), ker, 'valid')
        xs2[0], ys2[0], xs2[-1], ys2[-1] = xs[0], ys[0], xs[-1], ys[-1]; xs, ys = xs2, ys2
    simp = rdp([(float(a), float(b)) for a, b in zip(xs, ys)], 0.8)
    # Breite je vereinfachtem Punkt = Median der Breiten in der Nähe
    wl = []
    for p in simp:
        k = int(np.argmin((xs - p[0]) ** 2 + (ys - p[1]) ** 2)); wl.append(round(float(np.median(widths[max(0, k - 4):k + 5])), 1))
    length = sum(math.dist(simp[i], simp[i + 1]) for i in range(len(simp) - 1))
    if length < 12: continue
    # Einmündung: liegt ein Ende nahe der Strecke, bis zur Mittellinie der Strecke verlängern
    for end in (0, -1):
        p = simp[end]; k = int(np.argmin((rx - p[0]) ** 2 + (ry - p[1]) ** 2)); d = math.hypot(rx[k] - p[0], ry[k] - p[1])
        if d < 14:
            q = (float(rx[k]), float(ry[k]))
            if end == 0: simp.insert(0, q); wl.insert(0, wl[0])
            else: simp.append(q); wl.append(wl[-1])
    roads.append({'w': wl, 'p': [[round(a, 1), round(b, 1)] for a, b in simp]})
total = sum(sum(math.dist(r['p'][i], r['p'][i + 1]) for i in range(len(r['p']) - 1)) for r in roads)
print(f'{len(roads)} Straßenstücke, {total/1000:.1f} km')
json.dump({'roads': roads}, open(os.path.join(route_dir, 'roads.json'), 'w'), separators=(',', ':'))
json.dump(route, open(os.path.join(route_dir, 'route.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
