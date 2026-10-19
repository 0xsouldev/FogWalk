// Reading GPX, KML, TCX, GeoJSON and Fogwalk backups.
import { hav, r6, uid } from './geo.js';

export const MAX_SPEED = 7;   // m/s (25 km/h). Faster than this is treated as a vehicle and skipped
export const MIN_STEP = 4;    // metres between kept points
export const TRACK_EXT = /\.(gpx|kml|tcx|geojson|json)$/i;
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

const byTag = (el, name) => el.getElementsByTagNameNS('*', name);
function childText(el, name) { for (const c of el.children) if (c.localName === name) return c.textContent.trim(); return ''; }
export const baseName = n => n.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

function gpxPt(p) { const t = byTag(p, 'time')[0]; return { lat: +p.getAttribute('lat'), lng: +p.getAttribute('lon'), t: t ? Date.parse(t.textContent.trim()) : NaN }; }
function parseGPX(doc) {
  const out = [];
  for (const trk of byTag(doc, 'trk')) {
    const segs = [];
    for (const sg of byTag(trk, 'trkseg')) segs.push(Array.from(byTag(sg, 'trkpt'), gpxPt));
    if (!segs.length) segs.push(Array.from(byTag(trk, 'trkpt'), gpxPt));
    out.push({ name: childText(trk, 'name'), segs });
  }
  if (!out.length) for (const rte of byTag(doc, 'rte')) out.push({ name: childText(rte, 'name'), segs: [Array.from(byTag(rte, 'rtept'), gpxPt)] });
  return out;
}
function parseKML(doc) {
  const out = [];
  for (const pm of byTag(doc, 'Placemark')) {
    const segs = [];
    for (const ls of byTag(pm, 'LineString')) {
      const c = byTag(ls, 'coordinates')[0];
      if (c) segs.push(c.textContent.trim().split(/\s+/).map(tok => { const [lng, lat] = tok.split(',').map(Number); return { lat, lng, t: NaN }; }));
    }
    for (const tr of byTag(pm, 'Track')) {
      const whens = Array.from(byTag(tr, 'when'), e => Date.parse(e.textContent.trim()));
      segs.push(Array.from(byTag(tr, 'coord'), (e, i) => { const [lng, lat] = e.textContent.trim().split(/\s+/).map(Number); return { lat, lng, t: whens[i] }; }));
    }
    if (segs.length) out.push({ name: childText(pm, 'name'), segs });
  }
  return out;
}
function parseTCX(doc) {
  const out = [];
  const groups = byTag(doc, 'Activity').length ? byTag(doc, 'Activity') : byTag(doc, 'Course');
  for (const g of groups) {
    const segs = [];
    for (const tr of byTag(g, 'Track')) {
      const pts = [];
      for (const tp of byTag(tr, 'Trackpoint')) {
        const la = byTag(tp, 'LatitudeDegrees')[0], lo = byTag(tp, 'LongitudeDegrees')[0], ti = byTag(tp, 'Time')[0];
        if (la && lo) pts.push({ lat: +la.textContent, lng: +lo.textContent, t: ti ? Date.parse(ti.textContent.trim()) : NaN });
      }
      segs.push(pts);
    }
    out.push({ name: childText(g, 'Name'), segs });
  }
  return out;
}
function parseGeoJSON(j) {
  const out = [];
  function geom(g, name, props) {
    if (!g) return;
    const times = props && Array.isArray(props.coordTimes) ? props.coordTimes : null;
    if (g.type === 'LineString') out.push({ name, segs: [g.coordinates.map((c, i) => ({ lng: c[0], lat: c[1], t: times ? Date.parse(times[i]) : NaN }))] });
    else if (g.type === 'MultiLineString') out.push({ name, segs: g.coordinates.map((line, li) => line.map((c, i) => ({ lng: c[0], lat: c[1], t: times && Array.isArray(times[li]) ? Date.parse(times[li][i]) : NaN }))) });
    else if (g.type === 'GeometryCollection') g.geometries.forEach(x => geom(x, name, props));
  }
  const nameOf = f => (f.properties && (f.properties.name || f.properties.title)) || '';
  if (j.type === 'FeatureCollection') j.features.forEach(f => geom(f.geometry, nameOf(f), f.properties));
  else if (j.type === 'Feature') geom(j.geometry, nameOf(j), j.properties);
  else geom(j, '', null);
  return out;
}

/** Returns { tracks } for route files or { backup } for a Fogwalk backup. */
export function parseText(text) {
  const t = text.replace(/^﻿/, '').trimStart();
  if (t[0] === '{' || t[0] === '[') {
    const j = JSON.parse(t);
    if (j && j.app === 'fogwalk' && Array.isArray(j.walks)) return { backup: j };
    return { tracks: parseGeoJSON(j) };
  }
  const doc = new DOMParser().parseFromString(t, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('unreadable');
  const root = doc.documentElement.localName.toLowerCase();
  if (root === 'gpx') return { tracks: parseGPX(doc) };
  if (root === 'kml') return { tracks: parseKML(doc) };
  if (root === 'trainingcenterdatabase') return { tracks: parseTCX(doc) };
  throw new Error('unsupported');
}

/** Drops bad points and jitter, and splits where you were in a vehicle or the track jumps. */
export function cleanSegments(raw) {
  const out = [];
  for (const seg of raw) {
    let cur = [], last = null;
    for (const p of seg) {
      if (!isFinite(p.lat) || !isFinite(p.lng) || Math.abs(p.lat) > 85 || Math.abs(p.lng) > 180 || (p.lat === 0 && p.lng === 0)) continue;
      if (!last) { cur.push(p); last = p; continue; }
      const d = hav(last.lat, last.lng, p.lat, p.lng), dt = (p.t - last.t) / 1000, timed = isFinite(dt) && dt > 0;
      const tooFast = timed && d / dt > MAX_SPEED && d > 8;
      const jump = timed ? (dt > 120 && d > 150) : d > 250;
      if (tooFast || jump) { if (cur.length) out.push(cur); cur = [p]; last = p; continue; }
      if (d < MIN_STEP) continue;
      cur.push(p); last = p;
    }
    if (cur.length) out.push(cur);
  }
  return out.filter(s => s.length >= 2);
}

export function walkFromTrack(tr, file) {
  const segs = cleanSegments(tr.segs);
  if (!segs.length) return null;
  let start = Infinity, end = -Infinity, dist = 0, count = 0;
  for (const s of segs) for (let k = 0; k < s.length; k++) {
    const p = s[k]; count++;
    if (isFinite(p.t)) { if (p.t < start) start = p.t; if (p.t > end) end = p.t; }
    if (k) dist += hav(s[k - 1].lat, s[k - 1].lng, p.lat, p.lng);
  }
  const hasTime = isFinite(start), f = segs[0][0];
  return {
    id: uid(), name: tr.name || baseName(file), source: 'import', file, created: Date.now(),
    start: hasTime ? start : null, end: hasTime ? end : null, dur: hasTime ? end - start : null, dist,
    sig: f.lat.toFixed(5) + ',' + f.lng.toFixed(5) + ',' + (hasTime ? start : '') + ',' + count,
    segs: segs.map(s => { const a = []; s.forEach(p => a.push(r6(p.lat), r6(p.lng), hasTime && isFinite(p.t) ? Math.round((p.t - start) / 1000) : -1)); return a; }),
  };
}

export const validWalk = w => w && typeof w.id === 'string' && Array.isArray(w.segs) && w.segs.length > 0 &&
  w.segs.every(s => Array.isArray(s) && s.length >= 3 && s.length % 3 === 0 && s.every(Number.isFinite));
export const validPin = p => p && typeof p.id === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng);

let jszipP = null;
export function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipP) jszipP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = JSZIP_URL;
    s.onload = () => res(window.JSZip); s.onerror = () => { jszipP = null; rej(new Error('zip')); };
    document.head.appendChild(s);
  });
  return jszipP;
}
