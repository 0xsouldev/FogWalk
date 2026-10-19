// Isle of Wight progress: a 50 m land mask built once from the coastline, used to count uncovered cells on the island.
import { ISLAND_NAME, ISLAND_RING } from './island-data.js';
import { M_PER_DEG, toRad, cellCentre, wx, wy } from './geo.js';

const RES = 50; // metres per mask pixel
const LAT0 = 50.68;
const KX = M_PER_DEG * Math.cos(toRad(LAT0)), KY = M_PER_DEG;

let mask = null, W = 0, H = 0, minLat = 0, minLng = 0, maxLat = 0, maxLng = 0, area = 0;

export const island = {
  name: ISLAND_NAME,
  get areaM2() { return area; },
  get ready() { return !!mask; },
  bounds() { return [minLat, minLng, maxLat, maxLng]; },
  contains(lat, lng) {
    if (!mask || lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return false;
    const x = Math.floor((lng - minLng) * KX / RES), y = Math.floor((maxLat - lat) * KY / RES);
    return x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  },
  countCells(cells) {
    if (!mask) return 0;
    let n = 0;
    for (const k of cells) { const c = cellCentre(k); if (this.contains(c[0], c[1])) n++; }
    return n;
  },
  /** Coastline as a drawable segment in normalised Mercator units. */
  outline() {
    const n = ISLAND_RING.length / 2 + 1, Wm = new Float64Array(n * 2);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const q = (k % (n - 1)) * 2, X = wx(ISLAND_RING[q + 1]), Y = wy(ISLAND_RING[q]);
      Wm[k * 2] = X; Wm[k * 2 + 1] = Y;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    return { W: Wm, n, x0, x1, y0, y1 };
  },
  ring() { const out = []; for (let k = 0; k < ISLAND_RING.length; k += 2) out.push([ISLAND_RING[k], ISLAND_RING[k + 1]]); return out; },
};

export function initIsland() {
  const r = ISLAND_RING;
  minLat = Infinity; maxLat = -Infinity; minLng = Infinity; maxLng = -Infinity;
  for (let k = 0; k < r.length; k += 2) {
    if (r[k] < minLat) minLat = r[k]; if (r[k] > maxLat) maxLat = r[k];
    if (r[k + 1] < minLng) minLng = r[k + 1]; if (r[k + 1] > maxLng) maxLng = r[k + 1];
  }
  // shoelace area in local metres
  let s = 0;
  for (let k = 0; k < r.length; k += 2) {
    const q = (k + 2) % r.length;
    s += r[k + 1] * KX * r[q] * KY - r[q + 1] * KX * r[k] * KY;
  }
  area = Math.abs(s) / 2;
  // rasterise
  W = Math.ceil((maxLng - minLng) * KX / RES) + 1; H = Math.ceil((maxLat - minLat) * KY / RES) + 1;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.beginPath();
  for (let k = 0; k < r.length; k += 2) {
    const x = (r[k + 1] - minLng) * KX / RES, y = (maxLat - r[k]) * KY / RES;
    k ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath(); g.fill();
  const px = g.getImageData(0, 0, W, H).data;
  mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
}
