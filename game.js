import * as THREE from "three";
import {
  CENTER, COLORS, HEARTS, LANTERNS, LIFT, MOB_KINDS, PAGODA, REACH, ROUTE, RUN, SPAWN, STANCE, SWING, WALK,
  clamp, dusk, foxSpot, hold, makeMobs, nightOf, smooth, stepFox, stepMobs, strikeMobs,
} from "./shared.js";
import { LAMPS, REFERENCE, shared } from "./paint.js";
import { buildWorld, ground, paved } from "./world.js";
import { animateCreature, animateFox, animatePilgrim, makeCreature, makeFox, makePilgrim, makeSkyLantern } from "./figures.js";
import { makeHands } from "./hands.js";

// Colours here are paint, mixed by eye: nothing is converted on its way to the screen.
THREE.ColorManagement.enabled = false;

// The room server is the Cloudflare Worker in server/.
// Anywhere but the published site, it is `wrangler dev` on the machine serving the page.
const LOCAL = !/(^|\.)cashel\.dev$/.test(location.hostname);
const SERVER = LOCAL
  ? `ws://${location.hostname}:8793`
  : "wss://emberleaf.cashels-account.workers.dev";

const query = new URLSearchParams(location.search);
// `?solo` walks the valley with no server, beside two monks who are only on this page.
const SOLO = query.has("solo");
const PUBLIC_ROOM = "valley";
const NAMES = [
  "Aki", "Momiji", "Kaede", "Rowan", "Hazel", "Juniper", "Alder", "Linden", "Sorrel", "Tansy",
  "Bracken", "Yarrow", "Sable", "Russet", "Amber", "Maple", "Cedar", "Finch", "Heron", "Wick",
];
const COARSE = matchMedia("(pointer: coarse)").matches;
const EYE = 1.62;
const BODY = 0.35;
const DAY_HAZE = new THREE.Vector3(0.863, 0.804, 0.706);
const NIGHT_HAZE = new THREE.Vector3(0.07, 0.085, 0.17);

const $ = (id) => document.getElementById(id);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const css = (index) => `#${COLORS[index].toString(16).padStart(6, "0")}`;

const canvas = $("c");
const players = new Map();
const mobs = new Map();
const bursts = [];
const keys = new Set();
const rings = [];
const stick = { id: null, originX: 0, originY: 0, x: 0, y: 0 };
const gaze = { id: null, x: 0, y: 0, startX: 0, startY: 0, since: 0 };
// The player: where they stand, where they look, and the state of their walk and their hands.
const me = {
  id: 0, x: SPAWN[0], z: SPAWN[1], y: 0, yaw: 0, pitch: 0, a: 0, stride: 0, pace: 0, rung: 9, lifted: 9, swung: 9, c: 0,
  hearts: HEARTS, down: false, downAt: 0, downFor: 0, hurtAt: 0, healAt: 0, spared: 0, mask: -1,
};
// Set from the console or a test to hold the hour still, or the camera, or to skip the clock on.
const debug = { dusk: null, still: false, skip: 0 };

let ws = null;
let room = PUBLIC_ROOM;
let publicIndex = 1;
let myId = 0;
let playing = false;
let clockOffset = 0;
let bestPing = Infinity;
let retries = 0;
let retryTimer = 0;
let asleep = false;
let leaving = false;
let sleepTimer = 0;
let lastSent = 0;
let lastInput = Date.now();
let sentX = 0;
let sentZ = 0;
let sentYaw = 0;
let litCount = 0;
let nearLantern = -1;
let toastTimer = 0;
let gust = 0;
// How red the edge of the picture is from a blow, how dark it is from being struck down, and
// until when the hearts are shown.
let sting = 0;
let dark = 0;
let heartsUntil = 0;
// In a valley with no server the creatures are moved by this page.
let soloMobs = null;
// Struck down: when this player starts again in the lane if nobody lifts them, and whether
// there is anybody who could.
let downUntil = 0;
let downAlone = true;
// The pilgrim lying struck down within reach of a ring, if there is one.
let nearFallen = null;
// While every lantern burns, each person has one paper lantern to let go.
let canRelease = false;
let bells = 0;
let soloRung = false;
// The imps putting lanterns out is explained once.
let snuffTold = false;
// The white fox: the night it last came out, whether it is abroad, who found it, where it sits,
// and the seconds since it came (`seen`) and since it was found (`left`), each -1 when not so.
const fox = { night: -1, out: false, by: 0, figure: null, x: 0, z: 0, a: 0, seen: -1, left: -1, called: 0 };
const skyLanterns = [];

const serverNow = () => Date.now() + clockOffset + debug.skip;

/* Profile */

const profile = { name: "", c: Math.floor(Math.random() * (COLORS.length - 1)), muted: false };

function loadProfile() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("emberleaf-profile")) || {};
  } catch (error) {
    // Private windows may refuse storage.
  }
  if (typeof saved.name === "string") profile.name = saved.name.slice(0, 12);
  if (Number.isInteger(saved.c) && saved.c >= 0 && saved.c < COLORS.length - 1) profile.c = saved.c;
  profile.muted = Boolean(saved.muted);
}

function saveProfile() {
  try {
    localStorage.setItem("emberleaf-profile", JSON.stringify(profile));
  } catch (error) {
    // Nothing to do.
  }
}

loadProfile();

/* Sound: everything is synthesised; there are no audio files */

let audio = null;
let master = null;
let windGain = null;
let noiseBuffer = null;

function wakeAudio() {
  if (audio) {
    if (audio.state === "suspended") audio.resume();
    return;
  }
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  audio = new Context();
  master = audio.createGain();
  master.gain.value = profile.muted ? 0 : 0.9;
  master.connect(audio.destination);
  noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
  // The wind: noise through a low filter, as loud as the gust that passes.
  const wind = audio.createBufferSource();
  wind.buffer = noiseBuffer;
  wind.loop = true;
  const low = audio.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 420;
  windGain = audio.createGain();
  windGain.gain.value = 0.03;
  wind.connect(low).connect(windGain).connect(master);
  wind.start();
}

// Where a sound at (x, z) is heard from: quieter with distance, and to the left or right.
// `carry` is how far it carries: the distance in metres at which it is half as loud.
function heard(x, z, carry = 7) {
  if (x === undefined) return { gain: 1, pan: 0 };
  const dx = x - me.x;
  const dz = z - me.z;
  const distance = Math.hypot(dx, dz);
  const side = (dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw)) / (distance || 1);
  return { gain: 1 / (1 + distance / carry), pan: clamp(side, -1, 1) * Math.min(1, distance / 3) };
}

function voice(place, volume) {
  const gain = audio.createGain();
  gain.gain.value = volume * place.gain;
  const pan = audio.createStereoPanner ? audio.createStereoPanner() : null;
  if (pan) {
    pan.pan.value = place.pan;
    gain.connect(pan).connect(master);
  } else gain.connect(master);
  return gain;
}

function partial(out, frequency, start, length, volume, type = "sine") {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

function burst(out, start, length, volume, frequency, q = 1, type = "bandpass") {
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(filter).connect(gain).connect(out);
  source.start(start, Math.random() * 1.5);
  source.stop(start + length + 0.05);
}

// The staff: a knock on the ground and its rings.
function soundRing(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z), 0.5);
  const now = audio.currentTime;
  burst(out, now + 0.3, 0.12, 0.5, 190, 1.2, "lowpass");
  [1975, 2637, 3136, 2349, 3520].forEach((frequency, i) => {
    partial(out, frequency * (1 + (Math.random() - 0.5) * 0.01), now + 0.31 + i * 0.045, 0.7 - i * 0.07, 0.11);
  });
}

function soundLight(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z), 0.5);
  const now = audio.currentTime;
  burst(out, now, 0.5, 0.25, 900, 0.6);
  partial(out, 392, now + 0.05, 1.6, 0.12);
  partial(out, 587.3, now + 0.12, 1.4, 0.07);
}

// The shrine's bell, when every lantern burns.
function soundBell() {
  if (!audio) return;
  const out = voice(heard(0, -78), 1.1);
  const now = audio.currentTime;
  [[98, 0.4, 7], [196.4, 0.22, 6], [246.8, 0.12, 5], [293.6, 0.14, 4.5], [392.9, 0.07, 3.5], [523, 0.04, 2.5]].forEach(([frequency, volume, length]) => {
    partial(out, frequency, now, length, volume);
  });
  burst(out, now, 0.25, 0.3, 300, 0.8, "lowpass");
}

// A tone that slides from one pitch to another: the voices of the creatures.
function slide(out, from, to, start, length, volume, type = "square") {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + length);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

function soundSwing(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z), 0.35);
  burst(out, audio.currentTime, 0.2, 0.6, 1300, 0.8);
  burst(out, audio.currentTime + 0.05, 0.14, 0.4, 520, 0.9);
}

// The staff landing on a creature, and its cry: lower for an ogre, and falling when it is felled.
function soundHit(x, z, big, dead) {
  if (!audio) return;
  const out = voice(heard(x, z), 0.6);
  const now = audio.currentTime;
  burst(out, now, 0.1, 0.9, 260, 1, "lowpass");
  partial(out, 150, now, 0.14, 0.35, "triangle");
  const pitch = big ? 0.42 : 1;
  if (dead) slide(out, 620 * pitch, 140 * pitch, now + 0.04, 0.5, 0.16);
  else slide(out, 520 * pitch, 760 * pitch, now + 0.03, 0.14, 0.12);
}

function soundCry(x, z, big) {
  if (!audio) return;
  const out = voice(heard(x, z), 0.5);
  const now = audio.currentTime;
  const pitch = big ? 0.4 : 1;
  slide(out, 420 * pitch, 880 * pitch, now, 0.12, 0.1);
  slide(out, 700 * pitch, 560 * pitch, now + 0.14, 0.16, 0.1);
}

function soundHurt(down) {
  if (!audio) return;
  const out = voice({ gain: 1, pan: 0 }, 0.8);
  const now = audio.currentTime;
  burst(out, now, 0.16, 0.9, 180, 1, "lowpass");
  slide(out, 190, down ? 60 : 120, now, down ? 0.9 : 0.22, 0.3, "sawtooth");
}

// An imp starting on a lantern chitters, which is the warning that there is one to stop.
function soundSnuff(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z, 12), 0.5);
  const now = audio.currentTime;
  for (let i = 0; i < 4; i += 1) slide(out, 900 + i * 60, 1300 + i * 60, now + i * 0.085, 0.06, 0.09);
}

// A lantern put out by an imp: a puff, and a note that falls away.
function soundOut(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z, 14), 0.6);
  const now = audio.currentTime;
  burst(out, now, 0.4, 0.5, 1800, 0.6);
  slide(out, 392, 185, now + 0.02, 0.6, 0.1, "sine");
}

// The fox calls, so that it can be found by ear, and chimes when someone reaches it.
function soundFox(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z, 24), 0.8);
  const now = audio.currentTime;
  slide(out, 990, 1480, now, 0.09, 0.1, "triangle");
  slide(out, 1480, 1100, now + 0.13, 0.22, 0.09, "triangle");
}

function soundFound(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z, 24), 0.7);
  const now = audio.currentTime;
  [1318.5, 1568, 1975.5, 2637, 3136].forEach((frequency, i) => partial(out, frequency, now + i * 0.08, 1.3 - i * 0.1, 0.11));
}

// A paper lantern let go: the breath of its flame, and two soft notes.
function soundRelease(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z, 14), 0.6);
  const now = audio.currentTime;
  burst(out, now, 1.1, 0.16, 520, 0.5);
  partial(out, 523.3, now + 0.1, 2.2, 0.07);
  partial(out, 784, now + 0.3, 2, 0.05);
}

// Someone lifted from the ground.
function soundLift(x, z) {
  if (!audio) return;
  const out = voice(heard(x, z), 0.6);
  const now = audio.currentTime;
  partial(out, 392, now, 0.9, 0.1);
  partial(out, 587.3, now + 0.14, 1.1, 0.1);
  partial(out, 784, now + 0.28, 1.4, 0.08);
}

function soundStep(stone) {
  if (!audio) return;
  const out = voice({ gain: 1, pan: (Math.random() - 0.5) * 0.3 }, 0.22);
  const now = audio.currentTime;
  if (stone) burst(out, now, 0.07, 0.5, 1500 + Math.random() * 500, 1.4);
  else {
    burst(out, now, 0.11, 0.42, 620 + Math.random() * 260, 0.8);
    burst(out, now + 0.02, 0.05, 0.25, 3400, 2);
  }
}

/* The picture */

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 0.12, 4200);
camera.rotation.order = "YXZ";
// How much paint the valley is built with: less on phones, or whatever `?paint=` asks for.
const PAINT = clamp(Number(query.get("paint")) || (COARSE ? 0.4 : 1), 0.2, 1.5);
const world = buildWorld(scene, PAINT);
const hands = makeHands();
me.y = ground(me.x, me.z);
fox.figure = makeFox();
fox.figure.group.visible = false;
scene.add(fox.figure.group);

// The finish runs once over the whole picture: a grade that leans the shade to violet and
// the light to warm yellow, the weave of the canvas, and a darkening toward the corners.
const finish = new THREE.ShaderMaterial({
  uniforms: { tScene: { value: null }, uGrain: { value: 1 }, uDusk: shared.uDusk, uSting: { value: 0 }, uDark: { value: 0 } },
  depthTest: false,
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene;
    uniform float uGrain;
    uniform float uDusk;
    uniform float uSting;
    uniform float uDark;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    void main() {
      vec3 c = texture2D(tScene, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(0.95, 0.93, 1.08) + vec3(0.012, 0.006, 0.024), smoothstep(0.42, 0.04, l));
      c = mix(c, c * vec3(1.05, 1.01, 0.93), smoothstep(0.5, 0.95, l));
      c = mix(vec3(l), c, 1.08);
      vec2 p = gl_FragCoord.xy / uGrain;
      c += sin(p.x * 2.094) * sin(p.y * 2.094) * 0.012 + (hash(floor(p)) - 0.5) * 0.022;
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * (0.5 + 0.3 * uDusk);
      c = mix(c, vec3(0.5, 0.03, 0.02), uSting * smoothstep(0.08, 0.5, dot(q, q)));
      c *= 1.0 - 0.94 * uDark;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
});
const finishScene = new THREE.Scene();
const finishCamera = new THREE.Camera();
const finishMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), finish);
finishMesh.frustumCulled = false;
finishScene.add(finishMesh);

let target = null;
// Falls a step at a time while frames are slow.
let sharpness = 1;

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2) * sharpness;
  const width = Math.max(1, Math.round(innerWidth * ratio));
  const height = Math.max(1, Math.round(innerHeight * ratio));
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  if (target) target.dispose();
  target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
  finish.uniforms.tScene.value = target.texture;
  finish.uniforms.uGrain.value = ratio;
  camera.aspect = width / height;
  camera.fov = width > height ? 66 : 80;
  camera.updateProjectionMatrix();
  // Strokes are sized against the picture: REFERENCE pixels span its short side.
  shared.uPixel.value = ((2 * Math.tan((camera.fov * Math.PI) / 360)) / REFERENCE) * Math.min(1, width / height);
  hands.resize(width, height);
}

function render() {
  renderer.setRenderTarget(target);
  renderer.setClearColor(new THREE.Color(shared.uHaze.value.x, shared.uHaze.value.y, shared.uHaze.value.z), 1);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(finishScene, finishCamera);
  if (playing) {
    renderer.clearDepth();
    renderer.render(hands.scene, hands.camera);
  }
}

// The game watches its own frame rate, and draws fewer pixels when it cannot keep up.
let probeStart = 0;
let probeFrames = 0;
let slowProbes = 0;
let lastProbed = 0;

function watchSpeed(time) {
  const gap = time - lastProbed;
  lastProbed = time;
  // A long gap is a hidden tab or a one-off stall, not the speed of the device.
  if (gap > 1000 || sharpness <= 0.5) {
    probeStart = 0;
    return;
  }
  if (!probeStart) {
    probeStart = time;
    probeFrames = 0;
    return;
  }
  probeFrames += 1;
  if (time - probeStart < 2000) return;
  const rate = (probeFrames * 1000) / (time - probeStart);
  probeStart = 0;
  // One slow stretch can be a hiccup; two in a row is the device.
  slowProbes = rate > 40 ? 0 : slowProbes + 1;
  if (slowProbes < 2) return;
  slowProbes = 0;
  sharpness = Math.max(0.5, sharpness * (rate < 24 ? 0.7 : 0.82));
  resize();
}

/* People */

function addPilgrim(data) {
  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = data.name;
  $("tags").append(tag);
  const who = {
    id: data.id, name: data.name, c: data.c, bot: data.bot,
    figure: makePilgrim(COLORS[data.c], data.id),
    x: data.x, z: data.z, a: data.a, tx: data.x, tz: data.z, ta: data.a,
    stride: 0, pace: 0, rung: 9, swung: 9, down: Boolean(data.down), fallen: 0, tag, stop: 0, step: 1,
    // The night whose fox they found, and whether its mask is showing on them now.
    mask: data.mask ?? -1, masked: false,
  };
  scene.add(who.figure.group);
  players.set(who.id, who);
  nameTag(who);
  renderCount();
  return who;
}

// What stands over a pilgrim: their name, and that they have fallen while they lie struck down.
function nameTag(who) {
  who.tag.textContent = who.down ? `${who.name} has fallen` : who.name;
  who.tag.classList.toggle("fallen", who.down);
}

// The fox's mask is worn from the night its fox was found until the next nightfall.
function updateMasks() {
  const night = nightOf(serverNow());
  for (const who of players.values()) {
    const masked = who.mask === night;
    if (masked === who.masked) continue;
    who.masked = masked;
    who.figure.mask.visible = masked;
    who.tag.classList.toggle("fox", masked);
  }
  const mine = playing && me.mask === night;
  if (mine === $("mask").hidden) $("mask").hidden = !mine;
}

function removePilgrim(who) {
  scene.remove(who.figure.group);
  who.figure.group.traverse((node) => {
    if (node.isMesh) node.geometry.dispose();
  });
  who.tag.remove();
  players.delete(who.id);
  renderCount();
}

function clearPilgrims() {
  for (const who of [...players.values()]) removePilgrim(who);
}

const tagPoint = new THREE.Vector3();

function updateTags() {
  for (const who of players.values()) {
    tagPoint.set(who.x, who.figure.group.position.y + 2.05, who.z);
    const distance = tagPoint.distanceTo(camera.position);
    tagPoint.project(camera);
    const shown = playing && tagPoint.z < 1 && distance < 46 && Math.abs(tagPoint.x) < 1.1 && Math.abs(tagPoint.y) < 1.1;
    who.tag.style.opacity = shown ? String(clamp(1.6 - distance / 30)) : "0";
    if (shown) {
      who.tag.style.transform = `translate(${((tagPoint.x + 1) / 2) * innerWidth}px, ${((1 - tagPoint.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    }
  }
}

function renderCount() {
  const here = players.size + (playing ? 1 : 0);
  $("count").innerHTML = `${here} here<small>${litCount} of ${LANTERNS.length} lanterns lit</small>`;
}

/* Creatures */

function addMob([id, x, z, a, stance, k]) {
  const mob = { id, k, x, z, a, tx: x, tz: z, ta: a, stance, since: 9, stride: 0, pace: 0, figure: makeCreature(k, id) };
  scene.add(mob.figure.group);
  mobs.set(id, mob);
}

function clearMobs() {
  for (const mob of mobs.values()) {
    scene.remove(mob.figure.group);
    mob.figure.group.traverse((node) => {
      if (node.isMesh) node.geometry.dispose();
    });
  }
  mobs.clear();
}

// Where the server last saw a creature, and what it is doing.
function placeMob([id, x, z, a, stance]) {
  const mob = mobs.get(id);
  if (!mob) return;
  // One that has come back stands at its home at once.
  if (mob.stance === STANCE.DEAD && stance !== STANCE.DEAD) {
    mob.x = x;
    mob.z = z;
  }
  mob.tx = x;
  mob.tz = z;
  mob.ta = a;
  if (stance !== mob.stance) {
    mob.stance = stance;
    mob.since = 0;
    if (stance === STANCE.SNUFF) soundSnuff(x, z);
  }
}

// Leaves knocked off a creature by a blow.
const burstMaterial = new THREE.PointsMaterial({ color: 0xf08a2a, size: 0.17, transparent: true, depthWrite: false });

function leafBurst(x, y, z, count, colour) {
  const positions = new Float32Array(count * 3);
  const speeds = [];
  for (let i = 0; i < count; i += 1) {
    positions.set([x, y, z], i * 3);
    speeds.push((Math.random() - 0.5) * 5, Math.random() * 4 + 1, (Math.random() - 0.5) * 5);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, burstMaterial.clone());
  if (colour !== undefined) points.material.color.setHex(colour);
  points.frustumCulled = false;
  scene.add(points);
  bursts.push({ points, speeds, age: 0 });
}

function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i -= 1) {
    const item = bursts[i];
    item.age += dt;
    if (item.age > 0.7) {
      scene.remove(item.points);
      item.points.geometry.dispose();
      item.points.material.dispose();
      bursts.splice(i, 1);
      continue;
    }
    const position = item.points.geometry.attributes.position;
    for (let k = 0; k < item.speeds.length; k += 3) {
      item.speeds[k + 1] -= 9 * dt;
      position.array[k] += item.speeds[k] * dt;
      position.array[k + 1] += item.speeds[k + 1] * dt;
      position.array[k + 2] += item.speeds[k + 2] * dt;
    }
    position.needsUpdate = true;
    item.points.material.opacity = 1 - item.age / 0.7;
  }
}

function showHearts() {
  [...$("hearts").children].forEach((heart, i) => heart.classList.toggle("lost", i >= me.hearts));
  heartsUntil = performance.now() + 4000;
}

// Something the creatures did, or that was done to them: from the server, or from this page.
function happen(event) {
  if (event.t === "hit") {
    const mob = mobs.get(event.id);
    if (!mob) return;
    const size = MOB_KINDS[mob.k].size;
    leafBurst(mob.x, mob.figure.group.position.y + 0.6 * size, mob.z, event.dead ? 26 : 12);
    // By 0, it is the peace of the lanterns that felled it, which is quiet.
    if (event.by) soundHit(mob.x, mob.z, mob.k === 1, event.dead);
  } else if (event.t === "cry") {
    const mob = mobs.get(event.id);
    if (mob) soundCry(mob.x, mob.z, mob.k === 1);
  } else if (event.t === "hurt") {
    if (event.id !== myId) return;
    me.hearts = event.hearts;
    sting = 1;
    soundHurt(event.hearts === 0);
    showHearts();
  } else if (event.t === "down") {
    if (event.id === myId) {
      me.down = true;
      downUntil = performance.now() + event.wait;
      downAlone = event.wait < LIFT.wait;
      keys.clear();
      toast("Struck down");
    } else if (players.has(event.id)) {
      const who = players.get(event.id);
      who.down = true;
      nameTag(who);
    }
  } else if (event.t === "rise") {
    const by = event.by === myId ? null : players.get(event.by);
    if (event.id === myId) {
      Object.assign(me, { x: event.x, z: event.z, y: ground(event.x, event.z), down: false, hearts: event.hearts });
      if (event.by) {
        // Lifted where they fell, by someone's ring.
        toast(by ? `${by.name} lifted you up` : "Lifted up");
        soundLift();
      } else Object.assign(me, { yaw: 0, pitch: 0 });
      showHearts();
    } else if (players.has(event.id)) {
      const who = players.get(event.id);
      Object.assign(who, { x: event.x, z: event.z, tx: event.x, tz: event.z, down: false });
      nameTag(who);
      if (event.by) soundLift(who.x, who.z);
      if (event.by === myId) toast(`You lifted ${who.name}`);
    }
  } else if (event.t === "hearts") {
    if (event.id !== myId) return;
    me.hearts = event.hearts;
    showHearts();
  } else if (event.t === "out") {
    // An imp has put a lantern out.
    const lantern = world.lanterns[event.i];
    if (!lantern) return;
    lantern.until = 0;
    soundOut(lantern.x, lantern.z);
    leafBurst(lantern.x, lantern.y, lantern.z, 12, 0x6a625c);
    if (!snuffTold && playing) {
      snuffTold = true;
      toast("An imp has put a lantern out");
    }
  } else if (event.t === "fox") {
    if (event.gone) {
      fox.out = false;
      fox.seen = -1;
      return;
    }
    Object.assign(fox, { night: event.night, out: true, by: 0, seen: 0, left: -1 });
    placeFox();
    if (playing) toast("A white fox is out tonight");
  } else if (event.t === "found") {
    fox.by = event.id;
    fox.left = 0;
    leafBurst(fox.x, ground(fox.x, fox.z) + 0.7, fox.z, 34, 0xffffff);
    soundFound(fox.x, fox.z);
    if (event.id === myId) {
      me.mask = event.night;
      toast("You found the fox · its mask is yours until nightfall");
    } else if (players.has(event.id)) {
      const who = players.get(event.id);
      who.mask = event.night;
      toast(`${who.name} found the fox`);
    }
  }
}

// The fox sits where this night's fox sits, facing the middle of the valley.
function placeFox() {
  [fox.x, fox.z] = foxSpot(fox.night);
  fox.a = Math.atan2(-(CENTER[0] - fox.x), -(CENTER[1] - fox.z));
}

function updateFox(dt, time) {
  if (fox.seen >= 0) fox.seen += dt;
  if (fox.left >= 0) {
    fox.left += dt;
    if (fox.left > 1) fox.left = fox.seen = -1;
  }
  animateFox(fox, dt, time, camera.position.x, camera.position.z);
  // It calls now and then for as long as nobody has found it.
  if (playing && fox.out && !fox.by && time - fox.called > 6.5) {
    fox.called = time;
    soundFox(fox.x, fox.z);
  }
}

/* Paper lanterns let go into the sky */

function releaseLantern(x, y, z) {
  const item = makeSkyLantern();
  item.group.position.set(x, y, z);
  scene.add(item.group);
  skyLanterns.push({ ...item, age: 0, seed: Math.random() * 10 });
  if (skyLanterns.length > 40) dropSkyLantern(0);
}

function dropSkyLantern(i) {
  const [item] = skyLanterns.splice(i, 1);
  scene.remove(item.group);
  item.group.traverse((node) => {
    if (node.isMesh) node.geometry.dispose();
  });
}

function updateSkyLanterns(dt, time) {
  const wind = shared.uWind.value;
  for (let i = skyLanterns.length - 1; i >= 0; i -= 1) {
    const item = skyLanterns[i];
    item.age += dt;
    if (item.age > 80) {
      dropSkyLantern(i);
      continue;
    }
    // It lifts off slowly, and once it is clear of the trees the wind takes it.
    const place = item.group.position;
    const taken = smooth(2, 14, item.age);
    place.y += (0.3 + 0.9 * (1 - Math.exp(-item.age / 3))) * dt;
    place.x += (wind.x * 0.9 * taken + Math.sin(time * 0.6 + item.seed) * 0.16) * dt;
    place.z += (wind.y * 0.9 * taken + Math.cos(time * 0.5 + item.seed * 2) * 0.16) * dt;
    item.group.rotation.set(Math.sin(time * 0.8 + item.seed) * 0.07, item.age * 0.25 + item.seed, Math.cos(time * 0.7 + item.seed) * 0.07);
    const fade = 1 - smooth(62, 80, item.age);
    item.group.scale.setScalar(Math.max(0.001, smooth(0, 0.7, item.age) * (0.35 + 0.65 * fade)));
    item.glow.material.opacity = (0.8 + Math.sin(time * 7 + item.seed * 5) * 0.08) * fade;
  }
}

function clearSkyLanterns() {
  while (skyLanterns.length) dropSkyLantern(0);
}

// Someone has let their lantern go: from before them, at the height of their hands.
function letGo(id, x, z) {
  const who = players.get(id);
  if (id === myId) {
    releaseLantern(me.x - Math.sin(me.yaw) * 1.5, me.y + 0.7, me.z - Math.cos(me.yaw) * 1.5);
    soundRelease();
  } else {
    const [px, pz, a] = who ? [who.x, who.z, who.a] : [x, z, 0];
    const fx = px - Math.sin(a) * 1;
    const fz = pz - Math.cos(a) * 1;
    releaseLantern(fx, ground(fx, fz) + 0.9, fz);
    soundRelease(px, pz);
  }
}

// A swing of the staff: at whatever stands before the player.
function swing() {
  if (!playing || me.down || me.swung < SWING.every / 1000) return;
  wakeAudio();
  lastInput = Date.now();
  me.swung = 0;
  soundSwing();
  if (!SOLO) return send({ t: "w", a: Number(me.yaw.toFixed(2)) });
  const events = [];
  me.a = me.yaw;
  strikeMobs(soloMobs, me, serverNow(), events);
  events.forEach(happen);
}

/* Lanterns and rings */

function updateLanterns(clock, time, night) {
  let lit = 0;
  for (const lantern of world.lanterns) {
    const on = lantern.until > clock;
    if (on !== lantern.lit) {
      lantern.lit = on;
      lantern.pane.material.color.setHex(on ? 0xffd27a : 0x15100c);
      lantern.glow.visible = on;
    }
    if (!on) continue;
    lit += 1;
    lantern.glow.material.opacity = 0.62 + 0.3 * night + Math.sin(time * 8 + lantern.index * 2.1) * 0.06;
    lantern.glow.scale.setScalar(3 + 2.2 * night);
  }
  if (lit !== litCount) {
    litCount = lit;
    renderCount();
  }
  // The lanterns to let go are for while every stone lantern burns.
  if (lit < LANTERNS.length) canRelease = soloRung = false;
}

// What burns now, for the paint to be lit by: the stone lanterns, and everybody's own.
function updateLamps(time) {
  const lamps = shared.uLamps.value;
  let count = 0;
  const flicker = (seed) => 1 + Math.sin(time * 9 + seed * 2.3) * 0.05 + Math.sin(time * 23 + seed) * 0.03;
  if (playing) {
    lamps[count++].set(
      camera.position.x - Math.sin(me.yaw) * 0.5 - Math.cos(me.yaw) * 0.35, camera.position.y - 0.3,
      camera.position.z - Math.cos(me.yaw) * 0.5 + Math.sin(me.yaw) * 0.35, 0.7 * flicker(0),
    );
  }
  for (const lantern of world.lanterns) {
    if (lantern.lit && count < LAMPS) lamps[count++].set(lantern.x, lantern.y, lantern.z, 1.15 * flicker(lantern.index + 1));
  }
  for (const who of players.values()) {
    if (count >= LAMPS) break;
    const lamp = who.figure.lamp;
    lamps[count++].set(lamp.x, lamp.y, lamp.z, 0.62 * flicker(who.id + 20));
  }
  shared.uLampCount.value = count;
}

const ringGeometry = new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2);

function ringAt(x, z) {
  const mesh = new THREE.Mesh(
    ringGeometry,
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.position.set(x, ground(x, z) + 0.14, z);
  scene.add(mesh);
  rings.push({ mesh, age: 0 });
}

function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i -= 1) {
    const ring = rings[i];
    ring.age += dt;
    const k = ring.age / 1.5;
    if (k >= 1) {
      scene.remove(ring.mesh);
      ring.mesh.material.dispose();
      rings.splice(i, 1);
      continue;
    }
    const size = 0.4 + 7 * (1 - (1 - k) * (1 - k));
    ring.mesh.scale.set(size, 1, size);
    ring.mesh.material.opacity = 0.7 * (1 - k);
  }
}

function rang(id) {
  if (id === myId) {
    ringAt(me.x, me.z);
    soundRing();
    return;
  }
  const who = players.get(id);
  if (!who) return;
  who.rung = 0;
  // The ring leaves the ground as the staff comes down.
  setTimeout(() => {
    if (!players.has(id)) return;
    ringAt(who.x, who.z);
  }, 300);
  soundRing(who.x, who.z);
}

function lit(i, until, by) {
  const lantern = world.lanterns[i];
  if (!lantern) return;
  lantern.until = until;
  soundLight(by === myId ? undefined : lantern.x, lantern.z);
  // A valley with no server rings its own bell.
  if (SOLO && !soloRung && world.lanterns.every((each) => each.until > serverNow())) {
    soloRung = true;
    bell(bells + 1);
  }
}

// Every lantern burns: the bell rings, a paper lantern goes up from each stone one in turn, from
// the lane to the shrine, and then a flight of them from the shrine itself. Everyone here has one
// of their own to let go.
function bell(count) {
  bells = count || bells;
  toast("Every lantern is lit");
  soundBell();
  gust = 1;
  canRelease = true;
  const flight = myId;
  const later = (ms, x, y, z) => setTimeout(() => {
    if (myId === flight) releaseLantern(x, y, z);
  }, ms);
  world.lanterns.forEach((lantern, i) => later(700 + i * 420 + Math.random() * 200, lantern.x, lantern.y + 0.9, lantern.z));
  for (let i = 0; i < 12; i += 1) {
    const a = i * 2.4 + Math.random() * 0.4;
    const x = PAGODA.x + Math.cos(a) * 11;
    const z = PAGODA.z + Math.sin(a) * 11;
    later(6500 + i * 800 + Math.random() * 500, x, ground(x, z) + 1, z);
  }
}

// The dark lantern within reach, if there is one.
function lanternInReach() {
  const clock = serverNow();
  let best = -1;
  let bestDistance = REACH;
  for (const lantern of world.lanterns) {
    if (lantern.until > clock) continue;
    const distance = Math.hypot(lantern.x - me.x, lantern.z - me.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = lantern.index;
    }
  }
  return best;
}

// The one key does whatever is to hand: lifts someone who lies beside the player, lights a dark
// lantern, lets a paper lantern go, or else rings the staff.
function act() {
  if (!playing) return;
  wakeAudio();
  lastInput = Date.now();
  if (me.down) {
    // Done waiting to be lifted: start again in the lane.
    if (!downAlone && performance.now() < downUntil - 400) {
      downUntil = performance.now();
      send({ t: "up" });
    }
    return;
  }
  if (nearLantern >= 0 && !nearFallen) {
    if (me.lifted < 0.9) return;
    me.lifted = 0;
    if (SOLO) lit(nearLantern, serverNow() + 240000, myId);
    else send({ t: "l", i: nearLantern });
  } else if (canRelease && !nearFallen) {
    if (me.lifted < 0.9) return;
    me.lifted = 0;
    canRelease = false;
    if (SOLO) letGo(myId);
    else send({ t: "k" });
  } else {
    if (me.rung < 0.55) return;
    me.rung = 0;
    if (SOLO) setTimeout(() => rang(myId), 300);
    else send({ t: "e" });
  }
}

// The nearest pilgrim who lies struck down within reach of a ring.
function fallenInReach() {
  let best = null;
  let bestDistance = LIFT.reach - 0.4;
  for (const who of players.values()) {
    if (!who.down) continue;
    const distance = Math.hypot(who.x - me.x, who.z - me.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = who;
    }
  }
  return best;
}

/* Walking */

function steer(dt) {
  let x = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
  let y = (keys.has("up") ? 1 : 0) - (keys.has("down") ? 1 : 0);
  if (!x && !y && stick.id !== null) {
    x = stick.x;
    y = -stick.y;
  }
  // Struck down, they lie where they fell.
  if (me.down) x = y = 0;
  const push = Math.min(1, Math.hypot(x, y));
  let speed = 0;
  if (push > 0.06) {
    lastInput = Date.now();
    const length = Math.hypot(x, y);
    const fast = keys.has("run") || (stick.id !== null && push > 0.92);
    speed = (fast ? RUN : WALK) * push;
    const sin = Math.sin(me.yaw);
    const cos = Math.cos(me.yaw);
    let nx = me.x + ((cos * x - sin * y) / length) * speed * dt;
    let nz = me.z + ((-sin * x - cos * y) / length) * speed * dt;
    for (const solid of world.colliders) {
      if (solid.r) {
        const gx = nx - solid.x;
        const gz = nz - solid.z;
        const gap = Math.hypot(gx, gz);
        const reach = solid.r + BODY;
        if (gap < reach && gap > 1e-4) {
          nx = solid.x + (gx / gap) * reach;
          nz = solid.z + (gz / gap) * reach;
        }
      } else if (nx > solid.x0 - BODY && nx < solid.x1 + BODY && nz > solid.z0 - BODY && nz < solid.z1 + BODY) {
        // Out through the nearest wall.
        const out = [nx - (solid.x0 - BODY), solid.x1 + BODY - nx, nz - (solid.z0 - BODY), solid.z1 + BODY - nz];
        const least = out.indexOf(Math.min(...out));
        if (least === 0) nx = solid.x0 - BODY;
        else if (least === 1) nx = solid.x1 + BODY;
        else if (least === 2) nz = solid.z0 - BODY;
        else nz = solid.z1 + BODY;
      }
    }
    [me.x, me.z] = hold(nx, nz);
  }
  me.pace += (clamp(speed / WALK, 0, 1.4) - me.pace) * (1 - Math.exp(-dt * 9));
  const before = Math.floor(me.stride / Math.PI);
  me.stride += speed * dt * 2.7;
  if (Math.floor(me.stride / Math.PI) !== before) soundStep(paved(me.x, me.z) === 2);
  // The eye eases to the ground, so the steps are climbed and not jolted up.
  me.y += (ground(me.x, me.z) - me.y) * (1 - Math.exp(-dt * 13));
}

function report() {
  const clock = Date.now();
  if (clock - lastSent < 80) return;
  if (Math.hypot(me.x - sentX, me.z - sentZ) < 0.02 && Math.abs(me.yaw - sentYaw) < 0.03) return;
  lastSent = clock;
  sentX = me.x;
  sentZ = me.z;
  sentYaw = me.yaw;
  send({ t: "p", x: Number(me.x.toFixed(2)), z: Number(me.z.toFixed(2)), a: Number(me.yaw.toFixed(2)) });
}

function placeCamera(time) {
  if (debug.still) return;
  if (playing) {
    // Struck down, the eye sinks to the ground and rolls over.
    camera.position.set(me.x, me.y + EYE - dark * 1.25 + Math.abs(Math.sin(me.stride)) * 0.016 * Math.min(1, me.pace), me.z);
    camera.rotation.set(me.pitch, me.yaw, dark * 0.55 + sting * 0.02);
  } else {
    // Before walking in: a slow look up the path from where everyone arrives.
    camera.position.set(SPAWN[0], ground(SPAWN[0], SPAWN[1] + 4) + 2.1, SPAWN[1] + 4);
    camera.rotation.set(0.05, Math.sin(time * 0.09) * 0.2 + 0.05, 0);
  }
}

// The monks of a valley with no server.
function soloMonks(dt) {
  for (const who of players.values()) {
    const goal = ROUTE[who.stop];
    const dx = goal[0] - who.tx;
    const dz = goal[1] - who.tz;
    const distance = Math.hypot(dx, dz);
    const stride = 2.3 * dt;
    if (distance <= stride) {
      if (who.stop + who.step < 0 || who.stop + who.step >= ROUTE.length) who.step = -who.step;
      who.stop += who.step;
    } else {
      who.tx += (dx / distance) * stride;
      who.tz += (dz / distance) * stride;
      who.ta = Math.atan2(-dx, -dz);
    }
  }
}

/* Frame */

let lastFrame = 0;

function advance(dt, time) {
  shared.uTime.value = time;
  const night = debug.dusk ?? dusk(serverNow());
  shared.uDusk.value = night;
  shared.uHaze.value.lerpVectors(DAY_HAZE, NIGHT_HAZE, night);
  gust = Math.max(0, gust - dt / 9);
  shared.uGust.value = gust * 0.5;
  if (windGain) windGain.gain.value = 0.028 + 0.03 * (0.5 + 0.5 * Math.sin(time * 0.31)) + gust * 0.08;
  if (playing) {
    steer(dt);
    if (!SOLO) report();
    nearLantern = lanternInReach();
    nearFallen = me.down ? null : fallenInReach();
    me.rung += dt;
    me.lifted += dt;
    me.swung += dt;
  }
  if (SOLO) {
    soloMonks(dt);
    // The same rules the room server runs, for a valley of one.
    const events = [];
    stepMobs(soloMobs, playing ? [me] : [], world.lanterns.map((lantern) => lantern.until), serverNow(), dt, events);
    stepFox(fox, playing ? [me] : [], serverNow(), events);
    for (const mob of soloMobs) {
      if (!mob.moved) continue;
      mob.moved = false;
      placeMob([mob.id, mob.x, mob.z, mob.a, mob.stance]);
    }
    events.forEach(happen);
  }
  sting = Math.max(0, sting - dt * 2.2);
  // Struck down with nobody to lift them, the picture goes dark; waiting to be lifted, they watch from the ground.
  dark += ((me.down ? (downAlone ? 1 : 0.6) : 0) - dark) * (1 - Math.exp(-dt * 4));
  finish.uniforms.uSting.value = sting;
  finish.uniforms.uDark.value = dark;
  $("hearts").classList.toggle("show", playing && (me.hearts < HEARTS || performance.now() < heartsUntil));
  placeCamera(time);
  world.update(camera.position);
  for (const who of players.values()) animatePilgrim(who, dt, time);
  for (const mob of mobs.values()) animateCreature(mob, dt);
  updateFox(dt, time);
  updateMasks();
  updateSkyLanterns(dt, time);
  updateBursts(dt);
  updateLanterns(serverNow(), time, night);
  updateLamps(time);
  updateRings(dt);
  updateTags();
  updatePrompt();
  hands.update(time, { stride: me.stride, walk: Math.min(1, me.pace), rung: me.rung, lifted: me.lifted, swung: me.swung, night });
  render();
}

function frame(time) {
  requestAnimationFrame(frame);
  const seconds = time / 1000;
  const dt = Math.min(0.1, Math.max(0, seconds - lastFrame));
  lastFrame = seconds;
  advance(dt, seconds);
  watchSpeed(time);
}

/* Words on the screen */

function toast(text) {
  const element = $("toast");
  element.textContent = text;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}

let promptShown = null;

// What the one key would do now, said at the foot of the picture. On a touch screen the round
// button glows instead of naming a key.
function updatePrompt() {
  let wanted = "";
  let key = "E";
  let text = "";
  if (!playing) wanted = "";
  else if (me.down) {
    if (!downAlone) {
      const left = Math.max(0, Math.ceil((downUntil - performance.now()) / 1000));
      wanted = `down ${left}`;
      text = `${COARSE ? "Press the round button to start" : "Start"} again now, or wait ${left}s for someone to ring their staff beside you`;
    }
  } else if (nearFallen) {
    wanted = `lift ${nearFallen.id}`;
    text = `Ring to lift ${nearFallen.name}`;
  } else if (nearLantern >= 0) {
    wanted = "light";
    text = "Light the lantern";
  } else if (canRelease) {
    wanted = "release";
    text = "Let your lantern go";
  } else if (document.pointerLockElement !== canvas && !COARSE && !SOLO) {
    wanted = "look";
    key = "";
    text = "Click to look around";
  }
  $("act").classList.toggle("light", Boolean(wanted) && wanted !== "look");
  if (wanted === promptShown) return;
  promptShown = wanted;
  const prompt = $("prompt");
  prompt.hidden = !wanted || (COARSE && wanted === "light");
  prompt.replaceChildren();
  if (key && !COARSE) {
    const cap = document.createElement("b");
    cap.textContent = key;
    prompt.append(cap);
  }
  prompt.append(text);
}

function showStatus(title, text, action) {
  $("status-title").textContent = title;
  $("status-text").textContent = text;
  $("status-action").textContent = action;
  $("status-action").hidden = !action;
  $("status").hidden = false;
}

function showGame(shown) {
  playing = shown;
  $("hud").hidden = !shown;
  $("act").hidden = !shown || !COARSE;
  if (!shown) {
    $("prompt").hidden = true;
    promptShown = null;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  renderCount();
}

/* Network */

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function handle(message) {
  if (message.t === "welcome") {
    retries = 0;
    clockOffset = message.now - Date.now();
    bestPing = Infinity;
    myId = message.id;
    me.id = myId;
    Object.assign(me, { hearts: HEARTS, down: false, mask: -1 });
    clearPilgrims();
    clearMobs();
    clearSkyLanterns();
    message.mobs.forEach(addMob);
    bells = message.bells;
    canRelease = Boolean(message.peace);
    // The fox, if it is out and nobody has found it, is already sitting where it sits tonight.
    Object.assign(fox, message.fox, { seen: message.fox.out && !message.fox.by ? 5 : -1, left: -1 });
    if (fox.out) placeFox();
    for (const data of message.players) {
      if (data.id !== myId) {
        addPilgrim(data);
        continue;
      }
      me.x = data.x;
      me.z = data.z;
      me.y = ground(me.x, me.z);
      me.yaw = 0;
      me.pitch = 0;
      me.c = data.c;
      hands.dress(COLORS[data.c]);
      if (data.c !== profile.c) toast("That robe was taken, so here is another");
    }
    message.lit.forEach((until, i) => {
      if (world.lanterns[i]) world.lanterns[i].until = until;
    });
    $("start").hidden = true;
    $("status").hidden = true;
    showGame(true);
    // Take the mouse now that they are in. If the browser refuses, a click on the valley will.
    if (!COARSE && canvas.requestPointerLock) {
      const asked = canvas.requestPointerLock();
      if (asked && asked.catch) asked.catch(() => {});
    }
    for (let i = 0; i < 3; i += 1) setTimeout(() => send({ t: "ping", c: Date.now(), here: true }), 200 + i * 400);
  } else if (!myId) {
    return;
  } else if (message.t === "s") {
    for (const [id, x, z, a] of message.ps) {
      const who = players.get(id);
      if (!who) continue;
      who.tx = x;
      who.tz = z;
      who.ta = a;
    }
    for (const mob of message.ms || []) placeMob(mob);
  } else if (message.t === "w") {
    const who = players.get(message.id);
    if (!who) return;
    who.swung = 0;
    soundSwing(who.x, who.z);
  } else if (["hit", "cry", "hurt", "down", "rise", "hearts", "out", "fox", "found"].includes(message.t)) {
    happen(message);
  } else if (message.t === "sky") {
    letGo(message.id, message.x, message.z);
  } else if (message.t === "join") {
    if (message.p.id !== myId && !players.has(message.p.id)) {
      addPilgrim(message.p);
      if (!message.p.bot) toast(`${message.p.name} walks in`);
    }
  } else if (message.t === "leave") {
    const who = players.get(message.id);
    if (who) removePilgrim(who);
  } else if (message.t === "e") {
    rang(message.id);
  } else if (message.t === "l") {
    lit(message.i, message.until, message.by);
  } else if (message.t === "bell") {
    bell(message.n);
  } else if (message.t === "pong") {
    const ping = Date.now() - message.c;
    if (ping < bestPing) {
      bestPing = ping;
      clockOffset = message.now + ping / 2 - Date.now();
    }
  }
}

function closed(code) {
  clearPilgrims();
  clearMobs();
  clearSkyLanterns();
  myId = 0;
  me.down = false;
  me.mask = -1;
  canRelease = false;
  Object.assign(fox, { out: false, seen: -1, left: -1 });
  stick.id = null;
  $("stick").hidden = true;
  keys.clear();
  showGame(false);
  if (leaving) {
    // Back to the start, with their robe free for someone else.
    leaving = false;
    $("status").hidden = true;
    $("start").hidden = false;
    showKept();
    return;
  }
  if (asleep) return;
  if (code === 4001) {
    showStatus("Still there?", "You stood so still that the valley let your place go.", "Return");
  } else if (code === 4002) {
    if (!room.startsWith(PUBLIC_ROOM)) toast("That valley is full");
    publicIndex = room.startsWith(PUBLIC_ROOM) ? publicIndex + 1 : 1;
    enter(publicIndex > 1 ? `${PUBLIC_ROOM}-${publicIndex}` : PUBLIC_ROOM);
  } else if (retries < 4) {
    showStatus("One moment", "Finding the valley again.", "");
    retryTimer = setTimeout(connect, 500 * 2 ** retries);
    retries += 1;
  } else {
    retries = 0;
    showStatus("Out of reach", "The valley isn’t answering. Check your connection and try again.", "Try again");
  }
}

function connect() {
  clearTimeout(retryTimer);
  const socket = new WebSocket(`${SERVER}/r/${room}`);
  ws = socket;
  socket.onopen = () => send({ t: "hi", name: profile.name, c: profile.c });
  socket.onmessage = (event) => {
    if (ws === socket) handle(JSON.parse(event.data));
  };
  socket.onclose = (event) => {
    if (ws !== socket) return;
    ws = null;
    closed(event.code);
  };
}

function enter(name) {
  room = name;
  const url = new URL(location.href);
  if (room.startsWith(PUBLIC_ROOM)) url.searchParams.delete("room");
  else url.searchParams.set("room", room);
  history.replaceState(null, "", url);
  connect();
}

// Someone at the controls is here; someone who has wandered off is let go by the server.
setInterval(() => {
  if (myId) send({ t: "ping", c: Date.now(), here: Date.now() - lastInput < 150000 });
}, 20000);

// A hidden tab gives up its place after a minute, and takes one again when it is back.
document.addEventListener("visibilitychange", () => {
  clearTimeout(sleepTimer);
  if (document.hidden) {
    if (!ws) return;
    sleepTimer = setTimeout(() => {
      asleep = true;
      if (ws) ws.close();
    }, 60000);
  } else if (asleep) {
    asleep = false;
    connect();
  }
});

/* Controls */

const KEYS = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down", ShiftLeft: "run", ShiftRight: "run",
};

function look(dx, dy, rate) {
  me.yaw -= dx * rate;
  me.pitch = clamp(me.pitch - dy * rate, -1.25, 1.25);
  lastInput = Date.now();
}

addEventListener("keydown", (event) => {
  if (event.target === $("name")) {
    if (event.key === "Enter") $("play").click();
    return;
  }
  if (!playing) return;
  if (KEYS[event.code]) {
    keys.add(KEYS[event.code]);
    event.preventDefault();
  } else if ((event.code === "Space" || event.code === "KeyE") && !event.repeat) {
    act();
    event.preventDefault();
  } else if (event.code === "KeyF" && !event.repeat) {
    swing();
  } else if (event.code === "KeyM" && !event.repeat) {
    $("sound").click();
  }
});
addEventListener("keyup", (event) => keys.delete(KEYS[event.code]));
addEventListener("blur", () => keys.clear());

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement === canvas) look(event.movementX, event.movementY, 0.0022);
});

canvas.addEventListener("pointerdown", (event) => {
  if (!playing) return;
  wakeAudio();
  if (event.pointerType !== "touch") {
    // The first click takes the mouse, and later ones swing the staff.
    if (document.pointerLockElement === canvas) swing();
    else if (canvas.requestPointerLock) {
      const asked = canvas.requestPointerLock();
      if (asked && asked.catch) asked.catch(() => {});
    }
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  if (event.clientX < innerWidth * 0.5 && stick.id === null) {
    Object.assign(stick, { id: event.pointerId, originX: event.clientX, originY: event.clientY, x: 0, y: 0 });
    const element = $("stick");
    element.hidden = false;
    element.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    element.firstElementChild.style.transform = "";
  } else if (gaze.id === null) {
    Object.assign(gaze, { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, since: performance.now() });
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId === stick.id) {
    const reach = 54;
    let dx = event.clientX - stick.originX;
    let dy = event.clientY - stick.originY;
    const length = Math.hypot(dx, dy);
    if (length > reach) {
      dx = (dx / length) * reach;
      dy = (dy / length) * reach;
    }
    stick.x = dx / reach;
    stick.y = dy / reach;
    $("stick").firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  } else if (event.pointerId === gaze.id) {
    look(event.clientX - gaze.x, event.clientY - gaze.y, 0.0052);
    gaze.x = event.clientX;
    gaze.y = event.clientY;
  }
});

function release(event) {
  if (event.pointerId === stick.id) {
    stick.id = null;
    $("stick").hidden = true;
  } else if (event.pointerId === gaze.id) {
    gaze.id = null;
    // A tap, not a drag: swing the staff.
    if (Math.hypot(event.clientX - gaze.startX, event.clientY - gaze.startY) < 9 && performance.now() - gaze.since < 260) swing();
  }
}
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

$("act").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  act();
});

$("sound").addEventListener("click", () => {
  profile.muted = !profile.muted;
  saveProfile();
  wakeAudio();
  if (master) master.gain.value = profile.muted ? 0 : 0.9;
  $("sound").setAttribute("aria-pressed", String(profile.muted));
});
$("sound").setAttribute("aria-pressed", String(profile.muted));

$("leave").addEventListener("click", () => {
  if (SOLO) return;
  leaving = true;
  if (ws) ws.close();
  else closed(1000);
});

$("invite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast(room.startsWith(PUBLIC_ROOM) ? "Link copied" : "Link to this valley copied");
  } catch (error) {
    toast(location.href.replace(/^https?:\/\//, ""));
  }
});

$("status-action").addEventListener("click", () => {
  $("status").hidden = true;
  connect();
});

/* The start screen */

function roomCode() {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += pick(letters);
  return code;
}

const invited = (query.get("room") || "").toLowerCase();
const invitedRoom = /^[a-z0-9-]{1,24}$/.test(invited) && !invited.startsWith(PUBLIC_ROOM) ? invited : "";

function start(name) {
  const typed = $("name").value.replace(/\s+/g, " ").trim().slice(0, 12);
  profile.name = typed || pick(NAMES);
  saveProfile();
  wakeAudio();
  $("start").hidden = true;
  enter(name);
}

function showChoice() {
  [...$("swatches").children].forEach((button, index) => {
    button.setAttribute("aria-checked", String(index === profile.c));
    button.tabIndex = index === profile.c ? 0 : -1;
  });
}

for (let index = 0; index < COLORS.length - 1; index += 1) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "radio");
  button.setAttribute("aria-label", `Robe colour ${index + 1}`);
  button.style.background = css(index);
  button.addEventListener("click", () => {
    profile.c = index;
    saveProfile();
    showChoice();
  });
  $("swatches").append(button);
}
showChoice();

$("name").value = profile.name;
if (invitedRoom) {
  $("play").textContent = "Join them";
  $("friends").textContent = "Public valley";
}
// What the start screen says of the valley they are about to walk into: how often every lantern
// has burned there at once, and how many people are in it now.
async function showKept() {
  if (SOLO) return;
  try {
    const reply = await fetch(`${SERVER.replace(/^ws/, "http")}/r/${invitedRoom || PUBLIC_ROOM}/stats`);
    const stats = await reply.json();
    const times = stats.bells === 1 ? "once" : `${stats.bells} times`;
    const kept = stats.bells ? `All twelve lanterns have been lit here ${times}` : "Nobody has lit all twelve lanterns here yet";
    $("kept").textContent = stats.here ? `${kept} · ${stats.here} walking now` : kept;
    $("kept").hidden = false;
  } catch (error) {
    // The valley is out of reach, so the start screen says nothing of it.
  }
}
showKept();

$("play").addEventListener("click", () => start(invitedRoom || PUBLIC_ROOM));
$("friends").addEventListener("click", () => start(invitedRoom ? PUBLIC_ROOM : roomCode()));

// The hearts and the fox's mask: pixel sprites, like the hands. Each letter of `rows` is a
// colour of `paints`, a dot is nothing, and the whole has an edge one pixel wide.
function pixelImage(rows, paints, edge) {
  const sprite = document.createElement("canvas");
  sprite.width = rows[0].length + 2;
  sprite.height = rows.length + 2;
  const g = sprite.getContext("2d");
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      g.fillStyle = edge;
      g.fillRect(x, y, 3, 3);
    });
  });
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      g.fillStyle = paints[cell];
      g.fillRect(x + 1, y + 1, 1, 1);
    });
  });
  return `url(${sprite.toDataURL()})`;
}
const HEART = [".XX..XX.", "XLXXXXXX", "XLXXXXXX", "XXXXXXXX", ".XXXXXX.", "..XXXX..", "...XX..."];
const MASK = ["X.........X", "XX.......XX", "XRX.....XRX", "XXXXXXXXXXX", "XXKXXXXXKXX", "XRXXXXXXXRX", ".XXXXKXXXX.", "..XXXXXXX..", "....XXX...."];
document.documentElement.style.setProperty("--heart", pixelImage(HEART, { X: "#d8321e", L: "#ff9a6a" }, "#2a0a08"));
document.documentElement.style.setProperty("--heart-lost", pixelImage(HEART, { X: "#3a2a2a", L: "#4a3a3a" }, "#1a1010"));
document.documentElement.style.setProperty("--mask", pixelImage(MASK, { X: "#f6f0e4", R: "#d8321e", K: "#2a1a1a" }, "#2a1a1a"));
for (let i = 0; i < HEARTS; i += 1) $("hearts").append(document.createElement("i"));

addEventListener("resize", resize);
resize();

if (SOLO) {
  $("start").hidden = true;
  myId = -1;
  me.id = myId;
  soloMobs = makeMobs();
  soloMobs.forEach((mob) => addMob([mob.id, mob.x, mob.z, mob.a, mob.stance, mob.k]));
  hands.dress(COLORS[profile.c]);
  [[1, "Marvin", 9], [2, "Trillian", 16]].forEach(([id, name, stop]) => {
    const who = addPilgrim({ id, name, c: COLORS.length - 1, bot: true, x: ROUTE[stop][0], z: ROUTE[stop][1], a: 0 });
    who.stop = stop;
  });
  showGame(true);
}

// For looking at the valley from the console, and for tests.
window.game = {
  me, players, mobs, world, shared, debug, camera, swing, act, fox, skyLanterns, happen,
  get soloMobs() {
    return soloMobs;
  },
  get canRelease() {
    return canRelease;
  },
  get bells() {
    return bells;
  },
  /** place the eye, draw one frame, and return it as a PNG data URL */
  snap(pose = {}, time = 3) {
    debug.still = true;
    if (pose.dusk !== undefined) debug.dusk = pose.dusk;
    camera.position.set(pose.x ?? me.x, pose.y ?? ground(pose.x ?? me.x, pose.z ?? me.z) + EYE, pose.z ?? me.z);
    camera.rotation.set(pose.pitch ?? 0, pose.yaw ?? 0, 0);
    advance(0, time);
    return canvas.toDataURL("image/png");
  },
  /** how many dabs the valley holds, and how many were drawn in the last frame */
  get paint() {
    return { all: world.dabs, drawn: world.drawn };
  },
};

canvas.classList.add("ready");
requestAnimationFrame(frame);
