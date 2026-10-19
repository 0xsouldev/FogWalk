// Collectibles, streaks, badges and levels.
import { M_PER_DEG, toRad, hav, eachSample } from './geo.js';
import { island } from './island.js';

/* ---------- icons (24 x 24, stroked unless fill is set) ---------- */
export const ICONS = {
  steps: { fill: true, d: 'M8 3.5c1.7 0 2.5 1.8 2.3 4S8.9 10.5 7.6 10.5 5.3 9.3 5.5 7.3 6.4 3.5 8 3.5zM15.6 8.5c1.6 0 2.4 1.9 2.5 3.8.1 1.9-.9 3.2-2.3 3.2s-2.4-1.3-2.6-3.3c-.2-2.1.7-3.7 2.4-3.7zM6.6 13.5l3.6.6-.5 2.7c-.2 1.1-1.1 1.8-2 1.6s-1.6-1.1-1.4-2.2zM14 18.4l3.6-.6.3 1.7c.2 1.1-.4 2-1.4 2.2-.9.2-1.8-.5-2-1.6z' },
  route: { d: 'M5 19c4-1 3-6 7-6s4-6 7-7M5 19h.01M19 6h.01' },
  trophy: { d: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.5a2.8 2.8 0 0 0 2.8 3.6M16 6h2.5a2.8 2.8 0 0 1-2.8 3.6M12 13v4M8.5 20h7M10 17h4v3h-4z' },
  cloud: { d: 'M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 17.8 11.5 3.3 3.3 0 0 1 17.5 18z' },
  map: { d: 'M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20' },
  island: { d: 'M3 18c2.5 0 2.5-1.6 5-1.6s2.5 1.6 5 1.6 2.5-1.6 5-1.6 2 1 3 1.3M6 14.5c.6-4.6 3.2-7.5 6-7.5s5.4 2.9 6 7.5M12 7V3.5l3 1.5-3 1.5' },
  flame: { d: 'M12 3c.8 3.6 5 5.2 5 10a5 5 0 0 1-10 0c0-2.6 1.6-3.8 2-5.8 1 .9 1.8 2.2 1.9 3.8 1-1.9 1.4-4.9 1.1-8z' },
  sun: { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4' },
  moon: { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' },
  coin: { d: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 7.8a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4z' },
  scrap: { d: 'M5 4.5h11l-1.5 3 2 2.5-1.5 3 2 2.5-2 4H5zM8 9h4.5M8 13h3.5' },
  gem: { d: 'M6.5 4h11L21 9l-9 11L3 9zM3 9h18M12 20L8.5 9 10 4M12 20l3.5-11L14 4' },
  crown: { d: 'M4 18.5h16M4.5 18.5L3 7.5l5 4 4-6.5 4 6.5 5-4-1.5 11z' },
  pin: { d: 'M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21zM12 7.6a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z' },
  sparkle: { fill: true, d: 'M12 2.5l1.9 6.2 6.1 2.3-6.1 2.3L12 19.5l-1.9-6.2L4 11l6.1-2.3z' },
};
export function iconSVG(name, cls) {
  const ic = ICONS[name] || ICONS.sparkle;
  return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" aria-hidden="true"' + (ic.fill ? ' style="fill:currentColor;stroke:none"' : '') + '><path d="' + ic.d + '"/></svg>';
}

/* ---------- collectibles ---------- */
export const KINDS = {
  coin: { name: 'Coin', plural: 'Coins', xp: 5, color: '#ffcf5c', icon: 'coin' },
  scrap: { name: 'Map scrap', plural: 'Map scraps', xp: 15, color: '#7fd6c2', icon: 'scrap' },
  gem: { name: 'Gem', plural: 'Gems', xp: 50, color: '#b99aff', icon: 'gem' },
  crown: { name: 'Crown', plural: 'Crowns', xp: 200, color: '#ff8fb1', icon: 'crown' },
};
export const FIND_RADIUS = 35;     // metres. Walk this close to collect
export const HINT_RADIUS = 300;    // metres. Shimmer through the fog this close to you
const GRID = 200;                  // one possible collectible per 200 m square
const DLAT = GRID / M_PER_DEG;
const cache = new Map();

function hash(i, j, s) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const dLng = i => GRID / (M_PER_DEG * Math.cos(toRad((i + 0.5) * DLAT)));

/** The collectible hidden in grid square (i, j), or null. Same answer on every device. */
export function collectibleAt(i, j) {
  const key = i + ':' + j;
  if (cache.has(key)) return cache.get(key);
  let c = null;
  if (hash(i, j, 1) < 0.5) {
    const lat = (i + 0.15 + 0.7 * hash(i, j, 2)) * DLAT, lng = (j + 0.15 + 0.7 * hash(i, j, 3)) * dLng(i);
    const [a, b, cc, d] = island.ready ? island.bounds() : [0, 0, -1, -1];
    const nearIsland = lat >= a && lat <= cc && lng >= b && lng <= d;
    if (!nearIsland || island.contains(lat, lng)) {
      const r = hash(i, j, 4);
      c = { key, lat, lng, kind: r < 0.6 ? 'coin' : r < 0.85 ? 'scrap' : r < 0.97 ? 'gem' : 'crown' };
    }
  }
  cache.set(key, c);
  return c;
}
export function collectiblesNear(lat, lng, radius) {
  const out = [], i0 = Math.floor(lat / DLAT), n = Math.max(1, Math.ceil(radius / GRID));
  for (let di = -n; di <= n; di++) {
    const i = i0 + di, j0 = Math.floor(lng / dLng(i));
    for (let dj = -n; dj <= n; dj++) {
      const c = collectibleAt(i, j0 + dj);
      if (c && hav(lat, lng, c.lat, c.lng) <= radius) out.push(c);
    }
  }
  return out;
}
/** Everything a walk passes close enough to collect. Calls onFind(collectible, timeMs). */
export function findAlong(walk, onFind) {
  eachSample(walk.segs, 15, (lat, lng, dt) => {
    for (const c of collectiblesNear(lat, lng, FIND_RADIUS)) onFind(c, walk.start && dt >= 0 ? walk.start + dt * 1000 : (walk.start || walk.created));
  });
}

/* ---------- streaks ---------- */
const dayKey = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
function noon(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
export function streaks(walks, now = new Date()) {
  const days = new Set();
  for (const w of walks) if (w.start) days.add(dayKey(new Date(w.start)));
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const k of sorted) {
    const d = new Date(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100, 12);
    run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  let cur = 0, d = noon(now);
  if (!days.has(dayKey(d))) d = new Date(d.getTime() - 864e5);
  while (days.has(dayKey(d))) { cur++; d = new Date(d.getTime() - 864e5); }
  return { current: cur, best, walkedToday: days.has(dayKey(noon(now))) };
}

/* ---------- badges ---------- */
const isle = (pct, name) => ({ id: 'isle' + String(pct).replace('.', ''), name, desc: 'Uncover ' + pct + '% of the Isle of Wight', icon: 'island', unit: '%', prog: p => [p.islandPct, pct] });
export const BADGES = [
  { id: 'first', name: 'First Steps', desc: 'Save your first walk', icon: 'steps', prog: p => [p.walks, 1] },
  { id: 'km5', name: '5K Club', desc: 'Walk 5 km in total', icon: 'route', unit: 'km', prog: p => [p.totalKm, 5] },
  { id: 'km42', name: 'Marathoner', desc: 'Walk 42.2 km in total', icon: 'route', unit: 'km', prog: p => [p.totalKm, 42.2] },
  { id: 'km100', name: 'Centurion', desc: 'Walk 100 km in total', icon: 'route', unit: 'km', prog: p => [p.totalKm, 100] },
  { id: 'long5', name: 'Long Haul', desc: 'Walk 5 km in one go', icon: 'trophy', unit: 'km', prog: p => [p.longestKm, 5] },
  { id: 'long10', name: 'Epic Trek', desc: 'Walk 10 km in one go', icon: 'trophy', unit: 'km', prog: p => [p.longestKm, 10] },
  { id: 'area01', name: 'Fog Cutter', desc: 'Uncover 0.1 km²', icon: 'cloud', unit: 'km²', prog: p => [p.areaKm2, 0.1] },
  { id: 'area1', name: 'Cartographer', desc: 'Uncover 1 km²', icon: 'map', unit: 'km²', prog: p => [p.areaKm2, 1] },
  { id: 'area5', name: 'Mapmaker', desc: 'Uncover 5 km²', icon: 'map', unit: 'km²', prog: p => [p.areaKm2, 5] },
  isle(0.5, 'Islander'), isle(2, 'Wight Walker'), isle(5, 'Island Legend'),
  { id: 'streak3', name: 'On a Roll', desc: 'Walk 3 days in a row', icon: 'flame', unit: 'days', prog: p => [p.bestStreak, 3] },
  { id: 'streak7', name: 'Week Warrior', desc: 'Walk 7 days in a row', icon: 'flame', unit: 'days', prog: p => [p.bestStreak, 7] },
  { id: 'streak30', name: 'Unstoppable', desc: 'Walk 30 days in a row', icon: 'flame', unit: 'days', prog: p => [p.bestStreak, 30] },
  { id: 'early', name: 'Early Bird', desc: 'Start a walk between 4 and 7 am', icon: 'sun', prog: p => [p.early ? 1 : 0, 1] },
  { id: 'night', name: 'Night Owl', desc: 'Start a walk after 10 pm', icon: 'moon', prog: p => [p.night ? 1 : 0, 1] },
  { id: 'find1', name: 'Finders Keepers', desc: 'Find your first collectible', icon: 'coin', prog: p => [p.found.total, 1] },
  { id: 'find25', name: 'Treasure Hunter', desc: 'Find 25 collectibles', icon: 'coin', prog: p => [p.found.total, 25] },
  { id: 'gem', name: 'Shiny!', desc: 'Find a gem', icon: 'gem', prog: p => [p.found.gem, 1] },
  { id: 'crown', name: 'Royalty', desc: 'Find a crown', icon: 'crown', prog: p => [p.found.crown, 1] },
  { id: 'pins5', name: 'Pin Pal', desc: 'Drop 5 pins', icon: 'pin', prog: p => [p.pins, 5] },
];
export const badgeById = id => BADGES.find(b => b.id === id);
export function earnedNow(p) { return new Set(BADGES.filter(b => { const [a, t] = b.prog(p); return a >= t; }).map(b => b.id)); }

/* ---------- XP and levels ---------- */
export function xpFor(p, badgeCount) {
  let xp = Math.round(p.totalKm * 10) + badgeCount * 25 + p.pins * 5;
  for (const k in KINDS) xp += (p.found[k] || 0) * KINDS[k].xp;
  return xp;
}
export const xpAtLevel = L => 25 * L * (L - 1);
export const levelFor = xp => Math.max(1, Math.floor((1 + Math.sqrt(1 + 4 * xp / 25)) / 2));
