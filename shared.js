// Rules and the lie of the land, shared by the browser client and the room server (server/worker.js).
// The valley is flat ground in x and z, in metres. North, toward the pagoda, is -z.

export const WALK = 3.4;
export const RUN = 6.2;
export const MAX_PEOPLE = 12;
// Nobody walks farther than WORLD_R from CENTER.
export const CENTER = [0, -6];
export const WORLD_R = 84;
// How near a stone lantern must be to light it, and how long it then burns.
export const REACH = 3.4;
export const BURN_MS = 240000;
// One day and night, taken from the server's clock so that everyone sees the same hour.
export const DAY_MS = 420000;
// Robe colours; the last one belongs to the monks who keep a quiet valley company.
export const COLORS = [
  0x3d4f8f, 0x7a4a86, 0x2f8f8a, 0x6f8f3a, 0xd9a02f, 0xd06a7a,
  0x6f8fb8, 0xe6d8b8, 0x9a4a3a, 0x4a6a4a, 0xb88ad0, 0x40a0c8, 0x8a8478,
];

// The shrine hill: level on top for `flat` metres from its middle, and down to the valley floor at `foot`.
export const HILL = { x: 0, z: -76, top: 20, flat: 15, foot: 50 };
// The stone steps up its south side, `n` of them, `half` wide to each side of x = 0.
export const STAIRS = { z0: -26, z1: -61, half: 1.9, n: 60 };
export const PAGODA = { x: 0, z: -79, half: 7.6 };
export const GATES = [{ z: 24, wide: 4.6, tall: 5.8 }, { z: -62.2, wide: 4.2, tall: 5.2 }];

export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// The wooded ridge at the south end, which the path comes down from: level with the valley
// floor at z0 and `top` higher at z1. The path runs down it in a straight sunken lane at
// x = LANE, aimed at the shrine, so the first thing anyone sees is the pagoda between the trees.
export const RIDGE = { top: 16, z0: 22, z1: 86 };
export const LANE = -1.5;

export function ridgeAt(z) {
  const t = clamp((z - RIDGE.z0) / (RIDGE.z1 - RIDGE.z0));
  return RIDGE.top * t * t * (3 - 2 * t);
}

// Where the middle of the path lies at a given z. It wanders over the valley floor and runs
// straight onto the steps.
export function pathX(z) {
  const s = z - STAIRS.z0;
  const wander = smooth(0, 20, s) * (6.5 * Math.sin(s * 0.052) + 2.2 * Math.sin(s * 0.13 + 1.1));
  const lane = smooth(30, 54, z);
  return wander * (1 - lane) + LANE * lane;
}

export const SPAWN = [pathX(66), 66];

// The twelve stone lanterns: six along the path, then pairs at the foot of the steps,
// at their head, and before the pagoda.
export const LANTERNS = (() => {
  const list = [];
  [57, 44, 31, 17, 4, -9].forEach((z, i) => list.push([pathX(z) + (i % 2 ? -2.7 : 2.7), z]));
  list.push([-2.9, -24.4], [2.9, -24.4], [-3.1, -64.4], [3.1, -64.4], [-9.4, -68.2], [9.4, -68.2]);
  return list.map(([x, z]) => [Number(x.toFixed(2)), z]);
})();

// The way the monks walk: up the path, up the steps, and round the pagoda.
export const ROUTE = (() => {
  const list = [];
  for (let z = 62; z >= -22; z -= 7) list.push([Number(pathX(z).toFixed(2)), z]);
  list.push([0, -30], [0, -45], [0, -60], [0, -66.5], [8, -68], [10.6, -72], [10.8, -79], [9.6, -86], [-9.6, -86], [-10.8, -79], [-10.6, -72], [-8, -68], [0, -66.5]);
  return list;
})();

// The nearest place to (x, z) that is still inside the valley.
export function hold(x, z) {
  const dx = x - CENTER[0];
  const dz = z - CENTER[1];
  const d = Math.hypot(dx, dz);
  if (d <= WORLD_R) return [x, z];
  return [CENTER[0] + (dx * WORLD_R) / d, CENTER[1] + (dz * WORLD_R) / d];
}

// Night begins to fall this far through each day.
export const NIGHTFALL = 0.7;
const hour = (now) => (((now % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;

// How far into the night it is at a given moment of the server's clock: 0 by day, 1 at night.
export function dusk(now) {
  const t = hour(now);
  if (t < NIGHTFALL) return 0;
  if (t < 0.78) return smooth(NIGHTFALL, 0.78, t);
  if (t < 0.93) return 1;
  return 1 - smooth(0.93, 1, t);
}

/** whether it is between nightfall and dawn */
export const isNight = (now) => hour(now) >= NIGHTFALL;
/** the number of the night that last fell, which goes up by one at every nightfall */
export const nightOf = (now) => Math.floor(now / DAY_MS - NIGHTFALL);

/* The white fox. From nightfall until dawn it sits in one of these places, away from the path,
   and never where it sat the night before. Whoever reaches it first wears its mask until the
   next nightfall. */

export const FOX = { reach: 2.4 };
export const FOX_SPOTS = [
  [-34, 24], [46, -4], [-30, -40], [22, 52], [0, -89.2], [-44, -6], [38, 30], [32, -44], [-20, 58],
];
// Stepping through the places five at a time visits all nine before any comes round again.
export const foxSpot = (night) => FOX_SPOTS[(((night * 5) % FOX_SPOTS.length) + FOX_SPOTS.length) % FOX_SPOTS.length];

/**
 * Keeps the fox: `fox` holds night (the night it last came out), out (whether it is abroad) and
 * by (who has found it, or 0). What happened is pushed onto `events`: fox (it has come out, or
 * with `gone` it has left at dawn) and found.
 */
export function stepFox(fox, people, now, events) {
  const night = nightOf(now);
  if (isNight(now)) {
    if (fox.night !== night) {
      Object.assign(fox, { night, out: true, by: 0 });
      events.push({ t: "fox", night });
    }
  } else if (fox.out) {
    fox.out = false;
    events.push({ t: "fox", night: fox.night, gone: true });
  }
  if (!fox.out || fox.by) return;
  const [x, z] = foxSpot(fox.night);
  for (const p of people) {
    if (p.down || Math.hypot(p.x - x, p.z - z) > FOX.reach) continue;
    fox.by = p.id;
    p.mask = fox.night;
    events.push({ t: "found", id: p.id, night: fox.night });
    return;
  }
}

/* Creatures. The same rules run on the room server and, in a valley with no server, in the browser. */

export const HEARTS = 5;
// A swing of the staff strikes everything within `reach` metres, up to `arc` radians to either side.
export const SWING = { reach: 2.6, arc: 1.2, every: 450 };
// STALK is an imp creeping up on a lantern, and SNUFF is it putting the lantern out.
export const STANCE = { ROAM: 0, CHASE: 1, WINDUP: 2, REST: 3, REEL: 4, DEAD: 5, STALK: 6, SNUFF: 7 };
// speed in metres a second; sight and reach in metres; windup and rest in ms; hurt in hearts.
export const MOB_KINDS = [
  { name: "imp", speed: 2.9, hp: 3, sight: 13, reach: 1.45, windup: 560, rest: 850, hurt: 1, size: 1, snuffs: true },
  { name: "ogre", speed: 2.1, hp: 9, sight: 16, reach: 2.5, windup: 950, rest: 1200, hurt: 2, size: 2.2, snuffs: false },
];
// Where each one lives: x, z and its kind. Nothing lives in the lane, so that people arrive in peace.
export const MOB_HOMES = [
  [-7, 37, 0], [4.5, 34, 0], [-2.5, 30, 0],
  [10, 21, 0], [0.5, 19, 0],
  [10, 5, 0], [0, 0, 0], [9, -5, 0],
  [-3, -13, 0], [7, -16, 0],
  [3.5, -20.5, 1],
  [-6.5, -66, 0], [6.5, -66.5, 0],
  [0, -69, 1],
];
// Nothing strikes a person standing this near a lit lantern.
const SAFE = 5.5;
const LEASH = 24;
const RESPAWN_MS = 35000;
const HEAL_AFTER_MS = 7000;
const HEAL_EVERY_MS = 2600;
// An imp with nobody to go for creeps up on a burning lantern within `range` metres of its home
// and puts it out. One that has burned for less than `fresh` ms is too bright for them. An imp
// waits `every` ms between tries, must come within `near` metres, and takes `takes` ms over the
// putting out, which is the time there is to stop it.
export const SNUFF = { range: 20, fresh: 25000, every: [26000, 48000], near: 1.25, takes: 3000 };
// Struck down, a person lies where they fell. Anyone who rings a staff within `reach` metres
// lifts them, with `hearts`. If nobody does within `wait` ms they start again in the lane, and
// after only `alone` ms if there was nobody else to do it.
export const LIFT = { reach: 4, wait: 14000, alone: 3400, hearts: 3, spared: 2500 };

const snuffWait = () => SNUFF.every[0] + Math.random() * (SNUFF.every[1] - SNUFF.every[0]);

export function makeMobs() {
  return MOB_HOMES.map(([x, z, k], i) => ({
    id: i + 1, k, hx: x, hz: z, x, z, a: 0, hp: MOB_KINDS[k].hp,
    stance: STANCE.ROAM, until: 0, target: 0, wx: x, wz: z, pause: 0, moved: true,
    // The lantern it is going for, or -1, and when it may next go for one.
    goal: -1, tryAt: 0,
  }));
}

/**
 * Moves every creature on by dt seconds. `people` are those they can hurt, each with id, x, z,
 * hearts and down; `lit` holds the moment each lantern burns out, and an imp that puts one out
 * sets it to 0. What happened is pushed onto `events`: cry (it has seen someone), hurt, down,
 * rise, hearts, hit and out (a lantern put out).
 */
export function stepMobs(mobs, people, lit, now, dt, events) {
  // While every lantern burns, the valley is at peace and nothing walks in it.
  const peace = lit.every((until) => until > now);
  const fresh = (i) => lit[i] - now > BURN_MS - SNUFF.fresh;
  // The lit lantern each person is standing by, or -1.
  const under = people.map((p) => {
    let best = -1;
    let least = SAFE;
    LANTERNS.forEach(([x, z], i) => {
      const d = lit[i] > now ? Math.hypot(p.x - x, p.z - z) : Infinity;
      if (d < least) {
        least = d;
        best = i;
      }
    });
    return best;
  });
  // How many other imps are already going for lantern `i`.
  const busy = (mob, i) => mobs.filter((other) => other !== mob && other.goal === i && other.stance !== STANCE.DEAD).length;
  for (const mob of mobs) {
    const kind = MOB_KINDS[mob.k];
    const set = (stance, until = 0) => {
      mob.stance = stance;
      mob.until = until;
      mob.moved = true;
    };
    if (!mob.tryAt) mob.tryAt = now + snuffWait() * 0.6;
    if (mob.stance === STANCE.DEAD) {
      // It comes back at its home, once nobody is standing there.
      if (!peace && now >= mob.until && !people.some((p) => Math.hypot(p.x - mob.hx, p.z - mob.hz) < 10)) {
        mob.x = mob.wx = mob.hx;
        mob.z = mob.wz = mob.hz;
        mob.hp = kind.hp;
        mob.goal = -1;
        mob.tryAt = now + snuffWait();
        set(STANCE.ROAM);
      }
      continue;
    }
    if (peace) {
      mob.goal = -1;
      set(STANCE.DEAD, now + 4000);
      events.push({ t: "hit", id: mob.id, by: 0, dead: true });
      continue;
    }
    if (mob.stance === STANCE.REEL || mob.stance === STANCE.REST) {
      if (now < mob.until) continue;
      set(STANCE.CHASE);
    }
    if (mob.stance === STANCE.WINDUP) {
      if (now < mob.until) continue;
      // The blow lands on whoever it was meant for, if they have not stepped back.
      const struck = people.find((p) => p.id === mob.target);
      if (struck && !struck.down && Math.hypot(struck.x - mob.x, struck.z - mob.z) < kind.reach * 1.35) {
        struck.hearts = Math.max(0, struck.hearts - kind.hurt);
        struck.hurtAt = now;
        events.push({ t: "hurt", id: struck.id, hearts: struck.hearts, by: mob.id });
        if (struck.hearts === 0) {
          struck.down = true;
          struck.downAt = now;
          struck.downFor = people.length > 1 ? LIFT.wait : LIFT.alone;
          events.push({ t: "down", id: struck.id, wait: struck.downFor });
        }
      }
      set(STANCE.REST, now + kind.rest);
      continue;
    }
    // Whom to go for: the nearest person it can see who is not by a lit lantern or too far from
    // its home. Someone it can see who is by a lit lantern shows it a flame to put out.
    let prey = null;
    let near = kind.sight;
    let flame = -1;
    people.forEach((p, n) => {
      if (p.down || p.spared > now) return;
      const d = Math.hypot(p.x - mob.x, p.z - mob.z);
      if (d >= kind.sight || Math.hypot(p.x - mob.hx, p.z - mob.hz) >= LEASH) return;
      if (under[n] >= 0) {
        if (!fresh(under[n])) flame = under[n];
      } else if (d < near) {
        prey = p;
        near = d;
      }
    });
    let gx;
    let gz;
    let speed;
    if (prey) {
      if (mob.stance !== STANCE.CHASE) {
        set(STANCE.CHASE);
        if (mob.target !== prey.id) events.push({ t: "cry", id: mob.id });
      }
      mob.target = prey.id;
      mob.goal = -1;
      if (near < kind.reach) {
        mob.a = Math.atan2(-(prey.x - mob.x), -(prey.z - mob.z));
        set(STANCE.WINDUP, now + kind.windup);
        continue;
      }
      gx = prey.x;
      gz = prey.z;
      speed = kind.speed;
    } else {
      mob.target = 0;
      if (kind.snuffs) {
        // The lantern it was going for may have gone out some other way.
        if (mob.goal >= 0 && !(lit[mob.goal] > now)) mob.goal = -1;
        // One imp at a time goes for a flame, or two when more than one person shelters by it.
        if (mob.goal < 0 && flame >= 0 && busy(mob, flame) < Math.min(2, under.filter((i) => i === flame).length)) mob.goal = flame;
        if (mob.goal < 0 && now >= mob.tryAt) {
          // If there is none to go for now, it looks again before long.
          mob.tryAt = now + snuffWait() * 0.4;
          let least = Infinity;
          LANTERNS.forEach(([x, z], i) => {
            if (!(lit[i] > now) || fresh(i) || busy(mob, i) || Math.hypot(x - mob.hx, z - mob.hz) > SNUFF.range) return;
            const d = Math.hypot(x - mob.x, z - mob.z);
            if (d < least) {
              least = d;
              mob.goal = i;
            }
          });
        }
      }
      if (mob.goal >= 0) {
        const [lx, lz] = LANTERNS[mob.goal];
        if (mob.stance === STANCE.SNUFF) {
          if (now < mob.until) continue;
          lit[mob.goal] = 0;
          events.push({ t: "out", i: mob.goal, by: mob.id });
          mob.goal = -1;
          mob.tryAt = now + snuffWait();
          set(STANCE.ROAM);
          continue;
        }
        if (Math.hypot(lx - mob.x, lz - mob.z) < SNUFF.near) {
          mob.a = Math.atan2(-(lx - mob.x), -(lz - mob.z));
          set(STANCE.SNUFF, now + SNUFF.takes);
          continue;
        }
        if (mob.stance !== STANCE.STALK) set(STANCE.STALK);
        gx = lx;
        gz = lz;
        speed = kind.speed * 0.62;
      } else {
        if (mob.stance !== STANCE.ROAM) set(STANCE.ROAM);
        if (now < mob.pause) continue;
        if (Math.hypot(mob.wx - mob.x, mob.wz - mob.z) < 0.4) {
          const a = Math.random() * 6.283;
          const r = Math.random() * 5;
          mob.wx = mob.hx + Math.cos(a) * r;
          mob.wz = mob.hz + Math.sin(a) * r;
          mob.pause = now + 600 + Math.random() * 3200;
          continue;
        }
        gx = mob.wx;
        gz = mob.wz;
        speed = kind.speed * 0.42;
      }
    }
    const dx = gx - mob.x;
    const dz = gz - mob.z;
    const d = Math.hypot(dx, dz) || 1;
    const stride = Math.min(d, speed * dt);
    mob.x += (dx / d) * stride;
    mob.z += (dz / d) * stride;
    mob.a = Math.atan2(-dx, -dz);
    mob.moved = true;
  }
  // They do not stand inside one another.
  for (let i = 0; i < mobs.length; i += 1) {
    for (let j = i + 1; j < mobs.length; j += 1) {
      const a = mobs[i];
      const b = mobs[j];
      if (a.stance === STANCE.DEAD || b.stance === STANCE.DEAD) continue;
      const least = 0.45 * (MOB_KINDS[a.k].size + MOB_KINDS[b.k].size);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= least || d < 1e-4) continue;
      const push = (least - d) / 2 / d;
      a.x -= dx * push;
      a.z -= dz * push;
      b.x += dx * push;
      b.z += dz * push;
      a.moved = b.moved = true;
    }
  }
  for (const p of people) {
    if (p.down) {
      // Nobody lifted them in time, so they start again where everyone arrives.
      if (now - p.downAt > p.downFor) {
        p.down = false;
        p.hearts = HEARTS;
        p.x = SPAWN[0];
        p.z = SPAWN[1];
        events.push({ t: "rise", id: p.id, x: p.x, z: p.z, hearts: p.hearts });
      }
    } else if (p.hearts < HEARTS && now - (p.hurtAt || 0) > HEAL_AFTER_MS && now - (p.healAt || 0) > HEAL_EVERY_MS) {
      // Hearts come back when no blow has landed for a while.
      p.hearts += 1;
      p.healAt = now;
      events.push({ t: "hearts", id: p.id, hearts: p.hearts });
    }
  }
}

/**
 * `by` has rung a staff: whoever lies struck down within reach gets up where they fell, and the
 * creatures leave them be for a moment.
 */
export function liftPeople(people, by, now, events) {
  if (by.down) return;
  for (const p of people) {
    if (!p.down || p.id === by.id || Math.hypot(p.x - by.x, p.z - by.z) > LIFT.reach) continue;
    p.down = false;
    p.hearts = LIFT.hearts;
    p.hurtAt = now;
    p.spared = now + LIFT.spared;
    events.push({ t: "rise", id: p.id, x: p.x, z: p.z, hearts: p.hearts, by: by.id });
  }
}

/** The staff of `by` (id, x, z and a, the way they face) strikes every creature in reach before them. */
export function strikeMobs(mobs, by, now, events) {
  const fx = -Math.sin(by.a);
  const fz = -Math.cos(by.a);
  for (const mob of mobs) {
    if (mob.stance === STANCE.DEAD) continue;
    const kind = MOB_KINDS[mob.k];
    const dx = mob.x - by.x;
    const dz = mob.z - by.z;
    const d = Math.hypot(dx, dz);
    if (d > SWING.reach + kind.size * 0.3) continue;
    if (d > 0.5 && (dx * fx + dz * fz) / d < Math.cos(SWING.arc)) continue;
    mob.hp -= 1;
    const push = 1.3 / kind.size / (d || 1);
    mob.x += dx * push;
    mob.z += dz * push;
    mob.target = by.id;
    if (mob.hp <= 0) mob.goal = -1;
    mob.stance = mob.hp <= 0 ? STANCE.DEAD : STANCE.REEL;
    mob.until = now + (mob.hp <= 0 ? RESPAWN_MS : 380);
    mob.moved = true;
    events.push({ t: "hit", id: mob.id, by: by.id, dead: mob.hp <= 0 });
  }
}
