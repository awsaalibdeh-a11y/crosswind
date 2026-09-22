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
const RUNWAY_LEN = 2600;   // long enough for the airliner to get off and stop again
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
  const INNER_X = 1100, INNER_Z = 1900;   // fully level
  const OUTER_X = 2600, OUTER_Z = 3800;   // blended
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
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.6, 70000);

/* The sun drives everything: the light, the sky gradient, the water's specular and the fog.
   Moving it moves all four together, which is what makes a time of day feel like a time of
   day rather than a filter. */
const TIMES = [
  { id: "morning", label: "Morning", dir: [-0.55, 0.42, 0.72], light: 0xffe8c8, power: 2.5, amb: 0.95, top: 0x2c6cc4, mid: 0x9cc7ee, haze: 0xf2e6d2, fog: 0xdce6ee },
  { id: "noon", label: "Midday", dir: [-0.28, 0.92, 0.27], light: 0xfff6e8, power: 3.0, amb: 1.1, top: 0x1f5fc0, mid: 0x8dc0ee, haze: 0xe9f2fb, fog: 0xd4e4f2 },
  { id: "golden", label: "Golden hour", dir: [-0.86, 0.16, 0.48], light: 0xffb56a, power: 2.6, amb: 0.8, top: 0x2a4f9e, mid: 0xb08bc8, haze: 0xffbf86, fog: 0xf0c49a },
  { id: "dusk", label: "Dusk", dir: [-0.93, 0.05, 0.36], light: 0xff8f54, power: 1.7, amb: 0.6, top: 0x1b2f6e, mid: 0x7a6bab, haze: 0xff9b6a, fog: 0xc9a2a0 },
];
let timeIndex = 0;
const sunDir = new THREE.Vector3(...TIMES[0].dir).normalize();

const sun = new THREE.DirectionalLight(0xffe8c8, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 2600;
sun.shadow.camera.left = -260;
sun.shadow.camera.right = 260;
sun.shadow.camera.top = 260;
sun.shadow.camera.bottom = -260;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 1.2;
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
  refreshEnvironment();
  say(`${t.label}.`);
}

/* ---------- terrain ---------- */

function buildTerrain() {
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, GRID - 1, GRID - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xe0d3a6);
  const grass = new THREE.Color(0x5c8a43);
  const grassDry = new THREE.Color(0x869150);
  const forest = new THREE.Color(0x3d6236);
  const rock = new THREE.Color(0x7d7468);
  const rockDark = new THREE.Color(0x565049);
  const snow = new THREE.Color(0xf6f8fb);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundAt(x, z);
    pos.setY(i, h);

    const e = 24;
    const slope = Math.min(1, (Math.abs(groundAt(x + e, z) - h) + Math.abs(groundAt(x, z + e) - h)) / e * 3.0);
    const patch = clamp(fbm(x / 760, z / 760, 3) * 0.5 + 0.5, 0, 1);
    const fine = clamp(fbm(x / 180 + 9, z / 180 - 4, 2) * 0.5 + 0.5, 0, 1);

    c.copy(grass).lerp(grassDry, patch);
    c.lerp(forest, clamp((1 - patch) * 0.8 - slope * 0.3, 0, 0.7));
    if (h < 8) c.lerp(sand, clamp((8 - h) / 7, 0, 1));
    c.lerp(rock.clone().lerp(rockDark, fine), clamp(slope * 1.2 - 0.12, 0, 1));
    if (h > 820) c.lerp(snow, clamp((h - 820) / 380, 0, 1) * clamp(1.3 - slope, 0, 1));
    c.multiplyScalar(0.94 + fine * 0.12);   // a little grain so big faces don't read as flat
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.93, metalness: 0.0,
  }));
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  return mesh;
}

/* ---------- the sea ---------- */

// Gerstner-ish waves in the vertex shader, sky reflection and a sun glitter path in the
// fragment shader. The mesh follows the camera so the detail is always where you are.
function buildSea() {
  const geo = new THREE.PlaneGeometry(26000, 26000, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSky: { value: new THREE.Color(0x9cc7ee).convertSRGBToLinear() },
      uHaze: { value: new THREE.Color(0xf2e6d2).convertSRGBToLinear() },
      uDeep: { value: new THREE.Color(0x0e3550).convertSRGBToLinear() },
      uShallow: { value: new THREE.Color(0x2d7f9e).convertSRGBToLinear() },
      uFogColor: { value: new THREE.Color(0xdce6ee) },
      uFogDensity: { value: 0.000035 },
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
        p += wave(xz, normalize(vec2(1.0, 0.35)), 120.0, 1.5, 9.0, n1);
        p += wave(xz, normalize(vec2(-0.4, 1.0)), 61.0, 0.75, 7.0, n2);
        p += wave(xz, normalize(vec2(0.7, -0.8)), 27.0, 0.28, 5.0, n3);
        vNormal = normalize(vec3(0.0, 1.0, 0.0) + n1 + n2 + n3);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 uSun, uSky, uHaze, uDeep, uShallow, uFogColor;
      uniform float uFogDensity;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 s = normalize(uSun);
        float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.5);
        vec3 body = mix(uDeep, uShallow, clamp(dot(n, v) * 0.9, 0.0, 1.0));
        vec3 skyCol = mix(uSky, uHaze, 0.35);
        vec3 col = mix(body, skyCol, clamp(fres * 1.15, 0.0, 0.92));
        // the glitter path: a tight specular smeared along the wave normals
        vec3 h = normalize(s + v);
        float spec = pow(clamp(dot(n, h), 0.0, 1.0), 220.0);
        float sheen = pow(clamp(dot(n, h), 0.0, 1.0), 18.0) * 0.12;
        col += vec3(1.0, 0.93, 0.8) * (spec * 2.4 + sheen);
        float d = length(cameraPosition - vWorld);
        float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
        col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 0.97);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA - 0.3;
  mesh.renderOrder = -1;
  scene.add(mesh);
  return mesh;
}

/* ---------- the airfield ---------- */

const RUNWAY_HDG = 0; // the strip runs north–south; runway 36 at the south end

function buildAirfield() {
  const group = new THREE.Group();
  const y = FIELD_ELEV;

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY_W + 260, RUNWAY_LEN + 340),
    new THREE.MeshStandardMaterial({ color: 0x6d7a4e, roughness: 0.95 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, y + 0.05, 0);
  group.add(apron);

  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY_W, RUNWAY_LEN),
    new THREE.MeshStandardMaterial({ color: 0x35373b, roughness: 0.82, metalness: 0.05 }),
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

  const taxi = new THREE.Mesh(
    new THREE.PlaneGeometry(18, RUNWAY_LEN * 0.8),
    new THREE.MeshStandardMaterial({ color: 0x3c3e42, roughness: 0.85 }),
  );
  taxi.rotation.x = -Math.PI / 2;
  taxi.position.set(-110, y + 0.1, 0);
  group.add(taxi);

  // PAPI: red over white and you are on the slope
  for (let k = 0; k < 4; k++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: k < 2 ? 0xff4b3a : 0xffffff }));
    lamp.position.set(-RUNWAY_W / 2 - 16 - k * 5, y + 1.2, RUNWAY_LEN / 2 - 260);
    group.add(lamp);
  }

  // a tower and three hangars, so the field reads as a place
  const tower = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 26, 12), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.8 }));
  base.position.y = 13;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 7, 12), new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.3 }));
  cab.position.y = 29;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 4.4, 12), new THREE.MeshStandardMaterial({ color: 0x8fd0ff, roughness: 0.1, metalness: 0.6 }));
  glass.position.y = 29.4;
  tower.add(base, cab, glass);
  tower.position.set(-120, y, -240);
  group.add(tower);

  for (let i = 0; i < 3; i++) {
    const hangar = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 52, 14, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.45, metalness: 0.45 }));
    shell.rotation.z = Math.PI / 2;
    shell.rotation.y = Math.PI / 2;
    shell.position.y = 0.5;
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.7, side: THREE.DoubleSide }));
    backWall.position.set(0, 11, -26);
    hangar.add(shell, backWall);
    hangar.position.set(-190, y, -60 + i * 90);
    group.add(hangar);
  }

  group.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = o.geometry.type !== "PlaneGeometry"; } });
  scene.add(group);
  return group;
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
    id: "skylark",
    name: "Skylark 172",
    blurb: "A high-wing trainer. Slow, forgiving and hard to frighten — start here.",
    spec: "Rotate 55 kt · Cruise 110 kt · 1.0 t",
    build: buildSkylark,
    eye: [0, 0.62, 0.9], chase: 16, gearHeight: 1.55, propDriven: true,
    air: {
      mass: 1000, wingArea: 16.2, maxThrust: 4400, vMax: 92,
      CL0: 0.30, CLa: 5.2, stallA: 0.29, CD0: 0.028, induced: 0.052,
      gearDrag: 0.012, flapLift: 0.45, flapDrag: 0.04,
      pitchPower: 2.4, rollPower: 4.4, yawPower: 1.2,
      pitchDamp: 5.0, rollDamp: 3.0, yawDamp: 2.2,
      pitchStab: 9.0, yawStab: 3.2,
    },
  },
  {
    id: "sprint",
    name: "Sprint S2",
    blurb: "A low-wing aerobat with a big engine and a short wing. It rolls like a barrel.",
    spec: "Rotate 60 kt · Cruise 150 kt · 1.1 t",
    build: buildSprint,
    eye: [0, 0.5, 0.2], chase: 15, gearHeight: 1.25, propDriven: true, taildragger: true,
    air: {
      mass: 1080, wingArea: 13.4, maxThrust: 7200, vMax: 120,
      CL0: 0.26, CLa: 5.4, stallA: 0.31, CD0: 0.026, induced: 0.055,
      gearDrag: 0.010, flapLift: 0.0, flapDrag: 0.0,
      pitchPower: 4.6, rollPower: 11.0, yawPower: 2.0,
      pitchDamp: 4.2, rollDamp: 3.4, yawDamp: 2.4,
      pitchStab: 7.0, yawStab: 3.0,
    },
  },
  {
    id: "falcon",
    name: "Falcon J-7",
    blurb: "A single-seat jet. Enormous thrust, a wing that needs speed, and gear you must raise.",
    spec: "Rotate 140 kt · Cruise 420 kt · 9.5 t",
    build: buildFalcon,
    eye: [0, 0.75, -2.4], chase: 26, gearHeight: 1.5, jet: true,
    air: {
      mass: 9500, wingArea: 28, maxThrust: 78000, vMax: 330,
      CL0: 0.14, CLa: 4.1, stallA: 0.33, CD0: 0.021, induced: 0.09,
      gearDrag: 0.02, flapLift: 0.3, flapDrag: 0.05,
      pitchPower: 3.4, rollPower: 8.0, yawPower: 1.4,
      pitchDamp: 4.0, rollDamp: 3.0, yawDamp: 2.0,
      pitchStab: 6.0, yawStab: 2.6,
    },
  },
  {
    id: "atlas",
    name: "Atlas 340",
    blurb: "A twin-engine airliner. Heavy, stately, and utterly unforgiving of a late flare.",
    spec: "Rotate 145 kt · Cruise 280 kt · 62 t",
    build: buildAtlas,
    eye: [0, 1.4, -12.5], chase: 62, gearHeight: 3.35, jet: true,
    air: {
      mass: 62000, wingArea: 122, maxThrust: 320000, vMax: 270,
      CL0: 0.34, CLa: 5.0, stallA: 0.27, CD0: 0.019, induced: 0.048,
      gearDrag: 0.018, flapLift: 0.8, flapDrag: 0.07,
      pitchPower: 1.3, rollPower: 2.0, yawPower: 0.7,
      pitchDamp: 3.2, rollDamp: 2.4, yawDamp: 1.8,
      pitchStab: 7.0, yawStab: 3.0,
    },
  },
];

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
    plane.pos.set(0, FIELD_ELEV + 760, current.jet ? 12000 : 6500);
    plane.quat.identity();
    plane.vel.set(0, 0, -(current.jet ? 120 : 52));
    plane.throttle = 0.75;
    plane.brakes = false;
    plane.onGround = false;
  } else {
    plane.pos.set(0, FIELD_ELEV + current.gearHeight, RUNWAY_LEN / 2 - 160);
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
  const gearHeight = plane.gearDown ? current.gearHeight : current.gearHeight * 0.5;
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
  if (k === "n") selectAircraft(AIRCRAFT.indexOf(current) + 1, !plane.onGround);
  if (k === "m") { const el = document.getElementById("hangar"); el.hidden = !el.hidden; document.getElementById("help").hidden = true; renderHangar(); }
  if (k === "l") applyTime(timeIndex + 1);
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
const water = buildSea();
buildAirfield();
scatterTrees();
buildClouds();

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

/* The hangar: pick an aircraft, see what you are letting yourself in for. */
const hangarEl = document.getElementById("hangar");
function renderHangar() {
  const list = document.getElementById("plane-list");
  list.innerHTML = "";
  AIRCRAFT.forEach((a, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `plane-card${a === current ? " on" : ""}`;
    card.innerHTML = "";
    const name = document.createElement("strong");
    name.textContent = a.name;
    const spec = document.createElement("span");
    spec.className = "plane-spec";
    spec.textContent = a.spec;
    const blurb = document.createElement("span");
    blurb.className = "plane-blurb";
    blurb.textContent = a.blurb;
    card.append(name, spec, blurb);
    card.addEventListener("click", () => {
      selectAircraft(i, !plane.onGround);
      hangarEl.hidden = true;
      renderHangar();
    });
    list.append(card);
  });
}
renderHangar();
document.getElementById("hangar-close").addEventListener("click", () => { hangarEl.hidden = true; });

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
  sun.position.copy(plane.pos).addScaledVector(sunDir, 1400);
  sun.target.updateMatrixWorld();

  // water and sky ride with the camera; the waves keep their own clock
  water.position.x = camera.position.x;
  water.position.z = camera.position.z;
  water.material.uniforms.uTime.value = now / 1000;
  water.material.uniforms.uFogColor.value.copy(scene.fog.color);
  for (const c of clouds) {
    c.group.position.x += c.drift * wall;
    if (c.group.position.x > WORLD * 0.85) c.group.position.x -= WORLD * 1.7;
  }
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
window.__sim = { plane, input, air, step, groundAt, resetPlane, heading, keys, CAMS, KT, FT, AIRCRAFT, selectAircraft, applyTime };
