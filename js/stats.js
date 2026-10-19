// Weekly numbers and the km-per-week bar chart.

export function weekStart(ms) {
  const d = new Date(ms), back = (d.getDay() + 6) % 7; // Monday start
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}
function monthStart(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }

export function weekly(walks, n = 12, now = Date.now()) {
  const cur = new Date(weekStart(now)), weeks = [];
  for (let k = n - 1; k >= 0; k--) {
    const s = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 7 * k);
    weeks.push({ start: s.getTime(), km: 0, walks: 0 });
  }
  const idx = new Map(weeks.map((w, i) => [w.start, i]));
  for (const w of walks) {
    if (!w.start) continue;
    const i = idx.get(weekStart(w.start));
    if (i != null) { weeks[i].km += (w.dist || 0) / 1000; weeks[i].walks++; }
  }
  return weeks;
}

export function summary(walks, now = Date.now()) {
  const wk = weekStart(now), mo = monthStart(now), byWeek = new Map();
  let thisWeek = 0, thisMonth = 0, longest = null, timeMs = 0, pacedDist = 0, pacedMs = 0;
  for (const w of walks) {
    const km = (w.dist || 0) / 1000;
    if (!longest || km > longest.km) longest = { km, walk: w };
    if (w.dur > 0) {
      timeMs += w.dur;
      if (w.dist > 200) { pacedDist += w.dist; pacedMs += w.dur; }
    }
    if (!w.start) continue;
    if (w.start >= wk) thisWeek += km;
    if (w.start >= mo) thisMonth += km;
    const ws = weekStart(w.start);
    byWeek.set(ws, (byWeek.get(ws) || 0) + km);
  }
  let best = null;
  for (const [start, km] of byWeek) if (!best || km > best.km) best = { start, km };
  return { thisWeek, thisMonth, best, longest, timeMs, pace: pacedDist ? pacedMs / 1000 / (pacedDist / 1000) : 0 };
}

function niceMax(v) {
  if (v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const dm = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
export const weekLabel = ms => dm.format(new Date(ms));

/** Bars of km per week; the current week is highlighted. Each bar carries data-i for the readout. */
export function chartSVG(weeks) {
  const W = 600, H = 210, pl = 6, pr = 6, pt = 26, pb = 30, n = weeks.length;
  const max = niceMax(Math.max(...weeks.map(w => w.km), 0.5));
  const slot = (W - pl - pr) / n, bw = Math.min(30, slot - 8), plotH = H - pt - pb;
  const y = v => pt + plotH - (v / max) * plotH;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Kilometres walked per week, last ' + n + ' weeks">';
  for (const g of [max, max / 2]) {
    s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line)" stroke-dasharray="3 5"/>';
    s += '<text x="' + pl + '" y="' + (y(g) - 7) + '" class="ax">' + (+g.toFixed(1)) + ' km</text>';
  }
  s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line-strong)"/>';
  weeks.forEach((w, i) => {
    const cx = pl + slot * i + slot / 2, x = cx - bw / 2, top = y(w.km), h = y(0) - top, last = i === n - 1;
    if (w.km > 0) {
      const r = Math.min(4, h, bw / 2);
      s += '<path d="M' + x + ' ' + y(0) + 'V' + (top + r) + 'Q' + x + ' ' + top + ' ' + (x + r) + ' ' + top + 'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + top + ' ' + (x + bw) + ' ' + (top + r) + 'V' + y(0) + 'Z" fill="' + (last ? 'var(--lamp)' : 'var(--bar)') + '"/>';
    } else {
      s += '<rect x="' + x + '" y="' + (y(0) - 2) + '" width="' + bw + '" height="2" rx="1" fill="var(--line-strong)"/>';
    }
    if (i % 3 === 0 && i < n - 2) s += '<text x="' + cx + '" y="' + (H - 9) + '" class="ax" text-anchor="middle">' + weekLabel(w.start) + '</text>';
    if (last) s += '<text x="' + cx + '" y="' + (H - 9) + '" class="ax now" text-anchor="middle">This wk</text>';
    s += '<rect class="hit" data-i="' + i + '" x="' + (pl + slot * i) + '" y="' + pt + '" width="' + slot + '" height="' + (plotH + 4) + '" fill="transparent"/>';
  });
  return s + '</svg>';
}
