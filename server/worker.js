import { DurableObject } from "cloudflare:workers";
import {
  BURN_MS, COLORS, HEARTS, LANTERNS, MAX_PEOPLE, REACH, ROUTE, RUN, SPAWN, SWING,
  hold, liftPeople, makeMobs, stepFox, stepMobs, strikeMobs,
} from "../shared.js";

const TICK_MS = 100;
// Rooms are billed while a socket is open, so quiet players are let go.
const IDLE_MS = 90000;
const HELLO_MS = 5000;
const MAX_MESSAGES_PER_SECOND = 60;
const BOT_COLOR = COLORS.length - 1;
// The monks who keep a quiet valley company. `speed` is in metres a second, `rest` is how
// long they stand at each stop, in ms, and `from` is where on ROUTE they begin.
const BOTS = [
  { name: "Marvin", speed: 2.1, rest: [900, 5200], from: 9 },
  { name: "Trillian", speed: 2.5, rest: [600, 3600], from: 16 },
];
const ORIGIN = /^https:\/\/(www\.)?cashel\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
// A room's socket, or with /stats what the start screen says about it.
const ROOM_PATH = /^\/r\/([a-z0-9-]{1,24})(\/stats)?$/;

const rand = (min, max) => min + Math.random() * (max - min);
const tidy = (value) => Number(value.toFixed(2));

export default {
  async fetch(request, env) {
    const match = new URL(request.url).pathname.match(ROOM_PATH);
    if (!match) return new Response("emberleaf\n");
    const origin = request.headers.get("Origin") || "";
    // DEV_ANY_ORIGIN is only ever set by `wrangler dev --var`, to play from another device.
    if (!env.DEV_ANY_ORIGIN && !ORIGIN.test(origin)) {
      return new Response("Forbidden.\n", { status: 403 });
    }
    const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
    if (match[2]) {
      const stats = await room.fetch(new Request("https://room/stats"));
      return new Response(stats.body, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": origin || "*",
          Vary: "Origin",
        },
      });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket.\n", { status: 426 });
    }
    return room.fetch(request);
  },
};

export class Room extends DurableObject {
  players = new Map();
  sockets = new Map();
  nextPlayerId = 1;
  timer = null;
  lastTick = 0;
  // For each stone lantern, the moment it burns out (0 when it is dark).
  lit = LANTERNS.map(() => 0);
  // Whether the bell has rung for the lanterns that are lit now.
  rung = false;
  // The creatures of the valley, which everyone in it sees and fights alike.
  mobs = makeMobs();
  // The white fox: the night it last came out, whether it is abroad, and who found it.
  fox = { night: -1, out: false, by: 0 };
  // How many times every lantern has burned at once here. It outlives the valley's visitors.
  bells = 0;

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.bells = (await ctx.storage.get("bells")) || 0;
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ bells: this.bells, here: this.humans() });
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    if (this.humans() >= MAX_PEOPLE) {
      server.close(4002, "full");
      return new Response(null, { status: 101, webSocket: client });
    }
    const session = { player: null, windowStart: 0, messages: 0 };
    this.sockets.set(server, session);
    setTimeout(() => {
      if (!session.player) this.drop(server, 4001, "idle");
    }, HELLO_MS);
    server.addEventListener("message", (event) => this.receive(server, session, event.data));
    server.addEventListener("close", () => this.drop(server));
    server.addEventListener("error", () => this.drop(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  humans() {
    let count = 0;
    for (const player of this.players.values()) if (!player.bot) count += 1;
    return count;
  }

  send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      this.drop(socket);
    }
  }

  broadcast(message) {
    const text = JSON.stringify(message);
    for (const [socket, session] of this.sockets) {
      if (!session.player) continue;
      try {
        socket.send(text);
      } catch (error) {
        this.drop(socket);
      }
    }
  }

  describe(player) {
    return {
      id: player.id,
      name: player.name,
      c: player.c,
      bot: Boolean(player.bot),
      x: tidy(player.x),
      z: tidy(player.z),
      a: tidy(player.a),
      down: player.down,
      mask: player.mask,
    };
  }

  addPlayer(name, c, bot = null) {
    const at = bot ? ROUTE[bot.from] : [SPAWN[0] + rand(-2.5, 2.5), SPAWN[1] + rand(-2, 2)];
    const player = {
      id: this.nextPlayerId++,
      name,
      c,
      bot,
      x: at[0],
      z: at[1],
      a: 0,
      moved: false,
      last: Date.now(),
      lastMove: Date.now(),
      lastRing: 0,
      lastSwing: 0,
      hearts: HEARTS,
      down: false,
      downFor: 0,
      spared: 0,
      // The night whose fox they found, and the bell they have let a lantern go for.
      mask: -1,
      sky: -1,
      stop: bot ? bot.from : 0,
      step: 1,
      pauseUntil: 0,
    };
    if (!bot) {
      // The colour they asked for, or the next one nobody is wearing.
      const worn = new Set();
      for (const other of this.players.values()) if (!other.bot) worn.add(other.c);
      const colors = COLORS.length - 1;
      for (let i = 0; i < colors && worn.has(player.c); i += 1) player.c = (player.c + 1) % colors;
    }
    this.players.set(player.id, player);
    return player;
  }

  removePlayer(player) {
    if (!this.players.delete(player.id)) return;
    this.broadcast({ t: "leave", id: player.id });
  }

  // The monks step aside as people arrive, so that a newcomer always has company.
  syncBots() {
    const humans = this.humans();
    const wanted = humans === 0 ? 0 : Math.max(0, 3 - humans);
    const bots = [...this.players.values()].filter((player) => player.bot);
    while (bots.length > wanted) this.removePlayer(bots.pop());
    for (const bot of BOTS) {
      if (bots.length >= wanted) break;
      if (bots.some((player) => player.bot === bot)) continue;
      const player = this.addPlayer(bot.name, BOT_COLOR, bot);
      bots.push(player);
      this.broadcast({ t: "join", p: this.describe(player) });
    }
  }

  drop(socket, code, reason) {
    const session = this.sockets.get(socket);
    if (!session) return;
    this.sockets.delete(socket);
    try {
      socket.close(code || 1000, reason || "bye");
    } catch (error) {
      // The socket was already closed.
    }
    if (session.player) {
      this.removePlayer(session.player);
      this.syncBots();
    }
    if (this.humans() === 0) this.stop();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.players.clear();
    this.lit.fill(0);
    this.rung = false;
    this.mobs = makeMobs();
    this.fox = { night: -1, out: false, by: 0 };
  }

  people() {
    return [...this.players.values()].filter((player) => !player.bot);
  }

  // Tells everyone what the creatures did, or what was done to them.
  tell(events) {
    for (const event of events) this.broadcast(event);
  }

  describeMob(mob) {
    return [mob.id, tidy(mob.x), tidy(mob.z), tidy(mob.a), mob.stance];
  }

  receive(socket, session, data) {
    const now = Date.now();
    if (now - session.windowStart > 1000) {
      session.windowStart = now;
      session.messages = 0;
    }
    session.messages += 1;
    if (session.messages > MAX_MESSAGES_PER_SECOND) return this.drop(socket, 4003, "slow down");
    if (typeof data !== "string" || data.length > 300) return;
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      return;
    }
    if (!message || typeof message !== "object") return;
    const player = session.player;
    if (message.t === "ping") {
      // A ping from someone who is still at the controls counts as being here.
      if (player && message.here) player.last = now;
      this.send(socket, { t: "pong", c: Number(message.c) || 0, now });
    } else if (message.t === "hi" && !player) {
      this.welcome(socket, session, message, now);
    } else if (!player) {
      return;
    } else if (message.t === "p") {
      // Someone struck down lies where they fell until they start again.
      if (player.down) return;
      const x = Number(message.x);
      const z = Number(message.z);
      const a = Number(message.a);
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(a)) return;
      // Nobody outruns their own legs, with some slack for bunched-up packets.
      const reach = (RUN * 1.4 * Math.min(1000, now - player.lastMove)) / 1000 + 0.6;
      const dx = x - player.x;
      const dz = z - player.z;
      const distance = Math.hypot(dx, dz);
      const share = distance > reach ? reach / distance : 1;
      [player.x, player.z] = hold(player.x + dx * share, player.z + dz * share);
      player.a = Math.atan2(Math.sin(a), Math.cos(a));
      player.moved = true;
      player.last = now;
      player.lastMove = now;
    } else if (message.t === "e") {
      player.last = now;
      if (player.down || now - player.lastRing < 500) return;
      player.lastRing = now;
      this.broadcast({ t: "e", id: player.id });
      // A ring lifts whoever lies struck down beside it.
      const events = [];
      liftPeople(this.people(), player, now, events);
      this.tell(events);
    } else if (message.t === "up") {
      // Struck down and done waiting to be lifted: start again in the lane.
      player.last = now;
      if (player.down) player.downFor = 0;
    } else if (message.t === "k") {
      // While every lantern burns, each person has one paper lantern to let go.
      player.last = now;
      if (player.down || !this.rung || player.sky === this.bells) return;
      player.sky = this.bells;
      this.broadcast({ t: "sky", id: player.id, x: tidy(player.x), z: tidy(player.z) });
    } else if (message.t === "l") {
      player.last = now;
      if (!player.down) this.light(player, Math.round(Number(message.i)), now);
    } else if (message.t === "w") {
      player.last = now;
      if (player.down || now - player.lastSwing < SWING.every - 60) return;
      player.lastSwing = now;
      const a = Number(message.a);
      if (Number.isFinite(a)) player.a = Math.atan2(Math.sin(a), Math.cos(a));
      this.broadcast({ t: "w", id: player.id });
      const events = [];
      strikeMobs(this.mobs, player, now, events);
      this.tell(events);
    }
  }

  welcome(socket, session, message, now) {
    if (this.humans() >= MAX_PEOPLE) return this.drop(socket, 4002, "full");
    const name = String(message.name || "").replace(/[^\p{L}\p{N} _.'-]/gu, "").trim().slice(0, 12) || "Pilgrim";
    const c = Math.abs(Math.round(Number(message.c) || 0)) % (COLORS.length - 1);
    const player = this.addPlayer(name, c);
    if (!this.timer) {
      this.lastTick = now;
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
    // Everyone else hears about the newcomer before the newcomer starts listening.
    this.broadcast({ t: "join", p: this.describe(player) });
    this.syncBots();
    session.player = player;
    this.send(socket, {
      t: "welcome",
      id: player.id,
      now,
      players: [...this.players.values()].map((each) => this.describe(each)),
      lit: this.lit,
      mobs: this.mobs.map((mob) => [...this.describeMob(mob), mob.k]),
      fox: this.fox,
      bells: this.bells,
      peace: this.rung,
    });
  }

  // Lights lantern `i`, if the player is standing by it. Lighting one that already burns tops it up.
  light(player, i, now) {
    const lantern = LANTERNS[i];
    if (!lantern) return;
    // Generous enough to forgive network delay on either side.
    if (Math.hypot(player.x - lantern[0], player.z - lantern[1]) > REACH + 2.5) return;
    if (this.lit[i] - now > BURN_MS - 1500) return;
    this.lit[i] = now + BURN_MS;
    this.broadcast({ t: "l", i, until: this.lit[i], by: player.id });
    // The bell rings once when the last dark lantern is lit, and the valley keeps count.
    if (!this.rung && this.lit.every((until) => until > now)) {
      this.rung = true;
      this.bells += 1;
      this.ctx.storage.put("bells", this.bells);
      this.broadcast({ t: "bell", by: player.id, n: this.bells });
      // The monks let their lanterns go a moment later.
      for (const bot of this.players.values()) {
        if (!bot.bot) continue;
        setTimeout(() => {
          if (this.rung && this.players.has(bot.id)) this.broadcast({ t: "sky", id: bot.id, x: tidy(bot.x), z: tidy(bot.z) });
        }, rand(1500, 6000));
      }
    }
  }

  // A monk walks ROUTE one stop at a time, turning back at either end. Now and then at a stop
  // it lights a dark lantern that stands there, or rings its staff, which lifts anyone who
  // lies struck down beside it.
  moveBot(bot, now, dt) {
    if (now < bot.pauseUntil) return;
    const goal = ROUTE[bot.stop];
    const dx = goal[0] - bot.x;
    const dz = goal[1] - bot.z;
    const distance = Math.hypot(dx, dz);
    const stride = bot.bot.speed * dt;
    if (distance <= stride) {
      bot.x = goal[0];
      bot.z = goal[1];
      if (bot.stop + bot.step < 0 || bot.stop + bot.step >= ROUTE.length) bot.step = -bot.step;
      bot.stop += bot.step;
      if (Math.random() < 0.5) bot.pauseUntil = now + rand(...bot.bot.rest);
      if (Math.random() < 0.22) {
        bot.lastRing = now;
        this.broadcast({ t: "e", id: bot.id });
        const events = [];
        liftPeople(this.people(), bot, now, events);
        this.tell(events);
      }
      for (let i = 0; i < LANTERNS.length; i += 1) {
        if (this.lit[i] > now || Math.random() > 0.3) continue;
        if (Math.hypot(bot.x - LANTERNS[i][0], bot.z - LANTERNS[i][1]) < REACH + 1.5) this.light(bot, i, now);
      }
    } else {
      bot.x += (dx / distance) * stride;
      bot.z += (dz / distance) * stride;
      bot.a = Math.atan2(-dx, -dz);
    }
    bot.moved = true;
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.5, (now - this.lastTick) / 1000);
    this.lastTick = now;

    for (const [socket, session] of this.sockets) {
      if (session.player && now - session.player.last > IDLE_MS) this.drop(socket, 4001, "idle");
    }
    if (!this.timer) return;

    // A lantern going out makes the bell worth ringing again.
    if (this.rung && this.lit.some((until) => until <= now)) this.rung = false;

    // The creatures go for people, not for the monks.
    const people = this.people();
    const events = [];
    stepMobs(this.mobs, people, this.lit, now, dt, events);
    stepFox(this.fox, people, now, events);
    this.tell(events);

    const moved = [];
    for (const player of this.players.values()) {
      if (player.bot) this.moveBot(player, now, dt);
      if (!player.moved) continue;
      player.moved = false;
      moved.push([player.id, tidy(player.x), tidy(player.z), tidy(player.a)]);
    }
    const stirred = [];
    for (const mob of this.mobs) {
      if (!mob.moved) continue;
      mob.moved = false;
      stirred.push(this.describeMob(mob));
    }
    if (moved.length || stirred.length) this.broadcast({ t: "s", ps: moved, ms: stirred });
  }
}
