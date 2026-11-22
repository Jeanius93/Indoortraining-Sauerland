"""Lädt Digitale Orthophotos (DOP10, Geobasis NRW, dl-de/zero-2-0) für alle Kacheln einer Strecke
und speichert sie verkleinert (1 m/Pixel, JPEG) im Cache. Aufruf:
  python3 scripts/fetch-dop.py public/routes/hausrunde"""
import json, math, os, re, subprocess, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

route_dir = sys.argv[1]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
OUT = os.path.join(CACHE, 'dop1m'); os.makedirs(OUT, exist_ok=True)
BASE = 'https://www.opengeodata.nrw.de/produkte/geobasis/lusat/akt/dop/dop_jp2_f10/'
index = open(os.path.join(CACHE, 'dop_index.json')).read()
names = {f'{m.group(1)}_{m.group(2)}': m.group(0) for m in re.finditer(r'dop10rgbi_32_(\d{3})_(\d{4})_1_nw_\d{4}\.jp2', index)}
# gleiche Kachelauswahl wie prepare-world.mjs: alle Kacheln, die die Kacheln in .cache/dgm1 abdecken
keys = sorted({re.search(r'dgm1_32_(\d{3})_(\d{4})', f).group(1) + '_' + re.search(r'dgm1_32_(\d{3})_(\d{4})', f).group(2) for f in os.listdir(os.path.join(CACHE, 'dgm1'))})
print(f'{len(keys)} Kacheln', flush=True)
for n, key in enumerate(keys, 1):
    out = os.path.join(OUT, f'{key}.jpg')
    if os.path.exists(out) or key not in names: continue
    tmp = os.path.join(CACHE, 'dop_tmp.jp2')
    for attempt in range(4):
        r = subprocess.run(['curl', '-sS', '-f', '-m', '600', '-o', tmp, BASE + names[key]])
        if r.returncode == 0: break
    else:
        print(f'Fehler bei {key}', flush=True); continue
    im = Image.open(tmp); im.reduce = 3  # JPEG2000-Auflösungsstufe 1/8 → 0,8 m
    im.load()
    im = im.convert('RGB').resize((1000, 1000), Image.LANCZOS)
    im.save(out, quality=90)
    os.remove(tmp)
    print(f'{n}/{len(keys)} {key}', flush=True)
print('fertig', flush=True)
