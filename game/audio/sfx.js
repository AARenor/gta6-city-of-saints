// City of Saints: every sound is synthesised with WebAudio, no files.
//
// createAudio(state) makes the audio object at state.audio and starts nothing:
// a browser only allows sound after a gesture, so updateAudio() builds the
// AudioContext on the first key press or pointer press and resumes it whenever
// it comes back suspended. After that three continuous voices stay alive and
// short ones fire from state.events.
//
//   engine  a sawtooth hum whose pitch and cutoff follow the player's car speed
//   squeal  looped noise through a bandpass while Space is held in a moving car
//   siren   a square tone two-toned by a 1.5 Hz square LFO, louder the closer
//           the nearest police car is
//   shots   gunshot, punch, cash chime, crash and the menu click
//
// Nothing here can throw into a frame: every entry point is wrapped, every
// parameter write goes through set(), and a dead node is ignored. The module
// reads state.events and writes only state.audio.
//
// Exports: createAudio, updateAudio.

const MIN = 0.0001;
const MASTER = 0.75;
const TOP_SPEED = 430;
const SIREN_RANGE = 1150;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const rngOf = (state) => (state && typeof state.rng === 'function' ? state.rng : Math.random);

export function createAudio(state) {
  const audio = {
    isAudio: true, ctx: null, master: null, noise: null,
    hum: null, squeal: null, siren: null,
    last: { gunshot: -9, punch: -9, pickup: -9, crash: -9, click: -9 },
    failures: 0,
  };
  if (state) state.audio = audio;
  return audio;
}

const audioOf = (state) => (state.audio && state.audio.isAudio ? state.audio : createAudio(state));

function set(param, value, now, glide) {
  try {
    if (!param) return;
    if (glide > 0 && typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, now, glide);
    else param.value = value;
  } catch (err) { /* a suspended or closed context is not an error here */ }
}

function ramp(param, value, at) {
  try { if (param && typeof param.exponentialRampToValueAtTime === 'function') param.exponentialRampToValueAtTime(Math.max(MIN, value), at); } catch (err) { /* ignore */ }
}

function noiseBuffer(ctx, rng) {
  const len = Math.max(1024, Math.floor(num(ctx.sampleRate, 48000) * 1.2));
  const buf = ctx.createBuffer(1, len, num(ctx.sampleRate, 48000));
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = rng() * 2 - 1;
  return buf;
}

function buildHum(a) {
  const ctx = a.ctx;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 44;
  filter.type = 'lowpass';
  filter.frequency.value = 640;
  filter.Q.value = 0.8;
  gain.gain.value = 0;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(a.master);
  osc.start();
  a.hum = { osc, filter, gain };
}

function buildSqueal(a) {
  const ctx = a.ctx;
  const src = ctx.createBufferSource();
  src.buffer = a.noise;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2300;
  filter.Q.value = 7;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(a.master);
  src.start();
  a.squeal = { src, filter, gain };
}

function buildSiren(a) {
  const ctx = a.ctx;
  const osc = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 780;
  lfo.type = 'square';
  lfo.frequency.value = 1.5;
  depth.gain.value = 210;
  gain.gain.value = 0;
  lfo.connect(depth);
  depth.connect(osc.frequency);
  osc.connect(gain);
  gain.connect(a.master);
  osc.start();
  lfo.start();
  a.siren = { osc, gain };
}

function build(state) {
  const a = audioOf(state);
  if (a.ctx) return a.ctx;
  try {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    a.ctx = ctx;
    a.master = ctx.createGain();
    a.master.gain.value = MASTER;
    a.master.connect(ctx.destination);
    a.noise = noiseBuffer(ctx, rngOf(state));
    buildHum(a);
    buildSqueal(a);
    buildSiren(a);
    return ctx;
  } catch (err) {
    a.failures += 1;
    a.ctx = null;
    a.hum = a.squeal = a.siren = null;
    return null;
  }
}

function wake(a) {
  try {
    if (!a.ctx) return;
    if (a.ctx.state === 'suspended' && typeof a.ctx.resume === 'function') {
      const p = a.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch (err) { /* never let a resume rejection escape */ }
}

function touched(state) {
  const input = (state && state.input) || {};
  const keys = input.keys, pressed = input.pressed;
  if (keys && keys.size > 0) return true;
  if (pressed && pressed.size > 0) return true;
  const mouse = input.mouse;
  return !!(mouse && (mouse.down === true || mouse.clicked === true));
}

function held(state, ...names) {
  const keys = state && state.input && state.input.keys;
  if (!keys || typeof keys.has !== 'function') return false;
  for (const n of names) {
    if (keys.has(n)) return true;
    const want = String(n).toLowerCase();
    for (const k of keys) if (typeof k === 'string' && k.toLowerCase() === want) return true;
  }
  return false;
}

function drive(state) {
  const p = (state && state.player) || {};
  if (!p.car || p.onFoot) return null;
  return { speed: Math.abs(num(p.car.speed, 0)), drift: held(state, 'Space', ' ') };
}

function updateEngine(state, a) {
  const now = a.ctx.currentTime;
  const d = drive(state);
  const load = clamp01((d ? d.speed : 0) / TOP_SPEED);
  set(a.hum.osc.frequency, 44 + load * 128, now, 0.08);
  set(a.hum.filter.frequency, 620 + load * 1500, now, 0.1);
  set(a.hum.gain.gain, d ? 0.045 + load * 0.075 : 0, now, 0.07);
}

function updateSqueal(state, a) {
  const now = a.ctx.currentTime;
  const d = drive(state);
  const load = clamp01((d ? d.speed : 0) / TOP_SPEED);
  const drifting = !!(d && d.drift && d.speed > 130);
  set(a.squeal.filter.frequency, 1900 + load * 900, now, 0.1);
  set(a.squeal.gain.gain, drifting ? 0.05 + load * 0.05 : 0, now, 0.06);
}

function nearestPolice(state) {
  const p = (state && state.player) || {};
  const list = Array.isArray(state.police) ? state.police : [];
  const px = num(p.x, 0), py = num(p.y, 0);
  let best = Infinity;
  for (const u of list) {
    if (!u) continue;
    const x = num(u.x, NaN), y = num(u.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const d = Math.hypot(x - px, y - py);
    if (d < best) best = d;
  }
  return best;
}

function updateSiren(state, a) {
  const now = a.ctx.currentTime;
  const d = nearestPolice(state);
  const near = Number.isFinite(d) ? clamp01(1 - d / SIREN_RANGE) : 0;
  set(a.siren.gain.gain, Math.pow(near, 1.6) * 0.11, now, 0.12);
}

function tone(a, opts) {
  const ctx = a.ctx;
  const t = ctx.currentTime + (opts.at || 0);
  const len = Math.max(0.03, num(opts.len, 0.12));
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type || 'sine';
  try { osc.frequency.setValueAtTime(Math.max(20, num(opts.freq, 440)), t); } catch (err) { /* ignore */ }
  if (opts.to) ramp(osc.frequency, opts.to, t + len);
  gain.gain.setValueAtTime(MIN, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(MIN, num(opts.vol, 0.2)), t + 0.012);
  ramp(gain.gain, MIN, t + len);
  osc.connect(gain);
  gain.connect(a.master);
  osc.start(t);
  osc.stop(t + len + 0.03);
}

function burst(a, opts) {
  const ctx = a.ctx;
  const t = ctx.currentTime;
  const len = Math.max(0.04, num(opts.len, 0.18));
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  src.buffer = a.noise;
  filter.type = opts.type || 'lowpass';
  filter.Q.value = num(opts.q, 1);
  try {
    filter.frequency.setValueAtTime(Math.max(40, num(opts.from, 4000)), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, num(opts.to, 300)), t + len);
  } catch (err) { /* ignore */ }
  gain.gain.setValueAtTime(Math.max(MIN, num(opts.vol, 0.3)), t);
  ramp(gain.gain, MIN, t + len);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(a.master);
  src.start(t);
  src.stop(t + len + 0.03);
}

const gunshot = (a, near) => {
  burst(a, { from: 5200, to: 420, len: 0.17, vol: 0.5 * near });
  tone(a, { freq: 150, to: 48, len: 0.16, vol: 0.32 * near, type: 'triangle' });
};

const punch = (a, near) => {
  tone(a, { freq: 190, to: 62, len: 0.13, vol: 0.4 * near, type: 'triangle' });
  burst(a, { from: 1100, to: 220, len: 0.07, vol: 0.16 * near });
};

const chime = (a) => {
  tone(a, { freq: 880, len: 0.16, vol: 0.14, type: 'sine' });
  tone(a, { freq: 1320, len: 0.2, vol: 0.1, type: 'sine', at: 0.07 });
};

const click = (a) => tone(a, { freq: 1500, to: 900, len: 0.05, vol: 0.08, type: 'square' });

const crash = (a, force, near) => {
  const hard = clamp01(num(force, 0) / 430);
  burst(a, { from: 1600, to: 160, len: 0.24, vol: (0.16 + hard * 0.22) * near });
  tone(a, { freq: 92, to: 40, len: 0.2, vol: (0.1 + hard * 0.18) * near, type: 'triangle' });
};

// Distance to the player, so a shot across the map is quiet and the player's own
// pistol is not.
function atten(state, e) {
  const p = (state && state.player) || {};
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return 1;
  const d = Math.hypot(e.x - num(p.x, 0), e.y - num(p.y, 0));
  return 0.12 + clamp01(1 - d / 1500) * 0.88;
}

const GAP = { gunshot: 0.045, punch: 0.07, pickup: 0.06, crash: 0.11, click: 0.05 };
const MENU_KEYS = ['Enter', 'NumpadEnter', ' ', 'Space', 'Escape', 'Esc', 'ArrowUp', 'Up', 'ArrowDown', 'Down', 'Tab'];

function inMenu(state) {
  const f = (state && state.flags) || {};
  return !f.started || f.dead === true || f.paused === true;
}

// A button or a menu key is a UI action, even when menu.js has nothing to log.
function menuClick(state, a) {
  if (!inMenu(state)) return;
  const input = (state && state.input) || {};
  const mouse = input.mouse;
  const pressed = input.pressed;
  let hit = !!(mouse && mouse.clicked === true);
  if (!hit && pressed && typeof pressed.has === 'function') {
    for (const k of MENU_KEYS) {
      if (pressed.has(k)) { hit = true; break; }
    }
  }
  if (!hit) return;
  const t = num(state.t, 0);
  if (t - num(a.last.click, -9) < GAP.click) return;
  a.last.click = t;
  click(a);
}

function playEvents(state, a) {
  const list = Array.isArray(state.events) ? state.events : [];
  if (!list.length) return;
  const t = num(state.t, 0);
  let shots = 0;
  for (const e of list) {
    if (!e || typeof e.type !== 'string') continue;
    const type = e.type;
    if (!(type in GAP) || type === 'click') continue;
    if (t - num(a.last[type], -9) < GAP[type]) continue;
    if (type === 'gunshot' && shots >= 3) continue;
    a.last[type] = t;
    try {
      if (type === 'gunshot') { shots += 1; gunshot(a, atten(state, e)); }
      else if (type === 'punch') punch(a, atten(state, e));
      else if (type === 'pickup') chime(a);
      else crash(a, e.force, atten(state, e));
    } catch (err) { a.failures += 1; }
  }
}

export function updateAudio(state, dt) {
  if (!state) return;
  try {
    const a = audioOf(state);
    if (!a.ctx) {
      if (!touched(state)) return;
      if (!build(state)) return;
    }
    wake(a);
    if (!a.hum || !a.squeal || !a.siren) return;
    updateEngine(state, a);
    updateSqueal(state, a);
    updateSiren(state, a);
    playEvents(state, a);
    menuClick(state, a);
  } catch (err) {
    const a = state.audio;
    if (a && a.isAudio) a.failures += 1;
  }
}
