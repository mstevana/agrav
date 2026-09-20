// ============================================================================
// AGRAV — race liveries. One 1024² atlas per craft, painted on canvases
// (albedo, height, roughness, emissive) and turned into a material set:
// team paint with a pattern, panel lines and rivets in the height map, a
// race number, the team wordmark and four sponsor decals in fixed slots,
// accent light strips and the hot nozzle ring on the emissive map. Sponsors
// are invented; each has a vector mark drawn here.
//
// Atlas regions (u0, v0, u1, v1): the loft maps u round a section (0 at the
// keel, 0.5 on the spine) and v along it, so the fuselage's starboard side
// is u ≈ 0.25 and port u ≈ 0.75; seen from outside the whole map reads
// mirrored, which the decal transforms below account for.
// ============================================================================

import { setFromCanvases } from '../../../shared/gfx/surfaces.js';
import { makeRng } from '../../../shared/sim/rng.js';

export const SIZE = 1024;
export const ATLAS = {
  fuselage: [0, 0, 1, 0.5],
  wing: [0, 0.5, 0.5, 0.75],
  fin: [0.5, 0.5, 0.75, 0.75],
  nacelle: [0.75, 0.5, 1, 0.75],
  pontoon: [0, 0.75, 0.5, 1],
  misc: [0.5, 0.75, 1, 1]
};

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const lum = (n) => (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;

/** sponsor marks: logo(g, w, h) draws centred on the origin inside w × h */
export const SPONSORS = {
  umbrella: {
    name: 'UMBRELLA CORPORATION', short: 'UMBRELLA',
    logo(g, w, h) {
      const r = h * 0.42, cx = -w / 2 + r + 4;
      for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(cx, 0); g.arc(cx, 0, r, i * Math.PI / 4, (i + 1) * Math.PI / 4); g.closePath(); g.fillStyle = i % 2 ? '#f4f4f4' : '#d0141b'; g.fill(); }
      g.beginPath(); g.arc(cx, 0, r * 0.28, 0, 6.29); g.fillStyle = '#f4f4f4'; g.fill();
      g.fillStyle = '#ffffff'; g.font = `bold ${h * 0.42}px sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText('UMBRELLA', cx + r + 8, -h * 0.18);
      g.font = `${h * 0.24}px sans-serif`; g.fillText('CORPORATION', cx + r + 8, h * 0.22);
    }
  },
  zenith: { name: 'ZENITH FUEL', logo(g, w, h) { mark(g, w, h, '#ffb020', (r) => { g.beginPath(); g.moveTo(-r, r * 0.6); g.lineTo(0, -r); g.lineTo(r, r * 0.6); g.lineTo(r * 0.55, r * 0.6); g.lineTo(0, -r * 0.35); g.lineTo(-r * 0.55, r * 0.6); g.closePath(); g.fill(); }, 'ZENITH', 'FUEL'); } },
  neokyo: { name: 'NEO-KYO DYNAMICS', logo(g, w, h) { mark(g, w, h, '#ff2d95', (r) => { g.font = `bold ${r * 2}px sans-serif`; g.textAlign = 'center'; g.fillText('京', 0, r * 0.7); }, 'NEO-KYO', 'DYNAMICS'); } },
  axiom: { name: 'AXIOM AVIONICS', logo(g, w, h) { mark(g, w, h, '#2df1ff', (r) => { g.beginPath(); g.moveTo(-r, r); g.lineTo(0, -r); g.lineTo(r, r); g.closePath(); g.fill(); g.fillStyle = '#0a0d18'; g.fillRect(-r * 0.5, r * 0.2, r, r * 0.25); }, 'AXIOM', 'AVIONICS'); } },
  pulse: { name: 'PULSE ENERGY', logo(g, w, h) { mark(g, w, h, '#4dff88', (r) => { g.strokeStyle = '#4dff88'; g.lineWidth = r * 0.28; g.beginPath(); g.moveTo(-r, 0); g.lineTo(-r * 0.4, 0); g.lineTo(-r * 0.15, -r); g.lineTo(r * 0.15, r); g.lineTo(r * 0.4, 0); g.lineTo(r, 0); g.stroke(); }, 'PULSE', 'ENERGY DRINK'); } },
  vanta: { name: 'VANTA OPTICS', logo(g, w, h) { mark(g, w, h, '#ffffff', (r) => { g.beginPath(); g.ellipse(0, 0, r, r * 0.6, 0, 0, 6.29); g.fill(); g.fillStyle = '#2df1ff'; g.beginPath(); g.arc(0, 0, r * 0.45, 0, 6.29); g.fill(); g.fillStyle = '#000'; g.beginPath(); g.arc(0, 0, r * 0.2, 0, 6.29); g.fill(); }, 'VANTA', 'OPTICS'); } },
  orbital: { name: 'ORBITAL LOGISTICS', logo(g, w, h) { mark(g, w, h, '#9d4dff', (r) => { g.strokeStyle = '#9d4dff'; g.lineWidth = r * 0.22; g.beginPath(); g.ellipse(0, 0, r, r * 0.45, -0.5, 0, 6.29); g.stroke(); g.beginPath(); g.arc(0, 0, r * 0.4, 0, 6.29); g.fill(); }, 'ORBITAL', 'LOGISTICS'); } },
  hypercell: { name: 'HYPERCELL', logo(g, w, h) { mark(g, w, h, '#ffe14d', (r) => { g.fillRect(-r, -r * 0.6, r * 1.7, r * 1.2); g.fillRect(r * 0.7, -r * 0.25, r * 0.3, r * 0.5); g.fillStyle = '#0a0d18'; for (let i = 0; i < 3; i++) g.fillRect(-r * 0.85 + i * r * 0.55, -r * 0.4, r * 0.4, r * 0.8); }, 'HYPERCELL', 'BATTERIES'); } },
  synth: { name: 'SYNTH AUDIO', logo(g, w, h) { mark(g, w, h, '#ff7a2d', (r) => { g.strokeStyle = '#ff7a2d'; g.lineWidth = r * 0.25; g.beginPath(); for (let i = 0; i <= 12; i++) { const x = -r + i * r / 6, y = Math.sin(i * 1.3) * r * 0.7; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }, 'SYNTH', 'AUDIO'); } },
  nova: { name: 'NOVA COOLANT', logo(g, w, h) { mark(g, w, h, '#9fd8ff', (r) => { g.strokeStyle = '#9fd8ff'; g.lineWidth = r * 0.2; for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(-Math.cos(a) * r, -Math.sin(a) * r); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); } }, 'NOVA', 'COOLANT'); } }
};
function mark(g, w, h, colour, draw, line1, line2) {
  const r = h * 0.36, cx = -w / 2 + r + 6;
  g.save(); g.translate(cx, 0); g.fillStyle = colour; draw(r); g.restore();
  g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = `bold ${h * 0.42}px sans-serif`; g.fillText(line1, cx + r + 8, -h * 0.17);
  g.font = `${h * 0.22}px sans-serif`; g.fillStyle = colour; g.fillText(line2, cx + r + 8, h * 0.24);
}

/** cosmetic choices per craft: paint pattern, race number, sponsors (title first) */
export const STYLE = {
  kestrel: { pattern: 'stripes', number: 7, sponsors: ['zenith', 'axiom', 'synth', 'orbital'] },
  talon: { pattern: 'chevrons', number: 21, sponsors: ['pulse', 'neokyo', 'hypercell', 'nova'] },
  vantage: { pattern: 'split', number: 3, sponsors: ['vanta', 'axiom', 'orbital', 'synth'] },
  bulwark: { pattern: 'checker', number: 44, sponsors: ['umbrella', 'hypercell', 'zenith', 'nova'] },
  reaper: { pattern: 'flames', number: 13, sponsors: ['umbrella', 'pulse', 'synth', 'axiom'] },
  corsair: { pattern: 'clean', number: 1, sponsors: ['orbital', 'umbrella', 'neokyo', 'vanta'] }
};

// ----------------------------------------------------------- painting -----

function canvas() { const c = document.createElement('canvas'); c.width = c.height = SIZE; return c; }
const px = (r) => ({ x: r[0] * SIZE, y: r[1] * SIZE, w: (r[2] - r[0]) * SIZE, h: (r[3] - r[1]) * SIZE });

/**
 * Draw a decal at (u, v) of a region, w × h pixels, rotated `rot` radians
 * with optional flips, clipped to the region and repeated across the u wrap.
 */
function decal(g, region, u, v, w, h, rot, fx, fy, draw) {
  const R = px(region);
  g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
  for (const du of [-1, 0, 1]) {
    const cu = u + du; if (cu < -0.3 || cu > 1.3) continue;
    g.save(); g.translate(R.x + cu * R.w, R.y + v * R.h); g.rotate(rot); g.scale(fx ? -1 : 1, fy ? -1 : 1);
    draw(g, w, h); g.restore();
  }
  g.restore();
}
const fill = (g, region, u0, v0, u1, v1, colour) => { const R = px(region); g.fillStyle = colour; g.fillRect(R.x + u0 * R.w, R.y + v0 * R.h, (u1 - u0) * R.w, (v1 - v0) * R.h); };
const line = (g, region, u0, v0, u1, v1, colour, width) => { const R = px(region); g.strokeStyle = colour; g.lineWidth = width; g.beginPath(); g.moveTo(R.x + u0 * R.w, R.y + v0 * R.h); g.lineTo(R.x + u1 * R.w, R.y + v1 * R.h); g.stroke(); };

function wordmark(name, colour) { return (g, w, h) => { g.fillStyle = colour; g.font = `900 ${h * 0.9}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 0, 0, w); }; }
function numberPlate(n, colour, bg) { return (g, w, h) => { g.fillStyle = bg; g.beginPath(); g.ellipse(0, 0, w / 2, h / 2, 0, 0, 6.29); g.fill(); g.fillStyle = colour; g.font = `900 ${h * 0.8}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 0, h * 0.04); }; }
function sponsorLogo(id, dark) { return (g, w, h) => { g.save(); if (dark) { g.fillStyle = 'rgba(8,10,16,0.75)'; g.fillRect(-w / 2, -h / 2, w, h); } SPONSORS[id].logo(g, w, h); g.restore(); }; }
const raised = (g, w, h) => { g.fillStyle = '#8c8c8c'; g.fillRect(-w / 2, -h / 2, w, h); };
const matte = (g, w, h) => { g.fillStyle = '#6a6a6a'; g.fillRect(-w / 2, -h / 2, w, h); };

// fuselage decal slots: the map reads mirrored from outside, so every slot flips x; the sides rotate
const FUS = { stbd: (u, v) => [u, v, Math.PI / 2, true, false], port: (u, v) => [u, v, -Math.PI / 2, true, false], top: (u, v) => [u, v, 0, true, false] };

function paintPattern(g, region, style, accent, base, rng) {
  const A = hex(accent);
  switch (style.pattern) {
    case 'stripes': fill(g, region, 0.44, 0, 0.47, 1, A); fill(g, region, 0.53, 0, 0.56, 1, A); fill(g, region, 0.495, 0, 0.505, 1, A); break;
    case 'chevrons': for (let v = 0.12; v < 0.9; v += 0.11) { const R = px(region); g.fillStyle = A; g.beginPath(); g.moveTo(R.x + 0.38 * R.w, R.y + (v + 0.05) * R.h); g.lineTo(R.x + 0.5 * R.w, R.y + v * R.h); g.lineTo(R.x + 0.62 * R.w, R.y + (v + 0.05) * R.h); g.lineTo(R.x + 0.62 * R.w, R.y + (v + 0.08) * R.h); g.lineTo(R.x + 0.5 * R.w, R.y + (v + 0.03) * R.h); g.lineTo(R.x + 0.38 * R.w, R.y + (v + 0.08) * R.h); g.closePath(); g.fill(); } break;
    case 'split': fill(g, region, 0.5, 0, 1, 1, A); fill(g, region, 0.49, 0, 0.51, 1, '#f4f4f4'); break;
    case 'checker': { const R = px(region); for (let i = 0; i < 24; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) { g.fillStyle = A; g.fillRect(R.x + i * R.w / 24, R.y + (0.34 + j * 0.03) * R.h, R.w / 24, 0.03 * R.h); } break; }
    case 'flames': { const R = px(region); g.fillStyle = A; for (const side of [0.25, 0.75]) { g.beginPath(); g.moveTo(R.x + (side - 0.2) * R.w, R.y); for (let k = 0; k < 7; k++) { const u = side - 0.2 + k * 0.4 / 6; g.lineTo(R.x + u * R.w, R.y + (0.12 + rng() * 0.22) * R.h); g.lineTo(R.x + (u + 0.03) * R.w, R.y + 0.02 * R.h); } g.lineTo(R.x + (side + 0.2) * R.w, R.y); g.closePath(); g.fill(); } break; }
    default: fill(g, region, 0.495, 0, 0.505, 1, A); fill(g, region, 0.2, 0.4, 0.8, 0.42, A);
  }
}

/** the material set for a craft definition (cached per id) */
export function liverySet(def) {
  const style = STYLE[def.id] || STYLE.corsair;
  const rng = makeRng(def.id.length * 131 + style.number);
  const A = document.createElement('canvas'), H = document.createElement('canvas'), Rg = document.createElement('canvas'), E = document.createElement('canvas');
  for (const c of [A, H, Rg, E]) { c.width = c.height = SIZE; }
  const a = A.getContext('2d'), h = H.getContext('2d'), r = Rg.getContext('2d'), e = E.getContext('2d');
  const base = hex(def.colour), accent = hex(def.accent), dark = lum(def.colour) > 0.6;
  const textOn = dark ? '#101218' : '#f4f4f4';
  a.fillStyle = '#2a2d36'; a.fillRect(0, 0, SIZE, SIZE);
  h.fillStyle = '#808080'; h.fillRect(0, 0, SIZE, SIZE);
  r.fillStyle = '#5a5a5a'; r.fillRect(0, 0, SIZE, SIZE);
  e.fillStyle = '#000000'; e.fillRect(0, 0, SIZE, SIZE);
  const [title, s2, s3, s4] = style.sponsors;

  // ---- fuselage
  const F = ATLAS.fuselage;
  fill(a, F, 0, 0, 1, 1, base);
  fill(a, F, 0, 0, 1, 0.06, '#1a1c22');                       // dark nose tip
  fill(a, F, 0.36, 0.16, 0.64, 0.3, '#15171d');               // anti-glare ahead of the canopy
  fill(r, F, 0.36, 0.16, 0.64, 0.3, '#a0a0a0');
  paintPattern(a, F, style, def.accent, base, rng);
  fill(a, F, 0, 0.93, 1, 1, '#3a3d46');                        // heat-stained tail
  fill(r, F, 0, 0.93, 1, 1, '#404040');
  // panel lines and rivets (height + a faint albedo line)
  for (const v of [0.12, 0.3, 0.46, 0.62, 0.78, 0.9]) { line(h, F, 0, v, 1, v, '#5c5c5c', 3); line(a, F, 0, v, 1, v, 'rgba(0,0,0,0.25)', 2); }
  for (const u of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) { line(h, F, u, 0.08, u, 0.92, '#606060', 2); }
  { const R = px(F); h.fillStyle = '#a8a8a8'; for (const v of [0.13, 0.31, 0.63, 0.79]) for (let i = 0; i < 48; i++) h.fillRect(R.x + (i + 0.5) * R.w / 48 - 2, R.y + v * R.h + 6, 4, 4); }
  // vents behind the canopy
  { const R = px(F); for (let i = 0; i < 6; i++) { const y = R.y + (0.5 + i * 0.02) * R.h; a.fillStyle = '#101218'; a.fillRect(R.x + 0.43 * R.w, y, 0.14 * R.w, 4); h.fillStyle = '#404040'; h.fillRect(R.x + 0.43 * R.w, y, 0.14 * R.w, 4); } }
  // decals: team wordmark on both sides, number on the nose deck, sponsors along the flanks and the rear deck
  const W = px(F).w;
  // the flanks ahead of the wings and nacelles (v < 0.6) are the only side surface every ship shows
  for (const side of ['stbd', 'port']) {
    const u = side === 'stbd' ? 0.3 : 0.7, out = side === 'stbd' ? -1 : 1;
    decal(a, F, ...FUS[side](u, 0.42), W * 0.42, W * 0.085, wordmark(def.name, textOn));
    decal(h, F, ...FUS[side](u, 0.42), W * 0.42, W * 0.085, raised);
    decal(a, F, ...FUS[side](u + out * 0.1, 0.24), W * 0.2, W * 0.06, sponsorLogo(s2, true));
    decal(h, F, ...FUS[side](u + out * 0.1, 0.24), W * 0.2, W * 0.06, raised);
    decal(a, F, ...FUS[side](u + out * 0.1, 0.5), W * 0.2, W * 0.06, sponsorLogo(s3, true));
    decal(a, F, ...FUS[side](u + out * 0.02, 0.62), W * 0.18, W * 0.055, sponsorLogo(s4, true));
  }
  decal(a, F, ...FUS.top(0.5, 0.12), W * 0.1, W * 0.1, numberPlate(style.number, '#101218', '#f4f4f4'));
  decal(h, F, ...FUS.top(0.5, 0.12), W * 0.1, W * 0.1, raised);
  decal(a, F, ...FUS.top(0.5, 0.62), W * 0.3, W * 0.07, sponsorLogo(title, true));
  decal(h, F, ...FUS.top(0.5, 0.62), W * 0.3, W * 0.07, raised);
  decal(r, F, ...FUS.top(0.5, 0.62), W * 0.3, W * 0.07, matte);
  decal(a, F, ...FUS.top(0.5, 0.82), W * 0.22, W * 0.06, sponsorLogo(s2, true));
  // light strips down the flanks and the hot ring at the nozzles
  for (const u of [0.17, 0.83]) fill(e, F, u - 0.006, 0.14, u + 0.006, 0.86, accent);
  fill(e, F, 0, 0.965, 1, 0.99, '#ff8a30');

  // ---- wings: v runs left tip → right tip, the top surface is u 0.25..0.75
  const Wg = ATLAS.wing, Ww = px(Wg).w;
  fill(a, Wg, 0, 0, 1, 1, base);
  fill(a, Wg, 0.68, 0, 0.75, 1, accent);                        // leading-edge accent
  fill(a, Wg, 0.25, 0, 0.3, 1, '#1a1c22');                      // dark trailing edge
  for (const v of [0.15, 0.3, 0.7, 0.85]) line(h, Wg, 0, v, 1, v, '#5c5c5c', 3);
  for (const v of [0.24, 0.76]) { decal(a, Wg, 0.5, v, Ww * 0.28, Ww * 0.08, Math.PI / 2, false, false, wordmark(def.name, textOn)); decal(h, Wg, 0.5, v, Ww * 0.28, Ww * 0.08, Math.PI / 2, false, false, raised); }
  decal(a, Wg, 0.5, 0.08, Ww * 0.2, Ww * 0.06, Math.PI / 2, false, false, sponsorLogo(s4, true));
  decal(a, Wg, 0.5, 0.92, Ww * 0.2, Ww * 0.06, Math.PI / 2, false, false, sponsorLogo(s3, true));
  decal(a, Wg, 0.5, 0.5, Ww * 0.1, Ww * 0.1, Math.PI / 2, false, false, numberPlate(style.number, '#101218', '#f4f4f4'));
  fill(e, Wg, 0.45, 0.005, 0.55, 0.02, '#ff3030'); fill(e, Wg, 0.45, 0.98, 0.55, 0.995, '#30ff60');   // nav lights

  // ---- fin: starboard face is u ≈ 0.5, port face wraps at u ≈ 1.0
  const Fn = ATLAS.fin, Fw = px(Fn).w;
  fill(a, Fn, 0, 0, 1, 1, base);
  fill(a, Fn, 0.7, 0, 0.8, 1, accent);
  line(h, Fn, 0, 0.5, 1, 0.5, '#5c5c5c', 3);
  decal(a, Fn, 0.5, 0.5, Fw * 0.8, Fw * 0.26, 0, false, true, sponsorLogo(title, true));
  decal(h, Fn, 0.5, 0.5, Fw * 0.8, Fw * 0.26, 0, false, true, raised);
  decal(a, Fn, 1.0, 0.5, Fw * 0.8, Fw * 0.26, Math.PI, false, false, sponsorLogo(title, true));
  decal(h, Fn, 1.0, 0.5, Fw * 0.8, Fw * 0.26, Math.PI, false, false, raised);
  fill(e, Fn, 0, 0.96, 1, 1, '#ffffff');                        // tail light along the fin tip

  // ---- nacelles: alloy with a team band and small decals on the outer sides
  const N = ATLAS.nacelle, Nw = px(N).w;
  fill(a, N, 0, 0, 1, 1, '#3a3e48'); fill(r, N, 0, 0, 1, 1, '#3c3c3c');
  fill(a, N, 0, 0.15, 1, 0.55, base); fill(a, N, 0, 0.55, 1, 0.6, accent);
  for (const v of [0.15, 0.4, 0.6, 0.8]) line(h, N, 0, v, 1, v, '#585858', 3);
  { const R = px(N); h.fillStyle = '#404040'; for (let i = 0; i < 10; i++) h.fillRect(R.x, R.y + (0.62 + i * 0.03) * R.h, R.w, 3); }
  decal(a, N, 0.25, 0.4, Nw * 0.7, Nw * 0.2, Math.PI / 2, true, false, sponsorLogo(s2, true));
  decal(a, N, 0.75, 0.4, Nw * 0.7, Nw * 0.2, -Math.PI / 2, true, false, sponsorLogo(s2, true));
  fill(e, N, 0, 0.95, 1, 1, '#ff8a30');

  // ---- pontoons / second hulls: team paint, pinstripe, sponsor
  const P = ATLAS.pontoon, Pw = px(P).w;
  fill(a, P, 0, 0, 1, 1, base); fill(a, P, 0.48, 0, 0.52, 1, accent); fill(a, P, 0, 0, 1, 0.05, '#1a1c22');
  for (const v of [0.2, 0.4, 0.6, 0.8]) line(h, P, 0, v, 1, v, '#5c5c5c', 3);
  decal(a, P, 0.25, 0.5, Pw * 0.5, Pw * 0.1, Math.PI / 2, true, false, sponsorLogo(s3, true));
  decal(a, P, 0.75, 0.5, Pw * 0.5, Pw * 0.1, -Math.PI / 2, true, false, sponsorLogo(s4, true));
  fill(e, P, 0.15, 0.1, 0.19, 0.9, accent); fill(e, P, 0.81, 0.1, 0.85, 0.9, accent);

  // ---- misc: armour plates, intakes, canopy frame
  const M = ATLAS.misc;
  fill(a, M, 0, 0, 1, 1, base); fill(r, M, 0, 0, 1, 1, '#909090');
  { const R = px(M); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { if ((i + j) % 3 === 0) { a.fillStyle = 'rgba(0,0,0,0.18)'; a.fillRect(R.x + i * R.w / 8, R.y + j * R.h / 8, R.w / 8, R.h / 8); } h.strokeStyle = '#5a5a5a'; h.lineWidth = 3; h.strokeRect(R.x + i * R.w / 8, R.y + j * R.h / 8, R.w / 8, R.h / 8); } }

  return setFromCanvases('livery:' + def.id, SIZE, { albedo: A, height: H, rough: Rg, emissive: E, normalStrength: 2.2 });
}
