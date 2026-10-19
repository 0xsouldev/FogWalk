// The share card: a 1080 x 1920 image of your fog map and stats.
import { wx, wy, toRad } from './geo.js';
import { KINDS } from './game.js';

/** Seamless soft-cloud texture used for the fog, on the map and on the card. */
export function makeFogTexture(size, seed = 7) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const t = c.getContext('2d');
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const k = size / 384;
  for (let n = 0; n < 70; n++) {
    const x = rnd() * size, y = rnd() * size, r = (20 + rnd() * 90) * k, a = 0.02 + rnd() * 0.05, light = rnd() > 0.35;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const g = t.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, light ? 'rgba(150,170,220,' + a + ')' : 'rgba(0,0,0,' + a * 1.4 + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
      t.fillStyle = g; t.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  return c;
}

function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
const UI = '"Schibsted Grotesk", "Avenir Next", "Segoe UI", system-ui, sans-serif';
const MONO = '"DM Mono", ui-monospace, Menlo, Consolas, monospace';
function spaced(g, px) { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; }

/**
 * opts: { walks, radius, trail, avatar (svg string), name, level, found:[{lat,lng,kind}], island:[[lat,lng]],
 *         headline:{label,value,unit}, stats:[{label,value,unit}], date, url }
 */
export async function renderCard(opts, withAvatar = true) {
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  try { await Promise.all(['800 64px', '700 44px', '600 30px'].map(f => document.fonts.load(f + ' "Schibsted Grotesk"')).concat(['500 60px', '400 28px'].map(f => document.fonts.load(f + ' "DM Mono"')))); } catch (e) {}

  // background
  g.fillStyle = '#0c101b'; g.fillRect(0, 0, W, H);
  const tex = makeFogTexture(768, 11);
  g.fillStyle = g.createPattern(tex, 'repeat'); g.fillRect(0, 0, W, H);

  // header
  rr(g, 60, 78, 76, 76, 20); g.fillStyle = '#151c2e'; g.fill();
  g.save(); g.translate(60, 78); g.scale(76 / 64, 76 / 64);
  g.lineCap = 'round';
  const mark = new Path2D('M12 50c6-10 16-8 20-18s14-12 20-18');
  g.strokeStyle = '#3a4560'; g.lineWidth = 16; g.stroke(mark);
  g.strokeStyle = opts.trail; g.lineWidth = 5; g.stroke(mark);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(52, 14, 5.5, 0, Math.PI * 2); g.fill();
  g.restore();
  g.fillStyle = '#eef1f8'; g.font = '800 62px ' + UI; g.textBaseline = 'middle'; spaced(g, -1.5);
  g.fillText('Fogwalk', 160, 118);
  spaced(g, 1); g.font = '400 28px ' + MONO; g.fillStyle = '#8f99b4'; g.textAlign = 'right';
  g.fillText(opts.date, W - 60, 118); g.textAlign = 'left';

  // map panel
  const mx = 60, my = 210, mw = 960, mh = 1000;
  g.save(); rr(g, mx, my, mw, mh, 44); g.clip();
  g.fillStyle = '#2a3552'; g.fillRect(mx, my, mw, mh);
  // project the walks into the panel
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, latSum = 0, latN = 0;
  const proj = opts.walks.map(w => w.segs.map(s => { const a = []; for (let k = 0; k < s.length; k += 3) { const X = wx(s[k + 1]), Y = wy(s[k]); a.push(X, Y); if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; latSum += s[k]; latN++; } return a; }));
  const lat = latN ? latSum / latN : 50.7;
  const pad = 0.14, dx = Math.max(x1 - x0, 1e-9), dy = Math.max(y1 - y0, 1e-9);
  let scale = Math.min(mw * (1 - 2 * pad) / dx, mh * (1 - 2 * pad) / dy);
  scale = Math.min(scale, 40075016 * Math.cos(toRad(lat)) / 0.9); // never closer than ~0.9 m per pixel
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const P = (X, Y) => [mx + mw / 2 + (X - cx) * scale, my + mh / 2 + (Y - cy) * scale];
  const mpp = 40075016 * Math.cos(toRad(lat)) / scale;
  const trace = (ctx, pts) => { for (const segs of pts) for (const a of segs) { for (let k = 0; k < a.length; k += 2) { const [x, y] = P(a[k], a[k + 1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } if (a.length === 2) { const [x, y] = P(a[0], a[1]); ctx.lineTo(x + 0.01, y); } } };

  // fog layer with the walked areas cut out
  const fog = document.createElement('canvas'); fog.width = mw; fog.height = mh;
  const f = fog.getContext('2d');
  f.translate(-mx, -my);
  f.fillStyle = 'rgba(13,18,32,0.94)'; f.fillRect(mx, my, mw, mh);
  f.fillStyle = f.createPattern(tex, 'repeat'); f.fillRect(mx, my, mw, mh);
  const rpx = Math.max(7, opts.radius / mpp);
  f.globalCompositeOperation = 'destination-out'; f.lineCap = f.lineJoin = 'round';
  f.beginPath(); trace(f, proj);
  f.globalAlpha = 0.45; f.lineWidth = rpx * 2.6; f.stroke();
  f.globalAlpha = 0.75; f.lineWidth = rpx * 2; f.stroke();
  f.globalAlpha = 1; f.lineWidth = rpx * 1.4; f.stroke();
  g.drawImage(fog, mx, my);

  // coastline for context
  if (opts.island && opts.island.length) {
    g.beginPath();
    opts.island.forEach(([la, lo], i) => { const [x, y] = P(wx(lo), wy(la)); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.setLineDash([10, 12]); g.strokeStyle = 'rgba(160,180,230,0.32)'; g.lineWidth = 2.5; g.stroke(); g.setLineDash([]);
  }
  // paths
  g.lineCap = g.lineJoin = 'round';
  g.beginPath(); trace(g, proj);
  g.save(); g.shadowColor = opts.trail; g.shadowBlur = 24; g.strokeStyle = opts.trail; g.globalAlpha = 0.5; g.lineWidth = 10; g.stroke(); g.restore();
  g.strokeStyle = opts.trail; g.lineWidth = 5; g.stroke();
  // collectibles found here
  for (const it of opts.found || []) {
    const [x, y] = P(wx(it.lng), wy(it.lat));
    if (x < mx || x > mx + mw || y < my || y > my + mh) continue;
    g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fillStyle = KINDS[it.kind].color; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#0c101b'; g.stroke();
  }
  // avatar at the end of the latest path
  let endPt = null;
  const lastW = proj[proj.length - 1];
  if (lastW && lastW.length) { const a = lastW[lastW.length - 1]; endPt = P(a[a.length - 2], a[a.length - 1]); }
  if (withAvatar && opts.avatar && endPt) {
    try { const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(opts.avatar)); g.drawImage(img, endPt[0] - 70, endPt[1] - 128, 140, 140); } catch (e) {}
  }
  g.restore();
  g.strokeStyle = 'rgba(186,202,255,0.16)'; g.lineWidth = 2; rr(g, mx, my, mw, mh, 44); g.stroke();

  // headline
  const h = opts.headline;
  g.textBaseline = 'alphabetic';
  spaced(g, 5); g.font = '500 28px ' + MONO; g.fillStyle = '#8f99b4'; g.fillText(h.label.toUpperCase(), 64, 1300);
  spaced(g, -6); g.font = '500 170px ' + MONO; g.fillStyle = opts.trail === '#ffffff' ? '#ffb547' : opts.trail;
  g.fillText(h.value, 56, 1458);
  const vw = g.measureText(h.value).width;
  spaced(g, 0); g.font = '400 52px ' + MONO; g.fillStyle = '#8f99b4'; g.fillText(h.unit, 56 + vw + 18, 1458);

  // stats row
  const colW = (W - 120) / opts.stats.length;
  opts.stats.forEach((s, i) => {
    const x = 64 + i * colW;
    if (i) { g.fillStyle = 'rgba(186,202,255,0.14)'; g.fillRect(x - 24, 1520, 2, 120); }
    spaced(g, 4); g.font = '500 24px ' + MONO; g.fillStyle = '#8f99b4'; g.fillText(s.label.toUpperCase(), x, 1550);
    spaced(g, -2); g.font = '500 62px ' + MONO; g.fillStyle = '#eef1f8'; g.fillText(s.value, x, 1625);
    const w = g.measureText(s.value).width;
    spaced(g, 0); g.font = '400 26px ' + MONO; g.fillStyle = '#8f99b4'; if (s.unit) g.fillText(s.unit, x + w + 8, 1625);
  });

  // footer
  g.fillStyle = 'rgba(186,202,255,0.14)'; g.fillRect(64, 1700, W - 128, 2);
  let fx = 64;
  if (withAvatar && opts.avatar) {
    try { const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(opts.avatar)); g.drawImage(img, 52, 1724, 128, 128); fx = 196; } catch (e) {}
  }
  spaced(g, -0.5); g.font = '700 44px ' + UI; g.fillStyle = '#eef1f8'; g.fillText(opts.name, fx, 1784);
  spaced(g, 1); g.font = '400 28px ' + MONO; g.fillStyle = '#8f99b4'; g.fillText('Level ' + opts.level + ' explorer', fx, 1830);
  if (opts.url) { g.textAlign = 'right'; g.font = '400 26px ' + MONO; g.fillText(opts.url, W - 64, 1830); g.textAlign = 'left'; }

  return new Promise((res, rej) => {
    try { c.toBlob(b => b ? res(b) : rej(new Error('blob')), 'image/png'); }
    catch (e) { if (withAvatar) renderCard(opts, false).then(res, rej); else rej(e); }
  });
}
