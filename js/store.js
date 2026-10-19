// Storage: IndexedDB on the device, with an in-memory fallback when the browser blocks it.

let dbp = null, memory = null, onFallback = null;

export function onStorageFallback(fn) { onFallback = fn; }

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in window)) { rej(new Error('no idb')); return; }
    const r = indexedDB.open('fogwalk', 2);
    r.onupgradeneeded = e => {
      const d = r.result;
      if (e.oldVersion < 1) { d.createObjectStore('walks', { keyPath: 'id' }); d.createObjectStore('kv'); }
      if (e.oldVersion < 2) d.createObjectStore('pins', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
  return dbp;
}

function memOp(store, fn) {
  if (!memory) { memory = { walks: new Map(), pins: new Map(), kv: new Map() }; if (onFallback) onFallback(); }
  const m = memory[store];
  const fake = store === 'kv'
    ? { get: k => ({ result: m.get(k) }), put: (v, k) => { m.set(k, v); }, delete: k => { m.delete(k); } }
    : { getAll: () => ({ result: [...m.values()] }), put: v => { m.set(v.id, v); }, delete: id => { m.delete(id); }, clear: () => { m.clear(); } };
  const r = fn(fake);
  return Promise.resolve(r && r.result);
}

async function tx(store, mode, fn) {
  let d;
  try { d = await open(); } catch (e) { return memOp(store, fn); }
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out; const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

const table = name => ({
  all: () => tx(name, 'readonly', s => s.getAll()),
  putMany: rows => tx(name, 'readwrite', s => { rows.forEach(v => s.put(v)); }),
  del: id => tx(name, 'readwrite', s => { s.delete(id); }),
  clear: () => tx(name, 'readwrite', s => { s.clear(); }),
});

export const DB = {
  walks: table('walks'),
  pins: table('pins'),
  get: k => tx('kv', 'readonly', s => s.get(k)),
  set: (k, v) => tx('kv', 'readwrite', s => { s.put(v, k); }),
  unset: k => tx('kv', 'readwrite', s => { s.delete(k); }),
};

/* small per-device settings in localStorage */
export function loadLocal(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? Object.assign({}, fallback, v) : Object.assign({}, fallback); }
  catch (e) { return Object.assign({}, fallback); }
}
export function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
