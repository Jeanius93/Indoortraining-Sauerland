"""Legt die (geglättete GPS-)Strecke auf die Mittellinie der echten Straßenfläche (ALKIS-Nutzungskarte)
und übernimmt die echte Fahrbahnbreite. Auf Radwegen wird auf die Wegfläche eingerastet.

Voraussetzung: prepare-route.mjs + prepare-landuse.py. Danach prepare-landuse.py erneut (Ortsnamen),
prepare-roads.py, prepare-world.mjs, prepare-furniture.py ausführen.
Aufruf: python3 scripts/snap-route.py public/routes/hausrunde
"""
import gzip, json, math, os, sys
import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

route_dir = sys.argv[1]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
base_file = os.path.join(CACHE, 'base', os.path.basename(route_dir.rstrip('/')), 'route.json')
cur = json.load(open(os.path.join(route_dir, 'route.json')))
src = json.load(open(base_file)) if os.path.exists(base_file) else cur
L = cur['landuse']; PX = L['px']; W, H = L['w'], L['h']; T = cur['terrain']; x0, y0 = T['x0'], T['y0']
raw = open(os.path.join(route_dir, 'landuse.bin'), 'rb').read()
lu = np.frombuffer(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw, np.uint8).reshape(H, W)
x, y, h = np.array(src['x']), np.array(src['y']), np.array(src['h'])
rad_segments = cur.get('surface', [])
step = src['step']; n = len(x)
is_rad = np.array([any(s['from'] - 30 <= k * step <= s['to'] + 30 for s in rad_segments) for k in range(n)])

# Bereich um die Strecke
pi, pj = ((x - x0) / PX).astype(int).clip(0, W - 1), ((y - y0) / PX).astype(int).clip(0, H - 1)
near = np.zeros((H, W), bool); near[pj, pi] = True
near = ndimage.binary_dilation(near, iterations=int(30 / PX))

def centerline(mask):
    mask = ndimage.binary_opening(ndimage.binary_closing(mask, iterations=1), iterations=1)
    skel = skeletonize(mask)
    _, idx = ndimage.distance_transform_edt(~skel, return_indices=True)
    half = ndimage.distance_transform_edt(mask) * PX
    return idx, half, skel
idx9, half9, _ = centerline((lu == 9) & near)
idx10, half10, _ = centerline(((lu == 10) | (lu == 9)) & near)

off = np.zeros((n, 2)); valid = np.zeros(n, bool); width = np.full(n, 5.6)
for k in range(n):
    i, j = pi[k], pj[k]
    idx, half = (idx10, half10) if is_rad[k] else (idx9, half9)
    sj, si = idx[0][j, i], idx[1][j, i]
    tx, ty = x0 + (si + 0.5) * PX, y0 + (sj + 0.5) * PX
    d = math.hypot(tx - x[k], ty - y[k])
    if d < 12:
        off[k] = (tx - x[k], ty - y[k]); valid[k] = True
        width[k] = half[sj, si] * 2
# Versatz glätten (Median gegen Ausreißer an Kreuzungen, dann Mittel), Lücken interpolieren
for c in (0, 1):
    v = off[:, c].copy(); v[~valid] = np.nan
    kk = np.arange(n); good = ~np.isnan(v)
    v = np.interp(kk, kk[good], v[good]) if good.any() else np.zeros(n)
    v = ndimage.median_filter(v, size=int(50 / step) | 1, mode='nearest')
    off[:, c] = ndimage.uniform_filter1d(v, size=int(40 / step) | 1, mode='nearest')
nx_, ny_ = x + off[:, 0], y + off[:, 1]
nx_ = ndimage.uniform_filter1d(nx_, 5, mode='nearest'); ny_ = ndimage.uniform_filter1d(ny_, 5, mode='nearest')
# neu auf 5 m abtasten, Höhe (Aufzeichnung) über den Streckenanteil mitnehmen
seg = np.hypot(np.diff(nx_), np.diff(ny_)); cum = np.concatenate([[0], np.cumsum(seg)])
tgt = np.arange(0, cum[-1], step)
X, Y = np.interp(tgt, cum, nx_), np.interp(tgt, cum, ny_)
frac_old = np.arange(n) / (n - 1)
Hh = np.interp(tgt / cum[-1], frac_old, h)
wv = ndimage.median_filter(np.where(np.isfinite(width), width, 5.6), size=int(60 / step) | 1, mode='nearest')
Wd = np.interp(tgt / cum[-1], frac_old, ndimage.uniform_filter1d(wv, int(60 / step) | 1, mode='nearest'))
Wd = np.clip(Wd * 0.92, 4.0, 7.5)   # Fahrbahn (ohne Bankett) etwas schmaler als die Straßenfläche
moved = np.hypot(off[:, 0], off[:, 1])
print(f'Versatz zur Straßenmitte: Median {np.median(moved):.1f} m, 95 % {np.percentile(moved, 95):.1f} m, max {moved.max():.1f} m; eingerastet {valid.mean()*100:.0f} %')
print(f'Fahrbahnbreite: {np.percentile(Wd, 5):.1f} … {np.percentile(Wd, 95):.1f} m · Länge {cum[-1]/1000:.2f} km')
r1 = lambda a: [round(float(v), 1) for v in a]
for target, obj in ((base_file, src), (os.path.join(route_dir, 'route.json'), cur)):
    if target == base_file and not os.path.exists(base_file): continue
    obj['x'], obj['y'], obj['width'] = r1(X), r1(Y), r1(Wd)
    if target == base_file: obj['h'] = r1(Hh)
    else: obj['h'] = r1(Hh)
    obj['length'] = round(float(cum[-1] - (cum[-1] % step)), 1) if False else (len(X) - 1) * step
    json.dump(obj, open(target, 'w'), ensure_ascii=False, separators=(',', ':'))
