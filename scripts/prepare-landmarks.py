"""Sehenswürdigkeiten und Bauwerke mit eigenen Modellen (Lage aus Luftbildern DOP 10 cm, Höhen aus DGM1):

- Oestertalsperre: Krone der Bogen-Staumauer (nachgezeichnet), zwei Entnahmetürme im See
- Aqua Magis (Plettenberg): Rutschenverläufe, Rutschenturm, Trichter, Außenbecken (nachgezeichnet)
- Hochspannungsleitungen: Masten (LoD2) zu Leitungen verbunden, Ausrichtung der Traversen
Aufruf: python3 scripts/prepare-landmarks.py public/routes/hausrunde
"""
import glob, json, math, os, sys
import numpy as np, tifffile

route_dir = sys.argv[1]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
route = json.load(open(os.path.join(route_dir, 'route.json')))
lat0, lon0 = route['origin']['lat'], route['origin']['lon']
a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
e2 = f * (2 - f); ep2 = e2 / (1 - e2); L0 = math.radians(9)
def from_utm(E, N):
    x = E - 500000; M = N / k0; mu = M / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = mu + (3*e1/2 - 27*e1**3/32)*math.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32)*math.sin(4*mu) + (151*e1**3/96)*math.sin(6*mu)
    N1 = a / math.sqrt(1 - e2*math.sin(p1)**2); T1 = math.tan(p1)**2; C1 = ep2*math.cos(p1)**2
    R1 = a*(1 - e2)/(1 - e2*math.sin(p1)**2)**1.5; D = x/(N1*k0)
    lat = p1 - (N1*math.tan(p1)/R1)*(D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*ep2)*D**4/24 + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*ep2 - 3*C1**2)*D**6/720)
    lon = L0 + (D - (1 + 2*T1 + C1)*D**3/6 + (5 - 2*C1 + 28*T1 + 3*C1**2 + 8*ep2 + 24*T1**2)*D**5/120)/math.cos(p1)
    return math.degrees(lat), math.degrees(lon)
R = 6378137.0; kx = R * math.cos(math.radians(lat0)) * math.pi / 180; ky = R * math.pi / 180
def local(E, N): la, lo = from_utm(E, N); return (lo - lon0) * kx, (la - lat0) * ky
dgm = {}
def ground(E, N):
    k = (int(E // 1000), int(N // 1000))
    if k not in dgm:
        fs = glob.glob(os.path.join(CACHE, 'dgm1', f'dgm1_32_{k[0]}_{k[1]}_1_nw_*.tif')); dgm[k] = tifffile.imread(fs[0]) if fs else None
    t = dgm[k]
    if t is None: return float('nan')
    return float(t[int(k[1] * 1000 + 1000 - N), int(E - k[0] * 1000)])
r1 = lambda v: round(float(v), 2)

# ---------- Oestertalsperre (Mosaik 0,4 m: E = 417400 + px·0,4, N = 5669250 − py·0,4) ----------
crest_px = [(222, 450), (228, 520), (245, 580), (270, 630), (300, 680), (340, 725), (390, 770), (450, 805), (530, 822)]
crestUTM = [(417400 + x * 0.4, 5669250 - y * 0.4) for x, y in crest_px]
# Kronenhöhe: höchster DGM-Wert quer zur Krone (±4 m)
ch = []
for i, (E, N) in enumerate(crestUTM):
    j = min(i + 1, len(crestUTM) - 1); k = max(i - 1, 0)
    dx, dy = crestUTM[j][0] - crestUTM[k][0], crestUTM[j][1] - crestUTM[k][1]; l = math.hypot(dx, dy); nx_, ny_ = -dy / l, dx / l
    ch.append(max(ground(E + nx_ * o, N + ny_ * o) for o in (-4, -2, 0, 2, 4)))
crest_h = float(np.nanmedian(ch))
dam = {
    'crest': [[r1(c) for c in local(E, N)] + [r1(crest_h)] for E, N in crestUTM],
    # Talseite: Richtung, in der das Gelände tiefer liegt
    'towers': [[r1(c) for c in local(417400 + x * 0.4, 5669250 - y * 0.4)] for x, y in ((248, 630), (306, 712))],
    'lake': r1(np.nanmedian([ground(417400 + x * 0.4 - 30, 5669250 - y * 0.4 - 20) for x, y in crest_px[2:7]])),
}
mid = crestUTM[4]; d1 = ground(mid[0] + 25, mid[1] + 25); d2 = ground(mid[0] - 25, mid[1] - 25)
dam['downstream'] = [r1(c) for c in np.subtract(local(mid[0] + 25, mid[1] + 25), local(*mid))] if d1 < d2 else [r1(c) for c in np.subtract(local(mid[0] - 25, mid[1] - 25), local(*mid))]
print(f'Staumauer: Krone {crest_h:.1f} m ü. NHN, Wasserspiegel (DGM) {dam["lake"]} m, Talseite {dam["downstream"]}')

# ---------- Aqua Magis (Ausschnitt 220 m: E = 419700 + (px−450)·0,2444, N = 5676255 − (py−450)·0,2444) ----------
S = 220 / 900
toUTM = lambda px, py: (419700 + (px - 450) * S, 5676255 - (py - 450) * S)
base = ground(*toUTM(455, 262))
def path(pts, h0, h1, color, stripe=None, r=0.55):
    out = []; L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)); acc = 0
    for i, p in enumerate(pts):
        if i: acc += math.dist(pts[i - 1], p)
        t = acc / L; E, N = toUTM(*p); x, y = local(E, N)
        out.append([r1(x), r1(y), r1(base + h0 + (h1 - h0) * t)])
    return {'pts': out, 'color': color, 'stripe': stripe, 'r': r}
def spiral(cx, cy, rad_px, turns, h0, h1, color, a0=0.0):
    pts = [(cx + math.cos(a0 + t / 40 * turns * 2 * math.pi) * rad_px, cy + math.sin(a0 + t / 40 * turns * 2 * math.pi) * rad_px) for t in range(41)]
    return path(pts, h0, h1, color)
aqua = {
    'slides': [
        path([(232, 250), (205, 228), (175, 220), (158, 232), (160, 262), (178, 290), (200, 315), (197, 345), (184, 375), (182, 405), (195, 428), (222, 433), (236, 410), (232, 375), (226, 348)], 13, 1.2, '#2f7fd0', '#f4f4f4'),
        path([(455, 262), (440, 232), (420, 190), (418, 150), (432, 125), (458, 118), (482, 128), (497, 152), (505, 180), (522, 205), (538, 232), (540, 262), (528, 285), (505, 298), (470, 305), (430, 318), (405, 315), (392, 295), (398, 270)], 17, 1.0, '#7cc6e8'),
        spiral(493, 253, 24, 2.0, 11, 2, '#3fae49'),
        spiral(412, 283, 30, 1.5, 9, 1.2, '#e2436f', 1.0),
        path([(452, 255), (445, 180), (432, 90), (418, 15)], 18, 0.8, '#f2a21b', r=0.45),
        path([(520, 248), (548, 240), (572, 247), (583, 258), (572, 268), (552, 262)], 6, 1, '#e8572a'),
    ],
    'tower': [r1(c) for c in local(*toUTM(458, 262))] + [r1(base), 19.0],
    'funnel': [r1(c) for c in local(*toUTM(480, 205))] + [r1(base + 7.5), 9.3],
    'pools': [[[r1(c) for c in local(*toUTM(x, y))] for x, y in poly] for poly in ([(330, 398), (368, 398), (368, 445), (330, 445)], [(300, 560), (345, 560), (345, 605), (300, 605)])],
    'ground': r1(base),
}
print(f'Aqua Magis: {len(aqua["slides"])} Rutschen, Bodenhöhe {base:.1f} m')

# ---------- Hochspannungsleitungen: Masten verbinden ----------
P = [t for t in route.get('towers', []) if t['fn'] == '51002_1251']
xy = np.array([[t['x'], t['y']] for t in P]) if P else np.zeros((0, 2))
edges = set()
for i in range(len(P)):
    d = np.hypot(*(xy - xy[i]).T); d[i] = 1e9; order = np.argsort(d)
    j = order[0]
    if d[j] > 520: continue
    edges.add(tuple(sorted((i, int(j)))))
    v1 = xy[j] - xy[i]
    for k in order[1:6]:
        if d[k] > 520: break
        v2 = xy[k] - xy[i]
        if np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2)) < -0.5: edges.add(tuple(sorted((i, int(k))))); break
dirs = []
for i in range(len(P)):
    nb = [j for a_, b_ in edges for j in ((b_,) if a_ == i else (a_,) if b_ == i else ())]
    if nb:
        v = sum((xy[j] - xy[i]) / np.linalg.norm(xy[j] - xy[i]) * (1 if np.dot(xy[j] - xy[i], xy[nb[0]] - xy[i]) >= 0 else -1) for j in nb)
        dirs.append(r1(math.atan2(v[0], v[1])))
    else: dirs.append(0.0)
power = {'pylons': [[t['x'], t['y'], t['z'], t['height'], dirs[i]] for i, t in enumerate(P)], 'lines': sorted(edges)}
print(f'Hochspannung: {len(P)} Masten, {len(edges)} Spannfelder')
others = [[t['x'], t['y'], t['z'], t['height'], t['size'], t['fn']] for t in route.get('towers', []) if t['fn'] != '51002_1251']
T_ = route['terrain']
def inside(x, y): return T_['x0'] < x < T_['x0'] + (T_['nx'] - 1) * T_['cell'] and T_['y0'] < y < T_['y0'] + (T_['ny'] - 1) * T_['cell']
if not inside(*dam['crest'][4][:2]): dam = None
if not inside(*aqua['tower'][:2]): aqua = None
print('Talsperre', 'ja' if dam else 'nein', '· Aqua Magis', 'ja' if aqua else 'nein')
json.dump({'dam': dam, 'aqua': aqua, 'power': power, 'towers': others}, open(os.path.join(route_dir, 'landmarks.json'), 'w'), separators=(',', ':'))
