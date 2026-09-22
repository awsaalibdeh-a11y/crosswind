/* Crosswind — a flight simulator that runs in a browser tab.

   Everything here is metres, seconds, newtons and radians; only the instruments convert to
   knots and feet, the way a real aircraft does. The world is generated from noise at load
   time and shared between the terrain mesh and the physics, so the wheels touch exactly the
   ground you can see. */

import * as THREE from "three";

/* ================= constants ================= */

const WORLD = 16384;        // metres across
const GRID = 1025;          // heightmap samples per side — 16 m apart, four times the old detail
const SEA = 0;              // sea level
const FIELD_ELEV = 62;      // the airfield plateau
const RUNWAY_LEN = 2600;   // long enough for the airliner to get off and stop again
const RUNWAY_W = 46;
const G = 9.80665;
const KT = 1.94384;         // m/s to knots
const FT = 3.28084;         // m to feet

/* Places you can start. Each strip is levelled into the terrain when the island is built. */
/* Eight of them. Position, heading and elevation were picked by scanning the generated
   heightmap for flat ground and then sweeping the runway heading to find the line that needs
   the least cut and fill — which is roughly how you would site a real one. */
const FIELDS = [
  { id: "intl", name: "Isla Verde Intl", kind: "intl", icao: "IVIV", x: 0, z: 0, elev: 62, len: 2600, w: 46, hdg: 0,
    blurb: "The main field. Long tarmac, a tower, hangars and a PAPI on the approach." },
  { id: "puerto", name: "Puerto Sur", kind: "regional", icao: "IVPS", x: -2000, z: 5200, elev: 109, len: 2000, w: 42, hdg: 1.13,
    blurb: "The city's own airport, a mile inland from the towers. Long enough for anything in the hangar." },
  { id: "oeste", name: "Punta Oeste", kind: "strip", icao: "IVPO", x: -5200, z: 200, elev: 114, len: 1500, w: 34, hdg: 3.05,
    blurb: "A flat coastal field on the west shore. The lighthouse stands off the approach end." },
  { id: "bahia", name: "Bahía Este", kind: "strip", icao: "IVBE", x: 5600, z: 3400, elev: 67, len: 1250, w: 30, hdg: 2.53,
    blurb: "Low ground on the east coast, sheltered from the range. The easiest field after the main one." },
  { id: "norte", name: "Alto Norte", kind: "grass", icao: "IVAN", x: 3200, z: -6000, elev: 236, len: 700, w: 26, hdg: 2.09,
    blurb: "A grass field in the northern foothills. No tarmac, no lights, and trees off both ends." },
  { id: "ridge", name: "Ridge Strip", kind: "strip", icao: "IVRS", x: 2950, z: -3950, elev: 1180, len: 760, w: 24, hdg: 0.42,
    blurb: "A shelf cut into the mountains at 3,900 ft. Short, high and unforgiving." },
  { id: "condor", name: "Cóndor Shelf", kind: "grass", icao: "IVCS", x: 600, z: -4600, elev: 1445, len: 520, w: 22, hdg: 0.79,
    blurb: "520 m of gravel terraced into the range at 4,700 ft. The hardest place to land on the island." },
  { id: "cala", name: "Cala Beach", kind: "beach", icao: "IVCB", x: -4600, z: 2900, elev: 16, len: 980, w: 28, hdg: 1.15,
    blurb: "A sand strip along the south-west shore. Sea at both ends." },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/* ================= a world built from noise ================= */

// A small deterministic value-noise field. Deterministic matters: the terrain mesh and the
// collision heightmap must agree exactly, and a reload should give you the same island.
function makeNoise(seed = 1337) {
  const perm = new Uint8Array(512);
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];

  const grad = (hash, x, y) => {
    switch (hash & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };
  return (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = smooth(xf), v = smooth(yf);
    const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v,
    );
  };
}

const noise2 = makeNoise();

function fbm(x, y, octaves = 6, lac = 2.05, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/* The island.

   Mountains look like blobs when the sampling is coarse and the noise is smooth, so this does
   three things differently: it samples four times finer (16 m instead of 64 m between points),
   it builds ridges from a ridged multifractal rather than plain fbm, and it warps the domain
   before sampling so ridgelines bend and branch instead of running in straight smooth waves.
   Erosion is faked with a second, finer ridge field subtracted from the slopes, which cuts the
   gullies that make a mountain read as rock. */
const heights = new Float32Array(GRID * GRID);

// sharp-crested noise: the absolute value of a signed field, inverted, then squared up
function ridged(x, y, octaves = 6, lac = 2.07, gain = 0.52) {
  let amp = 1, freq = 1, sum = 0, norm = 0, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * freq, y * freq));
    n *= n;
    n *= weight;
    weight = clamp(n * 1.7, 0, 1);      // each octave is gated by the one above it
    sum += amp * n;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

function terrainHeight(x, z) {
  // warp the sampling position so ridgelines bend rather than running straight
  const wx = x + fbm(x / 3400 + 11, z / 3400 - 7, 2) * 900;
  const wz = z + fbm(x / 3400 - 5, z / 3400 + 3, 2) * 900;

  const spine = ridged(wx / 4200, wz / 4200, 6);
  const hills = fbm(x / 1900 + 40, z / 1900 - 12, 5) * 0.5 + 0.5;
  const detail = fbm(x / 380, z / 380, 4) * 0.5 + 0.5;

  // the range runs across the north-east; the south-west is coastal plain
  const mask = clamp((x / WORLD + 0.12) * 1.7 + (-z / WORLD + 0.08) * 1.7, 0, 1);
  const alpine = Math.pow(spine, 1.7) * 2100 * Math.pow(mask, 1.3);

  let h = 26 + hills * 210 + alpine;
  // gullies: cut the fine ridge field into anything steep enough to erode
  h -= (1 - ridged(x / 620, z / 620, 4)) * 120 * clamp((h - 260) / 700, 0, 1);
  h += (detail - 0.5) * 34 * clamp(1 - h / 1400, 0.15, 1);

  // an island: everything falls into the sea past a soft radius
  const d = Math.hypot(x, z) / (WORLD / 2);
  h *= clamp(1.32 - Math.pow(d, 3.1) * 1.45, 0, 1);
  h -= 55 * clamp((d - 0.7) * 3.2, 0, 1);
  // past the shore the seabed keeps going down — this is what the water shader reads to know
  // where the shallows end, and it is why the sea is not one flat colour
  h -= 150 * clamp((d - 0.84) * 2.8, 0, 1);
  return h;
}

function buildHeightmap() {
  const half = WORLD / 2;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -half + (i / (GRID - 1)) * WORLD;
      const z = -half + (j / (GRID - 1)) * WORLD;
      heights[j * GRID + i] = terrainHeight(x, z);
    }
  }
  for (const f of FIELDS) flattenPad(f);
}

/* Every airstrip needs ground that is exactly level, because its tarmac is drawn at a fixed
   height. Dead flat over the strip, blended out into whatever the hills were doing. */
function flattenPad(f) {
  const half = WORLD / 2;
  const innerAlong = f.len / 2 + 220, innerAcross = f.w / 2 + 220;
  // the blend out to natural ground scales with the strip: a short mountain shelf gets steep
  // sides and a small footprint, a 2.6 km runway gets a broad plain around it
  const blend = clamp(f.len * 0.55, 380, 1300);
  const outerAlong = innerAlong + blend, outerAcross = innerAcross + blend * 0.85;
  const c = Math.cos(f.hdg), sn = Math.sin(f.hdg);
  const reach = Math.max(outerAlong, outerAcross);
  for (let j = 0; j < GRID; j++) {
    const z = -half + (j / (GRID - 1)) * WORLD;
    if (Math.abs(z - f.z) > reach) continue;
    for (let i = 0; i < GRID; i++) {
      const x = -half + (i / (GRID - 1)) * WORLD;
      const dx = x - f.x, dz = z - f.z;
      if (Math.abs(dx) > reach) continue;
      const across = Math.abs(dx * c - dz * sn);
      const along = Math.abs(dx * sn + dz * c);
      if (along > outerAlong || across > outerAcross) continue;
      const ta = along <= innerAlong ? 1 : smooth(clamp((outerAlong - along) / (outerAlong - innerAlong), 0, 1));
      const tc = across <= innerAcross ? 1 : smooth(clamp((outerAcross - across) / (outerAcross - innerAcross), 0, 1));
      const k = j * GRID + i;
      heights[k] = lerp(heights[k], f.elev, Math.min(ta, tc));
    }
  }
}

// Bilinear sample — this is what the landing gear actually collides with.
function groundAt(x, z) {
  const half = WORLD / 2;
  const fx = clamp((x + half) / WORLD, 0, 0.99999) * (GRID - 1);
  const fz = clamp((z + half) / WORLD, 0, 0.99999) * (GRID - 1);
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const h00 = heights[j * GRID + i];
  const h10 = heights[j * GRID + i + 1];
  const h01 = heights[(j + 1) * GRID + i];
  const h11 = heights[(j + 1) * GRID + i + 1];
  return Math.max(SEA, lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz));
}

/* The same sample without the clamp: below the waterline this is the seabed, which is negative.
   Only the terrain mesh and the water's depth map want this — everything else wants ground you
   can stand on, which is what groundAt gives. */
function seabedAt(x, z) {
  const half = WORLD / 2;
  const fx = clamp((x + half) / WORLD, 0, 0.99999) * (GRID - 1);
  const fz = clamp((z + half) / WORLD, 0, 0.99999) * (GRID - 1);
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const h00 = heights[j * GRID + i];
  const h10 = heights[j * GRID + i + 1];
  const h01 = heights[(j + 1) * GRID + i];
  const h11 = heights[(j + 1) * GRID + i + 1];
  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}

/* Somewhere you are allowed to put the wheels down: any of the strips, or the carrier deck.
   Anywhere else at speed is an off-field landing, which ends badly. */
function pavementAt(x, z) {
  for (const f of FIELDS) {
    const dx = x - f.x, dz = z - f.z;
    const c = Math.cos(f.hdg), sn = Math.sin(f.hdg);
    const across = Math.abs(dx * c - dz * sn);
    const along = Math.abs(dx * sn + dz * c);
    if (along < f.len / 2 + 30 && across < f.w / 2 + 10) return f;
  }
  for (const d of DECKS) {
    if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) return d;
  }
  return null;
}

/* Flat decks you can also land on — the carrier, for now. Checked after the terrain so a deck
   over water still gives the wheels something solid. */
const DECKS = [];
function surfaceAt(x, z) {
  let h = groundAt(x, z);
  for (const d of DECKS) {
    if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) h = Math.max(h, d.y);
  }
  return h;
}

/* ================= scene ================= */

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.6, 70000);

/* The sun drives everything: the light, the sky gradient, the water's specular and the fog.
   Moving it moves all four together, which is what makes a time of day feel like a time of
   day rather than a filter. */
const TIMES = [
  { id: "morning", label: "Morning", dir: [-0.55, 0.42, 0.72], light: 0xffe8c8, power: 2.5, amb: 0.95, top: 0x2c6cc4, mid: 0x9cc7ee, haze: 0xf2e6d2, fog: 0xdce6ee, windows: 0 },
  { id: "noon", label: "Midday", dir: [-0.28, 0.92, 0.27], light: 0xfff6e8, power: 3.0, amb: 1.1, top: 0x1f5fc0, mid: 0x8dc0ee, haze: 0xe9f2fb, fog: 0xd4e4f2, windows: 0 },
  { id: "golden", label: "Golden hour", dir: [-0.86, 0.16, 0.48], light: 0xffb56a, power: 2.6, amb: 0.8, top: 0x2a4f9e, mid: 0xb08bc8, haze: 0xffbf86, fog: 0xf0c49a, windows: 0.28 },
  { id: "dusk", label: "Dusk", dir: [-0.93, 0.05, 0.36], light: 0xff8f54, power: 1.7, amb: 0.6, top: 0x1b2f6e, mid: 0x7a6bab, haze: 0xff9b6a, fog: 0xc9a2a0, windows: 0.5 },
];
let timeIndex = 0;
const sunDir = new THREE.Vector3(...TIMES[0].dir).normalize();

const sun = new THREE.DirectionalLight(0xffe8c8, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 1800;
sun.shadow.camera.left = -150;
sun.shadow.camera.right = 150;
sun.shadow.camera.top = 150;
sun.shadow.camera.bottom = -150;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 2.8;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4a5a3a, 1.0);
scene.add(hemi);

// Sky: a gradient with a real sun disc, a horizon glow, and the light scattering that sells dusk.
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uTop: { value: new THREE.Color(0x2c6cc4).convertSRGBToLinear() },
    uMid: { value: new THREE.Color(0x9cc7ee).convertSRGBToLinear() },
    uHaze: { value: new THREE.Color(0xf2e6d2).convertSRGBToLinear() },
  },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 uSun, uTop, uMid, uHaze;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 s = normalize(uSun);
      float h = clamp(d.y * 1.1 + 0.05, -1.0, 1.0);
      vec3 col = mix(uHaze, uMid, smoothstep(-0.04, 0.34, h));
      col = mix(col, uTop, smoothstep(0.22, 0.95, h));
      float cosA = clamp(dot(d, s), 0.0, 1.0);
      // the disc itself, then the tight glow, then the wide scatter that lights the whole sky
      float disc = smoothstep(0.9993, 0.99975, cosA);
      float glow = pow(cosA, 700.0) * 0.6 + pow(cosA, 24.0) * 0.16 + pow(cosA, 4.0) * 0.07;
      float low = smoothstep(0.35, -0.05, s.y);           // more scatter when the sun is low
      col += vec3(1.0, 0.86, 0.66) * glow * (1.0 + low * 2.4);
      col += vec3(1.0, 0.95, 0.85) * disc * 12.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(34000, 48, 28), skyMat);
sky.frustumCulled = false;
scene.add(sky);
scene.fog = new THREE.FogExp2(0xdce6ee, 0.000035);

// A reflection probe rendered from the sky, so metal and glass have something to catch.
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function refreshEnvironment() {
  const skyScene = new THREE.Scene();
  const clone = new THREE.Mesh(sky.geometry, skyMat);
  clone.frustumCulled = false;
  skyScene.add(clone);
  envRT?.dispose();
  envRT = pmrem.fromScene(skyScene, 0.04);
  scene.environment = envRT.texture;
}

function applyTime(i) {
  timeIndex = ((i % TIMES.length) + TIMES.length) % TIMES.length;
  const t = TIMES[timeIndex];
  const dir = sunDir.set(...t.dir).normalize();
  sun.position.copy(dir).multiplyScalar(2000);
  sun.color.set(t.light);
  sun.intensity = t.power;
  hemi.intensity = t.amb;
  skyMat.uniforms.uSun.value.copy(dir);
  skyMat.uniforms.uTop.value.set(t.top).convertSRGBToLinear();
  skyMat.uniforms.uMid.value.set(t.mid).convertSRGBToLinear();
  skyMat.uniforms.uHaze.value.set(t.haze).convertSRGBToLinear();
  scene.fog.color.set(t.fog);
  water.material.uniforms.uSun.value.copy(dir);
  water.material.uniforms.uSky.value.set(t.mid).convertSRGBToLinear();
  water.material.uniforms.uHaze.value.set(t.haze).convertSRGBToLinear();
  for (const m of cityLights) m.emissiveIntensity = t.windows || 0;
  refreshEnvironment();
  say(`${t.label}.`);
}

/* ---------- textures, drawn rather than downloaded ----------
   No image files are allowed, so every surface texture here is painted onto a canvas at load:
   speckle for ground, streaks and joins for tarmac, a grid of lit windows for towers. Cheap to
   make, and it is the difference between a surface and a flat colour. */

function speckleTexture(size, base, spots, density = 2600, radius = 2.4) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < density; i++) {
    ctx.fillStyle = spots[Math.floor(Math.random() * spots.length)];
    ctx.globalAlpha = 0.18 + Math.random() * 0.5;
    const r = radius * (0.4 + Math.random());
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function asphaltTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a3d42";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4200; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? "#32353a" : "#45484e";
    ctx.globalAlpha = 0.3 + Math.random() * 0.5;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // the transverse joins every few metres that make tarmac read as tarmac
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "#2b2e33";
  ctx.lineWidth = 1.5;
  for (let y = 0; y < size; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* A facade, and — for a tower — the matching emissive map. The two are generated from the same
   random draw so that the squares that glow at night are exactly the squares that are lit in
   the daytime texture. The emissive map is black everywhere else, which is what stops a tower
   turning into a solid gold block after dark. */
function windowTexture(tower) {
  const size = 128;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return [c, c.getContext("2d")];
  };
  const [c, ctx] = mk();
  const [e, ectx] = mk();
  ctx.fillStyle = tower ? "#2f3846" : "#8d95a0";
  ctx.fillRect(0, 0, size, size);
  ectx.fillStyle = "#000000";
  ectx.fillRect(0, 0, size, size);
  for (let y = 5; y < size - 5; y += 11) {
    for (let x = 5; x < size - 5; x += 10) {
      const on = tower && Math.random() < 0.28;
      ctx.fillStyle = on ? "#ffe3a8" : tower ? "#1d242e" : "#6f7884";
      ctx.fillRect(x, y, 6, 7);
      if (on) { ectx.fillStyle = "#ffdca0"; ectx.fillRect(x, y, 6, 7); }
    }
  }
  const wrap = (canvas) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const tex = wrap(c);
  tex.emissive = tower ? wrap(e) : null;    // carried alongside so callers can pair them
  return tex;
}

const TEX = {
  ground: speckleTexture(256, "#7f8a63", ["#5f7043", "#93a06a", "#6b7a4e", "#a8ae86"], 3000, 2.6),
  asphalt: asphaltTexture(),
  sand: speckleTexture(256, "#dccfa2", ["#cbbd8d", "#e9dcb4", "#bfae7e"], 2200, 2.2),
  rock: speckleTexture(256, "#6f675d", ["#5b544c", "#837a6e", "#4a443d"], 2600, 3.0),
};

/* ---------- terrain ---------- */

/* The mesh. PlaneGeometry lays its vertices out row-major in exactly the same order as the
   heightmap, so every vertex can be written by index — no position reads, no bilinear lookups,
   and normals computed straight from the neighbouring heights rather than from the triangles.
   That is the difference between a seven-second load and a two-second one. */
function buildTerrain() {
  const t0 = performance.now();
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, GRID - 1, GRID - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const colors = new Float32Array(GRID * GRID * 3);
  const step = WORLD / (GRID - 1);
  const half = WORLD / 2;

  const sand = new THREE.Color(0xe4d8ab);
  const grass = new THREE.Color(0x56833f);
  const grassDry = new THREE.Color(0x8a9254);
  const forest = new THREE.Color(0x35592f);
  const scree = new THREE.Color(0x8c8375);
  const rock = new THREE.Color(0x6f675d);
  const rockDark = new THREE.Color(0x4a443d);
  const snow = new THREE.Color(0xf7f9fc);
  const seabed = new THREE.Color(0x46565c);
  const c = new THREE.Color();
  const band = new THREE.Color();

  const at = (i, j) => heights[clamp(j, 0, GRID - 1) * GRID + clamp(i, 0, GRID - 1)];

  for (let j = 0; j < GRID; j++) {
    const z = -half + j * step;
    for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      const x = -half + i * step;
      const h = heights[k];          // raw: under the sea this goes negative and keeps sinking
      pos[k * 3 + 1] = h;

      // analytic normal from the four neighbours
      const dx = at(i + 1, j) - at(i - 1, j);
      const dz = at(i, j + 1) - at(i, j - 1);
      const len = Math.hypot(dx, 2 * step, dz);
      nor[k * 3] = -dx / len;
      nor[k * 3 + 1] = (2 * step) / len;
      nor[k * 3 + 2] = -dz / len;

      const slope = Math.min(1, Math.hypot(dx, dz) / (2 * step) * 2.1);
      const patch = clamp(fbm(x / 640, z / 640, 3) * 0.5 + 0.5, 0, 1);
      const grain = clamp(noise2(x / 95 + 9, z / 95 - 4) * 0.5 + 0.5, 0, 1);

      c.copy(grass).lerp(grassDry, patch);
      c.lerp(forest, clamp((1 - patch) * 0.85 - slope * 0.35, 0, 0.75));
      if (h < 9) c.lerp(sand, clamp((9 - h) / 8, 0, 1));
      if (h < 0) c.lerp(seabed, clamp(-h / 40, 0, 1));   // under the water it darkens

      // strata: rock banded by height, so cliffs read as layers rather than flat grey
      band.copy(rock).lerp(rockDark, clamp(Math.sin(h * 0.035) * 0.5 + 0.5, 0, 1) * 0.8 + grain * 0.2);
      c.lerp(band, clamp(slope * 1.35 - 0.1, 0, 1));
      c.lerp(scree, clamp((slope - 0.45) * 0.6, 0, 0.35) * clamp(1 - h / 1500, 0, 1));

      const snowLine = 1020 + fbm(x / 1500, z / 1500, 3) * 260;
      if (h > snowLine) c.lerp(snow, clamp((h - snowLine) / 300, 0, 1) * clamp(1.35 - slope, 0, 1));

      c.multiplyScalar(0.93 + grain * 0.14);
      colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();

  // one detail texture tiled across the island, multiplied over the vertex colours: close up it
  // is grain, far away it disappears into the colour
  const detail = TEX.ground.clone();
  detail.needsUpdate = true;
  detail.repeat.set(WORLD / 26, WORLD / 26);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, map: detail, roughness: 0.95, metalness: 0.0,
  }));
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  console.info(`terrain: ${(GRID * GRID / 1000).toFixed(0)}k vertices in ${(performance.now() - t0).toFixed(0)} ms`);
  return mesh;
}

/* ---------- the sea ---------- */

// Gerstner-ish waves in the vertex shader, sky reflection and a sun glitter path in the
// fragment shader. The mesh follows the camera so the detail is always where you are.
/* A depth map of the whole island, baked once from the heightmap. The water shader reads it to
   know how deep it is under any point — which is what gives shallows their colour and puts a
   line of foam exactly on the waterline instead of somewhere near it. */
function buildDepthTexture(size = 512) {
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -WORLD / 2 + (i / (size - 1)) * WORLD;
      const z = -WORLD / 2 + (j / (size - 1)) * WORLD;
      const depth = clamp(-seabedAt(x, z) / 60, 0, 1);   // 0 at the shoreline, 1 at 60 m down
      data[j * size + i] = Math.round(depth * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildSea() {
  const geo = new THREE.PlaneGeometry(30000, 30000, 240, 240);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSky: { value: new THREE.Color(0x9cc7ee).convertSRGBToLinear() },
      uHaze: { value: new THREE.Color(0xf2e6d2).convertSRGBToLinear() },
      uDeep: { value: new THREE.Color(0x0b2f4a).convertSRGBToLinear() },
      uShallow: { value: new THREE.Color(0x2fa7b8).convertSRGBToLinear() },
      uFoam: { value: new THREE.Color(0xeaf6ff).convertSRGBToLinear() },
      uFogColor: { value: new THREE.Color(0xdce6ee) },
      uFogDensity: { value: 0.000035 },
      uDepth: { value: null },
      uWorld: { value: WORLD },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      // three overlapping wave trains give a surface that never visibly repeats
      vec3 wave(vec2 p, vec2 dir, float len, float amp, float speed, out vec3 n) {
        float k = 6.28318 / len;
        float f = k * (dot(dir, p) - speed * uTime);
        n = vec3(-dir.x * amp * k * cos(f), 0.0, -dir.y * amp * k * cos(f));
        return vec3(0.0, amp * sin(f), 0.0);
      }
      void main() {
        vec3 p = position;
        vec2 xz = (modelMatrix * vec4(position, 1.0)).xz;
        vec3 n1, n2, n3;
        p += wave(xz, normalize(vec2(1.0, 0.35)), 118.0, 1.25, 8.0, n1);
        p += wave(xz, normalize(vec2(-0.4, 1.0)), 57.0, 0.62, 6.5, n2);
        p += wave(xz, normalize(vec2(0.7, -0.8)), 24.0, 0.22, 4.5, n3);
        vNormal = normalize(vec3(0.0, 1.0, 0.0) + n1 + n2 + n3);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 uSun, uSky, uHaze, uDeep, uShallow, uFoam, uFogColor;
      uniform float uFogDensity, uWorld;
      uniform sampler2D uDepth;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec2 uv = vWorld.xz / uWorld + 0.5;
        float depth = texture2D(uDepth, uv).r;
        // outside the baked map we are miles offshore, so treat it as deep
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) depth = 1.0;

        vec3 n = normalize(vNormal);
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 s = normalize(uSun);
        float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.5);

        vec3 body = mix(uShallow, uDeep, smoothstep(0.02, 0.45, depth));
        vec3 skyCol = mix(uSky, uHaze, 0.35);
        vec3 col = mix(body, skyCol, clamp(fres * 1.1, 0.0, 0.88));

        // surf: a band of foam that sits on the waterline and breathes with the swell
        float swell = sin(vWorld.x * 0.045 + vWorld.z * 0.03) * 0.5 + 0.5;
        float surf = smoothstep(0.075, 0.0, depth) * (0.45 + swell * 0.55);
        col = mix(col, uFoam, clamp(surf, 0.0, 0.9));

        vec3 h = normalize(s + v);
        float spec = pow(clamp(dot(n, h), 0.0, 1.0), 200.0);
        float sheen = pow(clamp(dot(n, h), 0.0, 1.0), 16.0) * 0.1;
        col += vec3(1.0, 0.93, 0.8) * (spec * 2.2 + sheen);

        float d = length(cameraPosition - vWorld);
        float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
        col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  mat.uniforms.uDepth.value = buildDepthTexture();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA;
  scene.add(mesh);
  return mesh;
}

/* ---------- the airfields ---------- */

const asphaltTex = TEX.asphalt.clone();
asphaltTex.needsUpdate = true;
asphaltTex.repeat.set(2, 90);
const asphalt = new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTex, roughness: 0.86, metalness: 0.04 });
const paintMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
const grassTex = TEX.ground.clone();
grassTex.needsUpdate = true;
grassTex.repeat.set(12, 60);
const grassMat = new THREE.MeshStandardMaterial({ color: 0xa9b487, map: grassTex, roughness: 0.96 });
const sandTex = TEX.sand.clone();
sandTex.needsUpdate = true;
sandTex.repeat.set(8, 40);
const sandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: sandTex, roughness: 0.96 });
const gravelTex = TEX.rock.clone();
gravelTex.needsUpdate = true;
gravelTex.repeat.set(4, 30);
const gravelMat = new THREE.MeshStandardMaterial({ color: 0xb6ad9d, map: gravelTex, roughness: 0.98 });
const mownTex = TEX.ground.clone();
mownTex.needsUpdate = true;
mownTex.repeat.set(5, 26);
const mownMat = new THREE.MeshStandardMaterial({ color: 0x9fb072, map: mownTex, roughness: 0.97 });

/* The number painted on the threshold is the runway's magnetic heading rounded to ten degrees
   and divided by ten — so a strip pointing north is "36" from one end and "18" from the other.
   Drawing it means the sign you line up with is the same number the map calls it. */
function runwayNumber(deg) {
  const n = ((Math.round(deg / 10) + 35) % 36) + 1;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = "#f2f2f2";
  ctx.font = "bold 84px 'Barlow Condensed', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n).padStart(2, "0"), 64, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// One builder for every strip: the big international field gets the full furniture, the
// outstations get a strip, some lights and whatever suits where they are.
function buildAirfield(f) {
  const group = new THREE.Group();
  const y = f.elev;

  const big = f.kind === "intl" || f.kind === "regional";
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(f.w + (f.kind === "intl" ? 260 : big ? 170 : 90), f.len + (f.kind === "intl" ? 340 : 160)),
    f.kind === "beach" ? sandMat : grassMat,
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.05;
  group.add(apron);

  // each kind of field gets its own surface, and the surface is most of what tells you what
  // sort of place you have just arrived at
  const surfaceMat = f.kind === "beach" ? sandMat.clone()
    : f.kind === "grass" ? (f.id === "condor" ? gravelMat.clone() : mownMat.clone())
      : asphalt;
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.len), surfaceMat);
  if (f.kind === "beach") strip.material.color.set(0xcdb98a);
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.12;
  group.add(strip);

  // the threshold numbers, one at each end, each reading the right way up as you land on it
  const degs = (THREE.MathUtils.radToDeg(f.hdg) + 360) % 360;
  for (const end of [-1, 1]) {
    const size = Math.min(26, f.w * 0.62);
    const num = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: runwayNumber(end > 0 ? degs : degs + 180), transparent: true }),
    );
    num.rotation.x = -Math.PI / 2;
    // the plane's local +Y lands on world -Z once it is laid flat, so the number at the +Z end
    // already reads correctly to someone approaching it; the far end is the one that needs the
    // half turn
    num.rotation.z = end > 0 ? 0 : Math.PI;
    num.position.set(0, 0.22, end * (f.len / 2 - 60));
    group.add(num);
  }

  for (let d = -f.len / 2 + 130; d < f.len / 2 - 130; d += 60) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 30), paintMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.2, d);
    group.add(dash);
  }
  for (const end of [-1, 1]) {
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 26), paintMat);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(k * 4.2, 0.2, end * (f.len / 2 - 26));
      group.add(bar);
    }
  }

  const bulb = new THREE.SphereGeometry(0.7, 6, 5);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const green = new THREE.MeshBasicMaterial({ color: 0x46ff8c });
  for (let d = -f.len / 2; d <= f.len / 2; d += 90) {
    for (const sideX of [-f.w / 2 - 2, f.w / 2 + 2]) {
      const b = new THREE.Mesh(bulb, Math.abs(d - f.len / 2) < 1 ? green : white);
      b.position.set(sideX, 0.6, d);
      group.add(b);
    }
  }

  if (f.kind === "intl") {
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(18, f.len * 0.8), asphalt);
    taxi.rotation.x = -Math.PI / 2;
    taxi.position.set(-110, 0.1, 0);
    group.add(taxi);

    for (let k = 0; k < 4; k++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6),
        new THREE.MeshBasicMaterial({ color: k < 2 ? 0xff4b3a : 0xffffff }));
      lamp.position.set(-f.w / 2 - 16 - k * 5, 1.2, f.len / 2 - 260);
      group.add(lamp);
    }

    const tower = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 26, 12), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.8 }));
    base.position.y = 13;
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 7, 12), new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.3 }));
    cab.position.y = 29;
    const glassRing = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 4.4, 12), new THREE.MeshStandardMaterial({ color: 0x8fd0ff, roughness: 0.1, metalness: 0.6 }));
    glassRing.position.y = 29.4;
    tower.add(base, cab, glassRing);
    tower.position.set(-120, 0, -240);
    group.add(tower);

    for (let i = 0; i < 3; i++) {
      const hangar = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 52, 16, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.45, metalness: 0.45 }));
      shell.rotation.z = Math.PI / 2;
      shell.rotation.y = Math.PI / 2;
      shell.position.y = 0.5;
      const backWall = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.7, side: THREE.DoubleSide }));
      backWall.position.set(0, 11, -26);
      hangar.add(shell, backWall);
      hangar.position.set(-190, 0, -60 + i * 90);
      group.add(hangar);
    }
  } else if (f.kind === "regional") {
    // a regional field: one terminal block with a glass frontage, a strip of apron and three
    // stands with the taxi line painted in
    const term = new THREE.Mesh(new THREE.BoxGeometry(24, 11, 130),
      new THREE.MeshStandardMaterial({ color: 0xded8cc, roughness: 0.82 }));
    term.position.set(-f.w / 2 - 68, 5.5, -120);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7, 126),
      new THREE.MeshStandardMaterial({ map: windowTexture(false), roughness: 0.16, metalness: 0.55 }));
    glass.position.set(-f.w / 2 - 55.6, 5.4, -120);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(27, 1, 134),
      new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 0.9 }));
    roof.position.set(-f.w / 2 - 68, 11.4, -120);
    const ramp = new THREE.Mesh(new THREE.PlaneGeometry(74, 220), asphalt);
    ramp.rotation.x = -Math.PI / 2;
    ramp.position.set(-f.w / 2 - 20, 0.1, -120);
    group.add(term, glass, roof, ramp);
    for (let k = 0; k < 3; k++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 44), new THREE.MeshBasicMaterial({ color: 0xf0c53a }));
      line.rotation.x = -Math.PI / 2;
      line.position.set(-f.w / 2 - 34, 0.18, -180 + k * 56);
      group.add(line);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 11, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.set(f.w / 2 + 14, 5.5, 0);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5.4, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide, roughness: 0.9 }));
    sock.rotation.z = -Math.PI / 2;
    sock.position.set(f.w / 2 + 17, 10.2, 0);
    group.add(pole, sock);
  } else {
    // outstations get a hut and a windsock instead of a terminal
    const hut = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 9), new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.85 }));
    hut.position.set(f.w / 2 + 26, 3, -f.len / 4);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 4, 4), new THREE.MeshStandardMaterial({ color: 0x8a4f3a, roughness: 0.8 }));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(f.w / 2 + 26, 8, -f.len / 4);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 9, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.set(f.w / 2 + 12, 4.5, 0);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(1.5, 5, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide, roughness: 0.9 }));
    sock.rotation.z = -Math.PI / 2;
    sock.position.set(f.w / 2 + 15, 8.4, 0);
    group.add(hut, roof, pole, sock);
  }

  group.position.set(f.x, y, f.z);
  group.rotation.y = f.hdg;
  group.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = o.geometry.type !== "PlaneGeometry"; } });
  scene.add(group);
  return group;
}

/* ---------- landmarks ---------- */

// A small port city on the south coast: blocks of towers, a few with lit windows.
const cityLights = [];
function buildCity(cx, cz) {
  const group = new THREE.Group();
  // two facade textures, tiled per building by its size, so a tower reads as forty floors of
  // windows rather than a blue box
  const lowTex = windowTexture(false);
  const towerTex = windowTexture(true);
  const wall = new THREE.MeshStandardMaterial({ color: 0xcfc6b6, map: lowTex, roughness: 0.82 });
  // the lit squares in the tower texture double as an emissive map, so at dusk the windows
  // come on by themselves instead of the whole block going flat black
  const glassWall = new THREE.MeshStandardMaterial({
    color: 0x9fc4e0, map: towerTex, roughness: 0.18, metalness: 0.55,
    emissive: 0xffffff, emissiveMap: towerTex.emissive, emissiveIntensity: 0,
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b5e52, roughness: 0.9 });
  let built = 0;
  for (let i = 0; i < 260 && built < 170; i++) {
    const x = cx + (Math.random() - 0.5) * 1500;
    const z = cz + (Math.random() - 0.5) * 1500;
    const g = groundAt(x, z);
    if (g < 6 || g > 150) continue;
    const e = 20;
    const slope = (Math.abs(groundAt(x + e, z) - g) + Math.abs(groundAt(x, z + e) - g)) / e;
    if (slope > 0.22) continue;
    const dist = Math.hypot(x - cx, z - cz) / 750;
    const tall = Math.random() < 0.3 - dist * 0.2;
    const h = tall ? 40 + Math.random() * 90 : 8 + Math.random() * 16;
    const w = tall ? 14 + Math.random() * 12 : 12 + Math.random() * 16;
    const d = tall ? 14 + Math.random() * 12 : 12 + Math.random() * 16;
    const lit = tall && Math.random() < 0.6;
    const mat = (lit ? glassWall : wall).clone();
    mat.map = mat.map.clone();
    mat.map.needsUpdate = true;
    mat.map.repeat.set(Math.max(1, Math.round(w / 9)), Math.max(1, Math.round(h / 7)));
    if (lit) {
      // the emissive map has to be tiled exactly like the colour map or the glow drifts off
      // the windows it belongs to
      mat.emissiveMap = towerTex.emissive.clone();
      mat.emissiveMap.needsUpdate = true;
      mat.emissiveMap.repeat.copy(mat.map.repeat);
      cityLights.push(mat);
    }
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, g + h / 2, z);
    b.rotation.y = Math.round(Math.random() * 4) * Math.PI / 8;
    b.castShadow = b.receiveShadow = true;
    group.add(b);
    if (!tall) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 1.2, d + 1), roofMat);
      roof.position.set(x, g + h + 0.6, z);
      roof.rotation.y = b.rotation.y;
      group.add(roof);
    }
    built++;
  }
  scene.add(group);
  return group;
}

// An aircraft carrier, with a deck you can actually land on.
function buildCarrier(cx, cz, hdg = 0.3) {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(70, 16, 300), new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.7, metalness: 0.4 }));
  hull.position.y = 4;
  const deckTex = TEX.asphalt.clone();
  deckTex.needsUpdate = true;
  deckTex.repeat.set(3, 12);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(76, 2.4, 310), new THREE.MeshStandardMaterial({ color: 0x9296a0, map: deckTex, roughness: 0.88 }));
  deck.position.y = 13;
  group.add(hull, deck);

  // the angled landing area, painted across the deck
  const angled = new THREE.Mesh(new THREE.PlaneGeometry(22, 230), new THREE.MeshBasicMaterial({ color: 0x4a4e55 }));
  angled.rotation.x = -Math.PI / 2;
  angled.rotation.z = -0.16;
  angled.position.set(-6, 14.3, -10);
  group.add(angled);
  for (let d = -100; d < 100; d += 22) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 11), paintMat);
    dash.rotation.x = -Math.PI / 2;
    dash.rotation.z = -0.16;
    dash.position.set(-6 + d * 0.16, 14.4, -10 + d);
    group.add(dash);
  }
  const island = new THREE.Mesh(new THREE.BoxGeometry(11, 20, 44), new THREE.MeshStandardMaterial({ color: 0x555b63, roughness: 0.65, metalness: 0.3 }));
  island.position.set(31, 24, 20);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 22, 8), new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.6, roughness: 0.4 }));
  mast.position.set(31, 45, 20);
  group.add(island, mast);

  group.position.set(cx, 0, cz);
  group.rotation.y = hdg;
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(group);

  // the physics deck: axis-aligned, which is why the ship sits close to axis-aligned too
  const halfW = 40 * Math.cos(hdg) + 155 * Math.sin(hdg);
  const halfL = 155 * Math.cos(hdg) + 40 * Math.sin(hdg);
  DECKS.push({ x0: cx - halfW * 0.72, x1: cx + halfW * 0.72, z0: cz - halfL * 0.72, z1: cz + halfL * 0.72, y: 14.2, name: "the carrier" });
  return group;
}

// A wind farm along a ridge: the blades turn, which catches the eye from miles away.
const turbines = [];
function buildWindFarm(cx, cz) {
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xf0f2f5, roughness: 0.5, metalness: 0.2 });
  for (let i = 0; i < 14; i++) {
    const x = cx + (Math.random() - 0.5) * 2400;
    const z = cz + (Math.random() - 0.5) * 1800;
    const g = groundAt(x, z);
    if (g < 120 || g > 760) continue;
    const g2 = groundAt(x + 20, z);
    if (Math.abs(g2 - g) / 20 > 0.3) continue;
    const t = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.0, 78, 10), towerMat);
    mast.position.y = 39;
    const nacelle = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 8), towerMat);
    nacelle.position.y = 78;
    const rotor = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 34, 0.6), towerMat);
      blade.position.y = 17;
      const holder = new THREE.Group();
      holder.add(blade);
      holder.rotation.z = (b * Math.PI * 2) / 3;
      rotor.add(holder);
    }
    rotor.position.set(0, 78, -4.6);
    t.add(mast, nacelle, rotor);
    t.position.set(x, g, z);
    t.rotation.y = Math.random() * Math.PI;
    t.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(t);
    turbines.push(rotor);
  }
}

// A lighthouse on the western headland, with a beam that sweeps.
let beacon = null;
function buildLighthouse(x, z) {
  const g = groundAt(x, z);
  const group = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5, 34, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
  tower.position.y = 17;
  for (let i = 0; i < 3; i++) {
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(3.9 - i * 0.25, 4.3 - i * 0.25, 4, 14), new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.6 }));
    stripe.position.y = 6 + i * 10;
    group.add(stripe);
  }
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 5, 12), new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc04a, emissiveIntensity: 1.6, roughness: 0.3 }));
  lamp.position.y = 36;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(4.2, 4, 12), new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6 }));
  cap.position.y = 40.5;
  const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 190, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
  beam.rotation.z = Math.PI / 2;
  beam.position.set(0, 36, 0);
  beam.translateY(-95);
  const spin = new THREE.Group();
  spin.add(beam);
  spin.position.y = 0;
  group.add(tower, lamp, cap, spin);
  group.position.set(x, g, z);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(group);
  beacon = spin;
}

// Shipping: a few hulls making way, because an empty sea reads as a bug.
const boats = [];
function buildBoats(count = 7) {
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8e2f2f, roughness: 0.7, metalness: 0.3 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.8 });
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const len = 26 + Math.random() * 90;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len * 0.22, 6, len), hullMat);
    hull.position.y = 1.5;
    const house = new THREE.Mesh(new THREE.BoxGeometry(len * 0.18, 7, len * 0.22), deckMat);
    house.position.set(0, 7, len * 0.22);
    g.add(hull, house);
    const a = Math.random() * Math.PI * 2;
    const r = 6200 + Math.random() * 1800;
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.rotation.y = Math.random() * Math.PI * 2;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    boats.push({ group: g, speed: 3 + Math.random() * 6 });
  }
}

/* ---------- scenery ---------- */

function scatterTrees(count = 9000) {
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 4, 5);
  const leafGeo = new THREE.ConeGeometry(3.4, 11, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4433, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x33632f, roughness: 0.9 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < count * 12) {
    const x = (Math.random() - 0.5) * WORLD * 0.92;
    const z = (Math.random() - 0.5) * WORLD * 0.92;
    const h = groundAt(x, z);
    if (h < 12 || h > 980) continue;                     // no trees on the beach or the peaks
    if (FIELDS.some((f) => Math.hypot(x - f.x, z - f.z) < f.len * 0.75)) continue;
    if (Math.hypot(x + 3100, z - 4200) < 1200) continue; // or in town
    const e = 20;
    const slope = (Math.abs(groundAt(x + e, z) - h) + Math.abs(groundAt(x, z + e) - h)) / e;
    if (slope > 0.55) continue;
    const s = 0.7 + Math.random() * 1.5;
    scale.set(s, s * (0.8 + Math.random() * 0.6), s);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    m.compose(new THREE.Vector3(x, h + 2 * s, z), q, scale);
    trunks.setMatrixAt(n, m);
    m.compose(new THREE.Vector3(x, h + 9.5 * s, z), q, scale);
    leaves.setMatrixAt(n, m);
    n++;
  }
  trunks.count = leaves.count = n;
  trunks.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
  trunks.castShadow = leaves.castShadow = true;
  scene.add(trunks, leaves);
}

/* Clouds as soft billboards. A canvas-drawn radial gradient costs nothing to make, always
   faces the camera, and reads as vapour where a shaded polyhedron reads as a rock. */
function puffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.45, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const clouds = [];
function buildClouds(count = 110) {
  const tex = puffTexture();
  for (let i = 0; i < count; i++) {
    const cx = (Math.random() - 0.5) * WORLD * 1.6;
    const cz = (Math.random() - 0.5) * WORLD * 1.6;
    const base = 800 + Math.random() * 1900;
    const group = new THREE.Group();
    const puffs = 5 + Math.floor(Math.random() * 5);
    for (let p = 0; p < puffs; p++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, fog: true,
        opacity: 0.5 + Math.random() * 0.3,
      }));
      const size = 260 + Math.random() * 420;
      sprite.scale.set(size, size * (0.5 + Math.random() * 0.25), 1);
      sprite.position.set((Math.random() - 0.5) * 620, (Math.random() - 0.5) * 130, (Math.random() - 0.5) * 620);
      group.add(sprite);
    }
    group.position.set(cx, base, cz);
    scene.add(group);
    clouds.push({ group, drift: 2 + Math.random() * 4 });
  }
}

/* ================= the aircraft ================= */

const mat = {
  white: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.38, metalness: 0.18 }),
  red: new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.35, metalness: 0.15 }),
  navy: new THREE.MeshStandardMaterial({ color: 0x1b3a63, roughness: 0.35, metalness: 0.2 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x8b939c, roughness: 0.42, metalness: 0.55 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xb9c2cb, roughness: 0.22, metalness: 0.85 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.5 }),
  burn: new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.3, metalness: 0.6 }),
};

/* A wing that tapers and sweeps, rather than a box: the single biggest difference between
   "some shapes" and "an aeroplane" at any distance. */
function wingGeo({ span, root, tip, thick = 0.22, sweep = 0, dihedral = 0 }) {
  const g = new THREE.BoxGeometry(1, 1, 1, 8, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.abs(x) * 2;
    const chord = lerp(root, tip, t * t * 0.55 + t * 0.45);
    p.setX(i, x * span);
    p.setY(i, y * thick * lerp(1, 0.55, t) + t * dihedral * span * 0.5);
    p.setZ(i, z * chord + t * sweep);
  }
  g.computeVertexNormals();
  return g;
}

function addShadows(group) {
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
}

/* ---------- 1. the trainer ---------- */
function buildSkylark() {
  const g = new THREE.Group();
  const s = {};

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.72, 4.4, 8, 18), mat.white);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.5;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.6, 18), mat.white);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -3.5;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 14), mat.red);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -4.4;
  g.add(fuse, nose, spinner);

  const prop = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.17, 3.0, 0.07), mat.dark);
    blade.rotation.z = i * Math.PI / 2;
    prop.add(blade);
  }
  prop.position.z = -4.2;
  g.add(prop);
  s.prop = prop;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 28), new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  disc.position.z = -4.25;
  g.add(disc);
  s.disc = disc;

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 2.2), mat.glass);
  cabin.position.set(0, 0.52, -1.0);
  g.add(cabin);

  const wing = new THREE.Mesh(wingGeo({ span: 11.4, root: 1.7, tip: 1.3, dihedral: 0.05 }), mat.white);
  wing.position.set(0, 0.95, -0.7);
  g.add(wing);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.2, 5.4), mat.red);
  stripe.position.set(0, -0.3, 0.6);
  g.add(stripe);

  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.6, 0.14), mat.grey);
    strut.position.set(side * 2.2, 0.26, -0.5);
    strut.rotation.z = side * 0.42;
    g.add(strut);
    const ail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.13, 0.5), mat.red);
    ail.position.set(side * 4.0, 0.95, 0.25);
    g.add(ail);
    s[side > 0 ? "aileronR" : "aileronL"] = ail;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.13, 0.52), mat.white);
    flap.position.set(side * 1.35, 0.95, 0.25);
    g.add(flap);
    s[side > 0 ? "flapR" : "flapL"] = flap;
  }

  const tail = new THREE.Mesh(wingGeo({ span: 4.4, root: 1.15, tip: 0.8 }), mat.white);
  tail.position.set(0, 0.36, 3.3);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.12, 0.46), mat.red);
  elev.position.set(0, 0.36, 3.95);
  const fin = new THREE.Mesh(wingGeo({ span: 1.8, root: 1.6, tip: 0.9, thick: 0.16, sweep: 0.5 }), mat.white);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 1.15, 3.35);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.5, 0.5), mat.red);
  rud.position.set(0, 1.1, 4.15);
  g.add(tail, elev, fin, rud);
  s.elevator = elev;
  s.rudder = rud;

  s.gear = gearLegs(g, { main: [1.55, -1.45, 0.3], nose: [0, -1.45, -2.6], radius: 0.34 });
  navLights(g, 5.8, 0.98, -0.7);
  addShadows(g);
  return { group: g, surfaces: s };
}

/* ---------- 2. the aerobat ---------- */
function buildSprint() {
  const g = new THREE.Group();
  const s = {};

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 4.0, 8, 18), mat.red);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.4;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.8, 18), mat.red);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -3.3;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 16), mat.white);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -4.3;
  g.add(fuse, nose, spinner);

  const prop = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.1, 0.08), mat.dark);
    blade.rotation.z = i * Math.PI / 3;
    prop.add(blade);
  }
  prop.position.z = -4.1;
  g.add(prop);
  s.prop = prop;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 28), new THREE.MeshBasicMaterial({ color: 0xaab3bd, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  disc.position.z = -4.15;
  g.add(disc);
  s.disc = disc;

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat.glass);
  canopy.scale.set(1, 0.85, 2.0);
  canopy.position.set(0, 0.42, -0.2);
  g.add(canopy);

  // low wing, straight and short for a fast roll
  const wing = new THREE.Mesh(wingGeo({ span: 8.4, root: 1.9, tip: 1.1, thick: 0.3, dihedral: 0.035 }), mat.white);
  wing.position.set(0, -0.3, -0.2);
  g.add(wing);
  for (const side of [-1, 1]) {
    const ail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.52), mat.red);
    ail.position.set(side * 3.0, -0.28, 0.6);
    g.add(ail);
    s[side > 0 ? "aileronR" : "aileronL"] = ail;
    const tipPlate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 1.3), mat.white);
    tipPlate.position.set(side * 4.2, -0.2, -0.1);
    g.add(tipPlate);
  }
  s.flapL = s.flapR = null;

  const tail = new THREE.Mesh(wingGeo({ span: 3.6, root: 1.1, tip: 0.7 }), mat.white);
  tail.position.set(0, 0.1, 3.1);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.12, 0.44), mat.red);
  elev.position.set(0, 0.1, 3.7);
  const fin = new THREE.Mesh(wingGeo({ span: 1.6, root: 1.5, tip: 0.8, thick: 0.16, sweep: 0.4 }), mat.white);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 0.85, 3.2);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 0.46), mat.red);
  rud.position.set(0, 0.82, 3.85);
  g.add(tail, elev, fin, rud);
  s.elevator = elev;
  s.rudder = rud;

  s.gear = gearLegs(g, { main: [1.3, -1.25, -0.4], tail: [0, -0.85, 3.3], radius: 0.3 });
  navLights(g, 4.3, -0.25, -0.2);
  addShadows(g);
  return { group: g, surfaces: s };
}

/* ---------- 3. the jet ---------- */
function buildFalcon() {
  const g = new THREE.Group();
  const s = {};

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 8.2, 8, 20), mat.grey);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.6;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.4, 20), mat.grey);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -6.2;
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 1.4, 6), mat.dark);
  probe.rotation.x = Math.PI / 2;
  probe.position.z = -8.4;
  g.add(fuse, nose, probe);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat.glass);
  canopy.scale.set(0.95, 1.0, 2.6);
  canopy.position.set(0, 0.55, -2.6);
  g.add(canopy);

  // a sharply swept wing, plus strakes running forward along the fuselage
  const wing = new THREE.Mesh(wingGeo({ span: 9.6, root: 4.6, tip: 1.2, thick: 0.34, sweep: 2.6 }), mat.grey);
  wing.position.set(0, -0.15, 1.4);
  g.add(wing);
  for (const side of [-1, 1]) {
    const strake = new THREE.Mesh(wingGeo({ span: 2.4, root: 2.6, tip: 0.4, thick: 0.18, sweep: 1.5 }), mat.grey);
    strake.position.set(side * 1.3, -0.1, -2.4);
    g.add(strake);
    const ail = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.16, 0.8), mat.navy);
    ail.position.set(side * 3.3, -0.14, 3.3);
    g.add(ail);
    s[side > 0 ? "aileronR" : "aileronL"] = ail;
    // canted twin tails
    const finT = new THREE.Mesh(wingGeo({ span: 2.5, root: 2.4, tip: 1.0, thick: 0.18, sweep: 1.4 }), mat.grey);
    finT.rotation.z = Math.PI / 2 + side * 0.22;
    finT.position.set(side * 1.5, 1.3, 3.8);
    g.add(finT);
    // intakes
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 2.6), mat.grey);
    intake.position.set(side * 1.25, -0.35, -1.2);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.68, 0.2), mat.dark);
    mouth.position.set(side * 1.25, -0.35, -2.45);
    g.add(intake, mouth);
  }

  const tailplane = new THREE.Mesh(wingGeo({ span: 5.6, root: 1.9, tip: 0.8, sweep: 1.1 }), mat.grey);
  tailplane.position.set(0, 0.05, 4.6);
  g.add(tailplane);
  s.elevator = tailplane;
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.6), mat.navy);
  rud.position.set(0, 1.9, 5.0);
  g.add(rud);
  s.rudder = rud;

  // exhaust with an afterburner cone that lights with the throttle
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.85, 1.2, 18), mat.steel);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 5.4;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4.2, 16), mat.burn.clone());
  flame.rotation.x = Math.PI / 2;
  flame.position.z = 7.6;
  g.add(nozzle, flame);
  s.flame = flame;

  s.prop = null;
  s.disc = null;
  s.gear = gearLegs(g, { main: [1.7, -1.5, 1.6], nose: [0, -1.5, -3.4], radius: 0.36 });
  navLights(g, 4.8, -0.1, 2.6);
  addShadows(g);
  return { group: g, surfaces: s };
}

/* ---------- 4. the airliner ---------- */
function buildAtlas() {
  const g = new THREE.Group();
  const s = {};

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(1.9, 26, 10, 24), mat.white);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 1.0;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14), mat.white);
  nose.scale.z = 1.6;
  nose.position.z = -14.4;
  g.add(fuse, nose);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.8), mat.glass);
  cockpit.position.set(0, 0.95, -13.4);
  g.add(cockpit);

  // a cabin window line, cheap and very legible from outside
  const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.4, 0.08), mat.dark, 46);
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < 23; i++) {
    for (const side of [-1, 1]) {
      m4.makeTranslation(side * 1.87, 0.72, -11 + i * 1.1);
      windows.setMatrixAt(n++, m4);
    }
  }
  windows.count = n;
  windows.instanceMatrix.needsUpdate = true;
  g.add(windows);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(3.86, 0.55, 26), mat.navy);
  belt.position.set(0, -0.35, 1.0);
  g.add(belt);

  const wing = new THREE.Mesh(wingGeo({ span: 32, root: 6.4, tip: 1.8, thick: 0.75, sweep: 5.2, dihedral: 0.045 }), mat.white);
  wing.position.set(0, -0.6, 2.2);
  g.add(wing);

  for (const side of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, 2.2), mat.white);
    pylon.position.set(side * 7.4, -1.1, 1.0);
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.2, 4.6, 20), mat.steel);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 7.4, -1.9, 0.6);
    const intake = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.16, 10, 22), mat.grey);
    intake.position.set(side * 7.4, -1.9, -1.7);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(1.18, 22), mat.dark);
    fan.position.set(side * 7.4, -1.9, -1.66);
    g.add(pylon, nacelle, intake, fan);

    const ail = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.35, 1.5), mat.navy);
    ail.position.set(side * 12.5, -0.35, 7.0);
    g.add(ail);
    s[side > 0 ? "aileronR" : "aileronL"] = ail;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.34, 2.0), mat.white);
    flap.position.set(side * 5.0, -0.6, 6.2);
    g.add(flap);
    s[side > 0 ? "flapR" : "flapL"] = flap;
  }

  const tailplane = new THREE.Mesh(wingGeo({ span: 12.5, root: 3.4, tip: 1.2, sweep: 2.2 }), mat.white);
  tailplane.position.set(0, 1.4, 12.6);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 1.1), mat.navy);
  elev.position.set(0, 1.4, 13.8);
  const fin = new THREE.Mesh(wingGeo({ span: 7.4, root: 5.2, tip: 2.2, thick: 0.5, sweep: 3.4 }), mat.white);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 5.0, 12.4);
  const finPaint = new THREE.Mesh(new THREE.BoxGeometry(0.42, 4.6, 3.2), mat.navy);
  finPaint.position.set(0, 6.2, 13.4);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.0, 1.1), mat.navy);
  rud.position.set(0, 5.6, 14.6);
  g.add(tailplane, elev, fin, finPaint, rud);
  s.elevator = elev;
  s.rudder = rud;

  s.prop = null;
  s.disc = null;
  s.gear = gearLegs(g, { main: [3.6, -3.3, 3.2], nose: [0, -3.3, -10.5], radius: 0.8, pairs: 2 });
  navLights(g, 16.4, -0.45, 2.2);
  addShadows(g);
  return { group: g, surfaces: s };
}

/* ---------- 5. the warbird ---------- */
function buildMustang() {
  const g = new THREE.Group();
  const s = {};
  const olive = new THREE.MeshStandardMaterial({ color: 0xb9c4cc, roughness: 0.28, metalness: 0.78 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe2b21c, roughness: 0.4, metalness: 0.3 });

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 5.4, 8, 20), olive);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.6;
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.66, 2.6, 18), olive);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -3.4;
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 3.0), olive);
  scoop.position.set(0, -0.78, 1.4);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 16), trim);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -5.0;
  g.add(fuse, nose, scoop, spinner);

  const prop = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.4, 0.09), mat.dark);
    blade.rotation.z = (i * Math.PI) / 2;
    prop.add(blade);
  }
  prop.position.z = -4.8;
  g.add(prop);
  s.prop = prop;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.75, 28), new THREE.MeshBasicMaterial({ color: 0xaab3bd, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  disc.position.z = -4.85;
  g.add(disc);
  s.disc = disc;

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.66, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat.glass);
  canopy.scale.set(1, 1.05, 2.4);
  canopy.position.set(0, 0.6, -0.4);
  g.add(canopy);

  const wing = new THREE.Mesh(wingGeo({ span: 11.3, root: 2.9, tip: 1.2, thick: 0.34, sweep: 0.45, dihedral: 0.05 }), olive);
  wing.position.set(0, -0.3, 0.2);
  g.add(wing);
  for (const side of [-1, 1]) {
    const ail = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.15, 0.6), trim);
    ail.position.set(side * 4.1, -0.26, 1.5);
    g.add(ail);
    s[side > 0 ? "aileronR" : "aileronL"] = ail;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.7), olive);
    flap.position.set(side * 1.7, -0.3, 1.6);
    g.add(flap);
    s[side > 0 ? "flapR" : "flapL"] = flap;
  }

  const tail = new THREE.Mesh(wingGeo({ span: 4.6, root: 1.5, tip: 0.8, sweep: 0.3 }), olive);
  tail.position.set(0, 0.1, 4.3);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.13, 0.5), trim);
  elev.position.set(0, 0.1, 4.95);
  const fin = new THREE.Mesh(wingGeo({ span: 2.0, root: 2.2, tip: 1.0, thick: 0.16, sweep: 0.7 }), olive);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 1.05, 4.4);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.8, 0.55), trim);
  rud.position.set(0, 1.05, 5.15);
  g.add(tail, elev, fin, rud);
  s.elevator = elev;
  s.rudder = rud;

  s.gear = gearLegs(g, { main: [1.5, -1.35, -0.6], tail: [0, -0.9, 4.4], radius: 0.36 });
  navLights(g, 5.75, -0.22, 0.2);
  addShadows(g);
  return { group: g, surfaces: s };
}

/* ---------- 6. the bush plane ---------- */
function buildBush() {
  const g = new THREE.Group();
  const s = {};
  const skin = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.55, metalness: 0.1 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2f5d3f, roughness: 0.5 });

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 4.6, 8, 18), skin);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.4;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 18), skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -3.5;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 14), trim);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -4.4;
  g.add(fuse, nose, spinner);

  const prop = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.09), mat.dark);
    blade.rotation.z = (i * Math.PI * 2) / 3;
    prop.add(blade);
  }
  prop.position.z = -4.2;
  g.add(prop);
  s.prop = prop;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 26), new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  disc.position.z = -4.25;
  g.add(disc);
  s.disc = disc;

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 2.6), mat.glass);
  cabin.position.set(0, 0.55, -1.0);
  g.add(cabin);

  // a big, thick, high wing with full-span slats: this thing does not want to stop flying
  const wing = new THREE.Mesh(wingGeo({ span: 13.2, root: 2.1, tip: 1.9, thick: 0.34, dihedral: 0.03 }), skin);
  wing.position.set(0, 1.05, -0.6);
  const slat = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.14, 0.3), trim);
  slat.position.set(0, 1.16, -1.5);
  g.add(wing, slat);
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.7, 0.16), mat.steel);
    strut.position.set(side * 2.4, 0.3, -0.4);
    strut.rotation.z = side * 0.45;
    g.add(strut);
    const ail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 0.55), trim);
    ail.position.set(side * 4.6, 1.03, 0.35);
    g.add(ail);
    s[side > 0 ? "aileronR" : "aileronL"] = ail;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.15, 0.62), skin);
    flap.position.set(side * 1.5, 1.03, 0.4);
    g.add(flap);
    s[side > 0 ? "flapR" : "flapL"] = flap;
  }

  const tail = new THREE.Mesh(wingGeo({ span: 4.6, root: 1.3, tip: 0.9 }), skin);
  tail.position.set(0, 0.4, 3.4);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.13, 0.5), trim);
  elev.position.set(0, 0.4, 4.05);
  const fin = new THREE.Mesh(wingGeo({ span: 1.9, root: 1.7, tip: 1.0, thick: 0.17, sweep: 0.4 }), skin);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 1.2, 3.5);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.7, 0.55), trim);
  rud.position.set(0, 1.2, 4.2);
  g.add(tail, elev, fin, rud);
  s.elevator = elev;
  s.rudder = rud;

  // tundra tyres — huge, soft, and the reason it can land on a hillside
  s.gear = gearLegs(g, { main: [1.75, -1.6, -0.5], tail: [0, -1.0, 3.6], radius: 0.62 });
  navLights(g, 6.7, 1.08, -0.6);
  addShadows(g);
  return { group: g, surfaces: s };
}

/* ---------- 7. the seaplane ---------- */
function buildSeaplane() {
  const g = new THREE.Group();
  const s = {};
  const skin = new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.42, metalness: 0.15 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1d6fa5, roughness: 0.4 });

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 4.8, 8, 18), skin);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.4;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.7, 18), skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -3.6;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 14), trim);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -4.5;
  g.add(fuse, nose, spinner);

  const prop = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.1, 0.08), mat.dark);
    blade.rotation.z = (i * Math.PI) / 2;
    prop.add(blade);
  }
  prop.position.z = -4.3;
  g.add(prop);
  s.prop = prop;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 26), new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  disc.position.z = -4.35;
  g.add(disc);
  s.disc = disc;

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.95, 2.4), mat.glass);
  cabin.position.set(0, 0.5, -1.0);
  g.add(cabin);

  const wing = new THREE.Mesh(wingGeo({ span: 12.0, root: 1.9, tip: 1.4, dihedral: 0.04 }), skin);
  wing.position.set(0, 1.0, -0.5);
  g.add(wing);
  for (const side of [-1, 1]) {
    const ail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.5), trim);
    ail.position.set(side * 4.2, 0.98, 0.35);
    g.add(ail);
    s[side > 0 ? "aileronR" : "aileronL"] = ail;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.55), skin);
    flap.position.set(side * 1.4, 0.98, 0.4);
    g.add(flap);
    s[side > 0 ? "flapR" : "flapL"] = flap;

    // the floats, and the struts holding them on
    const float = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 4.4, 6, 12), trim);
    float.rotation.x = Math.PI / 2;
    float.position.set(side * 1.5, -1.65, -0.2);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.3, 0.5), trim);
    step.position.set(side * 1.5, -1.85, 0.6);
    g.add(float, step);
    for (const zz of [-1.6, 1.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.12), mat.steel);
      post.position.set(side * 1.5, -0.9, zz);
      g.add(post);
    }
  }

  const tail = new THREE.Mesh(wingGeo({ span: 4.4, root: 1.2, tip: 0.85 }), skin);
  tail.position.set(0, 0.35, 3.5);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.13, 0.48), trim);
  elev.position.set(0, 0.35, 4.1);
  const fin = new THREE.Mesh(wingGeo({ span: 1.9, root: 1.7, tip: 0.95, thick: 0.16, sweep: 0.5 }), skin);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 1.2, 3.6);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.7, 0.52), trim);
  rud.position.set(0, 1.18, 4.3);
  g.add(tail, elev, fin, rud);
  s.elevator = elev;
  s.rudder = rud;

  s.gear = new THREE.Group();   // floats are permanent; there is no gear to raise
  g.add(s.gear);
  navLights(g, 6.1, 1.03, -0.5);
  addShadows(g);
  return { group: g, surfaces: s };
}

/* ---------- 8. the glider ---------- */
function buildGlider() {
  const g = new THREE.Group();
  const s = {};
  const skin = new THREE.MeshStandardMaterial({ color: 0xfbfcfd, roughness: 0.22, metalness: 0.05 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.35 });

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 5.2, 8, 18), skin);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.8;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), skin);
  nose.scale.z = 2.2;
  nose.position.z = -2.6;
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 3.4, 10), skin);
  boom.rotation.x = Math.PI / 2;
  boom.position.z = 4.6;
  g.add(fuse, nose, boom);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat.glass);
  canopy.scale.set(1, 1.1, 3.4);
  canopy.position.set(0, 0.25, -1.1);
  g.add(canopy);

  // the whole point: an enormous, slender, high-aspect wing
  const wing = new THREE.Mesh(wingGeo({ span: 18.0, root: 1.05, tip: 0.48, thick: 0.16, dihedral: 0.04 }), skin);
  wing.position.set(0, 0.34, 0.1);
  g.add(wing);
  for (const side of [-1, 1]) {
    const ail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.1, 0.3), trim);
    ail.position.set(side * 6.4, 0.34, 0.5);
    g.add(ail);
    s[side > 0 ? "aileronR" : "aileronL"] = ail;
    const tipSkid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.5), trim);
    tipSkid.position.set(side * 8.9, 0.3, 0.1);
    g.add(tipSkid);
  }
  s.flapL = s.flapR = null;

  const tail = new THREE.Mesh(wingGeo({ span: 3.2, root: 0.8, tip: 0.5, thick: 0.12 }), skin);
  tail.position.set(0, 1.5, 6.0);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.09, 0.34), trim);
  elev.position.set(0, 1.5, 6.4);
  const fin = new THREE.Mesh(wingGeo({ span: 1.6, root: 1.3, tip: 0.7, thick: 0.12, sweep: 0.5 }), skin);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 0.95, 5.9);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.36), trim);
  rud.position.set(0, 0.95, 6.5);
  g.add(tail, elev, fin, rud);
  s.elevator = elev;
  s.rudder = rud;

  s.prop = null;
  s.disc = null;
  s.gear = gearLegs(g, { main: [0.001, -0.75, 0.2], radius: 0.3 });   // one wheel under the belly
  navLights(g, 9.0, 0.36, 0.1);
  addShadows(g);
  return { group: g, surfaces: s };
}

/* ---------- shared parts ---------- */

function gearLegs(g, { main, nose, tail, radius = 0.34, pairs = 1 }) {
  const gear = new THREE.Group();
  const wheelGeo = new THREE.CylinderGeometry(radius, radius, radius * 0.62, 14);
  const leg = (x, y, z, len) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.4, len, radius * 0.4), mat.steel);
    l.position.set(x, y + len / 2, z);
    gear.add(l);
  };
  for (const side of [-1, 1]) {
    leg(side * main[0], main[1], main[2], Math.abs(main[1]) * 0.75);
    for (let k = 0; k < pairs; k++) {
      const w = new THREE.Mesh(wheelGeo, mat.dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * main[0], main[1], main[2] + (k - (pairs - 1) / 2) * radius * 1.8);
      gear.add(w);
    }
  }
  if (nose) {
    leg(nose[0], nose[1], nose[2], Math.abs(nose[1]) * 0.75);
    const w = new THREE.Mesh(wheelGeo, mat.dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(nose[0], nose[1], nose[2]);
    gear.add(w);
  }
  if (tail) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.5, 10), mat.dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(tail[0], tail[1], tail[2]);
    gear.add(w);
  }
  g.add(gear);
  return gear;
}

function navLights(g, x, y, z) {
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  red.position.set(-x, y, z);
  const green = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0x30ff6a }));
  green.position.set(x, y, z);
  g.add(red, green);
}

/* ---------- the roster ---------- */

const AIRCRAFT = [
  {
    id: "skylark", needs: 300,
    name: "Skylark 172",
    blurb: "A high-wing trainer. Slow, forgiving and hard to frighten — start here.",
    spec: "Rotate 55 kt · Cruise 110 kt · 1.0 t",
    build: buildSkylark,
    eye: [0, 0.62, 0.9], chase: 16, gearHeight: 1.55, propDriven: true,
    air: {
      mass: 1000, wingArea: 16.2, span: 11.4, maxThrust: 4400, vMax: 92,
      CL0: 0.30, CLa: 5.2, stallA: 0.29, CD0: 0.028, induced: 0.052,
      gearDrag: 0.012, flapLift: 0.45, flapDrag: 0.04,
      pitchPower: 2.4, rollPower: 4.4, yawPower: 1.2,
      pitchDamp: 5.0, rollDamp: 3.0, yawDamp: 2.2,
      pitchStab: 9.0, yawStab: 3.2,
    },
  },
  {
    id: "sprint", needs: 360,
    name: "Sprint S2",
    blurb: "A low-wing aerobat with a big engine and a short wing. It rolls like a barrel.",
    spec: "Rotate 60 kt · Cruise 150 kt · 1.1 t",
    build: buildSprint,
    eye: [0, 0.5, 0.2], chase: 15, gearHeight: 1.25, propDriven: true, taildragger: true,
    air: {
      mass: 1080, wingArea: 13.4, span: 8.4, maxThrust: 7200, vMax: 120,
      CL0: 0.26, CLa: 5.4, stallA: 0.31, CD0: 0.026, induced: 0.055,
      gearDrag: 0.010, flapLift: 0.0, flapDrag: 0.0,
      pitchPower: 4.6, rollPower: 11.0, yawPower: 2.0,
      pitchDamp: 4.2, rollDamp: 3.4, yawDamp: 2.4,
      pitchStab: 7.0, yawStab: 3.0,
    },
  },
  {
    id: "falcon", needs: 900,
    name: "Falcon J-7",
    blurb: "A single-seat jet. Enormous thrust, a wing that needs speed, and gear you must raise.",
    spec: "Rotate 140 kt · Cruise 420 kt · 9.5 t",
    build: buildFalcon,
    eye: [0, 0.75, -2.4], chase: 26, gearHeight: 1.5, jet: true,
    air: {
      mass: 9500, wingArea: 28, span: 9.6, maxThrust: 78000, vMax: 330,
      CL0: 0.14, CLa: 4.1, stallA: 0.33, CD0: 0.021, induced: 0.09,
      gearDrag: 0.02, flapLift: 0.3, flapDrag: 0.05,
      pitchPower: 3.4, rollPower: 8.0, yawPower: 1.4,
      pitchDamp: 4.0, rollDamp: 3.0, yawDamp: 2.0,
      pitchStab: 6.0, yawStab: 2.6,
    },
  },
  {
    id: "mustang", needs: 700,
    name: "Comet P-51",
    blurb: "A wartime fighter. Enormous prop, a tailwheel that wants to swap ends, and real speed.",
    spec: "Rotate 95 kt · Cruise 300 kt · 4.3 t",
    build: buildMustang,
    eye: [0, 0.68, -0.4], chase: 19, gearHeight: 1.35, propDriven: true, taildragger: true,
    air: {
      mass: 4300, wingArea: 21.8, span: 11.3, maxThrust: 22000, vMax: 170,
      CL0: 0.24, CLa: 5.0, stallA: 0.30, CD0: 0.023, induced: 0.05,
      gearDrag: 0.014, flapLift: 0.4, flapDrag: 0.045,
      pitchPower: 3.0, rollPower: 6.4, yawPower: 1.5,
      pitchDamp: 4.4, rollDamp: 3.0, yawDamp: 2.2,
      pitchStab: 7.5, yawStab: 3.0,
    },
  },
  {
    id: "bush", needs: 180,
    name: "Kodiak STOL",
    blurb: "Tundra tyres and a wing full of slats. Lands almost anywhere, including a hillside.",
    spec: "Rotate 38 kt · Cruise 95 kt · 1.4 t",
    build: buildBush,
    eye: [0, 0.66, 0.9], chase: 17, gearHeight: 1.9, propDriven: true, taildragger: true, rough: true,
    air: {
      mass: 1400, wingArea: 25.5, span: 13.2, maxThrust: 8200, vMax: 68,
      CL0: 0.52, CLa: 5.6, stallA: 0.36, CD0: 0.042, induced: 0.048,
      gearDrag: 0.016, flapLift: 0.75, flapDrag: 0.06,
      pitchPower: 3.0, rollPower: 4.0, yawPower: 1.4,
      pitchDamp: 4.4, rollDamp: 3.2, yawDamp: 2.2,
      pitchStab: 8.5, yawStab: 3.4,
    },
  },
  {
    id: "sea", needs: 280,
    name: "Lagoon 18",
    blurb: "A floatplane. The whole sea is your runway — and the lagoons, if you can find them.",
    spec: "Rotate 52 kt · Cruise 100 kt · 1.2 t · lands on water",
    build: buildSeaplane,
    eye: [0, 0.6, 0.8], chase: 17, gearHeight: 2.1, propDriven: true, floats: true,
    air: {
      mass: 1250, wingArea: 18.0, span: 12.0, maxThrust: 5200, vMax: 78,
      CL0: 0.34, CLa: 5.2, stallA: 0.30, CD0: 0.038, induced: 0.052,
      gearDrag: 0.0, flapLift: 0.5, flapDrag: 0.045,
      pitchPower: 2.4, rollPower: 4.0, yawPower: 1.2,
      pitchDamp: 4.8, rollDamp: 3.0, yawDamp: 2.2,
      pitchStab: 8.5, yawStab: 3.2,
    },
  },
  {
    id: "glider", needs: 260,
    name: "Albatross G4",
    blurb: "No engine. Eighteen metres of wing, and only the rising air to keep you up.",
    spec: "Glides 38:1 · Stalls at 34 kt · no engine",
    build: buildGlider,
    eye: [0, 0.32, 1.1], chase: 22, gearHeight: 0.85, glider: true,
    air: {
      mass: 460, wingArea: 12.4, span: 18.0, maxThrust: 0, vMax: 60,
      CL0: 0.58, CLa: 5.8, stallA: 0.30, CD0: 0.0078, induced: 0.016,
      gearDrag: 0.003, flapLift: 0.0, flapDrag: 0.0,
      pitchPower: 2.2, rollPower: 3.0, yawPower: 1.1,
      pitchDamp: 5.2, rollDamp: 3.4, yawDamp: 2.4,
      pitchStab: 9.5, yawStab: 3.4,
    },
  },
  {
    id: "atlas", needs: 2000,
    name: "Atlas 340",
    blurb: "A twin-engine airliner. Heavy, stately, and utterly unforgiving of a late flare.",
    spec: "Rotate 145 kt · Cruise 280 kt · 62 t",
    build: buildAtlas,
    eye: [0, 1.4, -12.5], chase: 62, gearHeight: 3.35, jet: true,
    air: {
      mass: 62000, wingArea: 122, span: 32.0, maxThrust: 320000, vMax: 270,
      CL0: 0.34, CLa: 5.0, stallA: 0.27, CD0: 0.019, induced: 0.048,
      gearDrag: 0.018, flapLift: 0.8, flapDrag: 0.07,
      pitchPower: 1.3, rollPower: 2.0, yawPower: 0.7,
      pitchDamp: 3.2, rollDamp: 2.4, yawDamp: 1.8,
      pitchStab: 7.0, yawStab: 3.0,
    },
  },
];

/* Wingtip trails. A wing only makes those ribbons when it is loaded up, so they appear with
   G and with a high angle of attack — which makes them a real instrument: if you can see your
   own vortices in a turn, you are close to asking too much of the wing. */
const TRAIL_LEN = 90;
const trails = [];
function buildTrails() {
  for (const side of [-1, 1]) {
    const geo = new THREE.BufferGeometry();
    const pts = new Float32Array(TRAIL_LEN * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: true,
    }));
    line.frustumCulled = false;
    scene.add(line);
    trails.push({ side, line, pts, head: 0, filled: 0 });
  }
}

function updateTrails() {
  const span = (air.span || 11) * 0.5;
  const load = Math.max(Math.abs(plane.gForce) - 1.6, 0) * 0.5
    + Math.max(Math.abs(plane.alpha) - 0.12, 0) * 3
    + (plane.pos.y > 4200 && current.jet ? 0.8 : 0);
  const show = !plane.onGround && plane.ias > 30 ? clamp(load, 0, 0.55) : 0;
  for (const t of trails) {
    const tip = tmp.copy(plane.pos)
      .addScaledVector(axisR, t.side * span)
      .addScaledVector(axisF, -1.2);
    // ring buffer of the last ninety tip positions
    t.pts[t.head * 3] = tip.x;
    t.pts[t.head * 3 + 1] = tip.y;
    t.pts[t.head * 3 + 2] = tip.z;
    t.head = (t.head + 1) % TRAIL_LEN;
    t.filled = Math.min(TRAIL_LEN, t.filled + 1);
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.geometry.setDrawRange(0, t.filled);
    t.line.material.opacity += (show - t.line.material.opacity) * 0.08;
  }
}

/* ================= flight model ================= */

/* The live aerodynamic parameters. Swapped wholesale when you change aircraft, which is what
   makes the airliner feel like an airliner and not a repainted trainer. */
const air = { ...AIRCRAFT[0].air };
let current = AIRCRAFT[0];

const plane = {
  pos: new THREE.Vector3(0, FIELD_ELEV + 1.6, RUNWAY_LEN / 2 - 160),
  vel: new THREE.Vector3(0, 0, 0),
  quat: new THREE.Quaternion(),
  omega: new THREE.Vector3(),   // body rates: x pitch, y yaw, z roll
  throttle: 0,
  trim: 0,
  flaps: 0,                     // 0, 0.5, 1
  gearDown: true,
  brakes: true,
  onGround: true,
  crashed: false,
  engineOn: true,
  fuel: 1,
  alpha: 0,
  beta: 0,
  gForce: 1,
  propAngle: 0,
  stall: false,
  score: null,
};

const input = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
const autopilot = { on: false, alt: 0, hdg: 0 };

function flyAutopilot(dt) {
  if (!autopilot.on || plane.onGround || plane.crashed) return false;
  const pitchNow = Math.asin(clamp(axisF.y, -1, 1));
  const bankNow = -Math.asin(clamp(axisR.y, -1, 1));
  // altitude through pitch, heading through bank — the way a real wing-leveller does it
  const altErr = clamp((autopilot.alt - plane.pos.y) * 0.02, -0.16, 0.16);
  input.pitch = clamp((altErr - pitchNow) * 2.4 - plane.omega.x * 0.8, -0.7, 0.7);
  let hdgErr = autopilot.hdg - heading();
  while (hdgErr > Math.PI) hdgErr -= Math.PI * 2;
  while (hdgErr < -Math.PI) hdgErr += Math.PI * 2;
  const wantBank = clamp(hdgErr * 1.4, -0.42, 0.42);
  input.roll = clamp((wantBank - bankNow) * 2.2 - plane.omega.z * 0.5, -0.7, 0.7);
  input.yaw *= 0.5;
  return true;
}

/* Every strip is somewhere you can start, and the list builds itself from FIELDS so adding an
   airfield adds it to the picker too. After them come the places you simply appear in mid-air. */
const SURFACE = { intl: "Asphalt", regional: "Asphalt", strip: "Asphalt", grass: "Grass", beach: "Sand" };
const byId = (id) => FIELDS.find((f) => f.id === id);

const SPAWNS = [
  ...FIELDS.map((f) => ({ id: f.id, name: f.name, field: f, blurb: f.blurb })),
  { id: "final", name: "On final for 36", field: byId("intl"),
    air: { pos: [0, FIELD_ELEV + 520, 5200], hdg: 0, speed: 58 },
    blurb: "Three miles out at 1,700 ft, lined up. All you have to do is not bend it." },
  { id: "alps", name: "Over the mountains", field: byId("ridge"),
    air: { pos: [2600, 2900, -2400], hdg: 2.5, speed: 75 },
    blurb: "9,500 ft above the range, with the peaks in every direction." },
  { id: "carrier", name: "Carrier approach", field: byId("intl"),
    air: { pos: [-6200, 300, -2600], hdg: Math.PI + 0.22, speed: 62 },
    blurb: "Two miles behind the ship at 1,000 ft. The deck is 300 m long and moving." },
  { id: "city", name: "Over the city", field: byId("puerto"),
    air: { pos: [-3100, 620, 5600], hdg: Math.PI, speed: 65 },
    blurb: "Low over the port, towers either side — Puerto Sur is two miles north." },
  { id: "water", name: "West bay, on the water", field: byId("oeste"),
    water: { pos: [-7400, 1800], hdg: 1.0 },
    blurb: "Floating in a sheltered bay off the west coast, engine idling. Only the floatplane can get off again." },
  { id: "harbour", name: "Puerto Sur harbour", field: byId("puerto"),
    water: { pos: [-3250, 6450], hdg: 5.6 },
    blurb: "On the water in front of the city, looking out past the breakwater. A floatplane's front door." },
  { id: "high", name: "Ten thousand feet", field: byId("intl"),
    air: { pos: [-1200, 3050, -800], hdg: 0.6, speed: 90 },
    blurb: "High over the middle of the island with the whole map in one look. Go anywhere." },
];
let spawn = SPAWNS[0];

function resetPlane(inAir = false) {
  plane.crashed = false;
  plane.score = null;
  plane.omega.set(0, 0, 0);
  plane.flaps = 0;
  plane.trim = 0;
  plane.gearDown = true;
  plane.fuel = 1;
  autopilot.on = false;
  document.getElementById("crash").hidden = true;

  const f = spawn.field || FIELDS[0];

  // Sitting on the water is neither a runway start nor an air start: put it on the surface at
  // rest. Dropping it from the air scored the splashdown as a crash landing, which it was.
  if (spawn.water && !current.glider) {
    const w = spawn.water;
    plane.pos.set(w.pos[0], SEA + 0.05 + current.gearHeight, w.pos[1]);
    plane.quat.setFromEuler(new THREE.Euler(0, w.hdg, 0, "YXZ"));
    plane.vel.set(0, 0, 0);
    plane.throttle = 0;
    plane.brakes = false;
    plane.onGround = true;
    say(current.floats
      ? `${spawn.name}. Idling on the step — open the throttle and she'll come up onto the floats.`
      : `${spawn.name}. ${current.name} has wheels, not floats. This is as far as it goes.`);
    return;
  }
  // nothing without an engine is going anywhere from a standing start — a glider is released
  // from a tow at two thousand feet over the field it chose
  const airborne = inAir || !!spawn.air || !!current.glider;

  if (airborne) {
    const a = current.glider && !spawn.air
      ? { pos: [f.x + 900, f.elev + 620, f.z + 1400], hdg: f.hdg, speed: 32 }
      : spawn.air || {
        pos: [f.x + Math.sin(f.hdg) * (current.jet ? 12000 : 6500),
          f.elev + 760,
          f.z + Math.cos(f.hdg) * (current.jet ? 12000 : 6500)],
        hdg: f.hdg,
        speed: current.jet ? 120 : 52,
      };
    plane.pos.set(a.pos[0], a.pos[1], a.pos[2]);
    plane.quat.setFromEuler(new THREE.Euler(0, a.hdg, 0, "YXZ"));
    const v = current.jet ? Math.max(a.speed, 95) : a.speed;
    plane.vel.set(0, 0, -v).applyQuaternion(plane.quat);
    plane.throttle = 0.7;
    plane.brakes = false;
    plane.onGround = false;
    say(current.glider
      ? `Off the tow at ${Math.round(plane.pos.y * FT).toLocaleString()} feet. Find rising air — look for it over sunlit ground.`
      : `${spawn.name}. ${Math.round(plane.pos.y * FT).toLocaleString()} feet, ${Math.round(v * KT)} knots.`);
  } else {
    // at the near end of the strip, pointing down it
    const back = f.len / 2 - 160;
    plane.pos.set(f.x + Math.sin(f.hdg) * back, f.elev + current.gearHeight, f.z + Math.cos(f.hdg) * back);
    plane.quat.setFromEuler(new THREE.Euler(0, f.hdg, 0, "YXZ"));
    plane.vel.set(0, 0, 0);
    plane.throttle = 0;
    plane.brakes = true;
    plane.onGround = true;
    say(`${f.name}. ${f.len} m of runway, brakes on. ${current.name}.`);
  }
}

const axisF = new THREE.Vector3();
const axisU = new THREE.Vector3();
const axisR = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const invQ = new THREE.Quaternion();
const relWind = new THREE.Vector3();

const density = (alt) => 1.225 * Math.exp(-Math.max(0, alt) / 8500);

/* The air is not still. A steady wind with gusts on top means a crosswind landing is a real
   piece of flying, and it is why ground speed and airspeed stop agreeing with each other.
   Thermals rise off sunlit low ground — the whole point of the glider. */
const weather = { dirDeg: 250, speed: 6, gust: 2.5, thermals: 1 };
const windVec = new THREE.Vector3();
let windClock = 0;

function windAt(pos, t) {
  const dir = THREE.MathUtils.degToRad(weather.dirDeg);
  // wind blows FROM dirDeg, and stiffens with height
  const shear = 0.55 + clamp(pos.y / 900, 0, 1) * 0.75;
  const gust = 1 + Math.sin(t * 0.7 + pos.x * 0.0013) * 0.5 + Math.sin(t * 1.9 + pos.z * 0.0017) * 0.5;
  const speed = (weather.speed + weather.gust * gust) * shear;
  windVec.set(-Math.sin(dir) * speed, 0, -Math.cos(dir) * speed);
  windVec.y = thermalAt(pos, t);
  return windVec;
}

/* Rising air: strongest over warm low ground in the middle of the day, nothing over the sea,
   and arranged in columns you have to find and circle in. */
function thermalAt(pos, t) {
  if (pos.y > 2600 || pos.y < 5) return 0;
  const g = groundAt(pos.x, pos.z);
  if (g < 12) return -0.3;                                  // sinking air over water
  const sunStrength = [0.7, 1.0, 0.5, 0.15][timeIndex] ?? 0.7;
  // narrow strong cores with sink between them: you have to find one and stay in it
  const cell = fbm(pos.x / 760 + t * 0.005, pos.z / 760 - t * 0.0035, 3);
  const core = Math.pow(Math.max(0, cell - 0.04) * 3.1, 1.35);
  const capped = clamp(1 - (pos.y - g) / 2100, 0, 1);       // dies out with height above ground
  const lift = core * 7.4 * sunStrength * weather.thermals * capped;
  // the air that goes up has to come down somewhere
  return lift > 0.05 ? lift : -0.45 * sunStrength * capped;
}

function step(dt) {
  if (plane.crashed) return;

  axisF.set(0, 0, -1).applyQuaternion(plane.quat);
  axisU.set(0, 1, 0).applyQuaternion(plane.quat);
  axisR.set(1, 0, 0).applyQuaternion(plane.quat);

  const alt = plane.pos.y;
  const rho = density(alt);

  // everything aerodynamic happens relative to the air, which is itself moving
  windClock += dt;
  const wind = windAt(plane.pos, windClock);
  const rel = relWind.copy(plane.vel).sub(wind);
  const speed = rel.length();
  plane.ias = speed;
  plane.gs = plane.vel.length();

  invQ.copy(plane.quat).invert();
  const vb = tmp.copy(rel).applyQuaternion(invQ);
  const alpha = speed > 1 ? Math.atan2(-vb.y, -vb.z) : 0;
  const beta = speed > 1 ? Math.asin(clamp(vb.x / speed, -1, 1)) : 0;
  plane.alpha = alpha;
  plane.beta = beta;

  const q = 0.5 * rho * speed * speed;
  const flapPos = plane.flaps;

  // lift, with a stall that actually bites past the critical angle
  let CL = air.CL0 + air.CLa * alpha + air.flapLift * flapPos;
  const over = Math.abs(alpha) - air.stallA;
  plane.stall = over > 0 && speed > 4;
  if (over > 0) CL *= Math.max(0.28, 1 - over * 3.4);
  const CD = air.CD0 + air.induced * CL * CL + (plane.gearDown ? air.gearDrag : 0) + air.flapDrag * flapPos;

  const forces = new THREE.Vector3(0, -air.mass * G, 0);

  if (speed > 0.6) {
    const drag = q * air.wingArea * CD;
    forces.addScaledVector(tmp2.copy(rel).normalize(), -drag);
    // lift acts perpendicular to the relative wind, in the aircraft's plane of symmetry
    const liftDir = tmp2.copy(rel).normalize().cross(axisR).normalize().multiplyScalar(-1);
    forces.addScaledVector(liftDir, q * air.wingArea * CL);
    // a little side force so slipping is felt
    forces.addScaledVector(axisR, -q * air.wingArea * 0.9 * beta);
  }

  const thrust = plane.engineOn && plane.fuel > 0 && air.maxThrust > 0
    ? plane.throttle * air.maxThrust * (rho / 1.225) * (1 - clamp(speed / (air.vMax || 92), 0, 0.55))
    : 0;
  forces.addScaledVector(axisF, thrust);
  if (thrust > 0) plane.fuel = Math.max(0, plane.fuel - dt * 0.000038 * (0.35 + plane.throttle));

  // ---- moments, as angular accelerations ----
  const authority = clamp(q / 700, 0, 2.0);
  const pitchCmd = clamp(input.pitch + plane.trim, -1, 1);
  const angAcc = new THREE.Vector3(
    (pitchCmd * air.pitchPower - alpha * air.pitchStab - plane.omega.x * air.pitchDamp) * authority,
    (-input.yaw * air.yawPower - beta * air.yawStab - plane.omega.y * air.yawDamp) * authority,
    (-input.roll * air.rollPower - plane.omega.z * air.rollDamp) * authority,
  );
  // in a stall the surfaces go slack and a wing drops
  if (plane.stall) {
    angAcc.multiplyScalar(0.45);
    angAcc.z += (Math.sin(plane.pos.x * 0.01) * 0.5 + 0.15) * Math.min(1, over * 5);
  }
  plane.omega.addScaledVector(angAcc, dt);

  // ---- ground ----
  const ground = surfaceAt(plane.pos.x, plane.pos.z);
  const gearHeight = plane.gearDown ? current.gearHeight : current.gearHeight * 0.5;
  const pavement = pavementAt(plane.pos.x, plane.pos.z);
  const onRunway = !!pavement;
  const wheelY = plane.pos.y - gearHeight;

  // rolling friction and steering use last step's contact; the constraint below re-decides it
  if (plane.onGround) {
    const rolling = plane.brakes ? 0.45 : 0.022;
    const friction = rolling * air.mass * G;
    const ground2d = tmp2.set(plane.vel.x, 0, plane.vel.z);
    const gs = ground2d.length();
    if (gs > 0.05) forces.addScaledVector(ground2d.normalize(), -Math.min(friction, gs * air.mass / Math.max(dt, 0.001)));
    // nosewheel steering, strongest when slow
    if (gs > 0.4) {
      const steer = input.yaw * clamp(1 - gs / 40, 0.12, 1) * 0.8;
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -steer * dt * 1.6);
      plane.quat.premultiply(yawQ);
      plane.vel.applyQuaternion(yawQ);
    }
  }

  // ---- integrate ----
  const accel = forces.divideScalar(air.mass);
  plane.gForce = clamp(1 + (accel.dot(axisU)) / G, -3, 8);
  plane.vel.addScaledVector(accel, dt);
  plane.pos.addScaledVector(plane.vel, dt);

  const spin = new THREE.Quaternion(
    plane.omega.x * dt * 0.5, plane.omega.y * dt * 0.5, plane.omega.z * dt * 0.5, 1,
  ).normalize();
  plane.quat.multiply(spin).normalize();

  /* Contact, resolved after the aircraft has moved. The wheels hold the wings level and stop
     the tail or the nose digging in, but the elevator is free to raise the nose and lift is free
     to carry the whole thing off — that rotation and release is the whole of a take-off. */
  const groundNow = surfaceAt(plane.pos.x, plane.pos.z);
  const floor = groundNow + 0.05 + gearHeight;
  const touching = plane.pos.y <= floor + 0.001;

  if (touching && !plane.onGround) {
    // the moment of arrival: was it a landing or an accident?
    const vy = plane.vel.y;
    const bank = Math.abs(Math.asin(clamp(axisR.y, -1, 1)));
    const nose = Math.asin(clamp(axisF.y, -1, 1));
    const onWater = groundNow <= SEA + 0.4;
    const gentle = current.rough ? 0.55 : 0.35;        // how level it has to be
    const sinkLimit = current.rough ? 6.0 : current.floats ? 3.4 : 4.4;

    // where you are allowed to put it down depends on what you are flying
    const goodPlace = onWater ? !!current.floats : onRunway || !!current.rough;
    if (onWater && !current.floats) return crash("You went into the sea.");
    if (!plane.gearDown && speed > 8 && !current.floats) return crash("Gear up. That was expensive.");
    if (speed > 12 && (vy < -sinkLimit || bank > gentle || nose < -0.28 || (!goodPlace && speed > 24))) {
      return crash(vy < -sinkLimit ? "Hard landing — the gear let go."
        : !goodPlace ? "You put it down off the field."
        : "A wingtip caught the ground.");
    }
    const rate = Math.round(-vy * 196.85);
    // distance from that strip's own centreline, not from the world origin
    const offCentre = pavement && pavement.hdg !== undefined
      ? Math.abs((plane.pos.x - pavement.x) * Math.cos(pavement.hdg) - (plane.pos.z - pavement.z) * Math.sin(pavement.hdg))
      : Math.abs(plane.pos.x - (pavement ? (pavement.x0 + pavement.x1) / 2 : 0));
    plane.score = { rate, offCentre: Math.round(offCentre), speed: Math.round(speed * KT), onRunway, where: pavement?.name };
    say(onRunway
      ? `${pavement.name} · ${rate} fpm · ${grade(rate, offCentre)}`
      : "Down in one piece, but that wasn't the runway.");
  }
  plane.onGround = touching;

  if (touching) {
    // Water only holds you up if you have floats. This used to be checked only at the instant
    // of touchdown, so anything that *started* on the water — a wheeled aircraft at a water
    // spawn — simply drove across the sea and took off from it.
    if (groundNow <= SEA + 0.4 && !current.floats) return crash("You went into the sea.");
    plane.pos.y = floor;
    if (plane.vel.y < 0) plane.vel.y = 0;
    const e = new THREE.Euler().setFromQuaternion(plane.quat, "YXZ");
    e.z *= Math.exp(-dt * 9);                        // wings level on the gear
    const pitched = clamp(e.x, -0.035, 0.21);        // nosewheel down to a tail strike
    if (pitched !== e.x) plane.omega.x = 0;
    e.x = pitched;
    plane.quat.setFromEuler(e);
    plane.omega.z *= Math.exp(-dt * 9);
    plane.omega.y *= Math.exp(-dt * 5);
  }

  if (plane.pos.y < SEA + 1 && !plane.onGround) crash("You went into the sea.");
  plane.propAngle += dt * (8 + plane.throttle * 130);
}

// rate is the sink rate in feet per minute, positive downward
const grade = (rate, off) => (rate < 90 && off < 12 ? "a greaser" : rate < 220 && off < 25 ? "a good landing" : rate < 420 ? "firm, but fine" : "you'll feel that tomorrow");

function heading() {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(plane.quat);
  return Math.atan2(-f.x, -f.z);
}

function crash(reason) {
  if (plane.crashed) return;
  plane.crashed = true;
  plane.throttle = 0;
  plane.vel.multiplyScalar(0.1);
  say(`${reason}  ·  press R to start again`);
  document.getElementById("crash").hidden = false;
  document.getElementById("crash-why").textContent = reason;
}

/* ================= camera ================= */

const CAMS = ["Chase", "Cockpit", "Wing", "Tower"];
let camMode = 0;
const camPos = new THREE.Vector3(0, FIELD_ELEV + 20, 60);
const camLook = new THREE.Vector3();

function updateCamera(dt) {
  const f = axisF.clone(), u = axisU.clone(), r = axisR.clone();
  const mode = CAMS[camMode];
  if (mode === "Cockpit") {
    camera.fov = 70;
    const [ex, ey, ez] = current.eye;
    const eye = plane.pos.clone().addScaledVector(f, -ez).addScaledVector(u, ey).addScaledVector(r, ex);
    camera.position.copy(eye);
    camera.quaternion.copy(plane.quat);
  } else if (mode === "Wing") {
    camera.fov = 58;
    const eye = plane.pos.clone().addScaledVector(r, current.chase * 0.5).addScaledVector(u, 1.4).addScaledVector(f, -1.5);
    camera.position.lerp(eye, clamp(dt * 9, 0, 1));
    camera.lookAt(plane.pos);
  } else if (mode === "Tower") {
    camera.fov = 34;
    camera.position.set(-120, FIELD_ELEV + 34, -240);
    camera.lookAt(plane.pos);
  } else {
    camera.fov = 62;
    const back = current.chase + Math.min(plane.vel.length() * 0.22, current.chase * 0.8);
    const want = plane.pos.clone().addScaledVector(f, -back).addScaledVector(u, current.chase * 0.26);
    camPos.lerp(want, clamp(dt * 3.2, 0, 1));
    camera.position.copy(camPos);
    camLook.lerp(plane.pos.clone().addScaledVector(f, 14), clamp(dt * 5, 0, 1));
    camera.lookAt(camLook);
    camera.up.lerp(u.clone().lerp(new THREE.Vector3(0, 1, 0), 0.55).normalize(), clamp(dt * 3, 0, 1));
  }
  camera.updateProjectionMatrix();
}

/* ================= instruments ================= */

const hud = {
  spd: document.getElementById("i-spd"),
  alt: document.getElementById("i-alt"),
  vsi: document.getElementById("i-vsi"),
  hdg: document.getElementById("i-hdg"),
  thr: document.getElementById("i-thr"),
  thrBar: document.getElementById("i-thr-bar"),
  gforce: document.getElementById("i-g"),
  flaps: document.getElementById("i-flaps"),
  gear: document.getElementById("i-gear"),
  brakes: document.getElementById("i-brakes"),
  fuel: document.getElementById("i-fuel"),
  stall: document.getElementById("stall"),
  horizonInner: document.getElementById("horizon-inner"),
  horizonRoll: document.getElementById("horizon-roll"),
  ribbon: document.getElementById("ribbon"),
  cam: document.getElementById("i-cam"),
  msg: document.getElementById("msg"),
  mapDot: document.getElementById("map-dot"),
  mapPlane: document.getElementById("map-plane"),
  mapLabel: document.getElementById("map-label"),
  trim: document.getElementById("i-trim"),
  ap: document.getElementById("i-ap"),
  wind: document.getElementById("i-wind"),
  windArrow: document.getElementById("wind-arrow"),
  plane: document.getElementById("i-plane"),
};

let msgTimer = 0;
function say(text) {
  hud.msg.textContent = text;
  hud.msg.hidden = false;
  msgTimer = 6;
}

function updateHUD(dt) {
  const kts = (plane.ias ?? plane.vel.length()) * KT;
  hud.spd.textContent = Math.round(kts);
  hud.alt.textContent = Math.round(plane.pos.y * FT).toLocaleString();
  hud.vsi.textContent = `${plane.vel.y > 0 ? "+" : ""}${Math.round(plane.vel.y * 196.85)}`;
  const hdgDeg = (THREE.MathUtils.radToDeg(heading()) + 360) % 360;
  hud.hdg.textContent = String(Math.round(hdgDeg)).padStart(3, "0");
  hud.thr.textContent = `${Math.round(plane.throttle * 100)}%`;
  hud.thrBar.style.height = `${plane.throttle * 100}%`;
  hud.gforce.textContent = plane.gForce.toFixed(1);
  hud.flaps.textContent = plane.flaps === 0 ? "UP" : plane.flaps === 0.5 ? "10°" : "30°";
  hud.gear.textContent = plane.gearDown ? "DOWN" : "UP";
  hud.gear.className = plane.gearDown ? "ok" : "warn";
  hud.brakes.textContent = plane.brakes ? "ON" : "OFF";
  hud.brakes.className = plane.brakes ? "warn" : "";
  hud.fuel.style.width = `${plane.fuel * 100}%`;
  hud.cam.textContent = CAMS[camMode];
  hud.trim.textContent = plane.trim === 0 ? "0" : `${plane.trim > 0 ? "+" : "−"}${Math.abs(plane.trim * 100).toFixed(0)}`;
  hud.ap.textContent = autopilot.on ? "HOLD" : "OFF";
  hud.ap.className = autopilot.on ? "ok" : "";

  // wind: where it is coming from, and how hard, with the arrow pointing downwind on screen
  const w = windAt(plane.pos, windClock);
  const windKt = Math.hypot(w.x, w.z) * KT;
  const from = (THREE.MathUtils.radToDeg(Math.atan2(-w.x, -w.z)) + 360) % 360;
  const rel = (from - THREE.MathUtils.radToDeg(heading()) + 540) % 360 - 180;
  hud.wind.textContent = `${String(Math.round(from)).padStart(3, "0")}° ${Math.round(windKt)}kt`;
  hud.windArrow.setAttribute("transform", `rotate(${rel + 180} 20 20)`);
  if (w.y > 1.4) hud.wind.textContent += ` ↑${w.y.toFixed(1)}`;

  // artificial horizon
  const pitch = Math.asin(clamp(axisF.y, -1, 1));
  const roll = Math.atan2(axisR.y, axisU.y);
  hud.horizonRoll.style.transform = `rotate(${THREE.MathUtils.radToDeg(-roll)}deg)`;
  hud.horizonInner.style.transform = `translateY(${THREE.MathUtils.radToDeg(pitch) * 1.9}px)`;

  // heading ribbon
  hud.ribbon.style.transform = `translateX(${-hdgDeg * 4}px)`;

  const stalling = plane.stall && !plane.onGround;
  hud.stall.hidden = !stalling;

  // map: the island is 16 km across, the map is 128 px
  const mx = (plane.pos.x / WORLD + 0.5) * 128;
  const mz = (plane.pos.z / WORLD + 0.5) * 128;
  hud.mapPlane.setAttribute("transform", `translate(${mx} ${mz}) rotate(${THREE.MathUtils.radToDeg(heading())})`);
  const near = nearestField();
  hud.mapLabel.textContent = near.dist < 1400
    ? `${near.field.name} · ${runwayName(near.field)}`
    : `${near.field.name} · ${(near.dist / 1852).toFixed(1)} nm`;

  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) hud.msg.hidden = true;
  }
}

/* ================= input ================= */

const keys = new Set();
addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.key.toLowerCase());
  const k = e.key.toLowerCase();
  if (k === "g") { plane.gearDown = !plane.gearDown; say(plane.gearDown ? "Gear down." : "Gear up."); }
  if (k === "f") { plane.flaps = plane.flaps === 0 ? 0.5 : plane.flaps === 0.5 ? 1 : 0; say(`Flaps ${plane.flaps === 0 ? "up" : plane.flaps === 0.5 ? "10°" : "30°"}.`); }
  if (k === "b") { plane.brakes = !plane.brakes; say(plane.brakes ? "Brakes on." : "Brakes off."); }
  if (k === "c") { camMode = (camMode + 1) % CAMS.length; }
  if (k === "r") { document.getElementById("crash").hidden = true; resetPlane(false); }
  if (k === "t") { document.getElementById("crash").hidden = true; resetPlane(true); }
  if (k === "h") document.getElementById("help").hidden = !document.getElementById("help").hidden;
  if (k === "n") selectAircraft(AIRCRAFT.indexOf(current) + 1, !plane.onGround);
  if (k === "m") togglePreflight("planes");
  if (k === "j") togglePreflight("ground");
  if (k === "l") applyTime(timeIndex + 1);
  if (k === "a" && e.shiftKey) { /* handled below as autopilot */ }
  if (k === "p") {
    if (plane.onGround) { say("Autopilot needs you in the air."); }
    else {
      autopilot.on = !autopilot.on;
      autopilot.alt = plane.pos.y;
      autopilot.hdg = heading();
      say(autopilot.on
        ? `Autopilot holding ${Math.round(plane.pos.y * FT).toLocaleString()} ft and ${String(Math.round((THREE.MathUtils.radToDeg(heading()) + 360) % 360)).padStart(3, "0")}°.`
        : "Autopilot off.");
    }
  }
  if (k === "0") { plane.trim = 0; say("Trim neutral."); }
  if (k === "k") { tutorial.on ? stopTutorial("Tutorial stopped.") : startTutorial(); }
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

function readInput(dt) {
  const held = (...names) => names.some((n) => keys.has(n));
  if (held("[")) plane.trim = clamp(plane.trim - dt * 0.35, -0.6, 0.6);
  if (held("]")) plane.trim = clamp(plane.trim + dt * 0.35, -0.6, 0.6);
  const target = { pitch: 0, roll: 0, yaw: 0 };
  // up means climb: this is a game before it is a yoke
  if (held("arrowup", "w")) target.pitch = 1;
  if (held("arrowdown", "s")) target.pitch = -1;
  if (held("arrowleft", "a")) target.roll = -1;
  if (held("arrowright", "d")) target.roll = 1;
  if (held("q")) target.yaw = -1;
  if (held("e")) target.yaw = 1;

  if (held("shift", "=", "+")) plane.throttle = clamp(plane.throttle + dt * 0.55, 0, 1);
  if (held("control", "-", "_")) plane.throttle = clamp(plane.throttle - dt * 0.55, 0, 1);
  if (keys.has("1")) plane.throttle = 0;
  if (keys.has("2")) plane.throttle = 0.5;
  if (keys.has("3")) plane.throttle = 1;

  // touch stick overrides the keyboard when it's in use
  if (stick.active) { target.pitch = -stick.y; target.roll = stick.x; }

  const rate = 4.5;
  input.yaw += (target.yaw - input.yaw) * clamp(dt * rate * 1.4, 0, 1);
  // any stick input takes the autopilot out
  if (autopilot.on && (Math.abs(target.pitch) > 0.05 || Math.abs(target.roll) > 0.05)) {
    autopilot.on = false;
    say("Autopilot off.");
  }
  if (flyAutopilot(dt)) return;
  input.pitch += (target.pitch - input.pitch) * clamp(dt * rate, 0, 1);
  input.roll += (target.roll - input.roll) * clamp(dt * rate, 0, 1);
}

/* touch: a stick on the left, a throttle on the right */
const stick = { active: false, x: 0, y: 0, id: null };
const stickEl = document.getElementById("stick");
const knob = document.getElementById("knob");

function stickMove(e) {
  const t = [...e.touches].find((t) => t.identifier === stick.id);
  if (!t) return;
  const r = stickEl.getBoundingClientRect();
  const dx = clamp((t.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
  const dy = clamp((t.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
  stick.x = dx;
  stick.y = dy;
  knob.style.transform = `translate(${dx * 42}px, ${dy * 42}px)`;
}
stickEl.addEventListener("touchstart", (e) => {
  stick.active = true;
  stick.id = e.changedTouches[0].identifier;
  stickMove(e);
  e.preventDefault();
}, { passive: false });
stickEl.addEventListener("touchmove", (e) => { stickMove(e); e.preventDefault(); }, { passive: false });
addEventListener("touchend", (e) => {
  if ([...e.changedTouches].some((t) => t.identifier === stick.id)) {
    stick.active = false;
    stick.x = stick.y = 0;
    knob.style.transform = "translate(0,0)";
  }
});

const throttleEl = document.getElementById("throttle");
function throttleFromTouch(e) {
  const t = e.touches[0] || e.changedTouches[0];
  const r = throttleEl.getBoundingClientRect();
  plane.throttle = clamp(1 - (t.clientY - r.top) / r.height, 0, 1);
  e.preventDefault();
}
throttleEl.addEventListener("touchstart", throttleFromTouch, { passive: false });
throttleEl.addEventListener("touchmove", throttleFromTouch, { passive: false });

for (const btn of document.querySelectorAll("[data-key]")) {
  btn.addEventListener("click", () => {
    const k = btn.dataset.key;
    dispatchEvent(new KeyboardEvent("keydown", { key: k }));
    setTimeout(() => dispatchEvent(new KeyboardEvent("keyup", { key: k })), 40);
  });
}

/* ================= engine sound ================= */

let audio = null;
function startAudio() {
  if (audio) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = "sawtooth";
  osc2.type = "square";
  filter.type = "lowpass";
  filter.frequency.value = 900;
  gain.gain.value = 0;
  osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  osc.start(); osc2.start();
  audio = { ctx, osc, osc2, gain };
}
addEventListener("pointerdown", startAudio, { once: true });
addEventListener("keydown", startAudio, { once: true });

function updateAudio() {
  if (!audio) return;
  const rpm = plane.engineOn && plane.fuel > 0 ? 24 + plane.throttle * 62 : 0;
  audio.osc.frequency.value = rpm;
  audio.osc2.frequency.value = rpm * 1.51;
  const wind = Math.min(plane.vel.length() / 90, 1) * 0.04;
  audio.gain.gain.value = plane.crashed ? 0 : Math.min(0.22, rpm / 90 * 0.16 + wind);
}

/* ================= the tutorial ================= */

/* A first flight, taught by watching. Every step names one thing to do and then waits until
   the aircraft's own state says you did it — no scripted cutscenes, no fake controls. If you
   wander off, the step simply stays put until you come back to it. */
const LESSONS = [
  {
    title: "Brakes off",
    say: "You're holding on runway 36 in the Skylark. Press B to release the brakes.",
    hint: "B",
    done: () => !plane.brakes,
  },
  {
    title: "Full power",
    say: "Now open the throttle all the way — press 3, or hold Shift.",
    hint: "3",
    done: () => plane.throttle > 0.9,
  },
  {
    title: "Keep it straight",
    say: "She'll pull to one side as the speed builds. Use Q and E to keep the nose on the centreline.",
    hint: "Q / E",
    done: () => plane.ias * KT > 35,
  },
  {
    title: "Rotate",
    say: "Fifty-five knots — ease back on the stick with the up arrow, and only a little.",
    hint: "↑",
    done: () => !plane.onGround && plane.pos.y > FIELD_ELEV + 12,
  },
  {
    title: "Climb away",
    say: "You're flying. Hold about ten degrees nose-up and climb to 1,500 feet.",
    hint: "↑ / ↓",
    done: () => plane.pos.y * FT > 1500,
  },
  {
    title: "Level off",
    say: "Ease the nose down until the vertical speed settles near zero, and bring the power back to about half.",
    hint: "↓ then 2",
    done: () => Math.abs(plane.vel.y) < 2.2 && plane.throttle < 0.75 && plane.pos.y * FT > 1200,
  },
  {
    title: "Turn right",
    say: "Roll right with D and hold a gentle bank. Bring the nose round to east — heading 090.",
    hint: "D",
    done: () => {
      const h = (THREE.MathUtils.radToDeg(heading()) + 360) % 360;
      return Math.abs(h - 90) < 18;
    },
  },
  {
    title: "Roll out",
    say: "Level the wings with A. Notice how the nose drops when you stop turning — that's the lift you were using to pull it round.",
    hint: "A",
    done: () => Math.abs(Math.asin(clamp(axisR.y, -1, 1))) < 0.09,
  },
  {
    title: "Find a stall",
    say: "Close the throttle and hold the nose up. Listen for the stall warning — then lower the nose to fly again.",
    hint: "1, then ↑",
    done: () => tutorial.stalled && !plane.stall && plane.pos.y > FIELD_ELEV + 120,
    watch: () => { if (plane.stall) tutorial.stalled = true; },
  },
  {
    title: "Head home",
    say: "Isla Verde is behind you. Turn back to the north — heading 360 — and let down towards 1,000 feet.",
    hint: "A / D",
    done: () => {
      const h = (THREE.MathUtils.radToDeg(heading()) + 360) % 360;
      return (h < 22 || h > 338) && plane.pos.z > 1200;
    },
  },
  {
    title: "Set up the approach",
    say: "Drop the flaps with F and carry about sixty-five knots. Aim at the near end of the runway.",
    hint: "F",
    done: () => plane.flaps > 0 && plane.pos.y * FT < 1400,
  },
  {
    title: "Land it",
    say: "Hold the centreline, let it sink, and ease the nose up just before the wheels touch.",
    hint: "↑ gently",
    done: () => plane.onGround && plane.ias * KT < 60,
  },
];

const tutorial = { on: false, step: 0, stalled: false, timer: 0 };

function startTutorial() {
  tutorial.on = true;
  tutorial.step = 0;
  tutorial.stalled = false;
  document.getElementById("help").hidden = true;
  document.getElementById("preflight").hidden = true;
  spawn = SPAWNS[0];
  selectAircraft(0, false);
  renderLesson();
}

function stopTutorial(message) {
  tutorial.on = false;
  document.getElementById("lesson").hidden = true;
  if (message) say(message);
}

function renderLesson() {
  const box = document.getElementById("lesson");
  if (!tutorial.on) { box.hidden = true; return; }
  const l = LESSONS[tutorial.step];
  box.hidden = false;
  document.getElementById("lesson-step").textContent = `Step ${tutorial.step + 1} of ${LESSONS.length}`;
  document.getElementById("lesson-title").textContent = l.title;
  document.getElementById("lesson-say").textContent = l.say;
  document.getElementById("lesson-hint").textContent = l.hint;
  document.getElementById("lesson-bar").style.width = `${(tutorial.step / LESSONS.length) * 100}%`;
}

function updateTutorial(dt) {
  if (!tutorial.on || plane.crashed) return;
  const l = LESSONS[tutorial.step];
  if (l.watch) l.watch();
  tutorial.timer += dt;
  if (!l.done()) return;
  tutorial.timer = 0;
  tutorial.step++;
  if (tutorial.step >= LESSONS.length) {
    stopTutorial("That's a circuit — take-off, turn, stall, approach and landing. The island is yours.");
    document.getElementById("lesson-done").hidden = false;
    return;
  }
  renderLesson();
  say(`✓ ${l.title}`);
}

/* ================= loop ================= */

const loadingSub = document.querySelector(".loading-sub");
/* A timer, not requestAnimationFrame: a tab in the background gets no frames at all, and a
   loading sequence that waits for one would never finish building the island. */
const loadStep = (text) => new Promise((resolve) => {
  loadingSub.textContent = text;
  setTimeout(resolve, 24);
});

let water = null;
await loadStep("Raising the island…");
buildHeightmap();
await loadStep("Cutting the coastline…");
buildTerrain();
await loadStep("Filling the sea…");
water = buildSea();
await loadStep("Laying the runways…");
for (const f of FIELDS) buildAirfield(f);
await loadStep("Building the port…");
buildCity(-3100, 4200);
buildCarrier(-7200, -4300, 0.22);
buildWindFarm(1200, 2600);
buildLighthouse(-6650, 900);
buildBoats();
await loadStep("Planting nine thousand trees…");
scatterTrees();
await loadStep("Rolling out the weather…");
buildClouds();
buildTrails();

/* Changing aircraft swaps the mesh, the aerodynamics and the camera offsets together. */
let planeMesh = null;
let surfaces = null;
function selectAircraft(index, inAir = false) {
  current = AIRCRAFT[((index % AIRCRAFT.length) + AIRCRAFT.length) % AIRCRAFT.length];
  if (planeMesh) scene.remove(planeMesh);
  const built = current.build();
  planeMesh = built.group;
  surfaces = built.surfaces;
  scene.add(planeMesh);
  Object.assign(air, current.air);
  plane.gearDown = true;
  document.getElementById("i-plane").textContent = current.name;
  document.getElementById("crash").hidden = true;
  resetPlane(inAir);
  say(`${current.name}. ${current.spec}.`);
}
selectAircraft(0);
applyTime(0);

/* ================= the pre-flight screen =================
   One card, two halves. Choosing an aircraft or an airfield only marks it as *pending* — the
   simulator is not touched until Fly is pressed. That is the whole point: before this, clicking
   anything in either list respawned you on the spot, so picking a plane threw away the airfield
   you had just chosen, and picking an airfield threw away the plane. */

const preflightEl = document.getElementById("preflight");
const pending = { plane: 0, spawn: SPAWNS[0], tab: "ground" };

const groundSpawns = () => SPAWNS.filter((sp) => !sp.air);
const airSpawns = () => SPAWNS.filter((sp) => sp.air);

// the runway you would be pointed down, in the usual two-digit form
function runwayName(f) {
  const deg = (THREE.MathUtils.radToDeg(f.hdg) + 360) % 360;
  return `RWY ${String(((Math.round(deg / 10) + 35) % 36) + 1).padStart(2, "0")}`;
}

function pfCard(name, spec, blurb, on, badge) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `plane-card${on ? " on" : ""}`;
  const n = document.createElement("strong");
  n.textContent = name;
  if (badge) {
    const b = document.createElement("em");
    b.className = "pf-badge";
    b.textContent = badge;
    n.append(" ", b);
  }
  const sp = document.createElement("span");
  sp.className = "plane-spec";
  sp.textContent = spec;
  const bl = document.createElement("span");
  bl.className = "plane-blurb";
  bl.textContent = blurb;
  el.append(n, sp, bl);
  return el;
}

function renderPlanes() {
  const list = document.getElementById("plane-list");
  list.innerHTML = "";
  AIRCRAFT.forEach((a, i) => {
    const el = pfCard(a.name, a.spec, a.blurb, i === pending.plane,
      a.glider ? "no engine" : a.floats ? "water" : a.rough ? "STOL" : null);
    el.addEventListener("click", () => { pending.plane = i; renderPreflight(); });
    list.append(el);
  });
  document.getElementById("pf-plane-name").textContent = AIRCRAFT[pending.plane].name;
}

function renderPlacesList() {
  const list = document.getElementById("place-list");
  list.innerHTML = "";
  for (const sp of pending.tab === "air" ? airSpawns() : groundSpawns()) {
    const f = sp.field;
    const spec = sp.air
      ? `Airborne · ${Math.round(sp.air.pos[1] * FT).toLocaleString()} ft · ${Math.round(sp.air.speed * KT)} kt`
      : sp.water
        ? `Open water · sea level · near ${f.icao}`
        : `${SURFACE[f.kind] || "Asphalt"} · ${f.len.toLocaleString()} m · ${Math.round(f.elev * FT).toLocaleString()} ft · ${f.icao}`;
    const el = pfCard(sp.name, spec, sp.blurb, sp === pending.spawn,
      sp.air ? null : sp.water ? "floats" : runwayName(f));
    el.addEventListener("click", () => { pending.spawn = sp; renderPreflight(); });
    list.append(el);
  }
  document.getElementById("pf-place-name").textContent = pending.spawn.name;
}

/* The summary is the part that saves you a wasted flight: it says plainly whether the aircraft
   you picked can get out of the field you picked, from the same runway lengths the world was
   built from. */
function renderSummary() {
  const a = AIRCRAFT[pending.plane];
  const sp = pending.spawn;
  const el = document.getElementById("pf-summary");
  const fly = document.getElementById("pf-fly");
  el.className = "pf-summary";
  fly.textContent = "Fly";

  if (sp.water) {
    if (a.glider) {
      el.textContent = `${a.name} cannot float, so it starts on a tow above ${sp.field.name} instead.`;
    } else if (!a.floats) {
      el.textContent = `${a.name} has wheels, not floats — it will sit on the water and go nowhere. The Lagoon 18 is the one that flies from here.`;
      el.className = "pf-summary warn";
      fly.textContent = "Fly anyway";
    } else {
      el.textContent = `${a.name} on the water at ${sp.name.toLowerCase()}. Open the throttle and she comes up onto the step.`;
    }
    return;
  }

  if (sp.air) {
    el.textContent = a.glider
      ? `${a.name}, released high over ${sp.name.toLowerCase()}. No engine — find rising air.`
      : `${a.name}, already flying: ${sp.name.toLowerCase()}.`;
    return;
  }

  const f = sp.field;
  if (a.glider) {
    el.textContent = `${a.name} has no engine, so it starts on a tow above ${f.name} rather than on the runway.`;
    return;
  }
  const margin = f.len - a.needs;
  if (margin < 0) {
    el.textContent = `${a.name} needs about ${a.needs.toLocaleString()} m. ${f.name} has ${f.len.toLocaleString()}. You can try, but it will not end on the tarmac.`;
    el.className = "pf-summary warn";
    fly.textContent = "Fly anyway";
  } else if (margin < a.needs * 0.4) {
    el.textContent = `${a.name} off ${runwayName(f)} at ${f.name}. About ${a.needs.toLocaleString()} m needed, ${f.len.toLocaleString()} available — tight.`;
    el.className = "pf-summary tight";
  } else {
    el.textContent = `${a.name} off ${runwayName(f)} at ${f.name}: ${f.len.toLocaleString()} m of ${(SURFACE[f.kind] || "asphalt").toLowerCase()}, ${Math.round(f.elev * FT).toLocaleString()} ft above the sea.`;
  }
}

function renderPreflight() {
  renderPlanes();
  renderPlacesList();
  renderSummary();
  for (const b of preflightEl.querySelectorAll("[data-pf-tab]")) {
    b.classList.toggle("on", b.dataset.pfTab === pending.tab);
  }
}

function openPreflight(focus) {
  // open on what you are actually flying now, not on whatever was left pending last time
  pending.plane = Math.max(0, AIRCRAFT.indexOf(current));
  pending.spawn = spawn;
  pending.tab = focus === "air" || (focus !== "ground" && pending.spawn.air) ? "air" : "ground";
  renderPreflight();
  preflightEl.hidden = false;
  document.getElementById("help").hidden = true;
  // the chosen card is often scrolled out of sight in a list of eight — bring both into view,
  // but only on open, so it never fights you while you are browsing
  for (const on of preflightEl.querySelectorAll(".plane-card.on")) {
    on.scrollIntoView({ block: "nearest" });
  }
}

function togglePreflight(focus) {
  if (preflightEl.hidden) openPreflight(focus);
  else preflightEl.hidden = true;
}

for (const b of preflightEl.querySelectorAll("[data-pf-tab]")) {
  b.addEventListener("click", () => { pending.tab = b.dataset.pfTab; renderPreflight(); });
}
document.getElementById("pf-close").addEventListener("click", () => { preflightEl.hidden = true; });
document.getElementById("pf-teach").addEventListener("click", () => { preflightEl.hidden = true; startTutorial(); });
document.getElementById("pf-fly").addEventListener("click", () => {
  preflightEl.hidden = true;
  spawn = pending.spawn;                    // the place first: selectAircraft respawns, and
  selectAircraft(pending.plane, false);     // resetPlane reads spawn.air to decide how
});
renderPreflight();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const wall = Math.min((now - last) / 1000, 0.25);
  last = now;
  readInput(wall);

  // physics runs at a fixed 200 Hz whatever the display does
  acc += wall;
  const h = 1 / 200;
  let guard = 0;
  while (acc >= h && guard++ < 60) { step(h); acc -= h; }

  planeMesh.position.copy(plane.pos);
  planeMesh.quaternion.copy(plane.quat);
  if (surfaces.prop) {
    surfaces.prop.rotation.z = plane.propAngle;
    const fast = plane.throttle > 0.25;
    surfaces.disc.material.opacity = fast ? 0.3 : 0;
    surfaces.prop.visible = !fast;
  }
  if (surfaces.flame) {
    // the afterburner: a cone that grows and brightens with the last third of the throttle
    const burn = clamp((plane.throttle - 0.6) / 0.4, 0, 1);
    surfaces.flame.material.opacity = burn * 0.75;
    surfaces.flame.scale.set(0.8 + burn * 0.5, 0.6 + burn * 0.9, 0.8 + burn * 0.5);
  }
  surfaces.elevator.rotation.x = -input.pitch * 0.34;
  surfaces.rudder.rotation.y = -input.yaw * 0.4;
  if (surfaces.aileronL) surfaces.aileronL.rotation.x = input.roll * 0.4;
  if (surfaces.aileronR) surfaces.aileronR.rotation.x = -input.roll * 0.4;
  if (surfaces.flapL) surfaces.flapL.rotation.x = plane.flaps * 0.55;
  if (surfaces.flapR) surfaces.flapR.rotation.x = plane.flaps * 0.55;
  surfaces.gear.visible = plane.gearDown;

  // the shadow frustum follows the aircraft, so a 2k map covers what you can actually see
  sun.target.position.copy(plane.pos);
  sun.position.copy(plane.pos).addScaledVector(sunDir, 900);
  sun.target.updateMatrixWorld();

  // water and sky ride with the camera; the waves keep their own clock
  water.position.x = camera.position.x;
  water.position.z = camera.position.z;
  water.material.uniforms.uTime.value = now / 1000;
  water.material.uniforms.uFogColor.value.copy(scene.fog.color);
  updateTrails();
  for (const r of turbines) r.rotation.z -= wall * 0.9;
  if (beacon) beacon.rotation.y += wall * 0.55;
  for (const b of boats) {
    b.group.translateZ(b.speed * wall);
    const p = b.group.position;
    if (Math.hypot(p.x, p.z) > 8600) b.group.rotation.y += Math.PI * 0.6;
  }
  for (const c of clouds) {
    c.group.position.x += c.drift * wall;
    if (c.group.position.x > WORLD * 0.85) c.group.position.x -= WORLD * 1.7;
  }
  sky.position.copy(camera.position);
  updateCamera(wall);
  updateHUD(wall);
  updateTutorial(wall);
  updateAudio();
  renderer.render(scene, camera);
}

document.getElementById("loading").hidden = true;
requestAnimationFrame(frame);

/* A handle for testing the flight model without the renderer: the physics is deterministic and
   fixed-step, so it can be run headlessly and checked against real numbers. */
/* The minimap is painted from the heightmap rather than drawn by hand, so it shows the island
   that actually exists — every bay, and every strip in the right place. */
function paintMap() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -WORLD / 2 + (i / (size - 1)) * WORLD;
      const z = -WORLD / 2 + (j / (size - 1)) * WORLD;
      const h = seabedAt(x, z);
      let r, g, b;
      if (h <= 0) {
        const t = clamp(-h / 120, 0, 1);                   // shallows pale, deep water dark
        r = 26 - t * 12; g = 62 - t * 26; b = 92 - t * 34;
      } else if (h < 1020) {
        const t = clamp(h / 1020, 0, 1);
        r = 46 + t * 92; g = 92 + t * 40; b = 44 + t * 28; // green shore up to brown highland
      } else {
        const t = clamp((h - 1020) / 500, 0, 1);
        r = 138 + t * 100; g = 132 + t * 110; b = 72 + t * 150;   // snow
      }
      const k = (j * size + i) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  document.getElementById("map-img").setAttribute("href", c.toDataURL());

  // every strip, drawn as a line lying along its real heading
  const g = document.getElementById("map-fields");
  const NS = "http://www.w3.org/2000/svg";
  for (const f of FIELDS) {
    const mx = (f.x / WORLD + 0.5) * 128;
    const mz = (f.z / WORLD + 0.5) * 128;
    const half = Math.max(2.2, (f.len / WORLD) * 128 * 2.4);
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", (mx - Math.sin(f.hdg) * half).toFixed(2));
    line.setAttribute("y1", (mz - Math.cos(f.hdg) * half).toFixed(2));
    line.setAttribute("x2", (mx + Math.sin(f.hdg) * half).toFixed(2));
    line.setAttribute("y2", (mz + Math.cos(f.hdg) * half).toFixed(2));
    line.setAttribute("stroke", "#e8f4fb");
    line.setAttribute("stroke-width", "1.6");
    line.setAttribute("stroke-linecap", "round");
    g.append(line);
  }
}
paintMap();

// which field you are nearest, so the label under the map is always useful
function nearestField() {
  let best = FIELDS[0], bd = Infinity;
  for (const f of FIELDS) {
    const d = Math.hypot(plane.pos.x - f.x, plane.pos.z - f.z);
    if (d < bd) { bd = d; best = f; }
  }
  return { field: best, dist: bd };
}

window.__sim = { plane, input, air, step, groundAt, seabedAt, surfaceAt, pavementAt, resetPlane, heading, keys, CAMS, KT, FT,
  AIRCRAFT, selectAircraft, applyTime, SPAWNS, FIELDS, weather, autopilot, LESSONS, tutorial, startTutorial, updateTutorial, windAt,
  pending, openPreflight, renderPreflight, nearestField,
  setSpawn: (i) => { spawn = SPAWNS[i]; } };
