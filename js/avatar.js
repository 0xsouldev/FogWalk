// Your fog sprite: parts, unlocks and the SVG drawing.

export const PARTS = {
  color: { label: 'Colour', items: [
    { id: 'amber', label: 'Amber', hex: '#ffb547' },
    { id: 'mint', label: 'Mint', hex: '#6fe3b0', req: { level: 2 } },
    { id: 'sky', label: 'Sky', hex: '#6cc4ff', req: { level: 3 } },
    { id: 'rose', label: 'Rose', hex: '#ff8fb1', req: { badge: 'first' } },
    { id: 'grape', label: 'Grape', hex: '#a98bff', req: { level: 5 } },
    { id: 'snow', label: 'Snow', hex: '#e9eef7', req: { badge: 'streak3' } },
    { id: 'midnight', label: 'Midnight', hex: '#46557d', req: { badge: 'night' } },
    { id: 'gold', label: 'Gold', hex: '#ffd84d', req: { badge: 'find25' } },
  ] },
  eyes: { label: 'Eyes', items: [
    { id: 'dots', label: 'Classic' },
    { id: 'happy', label: 'Happy', req: { level: 2 } },
    { id: 'sleepy', label: 'Sleepy', req: { badge: 'early' } },
    { id: 'star', label: 'Starry', req: { badge: 'gem' } },
    { id: 'shades', label: 'Shades', req: { level: 6 } },
  ] },
  hat: { label: 'Headwear', items: [
    { id: 'none', label: 'None' },
    { id: 'beanie', label: 'Beanie' },
    { id: 'cap', label: 'Cap', req: { level: 2 } },
    { id: 'headphones', label: 'Headphones', req: { level: 3 } },
    { id: 'party', label: 'Party hat', req: { badge: 'first' } },
    { id: 'explorer', label: 'Explorer hat', req: { badge: 'area01' } },
    { id: 'wizard', label: 'Wizard hat', req: { level: 8 } },
    { id: 'crown', label: 'Crown', req: { badge: 'crown' } },
  ] },
  extra: { label: 'Extra', items: [
    { id: 'none', label: 'None' },
    { id: 'scarf', label: 'Scarf', req: { level: 2 } },
    { id: 'backpack', label: 'Backpack', req: { badge: 'km5' } },
    { id: 'medal', label: 'Medal', req: { badge: 'long5' } },
    { id: 'lantern', label: 'Lantern', req: { badge: 'area1' } },
    { id: 'cape', label: 'Cape', req: { level: 6 } },
  ] },
  trail: { label: 'Trail', items: [
    { id: 'amber', label: 'Amber', hex: '#ffb547' },
    { id: 'cyan', label: 'Cyan', hex: '#5ee0ff', req: { level: 2 } },
    { id: 'pink', label: 'Pink', hex: '#ff7ab8', req: { level: 4 } },
    { id: 'lime', label: 'Lime', hex: '#b6f36b', req: { badge: 'streak3' } },
    { id: 'violet', label: 'Violet', hex: '#b99aff', req: { badge: 'isle05' } },
    { id: 'white', label: 'Starlight', hex: '#ffffff', req: { badge: 'streak7' } },
  ] },
};
export const DEFAULT_AVATAR = { color: 'amber', eyes: 'dots', hat: 'beanie', extra: 'none', trail: 'amber', name: '' };

export function isUnlocked(item, ctx) {
  if (!item.req) return true;
  if (item.req.level) return ctx.level >= item.req.level;
  if (item.req.badge) return ctx.earned.has(item.req.badge);
  return true;
}
export function unlockText(item, badgeName) {
  if (!item.req) return '';
  if (item.req.level) return 'Reach level ' + item.req.level;
  return 'Earn the ' + badgeName(item.req.badge) + ' badge';
}
export const part = (kind, id) => PARTS[kind].items.find(i => i.id === id) || PARTS[kind].items[0];

/** What actually shows: anything that has become locked again falls back to the default. */
export function effective(cfg, ctx) {
  const out = Object.assign({}, DEFAULT_AVATAR, cfg);
  for (const k of Object.keys(PARTS)) {
    const it = part(k, out[k]);
    if (!isUnlocked(it, ctx)) out[k] = DEFAULT_AVATAR[k];
  }
  return out;
}
export const trailHex = cfg => part('trail', cfg.trail).hex;

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f);
  return '#' + ((1 << 24) + (m(r) << 16) + (m(g) << 8) + m(b)).toString(16).slice(1);
}

const INK = '#1b1626';
const EYES = {
  dots: '<circle cx="26" cy="32" r="3.1" fill="' + INK + '"/><circle cx="38" cy="32" r="3.1" fill="' + INK + '"/><circle cx="27.1" cy="30.9" r="1.1" fill="#fff"/><circle cx="39.1" cy="30.9" r="1.1" fill="#fff"/>',
  happy: '<path d="M22.8 33.2q3.2-4.4 6.4 0M34.8 33.2q3.2-4.4 6.4 0" fill="none" stroke="' + INK + '" stroke-width="2.3" stroke-linecap="round"/>',
  sleepy: '<path d="M22.8 32.4q3.2 2.6 6.4 0M34.8 32.4q3.2 2.6 6.4 0" fill="none" stroke="' + INK + '" stroke-width="2.3" stroke-linecap="round"/>',
  star: '<path d="M26 27.8l1.2 2.7 2.9.3-2.2 1.9.7 2.9L26 34.1l-2.6 1.5.7-2.9-2.2-1.9 2.9-.3zM38 27.8l1.2 2.7 2.9.3-2.2 1.9.7 2.9L38 34.1l-2.6 1.5.7-2.9-2.2-1.9 2.9-.3z" fill="' + INK + '"/><circle cx="26.6" cy="30.6" r=".8" fill="#fff"/><circle cx="38.6" cy="30.6" r=".8" fill="#fff"/>',
  shades: '<rect x="20.5" y="28.5" width="10.5" height="6.5" rx="2.6" fill="#111"/><rect x="33" y="28.5" width="10.5" height="6.5" rx="2.6" fill="#111"/><path d="M31 31h2" stroke="#111" stroke-width="1.6"/><path d="M22.5 30.4l3 0" stroke="#fff" stroke-opacity=".6" stroke-width="1.2" stroke-linecap="round"/><path d="M35 30.4l3 0" stroke="#fff" stroke-opacity=".6" stroke-width="1.2" stroke-linecap="round"/>',
};
const HATS = {
  none: '',
  beanie: '<path d="M15.2 26.5c1-9.3 8-14.6 16.8-14.6s15.8 5.3 16.8 14.6c-11-4.2-22.6-4.2-33.6 0z" fill="#e2525c"/><path d="M15 26.6c11.1-4.4 22.9-4.4 34 0l-.2 3.6c-11-4.2-22.6-4.2-33.6 0z" fill="#b83a47"/><circle cx="32" cy="11.2" r="3.6" fill="#fff"/>',
  cap: '<path d="M15.6 24.6c.9-8.2 7.6-12.6 16.4-12.6s15.5 4.4 16.4 12.6c-10.6-3.2-22.2-3.2-32.8 0z" fill="#3a7bd5"/><path d="M33 22.6c8.2-2.2 17.6-1.4 23.4 2.8-6.6 1.4-14.6 1.2-22.4-.2z" fill="#2a5aa3"/><circle cx="32" cy="12.4" r="1.6" fill="#2a5aa3"/>',
  headphones: '<path d="M14 33c0-12.4 8-19.6 18-19.6S50 20.6 50 33" fill="none" stroke="#2b2f3a" stroke-width="3.6" stroke-linecap="round"/><rect x="9.6" y="28" width="7.6" height="12" rx="3.4" fill="#2b2f3a"/><rect x="46.8" y="28" width="7.6" height="12" rx="3.4" fill="#2b2f3a"/><rect x="11.2" y="31" width="2.4" height="6" rx="1.2" fill="#ffb547"/><rect x="50.4" y="31" width="2.4" height="6" rx="1.2" fill="#ffb547"/>',
  party: '<path d="M24.5 21L32 3l7.5 18z" fill="#7c6cff"/><path d="M27.3 14.4l9.4 1.6M29.6 8.8l5.6 1" stroke="#fff" stroke-opacity=".8" stroke-width="1.6" stroke-linecap="round"/><circle cx="32" cy="3.4" r="2.7" fill="#ffcf5c"/>',
  explorer: '<ellipse cx="32" cy="22.4" rx="22.5" ry="4.6" fill="#b88f55"/><path d="M20.6 21.6c0-7.4 5-10.8 11.4-10.8s11.4 3.4 11.4 10.8z" fill="#d8b47c"/><path d="M20.8 18.6h22.4v3H20.8z" fill="#6b4e2e"/>',
  wizard: '<path d="M17 23C23.5 18.5 26 6 37 1.5 34.6 9 40.4 16.4 47 23z" fill="#4b3fa8"/><ellipse cx="32" cy="23" rx="17.5" ry="3.8" fill="#3a3088"/><path d="M33 12.5l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#ffd84d"/><circle cx="27.5" cy="18.4" r="1" fill="#ffd84d"/><circle cx="39.6" cy="8" r=".9" fill="#ffd84d"/>',
  crown: '<path d="M19.5 21.5L21.4 9l6 5.6L32 6l4.6 8.6 6-5.6 1.9 12.5z" fill="#ffd84d" stroke="#b8860b" stroke-width="1.1" stroke-linejoin="round"/><circle cx="32" cy="17" r="1.8" fill="#e2525c"/><circle cx="25.4" cy="18" r="1.3" fill="#5ec8ff"/><circle cx="38.6" cy="18" r="1.3" fill="#5ec8ff"/>',
};
const BACK = {
  cape: '<path d="M17 29c9-5 21-5 30 0l6 22c-14 6-28 6-42 0z" fill="#c63c4a"/>',
  backpack: '<rect x="43" y="27" width="11" height="19" rx="4.5" fill="#8a5a3c"/><rect x="45" y="34" width="7" height="6" rx="2" fill="#6d4630"/>',
};
const FRONT = {
  scarf: '<path d="M15.6 41.4c11 6 21.8 6 32.8 0l.2 4.6c-11 6.2-22.2 6.2-33.2 0z" fill="#e2525c"/><path d="M38.5 46.8l4 9-6.2-1.4z" fill="#b83a47"/>',
  medal: '<path d="M28.6 39.5l3.4 5.4 3.4-5.4" fill="none" stroke="#3a7bd5" stroke-width="2.4" stroke-linejoin="round"/><circle cx="32" cy="47.4" r="4.4" fill="#ffd84d" stroke="#b8860b" stroke-width="1"/><path d="M32 45.2l.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2z" fill="#b8860b"/>',
  backpack: '<path d="M44.4 29.5c-1.8 5.6-1.8 11 0 16.4" fill="none" stroke="#6d4630" stroke-width="2.4" stroke-linecap="round"/>',
  lantern: '<circle cx="53" cy="45" r="8.5" fill="#ffcf5c" fill-opacity=".3"/><path d="M47.4 41.6l3.6-2.2" stroke="#5a3d10" stroke-width="2" stroke-linecap="round"/><path d="M51 37.6h4" stroke="#5a3d10" stroke-width="1.8" stroke-linecap="round"/><rect x="49.4" y="39.4" width="7.2" height="10" rx="2.2" fill="#ffcf5c" stroke="#5a3d10" stroke-width="1.4"/><path d="M53 41.6v5.4" stroke="#fff" stroke-opacity=".75" stroke-width="1.4" stroke-linecap="round"/>',
  cape: '<path d="M22 40.5c6 2.4 14 2.4 20 0" fill="none" stroke="#9b2c38" stroke-width="2.2" stroke-linecap="round"/>',
};

/** Returns an SVG string. `size` in px; the sprite's feet sit at the bottom centre. */
export function avatarSVG(cfg, size) {
  const body = part('color', cfg.color).hex, dark = shade(body, -0.32), light = shade(body, 0.55);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    '<ellipse cx="32" cy="58.5" rx="14" ry="3" fill="#000" fill-opacity=".35"/>' +
    (BACK[cfg.extra] || '') +
    '<ellipse cx="24" cy="54.2" rx="6" ry="3.6" fill="' + dark + '"/><ellipse cx="40" cy="54.2" rx="6" ry="3.6" fill="' + dark + '"/>' +
    '<path d="M32 14c11.2 0 19 8.2 19 20.2 0 12-7.8 19.8-19 19.8S13 46.2 13 34.2C13 22.2 20.8 14 32 14z" fill="' + body + '" stroke="' + dark + '" stroke-width="1.4"/>' +
    '<ellipse cx="32" cy="42" rx="10.5" ry="8" fill="' + light + '" fill-opacity=".45"/>' +
    '<ellipse cx="23.5" cy="22.6" rx="4.4" ry="2.4" transform="rotate(-28 23.5 22.6)" fill="#fff" fill-opacity=".5"/>' +
    '<circle cx="21.6" cy="37.6" r="2.7" fill="#ff5c86" fill-opacity=".32"/><circle cx="42.4" cy="37.6" r="2.7" fill="#ff5c86" fill-opacity=".32"/>' +
    (EYES[cfg.eyes] || EYES.dots) +
    '<path d="M29.2 39.2q2.8 2.4 5.6 0" fill="none" stroke="' + INK + '" stroke-width="1.8" stroke-linecap="round"/>' +
    (FRONT[cfg.extra] || '') +
    (HATS[cfg.hat] || '') +
    '</svg>';
}
