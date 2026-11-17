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

// Grupo del núcleo: botón central, aro, ranuras y anillos apilados.
// Se escala y se eleva como una sola pieza.
const coreGroup = new THREE.Group();
board.add(coreGroup);

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
coreGroup.add(centerButton);

// Aro luminoso alrededor del botón central
const ringMat = new THREE.MeshStandardMaterial({
  color: 0xb8bec9,
  emissive: 0xffffff,
  emissiveIntensity: 0.1,
  roughness: 0.3,
});
const ring = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.035, 16, 128), ringMat);
ring.position.z = 0.5;
coreGroup.add(ring);

let centerHover = 0;
// Muelle de escala del botón central: "rebota" cada vez que cambia el texto
let centerScale = 1;
let centerScaleVel = 0;
let ringKick = 0; // destello extra del aro

function popCenter(strength = 4) {
  if (!reduceMotion) centerScaleVel += strength;
}

// ---------------------------------------------------------------------------
// Núcleo: cada acierto lanza un fragmento del color pulsado hacia el centro,
// donde encaja en una ranura del anillo activo. Al completar el nivel el
// anillo se cierra, se apila bajo el aro y el núcleo crece. Al perder, el
// núcleo estalla.
// ---------------------------------------------------------------------------

const CORE_TOP = 0.5; // cara superior del botón central sin crecer
const LAYER_H = 0.075; // altura que suma cada anillo completado
const MAX_LAYERS = 8; // anillos visibles; los más antiguos se desvanecen
const SLOT_R = 1.03; // radio de las ranuras del anillo activo
const LAYER_R = 1.075; // radio de los anillos apilados (abrazan el lateral)
const SLOT_GAP = 0.09; // hueco en radianes entre ranuras
const FRAGMENT_S = reduceMotion ? 0.05 : 0.38; // duración del vuelo
const MILESTONE = 5; // cada cuántos niveles el núcleo "se carga"

const GHOST = new THREE.Color(0.16, 0.18, 0.24);
const WHITE = new THREE.Color(1.6, 1.6, 1.6);

// Color de neón con el brillo igualado entre los cuatro tonos
function neon(name, k = 1) {
  const c = new THREE.Color(COLORS[name].hex);
  return c.multiplyScalar(glowScaleOf(c) * k);
}

// Las geometrías de los segmentos se comparten (solo dependen de radio y n)
const segGeoCache = new Map();
function segmentGeometry(radius, tube, n) {
  const key = `${radius}|${tube}|${n}`;
  if (!segGeoCache.has(key)) {
    const arc = n === 1 ? Math.PI * 2 : (Math.PI * 2) / n - SLOT_GAP;
    const segs = Math.max(6, Math.ceil((128 * arc) / (Math.PI * 2)));
    segGeoCache.set(key, new THREE.TorusGeometry(radius, tube, 10, segs, arc));
  }
  return segGeoCache.get(key);
}

// Las ranuras empiezan arriba y avanzan en sentido horario
function slotStart(i, n) {
  return Math.PI / 2 - ((i + 1) * Math.PI * 2) / n + (n === 1 ? 0 : SLOT_GAP / 2);
}
function slotCenter(i, n) {
  return Math.PI / 2 - ((i + 0.5) * Math.PI * 2) / n;
}

let coreH = 0; // altura extra actual del núcleo (con muelle)
let coreHVel = 0;
let coreHTarget = 0;

// --- Anillo activo: una ranura por cada color de la secuencia -------------

const activeRing = new THREE.Group();
activeRing.position.z = 0.53;
coreGroup.add(activeRing);
let slots = []; // { mesh, color, fill, flash }
let ringId = 0; // cambia al reconstruir: invalida fragmentos en vuelo

function buildActiveRing(n) {
  ringId++;
  for (const s of slots) {
    activeRing.remove(s.mesh);
    s.mesh.material.dispose();
  }
  slots = [];
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(
      segmentGeometry(SLOT_R, 0.055, n),
      new THREE.MeshBasicMaterial({ color: GHOST.clone(), transparent: true, opacity: 0.45 })
    );
    mesh.rotation.z = slotStart(i, n);
    activeRing.add(mesh);
    slots.push({ mesh, color: null, fill: 0, flash: 0 });
  }
}

// Posición de una ranura en coordenadas del tablero
function slotPosition(i, out = new THREE.Vector3()) {
  const a = slotCenter(i, slots.length);
  out.set(Math.cos(a) * SLOT_R, Math.sin(a) * SLOT_R, activeRing.position.z);
  return out.applyMatrix4(coreGroup.matrix); // coreGroup es hijo directo de board
}

function updateSlots(dt) {
  for (const s of slots) {
    s.fill = damp(s.fill, s.color ? 1 : 0, 12, dt);
    s.flash = damp(s.flash, 0, 6, dt);
    const m = s.mesh.material;
    m.color.copy(GHOST);
    if (s.color) m.color.lerp(s.color, s.fill);
    m.color.lerp(WHITE, s.flash);
    m.opacity = 0.45 + 0.55 * Math.max(s.fill, s.flash);
  }
}

// --- Fragmentos que vuelan desde el cuadrante a su ranura ----------------

const fragGeo = new THREE.OctahedronGeometry(0.1, 0);
const fragments = [];
const fragCtrl = new THREE.Vector3();
const fragTarget = new THREE.Vector3();

function launchFragment(name, from, slot) {
  const mesh = new THREE.Mesh(fragGeo, new THREE.MeshBasicMaterial({ color: neon(name, 2.4) }));
  const start = from.clone();
  start.z = Math.max(start.z, 0.6);
  mesh.position.copy(start);
  board.add(mesh);
  fragments.push({ mesh, name, start, slot, id: ringId, t: 0 });
}

function removeFragment(f) {
  board.remove(f.mesh);
  f.mesh.material.dispose();
}

function updateFragments(dt) {
  for (let k = fragments.length - 1; k >= 0; k--) {
    const f = fragments[k];
    // Si el anillo cambió (game over, reinicio) el fragmento ya no tiene destino
    if (f.id !== ringId || !slots[f.slot]) {
      removeFragment(f);
      fragments.splice(k, 1);
      continue;
    }
    f.t = Math.min(1, f.t + dt / FRAGMENT_S);
    slotPosition(f.slot, fragTarget);
    // Curva de Bézier: sube en arco y cae sobre la ranura
    fragCtrl.copy(f.start).lerp(fragTarget, 0.5);
    fragCtrl.z += 1.1;
    const e = f.t * f.t * (3 - 2 * f.t);
    const u = 1 - e;
    f.mesh.position
      .copy(f.start).multiplyScalar(u * u)
      .addScaledVector(fragCtrl, 2 * u * e)
      .addScaledVector(fragTarget, e * e);
    f.mesh.rotation.x += dt * 9;
    f.mesh.rotation.y += dt * 7;
    f.mesh.scale.setScalar(1 - 0.4 * e);
    if (!reduceMotion) emit(f.mesh.position, COLORS[f.name].hex, 1, 0.25);

    if (f.t >= 1) {
      const s = slots[f.slot];
      s.color = neon(f.name, 1.5);
      s.flash = 0.8;
      ripple(fragTarget, COLORS[f.name].hex, 0.1, 0.7, 0.35, 0.7);
      emit(fragTarget, COLORS[f.name].hex, 10, 1.2);
      ringKick = Math.max(ringKick, 0.6);
      removeFragment(f);
      fragments.splice(k, 1);
    }
  }
}

// --- Anillos apilados: la historia de la partida -------------------------

const layers = []; // { group, names, z, scale, glow, dying, life }

function aliveLayers() {
  return layers.filter((l) => !l.dying);
}

// Convierte el anillo activo completo en una capa del núcleo
function absorbActiveRing(names) {
  const n = names.length;
  const group = new THREE.Group();
  names.forEach((name, i) => {
    const mesh = new THREE.Mesh(
      segmentGeometry(LAYER_R, 0.032, n),
      new THREE.MeshBasicMaterial({ color: neon(name), transparent: true })
    );
    mesh.rotation.z = slotStart(i, n);
    mesh.userData.base = neon(name);
    group.add(mesh);
  });
  coreGroup.add(group);
  layers.push({
    group,
    names,
    z: activeRing.position.z, // nace donde estaba el anillo activo
    scale: SLOT_R / LAYER_R,
    glow: 1.2,
    dying: false,
    life: 1,
  });
  buildActiveRing(0);

  const alive = aliveLayers();
  if (alive.length > MAX_LAYERS) alive[0].dying = true;
  coreHTarget = Math.min(alive.length, MAX_LAYERS) * LAYER_H;
  ripple(ORIGIN, 0xffffff, 1.05, 2.4, 0.55, 0.45);
  ringKick = 1.4;
  popCenter(3);
}

// Cada MILESTONE niveles el núcleo se "carga": una ola de luz lo recorre
function chargeCore() {
  aliveLayers().forEach((l, i) => later(() => (l.glow = 1.6), i * 55));
  for (const name of COLOR_NAMES) emit(ORIGIN, COLORS[name].hex, 18, 2.8);
  ripple(ORIGIN, 0xffffff, 1.1, 4.6, 0.9, 0.6);
}

// Game over: las capas salen despedidas en chispas de sus colores
function shatterCore() {
  const p = new THREE.Vector3();
  for (const l of aliveLayers()) {
    const n = l.names.length;
    l.names.forEach((name, i) => {
      const a = slotCenter(i, n);
      p.set(Math.cos(a) * LAYER_R, Math.sin(a) * LAYER_R, l.z);
      emit(p, COLORS[name].hex, Math.max(3, Math.ceil(24 / n)), 2.6);
    });
    l.dying = true;
  }
  coreHTarget = 0;
  buildActiveRing(0);
}

function updateLayers(dt) {
  const alive = aliveLayers();
  for (let k = layers.length - 1; k >= 0; k--) {
    const l = layers[k];
    if (l.dying) {
      l.life -= dt * 2.5;
      l.scale += dt * 0.6; // se abren hacia afuera mientras se apagan
      if (l.life <= 0) {
        coreGroup.remove(l.group);
        l.group.children.forEach((m) => m.material.dispose());
        layers.splice(k, 1);
        continue;
      }
    } else {
      // La capa más reciente queda justo bajo el aro; las demás debajo
      const fromTop = alive.length - 1 - alive.indexOf(l);
      const zTarget = CORE_TOP + coreH - (fromTop + 0.5) * LAYER_H;
      l.z = damp(l.z, zTarget, 12, dt);
      l.scale = damp(l.scale, 1, 10, dt);
    }
    l.glow = damp(l.glow, 0, 2.2, dt);
    l.group.position.z = l.z;
    l.group.scale.set(l.scale, l.scale, 1);
    const brightness = 0.75 + l.glow * 1.6;
    for (const m of l.group.children) {
      m.material.color.copy(m.userData.base).multiplyScalar(brightness).lerp(ERROR_RED, redness * 0.6);
      m.material.opacity = Math.max(0, l.life);
    }
  }
}

function updateCore(dt) {
  [coreH, coreHVel] = spring(coreH, coreHVel, coreHTarget, 160, 14, dt);
  centerButton.scale.y = (0.6 + coreH) / 0.6;
  centerButton.position.z = 0.2 + coreH / 2;
  ring.position.z = CORE_TOP + coreH;
  activeRing.position.z = CORE_TOP + 0.03 + coreH;
  updateSlots(dt);
  updateFragments(dt);
  updateLayers(dt);
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

const sounds = {};
for (const name of COLOR_NAMES) {
  sounds[name] = new Audio(`${BASE}sounds/${COLORS[name].sound}`);
}
sounds.error = new Audio(`${BASE}sounds/error.wav`);

function playSound(name) {
  const s = sounds[name];
  s.currentTime = 0;
  s.play().catch(() => {});
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
    flashLight.color.setHex(COLORS[name].hex);
    flashIntensity = pad.glowScale * strength;
  }
}

// Golpe físico del cuadrante: se hunde de golpe y rebota
function punchPad(name, force = 4) {
  if (!reduceMotion) pads[name].vz -= force;
}

// Ola de luz en sentido horario (al completar un nivel)
const CLOCKWISE = ["red", "blue", "yellow", "green"];
function wave(delay = 70) {
  CLOCKWISE.forEach((name, i) => {
    later(() => {
      flashColor(name, { strength: 0.55, ms: 160, light: false });
      punchPad(name, 1.5);
    }, i * delay);
  });
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

let sequence = [];
let playerSequence = [];
let level = 0;
let maxLevel = Number(localStorage.getItem("maxLevel")) || 0;
// idle: esperando inicio · showing: mostrando secuencia · input: turno del jugador · over: perdió
let state = "idle";
let timers = [];

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

let recordAtStart = 0; // récord al empezar la partida (para celebrar al superarlo)

function startGame() {
  clearTimers();
  sequence = [];
  level = 0;
  rednessTarget = 0;
  recordAtStart = maxLevel;
  ringKick = 1.5;
  ripple(ORIGIN, 0xffffff, 1.05, 3.8, 0.7, 0.5);
  nextLevel();
}

function nextLevel() {
  level++;
  playerSequence = [];
  sequence.push(COLOR_NAMES[Math.floor(Math.random() * 4)]);
  buildActiveRing(sequence.length);
  drawCenter(`Nivel ${level}`, "Observa");
  announce(`Nivel ${level}. Observa la secuencia.`);
  playSequence();
}

// Reproduce la secuencia; el jugador no puede pulsar hasta que termine
function playSequence() {
  state = "showing";
  sequence.forEach((name, i) => {
    later(() => {
      flashColor(name);
      playSound(name);
      punchPad(name, 2.5);
      ripple(pads[name].center, COLORS[name].hex, 0.2, 1.3, 0.5, 0.5);
      ringKick = 0.8; // el aro marca el ritmo de la secuencia
      if (slots[i]) slots[i].flash = 0.7; // y la ranura que le corresponde
    }, LEAD_IN_MS + i * STEP_MS);
  });
  later(() => {
    state = "input";
    drawCenter(`Nivel ${level}`, "Tu turno");
    announce("Tu turno.");
    ringKick = 1.2;
  }, LEAD_IN_MS + (sequence.length - 1) * STEP_MS + FLASH_MS);
}

// `origin`: punto del tablero donde se hizo clic (con teclado, el centro del cuadrante)
function handlePlayerInput(name, origin = pads[name].center) {
  // Durante la secuencia el cuadrante solo "tiembla" para indicar que está bloqueado
  if (state === "showing") {
    punchPad(name, 1);
    return;
  }
  if (state !== "input") return;

  playerSequence.push(name);
  const i = playerSequence.length - 1;
  if (playerSequence[i] !== sequence[i]) {
    flashColor(name);
    punchPad(name, 5);
    gameOver();
    return;
  }

  flashColor(name);
  playSound(name);
  punchPad(name, 4.5);
  vibrate(15);
  emit(origin, COLORS[name].hex, 22, 1.8);
  ripple(origin, COLORS[name].hex, 0.2, 1.6, 0.45);
  launchFragment(name, origin, i);
  ringKick = 0.6;

  if (playerSequence.length === sequence.length) {
    state = "showing";
    const newRecord = level > maxLevel;
    if (newRecord) {
      maxLevel = level;
      localStorage.setItem("maxLevel", maxLevel);
      updateMaxLevel();
    }
    // Se espera a que el último fragmento encaje para cerrar el anillo
    const names = [...sequence];
    const closeAt = FRAGMENT_S * 1000 + 150;
    later(() => {
      absorbActiveRing(names);
      wave();
      // Se celebra solo la primera vez que se supera el récord anterior
      if (newRecord && recordAtStart > 0 && level === recordAtStart + 1) {
        drawCenter("¡Récord!", `Nivel ${level}`, "#fde047");
        celebrateRecord();
        vibrate([20, 40, 20]);
      } else if (level % MILESTONE === 0) {
        drawCenter("¡Núcleo!", `${level} anillos`, "#93c5fd");
        chargeCore();
        vibrate([15, 30, 15]);
      } else {
        drawCenter("¡Bien!", `Nivel ${level} completado`, "#86efac");
      }
    }, closeAt);
    later(nextLevel, closeAt + 950);
  }
}

function gameOver() {
  clearTimers();
  state = "over";
  playSound("error");
  vibrate([80, 50, 160]);
  freeze = 0.12; // pausa dramática antes de la explosión
  drawCenter("GAME OVER", "Toca para reiniciar", "#f87171");
  announce(`Fin del juego en el nivel ${level}. Pulsa Enter para reiniciar.`);
  rednessTarget = 1;
  shatterCore();
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
  const name = KEY_TO_COLOR[e.key.toLowerCase()];
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

  centerHover = damp(centerHover, hoveringCenter && canStart() ? 1 : 0, 10, dt);
  coreGroup.position.z = centerHover * 0.06;

  [centerScale, centerScaleVel] = spring(centerScale, centerScaleVel, 1, 420, 13, dt);
  coreGroup.scale.setScalar(centerScale);

  // El aro "respira" mientras se espera para empezar y destella con cada golpe
  ringKick = damp(ringKick, 0, 7, dt);
  // (valores bajos a propósito para que el centro no deslumbre)
  const pulse = canStart() ? 0.16 + Math.sin(t * 2.5) * 0.08 : 0.06;
  ringMat.emissiveIntensity = damp(ringMat.emissiveIntensity, pulse + centerHover * 0.2, 8, dt);
  ringMat.emissive.setHex(0xffffff).lerp(ERROR_RED, redness).multiplyScalar(1 + ringKick * 0.5);

  updateCore(dt);
  updateRipples(dt);

  flashIntensity = damp(flashIntensity, 0, 5, dt);
  flashLight.intensity = flashIntensity * 25;

  stars.rotation.z += dt * 0.01;
  stars.rotation.y = Math.sin(t * 0.05) * 0.1;

  updateParticles(dt);
  composer.render();
  requestAnimationFrame(animate);
}

updateMaxLevel();
drawCenter("COMENZAR");
announce("Pulsa Enter o toca el centro para comenzar.");
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
    press: handlePlayerInput,
    flash: flashColor,
    get ripples() {
      return ripples.filter((r) => r.mesh.visible).map((r) => r.mesh.position.toArray());
    },
    padCenter: (n) => pads[n].center.toArray(),
    get core() {
      return { layers: aliveLayers().length, height: coreH, slots: slots.map((x) => !!x.color) };
    },
  };
}
