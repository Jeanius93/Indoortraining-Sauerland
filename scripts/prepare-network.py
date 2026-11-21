"""Straßennetz rund um eine Strecke aus dem ATKIS Basis-DLM (Straßen-, Fahrweg- und Wegeachsen) und Kreisverkehre.

- Achsen aus scripts/.cache/dlm/axes.json (scripts/extract-dlm.py), in lokale Koordinaten umgerechnet
- Kreisverkehre: kleine, runde Ringe im Straßengraphen mit mindestens drei Zufahrten. Fährt die Strecke hindurch,
  wird sie auf die Kreisfahrbahn gelegt (gegen den Uhrzeigersinn), die Punktzahl bleibt gleich (Streckenmeter bleiben gültig)
- Abschnitte, die auf der Strecke selbst liegen, werden herausgeschnitten; Abzweige enden auf der Streckenmitte
- Breite: Attribut des DLM, sonst aus der Straßenfläche der Nutzungskarte (ALKIS), je Straßenklasse begrenzt
- Radweg-Abschnitte der Strecke (wie bisher aus der Nutzungskarte)

Aufruf: python3 scripts/prepare-network.py public/routes/<id>
Ausgabe: roads.json {roads:[{p,w,k,s}], rings:[{x,y,r,w}]}, route.json (x/y in Kreisverkehren, width, surface, roundabouts)
"""
import gzip, json, math, os, sys
import numpy as np
import networkx as nx
from scipy import ndimage
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import Local

route_dir = sys.argv[1]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
route = json.load(open(os.path.join(route_dir, 'route.json')))
loc = Local(route)
T = route['terrain']; x0, y0 = T['x0'], T['y0']; X1, Y1 = x0 + (T['nx'] - 1) * T['cell'], y0 + (T['ny'] - 1) * T['cell']
LUI = route['landuse']; PX = LUI['px']; LW, LH = LUI['w'], LUI['h']
raw = open(os.path.join(route_dir, 'landuse.bin'), 'rb').read()
lu = np.frombuffer(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw, np.uint8).reshape(LH, LW)
step = route['step']; loop = route.get('loop', False)
rx, ry = np.array(route['x'], float), np.array(route['y'], float); n = len(rx)
width = np.array(route.get('width', [5.6] * n), float)

# ---------- Radweg-Abschnitte (unverändert aus dem bisherigen Verfahren) ----------
def lu_at(x, y):
    i = np.clip(((np.asarray(x) - x0) / PX).astype(int), 0, LW - 1); j = np.clip(((np.asarray(y) - y0) / PX).astype(int), 0, LH - 1); return lu[j, i]
def surface_sections():
    ri, rj = ((rx - x0) / PX).round().astype(int), ((ry - y0) / PX).round().astype(int)
    isp = []
    for k in range(n):
        win = lu[max(0, rj[k] - 1):rj[k] + 2, max(0, ri[k] - 1):ri[k] + 2].ravel(); c = np.bincount(win, minlength=16)
        isp.append(c[10] > c[9] and c[10] >= 3)
    sm = np.convolve(np.array(isp, float), np.ones(17) / 17, mode='same') > 0.5
    segs, k = [], 0
    while k < n:
        if sm[k]:
            s = k
            while k < n and sm[k]: k += 1
            if (k - s) * step >= 80: segs.append([s * step, (k - 1) * step])
        else: k += 1
    merged = []
    for a, b in segs:
        if merged and a - merged[-1][1] < 120: merged[-1][1] = b
        else: merged.append([a, b])
    return [{'from': a, 'to': b, 'type': 'radweg'} for a, b in merged]
route['surface'] = surface_sections()
is_rad = np.zeros(n, bool)
for s in route['surface']: is_rad[int(s['from'] / step):int(s['to'] / step) + 1] = True
hw_route = np.where(is_rad, 1.7, width / 2)

# ---------- Achsen laden ----------
axes = []
for a in json.load(open(os.path.join(CACHE, 'dlm', 'axes.json'))):
    if a.get('widmung') == '1301': continue                       # Autobahn: ohne Anbindung, Talbrücken
    if a['t'] == 'Fahrbahnachse' and a.get('widmung') != '1305': continue
    E = np.array([p[0] for p in a['p']]); N = np.array([p[1] for p in a['p']])
    xs, ys = loc.from_utm(E, N)
    if xs.max() < x0 + 60 or xs.min() > X1 - 60 or ys.max() < y0 + 60 or ys.min() > Y1 - 60: continue
    a['xy'] = np.c_[xs, ys]; axes.append(a)
def kind(a):
    if a['t'] == 'Fahrwegachse': return 'H' if a.get('funktion') == '5211' else 'F'
    if a['t'] == 'WegPfadSteig': return 'P'
    return {'1303': 'B', '1305': 'L', '1306': 'K'}.get(a.get('widmung'), 'G')
print(len(axes), 'Achsen im Gebiet')

# ---------- Kreisverkehre ----------
key = lambda p: (round(float(p[0]), 1), round(float(p[1]), 1))
G = nx.Graph(); full = nx.MultiGraph()
for i, a in enumerate(axes):
    if kind(a) not in 'BLKG': continue
    p = a['xy']; L = float(np.hypot(*np.diff(p, axis=0).T).sum()); u, v = key(p[0]), key(p[-1])
    full.add_edge(u, v, idx=i)
    if L > 200: continue
    if u == v: G.add_edge(u, ('loop', i), idx=i, L=L / 2); G.add_edge(('loop', i), u, idx=i, L=L / 2)
    elif not G.has_edge(u, v): G.add_edge(u, v, idx=i, L=L)
rings, ring_axes = [], set()
# im Luftbild geprüft: kleine Ringe im DLM, die keine Kreisverkehre sind (UTM32 E, N, Grund)
EXCLUDE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'roundabout-exclude.json')))
for c in nx.minimum_cycle_basis(G):
    sub = G.subgraph(c); idxs = {d['idx'] for _, _, d in sub.edges(data=True)}
    P = np.vstack([axes[i]['xy'] for i in idxs])
    A = np.c_[2 * P, np.ones(len(P))]; b = (P ** 2).sum(1); sol = np.linalg.lstsq(A, b, rcond=None)[0]
    cx, cy = sol[:2]; r = math.sqrt(max(1e-6, sol[2] + cx * cx + cy * cy)); res = np.abs(np.hypot(P[:, 0] - cx, P[:, 1] - cy) - r).max()
    per = sum(d['L'] for _, _, d in sub.edges(data=True))
    if not (6 < r < 40 and res < min(1.0, 0.1 * r) and per < 2 * math.pi * r * 1.25): continue
    nodes = [u for u in c if not (isinstance(u, tuple) and u and u[0] == 'loop')]
    arms = [(u, math.atan2(u[1] - cy, u[0] - cx)) for u in nodes if u in full and any(d['idx'] not in idxs for _, _, d in full.edges(u, data=True))]
    narms = sum(sum(1 for _, _, d in full.edges(u, data=True) if d['idx'] not in idxs) for u, _ in arms)
    if narms < 3: continue                                          # Wendeschleife o. Ä.
    E_, N_ = loc.to_utm(cx, cy)
    if any(math.hypot(E_ - ex[0], N_ - ex[1]) < 15 for ex in EXCLUDE): print(f'  Ring bei {E_:.0f}/{N_:.0f} ausgeschlossen (Luftbild: kein Kreisverkehr)'); continue
    # Kreisfahrbahn: die ganze Kreiselfläche ist als Straße kartiert, daher Breite nach Größe (Richtwerte für Kreisverkehre)
    w = float(np.clip(0.3 * r + 3.6, 5.5, 8.0))
    rings.append({'x': float(cx), 'y': float(cy), 'r': float(r), 'w': round(w, 1), 'arms': [t for _, t in arms]}); ring_axes |= idxs
print(len(rings), 'Kreisverkehre')

# ---------- Strecke durch Kreisverkehre legen ----------
def resample(pts, m):
    seg = np.hypot(*np.diff(pts, axis=0).T); s = np.r_[0, np.cumsum(seg)]; t = np.linspace(0, s[-1], m)
    return np.c_[np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])], s[-1]
route_rb = []
for ri_, R in enumerate(rings):
    d = np.hypot(rx - R['x'], ry - R['y']); conflict = d < R['r'] + R['w'] / 2 + hw_route + 0.5
    k = 0
    while k < n:
        if not conflict[k]: k += 1; continue
        i0 = k
        while k < n and conflict[k]: k += 1
        i1 = k - 1
        if i1 - i0 < 1 and d[i0] > R['r']: continue                  # nur gestreift
        a, b = i0, i1
        while a > 0 and d[a - 1] < R['r'] + 32 and a > i0 - 12: a -= 1
        while b < n - 1 and d[b + 1] < R['r'] + 32 and b < i1 + 12: b += 1
        if a <= 2 or b >= n - 3: print('  Kreisverkehr am Streckenende – übersprungen'); continue
        ang = lambda i: math.atan2(ry[i] - R['y'], rx[i] - R['x'])
        def snap(t):                                                 # auf die nächste Zufahrt ziehen
            if not R['arms']: return t
            best = min(R['arms'], key=lambda s: abs((s - t + math.pi) % (2 * math.pi) - math.pi))
            return best if abs((best - t + math.pi) % (2 * math.pi) - math.pi) < math.radians(40) else t
        t_in, t_out = snap(ang(i0)), snap(ang(i1))
        sweep = (t_out - t_in) % (2 * math.pi)                       # gegen den Uhrzeigersinn
        if sweep < math.radians(20): sweep += 2 * math.pi if sweep < 0.05 else 0
        rr = R['r']; arc = [(R['x'] + rr * math.cos(t_in + sweep * u), R['y'] + rr * math.sin(t_in + sweep * u)) for u in np.linspace(0, 1, max(6, int(sweep * rr / 2)))]
        def build(a, b):
            path = np.array([(rx[a], ry[a])] + arc + [(rx[b], ry[b])])
            # Ein- und Ausfahrt weich (Chaikin); der gefahrene Bogen bleibt exakt auf dem Ring, nichts in der Mittelinsel
            for _ in range(3):
                q = [path[0]]
                for p1, p2 in zip(path[:-1], path[1:]): q += [p1 * 0.75 + p2 * 0.25, p1 * 0.25 + p2 * 0.75]
                q.append(path[-1]); path = np.array(q)
                dd = np.hypot(path[:, 0] - R['x'], path[:, 1] - R['y']); th = np.arctan2(path[:, 1] - R['y'], path[:, 0] - R['x'])
                onarc = ((th - t_in) % (2 * math.pi)) <= sweep + 1e-6
                fix = (dd < rr) | (onarc & (dd < rr + 3))
                path[fix] = np.c_[R['x'] + rr * np.cos(th[fix]), R['y'] + rr * np.sin(th[fix])]
            return resample(path, b - a + 1)
        newp, Lnew = build(a, b)
        for _ in range(25):                                          # Punktabstand nahe 5 m halten: Fenster anpassen
            sp = Lnew / (b - a)
            if sp > step * 1.08 and a > 3 and b < n - 4: a -= 1; b += 1
            elif sp < step * 0.92 and b - a > i1 - i0 + 6: a += 1; b -= 1
            else: break
            newp, Lnew = build(a, b)
        sp = Lnew / (b - a)
        rx[a:b + 1], ry[a:b + 1] = newp[:, 0], newp[:, 1]
        on = np.hypot(rx[a:b + 1] - R['x'], ry[a:b + 1] - R['y']) < rr + 1.5
        width[a:b + 1][on] = R['w']
        ks = np.nonzero(on)[0] + a
        route_rb.append({'from': int(ks[0]) * step, 'to': int(ks[-1]) * step, 'ring': ri_})
        print(f'  Kreisverkehr r={rr:.1f} m, Breite {R["w"]} m bei km {i0 * step / 1000:.2f}: {math.degrees(sweep):.0f}° gefahren, Punktabstand {sp:.2f} m')
route['x'] = [round(float(v), 2) for v in rx]; route['y'] = [round(float(v), 2) for v in ry]
route['width'] = [round(float(v), 1) for v in width]; route['roundabouts'] = route_rb
hw_route = np.where(is_rad, 1.7, width / 2)

# ---------- Abstand zur Strecke ----------
def dense(p, ds=2.0):
    out = [p[0]]
    for a_, b_ in zip(p[:-1], p[1:]):
        L = math.dist(a_, b_); m = max(1, int(math.ceil(L / ds)))
        out += [a_ + (b_ - a_) * (s / m) for s in range(1, m + 1)]
    return np.array(out)
rd_ = dense(np.c_[rx, ry], 1.0); rk = np.repeat(np.arange(n), 1)[:0]
# Streckenpunkte im 1-m-Abstand mit zugehörigem Index (für Breite/Richtung)
seg_idx = []
for k in range(n - 1):
    m = max(1, int(math.ceil(math.dist((rx[k], ry[k]), (rx[k + 1], ry[k + 1])))))
    seg_idx += [k] * m
seg_idx = np.array([0] + seg_idx)[:len(rd_)]
rtree = cKDTree(rd_)
rdir = np.c_[np.gradient(rx), np.gradient(ry)]; rdir /= np.linalg.norm(rdir, axis=1)[:, None] + 1e-9

LIMIT = {'B': 650, 'L': 650, 'K': 650, 'G': 600, 'H': 300, 'F': 150, 'P': 150}
DEF_W = {'B': (7.0, 6.0, 9.0), 'L': (6.5, 5.5, 8.5), 'K': (6.0, 5.0, 7.5), 'G': (5.0, 3.5, 7.0), 'H': (3.0, 2.8, 3.5), 'F': (2.6, 2.4, 3.0), 'P': (2.2, 1.8, 2.6)}
road_half = ndimage.distance_transform_edt(ndimage.binary_closing(lu == 9, iterations=1)) * PX
way_half = ndimage.distance_transform_edt(ndimage.binary_closing((lu == 9) | (lu == 10), iterations=1)) * PX
def at(img, x, y):
    i = np.clip(((x - x0) / PX).astype(int), 0, LW - 1); j = np.clip(((y - y0) / PX).astype(int), 0, LH - 1); return img[j, i]

roads = []; n_cross = 0
# Brückenstücke der Strecke selbst: Achsen mit hatDirektUnten, die längs auf der Strecke liegen
bridge_axes = []
for a in axes:
    if not a.get('oben'): continue
    dq, jq = rtree.query(a['xy'])
    if (dq < hw_route[seg_idx[jq]] + 2).mean() > 0.6: bridge_axes.append(a)
print(len(bridge_axes), 'Brückenstücke auf der Strecke')
for i, a in enumerate(axes):
    if i in ring_axes: continue
    k_ = kind(a); P = dense(a['xy'], 2.0)
    d, j = rtree.query(P); kk = seg_idx[j]
    if d.min() > LIMIT[k_]: continue
    dw, lo, hi = DEF_W[k_]
    if k_ in 'BLKG':
        if a.get('breite'): wv = np.full(len(P), float(a['breite']))
        else:
            est = at(road_half, P[:, 0], P[:, 1]) * 2 * 0.85
            wv = np.where(est > 2, est, dw)
        if a.get('streifen') == '1': hi = min(hi, 4.5)
        wv = np.clip(ndimage.median_filter(wv, size=9, mode='nearest'), lo, hi)
    else: wv = np.full(len(P), dw)
    # Teile auf der Strecke selbst entfernen (parallel oder innerhalb der Fahrbahn)
    tang = np.gradient(P, axis=0); tang /= np.linalg.norm(tang, axis=1)[:, None] + 1e-9
    par = np.abs((tang * rdir[kk]).sum(1)) > 0.8
    hr = hw_route[kk]
    on = (d < hr + 0.5) | (par & (d < hr + wv / 2 + 0.6))
    # Ringnähe: in Kreisverkehren endet die Zufahrt am Ring
    for R in rings:
        on |= np.hypot(P[:, 0] - R['x'], P[:, 1] - R['y']) < R['r'] - 0.5
    # Kreuzung ohne Knoten mitten in der Achse (nicht parallel): nur wenn das DLM eine Brücke kennt (hatDirektUnten an
    # dieser Achse = sie liegt oben, oder an der Achse der Strecke = die Strecke liegt oben), nicht anbinden; sonst Kreuzung
    crossings = []
    t_ = 0
    while t_ < len(P):
        if not on[t_]: t_ += 1; continue
        u_ = t_
        while u_ + 1 < len(P) and on[u_ + 1]: u_ += 1
        m0 = (t_ + u_) // 2
        grade_sep = a.get('oben') or any(math.hypot(*(b_['xy'][np.argmin(np.hypot(*(b_['xy'] - P[m0]).T))] - P[m0])) < 8 for b_ in bridge_axes
                                          if abs(b_['xy'][:, 0].mean() - P[m0, 0]) < 300 and abs(b_['xy'][:, 1].mean() - P[m0, 1]) < 300)
        if grade_sep and t_ > 0 and u_ < len(P) - 1 and (u_ - t_ + 1) * 2.0 < 45 and par[t_:u_ + 1].mean() < 0.5 and \
           not any(np.hypot(P[t_:u_ + 1, 0] - R['x'], P[t_:u_ + 1, 1] - R['y']).min() < R['r'] + 3 for R in rings):
            on[t_:u_ + 1] = False; m_ = (t_ + u_) // 2
            crossings.append([round(float(P[m_, 0]), 1), round(float(P[m_, 1]), 1), round((u_ - t_ + 1) * 1.0 + 1, 1)])
        t_ = u_ + 1
    n_cross += len(crossings)
    far = d > LIMIT[k_]
    keep = ~on & ~far
    s = 0
    while s < len(P):
        if not keep[s]: s += 1; continue
        e = s
        while e + 1 < len(P) and keep[e + 1]: e += 1
        pts = P[s:e + 1]; ws = wv[s:e + 1]
        L = float(np.hypot(*np.diff(pts, axis=0).T).sum()) if len(pts) > 1 else 0
        if L >= 10:
            ends = [0, 0]
            for side, idx in ((0, s), (1, e)):
                nb = idx - 1 if side == 0 else idx + 1
                if 0 <= nb < len(P) and on[nb] and d[idx] < hr[idx] + wv[idx] / 2 + 6:
                    q = rd_[j[idx]]                                   # Einmündung: bis zur Streckenmitte verlängern
                    if side == 0: pts = np.vstack([q, pts]); ws = np.r_[ws[0], ws]
                    else: pts = np.vstack([pts, q]); ws = np.r_[ws, ws[-1]]
                    ends[side] = 1
            for side in (0, 1):                                        # Zufahrt eines Kreisverkehrs bis auf die Kreisfahrbahn
                q = pts[0] if side == 0 else pts[-1]
                for R in rings:
                    dc = math.hypot(q[0] - R['x'], q[1] - R['y'])
                    if dc < R['r'] + R['w'] / 2 + 4:
                        e_ = np.array([R['x'] + (q[0] - R['x']) / dc * R['r'], R['y'] + (q[1] - R['y']) / dc * R['r']])
                        if side == 0: pts = np.vstack([e_, pts]); ws = np.r_[ws[0], ws]
                        else: pts = np.vstack([pts, e_]); ws = np.r_[ws, ws[-1]]
                        ends[side] = 2; break
            # vereinfachen: Punkte alle ~6 m (Kurven bleiben durch die Dichte des DLM erhalten)
            keepi = [0]
            acc = 0
            for t in range(1, len(pts) - 1):
                acc += math.dist(pts[t - 1], pts[t])
                v1 = pts[t] - pts[keepi[-1]]; v2 = pts[t + 1] - pts[t]
                turn = abs(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1 @ v2 + 1e-9))
                if acc >= 6 or turn > 0.12: keepi.append(t); acc = 0
            keepi.append(len(pts) - 1)
            xs_ = [c for c in crossings if np.hypot(pts[:, 0] - c[0], pts[:, 1] - c[1]).min() < 3]
            roads.append({**({'x': xs_, 'o': 1 if a.get('oben') else 0} if xs_ else {}), 'k': k_, 's': ends, 'p': [[round(float(pts[t][0]), 1), round(float(pts[t][1]), 1)] for t in keepi], 'w': [round(float(ws[t]), 1) for t in keepi],
                          **({'n': a['name']} if a.get('name') else {}), **({'b': a['bez']} if a.get('bez') else {})})
        s = e + 1
# Kreisverkehre als geschlossene Ringe
for R in rings:
    pts = [[round(R['x'] + R['r'] * math.cos(t), 2), round(R['y'] + R['r'] * math.sin(t), 2)] for t in np.linspace(0, 2 * math.pi, 65)]
    roads.append({'k': 'R', 's': [0, 0], 'p': pts, 'w': [R['w']] * len(pts)})
from collections import Counter
km = Counter()
for r_ in roads: km[r_['k']] += sum(math.dist(r_['p'][t], r_['p'][t + 1]) for t in range(len(r_['p']) - 1)) / 1000
print(f'Kreuzungen ohne Einmündung (Brücke/Unterführung): {n_cross}')
print(f'{len(roads)} Straßenstücke:', ', '.join(f'{k} {v:.1f} km' for k, v in sorted(km.items())), f"· Einmündungen an der Strecke: {sum(sum(r_['s']) for r_ in roads)}")
json.dump({'roads': roads, 'rings': [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in R.items() if k != 'arms'} for R in rings]},
          open(os.path.join(route_dir, 'roads.json'), 'w'), separators=(',', ':'))
json.dump(route, open(os.path.join(route_dir, 'route.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
