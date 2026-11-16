// Everyone who moves through the valley: the other pilgrims (a robe, a straw hat, a staff and a
// paper lantern), the creatures (leaf imps, and the ogres at the steps and the shrine), the white
// fox, and the paper lanterns that are let go into the sky.
// Each part of a figure is painted once and then moves as a whole, so the strokes stay on it
// as it walks. A figure is lit from straight above, which stays right as it turns.
import * as THREE from "three";
import { Dabs, K, TAU, Under, lerp, rampOf, seeded, tone } from "./paint.js";
import { MOB_KINDS, STANCE, clamp, smooth } from "./shared.js";
import { ground, makeGlow } from "./world.js";

const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const BALL = new THREE.IcosahedronGeometry(1, 1);
const BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

// The brushes a figure is painted with. Every size is in metres.
function painter(seed) {
  const R = seeded(seed * 7919 + 13);
  const rr = (a, b) => a + (b - a) * R();
  let batch = 0;
  const place = (x, y, z, sx, sy, sz) => matrix.compose(new THREE.Vector3(x, y, z), turn.identity(), new THREE.Vector3(sx, sy, sz));
  return {
    R,
    rr,
    place,
    // One part: its underpainting and its dabs, in a group of their own.
    part(build) {
      const dabs = new Dabs(seed * 31 + batch++);
      const under = new Under();
      build(dabs, under);
      const group = new THREE.Group();
      for (const mesh of [under.mesh(), dabs.mesh()]) {
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      return group;
    },
    // A turned shape, wide r0 at height y0 and r1 at y1, with strokes running down it.
    turned(dabs, under, y0, r0, y1, r1, ramp, light, count, o = {}) {
      under.add(new THREE.CylinderGeometry(r1 * 0.94, r0 * 0.94, y1 - y0, 9), place(o.x || 0, (y0 + y1) / 2, o.z || 0, 1, 1, 1), tone(ramp, light[0] * 0.7), 0, o.glow || 0);
      const slant = Math.hypot(r0 - r1, y1 - y0);
      for (let i = 0; i < count; i += 1) {
        const a = R() * TAU;
        const v = R();
        const r = r0 + (r1 - r0) * v;
        const nx = Math.cos(a);
        const nz = Math.sin(a);
        dabs.lie(
          (o.x || 0) + nx * r, y0 + (y1 - y0) * v, (o.z || 0) + nz * r,
          (nx * (r0 - r1)) / slant + (R() - 0.5) * 0.3, -(y1 - y0) / slant, (nz * (r0 - r1)) / slant + (R() - 0.5) * 0.3,
          (nx * (y1 - y0)) / slant, (r0 - r1) / slant, (nz * (y1 - y0)) / slant,
          (o.len || 0.3) * rr(0.7, 1.2), (o.wid || 0.09) * rr(0.8, 1.2), R() < 0.5 ? 0 : 3,
          tone(ramp, light[0] + (light[1] - light[0]) * v + (R() - 0.5) * 0.2), 0, K.FIGURE, o.glow || 0,
        );
      }
    },
    ball(dabs, under, x, y, z, sx, sy, sz, ramp, light, count, glow = 0) {
      under.add(BALL, place(x, y, z, sx * 0.9, sy * 0.9, sz * 0.9), tone(ramp, light[0] * 0.8), 0, glow);
      for (let i = 0; i < count; i += 1) {
        const up = R() * 2 - 1;
        const a = R() * TAU;
        const flat = Math.sqrt(1 - up * up);
        const ux = Math.cos(a) * flat;
        const uz = Math.sin(a) * flat;
        dabs.lie(
          x + ux * sx, y + up * sy, z + uz * sz, -uz, -0.4, ux, ux / sx, up / sy, uz / sz,
          Math.max(sx, sy) * rr(0.8, 1.3), Math.min(sx, sz) * rr(0.45, 0.7), 2,
          tone(ramp, light[0] + (light[1] - light[0]) * (up * 0.5 + 0.5) + (R() - 0.5) * 0.2), 0, K.FIGURE, glow,
        );
      }
    },
  };
}

/** a pilgrim in the given robe colour; it faces -z until it is turned */
export function makePilgrim(colour, seed) {
  const { R, rr, place, part, turned, ball } = painter(seed);
  const robe = rampOf(colour);
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  const body = part((dabs, under) => {
    turned(dabs, under, 0.06, 0.4, 1.3, 0.19, robe, [0.22, 0.62], 130);
    turned(dabs, under, 0.86, 0.282, 0.97, 0.252, robe, [0.08, 0.16], 16, { len: 0.2, wid: 0.06 });
    turned(dabs, under, 1.14, 0.31, 1.42, 0.12, robe, [0.55, 0.85], 34, { len: 0.22, wid: 0.08 });
    for (const side of [-1, 1]) ball(dabs, under, side * 0.31, 1.0, -0.05, 0.11, 0.26, 0.13, robe, [0.3, 0.7], 16);
    ball(dabs, under, 0, 1.5, 0, 0.13, 0.14, 0.13, "skin", [0.3, 0.6], 14);
    turned(dabs, under, 1.56, 0.47, 1.78, 0.02, "straw", [0.5, 0.95], 64, { len: 0.26, wid: 0.08 });
  });
  // The fox's mask, for whoever found the fox: white over the face, with dark eyes and red
  // marks, and its ears standing up through the hat. It stays pale in the dark.
  const mask = part((dabs, under) => {
    for (let i = 0; i < 14; i += 1) {
      dabs.lie(rr(-0.1, 0.1), 1.49 + rr(-0.1, 0.09), -0.15, R() - 0.5, 1, 0, 0, 0, -1, rr(0.11, 0.15), rr(0.07, 0.1), 2, tone("snow", rr(0.8, 1)), 0, K.FIGURE, 0.7);
    }
    for (const side of [-1, 1]) {
      dabs.lie(side * 0.058, 1.525, -0.162, 1, side * 0.5, 0, 0, 0, -1, 0.065, 0.026, 7, tone("slate", 0.02), 0, K.FIGURE);
      dabs.lie(side * 0.095, 1.45, -0.162, 1, -side * 0.7, 0, 0, 0, -1, 0.065, 0.022, 7, tone("verm", 0.8), 0, K.FIGURE, 0.4);
      // The ears stand well clear of the hat, so that the mask shows from behind too.
      turned(dabs, under, 1.6, 0.125, 1.93, 0.005, "snow", [0.72, 1], 18, { x: side * 0.18, z: -0.1, len: 0.17, wid: 0.08, glow: 0.7 });
      dabs.lie(side * 0.18, 1.78, -0.176, 0, 1, 0, 0, 0, -1, 0.13, 0.06, 7, tone("verm", 0.8), 0, K.FIGURE, 0.4);
    }
    dabs.lie(0, 1.585, -0.162, 0, 1, 0, 0, 0, -1, 0.055, 0.022, 7, tone("verm", 0.8), 0, K.FIGURE, 0.4);
  });
  mask.visible = false;
  body.add(mask);
  const staff = part((dabs, under) => {
    under.add(BOX, place(0, 0.98, 0, 0.04, 1.96, 0.04), tone("straw", 0.3));
    for (let i = 0; i < 22; i += 1) {
      const a = R() * TAU;
      dabs.lie(Math.cos(a) * 0.024, rr(0.1, 1.86), Math.sin(a) * 0.024, 0, 1, 0, Math.cos(a), 0, Math.sin(a), 0.3, 0.05, 7, tone("straw", rr(0.3, 0.8)), 0, K.FIGURE);
    }
    ball(dabs, under, 0, 1.98, 0, 0.05, 0.06, 0.05, "gold", [0.6, 1], 8);
    for (const y of [1.78, 1.84]) turned(dabs, under, y, 0.07, y + 0.03, 0.07, "gold", [0.7, 0.95], 6, { len: 0.08, wid: 0.03 });
  });
  staff.position.set(0.37, 0, -0.12);
  const lantern = part((dabs, under) => {
    under.add(BOX, place(0, -0.02, -0.13, 0.025, 0.025, 0.3), tone("bark", 0.3));
    under.add(BOX, place(0, -0.09, -0.27, 0.012, 0.14, 0.012), tone("bark", 0.2));
    ball(dabs, under, 0, -0.32, -0.27, 0.125, 0.165, 0.125, "paper", [0.45, 0.95], 30, 1);
    for (const y of [-0.16, -0.5]) turned(dabs, under, y, 0.06, y + 0.03, 0.06, "bark", [0.1, 0.3], 5, { len: 0.07, wid: 0.03, z: -0.27 });
  });
  lantern.position.set(-0.35, 1.04, -0.12);
  const glow = makeGlow(1.9);
  glow.position.set(0, -0.32, -0.27);
  lantern.add(glow);
  const feet = [-1, 1].map((side) => {
    const foot = part((dabs, under) => {
      under.add(BOX, place(0, 0.04, -0.03, 0.1, 0.08, 0.24), tone("bark", 0.2));
      for (let i = 0; i < 6; i += 1) dabs.lie(rr(-0.04, 0.04), 0.085, rr(-0.12, 0.06), 0, 0, 1, 0, 1, 0, 0.16, 0.06, 2, tone("bark", rr(0.2, 0.5)), 0, K.FIGURE);
    });
    foot.position.set(side * 0.13, 0, 0);
    return foot;
  });
  group.add(body, staff, lantern, ...feet);
  return { group, body, staff, lantern, feet, glow, mask, lamp: new THREE.Vector3() };
}

/**
 * Moves a pilgrim toward where the server last saw it, and walks it there.
 * `who` holds the figure and x, z, a (where it is), tx, tz, ta (where it is going), stride (the
 * phase of its walk), rung and swung (seconds since it rang or swung its staff) and down.
 */
export function animatePilgrim(who, dt, time) {
  const ease = 1 - Math.exp(-dt * 9);
  const dx = (who.tx - who.x) * ease;
  const dz = (who.tz - who.z) * ease;
  who.x += dx;
  who.z += dz;
  who.a += Math.atan2(Math.sin(who.ta - who.a), Math.cos(who.ta - who.a)) * (1 - Math.exp(-dt * 7));
  const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
  who.pace += (clamp(speed / 2.4) - who.pace) * (1 - Math.exp(-dt * 8));
  who.stride += speed * dt * 2.7;
  who.rung += dt;
  who.swung += dt;
  who.fallen += ((who.down ? 1 : 0) - who.fallen) * (1 - Math.exp(-dt * 7));
  const { group, body, staff, lantern, feet, glow } = who.figure;
  const walk = who.pace;
  const s = Math.sin(who.stride);
  const c = Math.cos(who.stride);
  group.position.set(who.x, ground(who.x, who.z) + who.fallen * 0.25, who.z);
  // Struck down, a pilgrim lies on their back until they start again.
  group.rotation.set(who.fallen * 1.45, who.a, 0);
  body.position.y = Math.abs(s) * 0.035 * walk;
  body.rotation.z = s * 0.035 * walk;
  body.rotation.x = -0.05 * walk;
  feet[0].position.set(-0.13, Math.max(0, c) * 0.07 * walk, -s * 0.17 * walk);
  feet[1].position.set(0.13, Math.max(0, -c) * 0.07 * walk, s * 0.17 * walk);
  // The staff is planted with each stride, lifted high to ring, and swept forward to strike.
  const ring = who.rung < 0.5 ? Math.sin(Math.min(1, who.rung / 0.34) * Math.PI) * 0.3 : 0;
  const sweep = who.swung < 0.36 ? Math.sin((who.swung / 0.36) * Math.PI) : 0;
  staff.position.set(0.37 - sweep * 0.3, Math.max(0, -c) * 0.06 * walk + ring + sweep * 0.5, -0.12 - sweep * 0.5);
  staff.rotation.x = s * 0.14 * walk - sweep * 1.5;
  lantern.rotation.z = Math.sin(who.stride * 0.5) * 0.1 * walk + Math.sin(time * 1.3 + who.id) * 0.03;
  lantern.rotation.x = c * 0.08 * walk;
  glow.material.opacity = 0.7 + Math.sin(time * 9 + who.id * 3) * 0.08;
  who.figure.lamp.set(0, -0.32, -0.27).applyMatrix4(lantern.matrixWorld);
}

/**
 * A creature of the given kind (see MOB_KINDS), facing -z until it is turned. An imp is a small
 * round thing in a cape of fallen leaves, with a pale mask, two leaves for ears and a club. An
 * ogre is the same made large, grey, in a red mask with horns.
 */
export function makeCreature(k, seed) {
  const { R, rr, place, part, turned, ball } = painter(seed + 400);
  const s = MOB_KINDS[k].size;
  const ogre = k === 1;
  const hide = ogre ? "ash" : "bark";
  const leaf = ogre ? "ginkgo" : "maple";
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  const body = part((dabs, under) => {
    ball(dabs, under, 0, 0.42 * s, 0, 0.27 * s, 0.31 * s, 0.25 * s, hide, [0.18, 0.6], 44);
    // The cape: leaves over the back and the shoulders.
    for (let i = 0; i < 34; i += 1) {
      const a = rr(-0.25, Math.PI + 0.25);
      const up = rr(-0.5, 0.95);
      const flat = Math.sqrt(1 - up * up);
      const ux = Math.cos(a) * flat;
      const uz = Math.sin(a) * flat;
      dabs.lie(ux * 0.3 * s, (0.46 + up * 0.3) * s, uz * 0.29 * s, ux * 0.3, -1, uz * 0.3, ux, up * 0.6 + 0.2, uz, rr(0.2, 0.3) * s, rr(0.1, 0.15) * s, R() < 0.5 ? 4 : 5, tone(leaf, rr(0.35, 0.98)), 0, K.FIGURE);
    }
    ball(dabs, under, 0, 0.9 * s, 0, 0.2 * s, 0.2 * s, 0.19 * s, hide, [0.2, 0.55], 24);
    // The mask, on the face: pale, with dark eyes and a red mouth.
    for (let i = 0; i < 12; i += 1) {
      dabs.lie(rr(-0.11, 0.11) * s, (0.9 + rr(-0.12, 0.12)) * s, -0.19 * s, R() - 0.5, 1, 0, 0, 0, -1, rr(0.13, 0.18) * s, rr(0.08, 0.11) * s, 2, tone(ogre ? "verm" : "bone", rr(0.62, 0.98)), 0, K.FIGURE);
    }
    for (const side of [-1, 1]) dabs.lie(side * 0.075 * s, 0.93 * s, -0.2 * s, 1, side * 0.35, 0, 0, 0, -1, 0.08 * s, 0.045 * s, 7, tone("slate", 0.02), 0, K.FIGURE);
    dabs.lie(0, 0.82 * s, -0.2 * s, 1, 0, 0, 0, 0, -1, 0.11 * s, 0.035 * s, 7, tone(ogre ? "bone" : "verm", 0.75), 0, K.FIGURE);
    // Ears of leaf, or horns.
    for (const side of [-1, 1]) turned(dabs, under, 1.04 * s, 0.055 * s, 1.3 * s, 0.006 * s, ogre ? "bone" : leaf, [0.5, 0.95], 9, { x: side * 0.12 * s, len: 0.16 * s, wid: 0.05 * s });
    ball(dabs, under, -0.28 * s, 0.56 * s, -0.02 * s, 0.07 * s, 0.13 * s, 0.07 * s, hide, [0.2, 0.5], 8);
  });
  // The arm with the club turns at the shoulder.
  const arm = part((dabs, under) => {
    ball(dabs, under, 0, -0.06 * s, -0.04 * s, 0.07 * s, 0.12 * s, 0.07 * s, hide, [0.2, 0.5], 8);
    under.add(BOX, place(0, 0.2 * s, -0.12 * s, 0.07 * s, 0.62 * s, 0.07 * s), tone("bark", 0.3));
    for (let i = 0; i < 12; i += 1) {
      const a = R() * TAU;
      dabs.lie(Math.cos(a) * 0.04 * s, rr(-0.05, 0.42) * s, (-0.12 + Math.sin(a) * 0.04) * s, 0, 1, 0, Math.cos(a), 0, Math.sin(a), 0.2 * s, 0.05 * s, 7, tone("bark", rr(0.3, 0.75)), 0, K.FIGURE);
    }
    ball(dabs, under, 0, 0.52 * s, -0.12 * s, 0.1 * s, 0.13 * s, 0.1 * s, "bark", [0.3, 0.8], 14);
  });
  arm.position.set(0.29 * s, 0.64 * s, -0.02 * s);
  const feet = [-1, 1].map((side) => {
    const foot = part((dabs, under) => {
      under.add(BOX, place(0, 0.04 * s, -0.03 * s, 0.11 * s, 0.08 * s, 0.2 * s), tone(hide, 0.2));
      for (let i = 0; i < 5; i += 1) dabs.lie(rr(-0.04, 0.04) * s, 0.085 * s, rr(-0.1, 0.05) * s, 0, 0, 1, 0, 1, 0, 0.15 * s, 0.06 * s, 2, tone(hide, rr(0.2, 0.5)), 0, K.FIGURE);
    });
    foot.position.set(side * 0.12 * s, 0, 0);
    return foot;
  });
  group.add(body, arm, ...feet);
  return { group, body, arm, feet };
}

/**
 * Moves a creature toward where it was last seen and plays what it is doing.
 * `mob` holds the figure, k, x, z, a and tx, tz, ta, its stance, and `since`, the seconds it has
 * been in that stance.
 */
export function animateCreature(mob, dt) {
  const kind = MOB_KINDS[mob.k];
  const size = kind.size;
  const ease = 1 - Math.exp(-dt * 10);
  const dx = (mob.tx - mob.x) * ease;
  const dz = (mob.tz - mob.z) * ease;
  mob.x += dx;
  mob.z += dz;
  mob.a += Math.atan2(Math.sin(mob.ta - mob.a), Math.cos(mob.ta - mob.a)) * (1 - Math.exp(-dt * 9));
  const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
  mob.pace += (clamp(speed / 1.6) - mob.pace) * (1 - Math.exp(-dt * 8));
  mob.stride += (speed * dt * 4.4) / size;
  mob.since += dt;
  const { group, body, arm, feet } = mob.figure;
  const walk = mob.pace;
  const s = Math.sin(mob.stride);
  const c = Math.cos(mob.stride);
  let lean = -0.08 * walk;
  let swing = -0.4 + s * 0.3 * walk;
  let hop = Math.abs(s) * 0.05 * walk;
  let tip = 0;
  if (mob.stance === STANCE.WINDUP) {
    // The club goes back over the shoulder: the time to step away.
    const t = smooth(0, kind.windup / 1000, mob.since);
    swing = lerp(-0.4, 1.25, t);
    lean = 0.22 * t;
  } else if (mob.stance === STANCE.REST) {
    // And comes down.
    swing = mob.since < 0.14 ? lerp(1.25, -1.9, mob.since / 0.14) : lerp(-1.9, -0.4, smooth(0.35, 0.8, mob.since));
    lean = -0.3 * (1 - smooth(0.1, 0.6, mob.since));
  } else if (mob.stance === STANCE.REEL) {
    lean = 0.55 * (1 - smooth(0, 0.38, mob.since));
    hop = Math.sin(clamp(mob.since / 0.38) * Math.PI) * 0.28;
  } else if (mob.stance === STANCE.DEAD) {
    tip = smooth(0, 0.45, mob.since);
  } else if (mob.stance === STANCE.STALK) {
    // Creeping up on a lantern: low, and leaning in.
    lean = -0.34;
    swing = -0.9 + s * 0.12 * walk;
    hop = Math.abs(s) * 0.025 * walk;
  } else if (mob.stance === STANCE.SNUFF) {
    // Jumping at the flame and beating at it with the club.
    const t = mob.since * 6.4;
    hop = Math.abs(Math.sin(t)) * 0.44;
    swing = -0.15 + Math.sin(t * 2) * 0.5;
    lean = 0.16;
  }
  // Fallen, it lies a moment and is gone.
  group.visible = !(mob.stance === STANCE.DEAD && mob.since > 1.5);
  group.position.set(mob.x, ground(mob.x, mob.z) + (hop + tip * 0.2) * size, mob.z);
  group.rotation.set(tip * 1.5, mob.a, 0);
  body.rotation.x = lean;
  body.rotation.z = s * 0.06 * walk;
  arm.rotation.x = swing;
  arm.position.y = 0.64 * size + Math.abs(s) * 0.02 * walk;
  feet[0].position.set(-0.12 * size, Math.max(0, c) * 0.07 * walk * size, -s * 0.13 * walk * size);
  feet[1].position.set(0.12 * size, Math.max(0, -c) * 0.07 * walk * size, s * 0.13 * walk * size);
}

/**
 * The white fox, sitting, facing -z until it is turned. It is pale enough to be seen in the
 * dark, with red marks on its face like the masks made of it.
 */
export function makeFox() {
  const { part, turned, ball } = painter(977);
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  const white = [0.6, 1];
  const pale = 0.72;
  const body = part((dabs, under) => {
    ball(dabs, under, 0, 0.2, 0.1, 0.17, 0.19, 0.2, "snow", white, 36, pale);
    ball(dabs, under, 0, 0.4, -0.02, 0.13, 0.23, 0.13, "snow", white, 32, pale);
    for (const side of [-1, 1]) turned(dabs, under, 0, 0.035, 0.3, 0.045, "snow", white, 8, { x: side * 0.07, z: -0.1, len: 0.14, wid: 0.04, glow: pale });
  });
  const head = part((dabs, under) => {
    ball(dabs, under, 0, 0, 0, 0.115, 0.105, 0.115, "snow", white, 28, pale);
    ball(dabs, under, 0, -0.035, -0.13, 0.05, 0.042, 0.085, "snow", white, 12, pale);
    dabs.lie(0, -0.03, -0.218, 1, 0, 0, 0, 0, -1, 0.035, 0.03, 7, tone("slate", 0.02), 0, K.FIGURE);
    for (const side of [-1, 1]) {
      turned(dabs, under, 0.06, 0.052, 0.26, 0.004, "snow", white, 10, { x: side * 0.07, z: 0.01, len: 0.12, wid: 0.04, glow: pale });
      dabs.lie(side * 0.07, 0.15, -0.04, 0, 1, 0, 0, 0, -1, 0.1, 0.028, 7, tone("verm", 0.8), 0, K.FIGURE, 0.35);
      dabs.lie(side * 0.055, 0.02, -0.108, 1, side * 0.45, 0, 0, 0.3, -1, 0.05, 0.02, 7, tone("slate", 0.02), 0, K.FIGURE);
      dabs.lie(side * 0.098, -0.03, -0.07, 0.4, -side, 0, side * 0.6, 0, -0.8, 0.06, 0.018, 7, tone("verm", 0.8), 0, K.FIGURE, 0.35);
    }
    dabs.lie(0, 0.078, -0.096, 0, 1, 0, 0, 0.5, -0.85, 0.05, 0.02, 7, tone("verm", 0.8), 0, K.FIGURE, 0.35);
  });
  head.position.set(0, 0.68, -0.08);
  // The tail stands up behind it and sways.
  const tail = part((dabs, under) => {
    ball(dabs, under, 0, 0.3, 0, 0.1, 0.3, 0.1, "snow", white, 34, pale);
    ball(dabs, under, 0, 0.6, 0, 0.055, 0.08, 0.055, "gold", [0.7, 1], 8, pale);
  });
  tail.position.set(0.09, 0.05, 0.24);
  const glow = makeGlow(5.6, true);
  glow.position.y = 0.5;
  // A foxfire hangs in the air over it, high enough to be seen over the bushes.
  const fire = makeGlow(2.6, true);
  group.add(body, head, tail, glow, fire);
  group.scale.setScalar(1.25);
  return { group, head, tail, glow, fire };
}

/**
 * Sets the fox down and moves it. `fox` holds the figure, x, z and a, `seen`, the seconds since
 * it came out, and `left`, the seconds since it was found (or -1). It turns its head to (lx, lz),
 * and found, it leaps and is gone.
 */
export function animateFox(fox, dt, time, lx, lz) {
  const { group, head, tail, glow, fire } = fox.figure;
  const leap = fox.left < 0 ? 0 : fox.left;
  group.visible = fox.seen >= 0 && leap < 0.7;
  if (!group.visible) return;
  const arrive = smooth(0, 1.2, fox.seen);
  const size = 1.25 * arrive * (1 - smooth(0.25, 0.7, leap));
  group.scale.setScalar(Math.max(0.001, size));
  group.position.set(fox.x, ground(fox.x, fox.z) + Math.sin(clamp(leap / 0.7) * Math.PI) * 2.2, fox.z);
  group.rotation.y = fox.a;
  const want = clamp(Math.atan2(Math.sin(Math.atan2(-(lx - fox.x), -(lz - fox.z)) - fox.a), Math.cos(Math.atan2(-(lx - fox.x), -(lz - fox.z)) - fox.a)), -1.2, 1.2);
  head.rotation.y += (want - head.rotation.y) * (1 - Math.exp(-dt * 4));
  head.rotation.z = Math.sin(time * 0.7) * 0.06;
  tail.rotation.x = 0.42 + Math.sin(time * 1.1) * 0.06;
  tail.rotation.z = Math.sin(time * 1.7) * 0.28;
  glow.material.opacity = (0.62 + Math.sin(time * 2.3) * 0.1) * arrive;
  fire.position.set(Math.sin(time * 0.9) * 0.25, 2.3 + Math.sin(time * 1.6) * 0.22, Math.cos(time * 0.7) * 0.25);
  fire.material.opacity = (0.72 + Math.sin(time * 9) * 0.1 + Math.sin(time * 23) * 0.06) * arrive;
}

/** a paper lantern to let go into the sky, lit from inside; its foot is at the origin */
export function makeSkyLantern() {
  const { part, turned } = painter(1213);
  const group = new THREE.Group();
  const paper = part((dabs, under) => {
    turned(dabs, under, 0, 0.34, 1, 0.52, "paper", [0.55, 1], 60, { len: 0.4, wid: 0.15, glow: 1 });
    turned(dabs, under, 1, 0.52, 1.13, 0.38, "paper", [0.42, 0.8], 16, { len: 0.2, wid: 0.12, glow: 1 });
  });
  const glow = makeGlow(6.5);
  glow.position.y = 0.45;
  group.add(paper, glow);
  return { group, glow };
}
