"""Dachfarben aus Luftbildern: jede Dachfläche (LoD2-Dreieck) bekommt den Median der Luftbild-Pixel
(DOP 1 m) darüber. Wände behalten ihre Farbe aus prepare-world.mjs. Speichert Farben als RGB je Dreieck.

Voraussetzung: prepare-world.mjs (buildings.bin mit Palettenindex) und fetch-dop.py.
Aufruf: python3 scripts/prepare-roofs.py public/routes/hausrunde
"""
import json, math, os, sys
import numpy as np
from PIL import Image

route_dir = sys.argv[1]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
route = json.load(open(os.path.join(route_dir, 'route.json')))
B = route['world']['buildings']
if B.get('rgb'): sys.exit('buildings.bin enthält schon RGB – erst prepare-world.mjs neu ausführen')
T = route['terrain']; x0, y0 = T['x0'], T['y0']
raw = open(os.path.join(route_dir, 'buildings.bin'), 'rb').read()
nV = B['vertices']; nT = nV // 3
pos = np.frombuffer(raw[:nV * 6], np.uint16).reshape(nT, 3, 3).astype(np.float64)
col = np.frombuffer(raw[nV * 6:nV * 6 + nT], np.uint8)
X = x0 + pos[:, :, 0] * B['qxy']; Y = y0 + pos[:, :, 1] * B['qxy']; Z = pos[:, :, 2] * B['qz']

# Dachdreiecke: Normale zeigt nach oben
a = np.stack([X[:, 1] - X[:, 0], Y[:, 1] - Y[:, 0], Z[:, 1] - Z[:, 0]], 1)
b = np.stack([X[:, 2] - X[:, 0], Y[:, 2] - Y[:, 0], Z[:, 2] - Z[:, 0]], 1)
nrm = np.cross(a, b); ln = np.linalg.norm(nrm, axis=1) + 1e-9
roof = np.abs(nrm[:, 2] / ln) > 0.3

# lokal → UTM (vektorisiert, gleiche Formeln wie utm.mjs)
lat0, lon0 = route['origin']['lat'], route['origin']['lon']
R = 6378137.0; kx = R * math.cos(math.radians(lat0)) * math.pi / 180; ky = R * math.pi / 180
A_, f = 6378137.0, 1 / 298.257223563; k0 = 0.9996; e2 = f * (2 - f); ep2 = e2 / (1 - e2); L0 = math.radians(9)
def to_utm(lat, lon):
    p, l = np.radians(lat), np.radians(lon)
    N = A_ / np.sqrt(1 - e2 * np.sin(p)**2); Tt = np.tan(p)**2; C = ep2 * np.cos(p)**2; A = np.cos(p) * (l - L0)
    M = A_ * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256)*p - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024)*np.sin(2*p) + (15*e2**2/256 + 45*e2**3/1024)*np.sin(4*p) - (35*e2**3/3072)*np.sin(6*p))
    E = 500000 + k0*N*(A + (1 - Tt + C)*A**3/6 + (5 - 18*Tt + Tt**2 + 72*C - 58*ep2)*A**5/120)
    Nn = k0*(M + N*np.tan(p)*(A**2/2 + (5 - Tt + 9*C + 4*C**2)*A**4/24 + (61 - 58*Tt + Tt**2 + 600*C - 330*ep2)*A**6/720))
    return E, Nn

# Abtastpunkte je Dachdreieck (baryzentrisch, 10 Punkte)
bary = np.array([[1/3, 1/3, 1/3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.45, 0.45, 0.1], [0.45, 0.1, 0.45], [0.1, 0.45, 0.45],
                 [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]])
ri = np.nonzero(roof)[0]
SX = (X[ri] @ bary.T); SY = (Y[ri] @ bary.T)                # (nRoof, 10)
E, N = to_utm(lat0 + SY / ky, lon0 + SX / kx)
tiles = {}
def tile(e, n):
    k = (e, n)
    if k not in tiles:
        p = os.path.join(CACHE, 'dop1m', f'{e}_{n}.jpg')
        tiles[k] = np.asarray(Image.open(p).convert('RGB')) if os.path.exists(p) else None
    return tiles[k]
rgb = np.zeros((len(ri), 10, 3)); ok = np.zeros((len(ri), 10), bool)
te, tn = np.floor(E / 1000).astype(int), np.floor(N / 1000).astype(int)
for (e, n) in set(zip(te.ravel().tolist(), tn.ravel().tolist())):
    t = tile(e, n)
    if t is None: continue
    m = (te == e) & (tn == n)
    c = np.clip((E[m] - e * 1000).astype(int), 0, 999); r = np.clip(((n + 1) * 1000 - N[m]).astype(int), 0, 999)
    rgb[m] = t[r, c]; ok[m] = True
rgb[~ok] = np.nan
med = np.nanmedian(rgb, axis=1)
med = np.where(np.isnan(med), 128, med)
# leicht entsättigen/abdunkeln (Luftbild-Schatten/Glanz ausgleichen), Ziegel kräftig lassen
grey = med.mean(1, keepdims=True); med = grey + (med - grey) * 0.9

palette = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in B['palette']]
out = np.array([palette[c] if c < len(palette) else (200, 200, 200) for c in col], np.float64)
out[ri] = med
B['rgb'] = True
open(os.path.join(route_dir, 'buildings.bin'), 'wb').write(raw[:nV * 6] + np.clip(out, 0, 255).astype(np.uint8).tobytes())
json.dump(route, open(os.path.join(route_dir, 'route.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(f'{len(ri)} von {nT} Dreiecken sind Dachflächen; Farben aus Luftbild gesetzt')
