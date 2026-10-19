// Fogwalk: map, fog drawing, tracking and all the UI wiring.
import { toRad, r6, uid, hav, wx, wy, CELL, setRadius, markPoint, markLine, markWalk, cellCentre, walkBoundsArr } from './geo.js';
import { island, initIsland } from './island.js';
import { DB, loadLocal, saveLocal, onStorageFallback } from './store.js';
import { parseText, walkFromTrack, validWalk, validPin, loadJSZip, TRACK_EXT, MAX_SPEED, MIN_STEP } from './parse.js';
import { KINDS, ICONS, iconSVG, FIND_RADIUS, HINT_RADIUS, collectiblesNear, findAlong, streaks, BADGES, badgeById, earnedNow, xpFor, xpAtLevel, levelFor } from './game.js';
import { PARTS, DEFAULT_AVATAR, isUnlocked, unlockText, part, effective, trailHex, avatarSVG } from './avatar.js';
import { weekly, summary as statSummary, chartSVG, weekLabel } from './stats.js';
import { renderCard, makeFogTexture } from './share.js';

const $ = s => document.querySelector(s);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

const TILES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  carto: { url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key={key}', maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attribution/">CARTO</a>' },
};
const GPS_MAX_ACC = 35;   // metres. Less accurate fixes are ignored
const PIN_EMOJI = ['📍', '⭐', '📸', '☕', '🌳', '🌊', '🏠', '❤️'];

/* ---------- state ---------- */
const settings = loadLocal('fogwalk.settings', { mode: 'fog', radius: 25, style: 'osm', cartoKey: '', introDismissed: false, tab: 'walks' });
if (![15, 25, 50].includes(settings.radius)) settings.radius = 25;
if (!['fog', 'lines', 'heat'].includes(settings.mode)) settings.mode = 'fog';
const saveSettings = () => saveLocal('fogwalk.settings', settings);
let avatarCfg = loadLocal('fogwalk.avatar', DEFAULT_AVATAR);
const earnedLog = loadLocal('fogwalk.badges', {});

let WALKS = [], PINS = [];
const PREP = new Map();
let CELLS = new Set(), islandCells = 0, TOTAL_DIST = 0;
let FOUND = new Map();
let live = null, selectedId = null, mePos = null, placing = false;
let profile = null, earnedSet = new Set(), xp = 0, level = 0;
const unlockCtx = () => ({ level, earned: earnedSet });
const eff = () => effective(avatarCfg, unlockCtx());

/* ---------- formatting ---------- */
const fmtKm = (m, dp) => { const km = m / 1000; return km.toFixed(dp != null ? dp : (km < 10 ? 2 : 1)); };
const fmtArea = m2 => m2 < 10000 ? [Math.round(m2).toLocaleString('en-GB'), 'm²'] : [(m2 / 1e6).toFixed(m2 < 1e7 ? 2 : 1), 'km²'];
const fmtPct = p => p <= 0 ? '0.00' : p < 0.01 ? '<0.01' : p < 10 ? p.toFixed(2) : p.toFixed(1);
function fmtClock(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0'); }
const fmtPace = sec => sec > 0 && isFinite(sec) ? Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0') : '–';
const paceOf = w => w.dur > 0 && w.dist > 50 ? fmtPace(w.dur / 1000 / (w.dist / 1000)) : '–';
const dFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const tFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const yFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function whenText(ms) { if (!ms) return ''; const d = new Date(ms); return (d.getFullYear() === new Date().getFullYear() ? dFmt.format(d) : yFmt.format(d)) + ', ' + tFmt.format(d); }
function durText(ms) { if (!ms || ms < 0) return ''; const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- toasts ---------- */
const toastEl = $('#toast');
// Plain toasts show straight away; celebrations (finds, badges, levels) queue up and play one after another.
let toastT = 0;
const queue = [];
function showToast(html, ms, win) {
  toastEl.innerHTML = html; toastEl.classList.toggle('win', !!win); toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.classList.remove('show'); toastT = 0; setTimeout(nextQueued, 260); }, ms || 4200);
}
function toast(msg, ms) { showToast(esc(msg), ms); }
function hideToast() { clearTimeout(toastT); toastT = 0; toastEl.classList.remove('show'); setTimeout(nextQueued, 260); }
function celebrate(html) { queue.push(html); if (!toastT) nextQueued(); }
function nextQueued() { if (!toastT && queue.length) showToast(queue.shift(), 3000, true); }
function kindToast(kind) { const k = KINDS[kind]; return '<span class="tic" style="background:' + k.color + '">' + iconSVG(k.icon, 'i sm') + '</span><span>Found a ' + k.name.toLowerCase() + '! <b>+' + k.xp + ' XP</b></span>'; }
onStorageFallback(() => setTimeout(() => toast('This browser won’t save walks. They’ll be gone when you close the page.', 6000), 800));

/* ---------- modal ---------- */
function modal(title, body, buttons) {
  return new Promise(res => {
    const dlg = $('#dialog'), b = $('#dlgBody'), btns = $('#dlgBtns');
    $('#dlgTitle').textContent = title;
    b.innerHTML = '';
    if (typeof body === 'string') { const p = document.createElement('p'); p.textContent = body; b.appendChild(p); } else if (body) b.appendChild(body);
    btns.innerHTML = '';
    buttons.forEach(o => {
      const el = document.createElement('button');
      el.textContent = o.label; el.className = o.kind === 'primary' ? 'primary' : o.kind === 'danger' ? 'dangerfill' : 'ghost';
      el.addEventListener('click', async () => {
        if (o.run) { const keep = await o.run(); if (keep === false) return; }
        dlg.hidden = true; res(o.value);
      });
      btns.appendChild(el);
    });
    dlg.hidden = false;
    const f = btns.querySelector('.primary,.dangerfill') || btns.lastChild; if (f) f.focus();
  });
}
const ask = (title, body, no, yes, danger) => modal(title, body, [{ label: no, value: false }, { label: yes, kind: danger ? 'danger' : 'primary', value: true }]);

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false, minZoom: 3, maxZoom: 19 });
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
let tileLayer = null, tileErrors = 0;
function setTiles() {
  const useCarto = settings.style === 'carto' && settings.cartoKey.trim();
  const t = useCarto ? TILES.carto : TILES.osm;
  if (tileLayer) map.removeLayer(tileLayer);
  tileErrors = 0;
  tileLayer = L.tileLayer(t.url, { maxZoom: t.maxZoom, maxNativeZoom: 19, attribution: t.attribution, key: encodeURIComponent(settings.cartoKey.trim()) });
  tileLayer.on('tileerror', () => { if (++tileErrors === 6) toast(useCarto ? 'CARTO tiles aren’t loading. Check your key, or switch to OpenStreetMap.' : 'Map tiles aren’t loading. Check your connection.'); });
  tileLayer.addTo(map);
}
for (const [name, z, events] of [['fog', 450, false], ['pins', 630, true], ['me', 640, false]]) {
  const p = map.createPane(name); p.style.zIndex = z; if (!events) p.style.pointerEvents = 'none';
}

/* ---------- fog canvas ---------- */
const canvas = document.createElement('canvas');
canvas.className = 'leaflet-zoom-animated';
map.getPane('fog').appendChild(canvas);
const ctx = canvas.getContext('2d');
let DPR = 1, CW = 0, CH = 0, PAD = 0;
function sizeCanvas() {
  const s = map.getSize();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  PAD = Math.round(Math.max(s.x, s.y) * 0.15);
  CW = s.x + PAD * 2; CH = s.y + PAD * 2;
  canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
}
const TEX = 384;
const fogPattern = ctx.createPattern(makeFogTexture(TEX), 'repeat');
const KIND_PATH = Object.fromEntries(Object.keys(KINDS).map(k => [k, new Path2D(ICONS[KINDS[k].icon].d)]));
const SPARK = new Path2D(ICONS.sparkle.d);
let ISLAND_SEG = null;

function prepSegs(segs) {
  return segs.map(s => {
    const n = s.length / 3, W = new Float64Array(n * 2);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const X = wx(s[k * 3 + 1]), Y = wy(s[k * 3]); W[k * 2] = X; W[k * 2 + 1] = Y;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    return { W, n, x0, x1, y0, y1 };
  });
}
function view() {
  const c = map.getCenter(), z = map.getZoom();
  return { cx: wx(c.lng), cy: wy(c.lat), scale: 256 * Math.pow(2, z), z, lat: c.lat };
}
const toPx = (v, X, Y) => [(X - v.cx) * v.scale + CW / 2, (Y - v.cy) * v.scale + CH / 2];
function inView(v, x, y, m) { return x > -m && y > -m && x < CW + m && y < CH + m; }
function trace(segs, v, padPx) {
  const hw = (CW / 2 + padPx) / v.scale, hh = (CH / 2 + padPx) / v.scale;
  const minX = v.cx - hw, maxX = v.cx + hw, minY = v.cy - hh, maxY = v.cy + hh, ox = CW / 2, oy = CH / 2;
  for (const s of segs) {
    if (!s.n || s.x1 < minX || s.x0 > maxX || s.y1 < minY || s.y0 > maxY) continue;
    const W = s.W;
    let lx = (W[0] - v.cx) * v.scale + ox, ly = (W[1] - v.cy) * v.scale + oy;
    ctx.moveTo(lx, ly);
    if (s.n === 1) { ctx.lineTo(lx + 0.01, ly); continue; }
    for (let k = 1; k < s.n; k++) {
      const x = (W[k * 2] - v.cx) * v.scale + ox, y = (W[k * 2 + 1] - v.cy) * v.scale + oy;
      if (k < s.n - 1 && Math.abs(x - lx) < 1.2 && Math.abs(y - ly) < 1.2) continue;
      ctx.lineTo(x, y); lx = x; ly = y;
    }
  }
}
const OLD = [200, 107, 143], MID = [255, 122, 89], NEW = [255, 181, 71];
function recencyColor(f, a) {
  const c = f < 0.5 ? OLD.map((v, i) => v + (MID[i] - v) * f * 2) : MID.map((v, i) => v + (NEW[i] - v) * (f - 0.5) * 2);
  return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
const byStart = (a, b) => (a.start || a.created) - (b.start || b.created);

let animating = false, drawQueued = false;
function requestDraw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; if (!animating) draw(); }); }
function draw() {
  L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]).subtract([PAD, PAD]));
  const v = view();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, CW, CH);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const mpp = 40075016.686 * Math.cos(toRad(v.lat)) / v.scale;
  const livePrep = live ? live.prep : null, trail = trailHex(eff());

  if (settings.mode === 'fog') {
    ctx.fillStyle = 'rgba(12,16,27,0.87)'; ctx.fillRect(0, 0, CW, CH);
    if (fogPattern && fogPattern.setTransform) {
      fogPattern.setTransform(new DOMMatrix([1, 0, 0, 1, (CW / 2 - v.cx * v.scale) % TEX, (CH / 2 - v.cy * v.scale) % TEX]));
      ctx.fillStyle = fogPattern; ctx.fillRect(0, 0, CW, CH);
    }
    const r = Math.max(1.6, settings.radius / mpp);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    for (const w of WALKS) trace(PREP.get(w.id) || [], v, r * 1.4);
    if (livePrep) trace(livePrep, v, r * 1.4);
    ctx.globalAlpha = 0.42; ctx.lineWidth = r * 2.6; ctx.stroke();
    ctx.globalAlpha = 0.7; ctx.lineWidth = r * 2; ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = r * 1.4; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    if (ISLAND_SEG && v.z >= 9) {
      ctx.beginPath(); trace([ISLAND_SEG], v, 4);
      ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(160,180,230,0.3)'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
    }
    if (livePrep) { ctx.beginPath(); trace(livePrep, v, 4); ctx.strokeStyle = trail; ctx.lineWidth = 3; ctx.stroke(); }
  } else if (settings.mode === 'lines') {
    const sorted = WALKS.slice().sort(byStart), n = sorted.length;
    ctx.globalCompositeOperation = 'lighter';
    sorted.forEach((w, i) => {
      const f = n > 1 ? i / (n - 1) : 1;
      ctx.beginPath(); trace(PREP.get(w.id) || [], v, 10);
      ctx.strokeStyle = recencyColor(f, 0.16); ctx.lineWidth = 10; ctx.stroke();
      ctx.strokeStyle = recencyColor(f, 0.95); ctx.lineWidth = 2.6; ctx.stroke();
    });
    if (livePrep) { ctx.beginPath(); trace(livePrep, v, 10); ctx.strokeStyle = hexA(trail, 0.2); ctx.lineWidth = 12; ctx.stroke(); ctx.strokeStyle = trail; ctx.lineWidth = 3.2; ctx.stroke(); }
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // heat: every walk adds light, so streets you repeat glow red, then orange, then yellow
    ctx.globalCompositeOperation = 'lighter';
    const paths = WALKS.map(w => PREP.get(w.id) || []);
    if (livePrep) paths.push(livePrep);
    const wide = Math.max(4, Math.min(9, 3 + v.z - 13));
    for (const segs of paths) { ctx.beginPath(); trace(segs, v, 10); ctx.strokeStyle = 'rgba(255,60,20,0.07)'; ctx.lineWidth = wide * 3; ctx.stroke(); ctx.strokeStyle = 'rgba(255,72,30,0.34)'; ctx.lineWidth = wide; ctx.stroke(); }
    ctx.globalCompositeOperation = 'source-over';
  }

  if (selectedId && PREP.has(selectedId)) {
    ctx.beginPath(); trace(PREP.get(selectedId), v, 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
  }
  // collectibles you've found
  if (v.z >= 13 && FOUND.size) {
    const rr = v.z >= 16 ? 11 : 8;
    for (const f of FOUND.values()) {
      const [x, y] = toPx(v, wx(f.lng), wy(f.lat));
      if (!inView(v, x, y, 20)) continue;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fillStyle = KINDS[f.kind].color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#0c101b'; ctx.stroke();
      if (rr > 9) { ctx.save(); ctx.translate(x - 6.5, y - 6.5); ctx.scale(13 / 24, 13 / 24); ctx.strokeStyle = '#1b1626'; ctx.lineWidth = 2.6; ctx.stroke(KIND_PATH[f.kind]); ctx.restore(); }
    }
  }
  // treasure shimmering through the fog near you
  if (mePos && v.z >= 14) {
    for (const c of collectiblesNear(mePos.lat, mePos.lng, HINT_RADIUS)) {
      if (FOUND.has(c.key)) continue;
      const [x, y] = toPx(v, wx(c.lng), wy(c.lat));
      if (!inView(v, x, y, 20)) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 18); g.addColorStop(0, 'rgba(220,210,255,0.45)'); g.addColorStop(1, 'rgba(220,210,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 18, y - 18, 36, 36);
      ctx.save(); ctx.translate(x - 8, y - 8); ctx.scale(16 / 24, 16 / 24); ctx.fillStyle = 'rgba(245,240,255,0.9)'; ctx.fill(SPARK); ctx.restore();
    }
  }
}
map.on('move zoom viewreset', requestDraw);
map.on('resize', () => { sizeCanvas(); requestDraw(); });
map.on('zoomanim', e => {
  animating = true;
  const v0 = view(), s = map.getZoomScale(e.zoom, v0.z), sc1 = 256 * Math.pow(2, e.zoom), size = map.getSize();
  const tx = (v0.cx - wx(e.center.lng)) * sc1 + size.x / 2 * (1 - s), ty = (v0.cy - wy(e.center.lat)) * sc1 + size.y / 2 * (1 - s);
  L.DomUtil.setTransform(canvas, map.containerPointToLayerPoint([0, 0]).add([tx - PAD * s, ty - PAD * s]), s);
});
map.on('zoomend', () => { animating = false; requestDraw(); });
map.on('click', () => { if (placing) return; if (!$('#summary').hidden) hideSummary(); else if (selectedId) { selectedId = null; renderWalkList(); requestDraw(); } });

/* ---------- progress: area, island, finds, badges, XP ---------- */
const isEarly = w => { if (!w.start) return false; const h = new Date(w.start).getHours(); return h >= 4 && h < 7; };
const isNight = w => { if (!w.start) return false; const h = new Date(w.start).getHours(); return h >= 22 || h < 4; };
function liveAsWalk() {
  return { id: 'live', start: live.start, segs: live.segs.filter(s => s.length).map(s => { const a = []; s.forEach(p => a.push(p.lat, p.lng, Math.round((p.t - live.start) / 1000))); return a; }) };
}
function recomputeAll(silent) {
  setRadius(settings.radius);
  CELLS = new Set();
  const sorted = WALKS.slice().sort(byStart);
  for (const w of sorted) markWalk(CELLS, w);
  islandCells = island.countCells(CELLS);
  TOTAL_DIST = WALKS.reduce((t, w) => t + (w.dist || 0), 0);
  FOUND = new Map();
  for (const w of sorted) findAlong(w, (c, t) => { if (!FOUND.has(c.key)) FOUND.set(c.key, Object.assign({}, c, { t, walkId: w.id })); });
  if (live) {
    live.newCells = 0; live.finds = [];
    const onNew = k => { live.newCells++; const c = cellCentre(k); if (island.contains(c[0], c[1])) islandCells++; };
    for (const seg of live.segs) { if (!seg.length) continue; markPoint(CELLS, seg[0].lat, seg[0].lng, onNew); for (let k = 1; k < seg.length; k++) markLine(CELLS, seg[k - 1].lat, seg[k - 1].lng, seg[k].lat, seg[k].lng, onNew); }
    findAlong(liveAsWalk(), (c, t) => { if (!FOUND.has(c.key)) { FOUND.set(c.key, Object.assign({}, c, { t, walkId: 'live' })); live.finds.push(c.kind); } });
  }
  refreshProgress(silent);
}
function computeProfile() {
  const st = streaks(WALKS), found = { coin: 0, scrap: 0, gem: 0, crown: 0, total: 0 };
  for (const f of FOUND.values()) { found[f.kind]++; found.total++; }
  let longest = 0; for (const w of WALKS) longest = Math.max(longest, w.dist || 0);
  if (live) longest = Math.max(longest, live.dist);
  return {
    walks: WALKS.length, totalKm: (TOTAL_DIST + (live ? live.dist : 0)) / 1000, longestKm: longest / 1000,
    areaKm2: CELLS.size * CELL * CELL / 1e6, islandPct: island.areaM2 ? islandCells * CELL * CELL / island.areaM2 * 100 : 0,
    streak: st.current, bestStreak: st.best, early: WALKS.some(isEarly), night: WALKS.some(isNight), found, pins: PINS.length,
  };
}
function unlockedBy(test) {
  const out = [];
  for (const k of Object.keys(PARTS)) for (const it of PARTS[k].items) if (it.req && test(it.req)) out.push(it.label);
  return out.length > 4 ? out.slice(0, 3).concat(['and ' + (out.length - 3) + ' more']) : out;
}
function refreshProgress(silent) {
  profile = computeProfile();
  const now = earnedNow(profile), fresh = [...now].filter(id => !earnedLog[id]);
  fresh.forEach(id => { earnedLog[id] = Date.now(); });
  if (fresh.length) saveLocal('fogwalk.badges', earnedLog);
  earnedSet = now;
  const prev = level;
  xp = xpFor(profile, earnedSet.size); level = levelFor(xp);
  if (!silent) {
    fresh.slice(0, 4).forEach(id => {
      const b = badgeById(id), items = unlockedBy(r => r.badge === id);
      celebrate('<span class="tic" style="background:var(--lamp)">' + iconSVG(b.icon, 'i sm') + '</span><span>Badge: <b>' + esc(b.name) + '</b>' + (items.length ? '<br>Unlocked ' + esc(items.join(', ')) : '') + '</span>');
    });
    if (fresh.length > 4) celebrate('<span>And ' + (fresh.length - 4) + ' more badges</span>');
    if (prev && level > prev) {
      const items = unlockedBy(r => r.level > prev && r.level <= level);
      celebrate('<span class="tic" style="background:var(--good)">' + iconSVG('star', 'i sm') + '</span><span><b>Level ' + level + '!</b>' + (items.length ? ' Unlocked ' + esc(items.join(', ')) : '') + '</span>');
    }
  }
  renderHUD(); updateMeIcon(); requestDraw();
  const sig = [level, earnedSet.size, WALKS.length, PINS.length, FOUND.size, settings.radius].join(':');
  if (!$('#sheet').hidden && sig !== sheetSig) { const st = $('#sheetBody').scrollTop; renderTab(); $('#sheetBody').scrollTop = st; }
}
let sheetSig = '';

/* ---------- HUD ---------- */
const topEl = $('#top'), bottomEl = $('#bottom');
function renderHUD() {
  const [a, u] = fmtArea(CELLS.size * CELL * CELL);
  $('#stArea').textContent = a; $('#stAreaU').textContent = u;
  $('#stIsle').textContent = fmtPct(profile ? profile.islandPct : 0);
  $('#stDist').textContent = fmtKm(TOTAL_DIST + (live ? live.dist : 0));
  const s = profile ? profile.streak : 0;
  $('#streakChip').hidden = !s; $('#streakN').textContent = s;
  $('#streakChip').title = s + (s === 1 ? ' day streak' : ' day streak');
  updateLiveStats();
}
function layoutUI() {
  const th = topEl.getBoundingClientRect().bottom, bh = window.innerHeight - bottomEl.getBoundingClientRect().top;
  document.documentElement.style.setProperty('--top-h', Math.max(0, th) + 'px');
  document.documentElement.style.setProperty('--bottom-h', Math.max(0, bh) + 'px');
}
if ('ResizeObserver' in window) { const ro = new ResizeObserver(layoutUI); ro.observe(topEl); ro.observe(bottomEl); }
window.addEventListener('resize', layoutUI);
const uiPadding = () => ({ paddingTopLeft: [24, topEl.getBoundingClientRect().bottom + 16], paddingBottomRight: [24, window.innerHeight - bottomEl.getBoundingClientRect().top + 16] });

const modeBtns = Array.from(document.querySelectorAll('[data-mode]'));
function setMode(m) {
  settings.mode = m; saveSettings();
  modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  document.body.classList.toggle('mode-lines', m === 'lines');
  document.body.classList.toggle('mode-heat', m === 'heat');
  requestDraw();
}
modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

/* bottom bar states */
function setBottom(state) {
  $('#idleBar').hidden = state !== 'idle';
  $('#placeBar').hidden = state !== 'place';
  $('#liveCard').hidden = state !== 'live';
  $('#summary').hidden = state !== 'summary';
  $('#crosshair').hidden = state !== 'place';
  if (state !== 'live') $('#btnRecenter').hidden = true;
  updateIntro();
}
function updateIntro() { $('#intro').hidden = !!(WALKS.length || live || settings.introDismissed || $('#idleBar').hidden); $('#introAv').innerHTML = avatarSVG(eff(), 64); }
$('#introClose').addEventListener('click', () => { settings.introDismissed = true; saveSettings(); updateIntro(); });

/* ---------- walk summary ---------- */
function showSummary(w, justFinished) {
  selectedId = w.id; renderWalkList();
  $('#sumKicker').textContent = justFinished ? 'Walk saved' : (w.source === 'live' ? 'Tracked walk' : 'Imported walk');
  $('#sumTitle').textContent = w.name || whenText(w.start) || 'Walk';
  $('#sumDist').textContent = fmtKm(w.dist || 0, 2);
  $('#sumTime').textContent = w.dur > 0 ? fmtClock(w.dur) : '–';
  $('#sumPace').textContent = paceOf(w);
  let m2, label;
  if (justFinished && w.fresh != null) { m2 = w.fresh; label = 'New ground'; }
  else { setRadius(settings.radius); const set = new Set(); markWalk(set, w); m2 = set.size * CELL * CELL; label = 'Area'; }
  const [a, u] = fmtArea(m2);
  $('#sumAreaLbl').textContent = label; $('#sumArea').textContent = a; $('#sumAreaU').textContent = u;
  const finds = [...FOUND.values()].filter(f => f.walkId === w.id), counts = {};
  finds.forEach(f => { counts[f.kind] = (counts[f.kind] || 0) + 1; });
  $('#sumFinds').hidden = !finds.length;
  $('#sumFinds').textContent = finds.length ? 'Found on this walk: ' + Object.keys(counts).map(k => counts[k] + ' ' + (counts[k] === 1 ? KINDS[k].name : KINDS[k].plural).toLowerCase()).join(', ') : '';
  setBottom('summary');
  const b = walkBoundsArr(w); if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], Object.assign({ maxZoom: 17 }, uiPadding()));
  requestDraw();
}
function hideSummary() {
  if ($('#summary').hidden) return;
  selectedId = null; setBottom(live ? 'live' : 'idle'); renderWalkList(); requestDraw();
}
$('#sumDone').addEventListener('click', hideSummary);
$('#sumClose').addEventListener('click', hideSummary);
$('#sumShare').addEventListener('click', () => { const w = WALKS.find(x => x.id === selectedId); if (w) shareCard('walk', w); });

/* ---------- sheet ---------- */
const sheet = $('#sheet'), scrim = $('#scrim'), btnMenu = $('#btnMenu');
const tabBtns = Array.from(document.querySelectorAll('[data-tab]'));
function openSheet(tab) { if (tab) settings.tab = tab; renderTab(); sheet.hidden = false; scrim.hidden = false; document.body.classList.add('sheet-open'); btnMenu.setAttribute('aria-expanded', 'true'); $('#btnClose').focus(); }
function closeSheet() { sheet.hidden = true; scrim.hidden = true; document.body.classList.remove('sheet-open'); btnMenu.setAttribute('aria-expanded', 'false'); }
btnMenu.addEventListener('click', () => sheet.hidden ? openSheet() : closeSheet());
$('#btnClose').addEventListener('click', closeSheet);
scrim.addEventListener('click', closeSheet);
tabBtns.forEach(b => b.addEventListener('click', () => { settings.tab = b.dataset.tab; saveSettings(); renderTab(); $('#sheetBody').scrollTop = 0; }));
window.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#dialog').hidden && !sheet.hidden) closeSheet(); });
$('#homeTip').hidden = !(isIOS && !standalone);
function renderTab() {
  const t = settings.tab;
  sheetSig = [level, earnedSet.size, WALKS.length, PINS.length, FOUND.size, settings.radius].join(':');
  tabBtns.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  for (const name of ['walks', 'stats', 'badges', 'you', 'settings']) $('#tab-' + name).hidden = name !== t;
  if (t === 'walks') { renderWalkList(); renderPinList(); }
  else if (t === 'stats') renderStats();
  else if (t === 'badges') renderBadges();
  else if (t === 'you') renderYou();
  else renderSettings();
}

/* walks + pins lists */
const trash = '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
function renderWalkList() {
  const list = $('#walkList'); if (!list) return;
  list.innerHTML = '';
  const sorted = WALKS.slice().sort((a, b) => byStart(b, a));
  $('#noWalks').hidden = sorted.length > 0;
  $('#walkTotal').textContent = sorted.length ? sorted.length + (sorted.length === 1 ? ' walk' : ' walks') : '';
  for (const w of sorted) {
    const li = document.createElement('li'); if (w.id === selectedId) li.className = 'sel';
    const title = w.name || whenText(w.start) || 'Imported walk';
    li.innerHTML = '<button class="row"><span class="rowname"></span><span class="rowmeta"></span></button><button class="del">' + trash + '</button>';
    li.querySelector('.rowname').textContent = title;
    li.querySelector('.rowmeta').textContent = [w.name ? whenText(w.start) : '', fmtKm(w.dist || 0) + ' km', durText(w.dur), w.source === 'live' ? 'Tracked' : 'Imported'].filter(Boolean).join(' · ');
    li.querySelector('.del').setAttribute('aria-label', 'Delete ' + title);
    li.querySelector('.row').addEventListener('click', () => { closeSheet(); showSummary(w, false); });
    li.querySelector('.del').addEventListener('click', () => deleteWalk(w.id, title));
    list.appendChild(li);
  }
}
function renderPinList() {
  const list = $('#pinList'); list.innerHTML = '';
  $('#noPins').hidden = PINS.length > 0;
  $('#pinTotal').textContent = PINS.length ? PINS.length + (PINS.length === 1 ? ' pin' : ' pins') : '';
  for (const p of PINS.slice().sort((a, b) => b.created - a.created)) {
    const li = document.createElement('li');
    li.innerHTML = '<button class="row withicon"><span class="emo"></span><span class="rowname"></span><span class="rowmeta"></span></button><button class="del">' + trash + '</button>';
    li.querySelector('.emo').textContent = p.icon || '📍';
    li.querySelector('.rowname').textContent = (p.note || '').split('\n')[0] || 'Pin';
    li.querySelector('.rowmeta').textContent = whenText(p.created) + (p.photo ? ' · Photo' : '');
    li.querySelector('.del').setAttribute('aria-label', 'Delete pin');
    li.querySelector('.row').addEventListener('click', () => { closeSheet(); map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)); openPin(p); });
    li.querySelector('.del').addEventListener('click', () => deletePin(p));
    list.appendChild(li);
  }
}
async function deleteWalk(id, label) {
  if (!await ask('Delete this walk?', label + ' will be removed and its fog comes back. This can’t be undone.', 'Cancel', 'Delete', true)) return;
  await DB.walks.del(id);
  WALKS = WALKS.filter(w => w.id !== id); PREP.delete(id);
  if (selectedId === id) hideSummary();
  recomputeAll(true); renderWalkList(); updateIntro();
  toast('Walk deleted');
}

/* stats tab */
function tile(label, value, unit, sub) {
  return '<div class="tile"><span class="lbl">' + label + '</span><span class="num"><b>' + value + '</b>' + (unit ? '<small>' + unit + '</small>' : '') + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</div>';
}
function renderStats() {
  const el = $('#tab-stats'), s = statSummary(WALKS), weeks = weekly(WALKS, 12), p = profile;
  const mins = Math.round(s.timeMs / 60000), walking = (mins >= 60 ? Math.floor(mins / 60) + ' h ' : '') + (mins % 60) + ' min walking';
  const pct = p.islandPct, scaleMax = 5, km2 = islandCells * CELL * CELL / 1e6;
  el.innerHTML =
    '<section><div class="tiles">' +
      tile('This week', s.thisWeek.toFixed(1), 'km') + tile('This month', s.thisMonth.toFixed(1), 'km') +
      tile('Best week', s.best ? s.best.km.toFixed(1) : '0.0', 'km', s.best ? 'Week of ' + weekLabel(s.best.start) : '') +
      tile('Longest walk', s.longest ? s.longest.km.toFixed(2) : '0.00', 'km', s.longest && s.longest.walk.start ? dFmt.format(new Date(s.longest.walk.start)) : '') +
      tile('Streak', p.streak, p.streak === 1 ? 'day' : 'days', 'Best ' + p.bestStreak) +
      tile('Avg pace', fmtPace(s.pace), '/km', walking) +
    '</div></section>' +
    '<section><h3><span>Kilometres per week</span><span>Last 12 weeks</span></h3><p class="readout" id="chartReadout"></p><div class="chartbox">' + chartSVG(weeks) + '</div></section>' +
    '<section><h3>Isle of Wight</h3><div class="isle"><b>' + fmtPct(pct) + '%</b><span>' + km2.toFixed(2) + ' of ' + (island.areaM2 / 1e6).toFixed(0) + ' km² uncovered</span></div>' +
      '<div class="prog" role="img" aria-label="' + fmtPct(pct) + '% of the Isle of Wight uncovered"><i style="width:' + Math.min(100, pct / scaleMax * 100) + '%"></i>' +
      [0.5, 2, 5].map(t => '<span class="tick' + (pct >= t ? ' done' : '') + '" style="left:calc(' + (t / scaleMax * 100) + '% - 1px)"><span>' + t + '%</span></span>').join('') + '</div></section>' +
    '<section><button class="primary wide" id="btnShareAll">' + iconSVG('route', 'i') + 'Share my map</button></section>';
  const ro = $('#chartReadout');
  const say = i => { const w = weeks[i], last = i === weeks.length - 1; ro.textContent = (last ? 'This week' : 'Week of ' + weekLabel(w.start)) + ': ' + w.km.toFixed(1) + ' km · ' + w.walks + (w.walks === 1 ? ' walk' : ' walks'); };
  say(weeks.length - 1);
  el.querySelectorAll('.hit').forEach(h => { const i = +h.dataset.i; h.addEventListener('pointerenter', () => say(i)); h.addEventListener('click', () => say(i)); });
  $('#btnShareAll').addEventListener('click', () => shareCard('all'));
}

/* badges tab */
const fmtProg = (v, unit) => unit === 'km' ? v.toFixed(1) : unit === 'km²' ? v.toFixed(2) : unit === '%' ? fmtPct(v) : String(Math.floor(v));
function renderBadges() {
  const el = $('#tab-badges'), p = profile;
  const finds = Object.keys(KINDS).map(k => '<div class="find"><span class="dot" style="background:' + KINDS[k].color + '">' + iconSVG(KINDS[k].icon, 'i') + '</span><b>' + p.found[k] + '</b><span>' + KINDS[k].plural + '</span></div>').join('');
  const tiles = BADGES.map(b => {
    const [v, t] = b.prog(p), on = earnedSet.has(b.id);
    return '<div class="badge' + (on ? ' on' : '') + '"><span class="ic">' + iconSVG(b.icon, 'i') + '</span><b>' + esc(b.name) + '</b><p>' + esc(b.desc) + '</p>' +
      (on ? '<span class="when">' + (earnedLog[b.id] ? 'Earned ' + dFmt.format(new Date(earnedLog[b.id])) : 'Earned') + '</span>'
          : '<div class="mini"><i style="width:' + Math.min(100, v / t * 100) + '%"></i></div><span class="pv">' + fmtProg(Math.min(v, t), b.unit) + ' / ' + fmtProg(t, b.unit) + (b.unit ? ' ' + b.unit : '') + '</span>') + '</div>';
  }).join('');
  el.innerHTML = '<section><h3><span>Collectibles</span><span>' + p.found.total + ' found</span></h3><div class="finds">' + finds + '</div>' +
    '<p class="hint">Treasure is hidden all over the map. It shimmers through the fog when you’re within 300 m. Walk within 35 m to collect it.</p></section>' +
    '<section><h3><span>Badges</span><span>' + earnedSet.size + ' of ' + BADGES.length + '</span></h3><div class="badges">' + tiles + '</div></section>';
}

/* you tab: character */
const lockSVG = '<span class="lock">' + '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>';
function renderYou() {
  const el = $('#tab-you'), e = eff(), ctxU = unlockCtx();
  const into = xp - xpAtLevel(level), need = xpAtLevel(level + 1) - xpAtLevel(level);
  let html = '<section class="hero"><div class="avbox">' + avatarSVG(e, 104) + '</div><div class="herotext">' +
    '<label class="lbl" for="avName">Name</label><input class="textin" id="avName" maxlength="16" placeholder="Explorer" autocomplete="off">' +
    '<div class="lvl"><b>Level ' + level + '</b><span>' + into + ' / ' + need + ' XP</span></div><div class="xpbar"><i style="width:' + Math.min(100, into / need * 100) + '%"></i></div></div></section>' +
    '<p class="hint">10 XP per km · coins 5 · map scraps 15 · gems 50 · crowns 200 · badges 25 · pins 5. Level up and earn badges to unlock more looks.</p>';
  for (const kind of Object.keys(PARTS)) {
    html += '<section><h3><span>' + PARTS[kind].label + '</span><span id="name-' + kind + '">' + esc(part(kind, e[kind]).label) + '</span></h3><div class="opts">';
    for (const it of PARTS[kind].items) {
      const open = isUnlocked(it, ctxU), on = e[kind] === it.id;
      let face;
      if (kind === 'color') face = '<span class="swatch" style="background:' + it.hex + '"></span>';
      else if (kind === 'trail') face = '<span class="trail" style="background:' + it.hex + ';box-shadow:0 0 12px ' + it.hex + '"></span>';
      else face = avatarSVG(Object.assign({}, e, { [kind]: it.id }), 54);
      html += '<button class="opt' + (open ? '' : ' locked') + '" data-kind="' + kind + '" data-id="' + it.id + '" aria-pressed="' + on + '" aria-label="' + esc(it.label) + (open ? '' : ', locked') + '" title="' + esc(open ? it.label : unlockText(it, id => badgeById(id).name)) + '">' + face + (open ? '' : lockSVG) + '</button>';
    }
    html += '</div></section>';
  }
  el.innerHTML = html;
  const nm = $('#avName'); nm.value = avatarCfg.name || '';
  nm.addEventListener('input', () => { avatarCfg.name = nm.value.trim().slice(0, 16); saveLocal('fogwalk.avatar', avatarCfg); });
  el.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => {
    const it = part(b.dataset.kind, b.dataset.id);
    if (!isUnlocked(it, unlockCtx())) { toast(it.label + ': ' + unlockText(it, id => badgeById(id).name) + ' to unlock.'); return; }
    avatarCfg[b.dataset.kind] = it.id; saveLocal('fogwalk.avatar', avatarCfg);
    const st = $('#sheetBody').scrollTop; renderYou(); $('#sheetBody').scrollTop = st;
    updateMeIcon(true); updateIntro(); requestDraw();
  }));
}

/* settings tab */
const radiusBtns = Array.from(document.querySelectorAll('[data-r]'));
const styleBtns = Array.from(document.querySelectorAll('[data-style]'));
function renderSettings() {
  radiusBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.r === settings.radius)));
  $('#radiusHint').textContent = 'Each step clears fog ' + settings.radius + ' m either side of your path. This also sets how uncovered area is counted.';
  styleBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.style === settings.style)));
  $('#cartoField').hidden = settings.style !== 'carto';
  $('#cartoKey').value = settings.cartoKey;
}
radiusBtns.forEach(b => b.addEventListener('click', () => { settings.radius = +b.dataset.r; saveSettings(); renderSettings(); recomputeAll(true); }));
styleBtns.forEach(b => b.addEventListener('click', () => { settings.style = b.dataset.style; saveSettings(); renderSettings(); setTiles(); }));
$('#cartoKey').addEventListener('change', () => { settings.cartoKey = $('#cartoKey').value.trim(); saveSettings(); setTiles(); if (settings.cartoKey) toast('CARTO key saved'); });

/* ---------- your sprite on the map ---------- */
let meMarker = null, meCircle = null, meSig = '';
function meIcon() { return L.divIcon({ className: 'me-icon', html: '<span class="me-ring"></span>' + avatarSVG(eff(), 46), iconSize: [46, 46], iconAnchor: [23, 43] }); }
function updateMeIcon(force) {
  if (!meMarker) return;
  const sig = JSON.stringify(eff());
  if (force || sig !== meSig) { meSig = sig; meMarker.setIcon(meIcon()); }
}
function showMe(lat, lng, acc) {
  mePos = { lat, lng, acc };
  if (!meMarker) {
    meSig = JSON.stringify(eff());
    meMarker = L.marker([lat, lng], { icon: meIcon(), pane: 'me', interactive: false, keyboard: false }).addTo(map);
    meCircle = L.circle([lat, lng], { radius: acc, pane: 'fog', stroke: false, fillColor: '#ffb547', fillOpacity: 0.1, interactive: false }).addTo(map);
  } else { meMarker.setLatLng([lat, lng]); meCircle.setLatLng([lat, lng]).setRadius(acc); }
  $('#btnLocate').classList.add('on');
}
function geoErrorText(err) {
  if (!window.isSecureContext) return 'Location needs a secure (https) page.';
  if (err && err.code === 1) return isIOS ? 'Location is blocked. Turn on Settings › Privacy & Security › Location Services › Safari Websites, then reload.' : 'Location is blocked for this site. Allow it in the address bar, then reload.';
  if (err && err.code === 3) return 'Still looking for GPS. Try near a window or outside.';
  return 'Can’t get your location right now.';
}
$('#btnLocate').addEventListener('click', () => {
  if (live && live.last) { live.follow = true; $('#btnRecenter').hidden = true; map.setView([live.last.lat, live.last.lng], Math.max(map.getZoom(), 16)); return; }
  if (!('geolocation' in navigator)) { toast('This browser has no location access.'); return; }
  toast('Finding you…', 2500);
  navigator.geolocation.getCurrentPosition(p => {
    showMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
    map.setView([p.coords.latitude, p.coords.longitude], Math.max(map.getZoom(), 16));
    hideToast(); requestDraw();
  }, err => toast(geoErrorText(err), 6000), { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 });
});

/* ---------- live tracking ---------- */
let wakeLock = null, tickTimer = 0, saveTimer = 0;
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { wakeLock = null; } }
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
function newLive(start) { return { start, segs: [], prep: [], last: null, dist: 0, newCells: 0, finds: [], follow: true, watchId: null, gotFix: false, hiddenAt: 0, savedAt: 0, skipNext: false }; }

function liveAppend(p, newSeg, quiet) {
  if (newSeg || !live.segs.length) { live.skipNext = false; live.segs.push([]); live.prep.push({ W: [], n: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }); }
  const seg = live.segs[live.segs.length - 1], pr = live.prep[live.prep.length - 1], prev = seg[seg.length - 1];
  seg.push(p);
  const X = wx(p.lng), Y = wy(p.lat);
  pr.W.push(X, Y); pr.n++;
  if (X < pr.x0) pr.x0 = X; if (X > pr.x1) pr.x1 = X; if (Y < pr.y0) pr.y0 = Y; if (Y > pr.y1) pr.y1 = Y;
  const onNew = k => { live.newCells++; const c = cellCentre(k); if (island.contains(c[0], c[1])) islandCells++; };
  if (prev) { markLine(CELLS, prev.lat, prev.lng, p.lat, p.lng, onNew); live.dist += hav(prev.lat, prev.lng, p.lat, p.lng); }
  else markPoint(CELLS, p.lat, p.lng, onNew);
  // treasure along this stretch
  const piece = { start: live.start, segs: [prev ? [prev.lat, prev.lng, 0, p.lat, p.lng, 0] : [p.lat, p.lng, 0]] };
  findAlong(piece, c => {
    if (FOUND.has(c.key)) return;
    FOUND.set(c.key, Object.assign({}, c, { t: p.t, walkId: 'live' })); live.finds.push(c.kind);
    if (!quiet) celebrate(kindToast(c.kind));
  });
  live.last = p;
}
function updateNear() {
  const el = $('#lvNear');
  if (!live || !mePos) { el.hidden = true; return; }
  const n = collectiblesNear(mePos.lat, mePos.lng, HINT_RADIUS).filter(c => !FOUND.has(c.key)).length;
  el.hidden = !n; el.innerHTML = iconSVG('sparkle', 'i') + n + ' nearby';
}
function onPosition(pos) {
  if (!live) return;
  const c = pos.coords, acc = c.accuracy || 999, gps = $('#lvGps');
  gps.textContent = (acc > GPS_MAX_ACC ? 'Weak GPS ±' : 'GPS ±') + Math.round(acc) + ' m';
  gps.className = 'gps ' + (acc <= 12 ? 'good' : acc <= GPS_MAX_ACC ? 'ok' : 'bad');
  showMe(c.latitude, c.longitude, acc);
  updateNear();
  if (acc > GPS_MAX_ACC) { requestDraw(); return; }
  const p = { lat: c.latitude, lng: c.longitude, t: pos.timestamp || Date.now() }, last = live.last;
  if (!last) liveAppend(p, true);
  else {
    const d = hav(last.lat, last.lng, p.lat, p.lng), dt = (p.t - last.t) / 1000;
    if (dt > 30 && d > 80) liveAppend(p, true);                                             // gap, e.g. screen was off
    else if (dt > 0 && d / dt > MAX_SPEED && d > 8) { live.last = p; live.skipNext = true; } // vehicle speed
    else if (live.skipNext) liveAppend(p, true);
    else if (d >= Math.max(MIN_STEP, acc * 0.4)) liveAppend(p, false);
    else { requestDraw(); return; }
  }
  if (!live.gotFix) { live.gotFix = true; map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)); }
  else if (live.follow) map.panTo([p.lat, p.lng], { animate: true, duration: 0.5 });
  if (Date.now() - live.savedAt > 5000) persistLive();
  refreshProgress(false);
}
function onGeoError(err) {
  if (!live) return;
  if (err.code === 1) { toast(geoErrorText(err), 8000); stopWatch(); $('#lvGps').textContent = 'Location blocked'; $('#lvGps').className = 'gps bad'; }
  else { $('#lvGps').textContent = 'Searching for GPS…'; $('#lvGps').className = 'gps'; }
}
function startWatch() {
  if (!('geolocation' in navigator)) { toast('This browser has no location access.'); return false; }
  if (!window.isSecureContext) { toast(geoErrorText(), 6000); return false; }
  live.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, { enableHighAccuracy: true, maximumAge: 0 });
  return true;
}
function stopWatch() { if (live && live.watchId != null) { navigator.geolocation.clearWatch(live.watchId); live.watchId = null; } }
function updateLiveStats() {
  if (!live) return;
  const el = Date.now() - live.start;
  $('#lvTime').textContent = fmtClock(el);
  $('#lvDist').textContent = fmtKm(live.dist, 2);
  $('#lvPace').textContent = live.dist > 50 ? fmtPace(el / 1000 / (live.dist / 1000)) : '–';
  const [a, u] = fmtArea(live.newCells * CELL * CELL); $('#lvNew').textContent = a; $('#lvNewU').textContent = u;
}
function persistLive() {
  if (!live) return;
  live.savedAt = Date.now();
  DB.set('live', { start: live.start, segs: live.segs.map(s => s.map(p => [r6(p.lat), r6(p.lng), p.t])) }).catch(() => {});
}
function beginLive(start, restoredSegs) {
  live = newLive(start);
  if (restoredSegs) { restoredSegs.forEach(seg => seg.forEach((q, k) => liveAppend({ lat: q[0], lng: q[1], t: q[2] }, k === 0, true))); live.gotFix = !!live.last; }
  hideSummary(); selectedId = null;
  setBottom('live'); refreshProgress(true);
  $('#lvGps').textContent = 'Finding GPS…'; $('#lvGps').className = 'gps';
  if (!startWatch()) { live = null; setBottom('idle'); recomputeAll(true); return; }
  keepAwake();
  clearInterval(tickTimer); tickTimer = setInterval(updateLiveStats, 1000);
  clearInterval(saveTimer); saveTimer = setInterval(persistLive, 15000);
  persistLive();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
function endLive() {
  stopWatch(); releaseWake(); clearInterval(tickTimer); clearInterval(saveTimer);
  live = null; DB.unset('live').catch(() => {});
  setBottom('idle');
}
function walkFromLive(lv, endTime) {
  let segs = lv.segs.filter(s => s.length);
  if (segs.some(s => s.length > 1)) segs = segs.filter(s => s.length > 1);
  const start = lv.start, end = endTime || Math.max(start, ...segs.map(s => s[s.length - 1].t));
  return {
    id: uid(), name: '', source: 'live', start, end, dur: end - start, dist: lv.dist, fresh: lv.newCells * CELL * CELL, created: Date.now(),
    segs: segs.map(s => { const a = []; s.forEach(p => a.push(r6(p.lat), r6(p.lng), Math.round((p.t - start) / 1000))); return a; }),
  };
}
$('#btnStart').addEventListener('click', () => { if (!live) beginLive(Date.now()); });
$('#btnFinish').addEventListener('click', async () => {
  if (!live) return;
  if (!live.segs.reduce((n, s) => n + s.length, 0)) {
    if (await ask('No GPS points yet', 'Nothing has been recorded on this walk. End it anyway?', 'Keep walking', 'End walk')) { endLive(); recomputeAll(true); }
    return;
  }
  const w = walkFromLive(live, Date.now());
  endLive();
  await saveWalks([w]);
  showSummary(w, true);
});
$('#btnDiscard').addEventListener('click', async () => {
  if (!live) return;
  if (!await ask('Discard this walk?', 'Everything recorded on this walk will be thrown away and the fog comes back.', 'Keep walking', 'Discard', true)) return;
  endLive(); recomputeAll(true); toast('Walk discarded');
});
map.on('dragstart', () => { if (live && live.follow) { live.follow = false; $('#btnRecenter').hidden = false; } });
$('#btnRecenter').addEventListener('click', () => { if (!live) return; live.follow = true; $('#btnRecenter').hidden = true; if (live.last) map.panTo([live.last.lat, live.last.lng]); });
document.addEventListener('visibilitychange', () => {
  if (!live) return;
  if (document.visibilityState === 'hidden') { live.hiddenAt = Date.now(); persistLive(); }
  else {
    keepAwake();
    if (live.hiddenAt && Date.now() - live.hiddenAt > 20000) toast('GPS was paused while Fogwalk was in the background. That gap stays foggy.', 6000);
    live.hiddenAt = 0;
  }
});
window.addEventListener('pagehide', persistLive);

/* ---------- pins ---------- */
const pinMarkers = new Map();
function addPinMarker(p) {
  const icon = L.divIcon({ className: 'pin-icon', html: '<div class="pinbody"><span>' + esc(p.icon || '📍') + '</span></div>', iconSize: [36, 46], iconAnchor: [18, 44] });
  const m = L.marker([p.lat, p.lng], { icon, pane: 'pins', keyboard: true, title: (p.note || 'Pin').split('\n')[0] }).addTo(map);
  m.on('click', e => { L.DomEvent.stopPropagation(e); openPin(p); });
  pinMarkers.set(p.id, m);
}
function startPlacing() {
  if (live) { dropLivePin(); return; }
  placing = true; hideSummary(); setBottom('place');
}
function stopPlacing() { placing = false; setBottom(live ? 'live' : 'idle'); }
$('#btnPin').addEventListener('click', startPlacing);
$('#btnPlaceCancel').addEventListener('click', stopPlacing);
$('#btnPlaceOk').addEventListener('click', () => {
  const s = map.getSize(), ll = map.containerPointToLatLng([s.x / 2, s.y / 2]);
  stopPlacing(); pinEditor(ll.lat, ll.lng);
});
function dropLivePin() {
  const at = live && live.last ? live.last : mePos;
  if (!at) { toast('Waiting for GPS. Try again in a moment.'); return; }
  pinEditor(at.lat, at.lng);
}
$('#btnLivePin').addEventListener('click', dropLivePin);

function resizePhoto(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
    img.src = url;
  });
}
async function pinEditor(lat, lng) {
  const form = document.createElement('div');
  form.className = 'dlgbody';
  form.innerHTML = '<div class="emojis" role="group" aria-label="Pin icon">' + PIN_EMOJI.map((e, i) => '<button type="button" aria-pressed="' + (i === 0) + '" data-e="' + e + '">' + e + '</button>').join('') + '</div>' +
    '<div class="field"><label for="pinNote">Note</label><textarea class="textin" id="pinNote" maxlength="280" rows="3" placeholder="What’s here?"></textarea></div>' +
    '<div class="photo"><img id="pinPrev" alt="" hidden><button type="button" class="ghost" id="pinPhotoBtn">Add photo</button><button type="button" class="ghost" id="pinPhotoDel" hidden>Remove</button></div>';
  let icon = PIN_EMOJI[0], photo = null;
  form.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => { icon = b.dataset.e; form.querySelectorAll('[data-e]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
  const input = $('#photoInput');
  const onPick = async () => {
    const f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    try { photo = await resizePhoto(f); const pv = form.querySelector('#pinPrev'); pv.src = photo; pv.hidden = false; form.querySelector('#pinPhotoDel').hidden = false; form.querySelector('#pinPhotoBtn').textContent = 'Change photo'; }
    catch (e) { toast('That photo couldn’t be read. Try a JPEG or PNG.'); }
  };
  input.addEventListener('change', onPick);
  form.querySelector('#pinPhotoBtn').addEventListener('click', () => input.click());
  form.querySelector('#pinPhotoDel').addEventListener('click', () => { photo = null; form.querySelector('#pinPrev').hidden = true; form.querySelector('#pinPhotoDel').hidden = true; form.querySelector('#pinPhotoBtn').textContent = 'Add photo'; });
  const save = await modal('Drop a pin', form, [{ label: 'Cancel', value: false }, { label: 'Save pin', kind: 'primary', value: true }]);
  input.removeEventListener('change', onPick);
  if (!save) return;
  const p = { id: uid(), lat: r6(lat), lng: r6(lng), icon, note: form.querySelector('#pinNote').value.trim(), photo, created: Date.now() };
  try { await DB.pins.putMany([p]); } catch (e) { toast('Couldn’t save the pin. Storage may be full.'); return; }
  PINS.push(p); addPinMarker(p);
  toast('Pin dropped');
  refreshProgress(false);
}
async function openPin(p) {
  const body = document.createElement('div'); body.className = 'dlgbody';
  if (p.photo) { const img = document.createElement('img'); img.className = 'pinphoto'; img.src = p.photo; img.alt = 'Photo from this pin'; body.appendChild(img); }
  if (p.note) { const n = document.createElement('p'); n.className = 'pinnote'; n.textContent = p.note; body.appendChild(n); }
  const meta = document.createElement('p'); meta.textContent = 'Dropped ' + whenText(p.created); body.appendChild(meta);
  const r = await modal((p.icon || '📍') + ' Pin', body, [{ label: 'Delete', value: 'del' }, { label: 'Close', kind: 'primary', value: 'close' }]);
  if (r === 'del') deletePin(p);
}
async function deletePin(p) {
  if (!await ask('Delete this pin?', 'The pin' + (p.photo ? ', its photo' : '') + ' and its note will be removed.', 'Cancel', 'Delete', true)) return;
  await DB.pins.del(p.id);
  PINS = PINS.filter(x => x.id !== p.id);
  const m = pinMarkers.get(p.id); if (m) { map.removeLayer(m); pinMarkers.delete(p.id); }
  refreshProgress(true); toast('Pin deleted');
}

/* ---------- import, backup, wipe ---------- */
async function importFiles(files) {
  files = Array.from(files); if (!files.length) return;
  if (live) { toast('Finish your walk before importing.'); return; }
  toast('Importing…', 60000);
  const found = [], backups = [], failed = [];
  const handle = (name, text) => {
    const r = parseText(text);
    if (r.backup) backups.push(r.backup);
    else r.tracks.forEach(t => { const w = walkFromTrack(t, name); if (w) found.push(w); });
  };
  for (const f of files) {
    try {
      if (/\.zip$/i.test(f.name)) {
        if (f.size > 150e6) toast('Big ZIP, this can take a minute…', 60000);
        const JSZip = await loadJSZip(), zip = await JSZip.loadAsync(f);
        const entries = Object.values(zip.files).filter(e => !e.dir && TRACK_EXT.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name) && !/^\./.test(e.name.split('/').pop()));
        if (!entries.length) throw new Error('empty');
        for (const e of entries) { try { handle(e.name, await e.async('string')); } catch (err) { failed.push(e.name.split('/').pop()); } }
      } else handle(f.name, await f.text());
    } catch (err) { failed.push(f.name); }
  }
  const ids = new Set(WALKS.map(w => w.id)), sigs = new Set(WALKS.map(w => w.sig).filter(Boolean)), pinIds = new Set(PINS.map(p => p.id));
  const fresh = [], freshPins = [];
  let dupes = 0;
  for (const b of backups) {
    for (const w of b.walks.filter(validWalk)) { if (ids.has(w.id) || (w.sig && sigs.has(w.sig))) { dupes++; continue; } ids.add(w.id); if (w.sig) sigs.add(w.sig); fresh.push(w); }
    for (const p of (b.pins || []).filter(validPin)) { if (pinIds.has(p.id)) continue; pinIds.add(p.id); freshPins.push(p); }
    if (b.avatar && JSON.stringify(Object.assign({}, DEFAULT_AVATAR, avatarCfg)) === JSON.stringify(DEFAULT_AVATAR)) { avatarCfg = Object.assign({}, DEFAULT_AVATAR, b.avatar); saveLocal('fogwalk.avatar', avatarCfg); }
    if (b.badges) { for (const k in b.badges) if (!earnedLog[k] || b.badges[k] < earnedLog[k]) earnedLog[k] = b.badges[k]; saveLocal('fogwalk.badges', earnedLog); }
  }
  for (const w of found) { if (sigs.has(w.sig)) { dupes++; continue; } sigs.add(w.sig); fresh.push(w); }
  if (freshPins.length) { try { await DB.pins.putMany(freshPins); } catch (e) {} freshPins.forEach(p => { PINS.push(p); addPinMarker(p); }); }
  if (fresh.length) await saveWalks(fresh, true);
  else if (freshPins.length) refreshProgress(false);
  const parts = [];
  if (fresh.length) parts.push('Added ' + fresh.length + (fresh.length === 1 ? ' walk.' : ' walks.'));
  if (freshPins.length) parts.push('Added ' + freshPins.length + (freshPins.length === 1 ? ' pin.' : ' pins.'));
  if (dupes) parts.push(dupes + ' already here.');
  if (failed.length) parts.push('Couldn’t read ' + (failed.length === 1 ? failed[0] : failed.length + ' files') + '.');
  if (!parts.length) parts.push('No walking tracks found in that file.');
  toast(parts.join(' '), 6000);
}
async function saveWalks(ws, fit) {
  try { await DB.walks.putMany(ws); } catch (e) { toast('Couldn’t save to this device. Storage may be full.'); }
  ws.forEach(w => { WALKS.push(w); PREP.set(w.id, prepSegs(w.segs)); });
  recomputeAll(false); renderWalkList(); updateIntro();
  if (fit) fitWalks(ws);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
function fitWalks(ws) {
  let b = null;
  for (const w of ws) { const a = walkBoundsArr(w); if (a) b = b ? [Math.min(b[0], a[0]), Math.min(b[1], a[1]), Math.max(b[2], a[2]), Math.max(b[3], a[3])] : a; }
  if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], Object.assign({ maxZoom: 16 }, uiPadding()));
}
const fileInput = $('#fileInput');
fileInput.addEventListener('change', () => { const fs = fileInput.files; if (fs && fs.length) { closeSheet(); importFiles(fs); } fileInput.value = ''; });
$('#btnImport').addEventListener('click', () => fileInput.click());
let dragDepth = 0; const drop = $('#drop');
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; drop.hidden = false; });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.hidden = true; });
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; drop.hidden = true; if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
async function saveBlob(blob, name, title) {
  if (isIOS && navigator.canShare) {
    try { const file = new File([blob], name, { type: blob.type }); if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return true; } }
    catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return true;
}
$('#btnBackup').addEventListener('click', async () => {
  if (!WALKS.length && !PINS.length) { toast('Nothing to back up yet.'); return; }
  const d = new Date(), name = 'fogwalk-backup-' + ymd(d) + '.json';
  const blob = new Blob([JSON.stringify({ app: 'fogwalk', version: 2, exported: d.toISOString(), walks: WALKS, pins: PINS, avatar: avatarCfg, badges: earnedLog })], { type: 'application/json' });
  if (await saveBlob(blob, name, 'Fogwalk backup') && !isIOS) toast('Backup saved as ' + name);
});
$('#btnWipe').addEventListener('click', async () => {
  if (!WALKS.length && !PINS.length) { toast('There’s nothing to delete.'); return; }
  if (!await ask('Delete everything?', 'All ' + WALKS.length + ' walks and ' + PINS.length + ' pins will be removed and the map goes back to fog. Back up first if you might want them again. This can’t be undone.', 'Cancel', 'Delete all', true)) return;
  hideSummary();
  await DB.walks.clear(); await DB.pins.clear();
  WALKS = []; PINS = []; PREP.clear(); selectedId = null;
  pinMarkers.forEach(m => map.removeLayer(m)); pinMarkers.clear();
  recomputeAll(true); renderTab(); updateIntro(); toast('Everything deleted');
});

/* ---------- share card ---------- */
async function shareCard(mode, walk) {
  if (!WALKS.length) { toast('Finish a walk first, then share it.'); return; }
  toast('Making your card…', 15000);
  const e = eff(), p = profile;
  let walks, headline, stats, found, date;
  if (mode === 'walk') {
    walks = [walk];
    headline = { label: 'Distance', value: fmtKm(walk.dist || 0, 2), unit: 'km' };
    setRadius(settings.radius); const set = new Set(); markWalk(set, walk);
    const [a, u] = fmtArea(walk.fresh != null ? walk.fresh : set.size * CELL * CELL);
    stats = [{ label: 'Time', value: walk.dur > 0 ? fmtClock(walk.dur) : '–' }, { label: 'Pace', value: paceOf(walk), unit: '/km' }, { label: walk.fresh != null ? 'New ground' : 'Area', value: a, unit: u }];
    found = [...FOUND.values()].filter(f => f.walkId === walk.id);
    date = walk.start ? dFmt.format(new Date(walk.start)) : '';
  } else {
    const latest = WALKS.slice().sort(byStart).pop(), lb = walkBoundsArr(latest), c = [(lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2];
    walks = WALKS.filter(w => { const b = walkBoundsArr(w); return b && hav(c[0], c[1], (b[0] + b[2]) / 2, (b[1] + b[3]) / 2) < 25000; }).sort(byStart);
    const [a, u] = fmtArea(CELLS.size * CELL * CELL);
    headline = { label: 'Uncovered', value: a, unit: u };
    stats = [{ label: 'Island', value: fmtPct(p.islandPct), unit: '%' }, { label: 'Walked', value: fmtKm(TOTAL_DIST), unit: 'km' }, { label: 'Streak', value: String(p.streak), unit: p.streak === 1 ? 'day' : 'days' }];
    found = [...FOUND.values()];
    date = dFmt.format(new Date());
  }
  let blob;
  try {
    blob = await renderCard({ walks, radius: settings.radius, trail: trailHex(e), avatar: avatarSVG(e, 140), name: avatarCfg.name || 'Explorer', level, found, island: island.ring(), headline, stats, date, url: (location.host + location.pathname).replace(/\/(index\.html)?$/, '') });
  } catch (err) { toast('Couldn’t make the card on this device.'); return; }
  hideToast();
  const url = URL.createObjectURL(blob), body = document.createElement('div');
  body.className = 'dlgbody';
  body.innerHTML = '<img class="cardimg" alt="Your Fogwalk share card">';
  body.querySelector('img').src = url;
  const name = 'fogwalk-' + ymd(new Date()) + '.png';
  await modal(mode === 'walk' ? 'Share this walk' : 'Share your map', body, [
    { label: 'Close', value: 'close' },
    { label: isIOS ? 'Share or save' : 'Save image', kind: 'primary', value: 'save', run: async () => { await saveBlob(blob, name, 'My Fogwalk map'); return true; } },
  ]);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('#btnShare').addEventListener('click', () => shareCard('all'));

/* ---------- boot ---------- */
(async () => {
  initIsland();
  ISLAND_SEG = island.outline();
  setMode(settings.mode); setTiles();
  const ib = island.bounds();
  map.fitBounds([[ib[0], ib[1]], [ib[2], ib[3]]], { padding: [0, 0] });
  sizeCanvas(); layoutUI();
  try { WALKS = ((await DB.walks.all()) || []).filter(validWalk); } catch (e) { WALKS = []; }
  try { PINS = ((await DB.pins.all()) || []).filter(validPin); } catch (e) { PINS = []; }
  WALKS.forEach(w => PREP.set(w.id, prepSegs(w.segs)));
  PINS.forEach(addPinMarker);
  recomputeAll(true);
  setBottom('idle');
  if (WALKS.length) fitWalks(WALKS);
  let pending = null;
  try { pending = await DB.get('live'); } catch (e) {}
  if (pending && Array.isArray(pending.segs) && pending.segs.some(s => s.length)) {
    const choice = await modal('Pick up where you left off?', 'There’s an unfinished walk from ' + whenText(pending.start) + '.', [{ label: 'Discard', value: 'discard' }, { label: 'Save it', value: 'save' }, { label: 'Keep walking', kind: 'primary', value: 'resume' }]);
    if (choice === 'resume') beginLive(pending.start, pending.segs);
    else if (choice === 'save') {
      live = newLive(pending.start);
      pending.segs.forEach(seg => seg.forEach((q, k) => liveAppend({ lat: q[0], lng: q[1], t: q[2] }, k === 0, true)));
      const w = walkFromLive(live); live = null;
      await DB.unset('live').catch(() => {});
      await saveWalks([w]); showSummary(w, true);
    } else await DB.unset('live').catch(() => {});
  }
})();
