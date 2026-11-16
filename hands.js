// The player's own hands: pixel sprites drawn over the painted world, a paper lantern in
// the left and a ringed staff in the right. They are drawn in code; there are no image files.
import * as THREE from "three";
import { clamp } from "./shared.js";

// Palettes run [outline, dark, mid, light].
const SKIN = ["#2a120c", "#8a4a2c", "#c47a4a", "#eaa878"];
const WOOD = ["#120a06", "#3a2414", "#6a4526", "#9a6e3e"];
const BAMBOO = ["#12100a", "#4a4420", "#8a8038", "#c4b860"];
const BRASS = ["#1a1206", "#6a4a12", "#b08424", "#f0cc5a"];
const PAPER = ["#3a0a08", "#a81c14", "#e0421e", "#ff8a3a"];
const CUFF = ["#3a2a08", "#c9a01a", "#fbe98a"];
const WIDE = 84;
const TALL = 150;

function px(g, x, y, w, h, colour) {
  g.fillStyle = colour;
  g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function pole(g, x0, y0, x1, y1, w, pal) {
  for (let y = y0; y >= y1; y -= 1) {
    const x = Math.round(x0 + ((x1 - x0) * (y0 - y)) / (y0 - y1 || 1));
    px(g, x - 1, y, w + 2, 1, pal[0]);
    px(g, x, y, w, 1, pal[2]);
    px(g, x, y, 1, 1, pal[3]);
    px(g, x + w - 1, y, 1, 1, pal[1]);
    if (y % 17 === 0) px(g, x + 1, y, w - 1, 1, pal[1]);
  }
}

// Four fingers wrapped round the shaft, each a rounded band, and the thumb laid over their ends.
function fist(g, x, y, pal, right) {
  const fingers = [[1, 17], [0, 19], [0, 18], [2, 14]];
  fingers.forEach((f, i) => px(g, x + f[0] - 1, y + i * 4 - 1, f[1] + 2, 6, pal[0]));
  px(g, x + 3, y + 16, 12, 4, pal[0]);
  px(g, x + 4, y + 16, 10, 3, pal[1]);
  px(g, x + 4, y + 16, 4, 3, pal[2]);
  fingers.forEach((f, i) => {
    const x0 = x + f[0];
    const yy = y + i * 4;
    const w = f[1];
    px(g, x0, yy, w, 4, pal[2]);
    px(g, x0 + 1, yy, w - 6, 1, pal[3]);
    px(g, x0, yy + 1, 2, 2, pal[3]);
    px(g, x0 + w - 5, yy, 5, 3, pal[1]);
    px(g, x0 + 1, yy + 3, w - 2, 1, pal[1]);
    for (const [cx, cy] of [[x0, yy], [x0 + w - 1, yy], [x0, yy + 3], [x0 + w - 1, yy + 3]]) px(g, cx, cy, 1, 1, pal[0]);
  });
  const tx = right ? x - 2 : x + 13;
  px(g, tx - 1, y - 2, 8, 12, pal[0]);
  px(g, tx, y - 1, 6, 10, pal[2]);
  px(g, tx, y - 1, 2, 9, pal[3]);
  px(g, tx + 4, y, 2, 9, pal[1]);
  px(g, tx + 1, y - 1, 4, 3, pal[3]);
  px(g, tx, y - 1, 1, 1, pal[0]);
  px(g, tx + 5, y - 1, 1, 1, pal[0]);
}

function sleeve(g, x, y, right, pal) {
  for (let r = 0; y + r < TALL; r += 1) {
    const w = Math.round(20 + r * 0.5);
    const xx = Math.round(right ? x - 1 + r * 0.25 : x - 1 - r * 0.75);
    for (let c = 0; c < w; c += 1) {
      const u = c / w;
      let colour;
      if (c === 0 || c === w - 1) colour = pal[0];
      else if (r < 6) colour = r === 0 || r === 5 ? CUFF[0] : u > 0.72 ? CUFF[0] : (c + r) % 4 === 0 ? CUFF[2] : CUFF[1];
      else {
        colour = u < 0.16 ? pal[3] : u < 0.42 ? ((c + r) & 1 ? pal[3] : pal[2]) : u < 0.68 ? pal[2] : u < 0.86 ? ((c + r) & 1 ? pal[2] : pal[1]) : pal[1];
        if ((c * 2 + r) % 14 === 0 && u > 0.1 && u < 0.9) colour = pal[1];
      }
      px(g, xx + c, y + r, 1, 1, colour);
    }
  }
}

function paperLantern(g, x, y) {
  px(g, x - 4, y - 3, 9, 3, BRASS[0]);
  px(g, x - 3, y - 3, 7, 1, BRASS[3]);
  for (let dy = -12; dy <= 12; dy += 1) {
    const half = Math.round(Math.sqrt(1 - (dy / 12.6) * (dy / 12.6)) * 11);
    const yy = y - 16 + dy;
    const rib = (dy + 12) % 4 === 0;
    px(g, x - half - 1, yy, half * 2 + 3, 1, PAPER[0]);
    px(g, x - half, yy, half * 2 + 1, 1, rib ? PAPER[1] : PAPER[2]);
    px(g, x - half, yy, Math.max(1, half * 0.6), 1, rib ? PAPER[2] : PAPER[3]);
    if (Math.abs(dy) < 7) px(g, x - 3, yy, 6, 1, rib ? PAPER[3] : "#fff3c0");
  }
  px(g, x - 4, y - 32, 9, 3, BRASS[0]);
  px(g, x - 3, y - 32, 7, 1, BRASS[3]);
  px(g, x, y - 36, 1, 4, BRASS[0]);
}

const hexOf = (c) => `#${c.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")).join("")}`;

// The four tones of a sleeve in the player's robe colour.
function sleeveTones(hex) {
  const base = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const to = (target, t) => hexOf(base.map((v, i) => v + (target[i] - v) * t));
  return [to([0.04, 0.02, 0.06], 0.86), to([0.06, 0.04, 0.1], 0.5), to([0, 0, 0], 0.12), to([1, 0.96, 0.84], 0.3)];
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  const fill = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  fill.addColorStop(0, "rgba(255,220,150,0.9)");
  fill.addColorStop(0.35, "rgba(255,150,60,0.4)");
  fill.addColorStop(1, "rgba(255,110,30,0)");
  g.fillStyle = fill;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function makeHands() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const sprite = () => {
    const canvas = document.createElement("canvas");
    canvas.width = WIDE;
    canvas.height = TALL;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false }));
    scene.add(mesh);
    return { g: canvas.getContext("2d"), texture, mesh };
  };
  const left = sprite();
  const right = sprite();
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }),
  );
  scene.add(glow);

  let scale = 4;
  let width = 1;
  let height = 1;

  function dress(hex) {
    const tones = sleeveTones(hex);
    left.g.clearRect(0, 0, WIDE, TALL);
    sleeve(left.g, 44, 97, false, tones);
    pole(left.g, 51, 96, 51, 40, 4, WOOD);
    paperLantern(left.g, 53, 40);
    fist(left.g, 44, 78, SKIN, false);
    right.g.clearRect(0, 0, WIDE, TALL);
    sleeve(right.g, 14, 101, true, tones);
    pole(right.g, 21, 100, 29, 16, 4, BAMBOO);
    for (const y of [34, 62, 88]) px(right.g, 27 - (y - 16) / 11, y, 7, 2, BAMBOO[0]);
    px(right.g, 27, 6, 8, 10, BRASS[0]);
    px(right.g, 28, 7, 6, 8, BRASS[2]);
    px(right.g, 28, 7, 2, 7, BRASS[3]);
    for (const [x, y] of [[23, 17], [35, 17], [21, 24]]) {
      px(right.g, x, y, 5, 5, BRASS[0]);
      px(right.g, x + 1, y + 1, 3, 3, BRASS[3]);
      px(right.g, x + 2, y + 2, 1, 1, BRASS[0]);
    }
    fist(right.g, 14, 82, SKIN, true);
    left.texture.needsUpdate = true;
    right.texture.needsUpdate = true;
  }

  function resize(w, h) {
    width = w;
    height = h;
    camera.right = w;
    camera.top = h;
    camera.updateProjectionMatrix();
    // Whole pixels, so that the sprites stay crisp.
    scale = Math.max(2, Math.round(Math.min(h / 190, w / 240)));
    left.mesh.scale.set(WIDE * scale, TALL * scale, 1);
    right.mesh.scale.set(WIDE * scale, TALL * scale, 1);
  }

  // `stride` is the phase of the walk, `walk` how fast (0..1), `rung`, `lifted` and `swung` the
  // seconds since the staff was rung, the lantern raised and the staff swung, and `night` how dark it is.
  function update(time, { stride, walk, rung, lifted, swung, night }) {
    const gap = clamp(width * 0.2, 46 * scale, 124 * scale);
    const snap = (v) => Math.round(v / scale) * scale;
    const breath = Math.sin(time * 1.4) * 0.8;
    // Both hands sway to the same side together, and each dips at the ends of its swing.
    const sway = snap(Math.sin(stride) * 2.6 * walk * scale);
    const ring = rung < 0.5 ? Math.sin(Math.min(1, rung / 0.32) * Math.PI) * 13 - (rung > 0.32 ? Math.sin(((rung - 0.32) / 0.18) * Math.PI) * 4 : 0) : 0;
    const lift = lifted < 0.9 ? Math.sin((lifted / 0.9) * Math.PI) * 12 : 0;
    const lx = width / 2 - gap + (WIDE / 2 - 53) * scale + sway;
    const ly = (TALL / 2 - 12) * scale + snap((breath - Math.abs(Math.cos(stride)) * 2.6 * walk + lift) * scale);
    left.mesh.position.set(Math.round(lx), Math.round(ly), 0);
    // The swing: the staff sweeps across from the right, turning about the fist, and comes back.
    const reach = swung < 0.16 ? swung / 0.16 : swung < 0.44 ? 1 - (swung - 0.16) / 0.28 : 0;
    const sweep = reach * reach * (3 - 2 * reach);
    const angle = sweep * 1.3;
    const rx = width / 2 + gap + (WIDE / 2 - 23) * scale + sway - sweep * gap * 1.15;
    const ry = (TALL / 2 - 14) * scale + snap((-breath * 0.8 - Math.abs(Math.cos(stride + 0.5)) * 2.6 * walk + ring) * scale) + sweep * 20 * scale;
    const px = (23 - WIDE / 2) * scale;
    const py = (TALL / 2 - 92) * scale;
    right.mesh.rotation.z = angle;
    right.mesh.position.set(
      Math.round(rx + px - (px * Math.cos(angle) - py * Math.sin(angle))),
      Math.round(ry + py - (px * Math.sin(angle) + py * Math.cos(angle))), 0,
    );
    const flicker = 1 + Math.sin(time * 9.1) * 0.05 + Math.sin(time * 23) * 0.03;
    glow.position.set(lx + (53 - WIDE / 2) * scale, ly + (TALL / 2 - 24) * scale, 0);
    glow.scale.setScalar((70 + 60 * night) * scale * flicker);
    glow.material.opacity = 0.42 + 0.4 * night;
  }

  dress(0x3d4f8f);
  return { scene, camera, dress, resize, update };
}
