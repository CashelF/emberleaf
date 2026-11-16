// The valley: its ground, and a painter for each kind of thing that stands in it.
// It is built once, when the page loads, from fixed seeds, so every player sees the same
// valley without the server sending any of it.
//
// The walk is laid out as a picture in depth. It starts in a sunken lane on a wooded ridge,
// with leaves close on both sides, so that the near paint sweeps past the eye. The lane looks
// down into the valley and across it to the shrine, which stands still while everything
// between slides apart.
import * as THREE from "three";
import { CENTER, GATES, HILL, LANTERNS, PAGODA, STAIRS, WORLD_R, clamp, pathX, ridgeAt, smooth } from "./shared.js";
import { AIR, Field, K, TAU, Under, fbm, lerp, seeded, shared, tone, vnoise } from "./paint.js";

// Where the light comes from: the upper left of the first view, and a little ahead.
export const SUN = new THREE.Vector3(-0.55, 0.62, -0.3).normalize();
const UP = [0, 1, 0];
const RISE = HILL.top / STAIRS.n;
const TREAD = (STAIRS.z0 - STAIRS.z1) / STAIRS.n;
// The forest on the ridge: from FOREST northward the wood thins out onto the valley floor.
const FOREST = 34;
// Small houses on the valley floor: x, z, width, depth.
const HUTS = [[-17, 13, 5.2, 4.4], [16.5, 3, 4.6, 4.6], [-21, -9, 5.6, 4.2], [20, -15, 4.8, 4.4], [-11, -17, 4.2, 4], [27, 18, 5, 4.4]];

const onSteps = (x, z) => Math.abs(x) < STAIRS.half && z <= STAIRS.z0 && z > STAIRS.z1;

/** the height of the ground at (x, z) */
export function ground(x, z) {
  if (onSteps(x, z)) {
    const f = (STAIRS.z0 - z) / (STAIRS.z0 - STAIRS.z1);
    return (HILL.top * (Math.floor(f * STAIRS.n) + 0.5)) / STAIRS.n;
  }
  const d = Math.hypot(x - HILL.x, z - HILL.z);
  const k = clamp((HILL.foot - d) / (HILL.foot - HILL.flat));
  const off = Math.abs(x - pathX(z));
  // Rolling ground, calmer along the path and gone on the hill.
  const calm = z > STAIRS.z0 - 2 ? 0.2 + 0.8 * smooth(1.5, 10, off) : 1;
  const roll = ((fbm(x * 0.018, z * 0.018, 3, 3) - 0.5) * 3.4 + (fbm(x * 0.07, z * 0.07, 9, 2) - 0.5) * 0.5) * calm;
  let h = roll * (1 - smooth(0, 0.25, k)) + (HILL.top * (k < 0.1 ? (k * k) / 0.2 : k - 0.05)) / 0.95;
  // The ridge the path comes down, and the banks of the lane it comes down in.
  h += ridgeAt(z) + 2.8 * smooth(2.4, 7.5, off) * smooth(FOREST, FOREST + 16, z);
  // Beyond where anyone walks the valley's rim climbs away.
  const r = Math.hypot(x - CENTER[0], z - CENTER[1]);
  if (r > WORLD_R + 6) h += Math.pow((r - WORLD_R - 6) * 0.075, 2);
  return h;
}

/** what the ground is made of at (x, z): 2 paving, 1 the worn verge of the path, 0 earth */
export function paved(x, z) {
  if (onSteps(x, z)) return 2;
  if (Math.abs(x) < STAIRS.half + 0.4 && z <= STAIRS.z1 && z > STAIRS.z1 - 3.5) return 2;
  if (Math.hypot(x - HILL.x, z - HILL.z) < 12.6) return 2;
  if (z > STAIRS.z0 && z < 76) {
    const d = Math.abs(x - pathX(z));
    const wide = 1.55 + (vnoise(z * 0.4, 3, 5) - 0.5) * 0.5;
    if (d < wide) return 2;
    if (d < wide + 0.9) return 1;
  }
  return 0;
}

/** how far (x, z) is from where people mostly walk: the path, the steps and the terrace */
export function reach(x, z) {
  let d = Math.max(0, Math.hypot(x - HILL.x, z - HILL.z) - 12.6);
  if (z > STAIRS.z0) d = Math.min(d, Math.hypot(x - pathX(Math.min(z, 76)), Math.max(0, z - 76)));
  else d = Math.min(d, Math.hypot(x, Math.max(0, STAIRS.z1 - z)));
  if (z > STAIRS.z0 - 4) d = Math.min(d, Math.hypot(x, z - STAIRS.z0));
  return d;
}

function glowTexture(stops) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  const fill = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach((colour, i) => fill.addColorStop([0, 0.25, 0.6, 1][i], `rgba(${colour})`));
  g.fillStyle = fill;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

const glowMaps = {};
/** a soft light, drawn over the picture where a lamp burns: warm, or `pale` like the moon */
export function makeGlow(scale, pale = false) {
  glowMaps[pale] ||= glowTexture(
    pale
      ? ["255,255,255,0.95", "190,214,255,0.42", "130,166,255,0.12", "120,150,255,0"]
      : ["255,236,170,1", "255,180,80,0.55", "255,120,40,0.16", "255,100,30,0"],
  );
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowMaps[pale], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  sprite.scale.setScalar(scale);
  return sprite;
}

/** Builds the whole valley into the scene. `Q` thins the paint for slower devices. */
export function buildWorld(scene, Q = 1) {
  const R = seeded(2026);
  const rr = (a, b) => a + (b - a) * R();
  const F = new Field();
  const U = new Under();
  // Things that cannot be walked through: circles { x, z, r } and boxes { x0, x1, z0, z1 }.
  const colliders = [];

  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const AXIS_Y = new THREE.Vector3(0, 1, 0);
  const at = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) =>
    matrix.compose(new THREE.Vector3(x, y, z), turn.setFromAxisAngle(AXIS_Y, ry), new THREE.Vector3(sx, sy, sz));
  const BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 7).toNonIndexed();
  const CONE = new THREE.CylinderGeometry(0.02, 0.5, 1, 7).toNonIndexed();
  const BALL = new THREE.IcosahedronGeometry(1, 1);
  const litOf = (nx, ny, nz) => (nx * SUN.x + ny * SUN.y + nz * SUN.z) * 0.5 + 0.5;
  // With less paint, each mark is larger, so that things stay covered.
  const grain = Math.sqrt(Q);
  const fromCentre = (x, z) => Math.hypot(x - CENTER[0], z - CENTER[1]);
  // How deep in the wood on the ridge a place is: 1 in the lane, 0 on the valley floor.
  const gloom = (z) => smooth(FOREST - 2, FOREST + 12, z);

  /* Shade. The sun casts each crown as a ragged round shadow, and a dab takes sun or shade whole. */
  const SHADE_CELL = 12;
  const shadows = new Map();
  const cellKey = (ix, iz) => ix * 4096 + iz;
  function cast(x, z, up, r) {
    const cx = x - (SUN.x / SUN.y) * up;
    const cz = z - (SUN.z / SUN.y) * up;
    for (let ix = Math.floor((cx - r) / SHADE_CELL); ix <= Math.floor((cx + r) / SHADE_CELL); ix += 1) {
      for (let iz = Math.floor((cz - r) / SHADE_CELL); iz <= Math.floor((cz + r) / SHADE_CELL); iz += 1) {
        const key = cellKey(ix, iz);
        if (!shadows.has(key)) shadows.set(key, []);
        shadows.get(key).push([cx, cz, r]);
      }
    }
  }
  function shadeAt(x, z) {
    // Under the wood on the ridge little sun reaches the ground.
    if (gloom(z) > vnoise(x * 0.35, z * 0.35, 19) * 1.25) return 1;
    const list = shadows.get(cellKey(Math.floor(x / SHADE_CELL), Math.floor(z / SHADE_CELL)));
    if (!list) return 0;
    const rag = 0.76 + 0.5 * vnoise(x * 0.7, z * 0.7, 13);
    for (const shadow of list) {
      const dx = x - shadow[0];
      const dz = z - shadow[1];
      if (dx * dx + dz * dz < shadow[2] * shadow[2] * rag * rag) return 1;
    }
    return 0;
  }

  /* Trees: where they stand is decided first, since the ground under them takes their leaves and shade. */
  const trees = [];
  const TREE_CELL = 10;
  const treeGrid = new Map();
  function clearGround(x, z) {
    if (z > STAIRS.z0 - 3 && Math.abs(x - pathX(z)) < (z > FOREST ? 5.6 : 4.6)) return false;
    // The view from the lane, down into the valley, is kept open.
    if (z > 14 && z <= FOREST + 6 && Math.abs(x + 1.2) < 6.5) return false;
    if (Math.abs(x) < 5.2 && z < STAIRS.z0 + 4 && z > STAIRS.z1 - 4) return false;
    if (Math.hypot(x - HILL.x, z - HILL.z) < 18.5) return false;
    for (const lantern of LANTERNS) if (Math.hypot(x - lantern[0], z - lantern[1]) < 2.6) return false;
    for (const hut of HUTS) if (Math.abs(x - hut[0]) < hut[2] / 2 + 3.4 && Math.abs(z - hut[1]) < hut[3] / 2 + 3.4) return false;
    return true;
  }
  function plant(x, z, kind, size, low = false) {
    const tree = { x, z, y: ground(x, z), kind, size };
    const far = fromCentre(x, z) - WORLD_R;
    if (kind === "pine") {
      tree.tall = (11 + R() * 5) * size;
      tree.crown = tree.tall * 0.2;
      tree.trunk = 0.24 * size;
      cast(x, z, tree.tall * 0.3, tree.crown * 0.9);
      cast(x, z, tree.tall * 0.62, tree.crown * 0.6);
    } else {
      const slim = kind === "ginkgo";
      tree.crown = (slim ? 2.5 + R() * 0.7 : 3.2 + R()) * size;
      tree.stem = (low ? 1.6 + R() * 0.8 : slim ? 3.6 + R() : 3 + R() * 1.4) * size;
      tree.lift = tree.stem + tree.crown * (slim ? 0.95 : 0.55);
      tree.trunk = 0.27 * size;
      cast(x, z, tree.lift, tree.crown * (slim ? 0.95 : 1.1));
    }
    // How long a leaf is: short where people come close to the tree, long where nobody does.
    const near = Math.max(0, Math.min(reach(x, z), Math.max(0, WORLD_R - fromCentre(x, z)) + 60) - tree.crown);
    tree.leaf = clamp(0.46 + near * 0.034, 0.46, 2.1) + Math.max(0, far) * 0.02;
    trees.push(tree);
    const key = cellKey(Math.floor(x / TREE_CELL), Math.floor(z / TREE_CELL));
    if (!treeGrid.has(key)) treeGrid.set(key, []);
    treeGrid.get(key).push(tree);
    if (far < 3) colliders.push({ x, z, r: tree.trunk + 0.3 });
  }
  function nearestTree(x, z) {
    let best = null;
    let bestD = Infinity;
    const ix = Math.floor(x / TREE_CELL);
    const iz = Math.floor(z / TREE_CELL);
    for (let a = ix - 1; a <= ix + 1; a += 1) {
      for (let b = iz - 1; b <= iz + 1; b += 1) {
        for (const tree of treeGrid.get(cellKey(a, b)) || []) {
          const d = Math.hypot(tree.x - x, tree.z - z) / tree.crown;
          if (d < bestD) {
            bestD = d;
            best = tree;
          }
        }
      }
    }
    return bestD < 1.2 ? best : null;
  }
  // The trees of the lane: close on both banks, their crowns low, with the sky between them.
  for (let z = 78, side = 1; z > FOREST + 2; z -= rr(5, 7), side = -side) {
    plant(pathX(z) + side * rr(6.2, 7.6), z + rr(-1, 1), R() < 0.3 ? "pine" : R() < 0.75 ? "maple" : "ginkgo", rr(1.25, 1.6), true);
    if (R() < 0.6) plant(pathX(z) - side * rr(6.6, 8.4), z + rr(-2, 2), R() < 0.4 ? "pine" : "maple", rr(1.1, 1.5), true);
  }
  for (let tries = 0; tries < 6400 && trees.length < 500; tries += 1) {
    const a = R() * TAU;
    const r = Math.sqrt(R()) * 124;
    const x = CENTER[0] + Math.cos(a) * r;
    const z = CENTER[1] + Math.sin(a) * r;
    if (!clearGround(x, z)) continue;
    // The ridge is thick with trees, more of them pines; the valley floor is open wood.
    const wood = gloom(z);
    const pick = R() + (fbm(x * 0.02, z * 0.02, 41, 2) - 0.5) * 0.9 + wood * 0.14;
    const kind = pick < 0.5 ? "maple" : pick < 0.74 ? "ginkgo" : "pine";
    const size = lerp(0.8, 1.35, R()) * (r > WORLD_R ? 1.2 : 1);
    const gap = r > WORLD_R ? 2.2 : lerp(3.1, 2.3, wood);
    let free = true;
    for (const tree of trees) {
      if (Math.hypot(tree.x - x, tree.z - z) < (size + tree.size) * gap) {
        free = false;
        break;
      }
    }
    if (free) plant(x, z, kind, size);
  }
  // The pagoda's own shadow.
  cast(PAGODA.x, PAGODA.z, 6, 9);
  cast(PAGODA.x, PAGODA.z, 15, 7);
  cast(PAGODA.x, PAGODA.z, 25, 5);

  /* Painters for hard shapes: each lays its underpainting and then strokes along the grain. */

  function boxed(cx, cy, cz, sx, sy, sz, rot, name, o = {}) {
    U.add(BOX, at(cx, cy, cz, sx, sy, sz, rot), tone(name, o.under ?? 0.3));
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const ax = [c, 0, -s];
    const az = [s, 0, c];
    const faces = [
      [ax, az, sz, UP, sy, sx / 2],
      [[-c, 0, s], az, sz, UP, sy, sx / 2],
      [az, ax, sx, UP, sy, sz / 2],
      [[-s, 0, -c], ax, sx, UP, sy, sz / 2],
      [UP, ax, sx, az, sz, sy / 2],
    ];
    const dl = o.len ?? 0.6;
    const dw = o.wid ?? 0.18;
    for (const [N, u, ul, v, vl, off] of faces) {
      const lit = litOf(N[0], N[1], N[2]);
      const along = N === UP || o.grain === "h" ? u : v;
      const count = Math.max(2, Math.round(((ul * vl) / (dl * dw)) * (o.cover ?? 2.1) * Q));
      for (let j = 0; j < count; j += 1) {
        const a = (R() - 0.5) * Math.max(0, ul - (along === u ? dl * 0.7 : dw * 0.6));
        const b = (R() - 0.5) * Math.max(0, vl - (along === v ? dl * 0.7 : dw * 0.6));
        const t = (o.t ?? 0.5) + (lit - 0.5) * 0.75 + (R() - 0.5) * 0.2;
        F.lie(
          cx + N[0] * off + u[0] * a + v[0] * b, cy + N[1] * off + u[1] * a + v[1] * b, cz + N[2] * off + u[2] * a + v[2] * b,
          along[0] + (R() - 0.5) * 0.16, along[1] + (R() - 0.5) * 0.16, along[2] + (R() - 0.5) * 0.16,
          N[0], N[1], N[2],
          Math.min(dl, (along === u ? ul : vl) * 0.95) * rr(0.7, 1.2), dw * rr(0.8, 1.2),
          o.mark ?? (R() < 0.5 ? 0 : 3), tone(name, t), lit < 0.4 ? 1 : 0,
        );
      }
    }
  }

  function cylinder(x, y0, z, r, h, name, o = {}) {
    U.add(CYL, at(x, y0 + h / 2, z, r * 1.92, h, r * 1.92), tone(name, o.under ?? 0.24));
    const dl = o.len ?? 0.8;
    const dw = o.wid ?? 0.2;
    const count = Math.max(3, Math.round(((TAU * r * h) / (dl * dw)) * (o.cover ?? 1.9) * Q));
    for (let j = 0; j < count; j += 1) {
      const a = R() * TAU;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const lit = litOf(nx, 0.15, nz);
      F.lie(
        x + nx * r, y0 + dl * 0.3 + R() * Math.max(0.01, h - dl * 0.6), z + nz * r,
        (R() - 0.5) * 0.2, 1, (R() - 0.5) * 0.2, nx, 0, nz,
        dl * rr(0.7, 1.25), dw * rr(0.8, 1.2), R() < 0.5 ? 0 : 3,
        tone(name, (o.t ?? 0.42) + (lit - 0.5) * 0.8 + (R() - 0.5) * 0.2), lit < 0.4 || o.shade ? 1 : 0,
      );
    }
  }

  // A four-sided roof from its eave (half-width `eave` at y0) up to `crown` half-width, `rise` higher.
  function roof(cx, y0, cz, eave, crown, rise, name, o = {}) {
    U.add(new THREE.CylinderGeometry(crown * Math.SQRT2, eave * Math.SQRT2, rise, 4, 1), at(cx, y0 + rise / 2, cz, 1, 1, 1, Math.PI / 4), tone(name, 0.22), 1);
    const run = eave - crown;
    const slope = Math.hypot(run, rise);
    const dl = o.len ?? 0.9;
    const dw = o.wid ?? 0.26;
    for (let k = 0; k < 4; k += 1) {
      const a = (k * Math.PI) / 2;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      // Under the eave: rafters running out from the wall.
      const wall = o.wall ?? 0;
      const under = Math.round((((eave - wall) * (eave + wall)) / (dl * dw)) * 1.5 * Q * (wall ? 1 : 0));
      for (let j = 0; j < under; j += 1) {
        const long = dl * rr(0.8, 1.3);
        const out = lerp(wall + long * 0.3, eave - long * 0.52, Math.sqrt(R()));
        const s = (R() * 2 - 1) * (out - dw);
        F.lie(cx + ox * out - oz * s, y0 - 0.01, cz + oz * out + ox * s, ox, 0, oz, 0, -1, 0, long, dw * rr(0.7, 1), 7, tone(R() < 0.6 ? "verm" : "bark", rr(0.16, 0.5)), 1);
      }
      const N = [(ox * rise) / slope, run / slope, (oz * rise) / slope];
      const lit = litOf(N[0], N[1], N[2]);
      const count = Math.round(((slope * (eave + crown)) / (dl * dw)) * 2.3 * Q);
      for (let j = 0; j < count; j += 1) {
        const v = R();
        const half = lerp(eave, crown, v);
        if (R() > half / eave) continue;
        const s = (R() * 2 - 1) * half;
        // The eave catches the light, and the tiles darken toward the ridge.
        const t = (o.t ?? 0.5) + (lit - 0.5) * 0.8 + (v < 0.1 ? 0.2 : 0) - v * 0.1 + (R() - 0.5) * 0.2;
        F.lie(
          cx + ox * half - oz * s, y0 + rise * v, cz + oz * half + ox * s,
          (ox * run) / slope + (R() - 0.5) * 0.2, -rise / slope, (oz * run) / slope + (R() - 0.5) * 0.2,
          N[0], N[1], N[2], dl * rr(0.7, 1.2), dw * rr(0.8, 1.2), R() < 0.6 ? 0 : 3, tone(name, t), lit < 0.42 ? 1 : 0,
        );
      }
    }
  }

  /* The ground */

  function paintGroundAt(x, z, cell) {
    const kind = paved(x, z);
    const y = ground(x, z);
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (!onSteps(x, z)) {
      nx = ground(x - 0.5, z) - ground(x + 0.5, z);
      nz = ground(x, z - 0.5) - ground(x, z + 0.5);
      // Beside the steps the slope is measured across a riser, which is no slope at all.
      if (Math.abs(nx) > 0.9 || Math.abs(nz) > 0.9) nx = nz = 0;
    }
    let name;
    let t;
    let angle = R() * TAU;
    let mark = R() < 0.4 ? 0 : R() < 0.5 ? 1 : 3;
    if (kind === 2) {
      // Paving is laid in courses: across the path, and round the terrace.
      name = "stone";
      t = 0.56 + (fbm(x * 0.5, z * 0.5, 7, 2) - 0.5) * 0.5 + (vnoise(x * 2.2, z * 2.2, 1) - 0.5) * 0.22;
      const dx = x - HILL.x;
      const dz = z - HILL.z;
      angle = (Math.hypot(dx, dz) < 12.6 && !onSteps(x, z) ? Math.atan2(dz, dx) + Math.PI / 2 : 0) + (R() - 0.5) * 0.3;
      mark = R() < 0.5 ? 7 : 3;
    } else {
      // Earth is moss or fallen leaves, and under a tree the leaves are that tree's.
      name = fbm(x * 0.06, z * 0.06, 21, 3) > 0.52 ? "litter" : "moss";
      const tree = nearestTree(x, z);
      if (tree && R() < 0.62) name = tree.kind === "ginkgo" ? "ginkgo" : tree.kind === "maple" ? "litter" : "bark";
      t = 0.44 + (fbm(x * 0.11, z * 0.11, 5, 3) - 0.5) * 0.9 + (R() - 0.5) * 0.16;
      if (kind === 1 && R() < 0.5) {
        name = "stone";
        t -= 0.1;
      }
    }
    F.lie(x, y, z, Math.cos(angle), 0, Math.sin(angle), nx, ny, nz, cell * rr(2.3, 3.4), cell * rr(0.8, 1.1), mark, tone(name, t), shadeAt(x, z), K.GROUND);
  }

  // Strokes are finest on the path and coarser away from it, where people seldom stand.
  // Each band: within `to` metres of where people walk, one stroke every `cell` metres.
  const BANDS = [
    { to: 3, cell: 0.15, wide: 13 },
    { to: 9, cell: 0.27, wide: 20 },
    { to: 24, cell: 0.46, wide: 36 },
    { to: Infinity, cell: 0.9, wide: 0 },
  ];
  let from = 0;
  for (const band of BANDS) {
    const cell = band.cell / grain;
    const all = band.to === Infinity;
    const x0 = all ? CENTER[0] - WORLD_R - 4 : -band.wide;
    const x1 = all ? CENTER[0] + WORLD_R + 4 : band.wide;
    const z0 = all ? CENTER[1] - WORLD_R - 4 : -104;
    const z1 = all ? CENTER[1] + WORLD_R + 4 : 80;
    for (let z = z0; z < z1; z += cell) {
      for (let x = x0; x < x1; x += cell) {
        if (fromCentre(x, z) > WORLD_R + 3) continue;
        const d = reach(x, z);
        if (d >= from && d < band.to) paintGroundAt(x + (R() - 0.5) * cell, z + (R() - 0.5) * cell, cell);
      }
    }
    from = band.to;
  }
  // Beyond the valley, a few broad strokes.
  for (let z = CENTER[1] - 132; z < CENTER[1] + 132; z += 2.3) {
    for (let x = CENTER[0] - 132; x < CENTER[0] + 132; x += 2.3) {
      const far = fromCentre(x, z) - WORLD_R;
      if (far >= 3 && far < 48) paintGroundAt(x + (R() - 0.5) * 2.3, z + (R() - 0.5) * 2.3, 2.3);
    }
  }

  // The underpainting of the ground: a coarse sheet a little below the paint.
  const groundTone = (x, z) => {
    if (fromCentre(x, z) > WORLD_R + 30) {
      const n = fbm(x * 0.03, z * 0.03, 33, 2);
      return tone(n < 0.4 ? "pine" : n > 0.62 ? "ginkgo" : "maple", 0.3);
    }
    if (paved(x, z) === 2) return tone("stone", 0.5);
    return tone(fbm(x * 0.06, z * 0.06, 21, 3) > 0.52 ? "litter" : "moss", 0.36);
  };
  const sheet = (x, z) => {
    // Under the steps the sheet is a ramp sunk below them.
    const y = Math.abs(x) < STAIRS.half + 0.2 && z <= STAIRS.z0 + 1 && z > STAIRS.z1 - 1 ? ground(STAIRS.half + 0.3, z) - 0.5 : ground(x, z);
    return y - 0.06;
  };
  const SHEET = 2.5;
  for (let z = CENTER[1] - 180; z < CENTER[1] + 180; z += SHEET) {
    for (let x = CENTER[0] - 180; x < CENTER[0] + 180; x += SHEET) {
      if (fromCentre(x + SHEET / 2, z + SHEET / 2) > 182) continue;
      const corners = [[x, z], [x + SHEET, z], [x + SHEET, z + SHEET], [x, z + SHEET]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [px, pz] = corners[k];
        U.vertex(px, sheet(px, pz), pz, groundTone(px, pz), shadeAt(px, pz));
      }
    }
  }

  // The steps: a block under each, a dark riser facing the valley, and light along its edge.
  for (let i = 0; i < STAIRS.n; i += 1) {
    const front = STAIRS.z0 - i * TREAD;
    const top = (HILL.top * (i + 0.5)) / STAIRS.n;
    U.add(BOX, at(0, top - 0.7, front - TREAD / 2, STAIRS.half * 2 + 0.3, 1.4, TREAD), tone("stone", 0.3));
    const count = Math.round(16 * Q);
    for (let j = 0; j < count; j += 1) {
      const x = (R() * 2 - 1) * (STAIRS.half - 0.2);
      F.lie(x, top - R() * RISE, front + 0.01, 1, 0, 0, 0, 0, 1, rr(0.4, 0.7), rr(0.12, 0.2), 7, tone("stone", rr(0.16, 0.36)), 1);
      if (j % 2) F.lie(x, top + 0.005, front - 0.1, 1, 0, 0, 0, 1, 0, rr(0.4, 0.8), rr(0.09, 0.14), 7, tone("stone", rr(0.8, 0.98)), shadeAt(x, front), K.GROUND);
    }
  }

  // Fallen leaves, thick along the path's edge and under the maples.
  for (let i = 0; i < 26000 * Q; i += 1) {
    let x;
    let z;
    let name;
    if (R() < 0.5) {
      z = rr(STAIRS.z0, 76);
      x = pathX(z) + (R() < 0.5 ? -1 : 1) * rr(0.2, 6) * R();
      name = R() < 0.7 ? "maple" : "ginkgo";
    } else {
      const tree = trees[Math.floor(R() * trees.length)];
      if (tree.kind === "pine" || fromCentre(tree.x, tree.z) > WORLD_R) continue;
      const a = R() * TAU;
      const r = Math.sqrt(R()) * tree.crown * 1.3;
      x = tree.x + Math.cos(a) * r + 2;
      z = tree.z + Math.sin(a) * r + 1;
      name = tree.kind;
    }
    if (fromCentre(x, z) > WORLD_R || onSteps(x, z)) continue;
    const a = R() * TAU;
    const len = rr(0.2, 0.42) * (reach(x, z) < 6 ? 1 : 1.5);
    const nx = ground(x - 0.4, z) - ground(x + 0.4, z);
    const nz = ground(x, z - 0.4) - ground(x, z + 0.4);
    F.lie(x, ground(x, z) + 0.01, z, Math.cos(a), 0, Math.sin(a), Math.abs(nx) > 0.7 ? 0 : nx, 0.8, Math.abs(nz) > 0.7 ? 0 : nz, len, len * rr(0.5, 0.7), R() < 0.5 ? 4 : 5, tone(name, rr(0.5, 0.98)), shadeAt(x, z), K.LITTER);
  }

  // Tufts of grass and fern on the earth, moved by the wind: most along the path's edge.
  function tuft(x, z) {
    if (paved(x, z) === 2 || (Math.abs(x) < STAIRS.half + 0.8 && z < STAIRS.z0 && z > STAIRS.z1)) return;
    const shade = shadeAt(x, z);
    const name = R() < 0.7 ? "moss" : R() < 0.5 ? "ginkgo" : "litter";
    for (let b = 0; b < 6; b += 1) {
      const bx = x + (R() - 0.5) * 0.5;
      const bz = z + (R() - 0.5) * 0.5;
      const len = rr(0.4, 0.95);
      const lx = (R() - 0.5) * 0.7;
      const lz = (R() - 0.5) * 0.7;
      const l = Math.hypot(lx, 1, lz);
      F.face(bx + (lx / l) * len * 0.5, ground(bx, bz) + (len * 0.5) / l, bz + (lz / l) * len * 0.5, lx, 1, lz, len, rr(0.07, 0.12), 6, tone(name, rr(0.4, 0.95)), shade, 0.6, K.BLADE);
    }
  }
  for (let i = 0; i < 3600 * Q; i += 1) {
    const a = R() * TAU;
    const r = Math.sqrt(R()) * (WORLD_R + 4);
    tuft(CENTER[0] + Math.cos(a) * r, CENTER[1] + Math.sin(a) * r);
  }
  for (let i = 0; i < 2300 * Q; i += 1) {
    const z = rr(STAIRS.z0, 78);
    tuft(pathX(z) + (R() < 0.5 ? -1 : 1) * rr(1.7, 6), z);
  }

  // Mossy rocks.
  for (let i = 0; i < 80; i += 1) {
    const a = R() * TAU;
    const r = Math.sqrt(R()) * (WORLD_R - 2);
    const x = CENTER[0] + Math.cos(a) * r;
    const z = CENTER[1] + Math.sin(a) * r;
    if (!clearGround(x, z) || paved(x, z)) continue;
    const size = rr(0.45, 1.5);
    const sy = size * rr(0.5, 0.8);
    const sz = size * rr(0.7, 1.2);
    const y = ground(x, z) + sy * 0.2;
    U.add(BALL, at(x, y, z, size * 0.94, sy * 0.94, sz * 0.94, R() * 3), tone("stone", 0.3));
    for (let j = 0; j < 90 * size * size * Q + 14; j += 1) {
      const b = R() * TAU;
      const up = rr(-0.15, 1);
      const flat = Math.sqrt(1 - up * up);
      const ux = Math.cos(b) * flat;
      const uz = Math.sin(b) * flat;
      const N = [ux / size, up / sy, uz / sz];
      const lit = litOf(...N.map((n) => n / Math.hypot(...N)));
      F.lie(x + ux * size, y + up * sy, z + uz * sz, -uz, 0.3, ux, N[0], N[1], N[2], rr(0.3, 0.6) * size, rr(0.14, 0.24) * size, R() < 0.5 ? 2 : 3, tone(up > 0.55 && R() < 0.6 ? "moss" : "stone", 0.2 + lit * 0.62 + (R() - 0.5) * 0.2), lit < 0.42 || shadeAt(x, z) ? 1 : 0);
    }
    if (size > 0.8) colliders.push({ x, z, r: size * 0.85 });
  }

  /* The gates over the path */
  for (const gate of GATES) {
    const gx = gate.z > STAIRS.z0 ? pathX(gate.z) : 0;
    const gy = ground(gx, gate.z);
    const { wide, tall, z } = gate;
    for (const side of [-1, 1]) {
      cylinder(gx + (side * wide) / 2, gy - 0.3, z, 0.27, tall + 0.3, "verm", { len: 0.9, wid: 0.17, t: 0.5 });
      cylinder(gx + (side * wide) / 2, gy - 0.2, z, 0.37, 0.62, "slate", { len: 0.4, wid: 0.14 });
      boxed(gx + side * (wide / 2 + 1.42), gy + tall + 0.56, z, 0.9, 0.2, 0.86, 0, "slate", { len: 0.5, wid: 0.14, grain: "h" });
      colliders.push({ x: gx + (side * wide) / 2, z, r: 0.5 });
    }
    boxed(gx, gy + tall * 0.78, z, wide + 1.5, 0.34, 0.3, 0, "verm", { len: 0.8, wid: 0.14, grain: "h" });
    boxed(gx, gy + tall + 0.1, z, wide + 2.6, 0.44, 0.5, 0, "verm", { len: 0.9, wid: 0.16, grain: "h" });
    boxed(gx, gy + tall + 0.42, z, wide + 3.1, 0.2, 0.86, 0, "slate", { len: 0.9, wid: 0.16, grain: "h" });
    boxed(gx, gy + tall * 0.89, z, 0.3, tall * 0.2, 0.24, 0, "verm", { len: 0.5, wid: 0.12 });
  }

  /* The stone lanterns. Each keeps its own pane and glow, which the game lights and puts out. */
  const lanterns = LANTERNS.map(([x, z], index) => {
    const y = ground(x, z);
    const rot = R() * 0.6;
    const stone = { len: 0.3, wid: 0.1, grain: "h", cover: 2 };
    boxed(x, y + 0.14, z, 0.78, 0.3, 0.78, rot, "stone", stone);
    cylinder(x, y + 0.28, z, 0.15, 0.98, "stone", { len: 0.36, wid: 0.1, cover: 2 });
    boxed(x, y + 1.3, z, 0.68, 0.13, 0.68, rot, "stone", stone);
    boxed(x, y + 1.57, z, 0.44, 0.44, 0.44, rot, "stone", { ...stone, t: 0.34 });
    roof(x, y + 1.78, z, 0.54, 0.07, 0.36, "stone", { len: 0.3, wid: 0.1 });
    cylinder(x, y + 2.1, z, 0.06, 0.16, "stone", { len: 0.14, wid: 0.06 });
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.25, 0.47), new THREE.MeshBasicMaterial({ color: 0x15100c }));
    pane.position.set(x, y + 1.57, z);
    pane.rotation.y = rot;
    const glow = makeGlow(3.4);
    glow.position.set(x, y + 1.6, z);
    glow.visible = false;
    scene.add(pane, glow);
    colliders.push({ x, z, r: 0.55 });
    return { index, x, y: y + 1.57, z, lit: false, until: 0, pane, glow };
  });

  /* The houses on the valley floor: pale walls under slate roofs, bright among the leaves */
  for (const [x, z, wide, deep] of HUTS) {
    const y = ground(x, z) - 0.2;
    boxed(x, y + 1.45, z, wide, 2.9, deep, 0, "plaster", { len: 0.7, wid: 0.2, t: 0.6 });
    for (let j = 0; j < 8 * Q + 2; j += 1) F.lie(x + (R() - 0.5) * 0.7, y + rr(0.5, 1.7), z + deep / 2 + 0.03, 0, 1, 0, 0, 0, 1, 1.5, 0.3, 7, tone("bark", rr(0.1, 0.3)), 1);
    roof(x, y + 2.75, z, Math.max(wide, deep) / 2 + 0.8, 0.3, 2.3, "slate", { wall: Math.min(wide, deep) / 2 });
    colliders.push({ x0: x - wide / 2, x1: x + wide / 2, z0: z - deep / 2, z1: z + deep / 2 });
    cast(x, z, 2.5, Math.max(wide, deep) * 0.7);
  }

  /* The pagoda: large enough to stand over the whole valley, and to be seen from the lane */
  {
    const { x, z } = PAGODA;
    const base = ground(x, z);
    boxed(x, base + 0.5, z, PAGODA.half * 2, 1, PAGODA.half * 2, 0, "stone", { len: 1, wid: 0.3, grain: "h" });
    boxed(x, base + 0.25, z + PAGODA.half + 0.6, 5, 0.5, 1.2, 0, "stone", { len: 0.9, wid: 0.26, grain: "h" });
    let y = base + 1;
    for (let tier = 0; tier < 5; tier += 1) {
      const half = 5.4 - 0.76 * tier;
      const tall = tier === 0 ? 4.8 : 3.6;
      boxed(x, y + tall / 2, z, half * 2, tall, half * 2, 0, "verm", { len: 1.2, wid: 0.3, t: 0.52 });
      // Dark doors and shutters on every side.
      for (let k = 0; k < 4; k += 1) {
        const a = (k * Math.PI) / 2;
        const ox = Math.cos(a);
        const oz = Math.sin(a);
        for (const across of [-0.56, 0, 0.56]) {
          for (let j = 0; j < 7 * Q + 1; j += 1) {
            const s = across * half + (R() - 0.5) * half * 0.22;
            F.lie(x + ox * (half + 0.03) - oz * s, y + tall * rr(0.3, 0.6), z + oz * (half + 0.03) + ox * s, 0, 1, 0, ox, 0, oz, tall * 0.52, half * 0.16, 7, tone("slate", rr(0.04, 0.2)), 1);
          }
        }
      }
      y += tall;
      const top = tier < 4;
      roof(x, y - 0.16, z, half + 3.1 - 0.16 * tier, top ? half - 0.36 : 0.08, top ? 1.8 : 4.4, "slate", { wall: half, len: 1.2, wid: 0.34 });
      y += top ? 1.15 : 4.1;
    }
    cylinder(x, y - 0.4, z, 0.14, 5.2, "gold", { len: 0.5, wid: 0.13, t: 0.6 });
    for (let ring = 0; ring < 4; ring += 1) cylinder(x, y + 0.7 + ring * 0.95, z, 0.58 - ring * 0.1, 0.14, "gold", { len: 0.4, wid: 0.1, t: 0.7 });
    colliders.push({ x0: x - PAGODA.half - 0.2, x1: x + PAGODA.half + 0.2, z0: z - PAGODA.half - 0.2, z1: z + PAGODA.half + 1.2 });
  }

  /* Leaves */

  // A lobe of leaves round (cx, cy, cz): a small dark ball, broad dark strokes over it so that it
  // never shows as a ball, and then the leaves, each lit by where it sits on the lobe and the crown.
  function lobe(cx, cy, cz, r, tall, name, other, leaf, heart, deep) {
    U.add(BALL, at(cx, cy, cz, r * 0.5, r * 0.5 * tall, r * 0.5), tone(name, 0.1), 1);
    for (let j = 0; j < 6; j += 1) {
      F.face(cx + rr(-0.25, 0.25) * r, cy + rr(-0.25, 0.25) * r * tall, cz + rr(-0.25, 0.25) * r, R() - 0.5, (R() - 0.5) * 0.6, R() - 0.5, r * rr(1.3, 1.7), r * rr(0.9, 1.2), 2, tone(name, rr(0.05, 0.16)), 1, 0.12, K.SOLID);
    }
    const count = Math.round(((24 * r * r) / (leaf * leaf)) * Q);
    for (let j = 0; j < count; j += 1) {
      const up = R() * 2 - 1;
      const a = R() * TAU;
      const flat = Math.sqrt(1 - up * up);
      const ux = Math.cos(a) * flat;
      const uz = Math.sin(a) * flat;
      const out = r * rr(0.6, 1.08);
      const px = cx + ux * out;
      const py = cy + up * out * tall;
      const pz = cz + uz * out;
      const gx = px - heart[0];
      const gy = py - heart[1];
      const gz = pz - heart[2];
      const g = Math.hypot(gx, gy, gz) || 1;
      const lit = 0.5 * litOf(ux, up, uz) + 0.5 * litOf(gx / g, gy / g, gz / g);
      const len = (leaf * rr(0.75, 1.3)) / grain;
      // Deep in the wood most leaves hang in shade, and only those turned to the sun catch it.
      const shade = lit < 0.34 || (deep > 0 && lit < 0.34 + deep * 0.4 && R() < 0.9) ? 1 : 0;
      F.face(
        px, py, pz, -uz + (R() - 0.5) * 0.8, -0.45 + (R() - 0.5) * 0.6, ux + (R() - 0.5) * 0.8,
        len, len * rr(0.42, 0.62), R() < 0.55 ? 4 : 5,
        tone(R() < 0.08 ? other : name, 0.26 + lit * 0.66 - deep * 0.34 * (1 - smooth(0.5, 0.78, lit)) + (R() - 0.5) * 0.24), shade, rr(0.3, 0.8), K.LEAF,
      );
    }
  }

  // Maples and ginkgos: leaves in lobes round a dark core.
  function paintBroadleaf(tree) {
    const { x, z, y, kind } = tree;
    const slim = kind === "ginkgo";
    cylinder(x, y - 0.4, z, tree.trunk, tree.stem + tree.crown * 0.5, "bark", { len: 0.95, wid: 0.22, cover: fromCentre(x, z) > WORLD_R ? 0.6 : 1.4, shade: shadeAt(x, z) });
    const cy = y + tree.lift;
    const lobes = [[0, 0, 0, 0.74]];
    for (let i = 0; i < 6; i += 1) {
      const a = R() * TAU;
      const d = tree.crown * rr(0.3, 0.62);
      lobes.push([Math.cos(a) * d, (R() - 0.4) * tree.crown * (slim ? 1.5 : 0.55), Math.sin(a) * d, rr(0.5, 0.7)]);
    }
    for (const [ox, oy, oz, k] of lobes) lobe(x + ox, cy + oy, z + oz, tree.crown * k, slim ? 1.2 : 1, kind, slim ? "maple" : "ginkgo", tree.leaf, [x, cy, z], gloom(z));
  }

  // Pines: boughs that hang outward in tiers.
  function paintPine(tree) {
    const { x, z, y, size, tall } = tree;
    const fine = clamp(tree.leaf / 0.9, 0.6, 2);
    cylinder(x, y - 0.4, z, tree.trunk, tall * 0.5, "bark", { len: 1, wid: 0.2, cover: fromCentre(x, z) > WORLD_R ? 0.5 : 1.2, shade: shadeAt(x, z) });
    U.add(CONE, at(x, y + tall * 0.59, z, tree.crown * 1.2, tall * 0.82, tree.crown * 1.2), tone("pine", 0.12));
    const deep = gloom(z);
    const tiers = 10;
    for (let k = 0; k < tiers; k += 1) {
      const f = (k + 0.5) / tiers;
      const wide = tree.crown * f * rr(0.85, 1.12);
      const count = Math.round(((11 + f * 30) * size * Q) / (fine * fine));
      for (let j = 0; j < count; j += 1) {
        const a = R() * TAU;
        const out = wide * rr(0.3, 1.05);
        const ox = Math.cos(a);
        const oz = Math.sin(a);
        const lit = litOf(ox * 0.8, 0.5, oz * 0.8);
        F.face(
          x + ox * out, y + tall - f * tall * 0.84 - (out / wide) * tall * 0.05 + (R() - 0.5) * 0.4, z + oz * out,
          ox * 0.75, -0.62, oz * 0.75, (rr(1.1, 1.8) * size * fine) / grain, (rr(0.3, 0.44) * size * fine) / grain, R() < 0.5 ? 0 : 3,
          tone("pine", 0.16 + lit * 0.66 - deep * 0.2 * (1 - smooth(0.55, 0.8, lit)) + (R() - 0.5) * 0.24), lit < 0.45 || (deep > 0 && lit < 0.7 && R() < 0.8) ? 1 : 0, 0.25, K.LEAF,
        );
      }
    }
  }

  for (const tree of trees) (tree.kind === "pine" ? paintPine : paintBroadleaf)(tree);

  // Bushes: low lobes of small leaves that anyone can walk through. They line the lane thickly,
  // so that leaves pass close by the eye, and stand here and there along the rest of the path.
  function bush(x, z, size) {
    if (paved(x, z) || fromCentre(x, z) > WORLD_R) return;
    const y = ground(x, z);
    const name = R() < 0.5 ? "pine" : R() < 0.7 ? "maple" : "ginkgo";
    const heart = [x, y + size * 0.8, z];
    const lobes = 2 + Math.floor(R() * 3);
    for (let i = 0; i < lobes; i += 1) {
      const a = R() * TAU;
      const d = size * rr(0, 0.7);
      lobe(x + Math.cos(a) * d, y + size * rr(0.45, 1.25), z + Math.sin(a) * d, size * rr(0.6, 0.95), 1, name, name === "pine" ? "moss" : "litter", rr(0.3, 0.42), heart, gloom(z) * 1.35);
    }
  }
  for (let z = 79; z > FOREST - 4; z -= rr(1.1, 1.8)) {
    for (const side of [-1, 1]) {
      bush(pathX(z) + side * rr(2.5, 4), z, rr(0.9, 1.5));
      if (R() < 0.75) bush(pathX(z) + side * rr(4.2, 8), z + rr(-1, 1), rr(1.2, 1.9));
    }
  }
  // Boughs that hang over the lane from either side, above the head, with the sky between them.
  for (let z = 80, side = 1; z > FOREST + 3; z -= rr(1.6, 2.8), side = -side) {
    const r = rr(1, 1.7);
    const x = pathX(z) + side * rr(1.9, 3.8);
    const y = ground(pathX(z), z) + 2.25 + r + rr(0, 1.3);
    lobe(x, y, z, r, 0.8, R() < 0.62 ? "maple" : R() < 0.6 ? "pine" : "ginkgo", "litter", rr(0.34, 0.5), [x, y + 1, z], 1.25);
  }
  for (let z = FOREST - 5; z > STAIRS.z0 + 3; z -= rr(3.5, 6.5)) {
    const side = R() < 0.5 ? -1 : 1;
    const off = rr(2.9, 4.6);
    bush(pathX(z) + side * off, z, rr(0.8, 1.35));
    if (R() < 0.5) bush(pathX(z) + side * (off + rr(1, 2)), z + rr(-1.5, 1.5), rr(0.8, 1.3));
  }
  for (const side of [-1, 1]) for (let z = STAIRS.z0 - 4; z > STAIRS.z1 + 4; z -= rr(4, 7)) bush(side * rr(3.2, 4.6), z, rr(0.8, 1.3));

  /* What lies beyond: the wooded rim, three ranges of hills in the mist, and the sky */

  for (let i = 0; i < 3000 * grain; i += 1) {
    const a = R() * TAU;
    const r = lerp(124, 180, Math.sqrt(R()));
    const x = CENTER[0] + Math.cos(a) * r;
    const z = CENTER[1] + Math.sin(a) * r;
    const n = fbm(x * 0.03, z * 0.03, 33, 2) + (R() - 0.5) * 0.3;
    const lit = R();
    F.far.face(
      x, ground(x, z) + rr(2, 6), z, R() - 0.5, -0.3, R() - 0.5, rr(7, 12), rr(4, 6.5), R() < 0.5 ? 4 : 5,
      tone(n < 0.4 ? "pine" : n > 0.62 ? "ginkgo" : "maple", 0.14 + lit * 0.7), lit < 0.4 ? 1 : 0, 0, K.FAR,
    );
  }

  const range = (radius, amp, seed, mix) => {
    const height = (a) => {
      const cx = Math.cos(a);
      const sz = Math.sin(a);
      const crest = 1 - Math.abs(2 * fbm(cx * 2.6 + 7, sz * 2.6 + 3, seed, 4) - 1);
      return 14 + amp * (0.35 + 0.65 * vnoise(cx * 1.4 + 3, sz * 1.4 + 3, seed + 5)) * crest * crest;
    };
    const col = tone("mist", mix);
    const steps = 200;
    for (let i = 0; i < steps; i += 1) {
      const a0 = (i / steps) * TAU;
      const a1 = ((i + 1) / steps) * TAU;
      const p = [a0, a1].map((a) => [CENTER[0] + Math.cos(a) * radius, CENTER[1] + Math.sin(a) * radius, height(a)]);
      for (const [k, y] of [[0, -40], [1, -40], [1, p[1][2]], [0, -40], [1, p[1][2]], [0, p[0][2]]]) U.vertex(p[k][0], y, p[k][1], col);
    }
    const scale = radius / 500;
    for (let i = 0; i < 1900 * grain; i += 1) {
      const a = R() * TAU;
      const top = height(a);
      const y = top * (1 - R() * R()) - 5 * scale;
      if (y < 0) continue;
      const faces = height(a + 0.02) - height(a - 0.02) < 0 ? 1 : -1;
      const tx = -Math.sin(a) * faces;
      const tz = Math.cos(a) * faces;
      const lit = tx * SUN.x + tz * SUN.z > 0;
      F.far.lie(
        CENTER[0] + Math.cos(a) * (radius - 2), y, CENTER[1] + Math.sin(a) * (radius - 2),
        tx * 0.6, -0.8, tz * 0.6, -Math.cos(a), 0.3, -Math.sin(a),
        rr(28, 50) * scale, rr(9, 14) * scale, R() < 0.5 ? 0 : 1,
        tone("mist", mix + (lit ? 0.16 : -0.12) + (R() - 0.5) * 0.14), lit ? 0 : 1, K.FAR,
      );
    }
  };
  range(400, 150, 11, 0.42);
  range(545, 230, 23, 0.5);
  range(720, 320, 37, 0.58);

  const skyAt = (dx, dy, dz) => {
    let c = tone("sky", 0.97 - Math.pow(clamp(dy), 0.72) * 0.82 + (fbm(dx * 2 + 5, dz * 2 + dy * 3, 61, 3) - 0.5) * 0.2);
    // Cloud in long level bands, lit from above.
    const cloud = (y) => fbm(dx * 2.6 + 11, dz * 2.6 + y * 9, 71, 4);
    const n = cloud(dy);
    const cover = smooth(0.5, 0.62, n);
    if (cover > 0) c = c.map((v, i) => lerp(v, tone("cloud", 0.34 + (n - 0.5) * 2 + (n - cloud(dy - 0.03)) * 5)[i], cover * 0.9));
    const sun = Math.pow(Math.max(0, dx * SUN.x + dy * SUN.y + dz * SUN.z), 7);
    return c.map((v, i) => lerp(v, [1, 0.97, 0.86][i], sun * 0.75));
  };
  const dome = new THREE.IcosahedronGeometry(1800, 4).attributes.position;
  const point = new THREE.Vector3();
  for (let i = 0; i < dome.count; i += 1) {
    point.fromBufferAttribute(dome, i);
    const d = point.clone().normalize();
    U.vertex(point.x + CENTER[0], point.y, point.z + CENTER[1], skyAt(d.x, Math.max(0.01, d.y), d.z), 0, 0, 1);
  }
  for (let i = 0; i < 2600 * grain; i += 1) {
    const dy = rr(0.015, 1);
    const a = R() * TAU;
    const flat = Math.sqrt(1 - dy * dy);
    const dx = Math.cos(a) * flat;
    const dz = Math.sin(a) * flat;
    F.far.face(
      CENTER[0] + dx * 1600, dy * 1600, CENTER[1] + dz * 1600, -Math.sin(a), (R() - 0.5) * 0.3, Math.cos(a),
      rr(190, 340), rr(48, 86), R() < 0.6 ? 0 : 1, skyAt(dx, dy, dz), 0, 0, K.SKY,
    );
  }

  scene.add(U.mesh(), ...F.meshes());

  /* Leaves on the wind: a box of them that follows the eye */
  const leafCount = Math.round(520 * Q);
  const leafGeometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  leafGeometry.index = quad.index;
  leafGeometry.setAttribute("position", quad.attributes.position);
  leafGeometry.setAttribute("uv", quad.attributes.uv);
  const bases = new Float32Array(leafCount * 3);
  const chances = new Float32Array(leafCount * 4);
  const paints = new Float32Array(leafCount * 3);
  for (let i = 0; i < leafCount; i += 1) {
    bases.set([rr(0, 56), rr(0, 26), rr(0, 56)], i * 3);
    chances.set([R(), R(), rr(0.2, 0.42), R()], i * 4);
    paints.set(tone(R() < 0.68 ? "maple" : "ginkgo", rr(0.5, 1)), i * 3);
  }
  leafGeometry.setAttribute("iBase", new THREE.InstancedBufferAttribute(bases, 3));
  leafGeometry.setAttribute("iChance", new THREE.InstancedBufferAttribute(chances, 4));
  leafGeometry.setAttribute("iPaint", new THREE.InstancedBufferAttribute(paints, 3));
  leafGeometry.instanceCount = leafCount;
  const leaves = new THREE.Mesh(
    leafGeometry,
    new THREE.ShaderMaterial({
      uniforms: shared,
      side: THREE.DoubleSide,
      alphaToCoverage: true,
      vertexShader: /* glsl */ `
        attribute vec3 iBase;
        attribute vec4 iChance;
        attribute vec3 iPaint;
        uniform float uTime;
        uniform vec2 uWind;
        varying vec2 vUv;
        varying vec3 vCol;
        ${AIR}
        void main() {
          vec3 box = vec3(56.0, 26.0, 56.0);
          float speed = 0.8 + iChance.y;
          vec3 p = iBase + vec3(uWind.x * speed * 1.5, -speed * 0.85, uWind.y * speed * 1.5) * uTime;
          p.x += sin(uTime * 1.3 + iChance.x * 6.28) * 0.8;
          p.z += cos(uTime * 1.1 + iChance.x * 4.0) * 0.8;
          p = mod(p - cameraPosition + box * 0.5, box) - box * 0.5 + cameraPosition;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float a = uTime * (1.5 + iChance.y * 2.5) + iChance.x * 6.28;
          vec2 q = position.xy * vec2(iChance.z, iChance.z * 0.55);
          mv.xy += vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
          gl_Position = projectionMatrix * mv;
          vUv = (vec2(iChance.w > 0.5 ? 0.0 : 1.0, 1.0) + uv) / vec2(4.0, 2.0);
          vCol = air(iPaint, p, 0.0, 0.0, 0.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tBrush;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          vec4 brush = texture2D(tBrush, vUv);
          float soft = max(fwidth(brush.a), 0.02);
          float a = smoothstep(0.5 - soft, 0.5 + soft, brush.a);
          if (a < 0.04) discard;
          gl_FragColor = vec4(vCol * (0.86 + 0.28 * brush.g), a);
        }
      `,
    }),
  );
  leaves.frustumCulled = false;
  scene.add(leaves);

  return {
    colliders, lanterns, dabs: F.count, trees: trees.length, drawn: 0,
    /** each batch of paint draws only what can be seen from where the eye is */
    update(eye) {
      this.drawn = F.update(eye);
    },
  };
}
