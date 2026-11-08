/* Orbit Rally — a three-lap space racer around planet Vyom.
   Plain HTML canvas + Web Audio. No libraries, no network. */
(() => {
'use strict';

/* ======================================================================
   0. Small helpers
   ====================================================================== */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (id) => document.getElementById(id);
function mulberry32(seed) {             // tiny seeded random, so the course is the same every race
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fmt(t) {                       // 83.456 -> "1:23.45"
  if (!isFinite(t)) return '–';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}

/* ======================================================================
   1. Saved data (best time, best laps, ghost, settings)
   ====================================================================== */
const SAVE_KEY = 'orbitRally.v1';
const save = {
  data: {},
  load() { try { this.data = JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { this.data = {}; } },
  write() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* storage blocked: game still works */ } },
};
save.load();

/* ======================================================================
   2. The track: a closed spline around planet Vyom
   ====================================================================== */
const CTRL = [
  [0, -1150], [700, -1250], [1350, -1000], [1650, -450], [1500, 50], [1100, 250],
  [1250, 700], [1650, 1050], [1300, 1450], [600, 1350], [100, 1000], [-400, 1300],
  [-1100, 1350], [-1600, 900], [-1500, 300], [-1050, 0], [-1450, -500], [-1300, -1050], [-700, -1250],
];
const HW = 140;          // half the track width
const WALL = 320;        // beyond this from the centre line you hit the energy fence
const STEP = 10;         // distance between track samples

const T = { xs: null, ys: null, tx: null, ty: null, nx: null, ny: null, N: 0, L: 0, ds: 0 };
(function buildTrack() {
  const dense = [];
  const n = CTRL.length;
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
    for (let k = 0; k < 60; k++) {
      const t = k / 60, t2 = t * t, t3 = t2 * t;
      const f = (j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      dense.push([f(0), f(1)]);
    }
  }
  const len = dense.length;
  const cum = [0];
  for (let i = 1; i <= len; i++) {
    const a = dense[i - 1], b = dense[i % len];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  T.L = cum[len];
  T.N = Math.round(T.L / STEP);
  T.ds = T.L / T.N;
  const N = T.N;
  T.xs = new Float32Array(N); T.ys = new Float32Array(N);
  T.tx = new Float32Array(N); T.ty = new Float32Array(N);
  T.nx = new Float32Array(N); T.ny = new Float32Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * T.ds;
    while (cum[j + 1] < s) j++;
    const u = (s - cum[j]) / (cum[j + 1] - cum[j]);
    const a = dense[j], b = dense[(j + 1) % len];
    T.xs[i] = a[0] + (b[0] - a[0]) * u;
    T.ys[i] = a[1] + (b[1] - a[1]) * u;
  }
  for (let i = 0; i < N; i++) {
    const p = (i - 1 + N) % N, q = (i + 1) % N;
    let dx = T.xs[q] - T.xs[p], dy = T.ys[q] - T.ys[p];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    T.tx[i] = dx; T.ty[i] = dy;
    T.nx[i] = -dy; T.ny[i] = dx;
  }
})();

const wrapIdx = (i) => ((i % T.N) + T.N) % T.N;
const wrapS = (s) => ((s % T.L) + T.L) % T.L;
function pointAt(s, lat) {               // world position at distance s along the track, lat across it
  const f = wrapS(s) / T.ds;
  const i = Math.floor(f), j = wrapIdx(i + 1), u = f - i;
  const x = lerp(T.xs[i], T.xs[j], u), y = lerp(T.ys[i], T.ys[j], u);
  return { x: x + T.nx[i] * lat, y: y + T.ny[i] * lat, i };
}
function locate(x, y, hint) {            // nearest track position near a hint index
  let best = -1, bd = Infinity;
  const W = hint < 0 ? T.N : 60;
  const start = hint < 0 ? 0 : hint - W;
  const end = hint < 0 ? T.N : hint + W;
  for (let k = start; k < end; k++) {
    const i = wrapIdx(k);
    const dx = x - T.xs[i], dy = y - T.ys[i];
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  const dx = x - T.xs[best], dy = y - T.ys[best];
  return {
    i: best,
    s: wrapS(best * T.ds + dx * T.tx[best] + dy * T.ty[best]),
    lat: dx * T.nx[best] + dy * T.ny[best],
  };
}

/* Track paths, built once and stroked every frame */
function offsetPath(off) {
  const p = new Path2D();
  for (let i = 0; i < T.N; i++) {
    const x = T.xs[i] + T.nx[i] * off, y = T.ys[i] + T.ny[i] * off;
    i ? p.lineTo(x, y) : p.moveTo(x, y);
  }
  p.closePath();
  return p;
}
const PATH_CENTER = offsetPath(0);

/* Direction chevrons painted on the track so first-time players know which way to go */
const CHEVRONS = [];
for (let s = 300; s < T.L - 150; s += 380) {
  const p = pointAt(s, 0);
  CHEVRONS.push({ x: p.x, y: p.y, a: Math.atan2(T.ty[p.i], T.tx[p.i]) });
}

/* ======================================================================
   3. Course layout: planet, moons, fuel cells, asteroids, crates
   ====================================================================== */
const PLANET = { x: 0, y: 0, r: 380 };
const MOON_FRACS = [0.47, 0.835];
const MOON_DIST = 470, MOON_R = 105, ZONE_R = 520;
const MOONS = MOON_FRACS.map((f, k) => {
  const p = pointAt(f * T.L, 0);
  // push the moon outward, away from the planet
  const side = (T.nx[p.i] * p.x + T.ny[p.i] * p.y) > 0 ? 1 : -1;
  const rnd = mulberry32(77 + k);
  const craters = [];
  for (let c = 0; c < 7; c++) {
    const a = rnd() * TAU, d = rnd() * MOON_R * 0.7;
    craters.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 8 + rnd() * 18 });
  }
  return { x: p.x + T.nx[p.i] * MOON_DIST * side, y: p.y + T.ny[p.i] * MOON_DIST * side, craters, name: k ? 'Chandra' : 'Tara', inside: false };
});

const rng = mulberry32(2026);
const CELL_GROUPS = [0.06, 0.15, 0.25, 0.34, 0.45, 0.555, 0.64, 0.735, 0.83, 0.92];
const CELLS = [];
CELL_GROUPS.forEach((f) => {
  const base = (rng() * 2 - 1) * 70;
  const phase = rng() * TAU;
  for (let k = 0; k < 5; k++) {
    const p = pointAt(f * T.L + (k - 2) * 60, base + Math.sin(phase + k * 0.7) * 30);
    CELLS.push({ x: p.x, y: p.y, alive: true, t: 0, bob: rng() * TAU });
  }
});

const ROCK_FRACS = [0.105, 0.2, 0.29, 0.39, 0.42, 0.5, 0.59, 0.685, 0.775, 0.79, 0.87, 0.965];
const ROCKS = ROCK_FRACS.map((f, k) => {
  const s = f * T.L;
  const p = pointAt(s, 0);
  const r = 26 + rng() * 16;
  const verts = [];
  const nv = 9;
  for (let v = 0; v < nv; v++) verts.push(r * (0.75 + rng() * 0.35));
  return {
    i: p.i, bx: p.x, by: p.y, lat: (rng() * 2 - 1) * 95,
    amp: k % 2 ? 75 : 0, w: 0.55 + rng() * 0.5, ph: rng() * TAU,
    r, verts, spin: (rng() - 0.5) * 1.2, rot: rng() * TAU,
    x: p.x, y: p.y, alive: true, t: 0,
  };
});

const CRATE_FRACS = [0.13, 0.36, 0.61, 0.895];
const CRATES = CRATE_FRACS.map((f, k) => {
  const p = pointAt(f * T.L, k % 2 ? 55 : -55);
  return { x: p.x, y: p.y, alive: true, t: 0 };
});

/* ======================================================================
   4. Physics tuning
   ====================================================================== */
const TUNE = {
  thrust: 640, boostThrust: 950, warpThrust: 1250,
  brake: 900, reverseMax: 150,
  cap: 500, boostCap: 780, warpCap: 900, slingCap: 640, dustCap: 260,
  turn: 3.1, grip: 5.0, driftGrip: 2.4,
  shipR: 20, laps: 3,
  boostCost: 1 / 3, cellCharge: 1 / 15, boostTime: 1.5, warpTime: 2.2, shieldTime: 6,
};

/* ======================================================================
   5. Canvas + screen
   ====================================================================== */
const canvas = $('game');
const ctx = canvas.getContext('2d');
const mini = $('minimap');
const mctx = mini.getContext('2d');
let W = 0, H = 0, DPR = 1;
let nebula = null;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  buildNebula();
  const mw = mini.clientWidth || 150, mh = mini.clientHeight || 120;
  mini.width = Math.round(mw * DPR); mini.height = Math.round(mh * DPR);
  buildMinimap();
}

/* Pre-rendered sprites for speed on phones */
function glowSprite(color, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}
const SPR = {
  ion: glowSprite('rgba(111,214,255,0.8)'),
  saffron: glowSprite('rgba(255,170,60,0.8)'),
  cell: glowSprite('rgba(138,255,201,0.75)'),
  white: glowSprite('rgba(230,240,255,0.7)'),
  danger: glowSprite('rgba(255,107,122,0.8)'),
  rock: glowSprite('rgba(180,160,140,0.5)'),
};

function starTile(count, maxR, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * 512, y = r() * 512, rad = 0.4 + r() * maxR;
    const tint = r();
    g.fillStyle = tint < 0.15 ? 'rgba(255,214,160,0.9)' : tint < 0.3 ? 'rgba(170,220,255,0.9)' : 'rgba(235,240,255,0.85)';
    g.globalAlpha = 0.35 + r() * 0.65;
    g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  return c;
}
const STAR_LAYERS = [
  { img: starTile(90, 0.7, 1), f: 0.06 },
  { img: starTile(45, 1.1, 2), f: 0.16 },
  { img: starTile(18, 1.6, 3), f: 0.35 },
];

function buildNebula() {
  const w = Math.max(64, Math.round(W / 4)), h = Math.max(64, Math.round(H / 4));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const blob = (x, y, r, col) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  };
  blob(w * 0.2, h * 0.3, Math.max(w, h) * 0.6, 'rgba(70,40,140,0.35)');
  blob(w * 0.85, h * 0.8, Math.max(w, h) * 0.55, 'rgba(20,90,130,0.30)');
  blob(w * 0.7, h * 0.15, Math.max(w, h) * 0.35, 'rgba(160,80,40,0.16)');
  nebula = c;
}

/* Minimap: track outline drawn once */
let miniBg = null, miniScale = 1, miniOX = 0, miniOY = 0;
function buildMinimap() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < T.N; i++) {
    minX = Math.min(minX, T.xs[i]); maxX = Math.max(maxX, T.xs[i]);
    minY = Math.min(minY, T.ys[i]); maxY = Math.max(maxY, T.ys[i]);
  }
  const pad = 10 * DPR;
  const mw = mini.width, mh = mini.height;
  miniScale = Math.min((mw - pad * 2) / (maxX - minX), (mh - pad * 2) / (maxY - minY));
  miniOX = mw / 2 - ((minX + maxX) / 2) * miniScale;
  miniOY = mh / 2 - ((minY + maxY) / 2) * miniScale;
  const c = document.createElement('canvas');
  c.width = mw; c.height = mh;
  const g = c.getContext('2d');
  g.setTransform(miniScale, 0, 0, miniScale, miniOX, miniOY);
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(6,9,18,0.75)'; g.lineWidth = 7 * DPR / miniScale; g.stroke(PATH_CENTER);
  g.strokeStyle = 'rgba(111,214,255,0.55)'; g.lineWidth = 2.2 * DPR / miniScale; g.stroke(PATH_CENTER);
  g.fillStyle = 'rgba(140,110,230,0.55)';
  g.beginPath(); g.arc(PLANET.x, PLANET.y, PLANET.r, 0, TAU); g.fill();
  g.fillStyle = 'rgba(180,195,230,0.5)';
  MOONS.forEach((m) => { g.beginPath(); g.arc(m.x, m.y, MOON_R * 1.3, 0, TAU); g.fill(); });
  // start line tick
  const sx = T.xs[0], sy = T.ys[0];
  g.strokeStyle = '#fff'; g.lineWidth = 2 * DPR / miniScale;
  g.beginPath();
  g.moveTo(sx + T.nx[0] * 260, sy + T.ny[0] * 260);
  g.lineTo(sx - T.nx[0] * 260, sy - T.ny[0] * 260);
  g.stroke();
  miniBg = c;
}

/* ======================================================================
   6. Sound: everything is synthesised, so there are no audio files
   ====================================================================== */
const sfx = {
  ctx: null, master: null, eng: null, noiseBuf: null,
  muted: !!save.data.muted, lastScrape: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(c.destination);
    // engine: two detuned oscillators through a low-pass filter
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square';
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 4;
    const g = c.createGain(); g.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.eng = { o1, o2, f, g };
    // one second of white noise, reused for crashes and boosts
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.03);
  },
  engine(speedFrac, thrust, on) {
    if (!this.eng) return;
    const t = this.ctx.currentTime;
    this.eng.o1.frequency.setTargetAtTime(48 + speedFrac * 120, t, 0.08);
    this.eng.o2.frequency.setTargetAtTime(49.5 + speedFrac * 121, t, 0.08);
    this.eng.f.frequency.setTargetAtTime(260 + speedFrac * 1400 + thrust * 300, t, 0.08);
    this.eng.g.gain.setTargetAtTime(on ? 0.05 + thrust * 0.05 + speedFrac * 0.03 : 0, t, 0.1);
  },
  tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, vol, freq, sweepTo = 0, type = 'lowpass') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  },
  cell(n) { this.tone(880 + (n % 5) * 110, 0.12, 'triangle', 0.14); },
  crash() { this.noise(0.5, 0.6, 900, 80); this.tone(110, 0.35, 'sawtooth', 0.18, 40); },
  scrape() {
    if (!this.ctx || this.ctx.currentTime - this.lastScrape < 0.25) return;
    this.lastScrape = this.ctx.currentTime;
    this.noise(0.18, 0.18, 2400, 900, 'bandpass');
  },
  boost() { this.noise(0.9, 0.35, 300, 3000, 'bandpass'); this.tone(220, 0.6, 'sawtooth', 0.08, 660); },
  warp() { this.tone(300, 0.8, 'sine', 0.2, 1400); this.noise(1.2, 0.25, 500, 5000, 'bandpass'); },
  shield() { this.tone(520, 0.25, 'sine', 0.18, 780); this.tone(780, 0.3, 'sine', 0.12, 1040, 0.08); },
  shieldHit() { this.tone(1200, 0.2, 'square', 0.1, 300); this.noise(0.25, 0.3, 3000, 600, 'highpass'); },
  sling() { this.tone(180, 0.7, 'triangle', 0.18, 720); },
  beep(go) { this.tone(go ? 880 : 440, go ? 0.5 : 0.18, 'square', 0.12); },
  lap() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, 0, i * 0.08)); },
  finish() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.18, 0, i * 0.11)); },
  wrong() { this.tone(200, 0.25, 'square', 0.08); },
};

/* ======================================================================
   7. Input: keyboard and touch buttons
   ====================================================================== */
const input = { left: false, right: false, up: false, brake: false, boost: false };
const touchHeld = { left: false, right: false, brake: false, boost: false };
let usingTouch = false;
let boostPressedEdge = false;

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'brake', KeyS: 'brake',
  Space: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost',
};
window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) {
    e.preventDefault();
    if (k === 'boost' && !input.boost) boostPressedEdge = true;
    input[k] = true;
  }
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (mode === 'race' || mode === 'countdown') pauseGame();
    else if (mode === 'paused') resumeGame();
  }
  if (e.code === 'Enter' && mode === 'menu' && document.activeElement === document.body) startRace();
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) { e.preventDefault(); input[k] = false; }
});
window.addEventListener('blur', () => { for (const k in input) input[k] = false; });

function showTouch() {
  usingTouch = true;
  if (mode === 'race' || mode === 'countdown') $('touch').hidden = false;
}
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) usingTouch = true;
window.addEventListener('touchstart', showTouch, { passive: true });

document.querySelectorAll('.t-btn').forEach((btn) => {
  const key = btn.dataset.key;
  const pointers = new Set();
  const update = () => {
    const on = pointers.size > 0;
    if (key === 'boost' && on && !touchHeld.boost) boostPressedEdge = true;
    touchHeld[key] = on;
    btn.classList.toggle('on', on);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sfx.init();
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    pointers.add(e.pointerId); update();
  });
  const up = (e) => { pointers.delete(e.pointerId); update(); };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

/* ======================================================================
   8. Particles
   ====================================================================== */
const parts = [];
const MAX_PARTS = 420;
function spawn(x, y, vx, vy, life, size, spr) {
  if (parts.length >= MAX_PARTS) parts.shift();
  parts.push({ x, y, vx, vy, life, max: life, size, spr });
}
function burst(x, y, n, speed, spr, life = 0.6, size = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = speed * (0.3 + Math.random() * 0.7);
    spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.6 + Math.random() * 0.6), size * (0.5 + Math.random()), spr);
  }
}

/* ======================================================================
   9. Game state
   ====================================================================== */
let mode = 'menu';                  // menu | countdown | race | paused | finished
let pausedFrom = 'race';
let worldT = 0;                     // always ticking, drives animations
let raceT = 0;                      // the race clock
let countT = 0;
let finishT = 0;
let shake = 0;
let toastTimer = 0;
const ship = {};
const cam = { x: 0, y: -1150, z: 0.6 };
let race = null;                    // per-race stats
let ghost = null;                   // best run to race against
let rec = [];                       // this run's recording
let recAcc = 0;
let wrongT = 0;
let demoS = 0;

function resetShip() {
  const s0 = T.L - 160;
  const p = pointAt(s0, 0);
  Object.assign(ship, {
    x: p.x, y: p.y, vx: 0, vy: 0,
    a: Math.atan2(T.ty[p.i], T.tx[p.i]),
    idx: p.i, sPrev: s0, P: -160,
    meter: TUNE.boostCost, boostT: 0, warpT: 0, shieldT: 0, stunT: 0, invulnT: 0, slingT: 0,
    throttle: 0, dust: false, speed: 0,
  });
}
function resetCourse() {
  CELLS.forEach((c) => { c.alive = true; c.t = 0; });
  ROCKS.forEach((r) => { r.alive = true; r.t = 0; });
  CRATES.forEach((c) => { c.alive = true; c.t = 0; });
  MOONS.forEach((m) => { m.inside = false; });
  parts.length = 0;
}

function loadGhost() {
  ghost = null;
  const g = save.data.ghost;
  if ($('optGhost').checked && g && Array.isArray(g.f) && g.f.length > 6) ghost = g;
}

function startRace() {
  sfx.init();
  resetShip();
  resetCourse();
  loadGhost();
  race = { laps: [], lapStart: 0, cells: 0, hits: 0, slings: 0, lapShown: 1 };
  rec = []; recAcc = 0;
  boostPressedEdge = false;
  raceT = 0; countT = 0; wrongT = 0;
  cam.x = ship.x; cam.y = ship.y;
  mode = 'countdown';
  showScreen(null);
  $('hud').hidden = false;
  $('touch').hidden = !usingTouch;
  updateBoostButton();
  lastCount = -1;
}

function showScreen(id) {
  ['menu', 'pause', 'results'].forEach((s) => { $(s).hidden = s !== id; });
}

function pauseGame() {
  if (mode !== 'race' && mode !== 'countdown') return;
  pausedFrom = mode;
  mode = 'paused';
  sfx.engine(0, 0, false);
  showScreen('pause');
  $('btnResume').focus();
}
function resumeGame() {
  if (mode !== 'paused') return;
  mode = pausedFrom;
  for (const k in input) input[k] = false;
  showScreen(null);
}
function toMenu() {
  mode = 'menu';
  sfx.engine(0, 0, false);
  $('hud').hidden = true;
  $('touch').hidden = true;
  $('countdown').textContent = '';
  showScreen('menu');
  refreshMenu();
}

function toast(text, cls = '', ms = 1300) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'show ' + cls;
  toastTimer = ms / 1000;
}

/* ======================================================================
   10. Simulation (fixed 120 Hz step)
   ====================================================================== */
const DT = 1 / 120;

function stepCourse(dt) {
  for (const r of ROCKS) {
    r.rot += r.spin * dt;
    if (!r.alive) { r.t -= dt; if (r.t <= 0) r.alive = true; }
    const lat = r.lat + r.amp * Math.sin(worldT * r.w + r.ph);
    const clamped = clamp(lat, -HW + r.r * 0.5, HW - r.r * 0.5);
    r.x = r.bx + T.nx[r.i] * clamped;
    r.y = r.by + T.ny[r.i] * clamped;
  }
  for (const c of CELLS) if (!c.alive) { c.t -= dt; if (c.t <= 0) c.alive = true; }
  for (const c of CRATES) if (!c.alive) { c.t -= dt; if (c.t <= 0) c.alive = true; }
}

function stepShip(dt) {
  const s = ship;
  const racing = mode === 'race';
  const finished = mode === 'finished';
  // ---- controls
  let steer = 0, thrust = 0, brake = false;
  if (racing) {
    steer = (input.left || touchHeld.left ? -1 : 0) + (input.right || touchHeld.right ? 1 : 0);
    brake = input.brake || touchHeld.brake;
    thrust = input.up || (usingTouch && !brake) ? 1 : 0;
    if (boostPressedEdge) {
      if (s.meter >= TUNE.boostCost - 1e-6 && s.boostT <= 0) {
        s.meter -= TUNE.boostCost; s.boostT = TUNE.boostTime; sfx.boost();
        burst(s.x - Math.cos(s.a) * 30, s.y - Math.sin(s.a) * 30, 18, 260, SPR.saffron, 0.5, 16);
      } else if (s.boostT <= 0) {
        toast('Collect fuel cells to boost', 'cool', 1100);
      }
    }
  }
  if (finished) brake = true;
  boostPressedEdge = false;
  s.throttle = lerp(s.throttle, thrust, 1 - Math.exp(-10 * dt));

  // ---- heading
  const fx = Math.cos(s.a), fy = Math.sin(s.a);
  let vf = s.vx * fx + s.vy * fy;            // forward speed
  let vl = -s.vx * fy + s.vy * fx;           // sideways speed
  const turnScale = (0.45 + 0.55 * Math.min(1, Math.abs(vf) / 260)) * (s.stunT > 0 ? 0.4 : 1);
  s.a += steer * TUNE.turn * turnScale * dt * (vf < -10 ? -1 : 1);

  // ---- forces
  let acc = thrust * TUNE.thrust * (s.stunT > 0 ? 0.35 : 1);
  if (s.boostT > 0) acc += TUNE.boostThrust;
  if (s.warpT > 0) acc += TUNE.warpThrust;
  vf += acc * dt;
  if (brake) {
    if (vf > 0) vf = Math.max(0, vf - TUNE.brake * dt);
    else vf = Math.max(-TUNE.reverseMax, vf - 300 * dt);
  }
  vf *= Math.exp(-(thrust ? 0.2 : 0.55) * dt);
  vl *= Math.exp(-(brake && steer ? TUNE.driftGrip : TUNE.grip) * dt);
  const nfx = Math.cos(s.a), nfy = Math.sin(s.a);
  s.vx = nfx * vf - nfy * vl;
  s.vy = nfy * vf + nfx * vl;

  // ---- moons: gravity rings that slingshot you
  for (const m of MOONS) {
    const dx = m.x - s.x, dy = m.y - s.y;
    const d = Math.hypot(dx, dy);
    const inside = d < ZONE_R;
    if (inside) {
      const pull = 240 * (1 - d / ZONE_R);
      s.vx += (dx / d) * pull * dt; s.vy += (dy / d) * pull * dt;
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > 120) { s.vx += (s.vx / sp) * 430 * dt; s.vy += (s.vy / sp) * 430 * dt; }
      s.slingT = 1.0;
      if (!m.inside && racing) {
        race.slings++;
        sfx.sling();
        toast('Slingshot!', 'cool', 900);
      }
    }
    m.inside = inside;
  }

  // ---- speed caps
  const loc = locate(s.x, s.y, s.idx);
  s.idx = loc.i;
  s.dust = Math.abs(loc.lat) > HW;
  let cap = TUNE.cap;
  if (s.slingT > 0) cap = Math.max(cap, TUNE.slingCap);
  if (s.boostT > 0) cap = Math.max(cap, TUNE.boostCap);
  if (s.warpT > 0) cap = Math.max(cap, TUNE.warpCap);
  if (s.dust && s.warpT <= 0) cap = s.boostT > 0 ? TUNE.dustCap + 120 : TUNE.dustCap;
  let sp = Math.hypot(s.vx, s.vy);
  if (sp > cap) {
    const k = cap + (sp - cap) * Math.exp(-(s.dust ? 4 : 2.2) * dt);
    s.vx *= k / sp; s.vy *= k / sp; sp = k;
  }

  // ---- move
  s.x += s.vx * dt; s.y += s.vy * dt;

  // ---- energy fence at the edge of the dust zone
  const loc2 = locate(s.x, s.y, s.idx);
  const lim = WALL - TUNE.shipR;
  if (Math.abs(loc2.lat) > lim) {
    const sign = Math.sign(loc2.lat);
    const i = loc2.i;
    const over = Math.abs(loc2.lat) - lim;
    s.x -= T.nx[i] * sign * over; s.y -= T.ny[i] * sign * over;
    const vn = (s.vx * T.nx[i] + s.vy * T.ny[i]) * sign;
    if (vn > 0) { s.vx -= T.nx[i] * sign * vn * 1.3; s.vy -= T.ny[i] * sign * vn * 1.3; }
    s.vx *= 0.985; s.vy *= 0.985;
    if (racing && vn > 60) {
      sfx.scrape(); shake = Math.max(shake, 4);
      spawn(s.x + T.nx[i] * sign * 18, s.y + T.ny[i] * sign * 18, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.35, 12, SPR.ion);
    }
  }

  // ---- race progress (continuous distance along the track)
  const loc3 = locate(s.x, s.y, s.idx);
  s.idx = loc3.i;
  let dS = loc3.s - s.sPrev;
  if (dS > T.L / 2) dS -= T.L;
  if (dS < -T.L / 2) dS += T.L;
  s.P += dS; s.sPrev = loc3.s;

  // ---- wrong way
  const tdot = (s.vx * T.tx[s.idx] + s.vy * T.ty[s.idx]);
  if (racing && tdot < -60) { wrongT += dt; } else { wrongT = Math.max(0, wrongT - dt * 2); }

  // ---- timers
  s.boostT = Math.max(0, s.boostT - dt);
  s.warpT = Math.max(0, s.warpT - dt);
  s.shieldT = Math.max(0, s.shieldT - dt);
  s.stunT = Math.max(0, s.stunT - dt);
  s.invulnT = Math.max(0, s.invulnT - dt);
  s.slingT = Math.max(0, s.slingT - dt);
  s.speed = sp;

  if (racing || finished) collide(dt);

  // ---- exhaust
  const fl = s.throttle + (s.boostT > 0 || s.warpT > 0 ? 1 : 0);
  if (fl > 0.05 && Math.random() < 0.5 + fl * 0.3) {
    const bx = s.x - Math.cos(s.a) * 26, by = s.y - Math.sin(s.a) * 26;
    const spr = s.warpT > 0 ? SPR.white : s.boostT > 0 ? SPR.saffron : SPR.ion;
    for (const side of [-1, 1]) {
      const ox = -Math.sin(s.a) * 10 * side, oy = Math.cos(s.a) * 10 * side;
      spawn(bx + ox, by + oy, s.vx * 0.5 - Math.cos(s.a) * 120 + (Math.random() - 0.5) * 40,
        s.vy * 0.5 - Math.sin(s.a) * 120 + (Math.random() - 0.5) * 40, 0.35 + fl * 0.1, 9 + fl * 6, spr);
    }
  }
  if (s.dust && sp > 80 && Math.random() < 0.4) {
    spawn(s.x + (Math.random() - 0.5) * 30, s.y + (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 0.6, 18, SPR.rock);
  }
}

function collide() {
  const s = ship;
  const R = TUNE.shipR;
  // fuel cells
  for (const c of CELLS) {
    if (!c.alive) continue;
    const dx = c.x - s.x, dy = c.y - s.y;
    if (dx * dx + dy * dy < (R + 22) * (R + 22)) {
      c.alive = false; c.t = 7;
      s.meter = Math.min(1, s.meter + TUNE.cellCharge);
      if (mode === 'race') race.cells++;
      sfx.cell(race ? race.cells : 0);
      burst(c.x, c.y, 8, 140, SPR.cell, 0.4, 12);
    }
  }
  // crates: shield or warp
  for (const c of CRATES) {
    if (!c.alive) continue;
    const dx = c.x - s.x, dy = c.y - s.y;
    if (dx * dx + dy * dy < (R + 26) * (R + 26)) {
      c.alive = false; c.t = 9;
      burst(c.x, c.y, 16, 220, SPR.saffron, 0.5, 16);
      if (Math.random() < 0.5) { s.shieldT = TUNE.shieldTime; sfx.shield(); toast('Shield up', 'cool', 1100); }
      else { s.warpT = TUNE.warpTime; sfx.warp(); toast('Warp drive', 'good', 1100); shake = Math.max(shake, 6); }
    }
  }
  // asteroids
  for (const r of ROCKS) {
    if (!r.alive) continue;
    const dx = s.x - r.x, dy = s.y - r.y;
    const min = R + r.r * 0.9;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1;
    const nx = dx / d, ny = dy / d;
    if (s.shieldT > 0 || s.warpT > 0) {
      r.alive = false; r.t = 6;
      burst(r.x, r.y, 26, 300, SPR.rock, 0.8, 20);
      burst(r.x, r.y, 10, 220, SPR.ion, 0.4, 14);
      sfx.shieldHit(); shake = Math.max(shake, 8);
      continue;
    }
    s.x = r.x + nx * (min + 1); s.y = r.y + ny * (min + 1);
    const vn = s.vx * nx + s.vy * ny;
    if (vn < 0) { s.vx -= 1.5 * vn * nx; s.vy -= 1.5 * vn * ny; }
    if (s.invulnT <= 0) {
      s.vx *= 0.45; s.vy *= 0.45;
      s.stunT = 0.45; s.invulnT = 1.1;
      shake = 16;
      if (mode === 'race') race.hits++;
      sfx.crash();
      burst(s.x - nx * R, s.y - ny * R, 22, 260, SPR.danger, 0.5, 14);
      burst(r.x, r.y, 10, 120, SPR.rock, 0.7, 18);
    }
  }
}

function stepRace(dt) {
  raceT += dt;
  // record a ghost frame every 50 ms
  recAcc += dt;
  if (recAcc >= 0.05) {
    recAcc -= 0.05;
    rec.push(Math.round(ship.x), Math.round(ship.y), Math.round(ship.a * 100) / 100);
  }
  // lap crossings
  const lapsDone = Math.floor(ship.P / T.L);
  if (lapsDone > race.laps.length && ship.P > 0) {
    const lapTime = raceT - race.lapStart;
    race.laps.push(lapTime);
    race.lapStart = raceT;
    if (race.laps.length >= TUNE.laps) { finishRace(); return; }
    sfx.lap();
    toast(race.laps.length === TUNE.laps - 1 ? 'Final lap' : 'Lap ' + (race.laps.length + 1), 'good', 1500);
  }
  if (wrongT > 0.9 && toastTimer <= 0) { toast('Wrong way', 'warn', 1000); sfx.wrong(); }
}

function finishRace() {
  mode = 'finished';
  finishT = 0;
  sfx.finish();
  toast('Finish!', 'good', 1600);
  const total = race.laps.reduce((a, b) => a + b, 0);
  race.total = total;
  const prevBest = save.data.best;
  race.prevBest = prevBest;
  race.isBest = !(prevBest > 0) || total < prevBest;
  if (race.isBest) {
    save.data.best = total;
    save.data.ghost = { f: rec.slice() };
  }
  const fastest = Math.min(...race.laps);
  if (!(save.data.bestLap > 0) || fastest < save.data.bestLap) save.data.bestLap = fastest;
  save.data.races = (save.data.races || 0) + 1;
  save.write();
}

function showResults() {
  $('hud').hidden = true;
  $('touch').hidden = true;
  $('resTime').textContent = fmt(race.total);
  $('resBadge').hidden = !race.isBest;
  const pb = race.prevBest;
  let delta = '';
  if (pb > 0) {
    const d = race.total - pb;
    delta = d < 0 ? Math.abs(d).toFixed(2) + ' s faster than your old best' : '+' + d.toFixed(2) + ' s behind your best (' + fmt(pb) + ')';
  } else delta = 'First finish. Now race your ghost.';
  $('resDelta').textContent = delta;
  const fastest = Math.min(...race.laps);
  const ol = $('resLaps');
  ol.innerHTML = '';
  race.laps.forEach((t, i) => {
    const li = document.createElement('li');
    if (t === fastest) li.className = 'fast';
    li.innerHTML = '<span>Lap ' + (i + 1) + '</span><b>' + fmt(t) + '</b>';
    ol.appendChild(li);
  });
  $('resCells').textContent = race.cells;
  $('resHits').textContent = race.hits;
  $('resSling').textContent = race.slings;
  showScreen('results');
  $('btnAgain').focus();
}

/* Menu attract mode: a demo ship cruises the course behind the title */
function stepDemo(dt) {
  demoS = wrapS(demoS + 380 * dt);
  const lat = Math.sin(worldT * 0.6) * 60;
  const p = pointAt(demoS, lat);
  const q = pointAt(demoS + 30, Math.sin((worldT + 0.08) * 0.6) * 60);
  ship.x = p.x; ship.y = p.y;
  ship.a = Math.atan2(q.y - p.y, q.x - p.x);
  ship.vx = Math.cos(ship.a) * 380; ship.vy = Math.sin(ship.a) * 380;
  ship.throttle = 1; ship.speed = 380;
  if (Math.random() < 0.8) {
    const bx = ship.x - Math.cos(ship.a) * 26, by = ship.y - Math.sin(ship.a) * 26;
    spawn(bx, by, ship.vx * 0.5 - Math.cos(ship.a) * 120, ship.vy * 0.5 - Math.sin(ship.a) * 120, 0.4, 12, SPR.ion);
  }
}

/* ======================================================================
   11. Drawing
   ====================================================================== */
function drawBackground() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#060912';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (nebula) {
    ctx.globalAlpha = 1;
    ctx.drawImage(nebula, -cam.x * 0.01 * DPR - 40 * DPR, -cam.y * 0.01 * DPR - 40 * DPR, canvas.width + 80 * DPR, canvas.height + 80 * DPR);
  }
  for (const L of STAR_LAYERS) {
    const size = 512 * DPR;
    const ox = (((-cam.x * L.f * DPR) % size) + size) % size;
    const oy = (((-cam.y * L.f * DPR) % size) + size) % size;
    for (let x = ox - size; x < canvas.width; x += size) {
      for (let y = oy - size; y < canvas.height; y += size) ctx.drawImage(L.img, x, y, size, size);
    }
  }
}

function drawPlanet() {
  const { x, y, r } = PLANET;
  // atmosphere glow
  const glow = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.45);
  glow.addColorStop(0, 'rgba(111,214,255,0.28)');
  glow.addColorStop(1, 'rgba(111,214,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, r * 1.45, 0, TAU); ctx.fill();
  // ring, back half
  drawRing(true);
  // body
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, '#9c86ee'); body.addColorStop(0.5, '#4a3696'); body.addColorStop(1, '#170f3a');
  ctx.fillStyle = body;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // cloud bands drift slowly
  ctx.translate(x, y); ctx.rotate(-0.35);
  const bands = [[-0.62, 0.09, 'rgba(255,181,71,0.20)'], [-0.3, 0.05, 'rgba(255,255,255,0.10)'], [0.0, 0.13, 'rgba(255,140,90,0.14)'],
    [0.28, 0.06, 'rgba(111,214,255,0.14)'], [0.52, 0.1, 'rgba(255,181,71,0.12)']];
  for (const [by, bh, col] of bands) {
    ctx.fillStyle = col;
    const off = Math.sin(worldT * 0.1 + by * 5) * 20;
    ctx.beginPath();
    ctx.ellipse(off, by * r, r * 1.3, bh * r, 0, 0, TAU);
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.restore();
  applyWorldTransform();
  // night side
  const shade = ctx.createRadialGradient(x - r * 0.5, y - r * 0.55, r * 0.3, x - r * 0.2, y - r * 0.2, r * 1.5);
  shade.addColorStop(0, 'rgba(6,9,18,0)'); shade.addColorStop(0.65, 'rgba(6,9,18,0.15)'); shade.addColorStop(1, 'rgba(6,9,18,0.85)');
  ctx.fillStyle = shade;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  drawRing(false);
}
function drawRing(back) {
  const { x, y, r } = PLANET;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.35);
  ctx.beginPath();
  // back half is the upper arc (behind the planet), front half the lower arc
  const a0 = back ? Math.PI : 0, a1 = back ? TAU : Math.PI;
  for (const [k, w, col] of [[1.55, 10, 'rgba(255,214,160,0.35)'], [1.7, 18, 'rgba(255,181,71,0.22)'], [1.86, 6, 'rgba(111,214,255,0.3)']]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * k, r * k * 0.28, 0, a0, a1);
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  }
  ctx.restore();
}

function drawTrack(view) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // Edges are drawn as stacked strokes of the centre line (widest first), so
  // they stay clean even on hairpins where an offset line would fold over itself.
  ctx.strokeStyle = 'rgba(111,214,255,0.28)';            // energy fence (outer limit)
  ctx.lineWidth = WALL * 2 + 4;
  ctx.stroke(PATH_CENTER);
  ctx.strokeStyle = '#0a1024';                           // dust shoulder
  ctx.lineWidth = WALL * 2;
  ctx.stroke(PATH_CENTER);
  ctx.strokeStyle = 'rgba(111,214,255,0.10)';            // rail glow
  ctx.lineWidth = HW * 2 + 26;
  ctx.stroke(PATH_CENTER);
  ctx.strokeStyle = '#a8e6ff';                           // bright rail
  ctx.lineWidth = HW * 2 + 6;
  ctx.stroke(PATH_CENTER);
  ctx.strokeStyle = '#111b3d';                           // track bed
  ctx.lineWidth = HW * 2;
  ctx.stroke(PATH_CENTER);
  // subtle moving lane texture
  ctx.setLineDash([60, 80]);
  ctx.lineDashOffset = -worldT * 40;
  ctx.strokeStyle = 'rgba(111,214,255,0.07)';
  ctx.lineWidth = 4;
  ctx.stroke(PATH_CENTER);
  ctx.setLineDash([]);
  // direction chevrons
  ctx.strokeStyle = 'rgba(160,200,255,0.16)';
  ctx.lineWidth = 10;
  for (const c of CHEVRONS) {
    if (!inView(c.x, c.y, 120, view)) continue;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
    ctx.beginPath(); ctx.moveTo(-22, -40); ctx.lineTo(18, 0); ctx.lineTo(-22, 40); ctx.stroke();
    ctx.restore();
  }
  // start / finish line
  const i0 = 0, sx = T.xs[i0], sy = T.ys[i0];
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(Math.atan2(T.ty[i0], T.tx[i0]));
  const sq = 14;
  for (let row = 0; row < 2; row++) {
    for (let k = -HW; k < HW; k += sq) {
      ctx.fillStyle = ((k / sq + row) & 1) ? 'rgba(235,240,255,0.85)' : 'rgba(10,14,30,0.85)';
      ctx.fillRect(-sq + row * sq, k, sq, sq);
    }
  }
  ctx.restore();
}

function drawMoons(view) {
  for (const m of MOONS) {
    if (!inView(m.x, m.y, ZONE_R + 40, view)) continue;
    const near = Math.hypot(ship.x - m.x, ship.y - m.y) < ZONE_R && mode !== 'menu';
    // gravity zone
    const zg = ctx.createRadialGradient(m.x, m.y, MOON_R, m.x, m.y, ZONE_R);
    zg.addColorStop(0, near ? 'rgba(111,214,255,0.20)' : 'rgba(111,214,255,0.10)');
    zg.addColorStop(1, 'rgba(111,214,255,0)');
    ctx.fillStyle = zg;
    ctx.beginPath(); ctx.arc(m.x, m.y, ZONE_R, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(m.x, m.y); ctx.rotate(worldT * 0.25);
    ctx.setLineDash([18, 16]);
    ctx.strokeStyle = near ? 'rgba(160,230,255,0.75)' : 'rgba(111,214,255,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, ZONE_R, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // moon body
    const g = ctx.createRadialGradient(m.x - 35, m.y - 40, 10, m.x, m.y, MOON_R);
    g.addColorStop(0, '#e2e6f2'); g.addColorStop(0.6, '#8d95ad'); g.addColorStop(1, '#3a4058');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, MOON_R, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(40,46,70,0.35)';
    for (const c of m.craters) { ctx.beginPath(); ctx.arc(m.x + c.x, m.y + c.y, c.r, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(160,190,255,0.7)';
    ctx.font = '700 22px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.name.toUpperCase(), m.x, m.y + MOON_R + 34);
  }
}

function drawItems(view) {
  // fuel cells
  ctx.globalCompositeOperation = 'lighter';
  for (const c of CELLS) {
    if (!c.alive || !inView(c.x, c.y, 40, view)) continue;
    const pulse = 1 + Math.sin(worldT * 5 + c.bob) * 0.12;
    const s = 46 * pulse;
    ctx.drawImage(SPR.cell, c.x - s / 2, c.y - s / 2, s, s);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const c of CELLS) {
    if (!c.alive || !inView(c.x, c.y, 40, view)) continue;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(worldT * 1.5 + c.bob);
    ctx.fillStyle = '#d8ffee';
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6; ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8); }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // crates
  for (const c of CRATES) {
    if (!c.alive || !inView(c.x, c.y, 60, view)) continue;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(SPR.saffron, c.x - 40, c.y - 40, 80, 80);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(Math.PI / 4 + Math.sin(worldT * 2) * 0.25);
    ctx.fillStyle = '#1a1206'; ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.rect(-17, -17, 34, 34); ctx.fill(); ctx.stroke();
    ctx.rotate(-Math.PI / 4 - Math.sin(worldT * 2) * 0.25);
    ctx.fillStyle = '#ffb547';
    ctx.font = '700 22px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 1);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
  // asteroids
  for (const r of ROCKS) {
    if (!r.alive || !inView(r.x, r.y, r.r + 20, view)) continue;
    ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
    const g = ctx.createRadialGradient(-r.r * 0.3, -r.r * 0.35, 2, 0, 0, r.r * 1.1);
    g.addColorStop(0, '#b9a896'); g.addColorStop(0.6, '#6e6158'); g.addColorStop(1, '#2e2723');
    ctx.fillStyle = g;
    ctx.beginPath();
    const n = r.verts.length;
    for (let k = 0; k < n; k++) {
      const a = k * TAU / n;
      ctx.lineTo(Math.cos(a) * r.verts[k], Math.sin(a) * r.verts[k]);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,107,122,0.55)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = 'rgba(30,24,20,0.45)';
    ctx.beginPath(); ctx.arc(r.r * 0.25, r.r * 0.15, r.r * 0.22, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-r.r * 0.3, r.r * 0.3, r.r * 0.12, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

function drawShipShape(x, y, a, opts) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.scale(1.6, 1.6);
  if (opts.ghost) {
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#9fd8ff'; ctx.strokeStyle = '#d6f0ff'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(22, 0); ctx.lineTo(-14, -14); ctx.lineTo(-8, 0); ctx.lineTo(-14, 14); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    return;
  }
  // flames
  const fl = opts.flame;
  if (fl > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    const len = 8 + fl * 16;
    const col = opts.warp ? '#ffffff' : opts.boost ? '#ffb547' : '#6fd6ff';
    for (const sy of [-7, 7]) {
      const flick = len * (0.85 + Math.random() * 0.3);
      const g = ctx.createLinearGradient(-12, 0, -12 - flick, 0);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-11, sy - 3.5); ctx.lineTo(-12 - flick, sy); ctx.lineTo(-11, sy + 3.5); ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // side pods
  ctx.fillStyle = '#2a3554';
  ctx.fillRect(-13, -13, 12, 5); ctx.fillRect(-13, 8, 12, 5);
  // hull
  const hg = ctx.createLinearGradient(0, -14, 0, 14);
  hg.addColorStop(0, '#ffd28a'); hg.addColorStop(0.5, '#ffb547'); hg.addColorStop(1, '#c86f12');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(22, 0); ctx.lineTo(-14, -14); ctx.lineTo(-8, 0); ctx.lineTo(-14, 14); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,20,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  // stripe
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(12, 0); ctx.lineTo(-6, 6); ctx.stroke();
  // cockpit
  ctx.fillStyle = '#12203f';
  ctx.beginPath(); ctx.ellipse(3, 0, 6, 3.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(160,230,255,0.85)';
  ctx.beginPath(); ctx.ellipse(4.5, -1, 2.4, 1.2, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawShip() {
  const s = ship;
  const blink = s.invulnT > 0 && Math.floor(worldT * 16) % 2 === 0;
  if (!blink) {
    drawShipShape(s.x, s.y, s.a, { flame: s.throttle + (s.boostT > 0 ? 0.8 : 0) + (s.warpT > 0 ? 1.2 : 0), boost: s.boostT > 0, warp: s.warpT > 0 });
  }
  if (s.shieldT > 0) {
    const fade = s.shieldT < 1.5 ? (Math.floor(worldT * 10) % 2 ? 0.3 : 0.8) : 0.8;
    ctx.save();
    ctx.globalAlpha = fade;
    const g = ctx.createRadialGradient(s.x, s.y, 20, s.x, s.y, 46);
    g.addColorStop(0, 'rgba(111,214,255,0)'); g.addColorStop(0.8, 'rgba(111,214,255,0.25)'); g.addColorStop(1, 'rgba(160,230,255,0.7)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s.x, s.y, 46, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

function drawGhost() {
  if (!ghost || (mode !== 'race' && mode !== 'countdown')) return;
  const f = ghost.f;
  const frames = f.length / 3;
  const pos = raceT / 0.05;
  const i = Math.min(frames - 1, Math.floor(pos));
  const j = Math.min(frames - 1, i + 1);
  const u = clamp(pos - i, 0, 1);
  const x = lerp(f[i * 3], f[j * 3], u), y = lerp(f[i * 3 + 1], f[j * 3 + 1], u);
  let a0 = f[i * 3 + 2], a1 = f[j * 3 + 2];
  let da = a1 - a0; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
  ghost.x = x; ghost.y = y;
  drawShipShape(x, y, a0 + da * u, { ghost: true });
}

function drawParticles(dt) {
  ctx.globalCompositeOperation = 'lighter';
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k];
    p.life -= dt;
    if (p.life <= 0) { parts.splice(k, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.96; p.vy *= 0.96;
    const t = p.life / p.max;
    ctx.globalAlpha = t;
    const s = p.size * (0.6 + t * 0.6);
    ctx.drawImage(p.spr, p.x - s, p.y - s, s * 2, s * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

let shakeX = 0, shakeY = 0;
function applyWorldTransform() {
  const z = cam.z * DPR;
  ctx.setTransform(z, 0, 0, z, W * DPR / 2 - (cam.x + shakeX) * z, H * DPR / 2 - (cam.y + shakeY) * z);
}
function inView(x, y, r, v) {
  return x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1;
}

function drawMinimap() {
  if ($('hud').hidden) return;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, mini.width, mini.height);
  if (miniBg) mctx.drawImage(miniBg, 0, 0);
  const dot = (x, y, r, col) => {
    mctx.fillStyle = col;
    mctx.beginPath(); mctx.arc(x * miniScale + miniOX, y * miniScale + miniOY, r * DPR, 0, TAU); mctx.fill();
  };
  if (ghost && ghost.x !== undefined && mode === 'race') dot(ghost.x, ghost.y, 3, 'rgba(160,215,255,0.8)');
  dot(ship.x, ship.y, 4.5, '#060912');
  dot(ship.x, ship.y, 3.5, '#ffb547');
}

/* ======================================================================
   12. HUD
   ====================================================================== */
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
const meterBars = document.querySelectorAll('.boost-meter i');
function updateHUD() {
  if (!race) return;
  const lap = clamp(race.laps.length + 1, 1, TUNE.laps);
  setText('hudLap', String(lap));
  setText('hudCells', String(race.cells));
  setText('hudTime', fmt(raceT));
  setText('hudLapTime', fmt(raceT - race.lapStart));
  setText('hudSpeed', String(Math.round(ship.speed / 10)));
  const m = ship.meter * 3;
  meterBars.forEach((b, i) => {
    const v = Math.round(clamp(m - i, 0, 1) * 100) + '%';
    if (b.dataset.v !== v) { b.dataset.v = v; b.style.setProperty('--fill', v); }
  });
  updateBoostButton();
}
function updateBoostButton() {
  const ready = ship.meter >= TUNE.boostCost - 1e-6;
  document.querySelector('.boost-meter').classList.toggle('ready', ready);
  document.querySelector('.t-boost').classList.toggle('empty', !ready);
}

/* ======================================================================
   13. Main loop
   ====================================================================== */
let last = performance.now();
let acc = 0;
let lastCount = -1;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;           // tab was in the background
  if (mode === 'paused') { render(0); return; }

  worldT += dt;
  acc += dt;
  while (acc >= DT) {
    acc -= DT;
    stepCourse(DT);
    if (mode === 'menu') stepDemo(DT);
    else if (mode === 'countdown') { countT += DT; ship.vx = ship.vy = 0; }
    else if (mode === 'race') { stepShip(DT); if (mode === 'race') stepRace(DT); }
    else if (mode === 'finished') { stepShip(DT); finishT += DT; if (finishT > 1.6 && $('results').hidden) showResults(); }
  }

  // countdown 3-2-1-GO
  if (mode === 'countdown') {
    const n = Math.floor(countT);
    if (n !== lastCount) {
      lastCount = n;
      const el = $('countdown');
      el.className = '';
      void el.offsetWidth;          // restart the CSS animation
      if (n < 3) { el.textContent = String(3 - n); el.className = 'pop'; sfx.beep(false); }
      else {
        el.textContent = 'Go'; el.className = 'pop go'; sfx.beep(true);
        mode = 'race';
        toast(usingTouch ? 'Thrust is automatic. Just steer!' : '↑ thrust · ← → steer · Space boost', 'cool', 2600);
      }
    }
  }

  // engine sound
  const racingNow = mode === 'race' || mode === 'finished';
  sfx.engine(clamp(ship.speed / TUNE.warpCap, 0, 1), ship.throttle, racingNow);

  // toast timer
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').className = ''; }

  render(dt);
  if (mode === 'race' || mode === 'countdown' || mode === 'finished') updateHUD();
}

function render(dt) {
  // camera: follow the ship and look ahead in the direction of travel
  const baseZ = clamp(Math.min(W, H) / 760, 0.42, 1.05) * (mode === 'menu' ? 0.85 : 1);
  const spF = clamp(ship.speed / TUNE.warpCap, 0, 1);
  const tz = baseZ * (1 - 0.16 * spF);
  const look = mode === 'menu' ? 0.6 : 0.42;
  const tx = ship.x + ship.vx * look, ty = ship.y + ship.vy * look;
  const k = dt > 0 ? 1 - Math.exp(-5 * dt) : 0;
  cam.x = lerp(cam.x, tx, k); cam.y = lerp(cam.y, ty, k);
  cam.z = lerp(cam.z, tz, dt > 0 ? 1 - Math.exp(-2 * dt) : 0);
  if (shake > 0 && dt > 0) {
    shakeX = (Math.random() - 0.5) * shake; shakeY = (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 40);
  } else { shakeX = shakeY = 0; }

  drawBackground();
  applyWorldTransform();
  const hw = W / 2 / cam.z, hh = H / 2 / cam.z;
  const view = { x0: cam.x - hw, x1: cam.x + hw, y0: cam.y - hh, y1: cam.y + hh };

  if (inView(PLANET.x, PLANET.y, PLANET.r * 1.9, view)) drawPlanet();
  applyWorldTransform();
  drawTrack(view);
  drawMoons(view);
  drawItems(view);
  drawGhost();
  drawParticles(dt);
  drawShip();
  drawMinimap();
}

/* ======================================================================
   14. Buttons and menus
   ====================================================================== */
const ICON_SOUND = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 5m0-5-5 5"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
$('btnPause').innerHTML = ICON_PAUSE;

function toggleMute() {
  sfx.setMuted(!sfx.muted);
  save.data.muted = sfx.muted; save.write();
  renderMute();
}
function renderMute() {
  const b = $('btnMute');
  b.innerHTML = sfx.muted ? ICON_MUTED : ICON_SOUND;
  b.setAttribute('aria-label', sfx.muted ? 'Turn sound on' : 'Mute sound');
}
renderMute();

function refreshMenu() {
  setText('menuBest', save.data.best > 0 ? fmt(save.data.best) : 'No time yet');
  setText('menuBestLap', save.data.bestLap > 0 ? fmt(save.data.bestLap) : '–');
}

$('btnStart').addEventListener('click', startRace);
$('btnHow').addEventListener('click', () => {
  const how = $('how');
  how.hidden = !how.hidden;
  $('btnHow').setAttribute('aria-expanded', String(!how.hidden));
});
$('optGhost').checked = save.data.ghostOn !== false;
$('optGhost').addEventListener('change', (e) => { save.data.ghostOn = e.target.checked; save.write(); });
$('btnMute').addEventListener('click', (e) => { sfx.init(); toggleMute(); e.currentTarget.blur(); });
$('btnPause').addEventListener('click', (e) => { pauseGame(); e.currentTarget.blur(); });
$('btnResume').addEventListener('click', resumeGame);
$('btnRestart').addEventListener('click', startRace);
$('btnQuit').addEventListener('click', toMenu);
$('btnAgain').addEventListener('click', startRace);
$('btnMenu').addEventListener('click', toMenu);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (mode === 'race' || mode === 'countdown') pauseGame();
    if (sfx.ctx) sfx.ctx.suspend();
  } else if (sfx.ctx) sfx.ctx.resume();
});

window.addEventListener('resize', resize);
resize();
resetShip();
demoS = 0;
refreshMenu();
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

/* Offline install support: cache the game so it runs in flight mode */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* not allowed here */ }
  });
}

/* Hooks for the Android app wrapper (android/MainActivity.java) */
window.__orbitPause = () => {
  if (mode === 'race' || mode === 'countdown') pauseGame();
  sfx.engine(0, 0, false);
  if (sfx.ctx) sfx.ctx.suspend();
};
window.__orbitResume = () => { if (sfx.ctx) sfx.ctx.resume(); };
window.__orbitBack = () => {          // phone back button: returns 'exit' only on the main menu
  if (mode === 'race' || mode === 'countdown') { pauseGame(); return 'handled'; }
  if (mode === 'paused') { resumeGame(); return 'handled'; }
  if (mode === 'finished') { toMenu(); return 'handled'; }
  if (!$('how').hidden) { $('btnHow').click(); return 'handled'; }
  return 'exit';
};

/* Test hook used by the automated checks in tests/ (harmless in normal play) */
window.__orbit = { T, ship, get mode() { return mode; }, get race() { return race; }, get raceT() { return raceT; }, MOONS, ROCKS, CELLS, CRATES, input, startRace, TUNE };
})();
