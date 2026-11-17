import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, "/");

// Cada color: tono, ángulo donde empieza su cuadrante, tecla y sonido
const COLORS = {
  red: { hex: 0xef4444, start: Math.PI / 2, key: "q", sound: "1.mp3" },
  blue: { hex: 0x3b82f6, start: 0, key: "w", sound: "2.mp3" },
  green: { hex: 0x22c55e, start: Math.PI, key: "a", sound: "3.mp3" },
  yellow: { hex: 0xeab308, start: Math.PI * 1.5, key: "s", sound: "4.mp3" },
};
const COLOR_NAMES = Object.keys(COLORS);
const ERROR_RED = new THREE.Color(0xdc2626);

const FLASH_MS = 400; // tiempo que un color permanece encendido
const STEP_MS = 800; // separación entre colores de la secuencia
const LEAD_IN_MS = 600; // pausa antes de mostrar la secuencia

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Escena, cámara y renderizado
// ---------------------------------------------------------------------------

const canvas = document.getElementById("scene");
const maxLevelDisplay = document.getElementById("maxLevelDisplay");
const statusEl = document.getElementById("status");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d14);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

// Postprocesado: el "bloom" hace que los colores encendidos brillen como neón
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.2, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Luces
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(-4, 6, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x6688ff, 0.8);
rimLight.position.set(5, -4, -2);
scene.add(rimLight);
// Luz que toma el color del cuadrante activo y tiñe el tablero
const flashLight = new THREE.PointLight(0xffffff, 0, 14, 2);
flashLight.position.set(0, 0, 3);
scene.add(flashLight);

// ---------------------------------------------------------------------------
// Fondo: campo de estrellas
// ---------------------------------------------------------------------------

const dotTexture = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

const stars = (() => {
  const count = 1500;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 25 + Math.random() * 45;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi) - 20;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.35,
    map: dotTexture,
    color: 0x8899bb,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
})();
scene.add(stars);

// ---------------------------------------------------------------------------
// Tablero
// ---------------------------------------------------------------------------

const board = new THREE.Group();
scene.add(board);

const R_IN = 1.18;
const R_OUT = 3.2;
const GAP = 0.07;

// Base oscura sobre la que descansan los cuadrantes
const base = new THREE.Mesh(
  new THREE.CylinderGeometry(3.45, 3.6, 0.5, 128),
  new THREE.MeshStandardMaterial({
    color: 0x1b1f2a,
    roughness: 0.55,
    metalness: 0.5,
  })
);
base.rotation.x = Math.PI / 2;
base.position.z = -0.35;
board.add(base);

// Geometría de un cuadrante: un sector de anillo extruido con bordes biselados
function sectorGeometry(a0, a1) {
  const s = new THREE.Shape();
  s.moveTo(Math.cos(a0) * R_OUT, Math.sin(a0) * R_OUT);
  s.absarc(0, 0, R_OUT, a0, a1, false);
  s.lineTo(Math.cos(a1) * R_IN, Math.sin(a1) * R_IN);
  s.absarc(0, 0, R_IN, a1, a0, true);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 5,
    curveSegments: 48,
  });
}

// Luminancia relativa de un color (THREE.Color guarda valores lineales)
function luminance(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

// El verde y el amarillo son mucho más luminosos que el rojo y el azul,
// así que al encenderse deslumbrarían. Se toma como referencia el más
// oscuro de los cuatro y se atenúa el brillo de los demás hasta igualarlo.
const REF_LUMINANCE = Math.min(
  ...COLOR_NAMES.map((n) => luminance(new THREE.Color(COLORS[n].hex)))
);
function glowScaleOf(color) {
  return Math.min(1, REF_LUMINANCE / luminance(color));
}

const pads = {};
for (const name of COLOR_NAMES) {
  const { hex, start } = COLORS[name];
  const baseColor = new THREE.Color(hex);
  const glowScale = glowScaleOf(baseColor);
  const material = new THREE.MeshStandardMaterial({
    color: baseColor.clone(),
    emissive: baseColor.clone(),
    emissiveIntensity: 0.06,
    roughness: 0.35,
    metalness: 0.15,
  });
  const mesh = new THREE.Mesh(sectorGeometry(start, start + Math.PI / 2), material);
  mesh.userData.color = name;
  // Separar cada cuadrante hacia afuera para que quede un hueco uniforme
  const mid = start + Math.PI / 4;
  const dir = new THREE.Vector2(Math.cos(mid), Math.sin(mid));
  mesh.position.set(dir.x * GAP, dir.y * GAP, 0);
  board.add(mesh);
  pads[name] = {
    mesh,
    material,
    baseColor,
    // Color hacia el que se funde (en el modo "Colores que migran" cambia)
    targetColor: baseColor.clone(),
    glowScale,
    dir,
    glow: 0,
    glowTarget: 0,
    hover: 0,
    timer: null,
    // Muelle para la altura del cuadrante (rebote al pulsar)
    z: 0,
    vz: 0,
    // Punto central del cuadrante, de donde salen las partículas
    center: new THREE.Vector3(dir.x * 2.2, dir.y * 2.2, 0.5),
  };
}
const padMeshes = COLOR_NAMES.map((n) => pads[n].mesh);

// Los cuadrantes son posiciones fijas ("slots", con el nombre de su color
// original). `colorAt` dice qué color muestra cada uno ahora mismo; solo
// cambia en el modo "Colores que migran".
const colorAt = Object.fromEntries(COLOR_NAMES.map((n) => [n, n]));
function slotOf(color) {
  return COLOR_NAMES.find((slot) => colorAt[slot] === color);
}
function setColorAt(slot, color) {
  colorAt[slot] = color;
  pads[slot].targetColor.setHex(COLORS[color].hex);
}
function resetColors() {
  for (const slot of COLOR_NAMES) setColorAt(slot, slot);
}

// Tecla de cada cuadrante, dibujada como una tecla sobre su superficie.
// Solo aparece cuando se juega con teclado; al tocar/clicar se oculta.
function keycapTexture(letter) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.strokeStyle = "#fff";
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(10, 10, 108, 108, 22);
  g.stroke();
  g.fillStyle = "#fff";
  g.font = `800 66px system-ui, "Segoe UI", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const keycapGeo = new THREE.PlaneGeometry(0.62, 0.62);
for (const name of COLOR_NAMES) {
  const pad = pads[name];
  const mat = new THREE.MeshBasicMaterial({
    map: keycapTexture(COLORS[name].key.toUpperCase()),
    color: new THREE.Color(0.8, 0.8, 0.8), // bajo el umbral del bloom
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const label = new THREE.Mesh(keycapGeo, mat);
  // Hijo del cuadrante: se hunde con él al pulsar
  label.position.copy(pad.center).sub(pad.mesh.position).setZ(0.4);
  label.visible = false;
  pad.mesh.add(label);
  pad.keycap = label;
}
let keycapsShown = 0;
let keycapsTarget = 0;

// Botón central con texto dibujado en un canvas
const textCanvas = document.createElement("canvas");
textCanvas.width = textCanvas.height = 512;
const textCtx = textCanvas.getContext("2d");
const textTexture = new THREE.CanvasTexture(textCanvas);
textTexture.colorSpace = THREE.SRGBColorSpace;
textTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

const centerSideMat = new THREE.MeshStandardMaterial({
  color: 0x2a2f3d,
  roughness: 0.4,
  metalness: 0.7,
});
const centerTopMat = new THREE.MeshBasicMaterial({ map: textTexture });
const centerButton = new THREE.Mesh(
  new THREE.CylinderGeometry(1.02, 1.06, 0.6, 96),
  [centerSideMat, centerTopMat, centerSideMat]
);
centerButton.rotation.x = Math.PI / 2;
centerButton.rotation.y = Math.PI / 2; // orientar el texto hacia arriba
centerButton.position.z = 0.2;
board.add(centerButton);

// Aro luminoso alrededor del botón central
const ringMat = new THREE.MeshStandardMaterial({
  color: 0xb8bec9,
  emissive: 0xffffff,
  emissiveIntensity: 0.1,
  roughness: 0.3,
});
const ring = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.035, 16, 128), ringMat);
ring.position.z = 0.5;
board.add(ring);

let centerHover = 0;
// Muelle de escala del botón central: "rebota" cada vez que cambia el texto
let centerScale = 1;
let centerScaleVel = 0;
let ringKick = 0; // destello extra del aro

function popCenter(strength = 4) {
  if (!reduceMotion) centerScaleVel += strength;
}

// Tinte del aro: toma el color de cada nota de la secuencia y se desvanece
// solo de vuelta al blanco.
const ringTint = new THREE.Color(0xffffff);
let ringTintAmt = 0;
let ringTintHold = 0; // segundos que el tinte se mantiene antes de desvanecerse
function tintRing(hex, hold = 0) {
  ringTint.setHex(hex);
  ringTintAmt = 1;
  ringTintHold = hold;
}

// Pantalla de cristal sobre el botón central: bisel interior en relieve y
// un reflejo suave. Va en su propio grupo para seguir al botón al moverse.
const coreTop = new THREE.Group();
board.add(coreTop);
const SCREEN_R = 0.93;
const bezel = new THREE.Mesh(
  new THREE.TorusGeometry(SCREEN_R, 0.028, 16, 128),
  new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.25, metalness: 0.85 })
);
coreTop.add(bezel);

const glareTexture = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.clip();
  // Brillo difuso arriba a la izquierda
  const soft = g.createRadialGradient(80, 62, 0, 80, 62, 150);
  soft.addColorStop(0, "rgba(255,255,255,0.32)");
  soft.addColorStop(0.5, "rgba(255,255,255,0.08)");
  soft.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = soft;
  g.fillRect(0, 0, 256, 256);
  // Línea de luz fina siguiendo el borde superior
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 3;
  g.shadowColor = "rgba(255,255,255,0.8)";
  g.shadowBlur = 6;
  g.beginPath();
  g.arc(128, 128, 112, Math.PI * 1.08, Math.PI * 1.55);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const glare = new THREE.Mesh(
  new THREE.CircleGeometry(SCREEN_R - 0.02, 96),
  new THREE.MeshBasicMaterial({
    map: glareTexture,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
glare.position.z = 0.006;
coreTop.add(glare);

// Arco de progreso: se llena alrededor del centro según aciertas la secuencia
const progressMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color().setRGB(0.2, 0.75, 0.35),
  side: THREE.DoubleSide,
});
const progressArc = new THREE.Mesh(new THREE.BufferGeometry(), progressMat);
progressArc.position.z = 0.53;
progressArc.rotation.z = Math.PI / 2; // empieza arriba
progressArc.scale.x = -1; // avanza en sentido horario
board.add(progressArc);
let progressShown = 0;
let progressTarget = 0;
let progressBuilt = -1;

function updateProgressArc() {
  if (Math.abs(progressShown - progressBuilt) < 0.002) return;
  progressBuilt = progressShown;
  progressArc.geometry.dispose();
  progressArc.visible = progressShown > 0.004;
  if (!progressArc.visible) return;
  progressArc.geometry = new THREE.TorusGeometry(
    1.03, 0.055, 12, Math.max(8, Math.ceil(128 * progressShown)),
    Math.PI * 2 * progressShown
  );
}

// Ondas expansivas (al pulsar, al pasar de nivel, en game over…)
const rippleGeo = new THREE.RingGeometry(0.93, 1, 96);
const ripples = Array.from({ length: 14 }, () => {
  const mesh = new THREE.Mesh(
    rippleGeo,
    new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    })
  );
  mesh.visible = false;
  board.add(mesh);
  return { mesh, t: 0, dur: 1, from: 0, to: 1, alpha: 1 };
});
let rippleNext = 0;

function ripple(pos, color, from, to, dur, alpha = 0.9) {
  const r = ripples[rippleNext];
  rippleNext = (rippleNext + 1) % ripples.length;
  const c = new THREE.Color(color);
  r.mesh.material.color.copy(c).multiplyScalar(glowScaleOf(c) * 1.6);
  r.mesh.position.set(pos.x, pos.y, 0.56);
  Object.assign(r, { t: 0, dur, from, to, alpha });
  r.mesh.visible = true;
}

function updateRipples(dt) {
  for (const r of ripples) {
    if (!r.mesh.visible) continue;
    r.t += dt / r.dur;
    if (r.t >= 1) {
      r.mesh.visible = false;
      continue;
    }
    const e = 1 - Math.pow(1 - r.t, 3); // ease-out cúbico
    r.mesh.scale.setScalar(r.from + (r.to - r.from) * e);
    r.mesh.material.opacity = r.alpha * (1 - r.t) * (1 - r.t);
  }
}

const ORIGIN = new THREE.Vector3(0, 0, 0.5);

function drawCenter(title, subtitle = "", color = "#cbd5e1") {
  popCenter();
  const g = textCtx;
  const grad = g.createRadialGradient(256, 200, 20, 256, 256, 300);
  grad.addColorStop(0, "#232836");
  grad.addColorStop(1, "#11141c");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // Sombra interior en el borde: la pantalla queda hundida bajo el bisel
  const inner = g.createRadialGradient(256, 256, 190, 256, 256, 236);
  inner.addColorStop(0, "rgba(0,0,0,0)");
  inner.addColorStop(1, "rgba(0,0,0,0.6)");
  g.fillStyle = inner;
  g.fillRect(0, 0, 512, 512);

  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  const size = title.length > 9 ? 64 : 76;
  g.font = `800 ${size}px system-ui, "Segoe UI", sans-serif`;
  g.fillText(title, 256, subtitle ? 232 : 256);
  if (subtitle) {
    g.fillStyle = "#9ca3af";
    g.font = `600 38px system-ui, "Segoe UI", sans-serif`;
    g.fillText(subtitle, 256, 304);
  }
  textTexture.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Partículas (chispas al pulsar y explosión en game over)
// ---------------------------------------------------------------------------

const MAX_PARTICLES = 900;
const pPos = new Float32Array(MAX_PARTICLES * 3);
const pCol = new Float32Array(MAX_PARTICLES * 3);
const pVel = new Float32Array(MAX_PARTICLES * 3);
const pBase = new Float32Array(MAX_PARTICLES * 3);
const pLife = new Float32Array(MAX_PARTICLES);
const pDecay = new Float32Array(MAX_PARTICLES);
let pNext = 0;

const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
particleGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
const particles = new THREE.Points(
  particleGeo,
  new THREE.PointsMaterial({
    size: 0.16,
    map: dotTexture,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
particles.frustumCulled = false;
board.add(particles);

function emit(origin, color, count, speed) {
  const c = new THREE.Color(color);
  c.multiplyScalar(glowScaleOf(c)); // mismas chispas para todos los colores
  for (let n = 0; n < count; n++) {
    const i = pNext;
    pNext = (pNext + 1) % MAX_PARTICLES;
    pPos[i * 3] = origin.x + (Math.random() - 0.5) * 0.4;
    pPos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.4;
    pPos[i * 3 + 2] = origin.z;
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.8);
    pVel[i * 3] = Math.cos(a) * v;
    pVel[i * 3 + 1] = Math.sin(a) * v;
    pVel[i * 3 + 2] = (0.5 + Math.random()) * v * 0.8;
    pBase[i * 3] = c.r * 2;
    pBase[i * 3 + 1] = c.g * 2;
    pBase[i * 3 + 2] = c.b * 2;
    pLife[i] = 1;
    pDecay[i] = 0.9 + Math.random() * 0.9;
  }
}

function updateParticles(dt) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] = Math.max(0, pLife[i] - dt * pDecay[i]);
    const drag = Math.exp(-dt * 2.2);
    pVel[i * 3] *= drag;
    pVel[i * 3 + 1] *= drag;
    pVel[i * 3 + 2] = pVel[i * 3 + 2] * drag - dt * 1.5;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    const l = pLife[i] * pLife[i];
    pCol[i * 3] = pBase[i * 3] * l;
    pCol[i * 3 + 1] = pBase[i * 3 + 1] * l;
    pCol[i * 3 + 2] = pBase[i * 3 + 2] * l;
  }
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Sonido
// ---------------------------------------------------------------------------

// Web Audio: los sonidos se decodifican una vez y se reproducen sin retraso,
// pudiendo solaparse cuando se pulsa rápido.
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioCtx = AudioCtx ? new AudioCtx() : null;
const masterGain = audioCtx?.createGain();
masterGain?.connect(audioCtx.destination);
const buffers = {};

async function loadSound(key, file) {
  try {
    const res = await fetch(`${BASE}sounds/${file}`);
    buffers[key] = await audioCtx.decodeAudioData(await res.arrayBuffer());
  } catch {}
}
if (audioCtx) {
  for (const name of COLOR_NAMES) loadSound(name, COLORS[name].sound);
  loadSound("error", "error.wav");
}

// Los navegadores exigen un gesto del usuario para activar el audio
function unlockAudio() {
  if (audioCtx?.state === "suspended") audioCtx.resume();
}
addEventListener("pointerdown", unlockAudio, true);
addEventListener("keydown", unlockAudio, true);

let muted = localStorage.getItem("muted") === "1";
const muteBtn = document.getElementById("muteBtn");

function setMuted(value) {
  muted = value;
  localStorage.setItem("muted", muted ? "1" : "0");
  if (masterGain) masterGain.gain.value = muted ? 0 : 1;
  muteBtn.setAttribute("aria-pressed", String(muted));
  muteBtn.setAttribute("aria-label", muted ? "Activar sonido" : "Silenciar sonido");
  muteBtn.dataset.muted = String(muted);
}
setMuted(muted);
muteBtn.addEventListener("click", () => setMuted(!muted));

function playSound(name) {
  const buffer = buffers[name];
  if (muted || !buffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(masterGain);
  src.start();
}

// ---------------------------------------------------------------------------
// Efectos visuales
// ---------------------------------------------------------------------------

let redness = 0; // 0 = colores normales, 1 = todo rojo (game over)
let rednessTarget = 0;
let shake = 0;
let flashIntensity = 0;

let freeze = 0; // "hit-stop": congela la animación unos instantes

function flashColor(name, { strength = 1, ms = FLASH_MS, light = true } = {}) {
  const pad = pads[name];
  pad.glowTarget = strength;
  clearTimeout(pad.timer);
  pad.timer = setTimeout(() => (pad.glowTarget = 0), ms);
  if (light) {
    // La luz se coloca sobre el cuadrante (no sobre el centro, que se sobreexponía)
    flashLight.position.copy(board.localToWorld(pad.center.clone().setZ(2.2)));
    flashLight.color.setHex(COLORS[colorAt[name]].hex);
    flashIntensity = pad.glowScale * strength;
  }
}

// Golpe físico del cuadrante: se hunde de golpe y rebota
function punchPad(name, force = 4) {
  if (!reduceMotion) pads[name].vz -= force;
}

// Fogonazo rojo en los bordes de la pantalla
const hitFlash = document.getElementById("hitFlash");
function screenFlash() {
  hitFlash.animate([{ opacity: 0.85 }, { opacity: 0 }], {
    duration: 700,
    easing: "cubic-bezier(.2,.7,.3,1)",
  });
}

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

function celebrateRecord() {
  for (const name of COLOR_NAMES) emit(ORIGIN, COLORS[name].hex, 35, 3.4);
  maxLevelDisplay.animate(
    [
      { transform: "scale(1)", color: "#fff" },
      { transform: "scale(1.25)", color: "#fde047" },
      { transform: "scale(1)", color: "#fff" },
    ],
    { duration: 650, easing: "cubic-bezier(.3,1.6,.5,1)" }
  );
}

// ---------------------------------------------------------------------------
// Lógica del juego
// ---------------------------------------------------------------------------

// Modos de juego
const MODES = {
  classic: { name: "Clásico", unit: "Nivel" },
  migrate: { name: "Colores que migran", unit: "Nivel" },
  impostor: { name: "El Impostor", unit: "Ronda" },
};
const IMPOSTOR_LEN = 5; // en El Impostor la secuencia no crece

let mode = localStorage.getItem("mode");
if (!(mode in MODES)) mode = "classic";

// El récord se guarda por modo (el clásico conserva la clave original)
const recordKey = (m) => (m === "classic" ? "maxLevel" : `maxLevel:${m}`);

let sequence = [];
let playerSequence = [];
let level = 0;
let maxLevel = Number(localStorage.getItem(recordKey(mode))) || 0;
// idle: esperando inicio · showing: mostrando secuencia · input: turno del jugador
// paused: pestaña oculta mientras se mostraba la secuencia · over: perdió
let state = "idle";
let timers = [];
let levelDone = false; // el nivel actual ya se superó (esperando el siguiente)
let replay = null; // vuelve a mostrar lo de este nivel (tras una pausa)
let impostor = null; // { color, changed }: el color que entró y la secuencia resultante

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}
function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function announce(text) {
  statusEl.textContent = text;
}

function updateMaxLevel() {
  maxLevelDisplay.textContent = `Nivel máximo alcanzado: ${maxLevel}`;
}

const randomColor = () => COLOR_NAMES[Math.floor(Math.random() * 4)];
const unit = () => MODES[mode].unit;

let recordAtStart = 0; // récord al empezar la partida (para celebrar al superarlo)

function startGame() {
  clearTimers();
  sequence = [];
  level = 0;
  rednessTarget = 0;
  resetColors();
  recordAtStart = maxLevel;
  ringKick = 1.5;
  ripple(ORIGIN, 0xffffff, 1.05, 3.8, 0.7, 0.5);
  nextLevel();
}

function nextLevel() {
  level++;
  playerSequence = [];
  progressTarget = 0;
  levelDone = false;
  if (mode === "impostor") {
    impostorRound();
    return;
  }
  sequence.push(randomColor());
  replay = (leadIn = LEAD_IN_MS) =>
    playSequence(sequence, {
      leadIn,
      onDone: mode === "migrate" ? migrateThenInput : () => startInput("Tu turno"),
    });
  drawCenter(`Nivel ${level}`, "Observa");
  announce(`Nivel ${level}. Observa la secuencia.`);
  replay();
}

// Muestra un color: se enciende el cuadrante donde está ahora
function showColor(color) {
  const slot = slotOf(color);
  flashColor(slot);
  playSound(color);
  punchPad(slot, 2.5);
  ripple(pads[slot].center, COLORS[color].hex, 0.2, 1.3, 0.5, 0.5);
  ringKick = 0.8; // el aro marca el ritmo de la secuencia
  tintRing(COLORS[color].hex);
}

// Reproduce una secuencia; el jugador no puede pulsar hasta que termine
function playSequence(seq, { leadIn = LEAD_IN_MS, step = STEP_MS, onDone }) {
  state = "showing";
  seq.forEach((color, i) => later(() => showColor(color), leadIn + i * step));
  later(onDone, leadIn + (seq.length - 1) * step + FLASH_MS);
}

function startInput(subtitle) {
  state = "input";
  drawCenter(`${unit()} ${level}`, subtitle);
  announce(`${subtitle}.`);
  ringKick = 1.2;
}

// --- Colores que migran: tras ver la secuencia, los colores cambian de
// cuadrante fundiéndose. Hay que recordar el color, no la posición.
function migrateThenInput() {
  const swaps = level >= 5 ? 2 : 1;
  const before = { ...colorAt };
  const next = { ...before };
  do {
    Object.assign(next, before);
    for (let k = 0; k < swaps; k++) {
      const a = randomColor();
      let b = randomColor();
      while (b === a) b = randomColor();
      [next[a], next[b]] = [next[b], next[a]];
    }
  } while (COLOR_NAMES.every((slot) => next[slot] === before[slot]));
  for (const slot of COLOR_NAMES) setColorAt(slot, next[slot]);
  drawCenter(`Nivel ${level}`, "¡Se mueven!");
  announce("Los colores cambian de sitio.");
  ringKick = 1;
  later(() => startInput("Tu turno"), 900);
}

// --- El Impostor: la secuencia no crece. Cada ronda se repite con una nota
// cambiada y hay que tocar el color que entró. La versión cambiada pasa a
// ser la nueva referencia para la ronda siguiente.
function impostorRound() {
  const first = sequence.length === 0;
  if (first) sequence = Array.from({ length: IMPOSTOR_LEN }, randomColor);
  const idx = Math.floor(Math.random() * sequence.length);
  let color = randomColor();
  while (color === sequence[idx]) color = randomColor();
  const changed = sequence.slice();
  changed[idx] = color;
  impostor = { color, changed };
  // Cada ronda un poco más rápida
  const step = Math.max(450, STEP_MS - (level - 1) * 25);

  const showChanged = (leadIn) => {
    drawCenter(`Ronda ${level}`, "¿Qué cambió?");
    announce("Otra vez. Una nota ha cambiado.");
    playSequence(changed, { leadIn, step, onDone: () => startInput("¿Cuál entró?") });
  };
  replay = (leadIn = LEAD_IN_MS) => {
    if (!first) return showChanged(leadIn);
    drawCenter("Ronda 1", "Memoriza");
    announce("Memoriza la secuencia.");
    playSequence(sequence, {
      leadIn,
      step,
      onDone: () => showChanged(1000),
    });
  };
  replay();
}

// Si la pestaña se oculta mientras se muestra la secuencia (o entre niveles),
// se detiene todo; al volver se repite lo de este nivel desde el principio.
// En el turno del jugador no hace falta: no hay límite de tiempo.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state === "showing") {
      clearTimers();
      state = "paused";
      announce("Juego en pausa.");
    }
  } else if (state === "paused") {
    if (levelDone) {
      nextLevel();
      return;
    }
    playerSequence = [];
    progressTarget = 0;
    drawCenter(`${unit()} ${level}`, "Otra vez");
    announce(`${unit()} ${level}. Repetimos.`);
    replay(1100); // un margen extra para volver a situarse
  }
});

// `slot`: cuadrante pulsado. `origin`: punto del clic (con teclado, su centro)
function handlePlayerInput(slot, origin = pads[slot].center) {
  // Durante la secuencia el cuadrante solo "tiembla" para indicar que está bloqueado
  if (state === "showing") {
    punchPad(slot, 1);
    return;
  }
  if (state !== "input") return;

  const color = colorAt[slot];
  const correct =
    mode === "impostor"
      ? color === impostor.color
      : color === sequence[playerSequence.length];
  if (!correct) {
    flashColor(slot);
    punchPad(slot, 5);
    gameOver();
    return;
  }

  playerSequence.push(color);
  flashColor(slot);
  playSound(color);
  punchPad(slot, 4.5);
  vibrate(15);
  emit(origin, COLORS[color].hex, 22, 1.8);
  ripple(origin, COLORS[color].hex, 0.2, 1.6, 0.45);
  ringKick = 0.6;

  if (mode === "impostor") {
    progressTarget = 1;
    sequence = impostor.changed; // la versión cambiada es la nueva referencia
    levelComplete("¡Pillado!");
    return;
  }
  progressTarget = playerSequence.length / sequence.length;
  if (playerSequence.length === sequence.length) levelComplete("¡Bien!");
}

function levelComplete(cheer) {
  state = "showing";
  levelDone = true;
  const newRecord = level > maxLevel;
  if (newRecord) {
    maxLevel = level;
    localStorage.setItem(recordKey(mode), maxLevel);
    updateMaxLevel();
  }
  later(() => {
    // Se celebra solo la primera vez que se supera el récord anterior
    if (newRecord && recordAtStart > 0 && level === recordAtStart + 1) {
      drawCenter("¡Récord!", `${unit()} ${level}`, "#fde047");
      celebrateRecord();
      vibrate([20, 40, 20]);
    } else {
      const done = unit() === "Ronda" ? "completada" : "completado";
      drawCenter(cheer, `${unit()} ${level} ${done}`, "#86efac");
    }
  }, 180);
  later(nextLevel, 1100);
}

function gameOver() {
  clearTimers();
  state = "over";
  playSound("error");
  vibrate([80, 50, 160]);
  freeze = 0.12; // pausa dramática antes de la explosión
  drawCenter("GAME OVER", "Toca para reiniciar", "#f87171");
  announce(`Fin del juego en ${unit().toLowerCase()} ${level}. Pulsa Enter para reiniciar.`);
  rednessTarget = 1;
  progressTarget = 0;
  shake = reduceMotion ? 0 : 0.3;
  flashLight.position.set(0, 0, 3);
  flashLight.color.copy(ERROR_RED);
  flashIntensity = 1.4;
  screenFlash();
  for (const name of COLOR_NAMES) {
    emit(pads[name].center, ERROR_RED, 70, 3.2);
    punchPad(name, 3);
  }
  ripple(ORIGIN, ERROR_RED, 1.1, 5.2, 0.8);
  ripple(ORIGIN, ERROR_RED, 1.1, 3.8, 0.6, 0.6);
  sequence = [];
  playerSequence = [];
}

// --- Menú de modos (botón hamburguesa) ---
const menuBtn = document.getElementById("menuBtn");
const modeMenu = document.getElementById("modeMenu");
const modeLabel = document.getElementById("modeLabel");
const modeItems = [...modeMenu.querySelectorAll("[data-mode]")];

// Cambiar de modo deja el juego esperando a empezar
function setMode(next) {
  mode = next;
  localStorage.setItem("mode", mode);
  clearTimers();
  state = "idle";
  sequence = [];
  playerSequence = [];
  level = 0;
  progressTarget = 0;
  rednessTarget = 0;
  resetColors();
  maxLevel = Number(localStorage.getItem(recordKey(mode))) || 0;
  updateMaxLevel();
  modeLabel.textContent = MODES[mode].name;
  for (const item of modeItems) {
    item.setAttribute("aria-checked", String(item.dataset.mode === mode));
  }
  drawCenter("COMENZAR", mode === "classic" ? "" : MODES[mode].name);
  announce(`Modo ${MODES[mode].name}. Pulsa Enter o toca el centro para comenzar.`);
}

function setMenuOpen(open) {
  modeMenu.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  if (open) (modeItems.find((b) => b.dataset.mode === mode) || modeItems[0]).focus();
}
const menuOpen = () => !modeMenu.hidden;

menuBtn.addEventListener("click", () => setMenuOpen(!menuOpen()));
for (const item of modeItems) {
  item.addEventListener("click", () => {
    setMode(item.dataset.mode);
    setMenuOpen(false);
    menuBtn.focus();
  });
}
// Clic fuera del menú: cerrarlo (sin que ese clic cuente en el tablero)
addEventListener(
  "pointerdown",
  (e) => {
    if (menuOpen() && !modeMenu.contains(e.target) && !menuBtn.contains(e.target)) {
      setMenuOpen(false);
      e.stopPropagation();
    }
  },
  true
);
modeMenu.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const i = modeItems.indexOf(document.activeElement);
  const d = e.key === "ArrowDown" ? 1 : -1;
  modeItems[(i + d + modeItems.length) % modeItems.length].focus();
});

function canStart() {
  return state === "idle" || state === "over";
}

// ---------------------------------------------------------------------------
// Entrada: ratón / táctil (raycasting) y teclado
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredPad = null;
let hoveringCenter = false;

function setPointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects([...padMeshes, centerButton], false)[0];
  lastHitPoint = hit ? board.worldToLocal(hit.point.clone()) : null;
  if (!hit) return null;
  return hit.object === centerButton ? "center" : hit.object.userData.color;
}
let lastHitPoint = null; // punto del clic en coordenadas del tablero

canvas.addEventListener("pointermove", (e) => {
  setPointer(e);
  const target = pick();
  hoveringCenter = target === "center";
  hoveredPad = target && target !== "center" ? target : null;
  const clickable =
    (hoveredPad && state === "input") || (hoveringCenter && canStart());
  canvas.style.cursor = clickable ? "pointer" : "default";
});

canvas.addEventListener("pointerleave", () => {
  hoveredPad = null;
  hoveringCenter = false;
});

canvas.addEventListener("pointerdown", (e) => {
  keycapsTarget = 0; // se juega con ratón/táctil: ocultar las teclas
  setPointer(e);
  const target = pick();
  if (target === "center") {
    if (canStart()) startGame();
  } else if (target) {
    handlePlayerInput(target, lastHitPoint);
  }
});

const KEY_TO_COLOR = Object.fromEntries(
  COLOR_NAMES.map((n) => [COLORS[n].key, n])
);

addEventListener("keydown", (e) => {
  if (e.repeat) return;
  // Con el menú abierto no se juega; Escape lo cierra
  if (menuOpen()) {
    if (e.key === "Escape") {
      setMenuOpen(false);
      menuBtn.focus();
    }
    return;
  }
  if (e.key.toLowerCase() === "m") {
    setMuted(!muted);
    return;
  }
  // Enter/Espacio sobre un botón (p. ej. silencio) no deben iniciar la partida
  if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
  const name = KEY_TO_COLOR[e.key.toLowerCase()];
  if (name || e.key === "Enter" || e.key === " ") keycapsTarget = 1;
  if (name) {
    handlePlayerInput(name);
  } else if ((e.key === "Enter" || e.key === " ") && canStart()) {
    e.preventDefault();
    startGame();
  }
});

// ---------------------------------------------------------------------------
// Ajuste al tamaño de la ventana
// ---------------------------------------------------------------------------

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // Alejar la cámara lo justo para que el tablero quepa con margen
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const radius = 3.6;
  const dist = Math.max((radius * 1.4) / t, (radius * 1.15) / (t * camera.aspect));
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------------
// Bucle de animación
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
const tmpColor = new THREE.Color();
// Inclinación fija del tablero (no sigue al ratón)
board.rotation.x = -0.6;

function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

// Muelle amortiguado (con subpasos para que sea estable a cualquier fps)
function spring(x, v, target, stiffness, damping, dt) {
  const steps = Math.ceil(dt / (1 / 240));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    v += (stiffness * (target - x) - damping * v) * h;
    x += v * h;
  }
  return [x, v];
}

function animate() {
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  // Hit-stop: durante unos instantes todo queda congelado
  let dt = rawDt;
  if (freeze > 0) {
    freeze -= rawDt;
    dt = 0;
  }

  // Temblor en game over
  shake = damp(shake, 0, 5, dt);
  const s = freeze > 0 ? 0 : shake;
  board.position.x = (Math.random() - 0.5) * s;
  board.position.y = (Math.random() - 0.5) * s;

  redness = damp(redness, rednessTarget, 6, dt);

  for (const name of COLOR_NAMES) {
    const pad = pads[name];
    pad.glow = damp(pad.glow, pad.glowTarget, 22, dt);
    const hoverTarget = hoveredPad === name && state === "input" ? 1 : 0;
    pad.hover = damp(pad.hover, hoverTarget, 12, dt);

    if (!pad.baseColor.equals(pad.targetColor)) {
      pad.baseColor.lerp(pad.targetColor, 1 - Math.exp(-5 * dt));
      pad.glowScale = glowScaleOf(pad.baseColor);
    }
    tmpColor.copy(pad.baseColor).lerp(ERROR_RED, redness);
    pad.material.color.copy(tmpColor);
    pad.material.emissive.copy(tmpColor);
    pad.material.emissiveIntensity =
      0.06 + (pad.hover * 0.12 + pad.glow * 1.6) * pad.glowScale;

    // El cuadrante se hunde al encenderse y rebota al soltarse, como un botón físico
    const zTarget = -0.12 * pad.glowTarget + 0.05 * pad.hover;
    [pad.z, pad.vz] = spring(pad.z, pad.vz, zTarget, 700, 18, dt);
    pad.mesh.position.z = THREE.MathUtils.clamp(pad.z, -0.3, 0.15);
  }

  keycapsShown = damp(keycapsShown, keycapsTarget, 6, dt);
  for (const name of COLOR_NAMES) {
    const k = pads[name].keycap;
    k.material.opacity = keycapsShown * 0.85;
    k.visible = keycapsShown > 0.01;
  }

  centerHover = damp(centerHover, hoveringCenter && canStart() ? 1 : 0, 10, dt);
  centerButton.position.z = 0.2 + centerHover * 0.06;
  ring.position.z = 0.5 + centerHover * 0.06;
  progressArc.position.z = 0.53 + centerHover * 0.06;
  coreTop.position.z = 0.5 + centerHover * 0.06;

  [centerScale, centerScaleVel] = spring(centerScale, centerScaleVel, 1, 420, 13, dt);
  centerButton.scale.setScalar(centerScale);
  ring.scale.setScalar(centerScale);
  coreTop.scale.setScalar(centerScale);
  progressArc.scale.set(-centerScale, centerScale, centerScale);

  // Tinte del aro (notas de la secuencia)
  if (ringTintHold > 0) ringTintHold -= dt;
  else ringTintAmt = damp(ringTintAmt, 0, 3, dt);

  // El aro "respira" mientras se espera para empezar y destella con cada golpe
  ringKick = damp(ringKick, 0, 7, dt);
  // (valores bajos a propósito para que el centro no deslumbre)
  const pulse = canStart() ? 0.16 + Math.sin(t * 2.5) * 0.08 : 0.06;
  ringMat.emissiveIntensity = damp(
    ringMat.emissiveIntensity,
    pulse + centerHover * 0.2 + ringTintAmt * 0.45,
    8,
    dt
  );
  ringMat.emissive
    .setHex(0xffffff)
    .lerp(ringTint, ringTintAmt)
    .lerp(ERROR_RED, redness)
    .multiplyScalar(1 + ringKick * 0.5);
  ringMat.color.setHex(0xb8bec9).lerp(ringTint, ringTintAmt * 0.6);

  progressShown = damp(progressShown, progressTarget, 14, dt);
  updateProgressArc();
  updateRipples(dt);

  flashIntensity = damp(flashIntensity, 0, 5, dt);
  flashLight.intensity = flashIntensity * 25;

  stars.rotation.z += dt * 0.01;
  stars.rotation.y = Math.sin(t * 0.05) * 0.1;

  updateParticles(dt);
  composer.render();
  requestAnimationFrame(animate);
}

setMode(mode);
animate();

// Solo en desarrollo: acceso al estado desde la consola para depurar
if (import.meta.env.DEV) {
  window.__simon = {
    get state() {
      return state;
    },
    get sequence() {
      return [...sequence];
    },
    get impostor() {
      return impostor;
    },
    get colorAt() {
      return { ...colorAt };
    },
    get level() {
      return level;
    },
    setMode,
    tintRing,
    press: handlePlayerInput,
    flash: flashColor,
    get ripples() {
      return ripples.filter((r) => r.mesh.visible).map((r) => r.mesh.position.toArray());
    },
    padCenter: (n) => pads[n].center.toArray(),
  };
}
