"""Bodentexturen aus Luftbildern (DOP, Geobasis NRW) passend zu den 1-km-Geländekacheln des Clients.

Voraussetzung: scripts/fetch-dop.py (Luftbilder 1 m/Pixel in .cache/dop1m)
Ausgabe: public/routes/<name>/ortho/<ci>_<cj>.jpg + ortho.json (Auflösung je Kachel)
Aufruf: python3 scripts/prepare-ortho.py public/routes/hausrunde
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy import ndimage

route_dir = sys.argv[1]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
route = json.load(open(os.path.join(route_dir, 'route.json')))
T = route['terrain']; x0, y0, cell, nx, ny = T['x0'], T['y0'], T['cell'], T['nx'], T['ny']
lat0, lon0 = route['origin']['lat'], route['origin']['lon']
out_dir = os.path.join(route_dir, 'ortho'); os.makedirs(out_dir, exist_ok=True)
fine_dir = os.path.join(route_dir, 'ortho1'); os.makedirs(fine_dir, exist_ok=True)

# ---------- Koordinaten (wie prepare-landuse.py) ----------
a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
e2 = f * (2 - f); ep2 = e2 / (1 - e2); L0 = math.radians(9)
def to_utm(lat, lon):
    p, l = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(p)**2); Tt = math.tan(p)**2; C = ep2 * math.cos(p)**2; A = math.cos(p) * (l - L0)
    M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256)*p - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024)*math.sin(2*p) + (15*e2**2/256 + 45*e2**3/1024)*math.sin(4*p) - (35*e2**3/3072)*math.sin(6*p))
    E = 500000 + k0*N*(A + (1 - Tt + C)*A**3/6 + (5 - 18*Tt + Tt**2 + 72*C - 58*ep2)*A**5/120)
    Nn = k0*(M + N*math.tan(p)*(A**2/2 + (5 - Tt + 9*C + 4*C**2)*A**4/24 + (61 - 58*Tt + Tt**2 + 600*C - 330*ep2)*A**6/720))
    return E, Nn
R = 6378137.0; kx = R * math.cos(math.radians(lat0)) * math.pi / 180; ky = R * math.pi / 180
def local_to_utm(x, y): return to_utm(lat0 + y / ky, lon0 + x / kx)

# ---------- Luftbild-Mosaik ----------
tiles = {}
def tile(e, n):
    k = (e, n)
    if k not in tiles:
        p = os.path.join(CACHE, 'dop1m', f'{e}_{n}.jpg')
        tiles[k] = np.asarray(Image.open(p).convert('RGB')) if os.path.exists(p) else None
    return tiles[k]
def crop(Emin, Emax, Nmin, Nmax):
    """Ausschnitt (Zeile 0 = Norden) aus dem 1-m-Mosaik, plus Ursprung (E links, N oben)"""
    e0, e1, n0, n1 = int(math.floor(Emin / 1000)), int(math.floor(Emax / 1000)), int(math.floor(Nmin / 1000)), int(math.floor(Nmax / 1000))
    W = (e1 - e0 + 1) * 1000; Hh = (n1 - n0 + 1) * 1000
    m = np.zeros((Hh, W, 3), np.uint8); m[:] = (96, 112, 70)
    for e in range(e0, e1 + 1):
        for n in range(n0, n1 + 1):
            t = tile(e, n)
            if t is None: continue
            r0 = (n1 - n) * 1000; c0 = (e - e0) * 1000
            m[r0:r0 + 1000, c0:c0 + 1000] = t
    return m, e0 * 1000, (n1 + 1) * 1000

# ---------- Kacheln wie im Client (1 km = round(1000/cell) Zellen) ----------
CH = round(1000 / cell)
rx, ry = np.array(route['x']), np.array(route['y'])

def render(ci, cj, cx0, cy0, wM, hM, mpp, target, quality):
    tw, th = math.ceil(wM / mpp), math.ceil(hM / mpp)
    # Affine Abbildung lokal → UTM aus drei Ecken (Fehler über 1 km im cm-Bereich)
    Ea, Na = local_to_utm(cx0, cy0); Eb, Nb = local_to_utm(cx0 + 1000, cy0); Ec, Nc = local_to_utm(cx0, cy0 + 1000)
    tx = (np.arange(tw) + 0.5) * mpp; ty = (np.arange(th)[::-1] + 0.5) * mpp   # Bildzeile 0 = Norden
    X, Y = np.meshgrid(tx, ty)
    E = Ea + (Eb - Ea) * X / 1000 + (Ec - Ea) * Y / 1000
    N = Na + (Nb - Na) * X / 1000 + (Nc - Na) * Y / 1000
    m, mE, mN = crop(E.min() - 2, E.max() + 2, N.min() - 2, N.max() + 2)
    sig = max(0.35, mpp / 2.5)
    rows, cols = (mN - N) - 0.5, (E - mE) - 0.5
    img = np.zeros((th, tw, 3), np.uint8)
    for c in range(3):
        ch = ndimage.gaussian_filter(m[:, :, c].astype(np.float32), sig)
        img[:, :, c] = np.clip(ndimage.map_coordinates(ch, [rows, cols], order=1, mode='nearest'), 0, 255)
    im = Image.fromarray(img)
    im = ImageEnhance.Contrast(im).enhance(1.08); im = ImageEnhance.Color(im).enhance(1.12)
    if mpp == 1: im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    im.save(os.path.join(target, f'{ci}_{cj}.jpg'), quality=quality, optimize=True)

manifest, fine = {}, []
for cj in range(0, ny - 1, CH):
    for ci in range(0, nx - 1, CH):
        ci1, cj1 = min(ci + CH, nx - 1), min(cj + CH, ny - 1)
        cx0, cy0 = x0 + ci * cell, y0 + cj * cell; wM, hM = (ci1 - ci) * cell, (cj1 - cj) * cell
        # Abstand Strecke ↔ Kachelrechteck
        dx = np.maximum(0, np.maximum(cx0 - rx, rx - (cx0 + wM))); dy = np.maximum(0, np.maximum(cy0 - ry, ry - (cy0 + hM)))
        dist = float(np.min(np.hypot(dx, dy)))
        mpp = 2 if dist < 600 else 4
        render(ci, cj, cx0, cy0, wM, hM, mpp, out_dir, 80 if mpp == 2 else 75)
        manifest[f'{ci}_{cj}'] = mpp
        if dist < 250:                                   # 1-m-Variante nahe der Strecke (Desktop)
            render(ci, cj, cx0, cy0, wM, hM, 1, fine_dir, 78); fine.append(f'{ci}_{cj}')
json.dump({'chunk': CH, 'tiles': manifest, 'fine': fine}, open(os.path.join(route_dir, 'ortho.json'), 'w'), separators=(',', ':'))
size = sum(os.path.getsize(os.path.join(out_dir, f)) for f in os.listdir(out_dir))
fsize = sum(os.path.getsize(os.path.join(fine_dir, f)) for f in os.listdir(fine_dir))
print(f'{len(manifest)} Bodentexturen ({size/1e6:.1f} MB), davon {len(fine)} zusätzlich in 1 m ({fsize/1e6:.1f} MB)')
