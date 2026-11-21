"""Gemeinsame Koordinatenhilfen: UTM32 (ETRS89) ⇄ lokale Streckenkoordinaten (x Ost, y Nord in m um route.origin)."""
import math
import numpy as np

a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
e2 = f * (2 - f); ep2 = e2 / (1 - e2); L0 = math.radians(9)

def from_utm(E, N):
    E = np.asarray(E, float); N = np.asarray(N, float)
    x = E - 500000; M = N / k0; mu = M / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - np.sqrt(1 - e2)) / (1 + np.sqrt(1 - e2))
    p1 = mu + (3*e1/2 - 27*e1**3/32)*np.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32)*np.sin(4*mu) + (151*e1**3/96)*np.sin(6*mu)
    N1 = a / np.sqrt(1 - e2*np.sin(p1)**2); T1 = np.tan(p1)**2; C1 = ep2*np.cos(p1)**2
    R1 = a*(1 - e2)/(1 - e2*np.sin(p1)**2)**1.5; D = x/(N1*k0)
    lat = p1 - (N1*np.tan(p1)/R1)*(D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*ep2)*D**4/24 + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*ep2 - 3*C1**2)*D**6/720)
    lon = L0 + (D - (1 + 2*T1 + C1)*D**3/6 + (5 - 2*C1 + 28*T1 + 3*C1**2 + 8*ep2 + 24*T1**2)*D**5/120)/np.cos(p1)
    return np.degrees(lat), np.degrees(lon)

def to_utm(lat, lon):
    phi = np.radians(np.asarray(lat, float)); lam = np.radians(np.asarray(lon, float))
    N = a / np.sqrt(1 - e2 * np.sin(phi)**2); T = np.tan(phi)**2; C = ep2 * np.cos(phi)**2; A = np.cos(phi) * (lam - L0)
    M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256)*phi - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024)*np.sin(2*phi) + (15*e2**2/256 + 45*e2**3/1024)*np.sin(4*phi) - (35*e2**3/3072)*np.sin(6*phi))
    E = 500000 + k0 * N * (A + (1 - T + C)*A**3/6 + (5 - 18*T + T**2 + 72*C - 58*ep2)*A**5/120)
    Nn = k0 * (M + N*np.tan(phi)*(A**2/2 + (5 - T + 9*C + 4*C**2)*A**4/24 + (61 - 58*T + T**2 + 600*C - 330*ep2)*A**6/720))
    return E, Nn

class Local:
    def __init__(self, route):
        self.lat0, self.lon0 = route['origin']['lat'], route['origin']['lon']
        R = 6378137.0; self.kx = R * math.cos(math.radians(self.lat0)) * math.pi / 180; self.ky = R * math.pi / 180
    def from_utm(self, E, N):
        la, lo = from_utm(E, N); return (lo - self.lon0) * self.kx, (la - self.lat0) * self.ky
    def to_utm(self, x, y):
        return to_utm(self.lat0 + np.asarray(y, float) / self.ky, self.lon0 + np.asarray(x, float) / self.kx)
