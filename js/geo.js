// Geometry helpers and the uncovered-area grid.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const toRad = d => d * Math.PI / 180;
export const r6 = v => Math.round(v * 1e6) / 1e6;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const M_PER_DEG = 111320;

/** Great-circle distance in metres. */
export function hav(a1, o1, a2, o2) {
  const dLa = toRad(a2 - a1), dLo = toRad(o2 - o1);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLo / 2) ** 2;
  return 12742017.6 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Web Mercator, normalised to 0..1 (same maths Leaflet uses, divided by 256 * 2^zoom). */
export const wx = lng => (lng + 180) / 360;
export const wy = lat => {
  const s = Math.sin(toRad(clamp(lat, -85.0511, 85.0511)));
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/* ---------- uncovered area: a 10 m grid ---------- */
export const CELL = 10;
let offsets = [];
let offsetsFor = -1;

export function setRadius(r) {
  if (r === offsetsFor) return;
  offsetsFor = r;
  const k = r / CELL, n = Math.ceil(k);
  offsets = [];
  for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) if (dx * dx + dy * dy <= k * k + 0.25) offsets.push(dy, dx);
}

export const cellKey = (i, j) => (i + 2e6) * 1e7 + (j + 5e6);
export function cellCentre(key) {
  const i = Math.floor(key / 1e7) - 2e6, j = (key % 1e7) - 5e6;
  const lat = (i + 0.5) * CELL / M_PER_DEG;
  return [lat, (j + 0.5) * CELL / (M_PER_DEG * Math.cos(toRad(lat)))];
}

/** Adds the cells around a point. `onNew(key)` is called for cells that weren't in the set yet. */
export function markPoint(set, lat, lng, onNew) {
  const i0 = Math.floor(lat * M_PER_DEG / CELL);
  const j0 = Math.floor(lng * M_PER_DEG * Math.cos(toRad(lat)) / CELL);
  for (let q = 0; q < offsets.length; q += 2) {
    const k = cellKey(i0 + offsets[q], j0 + offsets[q + 1]);
    if (onNew) { const n = set.size; set.add(k); if (set.size !== n) onNew(k); }
    else set.add(k);
  }
}
export function markLine(set, a1, o1, a2, o2, onNew) {
  const steps = Math.max(1, Math.ceil(hav(a1, o1, a2, o2) / (CELL / 2)));
  for (let q = 1; q <= steps; q++) { const f = q / steps; markPoint(set, a1 + (a2 - a1) * f, o1 + (o2 - o1) * f, onNew); }
}
/** Walk segments are flat arrays: [lat, lng, secondsFromStart, ...]. */
export function markWalk(set, w) {
  for (const s of w.segs) {
    markPoint(set, s[0], s[1]);
    for (let k = 3; k < s.length; k += 3) markLine(set, s[k - 3], s[k - 2], s[k], s[k + 1]);
  }
}

/** Visit points along every segment, about `step` metres apart. */
export function eachSample(segs, step, fn) {
  for (const s of segs) {
    fn(s[0], s[1], s[2]);
    for (let k = 3; k < s.length; k += 3) {
      const a1 = s[k - 3], o1 = s[k - 2], a2 = s[k], o2 = s[k + 1];
      const n = Math.max(1, Math.ceil(hav(a1, o1, a2, o2) / step));
      for (let q = 1; q <= n; q++) { const f = q / n; fn(a1 + (a2 - a1) * f, o1 + (o2 - o1) * f, s[k + 2]); }
    }
  }
}

export function walkBoundsArr(w) {
  let a = 90, b = 180, c = -90, d = -180;
  for (const s of w.segs) for (let k = 0; k < s.length; k += 3) {
    const la = s[k], lo = s[k + 1];
    if (la < a) a = la; if (la > c) c = la; if (lo < b) b = lo; if (lo > d) d = lo;
  }
  return a > c ? null : [a, b, c, d];
}
