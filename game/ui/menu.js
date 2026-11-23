// City of Saints: the start screen, the pause menu and the death card.
//
// createMenu(state) builds the one menu object and stores it at state.menu. It
// holds view state only: keyboard focus per screen, the hovered button, the last
// button fired and a cached copy of the save slot. updateMenu() is the only
// writer of state.flags.started, state.flags.paused and state.flags.savedAt. It
// saves and loads localStorage 'city-of-saints/save' and respawns the player
// from the death card. drawMenu() paints the screen the flags select and nothing
// while the game runs.
//
// Buttons answer the mouse (state.input.mouse) and the keyboard: Tab or the
// arrow keys move the focus, Enter or Space fires, Esc pauses and resumes.
// The save holds x, y, cash, health, stats.missionsDone, ammo and its clock.

import { PALETTE } from '../world/palette.js';
import { hudMessage } from './hud.js';

const SAVE_KEY = 'city-of-saints/save';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GOLD = PALETTE.neon[2];
const GOLD_HOT = '#ffeaa0';
const W = 1280;
const H = 720;

const START = {
  titleY: 150, subY: 204, hintY: 672,
  panel: { x: 340, y: 250, w: 600, h: 274 },
  play: { x: 340, y: 548, w: 284, h: 58 },
  cont: { x: 656, y: 548, w: 284, h: 58 },
};
const PAUSE = { panel: { x: 380, y: 186, w: 520, h: 348 }, titleY: 250, first: { x: 450, y: 300, w: 380, h: 54 }, gap: 74 };
const DEAD = { titleY: 306, subY: 356, button: { x: 490, y: 420, w: 300, h: 62 }, noteY: 546, clockY: 580 };
const CONTROLS = [
  ['W A S D', 'move on foot'], ['Shift', 'sprint'],
  ['F', 'enter or exit a car'], ['Q', 'punch'],
  ['Left mouse', 'fire the pistol'], ['Space', 'handbrake slide'],
  ['Esc', 'pause or resume'], ['Enter', 'press menus'],
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f; };

// The design is drawn at 1280x720 and scaled to fit whatever canvas it gets.
function view(state) {
  const c = (state && state.canvas) || {};
  const w = num(c.w, W) || W, h = num(c.h, H) || H;
  const k = Math.min(w / W, h / H) || 1;
  return { w, h, k, ox: (w - W * k) / 2, oy: (h - H * k) / 2 };
}

function toBase(state, x, y) {
  const v = view(state);
  return { x: (num(x, -1) - v.ox) / v.k, y: (num(y, -1) - v.oy) / v.k };
}

function round(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function text(ctx, str, x, y, size, colour, align, weight) {
  ctx.font = `${weight || 600} ${size}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

function panel(ctx, x, y, w, h, r) {
  ctx.fillStyle = 'rgba(10, 14, 21, 0.82)';
  round(ctx, x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)'; ctx.lineWidth = 1;
  round(ctx, x, y, w, h, r); ctx.stroke();
}

const money = (n) => `$${String(Math.max(0, Math.round(num(n, 0)))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const pad = (n) => String(n).padStart(2, '0');
const clock = (t) => { const s = Math.max(0, Math.floor(num(t, 0))); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

// Key names arrive as e.key or e.code, so both spellings of each name match.
function has(set, ...names) {
  if (!set || typeof set.has !== 'function') return false;
  for (const n of names) {
    if (set.has(n)) return true;
    const want = String(n).toLowerCase();
    for (const k of set) if (typeof k === 'string' && k.toLowerCase() === want) return true;
  }
  return false;
}

const pressedOf = (state) => (state && state.input && state.input.pressed) || null;

function mouseOf(state) {
  const m = state && state.input && state.input.mouse;
  return m && typeof m === 'object' ? m : null;
}

function storage() {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch (err) { return null; }
}

function readSlot() {
  const s = storage();
  if (!s) return null;
  let rec;
  try { rec = JSON.parse(s.getItem(SAVE_KEY) || 'null'); } catch (err) { return null; }
  if (!rec || typeof rec !== 'object') return null;
  if (rec.x === undefined && rec.y === undefined) return null;
  return {
    x: num(rec.x, 0), y: num(rec.y, 0), cash: num(rec.cash, 0),
    health: clamp(num(rec.health, 100), 0, 100),
    missionsDone: Math.max(0, Math.floor(num(rec.missionsDone, 0))),
    ammo: Math.max(0, Math.floor(num(rec.ammo, 0))), at: num(rec.at, 0),
  };
}

function writeSlot(state) {
  const s = storage();
  if (!s) return false;
  const p = (state && state.player) || {};
  try {
    s.setItem(SAVE_KEY, JSON.stringify({
      x: num(p.x, 0), y: num(p.y, 0), cash: num(p.cash, 0), health: num(p.health, 100),
      missionsDone: Math.floor(num(state.stats && state.stats.missionsDone, 0)),
      ammo: num(p.ammo, 0), at: num(state.t, 0),
    }));
    return true;
  } catch (err) { return false; }
}

function applySlot(state, rec) {
  if (!rec) return;
  const p = state.player || (state.player = {});
  const f = state.flags || (state.flags = {});
  p.x = rec.x; p.y = rec.y; p.cash = rec.cash; p.health = rec.health;
  p.ammo = rec.ammo; p.speed = 0; p.walk = 0; p.deadAt = 0;
  if (state.stats) state.stats.missionsDone = rec.missionsDone;
  f.started = true; f.paused = false; f.dead = false; f.savedAt = rec.at;
  const v = view(state);
  if (state.camera) { state.camera.x = p.x - v.w / 2; state.camera.y = p.y - v.h / 2; }
}

export function createMenu(state) {
  const menu = { isMenu: true, screen: 'start', hover: '', last: '', focus: { start: 0, pause: 0, dead: 0 }, slot: readSlot(), slotAt: 0 };
  if (state) state.menu = menu;
  return menu;
}

const menuOf = (state) => (state.menu && state.menu.isMenu ? state.menu : createMenu(state));

function screenOf(state) {
  const f = (state && state.flags) || {};
  if (f.dead) return 'dead';
  if (!f.started) return 'start';
  return f.paused ? 'pause' : 'play';
}

const pauseRect = (i) => ({ x: PAUSE.first.x, y: PAUSE.first.y + i * PAUSE.gap, w: PAUSE.first.w, h: PAUSE.first.h });

function buttons(screen, slot) {
  const has2 = !!slot;
  if (screen === 'start') return [
    { id: 'play', label: 'Play', rect: START.play, style: 'primary' },
    { id: 'continue', label: has2 ? 'Continue' : 'Continue (empty slot)', rect: START.cont, disabled: !has2 },
  ];
  if (screen === 'pause') return [
    { id: 'resume', label: 'Resume', rect: pauseRect(0), style: 'primary' },
    { id: 'save', label: 'Save game', rect: pauseRect(1) },
    { id: 'load', label: has2 ? 'Load game' : 'Load (empty slot)', rect: pauseRect(2), disabled: !has2 },
  ];
  return [{ id: 'respawn', label: 'Respawn', rect: DEAD.button, style: 'primary' }];
}

function pick(acts, x, y) {
  for (const b of acts) {
    const r = b.rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return b;
  }
  return null;
}

function activate(state, m, id) {
  const f = state.flags || (state.flags = {});
  const now = num(state.t, 0);
  m.last = id;
  if (id === 'play') {
    f.started = true; f.paused = false; f.dead = false; m.focus.start = 0;
    hudMessage(state, 'W A S D walks, F takes a car, Esc pauses.', 3.5);
  } else if (id === 'continue') {
    if (!m.slot) return;
    applySlot(state, m.slot);
    hudMessage(state, `Back on the street, ${money(m.slot.cash)} in your pocket.`, 3);
  } else if (id === 'resume') {
    f.paused = false; m.focus.pause = 0;
  } else if (id === 'save') {
    if (writeSlot(state)) {
      f.savedAt = now; m.slot = readSlot(); m.slotAt = now;
      hudMessage(state, 'Game saved.', 2.2);
    } else hudMessage(state, 'No save slot available here.', 2.2);
  } else if (id === 'load') {
    if (!m.slot) { hudMessage(state, 'The save slot is empty.', 2.2); return; }
    applySlot(state, m.slot); m.focus.pause = 0;
    hudMessage(state, 'Save loaded.', 2.2);
  } else if (id === 'respawn') {
    const p = state.player;
    if (p) p.deadAt = Math.min(num(p.deadAt, now), now);
    else f.dead = false;
  }
}

export function updateMenu(state, dt) {
  if (!state) return;
  const m = menuOf(state);
  const f = state.flags || (state.flags = {});
  const now = num(state.t, 0);
  if (!m.slotAt || now - m.slotAt > 1) { m.slot = readSlot(); m.slotAt = now; }
  const pressed = pressedOf(state);
  const screen = screenOf(state);
  if (m.screen !== screen) { m.screen = screen; m.hover = ''; }

  if (has(pressed, 'Escape', 'Esc')) {
    if (screen === 'pause') { f.paused = false; m.focus.pause = 0; m.last = 'resume'; return; }
    if (screen === 'play') { f.paused = true; m.focus.pause = 0; m.last = ''; m.hover = ''; return; }
  }
  if (screen === 'play') { m.hover = ''; return; }

  const acts = buttons(screen, m.slot);
  const focus = clamp(Math.floor(num(m.focus[screen], 0)), 0, acts.length - 1);
  m.focus[screen] = focus;
  const mouse = mouseOf(state);
  const pt = mouse ? toBase(state, mouse.x, mouse.y) : null;
  const over = pt ? pick(acts, pt.x, pt.y) : null;
  m.hover = over && !over.disabled ? over.id : '';
  // Hover takes the focus, so Enter fires the button the pointer is on.
  if (m.hover) m.focus[screen] = acts.indexOf(over);

  let fire = '';
  if (mouse && mouse.clicked === true && over && !over.disabled) {
    m.focus[screen] = acts.indexOf(over);
    fire = over.id;
  }
  if (!fire) {
    if (has(pressed, 'ArrowDown', 'Down', 'Tab')) m.focus[screen] = (focus + 1) % acts.length;
    else if (has(pressed, 'ArrowUp', 'Up')) m.focus[screen] = (focus + acts.length - 1) % acts.length;
    if (has(pressed, 'Enter', 'NumpadEnter', ' ', 'Space')) {
      const b = acts[m.focus[screen]];
      if (b && !b.disabled) fire = b.id;
    }
  }
  if (fire) activate(state, m, fire);
}

function glow(ctx, x, y, r, colour) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, colour); g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function backdrop(ctx, alpha) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(6, 10, 18, 0.92)');
  g.addColorStop(0.55, 'rgba(8, 12, 20, 0.88)'); g.addColorStop(1, 'rgba(4, 6, 10, 0.95)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, 196, 132, 440, 'rgba(255, 62, 165, 0.16)');
  glow(ctx, 1064, 600, 470, 'rgba(56, 232, 255, 0.12)');
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 232); ctx.lineTo(W, 232); ctx.stroke();
  ctx.restore();
}

function drawTitle(ctx) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `800 92px ${FONT}`;
  ctx.shadowColor = 'rgba(255, 62, 165, 0.55)'; ctx.shadowBlur = 34;
  const g = ctx.createLinearGradient(W / 2 - 330, 84, W / 2 + 330, 168);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, GOLD_HOT); g.addColorStop(1, GOLD);
  ctx.fillStyle = g;
  ctx.fillText('CITY OF SAINTS', W / 2, START.titleY);
  ctx.restore();
  ctx.fillStyle = 'rgba(255, 210, 63, 0.55)';
  ctx.fillRect(W / 2 - 190, 172, 380, 3);
}

function chip(ctx, key, x, top) {
  round(ctx, x, top, 118, 26, 8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'; ctx.lineWidth = 1;
  round(ctx, x, top, 118, 26, 8); ctx.stroke();
  text(ctx, key, x + 10, top + 18, 12, GOLD_HOT, 'left', 700);
}

function drawControls(ctx) {
  const p = START.panel;
  panel(ctx, p.x, p.y, p.w, p.h, 16);
  text(ctx, 'CONTROLS', p.x + 24, p.y + 32, 12, 'rgba(255, 255, 255, 0.5)', 'left', 700);
  for (let i = 0; i < CONTROLS.length; i += 1) {
    const x = p.x + 24 + (i % 2) * 288, top = p.y + 54 + Math.floor(i / 2) * 50;
    chip(ctx, CONTROLS[i][0], x, top);
    text(ctx, CONTROLS[i][1], x + 130, top + 18, 15, 'rgba(255, 255, 255, 0.86)', 'left', 500);
  }
}

function drawButton(ctx, b, hot, focused) {
  const r = b.rect;
  const primary = b.style === 'primary';
  ctx.save();
  ctx.globalAlpha = b.disabled ? 0.4 : 1;
  round(ctx, r.x, r.y, r.w, r.h, 12);
  if (primary) {
    const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    g.addColorStop(0, hot ? '#ffdd63' : GOLD); g.addColorStop(1, hot ? '#e8b400' : '#c19300');
    ctx.fillStyle = g;
  } else ctx.fillStyle = hot ? 'rgba(30, 38, 50, 0.96)' : 'rgba(14, 18, 26, 0.9)';
  ctx.fill();
  ctx.lineWidth = focused ? 2 : 1;
  ctx.strokeStyle = b.disabled ? 'rgba(255, 255, 255, 0.14)' : focused ? GOLD_HOT : 'rgba(255, 255, 255, 0.22)';
  round(ctx, r.x, r.y, r.w, r.h, 12); ctx.stroke();
  const ink = primary ? '#1a1408' : b.disabled ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.92)';
  text(ctx, b.label, r.x + r.w / 2, r.y + r.h / 2 + 7, 20, ink, 'center', 700);
  ctx.restore();
}

function drawButtons(ctx, screen, m) {
  const acts = buttons(screen, m.slot);
  const focus = clamp(Math.floor(num(m.focus[screen], 0)), 0, acts.length - 1);
  for (let i = 0; i < acts.length; i += 1) {
    drawButton(ctx, acts[i], m.hover === acts[i].id, i === focus || m.hover === acts[i].id);
  }
}

function drawStart(ctx, m) {
  backdrop(ctx, 1);
  drawTitle(ctx);
  text(ctx, 'a top down crime story in a city that never forgives', W / 2, START.subY, 19, 'rgba(255, 255, 255, 0.7)', 'center', 500);
  drawControls(ctx);
  drawButtons(ctx, 'start', m);
  text(ctx, 'Enter starts, Tab picks, Esc pauses', W / 2, START.hintY, 14, 'rgba(255, 255, 255, 0.42)', 'center', 500);
  if (m.slot) text(ctx, `${money(m.slot.cash)} and ${m.slot.missionsDone} jobs done in the slot`, W / 2, START.hintY + 26, 13, 'rgba(255, 255, 255, 0.34)', 'center', 500);
}

function drawPause(ctx, state, m) {
  backdrop(ctx, 0.55);
  const p = PAUSE.panel;
  panel(ctx, p.x, p.y, p.w, p.h, 18);
  text(ctx, 'PAUSED', W / 2, PAUSE.titleY, 42, GOLD_HOT, 'center', 800);
  text(ctx, 'the city waits, the meter still runs', W / 2, PAUSE.titleY + 30, 15, 'rgba(255, 255, 255, 0.5)', 'center', 500);
  drawButtons(ctx, 'pause', m);
  const savedAt = num(state.flags && state.flags.savedAt, 0);
  text(ctx, savedAt > 0 ? `last save at ${clock(savedAt)}` : 'nothing saved yet', W / 2, p.y + p.h - 24, 13, 'rgba(255, 255, 255, 0.4)', 'center', 500);
}

function drawWasted(ctx, state, m) {
  const g = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 800);
  g.addColorStop(0, 'rgba(58, 4, 6, 0.74)'); g.addColorStop(1, 'rgba(8, 0, 0, 0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `800 104px ${FONT}`;
  ctx.shadowColor = 'rgba(200, 36, 28, 0.6)'; ctx.shadowBlur = 30;
  ctx.fillStyle = '#c8241c';
  ctx.fillText('WASTED', W / 2, DEAD.titleY);
  ctx.restore();
  text(ctx, 'you went down in the street', W / 2, DEAD.subY, 18, 'rgba(255, 255, 255, 0.66)', 'center', 500);
  drawButtons(ctx, 'dead', m);
  const left = num(state.player && state.player.deadAt, 0) - num(state.t, 0);
  text(ctx, left > 0 ? `respawning in ${left.toFixed(1)} s` : 'respawning now', W / 2, DEAD.noteY, 15, 'rgba(255, 255, 255, 0.55)', 'center', 600);
  text(ctx, 'the hospital takes $100 and patches you up', W / 2, DEAD.clockY, 13, 'rgba(255, 255, 255, 0.34)', 'center', 500);
}

export function drawMenu(ctx, state) {
  if (!ctx || !state) return;
  const screen = screenOf(state);
  if (screen === 'play') return;
  const m = menuOf(state);
  const v = view(state);
  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);
  if (screen === 'start') drawStart(ctx, m);
  else if (screen === 'pause') drawPause(ctx, state, m);
  else drawWasted(ctx, state, m);
  ctx.restore();
}
