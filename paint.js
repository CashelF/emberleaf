// The painter. Everything in the valley is laid down as single marks of a brush ("dabs"),
// pinned to points in the world, over coarse flat-coloured shapes (the underpainting) so
// that nothing shows between them. There are no lights: each dab's colour is mixed once,
// when the world is built, and the shaders only add air, dusk and lamplight.
import * as THREE from "three";
import { clamp, smooth } from "./shared.js";

export const TAU = Math.PI * 2;
export const lerp = (a, b, t) => a + (b - a) * t;
// The most lamps that can light the valley at once.
export const LAMPS = 24;

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice(ix, iy, s) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x, y, s = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(lattice(ix, iy, s), lattice(ix + 1, iy, s), u),
    lerp(lattice(ix, iy + 1, s), lattice(ix + 1, iy + 1, s), u),
    v,
  );
}

export function fbm(x, y, s = 0, octaves = 4) {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += weight * vnoise(x, y, s + i * 17);
    total += weight;
    x *= 2.03;
    y *= 2.03;
    weight *= 0.5;
  }
  return sum / total;
}

// Noise with sharp crests, for a line of peaks.
export function ridged(x, s = 0, octaves = 4) {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += weight * (1 - Math.abs(2 * vnoise(x, 0.5, s + i * 13) - 1));
    total += weight;
    x *= 2.1;
    weight *= 0.5;
  }
  return sum / total;
}

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const ramp = (...hexes) => hexes.map(rgb);
const blend = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Each kind of thing has six mixes of paint, dark to light.
export const RAMPS = {
  maple: ramp(0x2a0a10, 0x5a1212, 0x8e1e14, 0xc43a18, 0xe8701e, 0xf8b83a),
  ginkgo: ramp(0x3a2a08, 0x6a4c0c, 0x9a7410, 0xc9a01a, 0xecc83a, 0xfbe98a),
  pine: ramp(0x07130f, 0x0d2118, 0x163424, 0x224a30, 0x32623a, 0x4c7e46),
  moss: ramp(0x141c12, 0x243018, 0x3a4a1e, 0x566624, 0x7a842c, 0xa6a43c),
  litter: ramp(0x3a1410, 0x6a2414, 0x9a3a16, 0xc45a1a, 0xe4862a, 0xf6b94a),
  stone: ramp(0x2a2a30, 0x44444a, 0x626266, 0x868684, 0xaaa89e, 0xd0ccb8),
  verm: ramp(0x2a0d10, 0x4a1414, 0x7a1e18, 0xa82c1c, 0xd04422, 0xf0703a),
  slate: ramp(0x14141c, 0x22222e, 0x343444, 0x4c4c5c, 0x6c6c78, 0x9a9aa0),
  bark: ramp(0x0c0808, 0x1a1010, 0x2a1a18, 0x402a22, 0x5a3e30, 0x7a5a44),
  mist: ramp(0x2a3040, 0x3c4658, 0x566476, 0x788894, 0xa2aeb0, 0xccd4cc),
  sky: ramp(0x4a4860, 0x7a6c78, 0xa8928a, 0xd2b898, 0xecd9b2, 0xfbf1d4),
  cloud: ramp(0x6a6070, 0x94808a, 0xbca498, 0xdcc4a8, 0xf2e2c0, 0xfff8e0),
  gold: ramp(0x3a2a08, 0x7a5a10, 0xb08a1a, 0xdcb43a, 0xf4d870, 0xfff2b0),
  straw: ramp(0x4a3a1a, 0x7a6230, 0xa88a48, 0xcdb068, 0xe6d090, 0xf8ecc0),
  paper: ramp(0x8a1a10, 0xc03018, 0xe85a20, 0xff8a3a, 0xffc070, 0xfff0c0),
  skin: ramp(0x2a120c, 0x5a2e1c, 0x8a4a2c, 0xb46c40, 0xd49260, 0xeab888),
  plaster: ramp(0x5a5248, 0x857a68, 0xb0a48a, 0xd2c6a8, 0xece2c8, 0xfbf5e2),
  bone: ramp(0x3c3524, 0x6a5f44, 0x978a66, 0xbfb38a, 0xe0d6b0, 0xf8f2d8),
  // The white fox: white with a cold shadow, to stand apart from the warm valley.
  snow: ramp(0x5a6488, 0x8c96b4, 0xb6c0d8, 0xd8deec, 0xf0f2f8, 0xffffff),
  ash: ramp(0x101014, 0x1e1e26, 0x30303c, 0x484858, 0x666678, 0x8c8ca0),
};

// The colour of a ramp for t in 0..1. A dab is one mix or the next, seldom between.
export function tone(rampOrName, t) {
  const list = typeof rampOrName === "string" ? RAMPS[rampOrName] : rampOrName;
  const f = clamp(t) * (list.length - 1);
  const i = Math.min(list.length - 2, Math.floor(f));
  return blend(list[i], list[i + 1], smooth(0.25, 0.75, f - i));
}

// Six mixes round one colour, for a robe.
export function rampOf(hex) {
  const base = rgb(hex);
  const dark = [0.07, 0.04, 0.1];
  const light = [1, 0.95, 0.82];
  return [blend(base, dark, 0.8), blend(base, dark, 0.56), blend(base, dark, 0.3), base, blend(base, light, 0.28), blend(base, light, 0.55)];
}

/* The brush: a sheet of eight marks, made in code.
     0 long stroke that runs dry    1 long stroke with a bend    2 pressed dab     3 stub
     4 leaf                         5 lobed leaf                 6 blade of grass  7 plain
   In the texture: r is where a lighter mix was streaked in, g how thick the paint lies along
   each bristle, b the light raking across that thickness, a the mark itself. */
const CELL = 256;
const COLS = 4;
const ROWS = 2;

function makeBrushSheet() {
  const width = CELL * COLS;
  const height = CELL * ROWS;
  const canvases = [0, 1].map(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext("2d", { willReadFrequently: true });
  });
  const [mask, thick] = canvases;
  thick.fillStyle = "#808080";
  thick.fillRect(0, 0, width, height);
  const R = seeded(77);
  const rr = (a, b) => a + (b - a) * R();
  const origin = (i) => [(i % COLS) * CELL, Math.floor(i / COLS) * CELL];
  const gray = (v) => `rgb(${v},${v},${v})`;

  // A mark drawn bristle by bristle. `dry` is how ragged its far end is, `bend` how far it
  // curves, and `inset` how much shorter than the cell it is.
  function bristled(i, { dry = 0, bend = 0, inset = 0 }) {
    const [ox, oy] = origin(i);
    const pad = 22;
    const count = 40;
    const span = (CELL - pad * 2) * (1 - Math.abs(bend) * 0.45);
    const top = oy + (CELL - span) / 2;
    const lineWidth = (span / count) * 2.1;
    for (let k = 0; k < count; k += 1) {
      const v = (k + 0.5) / count;
      const edge = 1 - Math.pow(Math.sin(v * Math.PI), 0.4);
      const x0 = ox + pad + inset + edge * rr(10, 50) + rr(0, 8);
      const x1 = ox + CELL - pad - inset - edge * rr(14, 64) - R() * R() * dry * 100;
      const shade = Math.round(60 + R() * 170);
      for (const [g, style] of [[mask, "#fff"], [thick, gray(shade)]]) {
        g.strokeStyle = style;
        g.lineWidth = lineWidth;
        g.lineCap = "round";
        g.beginPath();
        for (let step = 0; step <= 14; step += 1) {
          const u = step / 14;
          const x = lerp(x0, x1, u);
          const y = top + v * span + bend * span * 0.5 * (1 - 4 * (u - 0.5) * (u - 0.5)) + Math.sin(u * 9 + k) * 0.8;
          if (step) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
      // Where the brush runs dry, the bristles skip.
      mask.globalCompositeOperation = "destination-out";
      for (let gap = 0; gap < 3; gap += 1) {
        if (R() > dry * 0.8) continue;
        const u = rr(0.5, 0.98);
        const x = lerp(x0, x1, u);
        const y = top + v * span + bend * span * 0.5 * (1 - 4 * (u - 0.5) * (u - 0.5));
        mask.lineWidth = lineWidth * 0.8;
        mask.beginPath();
        mask.moveTo(x, y);
        mask.lineTo(x + rr(6, 30), y);
        mask.stroke();
      }
      mask.globalCompositeOperation = "source-over";
    }
  }

  // A mark with a drawn outline, given as points in 0..1 of the cell.
  function shaped(i, points, rib) {
    const [ox, oy] = origin(i);
    for (const [g, style] of [[mask, "#fff"], [thick, gray(150)]]) {
      g.fillStyle = style;
      g.beginPath();
      points.forEach(([x, y], k) => (k ? g.lineTo(ox + x * CELL, oy + y * CELL) : g.moveTo(ox + x * CELL, oy + y * CELL)));
      g.closePath();
      g.fill();
    }
    // Thickness: a few streaks along the mark, and the rib of a leaf.
    thick.save();
    thick.beginPath();
    points.forEach(([x, y], k) => (k ? thick.lineTo(ox + x * CELL, oy + y * CELL) : thick.moveTo(ox + x * CELL, oy + y * CELL)));
    thick.clip();
    for (let k = 0; k < 26; k += 1) {
      thick.strokeStyle = gray(Math.round(90 + R() * 130));
      thick.lineWidth = rr(3, 9);
      const y = oy + rr(0.1, 0.9) * CELL;
      thick.beginPath();
      thick.moveTo(ox, y);
      thick.lineTo(ox + CELL, y + rr(-18, 18));
      thick.stroke();
    }
    if (rib) {
      thick.strokeStyle = gray(60);
      thick.lineWidth = 5;
      thick.beginPath();
      thick.moveTo(ox + 0.12 * CELL, oy + 0.5 * CELL);
      thick.lineTo(ox + 0.88 * CELL, oy + 0.5 * CELL);
      thick.stroke();
    }
    thick.restore();
  }

  const oval = (wide, lobes) => {
    const points = [];
    for (let k = 0; k < 48; k += 1) {
      const a = (k / 48) * TAU;
      // Pointed at both ends, like a leaf.
      const pinch = Math.pow(Math.abs(Math.sin(a)), 0.75) * Math.sign(Math.sin(a));
      const wave = lobes ? 1 + 0.2 * Math.cos(a * lobes) : 1;
      points.push([0.5 + Math.cos(a) * 0.4 * wave, 0.5 + pinch * wide * wave]);
    }
    return points;
  };

  bristled(0, { dry: 1 });
  bristled(1, { dry: 0.6, bend: 0.5 });
  bristled(2, { dry: 0.15, inset: 34 });
  bristled(3, { dry: 0.5, inset: 12 });
  shaped(4, oval(0.22, 0), true);
  shaped(5, oval(0.3, 5), true);
  shaped(6, [[0.08, 0.36], [0.5, 0.4], [0.93, 0.5], [0.5, 0.6], [0.08, 0.64]], false);
  shaped(7, [[0.1, 0.2], [0.9, 0.2], [0.94, 0.5], [0.9, 0.8], [0.1, 0.8], [0.06, 0.5]], false);

  const a = mask.getImageData(0, 0, width, height).data;
  const t = thick.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height * 4);
  const at = (x, y) => {
    const i = (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
    return (t[i] / 255) * (a[i + 3] / 255);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = Math.round(fbm(x * 0.035, y * 0.012, 5, 3) * 255);
      data[i + 1] = t[i];
      data[i + 2] = Math.round(clamp(0.5 + (at(x - 2, y - 2) - at(x + 2, y + 2)) * 1.6) * 255);
      data[i + 3] = a[i + 3];
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// The kinds of dab. Each has a least and a most size on the picture, along the stroke, in
// reference pixels (REFERENCE of them span the picture's short side). A dab that would be
// smaller than its least stays that size while only a share of its fellows stay with it; one
// that would be larger than its most stops growing as the eye comes near. So every stroke
// on the picture is within sight of the same size, as on a canvas. 0 means no bound.
export const K = { SOLID: 0, GROUND: 1, LEAF: 2, BLADE: 3, FAR: 4, SKY: 5, FIGURE: 6, LITTER: 7 };
const BOUNDS = [[2.6, 0], [3, 0], [3, 58], [3.6, 100], [0, 0], [0, 0], [2.4, 0], [2.2, 40]];
export const REFERENCE = 270;
// One reference pixel at one metre, for the narrowest view the game uses. Batches are put in
// order with it, so that those drawn are never fewer than the shader will keep.
const NARROW = (2 * Math.tan((66 * Math.PI) / 360)) / REFERENCE;

// Uniforms shared by every painted material.
export const shared = {
  uTime: { value: 0 },
  // The way the wind blows over the ground (x, z), and how hard a gust is blowing.
  uWind: { value: new THREE.Vector2(0.92, 0.39) },
  uGust: { value: 0 },
  // The size of one reference pixel at a distance of one metre, set when the picture is sized.
  uPixel: { value: NARROW },
  uKinds: { value: BOUNDS.map(([least, most]) => new THREE.Vector2(least, most)) },
  // The most depth a lying dab is stepped toward the eye, so that overlapping ones never flicker.
  uDepthStep: { value: 6e-6 },
  // A lying dab is stood up to face the eye when the eye looks along its surface: fully below x
  // (the sine of the angle between them), not at all above y.
  uStand: { value: new THREE.Vector2(0.07, 0.28) },
  uImpasto: { value: 0.16 },
  uSunMul: { value: new THREE.Vector3(1.05, 1.01, 0.93) },
  uShadeMul: { value: new THREE.Vector3(0.68, 0.64, 0.72) },
  uShadeAdd: { value: new THREE.Vector3(0.01, 0.006, 0.02) },
  // Mist between the eye and a thing: its colour, how fast it thickens, and the most of it.
  uHaze: { value: new THREE.Vector3(0.863, 0.804, 0.706) },
  uHazeDensity: { value: 0.0042 },
  uHazeMost: { value: 0.84 },
  // Night: 0 by day, 1 at night, and what the paint is multiplied by then.
  uDusk: { value: 0 },
  uNight: { value: new THREE.Vector3(0.25, 0.3, 0.5) },
  uNightAdd: { value: new THREE.Vector3(0.012, 0.014, 0.032) },
  uSkyNight: { value: new THREE.Vector3(0.13, 0.15, 0.32) },
  // Lamps: xyz is where each stands and w how bright it is.
  uLamps: { value: Array.from({ length: LAMPS }, () => new THREE.Vector4()) },
  uLampCount: { value: 0 },
  uLamp: { value: new THREE.Vector3(1.5, 0.92, 0.42) },
  tBrush: { value: null },
};

// Sun and shade, night, lamplight and mist, for dabs and underpainting alike.
const AIR = /* glsl */ `
  uniform vec3 uSunMul;
  uniform vec3 uShadeMul;
  uniform vec3 uShadeAdd;
  uniform vec3 uHaze;
  uniform float uHazeDensity;
  uniform float uHazeMost;
  uniform float uDusk;
  uniform vec3 uNight;
  uniform vec3 uNightAdd;
  uniform vec3 uSkyNight;
  uniform vec4 uLamps[${LAMPS}];
  uniform int uLampCount;
  uniform vec3 uLamp;

  vec3 air(vec3 paint, vec3 P, float shade, float glow, float sky) {
    vec3 c = mix(paint * uSunMul, paint * uShadeMul + uShadeAdd, shade);
    vec3 night = mix(c * uNight + uNightAdd, c * uSkyNight, sky);
    c = mix(c, night, uDusk * (1.0 - glow));
    float lamp = 0.0;
    for (int i = 0; i < ${LAMPS}; i++) {
      if (i >= uLampCount) break;
      vec3 d = P - uLamps[i].xyz;
      float d2 = dot(d, d);
      lamp += uLamps[i].w / (1.0 + d2 * 0.16) * smoothstep(196.0, 30.0, d2);
    }
    c += paint * uLamp * lamp * (0.16 + 0.84 * uDusk) * (1.0 - sky) * (1.0 - glow);
    float far = distance(P, cameraPosition);
    return mix(c, uHaze, (1.0 - exp(-far * uHazeDensity)) * uHazeMost * (1.0 - sky));
  }
`;

const DAB_VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iSize;   // length, width, which mark, rank
  attribute vec4 iDir;    // the way the stroke runs, and how much the wind moves it
  attribute vec4 iNor;    // the surface a lying dab lies on, and a number of its own
  attribute vec4 iCol;    // paint, and whether it is in shade
  attribute vec4 iFlag;   // lies (or faces the eye), its kind, is sky, glows
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uGust;
  uniform float uPixel;
  uniform vec2 uKinds[8];
  uniform float uDepthStep;
  uniform vec2 uStand;
  varying vec2 vUv;
  varying vec3 vCol;
  ${AIR}

  void main() {
    vec3 P = (modelMatrix * vec4(iPos, 1.0)).xyz;
    // One reference pixel, in metres, where the dab is.
    float ref = distance(P, cameraPosition) * uPixel;
    vec2 bound = uKinds[int(iFlag.y * 255.0 + 0.5)];
    vec2 size = iSize.xy;
    // Too far to be seen at its least size: only the low ranks stay, grown to cover the rest.
    float need = bound.x * ref;
    if (size.x < need) {
      float q = (size.x * size.x) / (need * need);
      float keep = 1.0 - smoothstep(q * 0.7, q, iSize.w);
      if (keep <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      size *= (need / size.x) * keep;
    }
    // Nearer than its most size allows: it stops growing on the picture.
    if (bound.y > 0.0) size *= min(1.0, (bound.y * ref) / size.x);
    vec3 D = normalize(mat3(modelMatrix) * iDir.xyz);
    if (iDir.w > 0.0) {
      float along = dot(P.xz, uWind);
      float phase = iNor.w * 6.2832 + along * 0.21;
      float gust = 0.5 + 0.5 * sin(uTime * 0.31 - along * 0.045);
      float wave = sin(uTime * 1.9 + phase) * 0.6 + sin(uTime * 0.77 + phase * 1.7) * 0.4;
      P.xz += uWind * iDir.w * (0.05 + 0.2 * gust + uGust) * wave;
      P.y += iDir.w * 0.04 * wave * gust;
    }
    vec4 mv;
    if (iFlag.x < 0.5) {
      // Faces the eye, and runs along its direction as the eye sees it.
      mv = viewMatrix * vec4(P, 1.0);
      vec3 seen = mat3(viewMatrix) * D;
      float l = length(seen.xy);
      vec2 d = l > 0.001 ? seen.xy / l : vec2(0.0, 1.0);
      mv.xy += d * (position.x * size.x * max(l, 0.5)) + vec2(-d.y, d.x) * (position.y * size.y);
    } else {
      // Lies on its surface. Seen edge on, where it would thin to a sliver, it is stood up to
      // face the eye instead, so that far ground and walls are still brushwork on the picture.
      vec3 N = normalize(mat3(modelMatrix) * iNor.xyz);
      vec3 B = normalize(cross(N, D));
      float square = abs(dot(N, normalize(cameraPosition - P)));
      float stand = (1.0 - smoothstep(uStand.x, uStand.y, square)) * step(0.5, bound.x);
      // Stood up, it is a low stroke resting on the surface, so it hides no more than ankles.
      size.y *= 1.0 - 0.5 * stand;
      mv = viewMatrix * vec4(P + N * (0.025 + stand * size.y * 0.4), 1.0);
      vec3 lying = mat3(viewMatrix) * (D * (position.x * size.x) + B * (position.y * size.y));
      // A stood-up stroke on level ground runs level across the picture.
      vec3 seen = mat3(viewMatrix) * D;
      float level = abs(N.y);
      vec2 d = vec2(seen.x + (iNor.w - 0.5) * 0.5 * level, seen.y * (1.0 - 0.75 * level));
      float l = length(d);
      d = l > 0.001 ? d / l : vec2(1.0, 0.0);
      vec3 standing = vec3(d * (position.x * size.x) + vec2(-d.y, d.x) * (position.y * size.y), 0.0);
      mv.xyz += mix(lying, standing, stand);
    }
    gl_Position = projectionMatrix * mv;
    gl_Position.z -= iFlag.x * iNor.w * uDepthStep * gl_Position.w;
    vec2 st = vec2(uv.x, iNor.w > 0.5 ? uv.y : 1.0 - uv.y);
    vUv = (vec2(mod(iSize.z, ${COLS}.0), floor(iSize.z / ${COLS}.0)) + st) / vec2(${COLS}.0, ${ROWS}.0);
    vCol = air(iCol.rgb, P, iCol.a, iFlag.w, iFlag.z);
  }
`;

const DAB_FRAGMENT = /* glsl */ `
  uniform sampler2D tBrush;
  uniform float uImpasto;
  varying vec2 vUv;
  varying vec3 vCol;

  void main() {
    vec4 brush = texture2D(tBrush, vUv);
    float soft = max(fwidth(brush.a), 0.02);
    float a = smoothstep(0.5 - soft, 0.5 + soft, brush.a);
    if (a < 0.04) discard;
    vec3 c = vCol * (0.84 + 0.32 * brush.g);
    c += (brush.b - 0.5) * uImpasto;
    c = mix(c, c * 1.16 + 0.02, smoothstep(0.58, 0.8, brush.r));
    gl_FragColor = vec4(c, a);
  }
`;

const UNDER_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute vec3 aAir;    // in shade, glows, is sky
  varying vec3 vCol;
  ${AIR}

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vCol = air(aColor, world.xyz, aAir.x, aAir.y, aAir.z);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const UNDER_FRAGMENT = /* glsl */ `
  varying vec3 vCol;
  void main() {
    gl_FragColor = vec4(vCol, 1.0);
  }
`;

let dabMaterial = null;
let underMaterial = null;

function materials() {
  if (dabMaterial) return;
  shared.tBrush.value = makeBrushSheet();
  dabMaterial = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: DAB_VERTEX,
    fragmentShader: DAB_FRAGMENT,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
  });
  underMaterial = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: UNDER_VERTEX,
    fragmentShader: UNDER_FRAGMENT,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
}

const quad = new THREE.PlaneGeometry(1, 1);

/** A batch of dabs drawn in one call. */
export class Dabs {
  constructor(seed = 1) {
    this.count = 0;
    this.capacity = 0;
    this.R = seeded(seed);
    this.grow(2048);
  }

  grow(capacity) {
    const fit = (Type, size, old) => {
      const next = new Type(capacity * size);
      if (old) next.set(old);
      return next;
    };
    this.pos = fit(Float32Array, 3, this.pos);
    this.size = fit(Float32Array, 4, this.size);
    this.dir = fit(Int8Array, 4, this.dir);
    this.nor = fit(Int8Array, 4, this.nor);
    this.col = fit(Uint8Array, 4, this.col);
    this.flag = fit(Uint8Array, 4, this.flag);
    this.capacity = capacity;
  }

  put(x, y, z, dx, dy, dz, nx, ny, nz, len, wid, mark, col, shade, sway, lies, kind, glow, thin) {
    if (this.count === this.capacity) this.grow(this.capacity * 2);
    const i = this.count++;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i * 4] = len;
    this.size[i * 4 + 1] = wid;
    this.size[i * 4 + 2] = mark;
    // Things nobody comes near are thinned when they are built: their ranks stop at `thin`.
    this.size[i * 4 + 3] = this.R() * thin;
    this.dir[i * 4] = Math.round((dx / l) * 127);
    this.dir[i * 4 + 1] = Math.round((dy / l) * 127);
    this.dir[i * 4 + 2] = Math.round((dz / l) * 127);
    this.dir[i * 4 + 3] = Math.round(clamp(sway) * 127);
    this.nor[i * 4] = Math.round(nx * 127);
    this.nor[i * 4 + 1] = Math.round(ny * 127);
    this.nor[i * 4 + 2] = Math.round(nz * 127);
    this.nor[i * 4 + 3] = Math.round(this.R() * 127);
    this.col[i * 4] = Math.round(clamp(col[0]) * 255);
    this.col[i * 4 + 1] = Math.round(clamp(col[1]) * 255);
    this.col[i * 4 + 2] = Math.round(clamp(col[2]) * 255);
    this.col[i * 4 + 3] = shade ? 255 : 0;
    this.flag[i * 4] = lies ? 255 : 0;
    this.flag[i * 4 + 1] = kind;
    this.flag[i * 4 + 2] = kind === K.SKY ? 255 : 0;
    this.flag[i * 4 + 3] = Math.round(clamp(glow) * 255);
  }

  /** a dab that turns to the eye and runs along (dx, dy, dz) */
  face(x, y, z, dx, dy, dz, len, wid, mark, col, shade = 0, sway = 0, kind = K.LEAF, glow = 0, thin = 1) {
    this.put(x, y, z, dx, dy, dz, 0, 1, 0, len, wid, mark, col, shade, sway, false, kind, glow, thin);
  }

  /** a dab that lies on the surface with normal (nx, ny, nz) and runs along (dx, dy, dz) */
  lie(x, y, z, dx, dy, dz, nx, ny, nz, len, wid, mark, col, shade = 0, kind = K.SOLID, glow = 0, thin = 1) {
    const n = Math.hypot(nx, ny, nz) || 1;
    nx /= n;
    ny /= n;
    nz /= n;
    const along = dx * nx + dy * ny + dz * nz;
    this.put(x, y, z, dx - nx * along, dy - ny * along, dz - nz * along, nx, ny, nz, len, wid, mark, col, shade, 0, true, kind, glow, thin);
  }

  // Puts the dabs in order of how far off each is last seen, farthest first, so that a
  // batch seen from a distance need only draw its first few. Returns those distances.
  sort() {
    const n = this.count;
    const vanish = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const least = BOUNDS[this.flag[i * 4 + 1]][0];
      vanish[i] = least ? this.size[i * 4] / (least * NARROW * Math.sqrt(Math.max(this.size[i * 4 + 3], 1e-5))) : Infinity;
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => vanish[b] - vanish[a]);
    const shuffle = (array, size) => {
      const next = new array.constructor(n * size);
      for (let i = 0; i < n; i += 1) for (let k = 0; k < size; k += 1) next[i * size + k] = array[order[i] * size + k];
      return next;
    };
    this.pos = shuffle(this.pos, 3);
    this.size = shuffle(this.size, 4);
    this.dir = shuffle(this.dir, 4);
    this.nor = shuffle(this.nor, 4);
    this.col = shuffle(this.col, 4);
    this.flag = shuffle(this.flag, 4);
    this.capacity = n;
    return Float32Array.from(order, (i) => vanish[i]);
  }

  mesh(sorted = false) {
    materials();
    const vanish = sorted ? this.sort() : null;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.attributes.position);
    geometry.setAttribute("uv", quad.attributes.uv);
    const n = this.count;
    const attribute = (name, array, size, normalized) =>
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array.subarray(0, n * size), size, normalized));
    attribute("iPos", this.pos, 3, false);
    attribute("iSize", this.size, 4, false);
    attribute("iDir", this.dir, 4, true);
    attribute("iNor", this.nor, 4, true);
    attribute("iCol", this.col, 4, true);
    attribute("iFlag", this.flag, 4, true);
    geometry.instanceCount = n;
    // The sphere the dabs lie in, so that batches behind the eye are skipped.
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < n; i += 1) box.expandByPoint(point.fromArray(this.pos, i * 3));
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    geometry.boundingSphere.radius += 8;
    const mesh = new THREE.Mesh(geometry, dabMaterial);
    mesh.userData.vanish = vanish;
    return mesh;
  }
}

/** The dabs of the still world, kept in batches by where they stand. */
export class Field {
  constructor(cell = 26) {
    this.cell = cell;
    this.batches = new Map();
    this.far = new Dabs(5);
  }

  at(x, z) {
    const key = Math.floor(x / this.cell) * 4096 + Math.floor(z / this.cell);
    let batch = this.batches.get(key);
    if (!batch) {
      batch = new Dabs(key);
      this.batches.set(key, batch);
    }
    return batch;
  }

  get count() {
    let total = this.far.count;
    for (const batch of this.batches.values()) total += batch.count;
    return total;
  }

  face(x, y, z, ...rest) {
    this.at(x, z).face(x, y, z, ...rest);
  }

  lie(x, y, z, ...rest) {
    this.at(x, z).lie(x, y, z, ...rest);
  }

  meshes() {
    this.near = [...this.batches.values()].filter((batch) => batch.count).map((batch) => batch.mesh(true));
    const list = [...this.near];
    if (this.far.count) {
      const far = this.far.mesh();
      far.frustumCulled = false;
      list.push(far);
    }
    return list;
  }

  /** Each batch draws only the dabs that can be seen from where the eye is. */
  update(eye) {
    // The order was worked out for the narrowest view; a wider one sees each dab from farther.
    const wider = NARROW / shared.uPixel.value;
    let drawn = 0;
    for (const mesh of this.near) {
      const sphere = mesh.geometry.boundingSphere;
      const nearest = Math.max(0, eye.distanceTo(sphere.center) - sphere.radius);
      const vanish = mesh.userData.vanish;
      // The first dab that is gone by this distance; they are in order, so all after it are too.
      let low = 0;
      let high = vanish.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (vanish[mid] * wider > nearest) low = mid + 1;
        else high = mid;
      }
      mesh.geometry.instanceCount = low;
      drawn += low;
    }
    return drawn;
  }
}

/** The underpainting: coarse shapes in flat colours, merged into one mesh. */
export class Under {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.airs = [];
    this.point = new THREE.Vector3();
  }

  vertex(x, y, z, col, shade = 0, glow = 0, sky = 0) {
    this.positions.push(x, y, z);
    this.colors.push(col[0], col[1], col[2]);
    this.airs.push(shade, glow, sky);
  }

  /** a geometry, moved by a matrix, in one colour */
  add(geometry, matrix, col, shade = 0, glow = 0, sky = 0) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = flat.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      this.point.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.vertex(this.point.x, this.point.y, this.point.z, col, shade, glow, sky);
    }
  }

  mesh() {
    materials();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("aAir", new THREE.Float32BufferAttribute(this.airs, 3));
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, underMaterial);
  }
}

export { AIR, clamp, smooth };
