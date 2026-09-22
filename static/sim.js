/* Crosswind — a flight simulator that runs in a browser tab.

   Everything here is metres, seconds, newtons and radians; only the instruments convert to
   knots and feet, the way a real aircraft does. The world is generated from noise at load
   time and shared between the terrain mesh and the physics, so the wheels touch exactly the
   ground you can see. */

import * as THREE from "three";

/* ================= constants ================= */

const WORLD = 16384;        // metres across
const GRID = 257;           // heightmap samples per side (power of two + 1)
const SEA = 0;              // sea level
const FIELD_ELEV = 62;      // the airfield plateau
const RUNWAY_LEN = 1800;
const RUNWAY_W = 46;
const G = 9.80665;
const KT = 1.94384;         // m/s to knots
const FT = 3.28084;         // m to feet

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

/* The island: a broad coastal plain with a mountain range to the north-east, ringed by sea,
   and a flat shelf where the airfield sits. */
const heights = new Float32Array(GRID * GRID);

function buildHeightmap() {
  const half = WORLD / 2;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -half + (i / (GRID - 1)) * WORLD;
      const z = -half + (j / (GRID - 1)) * WORLD;

      const ridged = 1 - Math.abs(fbm(x / 5200, z / 5200, 5));
      const rolling = fbm(x / 2600 + 40, z / 2600 - 12, 6);
      // mountains rise toward the north-east corner, the coast falls away to the south-west
      const mountainMask = clamp((x / WORLD + 0.15) * 1.5 + (-z / WORLD + 0.1) * 1.5, 0, 1);
      let h = 40 + rolling * 220 + Math.pow(ridged, 2.4) * 1750 * mountainMask;

      // an island: drop everything to the sea beyond a soft radius
      const d = Math.hypot(x, z) / half;
      h *= clamp(1.35 - Math.pow(d, 3.2) * 1.5, 0, 1);
      h -= 45 * clamp((d - 0.72) * 3, 0, 1);

      heights[j * GRID + i] = h;
    }
  }
  flattenField();
}

/* The airfield needs ground that is exactly level — the runway is drawn at a fixed height, so
   any residual slope here would leave the aircraft rolling along invisible ground above or
   below the tarmac. Dead flat over the field itself, then blended out into the hills. */
function flattenField() {
  const half = WORLD / 2;
  const INNER_X = 1100, INNER_Z = 1500;   // fully level
  const OUTER_X = 2600, OUTER_Z = 3200;   // blended
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -half + (i / (GRID - 1)) * WORLD;
      const z = -half + (j / (GRID - 1)) * WORLD;
      const dx = Math.abs(x), dz = Math.abs(z);
      if (dx > OUTER_X || dz > OUTER_Z) continue;
      const tx = dx <= INNER_X ? 1 : smooth(clamp((OUTER_X - dx) / (OUTER_X - INNER_X), 0, 1));
      const tz = dz <= INNER_Z ? 1 : smooth(clamp((OUTER_Z - dz) / (OUTER_Z - INNER_Z), 0, 1));
      const t = Math.min(tx, tz);
      const k = j * GRID + i;
      heights[k] = lerp(heights[k], FIELD_ELEV, t);
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

/* ================= scene ================= */

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 60000);

const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
sun.position.set(-0.42, 0.62, 0.35).multiplyScalar(6000);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x4a5a3a, 1.05));

// Sky: one big inverted sphere with a gradient that knows where the sun is.
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    // the renderer works in linear space, so these are converted rather than passed as sRGB
    uSun: { value: sun.position.clone().normalize() },
    uTop: { value: new THREE.Color(0x2f6ec4).convertSRGBToLinear() },
    uMid: { value: new THREE.Color(0x9ec8ef).convertSRGBToLinear() },
    uHaze: { value: new THREE.Color(0xe8f1fa).convertSRGBToLinear() },
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
      float h = clamp(vDir.y * 1.15 + 0.06, -1.0, 1.0);
      vec3 col = mix(uHaze, uMid, smoothstep(-0.02, 0.35, h));
      col = mix(col, uTop, smoothstep(0.25, 0.95, h));
      float sunAmt = pow(clamp(dot(normalize(vDir), normalize(uSun)), 0.0, 1.0), 220.0);
      float glow = pow(clamp(dot(normalize(vDir), normalize(uSun)), 0.0, 1.0), 6.0) * 0.22;
      col += vec3(1.0, 0.94, 0.82) * (sunAmt * 3.0 + glow);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 20), skyMat);
sky.frustumCulled = false;
scene.add(sky);
scene.fog = new THREE.FogExp2(0xcfe0ee, 0.000042);

/* ---------- terrain ---------- */

function buildTerrain() {
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, GRID - 1, GRID - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xd9cfa3);
  const grass = new THREE.Color(0x5f8a46);
  const grassDry = new THREE.Color(0x7d8f4a);
  const rock = new THREE.Color(0x7a7268);
  const snow = new THREE.Color(0xf2f4f8);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundAt(x, z);
    pos.setY(i, h);

    // slope drives the rock/grass mix, height drives snow and shoreline
    const e = 24;
    const slope = Math.min(1, (Math.abs(groundAt(x + e, z) - h) + Math.abs(groundAt(x, z + e) - h)) / e * 3.2);
    c.copy(grass).lerp(grassDry, clamp(fbm(x / 900, z / 900, 3) * 0.5 + 0.5, 0, 1));
    if (h < 6) c.lerp(sand, clamp((6 - h) / 6, 0, 1));
    c.lerp(rock, clamp(slope * 1.15 - 0.15, 0, 1));
    if (h > 900) c.lerp(snow, clamp((h - 900) / 420, 0, 1) * clamp(1.25 - slope, 0, 1));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  return mesh;
}

function buildSea() {
  const geo = new THREE.PlaneGeometry(WORLD * 3, WORLD * 3, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2f6f8f, roughness: 0.16, metalness: 0.45, transparent: true, opacity: 0.94,
  });
  const sea = new THREE.Mesh(geo, mat);
  sea.position.y = SEA - 0.4;
  scene.add(sea);
  return sea;
}

/* ---------- the airfield ---------- */

const RUNWAY_HDG = 0; // the strip runs north–south; runway 36 at the south end

function buildAirfield() {
  const group = new THREE.Group();
  const y = FIELD_ELEV;

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY_W + 260, RUNWAY_LEN + 340),
    new THREE.MeshLambertMaterial({ color: 0x6f7a55 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, y + 0.05, 0);
  group.add(apron);

  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY_W, RUNWAY_LEN),
    new THREE.MeshLambertMaterial({ color: 0x3a3c40 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, y + 0.12, 0);
  group.add(strip);

  const paint = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  // centreline
  for (let d = -RUNWAY_LEN / 2 + 60; d < RUNWAY_LEN / 2 - 60; d += 60) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 30), paint);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, y + 0.2, d);
    group.add(dash);
  }
  // thresholds
  for (const end of [-1, 1]) {
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 26), paint);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(k * 4.2, y + 0.2, end * (RUNWAY_LEN / 2 - 26));
      group.add(bar);
    }
    const num = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), paint);
    num.rotation.x = -Math.PI / 2;
    num.position.set(0, y + 0.2, end * (RUNWAY_LEN / 2 - 70));
    group.add(num);
  }
  // edge lights — white down the sides, green at the near threshold
  const bulb = new THREE.SphereGeometry(0.7, 6, 5);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const green = new THREE.MeshBasicMaterial({ color: 0x46ff8c });
  for (let d = -RUNWAY_LEN / 2; d <= RUNWAY_LEN / 2; d += 90) {
    for (const sideX of [-RUNWAY_W / 2 - 2, RUNWAY_W / 2 + 2]) {
      const b = new THREE.Mesh(bulb, Math.abs(d - RUNWAY_LEN / 2) < 1 ? green : white);
      b.position.set(sideX, y + 0.6, d);
      group.add(b);
    }
  }

  // a tower and three hangars, so the field reads as a place
  const tower = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 26, 12), new THREE.MeshLambertMaterial({ color: 0xd8d4cc }));
  base.position.y = 13;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 7, 12), new THREE.MeshLambertMaterial({ color: 0x2c3138 }));
  cab.position.y = 29;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 4.4, 12), new THREE.MeshStandardMaterial({ color: 0x8fd0ff, roughness: 0.1, metalness: 0.6 }));
  glass.position.y = 29.4;
  tower.add(base, cab, glass);
  tower.position.set(-120, y, -240);
  group.add(tower);

  for (let i = 0; i < 3; i++) {
    const hangar = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 52, 14, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0xb9bec4 }));
    shell.rotation.z = Math.PI / 2;
    shell.rotation.y = Math.PI / 2;
    shell.position.y = 0.5;
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshLambertMaterial({ color: 0x9aa1a8, side: THREE.DoubleSide }));
    backWall.position.set(0, 11, -26);
    hangar.add(shell, backWall);
    hangar.position.set(-190, y, -60 + i * 90);
    group.add(hangar);
  }

  scene.add(group);
  return group;
}

/* ---------- scenery ---------- */

function scatterTrees(count = 9000) {
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 4, 5);
  const leafGeo = new THREE.ConeGeometry(3.4, 11, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4433 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x33632f });
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
    if (h < 12 || h > 880) continue;                       // no trees on the beach or the peaks
    if (Math.abs(x) < 900 && Math.abs(z) < 1500) continue; // or on the airfield
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
  scene.add(trunks, leaves);
}

function buildClouds(count = 90) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
  const puffs = new THREE.InstancedMesh(geo, mat, count * 7);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  const groups = [];
  for (let i = 0; i < count; i++) {
    const cx = (Math.random() - 0.5) * WORLD * 1.4;
    const cz = (Math.random() - 0.5) * WORLD * 1.4;
    const cy = 900 + Math.random() * 1700;
    groups.push({ x: cx, y: cy, z: cz });
    const puffCount = 4 + Math.floor(Math.random() * 3);
    for (let p = 0; p < puffCount; p++) {
      const s = 110 + Math.random() * 190;
      m.compose(
        new THREE.Vector3(cx + (Math.random() - 0.5) * 420, cy + (Math.random() - 0.5) * 70, cz + (Math.random() - 0.5) * 420),
        q, new THREE.Vector3(s, s * 0.55, s),
      );
      puffs.setMatrixAt(n++, m);
    }
  }
  puffs.count = n;
  puffs.instanceMatrix.needsUpdate = true;
  puffs.frustumCulled = false;
  scene.add(puffs);
}

/* ================= the aeroplane ================= */

const paintMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.42, metalness: 0.12 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.4, metalness: 0.1 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.07, metalness: 0.3, transparent: true, opacity: 0.55 });

// A high-wing single, built from primitives — recognisably a light aircraft from any angle.
function buildAircraft() {
  const plane = new THREE.Group();
  const surfaces = {};

  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.72, 4.6, 6, 14), paintMat);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.set(0, 0, 0.5);
  plane.add(fuse);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.5, 16), paintMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0, -3.5);
  plane.add(nose);

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 12), trimMat);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.set(0, 0, -4.35);
  plane.add(spinner);

  const prop = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.9, 0.06), darkMat);
    blade.rotation.z = i * Math.PI / 2;
    prop.add(blade);
  }
  prop.position.set(0, 0, -4.15);
  plane.add(prop);
  surfaces.prop = prop;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  disc.position.set(0, 0, -4.2);
  plane.add(disc);
  surfaces.disc = disc;

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.86, 2.1), glassMat);
  cabin.position.set(0, 0.5, -1.1);
  plane.add(cabin);

  // wing: high-mounted, slight dihedral, with struts
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.22, 1.62), paintMat);
  wing.position.set(0, 0.92, -0.7);
  plane.add(wing);
  const wingTip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 1.4), trimMat);
  wingTip.position.set(5.6, 0.92, -0.7);
  plane.add(wingTip);
  const wingTip2 = wingTip.clone();
  wingTip2.position.x = -5.6;
  plane.add(wingTip2);

  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), darkMat);
    strut.position.set(side * 2.1, 0.25, -0.5);
    strut.rotation.z = side * 0.42;
    plane.add(strut);

    const aileron = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.14, 0.5), trimMat);
    aileron.position.set(side * 3.9, 0.9, 0.2);
    plane.add(aileron);
    surfaces[side > 0 ? "aileronR" : "aileronL"] = aileron;

    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.52), paintMat);
    flap.position.set(side * 1.3, 0.9, 0.2);
    plane.add(flap);
    surfaces[side > 0 ? "flapR" : "flapL"] = flap;
  }

  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.16, 1.1), paintMat);
  tailplane.position.set(0, 0.35, 3.3);
  plane.add(tailplane);
  const elevator = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.13, 0.46), trimMat);
  elevator.position.set(0, 0.35, 3.95);
  plane.add(elevator);
  surfaces.elevator = elevator;

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 1.5), paintMat);
  fin.position.set(0, 1.1, 3.4);
  plane.add(fin);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.55, 0.5), trimMat);
  rudder.position.set(0, 1.05, 4.15);
  plane.add(rudder);
  surfaces.rudder = rudder;

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.16, 5.2), trimMat);
  stripe.position.set(0, -0.28, 0.6);
  plane.add(stripe);

  // undercarriage: two mains and a nosewheel
  const gear = new THREE.Group();
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 0.12), darkMat);
    leg.position.set(side * 1.25, -0.95, 0.3);
    leg.rotation.z = -side * 0.35;
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.6, -1.5, 0.3);
    gear.add(leg, wheel);
  }
  const noseLeg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), darkMat);
  noseLeg.position.set(0, -0.95, -2.6);
  const noseWheel = new THREE.Mesh(wheelGeo, darkMat);
  noseWheel.rotation.z = Math.PI / 2;
  noseWheel.position.set(0, -1.5, -2.6);
  gear.add(noseLeg, noseWheel);
  plane.add(gear);
  surfaces.gear = gear;

  // navigation lights
  const lampL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  lampL.position.set(-5.7, 0.95, -0.7);
  const lampR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: 0x30ff6a }));
  lampR.position.set(5.7, 0.95, -0.7);
  plane.add(lampL, lampR);

  scene.add(plane);
  return { plane, surfaces };
}

/* ================= flight model ================= */

/* Numbers in the region of a Cessna 172: about a tonne, sixteen square metres of wing, and
   enough thrust to leave the ground at around 55 knots with a bit of flap. The control terms
   below are angular accelerations in rad/s^2 at full deflection, scaled by how much air is
   going over the surfaces — which is why everything goes slack as you slow down. */
const air = {
  mass: 1000,
  wingArea: 16.2,
  maxThrust: 4400,     // N static at sea level
  CL0: 0.30,
  CLa: 5.2,            // per radian
  stallA: 0.29,        // about 17 degrees
  CD0: 0.028,
  induced: 0.052,
  gearDrag: 0.012,
  flapLift: 0.45,
  flapDrag: 0.04,
  /* Steady rates at full deflection are power/damp: about 28°/s in pitch, 90°/s in roll. The
     stability terms are what return the aircraft to trim when you let go — set too low and it
     porpoises through the sky, which is exactly what a real elevator's damping prevents. */
  pitchPower: 2.4, rollPower: 4.4, yawPower: 1.2,
  pitchDamp: 5.0, rollDamp: 3.0, yawDamp: 2.2,
  pitchStab: 9.0, yawStab: 3.2,
};

const plane = {
  pos: new THREE.Vector3(0, FIELD_ELEV + 1.55, RUNWAY_LEN / 2 - 160),
  vel: new THREE.Vector3(0, 0, 0),
  quat: new THREE.Quaternion(),
  omega: new THREE.Vector3(),   // body rates: x pitch, y yaw, z roll
  throttle: 0,
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

function resetPlane(inAir = false) {
  plane.crashed = false;
  plane.score = null;
  plane.omega.set(0, 0, 0);
  plane.flaps = 0;
  plane.gearDown = true;
  plane.fuel = 1;
  if (inAir) {
    plane.pos.set(0, FIELD_ELEV + 760, 6500);
    plane.quat.identity();
    plane.vel.set(0, 0, -52);
    plane.throttle = 0.75;
    plane.brakes = false;
    plane.onGround = false;
  } else {
    plane.pos.set(0, FIELD_ELEV + 1.55, RUNWAY_LEN / 2 - 160);
    plane.quat.identity();
    plane.vel.set(0, 0, 0);
    plane.throttle = 0;
    plane.brakes = true;
    plane.onGround = true;
  }
  say(inAir
    ? "Four miles out at 2,500 feet, lined up on runway 36. Bring the power back and fly it down."
    : "Holding on runway 36. Brakes off, full throttle, and ease back at 55 knots.");
}

const axisF = new THREE.Vector3();
const axisU = new THREE.Vector3();
const axisR = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const invQ = new THREE.Quaternion();

const density = (alt) => 1.225 * Math.exp(-Math.max(0, alt) / 8500);

function step(dt) {
  if (plane.crashed) return;

  axisF.set(0, 0, -1).applyQuaternion(plane.quat);
  axisU.set(0, 1, 0).applyQuaternion(plane.quat);
  axisR.set(1, 0, 0).applyQuaternion(plane.quat);

  const alt = plane.pos.y;
  const rho = density(alt);
  const speed = plane.vel.length();

  // relative wind in body axes gives angle of attack and sideslip
  invQ.copy(plane.quat).invert();
  const vb = tmp.copy(plane.vel).applyQuaternion(invQ);
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
    forces.addScaledVector(tmp2.copy(plane.vel).normalize(), -drag);
    // lift acts perpendicular to the relative wind, in the aircraft's plane of symmetry
    const liftDir = tmp2.copy(plane.vel).normalize().cross(axisR).normalize().multiplyScalar(-1);
    forces.addScaledVector(liftDir, q * air.wingArea * CL);
    // a little side force so slipping is felt
    forces.addScaledVector(axisR, -q * air.wingArea * 0.9 * beta);
  }

  const thrust = plane.engineOn && plane.fuel > 0
    ? plane.throttle * air.maxThrust * (rho / 1.225) * (1 - clamp(speed / 92, 0, 0.55))
    : 0;
  forces.addScaledVector(axisF, thrust);
  if (thrust > 0) plane.fuel = Math.max(0, plane.fuel - dt * 0.000038 * (0.35 + plane.throttle));

  // ---- moments, as angular accelerations ----
  const authority = clamp(q / 700, 0, 2.0);
  const angAcc = new THREE.Vector3(
    (input.pitch * air.pitchPower - alpha * air.pitchStab - plane.omega.x * air.pitchDamp) * authority,
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
  const ground = groundAt(plane.pos.x, plane.pos.z);
  const gearHeight = plane.gearDown ? 1.55 : 0.75;
  const onRunway = Math.abs(plane.pos.x) < RUNWAY_W / 2 + 6 && Math.abs(plane.pos.z) < RUNWAY_LEN / 2;
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
  const groundNow = groundAt(plane.pos.x, plane.pos.z);
  const floor = groundNow + 0.05 + gearHeight;
  const touching = plane.pos.y <= floor + 0.001;

  if (touching && !plane.onGround) {
    // the moment of arrival: was it a landing or an accident?
    const vy = plane.vel.y;
    const bank = Math.abs(Math.asin(clamp(axisR.y, -1, 1)));
    const nose = Math.asin(clamp(axisF.y, -1, 1));
    const roughGround = !onRunway && speed > 24;
    if (!plane.gearDown && speed > 8) return crash("Gear up. That was expensive.");
    if (speed > 12 && (vy < -4.4 || bank > 0.32 || nose < -0.28 || roughGround)) {
      return crash(vy < -4.4 ? "Hard landing — the gear let go."
        : roughGround ? "You put it down off the field."
        : "A wingtip caught the ground.");
    }
    const rate = Math.round(-vy * 196.85);
    const offCentre = Math.abs(plane.pos.x);
    plane.score = { rate, offCentre: Math.round(offCentre), speed: Math.round(speed * KT), onRunway };
    say(onRunway
      ? `Touchdown · ${rate} fpm · ${Math.round(offCentre)} m off the centreline · ${grade(rate, offCentre)}`
      : "Down in one piece, but that wasn't the runway.");
  }
  plane.onGround = touching;

  if (touching) {
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
    camera.fov = 68;
    const eye = plane.pos.clone().addScaledVector(f, 0.9).addScaledVector(u, 0.62);
    camera.position.copy(eye);
    camera.quaternion.copy(plane.quat);
  } else if (mode === "Wing") {
    camera.fov = 58;
    const eye = plane.pos.clone().addScaledVector(r, 7.5).addScaledVector(u, 1.4).addScaledVector(f, -1.5);
    camera.position.lerp(eye, clamp(dt * 9, 0, 1));
    camera.lookAt(plane.pos);
  } else if (mode === "Tower") {
    camera.fov = 34;
    camera.position.set(-120, FIELD_ELEV + 34, -240);
    camera.lookAt(plane.pos);
  } else {
    camera.fov = 62;
    const back = 16 + Math.min(plane.vel.length() * 0.22, 12);
    const want = plane.pos.clone().addScaledVector(f, -back).addScaledVector(u, 4.2);
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
};

let msgTimer = 0;
function say(text) {
  hud.msg.textContent = text;
  hud.msg.hidden = false;
  msgTimer = 6;
}

function updateHUD(dt) {
  const speed = plane.vel.length();
  const kts = speed * KT;
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
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

function readInput(dt) {
  const held = (...names) => names.some((n) => keys.has(n));
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
  input.pitch += (target.pitch - input.pitch) * clamp(dt * rate, 0, 1);
  input.roll += (target.roll - input.roll) * clamp(dt * rate, 0, 1);
  input.yaw += (target.yaw - input.yaw) * clamp(dt * rate * 1.4, 0, 1);
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

/* ================= loop ================= */

buildHeightmap();
buildTerrain();
buildSea();
buildAirfield();
scatterTrees();
buildClouds();
const { plane: planeMesh, surfaces } = buildAircraft();
resetPlane(false);

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
  surfaces.prop.rotation.z = plane.propAngle;
  const fast = plane.throttle > 0.25;
  surfaces.disc.material.opacity = fast ? 0.32 : 0;
  surfaces.prop.visible = !fast;
  surfaces.elevator.rotation.x = -input.pitch * 0.42;
  surfaces.rudder.rotation.y = -input.yaw * 0.42;
  surfaces.aileronL.rotation.x = input.roll * 0.4;
  surfaces.aileronR.rotation.x = -input.roll * 0.4;
  surfaces.flapL.rotation.x = plane.flaps * 0.5;
  surfaces.flapR.rotation.x = plane.flaps * 0.5;
  surfaces.gear.visible = plane.gearDown;

  sky.position.copy(camera.position);
  updateCamera(wall);
  updateHUD(wall);
  updateAudio();
  renderer.render(scene, camera);
}

document.getElementById("loading").hidden = true;
requestAnimationFrame(frame);

/* A handle for testing the flight model without the renderer: the physics is deterministic and
   fixed-step, so it can be run headlessly and checked against real numbers. */
window.__sim = { plane, input, air, step, groundAt, resetPlane, heading, keys, CAMS, KT, FT };
