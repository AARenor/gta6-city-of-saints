// City of Saints: the minimap.
//
// A 168 px north-up panel in the bottom left corner, drawn from the same world
// createWorld() made: asphalt under everything, the building footprints, the
// parks, the beach and the sea east of the coast. Above that layer go traffic as
// pale dots, police as red dots, the current mission marker as a gold diamond,
// and the player as a white arrow that turns with him. The border pulses red
// while state.wanted is above zero, and the N badge at the top says which way
// north is.
//
// One fixed scale: the whole 3840 px world always fits the panel, so the map
// never moves under the player and the layout reads as a city, not a compass.
//
// Exports: drawMinimap.

import { PALETTE } from '../world/palette.js';

const PANEL = 168, MARGIN = 16, INSET = 6, RADIUS = 12;
const SIZE = 3840, COAST = 3520, SHORE = 3628;
const GOLD = PALETTE.neon[2];
const RED = '#ff4a3d';
const TRAFFIC_DOT = 'rgba(233, 229, 211, 0.5)';
const BUILDING = '#4a4e56';
const PARK = '#2f4a2c';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

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

// World geometry with the contract constants as fallbacks.
function geo(world) {
  const w = world || {};
  return {
    size: Number.isFinite(w.size) ? w.size : SIZE,
    coast: Number.isFinite(w.coast) ? w.coast : COAST,
    shore: Number.isFinite(w.shore) ? w.shore : SHORE,
    blocks: Array.isArray(w.blocks) ? w.blocks : [],
  };
}

function dot(ctx, x, y, r, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function diamond(ctx, x, y, r, colour) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 26, 0, 0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// The player arrow: nose on +x before the rotation, because an angle of 0 faces
// east in this world and a rotation turns it with the rest of the map.
function arrow(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4.4, 3.6);
  ctx.lineTo(-2.2, 0);
  ctx.lineTo(-4.4, -3.6);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(9, 12, 17, 0.9)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawGround(ctx, g, k, inner) {
  const coastX = g.coast * k, shoreX = g.shore * k;
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fillRect(0, 0, inner, inner);
  ctx.fillStyle = PALETTE.sandWet;
  ctx.fillRect(coastX, 0, Math.max(1, shoreX - coastX), inner);
  ctx.fillStyle = PALETTE.sea;
  ctx.fillRect(shoreX, 0, Math.max(0, inner - shoreX), inner);
  ctx.fillStyle = PALETTE.seaDeep;
  ctx.fillRect(shoreX + inner * 0.05, 0, Math.max(0, inner - shoreX - inner * 0.05), inner);
  for (const b of g.blocks) {
    ctx.fillStyle = b.kind === 'park' ? PARK : BUILDING;
    ctx.fillRect(b.x * k, b.y * k, Math.max(1, b.w * k), Math.max(1, b.h * k));
  }
}

function drawUnits(ctx, state, k, t) {
  const cars = Array.isArray(state.cars) ? state.cars : [];
  for (const car of cars) {
    if (!Number.isFinite(car.x) || !Number.isFinite(car.y)) continue;
    ctx.fillStyle = TRAFFIC_DOT;
    ctx.fillRect(car.x * k - 0.7, car.y * k - 0.7, 1.4, 1.4);
  }
  const police = Array.isArray(state.police) ? state.police : [];
  for (const unit of police) {
    if (unit.hp != null && unit.hp <= 0) continue;
    if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y)) continue;
    dot(ctx, unit.x * k, unit.y * k, 2.4, RED);
  }
  const m = state.mission;
  const marker = m && m.stage && m.stage.marker;
  if (marker && !m.done) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    diamond(ctx, marker.x * k, marker.y * k, 4.2 + pulse * 1.6, GOLD);
  }
  const p = state.player;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) arrow(ctx, p.x * k, p.y * k, Number(p.angle) || 0);
}

function drawBorder(ctx, x, y, wanted, t) {
  const hot = wanted > 0;
  const a = hot ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 5.5)) : 0;
  ctx.strokeStyle = hot ? `rgba(255, 74, 61, ${a.toFixed(3)})` : 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = hot ? 2.6 : 1.5;
  round(ctx, x + 1, y + 1, PANEL - 2, PANEL - 2, RADIUS);
  ctx.stroke();
}

function drawNorthBadge(ctx, x, y) {
  const bx = x + PANEL / 2, by = y + 16;
  ctx.fillStyle = 'rgba(9, 12, 17, 0.92)';
  round(ctx, bx - 11, by - 10, 22, 18, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  round(ctx, bx - 11, by - 10, 22, 18, 5);
  ctx.stroke();
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', bx, by - 1);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

export function drawMinimap(ctx, state) {
  if (!ctx || !state) return;
  const c = state.canvas || {};
  const sw = c.w || 1280, sh = c.h || 720;
  const x = MARGIN, y = sh - MARGIN - PANEL;
  const inner = PANEL - INSET * 2;
  const g = geo(state.world);
  const k = inner / g.size;
  const t = state.t || 0;
  const wanted = Math.max(0, Math.min(5, Math.round(Number(state.wanted) || 0)));

  ctx.fillStyle = 'rgba(9, 12, 17, 0.86)';
  round(ctx, x, y, PANEL, PANEL, RADIUS);
  ctx.fill();

  ctx.save();
  round(ctx, x + INSET, y + INSET, inner, inner, RADIUS - 5);
  ctx.clip();
  ctx.translate(x + INSET, y + INSET);
  drawGround(ctx, g, k, inner);
  drawUnits(ctx, state, k, t);
  ctx.restore();

  drawBorder(ctx, x, y, wanted, t);
  drawNorthBadge(ctx, x, y);
}
