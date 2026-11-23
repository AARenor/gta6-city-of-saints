// City of Saints: the heads up display.
//
// drawHud() paints everything that is not the world, in screen space: the cash
// panel top left, the mission banner across the top, the wanted stars and the
// ammo readout top right, the health bar above the minimap, timed messages from
// hudMessage(), the red damage vignette while health is low, and the speed dial
// while the player drives a car.
//
// hudMessage(state, text, seconds) is the one writer of state.hud.message and
// state.hud.messageUntil, so missions and pickups share a single message line.
//
// Exports: drawHud, hudMessage.
//
// Nothing here keeps state between frames and the only clock is state.t, so a
// screenshot scene with a frozen t draws the same picture every time.

import { PALETTE } from '../world/palette.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GOLD = PALETTE.neon[2];
const GOLD_HOT = '#ffeaa0';
const RED = '#e0402f';
const LOW_HEALTH = 40;
const STARS = 5;
const DIAL_MAX = 240;                 // km/h at the end of the sweep
const PX_TO_KPH = 0.56;               // 430 px/s top speed lands near 240
const MARGIN = 16;
const MINIMAP = 168;                  // the panel minimap.js owns
const CASH = { x: 16, y: 14, w: 196, h: 46 };
const AMMO = { y: 62, w: 196, h: 32 };
const HEALTH = { x: 16, w: 168, h: 16 };
const BANNER = { y: 12, h: 56, w: 832 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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

function panel(ctx, x, y, w, h, r) {
  ctx.fillStyle = 'rgba(9, 12, 17, 0.78)';
  round(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1;
  round(ctx, x, y, w, h, r);
  ctx.stroke();
}

function label(ctx, str, x, y, size, colour, align, weight) {
  ctx.font = `${weight || 600} ${size}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

// Shortens with an ellipsis until it fits max px at this size.
function fit(ctx, str, max, size, weight) {
  ctx.font = `${weight || 600} ${size}px ${FONT}`;
  if (ctx.measureText(str).width <= max) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

function money(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return `$${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function starPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.46 : r;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function healthOf(state) {
  const p = state.player || {};
  return clamp(Number.isFinite(p.health) ? p.health : 100, 0, 100);
}

// Red edges closing in, drawn under the panels, never over them.
function drawVignette(ctx, state, w, h) {
  const hp = healthOf(state);
  if (hp >= LOW_HEALTH) return;
  const k = (LOW_HEALTH - hp) / LOW_HEALTH;
  const pulse = 0.5 + 0.5 * Math.sin((state.t || 0) * 5);
  const a = 0.24 + 0.3 * k + 0.08 * pulse * k;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.74);
  g.addColorStop(0, 'rgba(150, 8, 8, 0)');
  g.addColorStop(0.62, `rgba(150, 8, 8, ${(a * 0.34).toFixed(3)})`);
  g.addColorStop(1, `rgba(140, 4, 4, ${a.toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawCash(ctx, state) {
  const hud = state.hud || {};
  const p = state.player || {};
  const flash = (hud.cashFlashUntil || 0) > (state.t || 0);
  panel(ctx, CASH.x, CASH.y, CASH.w, CASH.h, 10);
  label(ctx, 'CASH', CASH.x + 14, CASH.y + 18, 9, 'rgba(255, 255, 255, 0.45)', 'left', 700);
  label(ctx, money(p.cash), CASH.x + 14, CASH.y + 38, 21, flash ? GOLD_HOT : GOLD, 'left', 700);
  ctx.fillStyle = flash ? GOLD_HOT : GOLD;
  ctx.beginPath();
  ctx.arc(CASH.x + CASH.w - 21, CASH.y + 24, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(9, 12, 17, 0.85)';
  ctx.fillRect(CASH.x + CASH.w - 22.5, CASH.y + 20, 3, 8);
}

function drawStars(ctx, state, w) {
  const n = clamp(Math.round(Number(state.wanted) || 0), 0, STARS);
  const lik = n > 0 ? 0.86 + 0.14 * Math.sin((state.t || 0) * 3.4) : 1;
  const right = w - MARGIN;
  label(ctx, 'WANTED', right, 24, 9, 'rgba(255, 255, 255, 0.45)', 'right', 700);
  for (let i = 0; i < STARS; i += 1) {
    const cx = right - 11 - i * 28;
    starPath(ctx, cx, 42, 11);
    ctx.save();
    ctx.globalAlpha = i < n ? lik : 1;
    ctx.fillStyle = i < n ? GOLD : 'rgba(255, 255, 255, 0.12)';
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = i < n ? 'rgba(80, 52, 0, 0.85)' : 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.4;
    starPath(ctx, cx, 42, 11);
    ctx.stroke();
  }
}

function drawAmmo(ctx, state, w) {
  const p = state.player || {};
  const rounds = Math.max(0, Math.round(Number(p.ammo) || 0));
  const x = w - MARGIN - AMMO.w;
  panel(ctx, x, AMMO.y, AMMO.w, AMMO.h, 8);
  label(ctx, 'AMMO', x + 14, AMMO.y + 21, 10, 'rgba(255, 255, 255, 0.45)', 'left', 700);
  label(ctx, String(rounds), x + AMMO.w - 14, AMMO.y + 22, 16, rounds > 0 ? '#ffffff' : RED, 'right', 700);
  // one pip per ten rounds left
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = rounds > i * 10 ? 'rgba(255, 210, 63, 0.75)' : 'rgba(255, 255, 255, 0.10)';
    ctx.fillRect(x + AMMO.w - 96 + i * 11, AMMO.y + 15, 7, 4);
  }
}

function drawBanner(ctx, state, w) {
  const m = state.mission;
  const s = m && m.stage;
  if (!s || m.done) return;
  // A narrow canvas can leave less than nothing between the cash panel and the
  // stars, so the banner keeps a floor and the text gets a positive budget.
  const bw = Math.max(240, Math.min(BANNER.w, w - 2 * (CASH.w + MARGIN)));
  const x = Math.round((w - bw) / 2);
  const room = Math.max(80, bw - 150);
  panel(ctx, x, BANNER.y, bw, BANNER.h, 10);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x + 8, BANNER.y + 9, 3, BANNER.h - 18);
  label(ctx, fit(ctx, String(s.title || ''), room, 16, 700), x + 22, BANNER.y + 25, 16, '#ffffff', 'left', 700);
  label(ctx, fit(ctx, String(s.objective || ''), room, 12, 600), x + 22, BANNER.y + 44, 12, 'rgba(255, 255, 255, 0.74)', 'left', 600);
  if (s.reward) {
    label(ctx, 'REWARD', x + bw - 16, BANNER.y + 22, 8, 'rgba(255, 255, 255, 0.45)', 'right', 700);
    label(ctx, money(s.reward), x + bw - 16, BANNER.y + 44, 18, GOLD, 'right', 700);
  }
}

function drawMessage(ctx, state, w, height) {
  const hud = state.hud || {};
  const text = hud.message;
  if (!text) return;
  const t = state.t || 0;
  const until = hud.messageUntil || 0;
  if (t >= until) return;
  const rem = until - t;
  const a = rem < 0.5 ? clamp(rem / 0.5, 0, 1) : 1;
  const max = Math.min(w * 0.62, 760);
  const body = fit(ctx, String(text), max, 15, 600);
  ctx.font = `600 15px ${FONT}`;
  const bw = Math.min(max, ctx.measureText(body).width) + 44;
  const x = Math.round((w - bw) / 2);
  const y = Math.round(height * 0.7);
  ctx.save();
  ctx.globalAlpha = a;
  panel(ctx, x, y, bw, 38, 8);
  label(ctx, body, x + bw / 2, y + 24, 15, '#ffffff', 'center', 600);
  ctx.restore();
}

function drawHealth(ctx, state, height) {
  const hp = healthOf(state);
  const y = height - MARGIN - MINIMAP - 40;
  label(ctx, 'HEALTH', HEALTH.x, y - 7, 9, 'rgba(255, 255, 255, 0.45)', 'left', 700);
  panel(ctx, HEALTH.x, y, HEALTH.w, HEALTH.h, 6);
  const fill = (HEALTH.w - 4) * (hp / 100);
  if (fill > 1) {
    const low = hp < LOW_HEALTH;
    ctx.save();
    ctx.globalAlpha = low ? 0.72 + 0.28 * Math.sin((state.t || 0) * 7) : 1;
    ctx.fillStyle = low ? '#ff4a34' : RED;
    round(ctx, HEALTH.x + 2, y + 2, fill, HEALTH.h - 4, 4);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  for (let i = 1; i < 4; i += 1) ctx.fillRect(HEALTH.x + 2 + (HEALTH.w - 4) * (i / 4), y + 2, 1, HEALTH.h - 4);
  label(ctx, String(Math.round(hp)), HEALTH.x + HEALTH.w - 7, y + 12, 11, '#ffffff', 'right', 700);
}

function drawSpeed(ctx, state, w, height) {
  const p = state.player;
  if (!p) return;
  if (p.onFoot !== false && !p.car) return;
  const kph = clamp(Math.round(Math.abs(Number(p.speed) || 0) * PX_TO_KPH), 0, DIAL_MAX);
  // The dial box sits MARGIN px off the bottom right corner, so its rim is the
  // same 16 px from both edges as the minimap is from the bottom left.
  const r = 52;
  const cx = w - MARGIN - r, cy = height - MARGIN - r;
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
  const at = (v) => a0 + (clamp(v, 0, DIAL_MAX) / DIAL_MAX) * sweep;
  ctx.fillStyle = 'rgba(9, 12, 17, 0.80)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 8, at(170), at(DIAL_MAX));
  ctx.stroke();
  for (let v = 0; v <= DIAL_MAX; v += 40) {
    const a = at(v), inner = r - (v % 80 === 0 ? 16 : 12);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = v % 80 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.stroke();
  }
  const na = at(kph);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(na) * (r - 26), cy + Math.sin(na) * (r - 26));
  ctx.lineTo(cx + Math.cos(na) * (r - 8), cy + Math.sin(na) * (r - 8));
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, String(kph), cx, cy + 26, 20, '#ffffff', 'center', 700);
  label(ctx, 'KM/H', cx, cy + 39, 8, 'rgba(255, 255, 255, 0.5)', 'center', 700);
}

export function drawHud(ctx, state) {
  if (!ctx || !state) return;
  const c = state.canvas || {};
  const w = c.w || 1280, height = c.h || 720;
  drawVignette(ctx, state, w, height);
  drawBanner(ctx, state, w);
  drawCash(ctx, state);
  drawStars(ctx, state, w);
  drawAmmo(ctx, state, w);
  drawHealth(ctx, state, height);
  drawMessage(ctx, state, w, height);
  drawSpeed(ctx, state, w, height);
}

// The timed line under the banner. Later calls replace an earlier message even
// when it is still showing, which is what a chain of hints wants.
export function hudMessage(state, text, seconds) {
  if (!state) return;
  if (!state.hud) state.hud = { message: '', messageUntil: 0, cashFlashUntil: 0 };
  state.hud.message = text == null ? '' : String(text);
  state.hud.messageUntil = (state.t || 0) + (Number(seconds) || 0);
}
