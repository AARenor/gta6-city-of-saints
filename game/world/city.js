// City of Saints: the world grid, its buildings, parks, coast, and the drawing of
// everything above the ground. The ground itself lives in palette.js.
// 12 pitches of 320 px (96 px road plus a 224 px block) in a 3840 px square; the
// last pitch is beach and sea. Buildings are solid and drawn as a roof plus two
// shaded faces. Palms and lamps stand in the sidewalk band, so no prop covers a lane.
// Exports: createWorld, drawWorld, blockAt, isRoad, solidAt, randomRoadPoint.

import { PALETTE, paint } from './palette.js';

const GRID = 12, PITCH = 320, ROAD = 96;
const BLOCK = PITCH - ROAD, SIZE = GRID * PITCH;
const COAST = SIZE - PITCH, SHORE = COAST + 108, KERB = 14;
const PIER = { x: COAST, y: 1584, w: 292, h: 96 };
const PARK_COUNT = 20;
const PLACE = ['Vela', 'Marisol', 'Okto', 'Harbor', 'Cobalt', 'Kask', 'Sable', 'Tidal', 'Nimbus', 'Lumen',
  'Rook', 'Vesper', 'Ember', 'Onyx', 'Delta', 'Quill', 'Argo', 'Pike', 'Solace', 'Juno'];
const TRADE = ['Deli', 'Market', 'Bodega', 'Diner', 'Cafe', 'Bar', 'Pawn', 'Motors', 'Records',
  'Pharmacy', 'Studio', 'Electronics', 'Barber', 'Laundry'];

function geometry(world) {
  const w = world || {};
  return { grid: w.grid || GRID, pitch: w.pitch || PITCH, road: w.road || ROAD,
    size: w.size || SIZE, coast: w.coast || COAST, shore: w.shore || SHORE };
}
function pick(list, rand) { return list[Math.floor(rand() * list.length) % list.length]; }
function shopName(rand) { return pick(PLACE, rand) + ' ' + pick(TRADE, rand); }

export function createWorld(rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const world = {
    seed: Math.floor(rand() * 1e9), size: SIZE, grid: GRID, pitch: PITCH, road: ROAD,
    block: BLOCK, coast: COAST, shore: SHORE, pier: { ...PIER },
    blocks: [], buildings: [], signs: [], palms: [], lamps: [], trees: [], benches: [], parkCount: 0,
  };
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const x = i * PITCH + ROAD, y = j * PITCH + ROAD;
      if (x + BLOCK > COAST) continue;
      world.blocks.push({ i, j, x, y, w: BLOCK, h: BLOCK, seed: Math.floor(rand() * 1e9), kind: 'building', buildings: [] });
    }
  }
  for (const index of chooseParks(world.blocks.length, PARK_COUNT, rand)) world.blocks[index].kind = 'park';
  for (const block of world.blocks) {
    if (block.kind === 'park') plantPark(world, block, rand);
    else fillBlock(world, block, rand);
  }
  plantPalms(world, rand);
  placeLamps(world);
  return world;
}

function chooseParks(total, count, rand) {
  const index = [];
  for (let i = 0; i < total; i += 1) index.push(i);
  for (let i = total - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [index[i], index[j]] = [index[j], index[i]];
  }
  return index.slice(0, Math.min(count, total));
}

function fillBlock(world, block, rand) {
  const inset = KERB + 8, x = block.x + inset, y = block.y + inset;
  const w = block.w - inset * 2, h = block.h - inset * 2, gap = 14;
  const layout = Math.floor(rand() * 4);
  let rects;
  if (layout === 0) {
    const c = Math.round((w - gap) * (0.4 + rand() * 0.2));
    rects = [[x, y, c, h], [x + c + gap, y, w - c - gap, h]];
  } else if (layout === 1) {
    const c = Math.round((h - gap) * (0.4 + rand() * 0.2));
    rects = [[x, y, w, c], [x, y + c + gap, w, h - c - gap]];
  } else if (layout === 2) {
    const c = Math.round(w * (0.42 + rand() * 0.16)), mid = Math.round((h - gap) * (0.35 + rand() * 0.3));
    rects = [[x, y, c, h], [x + c + gap, y, w - c - gap, mid], [x + c + gap, y + mid + gap, w - c - gap, h - mid - gap]];
  } else {
    const c = Math.round(h * (0.34 + rand() * 0.16)), mid = Math.round((w - gap) * (0.4 + rand() * 0.2));
    rects = [[x, y, w, c], [x, y + c + gap, mid, h - c - gap], [x + mid + gap, y + c + gap, w - mid - gap, h - c - gap]];
  }
  for (const [bx, by, bw, bh] of rects) {
    if (bw < 52 || bh < 52) continue;
    const family = Math.floor(rand() * PALETTE.families.length), fam = PALETTE.families[family];
    const building = { x: bx, y: by, w: bw, h: bh, family, name: shopName(rand), roof: pick(fam.roofs, rand) };
    block.buildings.push(building);
    world.buildings.push(building);
    // the plate never reaches past the shopfront it names
    if (bw > 72 && bh > 72 && rand() < 0.7) {
      world.signs.push({ x: bx + bw / 2, y: by + bh + 2, w: Math.min(bw - 10, 128), text: building.name, color: pick(PALETTE.neon, rand) });
    }
  }
}

// Two trees off the cross path and one bench, so a park reads as tended ground.
function plantPark(world, block, rand) {
  const key = block.i * 100 + block.j;
  world.parkCount += 1;
  for (const [x, y] of [[block.x + 54, block.y + 60], [block.x + block.w - 62, block.y + block.h - 64]]) {
    world.trees.push({ x: x + (rand() - 0.5) * 8, y: y + (rand() - 0.5) * 8, r: 9 + rand() * 5, tone: rand() < 0.5 ? 0 : 1, park: key });
  }
  world.benches.push({ x: block.x + block.w / 2 + 16, y: block.y + 40, w: 34, h: 9, park: key });
}

function plantPalms(world, rand) {
  // the promenade palm line along the sand
  for (let y = 24; y < SIZE - 24; y += 118 + rand() * 46) {
    for (let k = 0; k < 2; k += 1) {
      if (rand() < 0.25) continue;
      world.palms.push({ x: COAST + 18 + k * 46 + rand() * 18, y: y + rand() * 40, s: 0.8 + rand() * 0.45, phase: rand() * 6.283, dir: 's' });
    }
  }
  // street palms: three to six per block edge, standing inside the sidewalk band
  for (const block of world.blocks) {
    for (let edge = 0; edge < 4; edge += 1) {
      const count = 3 + Math.floor(rand() * 4), side = edge < 2;
      for (let k = 0; k < count; k += 1) {
        const along = (k + 0.5) / count, jitter = (rand() - 0.5) * 10, at = block.x + block.w * along + jitter;
        const x = side ? (edge ? block.x + block.w - 9 : block.x + 9) : at;
        const y = side ? block.y + block.h * along + jitter : (edge === 2 ? block.y + 9 : block.y + block.h - 9);
        world.palms.push({ x, y, s: 0.4 + rand() * 0.16, phase: rand() * 6.283, dir: side ? (edge ? 'e' : 'w') : (edge === 2 ? 'n' : 's') });
      }
    }
  }
}

// A lamp every 96 px along each sidewalk, arm turned into the block.
function placeLamps(world) {
  for (const block of world.blocks) {
    for (let along = 24; along < block.w - 8; along += 96) {
      world.lamps.push({ x: block.x + 5, y: block.y + along, dir: 'w' });
      world.lamps.push({ x: block.x + block.w - 5, y: block.y + along, dir: 'e' });
      world.lamps.push({ x: block.x + along, y: block.y + 5, dir: 'n' });
      world.lamps.push({ x: block.x + along, y: block.y + block.h - 5, dir: 's' });
    }
  }
  for (let y = 80; y < SIZE; y += 300) world.lamps.push({ x: COAST + 4, y, dir: 'w' });
}

export function blockAt(world, x, y) {
  if (!world || !Array.isArray(world.blocks)) return null;
  for (const b of world.blocks) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
  return null;
}

export function isRoad(world, x, y) {
  const g = geometry(world);
  if (x < 0 || y < 0 || x >= g.size || y >= g.size || x >= g.coast) return false;
  return x % g.pitch < g.road || y % g.pitch < g.road;
}

export function solidAt(world, x, y) {
  const g = geometry(world), pier = world && world.pier;
  if (x < 0 || y < 0 || x >= g.size || y >= g.size) return true;
  if (pier && x >= pier.x && x <= pier.x + pier.w && y >= pier.y && y <= pier.y + pier.h) return false;
  if (x >= g.shore) return true;
  const block = blockAt(world, x, y);
  if (!block) return false;
  for (const b of block.buildings) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  return false;
}

export function randomRoadPoint(world, rng) {
  const g = geometry(world), rand = typeof rng === 'function' ? rng : Math.random;
  if (rand() < 0.5) {
    const k = Math.floor(rand() * (g.grid - 1));
    return { x: k * g.pitch + g.road * (rand() < 0.5 ? 0.25 : 0.75), y: rand() * (g.size - 40) + 20 };
  }
  const m = Math.floor(rand() * g.grid);
  return { x: rand() * (g.coast - 40) + 20, y: m * g.pitch + g.road * (rand() < 0.5 ? 0.25 : 0.75) };
}

function viewRect(state) {
  const cam = (state && state.camera) || { x: 0, y: 0 }, m = 140;
  const w = (state && state.canvas && state.canvas.w) || 1280, h = (state && state.canvas && state.canvas.h) || 720;
  return { x: cam.x - m, y: cam.y - m, w: w + m * 2, h: h + m * 2 };
}
function inView(view, x, y, pad) {
  return x > view.x - pad && x < view.x + view.w + pad && y > view.y - pad && y < view.y + view.h + pad;
}
// Amount above 0 darkens toward black, below 0 lightens toward white.
function shade(color, amount) {
  const v = parseInt(color.slice(1), 16);
  const ch = (n) => Math.round(amount < 0 ? n + (255 - n) * -amount : n * (1 - amount));
  return '#' + ((1 << 24) | (ch((v >> 16) & 255) << 16) | (ch((v >> 8) & 255) << 8) | ch(v & 255)).toString(16).slice(1);
}
// Nearly all of the art below is a rectangle, a disc, an ellipse or a frame, so
// these four keep the family code short without hiding what it draws.
function rect(ctx, style, x, y, w, h) { ctx.fillStyle = style; ctx.fillRect(x, y, w, h); }
function disc(ctx, style, x, y, r) { ctx.fillStyle = style; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function leaf(ctx, style, x, y, rx, ry, rot) { ctx.fillStyle = style; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill(); }
function frame(ctx, style, x, y, w, h, width) { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.strokeRect(x, y, w, h); }
function smallBox(ctx, x, y, w, h, color) {
  rect(ctx, 'rgba(0,0,0,0.22)', x + 2, y + 2, w, h); rect(ctx, color, x, y, w, h);
  rect(ctx, shade(color, -0.34), x, y, w, 3);
}
// How deep the south and east faces may go before they reach a neighbour roof or
// the end of the block's inner pavement: 10 to 16 px at this grid.
function faceDepth(block, b) {
  let s = block.y + block.h - (b.y + b.h), e = block.x + block.w - (b.x + b.w);
  for (const o of block.buildings) {
    if (o === b) continue;
    if (Math.min(b.x + b.w, o.x + o.w) > Math.max(b.x, o.x) && o.y >= b.y + b.h) s = Math.min(s, o.y - (b.y + b.h));
    if (Math.min(b.y + b.h, o.y + o.h) > Math.max(b.y, o.y) && o.x >= b.x + b.w) e = Math.min(e, o.x - (b.x + b.w));
  }
  return { s: Math.max(10, Math.min(16, s)), e: Math.max(10, Math.min(16, e)) };
}
function nightAmount(dayPhase) {
  const p = ((dayPhase || 0) % 1 + 1) % 1, light = 0.5 + 0.5 * Math.cos((p - 0.4) * Math.PI * 2);
  return 1 - Math.min(1, Math.max(0, (light - 0.15) / 0.75));
}

export function drawWorld(ctx, state) {
  if (!state || !state.world) return;
  const world = state.world, view = viewRect(state), night = nightAmount(state.dayPhase);
  paint(ctx, world, state);
  if (inView(view, world.pier.x + world.pier.w / 2, world.pier.y + world.pier.h / 2, 220)) drawPier(ctx, world, night);
  drawParks(ctx, world, night, view);
  drawBuildings(ctx, world, night, view);
  // lamps and signs stand on the pavement, in front of the shaded building faces
  drawLamps(ctx, world, night, view);
  drawSigns(ctx, world, night, view);
  drawPalms(ctx, world, night, (state && state.t) || 0, view);
}

function drawPier(ctx, world, night) {
  const p = world.pier, post = shade(PALETTE.trunk, 0.45 + night * 0.3), plank = shade(PALETTE.pierPlank, night * 0.45);
  // pilings stand in the water either side of the deck, each with its shadow
  for (let x = p.x + 12; x < p.x + p.w - 6; x += 24) {
    rect(ctx, 'rgba(0,0,0,0.3)', x + 2, p.y + p.h + 3, 6, 9); rect(ctx, 'rgba(0,0,0,0.3)', x + 2, p.y - 11, 6, 9);
    rect(ctx, post, x, p.y + p.h + 1, 5, 9); rect(ctx, post, x, p.y - 10, 5, 9);
  }
  rect(ctx, shade(PALETTE.pier, night * 0.45), p.x, p.y, p.w, p.h);
  for (let x = p.x + 6; x < p.x + p.w - 4; x += 14) rect(ctx, plank, x, p.y + 5, 6, p.h - 10);
  frame(ctx, plank, p.x + 1, p.y + 1, p.w - 2, p.h - 2, 2);
  const bulb = night > 0.35 ? PALETTE.lamp : '#e8e2d0';
  rect(ctx, bulb, p.x + p.w - 14, p.y + 6, 6, 6); rect(ctx, bulb, p.x + 6, p.y + p.h - 12, 6, 6);
}

// Grass with mown bands, a cross path, two trees and a bench per park.
function drawParks(ctx, world, night, view) {
  const grass = shade(PALETTE.grass, night * 0.6), band = shade(PALETTE.grass, 0.16 + night * 0.4);
  const path = shade(PALETTE.sand, 0.35 + night * 0.2), edge = shade(PALETTE.sand, 0.52 + night * 0.2);
  const wood = shade('#8a5a34', night * 0.5), slat = shade('#ad7844', night * 0.4);
  const light = shade(PALETTE.palm, night * 0.45), deep = shade(PALETTE.palmDark, night * 0.5);
  for (const block of world.blocks) {
    if (block.kind !== 'park' || !inView(view, block.x + block.w / 2, block.y + block.h / 2, 320)) continue;
    const x = block.x + KERB, y = block.y + KERB, w = block.w - KERB * 2, h = block.h - KERB * 2;
    const cx = block.x + block.w / 2, cy = block.y + block.h / 2, key = block.i * 100 + block.j;
    rect(ctx, grass, x, y, w, h);
    for (let k = y; k < y + h; k += 30) rect(ctx, band, x, k, w, 14);
    rect(ctx, edge, cx - 13, y, 26, h); rect(ctx, edge, x, cy - 13, w, 26);
    rect(ctx, path, cx - 9, y, 18, h); rect(ctx, path, x, cy - 9, w, 18);
    for (const bench of world.benches) {
      if (bench.park !== key) continue;
      rect(ctx, 'rgba(0,0,0,0.24)', bench.x + 2, bench.y + 2, bench.w, bench.h);
      rect(ctx, wood, bench.x, bench.y, bench.w, bench.h);
      for (let i = 0; i < 3; i += 1) rect(ctx, slat, bench.x + 1, bench.y + 1 + i * 3, bench.w - 2, 2);
    }
    for (const tree of world.trees) {
      if (tree.park !== key) continue;
      disc(ctx, 'rgba(0,0,0,0.26)', tree.x + 4, tree.y + 5, tree.r);
      disc(ctx, tree.tone ? light : deep, tree.x, tree.y, tree.r);
      disc(ctx, tree.tone ? deep : light, tree.x - tree.r * 0.25, tree.y - tree.r * 0.3, tree.r * 0.55);
    }
  }
}

// The arm points into the block, so a lamp never hangs over a lane.
function lampHead(lamp) {
  const d = lamp.dir || 's';
  return { x: lamp.x + (d === 'w' ? 9 : d === 'e' ? -9 : 0), y: lamp.y + (d === 's' ? -9 : d === 'n' ? 9 : 0) };
}
function drawLamps(ctx, world, night, view) {
  const pole = shade('#4a4d52', night * 0.35), bulb = night > 0.35 ? PALETTE.lamp : '#e8e2d0';
  const lit = night >= 0.3;
  // One small pool under each head, built once at the origin and moved with the
  // canvas: a 52 px disc that fades out, so a row of lamps lights the pavement
  // it stands on instead of washing the whole street a flat warm colour.
  const pool = lit ? ctx.createRadialGradient(0, 0, 2, 0, 0, 26) : null;
  if (pool) {
    pool.addColorStop(0, 'rgba(255, 217, 160, 0.34)');
    pool.addColorStop(0.5, 'rgba(255, 217, 160, 0.13)');
    pool.addColorStop(1, 'rgba(255, 217, 160, 0)');
  }
  for (const lamp of world.lamps) {
    if (!inView(view, lamp.x, lamp.y, lit ? 40 : 24)) continue;
    const head = lampHead(lamp);
    if (pool) {
      ctx.save();
      ctx.globalAlpha = night;
      ctx.translate(head.x, head.y);
      ctx.fillStyle = pool;
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    rect(ctx, pole, lamp.x - 1.5, Math.min(lamp.y, head.y), 3, Math.abs(head.y - lamp.y) + 3);
    rect(ctx, pole, Math.min(lamp.x, head.x), head.y - 1.5, Math.abs(head.x - lamp.x) + 3, 3);
    rect(ctx, bulb, head.x - 2, head.y - 2, 5, 3);
  }
}

function drawBuildings(ctx, world, night, view) {
  const shadow = night > 0.4 ? 'rgba(0,0,0,0.26)' : 'rgba(0,0,0,0.15)', pave = shade(PALETTE.sidewalk, 0.1 + night * 0.4);
  for (const block of world.blocks) {
    if (block.buildings.length === 0 || !inView(view, block.x + block.w / 2, block.y + block.h / 2, 320)) continue;
    rect(ctx, pave, block.x + KERB, block.y + KERB, block.w - KERB * 2, block.h - KERB * 2);
    for (const b of block.buildings) rect(ctx, shadow, b.x + 5, b.y + 6, b.w + 10, b.h + 14);
    for (const b of block.buildings) drawBuilding(ctx, b, night, block);
  }
}

// A roof plane lifted off the ground by two shaded faces: south lit along the roof
// line, east the dark side. The faces stop at the neighbour gap so they never
// crawl over the next roof, and the block margin keeps them off the road.
function drawBuilding(ctx, b, night, block) {
  const fam = PALETTE.families[b.family] || PALETTE.families[0], face = faceDepth(block, b);
  const wall = night > 0.35 ? shade(fam.wall, night * 0.5) : fam.wall;
  const roof = night > 0.35 ? shade(b.roof, night * 0.3) : b.roof;
  const south = ctx.createLinearGradient(0, b.y + b.h, 0, b.y + b.h + face.s);
  south.addColorStop(0, shade(wall, 0.14)); south.addColorStop(1, shade(wall, 0.44));
  ctx.fillStyle = south; ctx.fillRect(b.x + 3, b.y + b.h, b.w - 3, face.s);
  const east = ctx.createLinearGradient(b.x + b.w, 0, b.x + b.w + face.e, 0);
  east.addColorStop(0, shade(wall, 0.3)); east.addColorStop(1, shade(wall, 0.56));
  ctx.fillStyle = east; ctx.fillRect(b.x + b.w, b.y + 3, face.e, b.h - 3);
  drawFaceWindows(ctx, b, fam, night, face);
  // two roof tones meeting softly, lit at the north west corner
  const grad = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.75, b.y + b.h * 0.75);
  grad.addColorStop(0, shade(roof, -0.1)); grad.addColorStop(1, shade(roof, 0.16));
  ctx.fillStyle = grad; ctx.fillRect(b.x, b.y, b.w, b.h);
  // the parapet lip on the two shaded edges, which is what reads as height
  const lip = shade(roof, 0.4), foot = shade(wall, 0.62);
  rect(ctx, lip, b.x, b.y + b.h - 2, b.w, 2); rect(ctx, lip, b.x + b.w - 2, b.y, 2, b.h);
  drawRoofDetail(ctx, b, fam, night, roof);
  // the 3 px darker line where the building sits on the pavement
  rect(ctx, foot, b.x + 3, b.y + b.h + face.s - 3, b.w - 3, 3);
  rect(ctx, foot, b.x + b.w + face.e - 3, b.y + 3, 3, b.h - 3);
}

function drawFaceWindows(ctx, b, fam, night, face) {
  const lit = night > 0.35, wide = Math.max(2, face.e - 6), dark = shade(fam.glass, 0.18);
  for (let row = 0; row < (face.s >= 13 ? 2 : 1); row += 1) {
    for (let x = b.x + 7; x + 7 < b.x + b.w - 7; x += 15) {
      const on = (x * 13 + b.y * 7 + row * 29) % 100 < 62;
      rect(ctx, lit ? (on ? '#ffd88f' : '#20262c') : fam.glass, x, b.y + b.h + 3 + row * 5, 7, 3);
    }
  }
  for (let y = b.y + 8; y + 6 < b.y + b.h - 8; y += 16) {
    const on = (y * 11 + b.x * 5) % 100 < 55;
    rect(ctx, lit ? (on ? '#f0c47e' : '#1c2228') : dark, b.x + b.w + 3, y, wide, 3);
  }
}

// Roof furniture per family: a cell grid on glass, a cornice and two boxes on
// brick, a pool or a lit sign on hotels, AC units and a water tank on stucco.
function drawRoofDetail(ctx, b, fam, night, roof) {
  const name = fam.name, up = night > 0.35;
  if (name === 'glass') {
    const cell = up ? 'rgba(255,216,150,0.2)' : 'rgba(255,255,255,0.12)';
    for (let x = b.x + 10; x + 11 < b.x + b.w - 8; x += 24) {
      for (let y = b.y + 10; y + 11 < b.y + b.h - 8; y += 24) rect(ctx, cell, x, y, 11, 11);
    }
    frame(ctx, shade(roof, 0.32), b.x + 4.5, b.y + 4.5, b.w - 9, b.h - 9, 2);
  } else if (name === 'brick') {
    frame(ctx, shade(roof, 0.34), b.x + 8.5, b.y + 8.5, b.w - 17, b.h - 17, 3);
    smallBox(ctx, b.x + b.w * 0.18, b.y + b.h * 0.16, Math.min(22, b.w * 0.22), Math.min(16, b.h * 0.2), shade(roof, 0.42));
    smallBox(ctx, b.x + b.w * 0.54, b.y + b.h * 0.56, Math.min(18, b.w * 0.18), Math.min(13, b.h * 0.16), shade(roof, 0.5));
  } else if (name === 'hotel' && (Math.round(b.x) + Math.round(b.y)) % 7 < 4) {
    const pw = Math.max(22, b.w * 0.34), ph = Math.max(14, b.h * 0.24), px = b.x + b.w * 0.14, py = b.y + b.h * 0.16;
    rect(ctx, shade(roof, -0.3), px - 5, py - 5, pw + 10, ph + 10);
    rect(ctx, up ? '#1d4d63' : '#2f9fc4', px, py, pw, ph);
    rect(ctx, 'rgba(255,255,255,0.4)', px + 2, py + 2, pw - 4, 2);
    frame(ctx, shade(roof, -0.55), px, py, pw, ph, 1.5);
  } else if (name === 'hotel') {
    const sw = Math.min(b.w * 0.62, 58), sx = b.x + b.w / 2 - sw / 2, sy = b.y + b.h * 0.3;
    const neon = PALETTE.neon[(Math.round(b.x / 10) + Math.round(b.y / 10)) % PALETTE.neon.length];
    rect(ctx, shade(roof, 0.5), sx + 6, sy + 9, 3, 8); rect(ctx, shade(roof, 0.5), sx + sw - 9, sy + 9, 3, 8);
    rect(ctx, '#14161b', sx, sy, sw, 9);
    frame(ctx, neon, sx + 1, sy + 1, sw - 2, 7, 1.5);
    if (night > 0.25) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * night; ctx.shadowColor = neon; ctx.shadowBlur = 10;
      rect(ctx, neon, sx + 4, sy + 4, sw - 8, 2);
      ctx.restore();
    }
  } else if (name === 'stucco') {
    const gray = shade(roof, 0.55), ac = shade(roof, 0.3);
    for (let i = 0; i < 3; i += 1) {
      const ax = b.x + 12 + i * Math.max(18, (b.w - 34) / 3), ay = b.y + b.h * (0.2 + (i % 2) * 0.28);
      smallBox(ctx, ax, ay, 14, 10, ac);
      for (let g = 0; g < 3; g += 1) rect(ctx, gray, ax + 2, ay + 2 + g * 3, 10, 1);
    }
    const tx = b.x + b.w - 26, ty = b.y + b.h - 26, r = Math.max(7, Math.min(11, b.w * 0.07));
    disc(ctx, 'rgba(0,0,0,0.22)', tx + 3, ty + 3, r);
    disc(ctx, shade('#8d7f6a', 0.1 + night * 0.5), tx, ty, r);
    ctx.strokeStyle = shade('#5f5445', 0.2 + night * 0.4); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.stroke();
    disc(ctx, shade('#a8967c', 0.1 + night * 0.4), tx - r * 0.28, ty - r * 0.28, r * 0.4);
  } else {
    smallBox(ctx, b.x + b.w * 0.12, b.y + b.h * 0.14, Math.min(22, b.w * 0.24), Math.min(16, b.h * 0.2), shade(roof, 0.35));
    smallBox(ctx, b.x + b.w * 0.52, b.y + b.h * 0.54, Math.min(28, b.w * 0.3), Math.min(14, b.h * 0.18), shade(roof, 0.45));
  }
}

function drawSigns(ctx, world, night, view) {
  const glow = night > 0.3;
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const sign of world.signs) {
    if (!inView(view, sign.x, sign.y, 120)) continue;
    // a short plate over the shopfront, never wider than the building it names
    const width = Math.max(40, Math.min(sign.w, ctx.measureText(sign.text).width + 12));
    const height = 13, x = sign.x - width / 2, y = sign.y;
    ctx.save();
    ctx.shadowColor = sign.color; ctx.shadowBlur = glow ? 12 : 7; ctx.globalAlpha = glow ? 0.55 : 0.3;
    rect(ctx, sign.color, x + 2, y + 2, width - 4, height - 4);
    ctx.restore();
    rect(ctx, 'rgba(12,14,18,0.94)', x, y, width, height);
    frame(ctx, sign.color, x + 0.5, y + 0.5, width - 1, height - 1, 1);
    ctx.save();
    ctx.globalAlpha = 0.95; ctx.shadowColor = sign.color; ctx.shadowBlur = glow ? 8 : 0;
    ctx.fillStyle = sign.color; ctx.fillText(sign.text, sign.x, y + height / 2 + 1, width - 8);
    ctx.restore();
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function drawPalms(ctx, world, night, t, view) {
  const crown = shade(PALETTE.palm, night * 0.55), dark = shade(PALETTE.palmDark, night * 0.5);
  const trunk = shade(PALETTE.trunk, night * 0.5);
  for (const palm of world.palms) {
    if (!inView(view, palm.x, palm.y, 60)) continue;
    const s = palm.s, sway = Math.sin(t * 1.2 + palm.phase) * 2 * s, arm = 10 * s, d = palm.dir || 's';
    // the crown leans into the block, so a street palm never hangs over a lane
    const nx = d === 'w' ? arm : d === 'e' ? -arm : 0, ny = d === 'n' ? arm : d === 's' ? -arm : 0;
    const tx = palm.x + nx + sway * 0.4, ty = palm.y + ny;
    ctx.strokeStyle = trunk; ctx.lineWidth = 2 * s + 0.6;
    ctx.beginPath(); ctx.moveTo(palm.x, palm.y);
    ctx.quadraticCurveTo(palm.x + nx * 0.5 + sway * 0.4, palm.y + ny * 0.5, tx, ty);
    ctx.stroke();
    for (let f = 0; f < 5; f += 1) {
      const angle = (f / 5) * Math.PI * 2 + palm.phase * 0.2;
      leaf(ctx, f % 2 ? crown : dark, tx + Math.cos(angle) * 7 * s, ty + Math.sin(angle) * 5 * s, 8 * s, 3.4 * s, angle);
    }
    disc(ctx, dark, tx, ty, 3 * s);
  }
}
