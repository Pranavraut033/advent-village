// Advent Village 2026: the live, explorable page. Geometry and placement follow the offline render module
// (village.mjs); this file adds the orbit camera, tap-to-fly, the book card and the real-date lighting.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { openedDoors } from './js/calendar.js';

const $ = (id) => document.getElementById(id);
const rng = (s) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const START_POS = V(0, 40, 46), START_TARGET = V(0, 1, 0);
const FLY_SECONDS = 1.6;
const SPOT = 1.0, WINDOW_GLOW = 1.6, RING_R = 5.6;
const EXTRA_TREES = 110, LAMP_EVERY = 5.5;                       // firs added to fill empty snow; path length between new lamps
// models whose front door is not on their local +z side (seen by rendering each model from four sides): turn them so it is
const MODEL_TURN = { 'time-machine': -Math.PI / 2, 'goblins-sexton': Math.PI / 2 };                                         // firs added to fill empty snow
const AREA_W = 5, AREA_OPACITY = 0.07, TREE_POOL = 17;            // lit area: width along the paths, strength, the pool round the tree                              // opened house: brightness as if in full light / window glow
const MONTH = 'December';

async function main() {
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  let maxDpr = 1.5;                                   // ponytail: 1.5 caps the fill cost on retina; dropped to 1 below if frames are slow
  const dpr = () => Math.min(window.devicePixelRatio, maxDpr);
  renderer.setPixelRatio(dpr());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;              // the village never moves: draw the shadow map once (needsUpdate below)

  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => { $('bar').style.width = Math.round(100 * loaded / total) + '%'; };
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath('./vendor/three/examples/jsm/libs/draco/gltf/');   // self-hosted three@0.186.1 (npm), so no third-party host before consent
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(draco);

  const getJson = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
  const [{ days, props: PROPS }, stats, booksData] = await Promise.all([getJson('data/days.json'), getJson('data/stats.json'), getJson('data/books.json')]);
  const books = new Map(booksData.books.map((b) => [b.day, b]));

  // ?day=N previews (including 25/26 for the pop-ups) only work on a local copy, so visitors can't open doors early
  const local = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const dayParam = local ? new URLSearchParams(location.search).get('day') : null, now = new Date();
  const opened = openedDoors(now, dayParam);
  const christmas = dayParam === '25' || (!dayParam && now.getFullYear() === 2026 && now.getMonth() === 11 && now.getDate() === 25);
  const afterwards = (dayParam && +dayParam > 25) || (!dayParam && (now.getFullYear() > 2026 || (now.getFullYear() === 2026 && now.getMonth() === 11 && now.getDate() > 25)));
  const untilFirst = Math.ceil((new Date(2026, 11, 1) - new Date(new Date().toDateString())) / 864e5);   // whole days to 1 Dec 2026
  $('count').textContent = opened === 0 && untilFirst > 0
    ? (untilFirst === 1 ? 'The first door opens tomorrow' : `The first door opens in ${untilFirst} days`)
    : christmas ? 'Merry Christmas · all 24 doors open' : afterwards ? 'All 24 stories are open · see you next December' : `${opened} of 24 doors open`;

  const R = rng(7), scene = new THREE.Scene();
  scene.background = new THREE.Color('#050916');
  scene.fog = new THREE.FogExp2('#0a1024', 0.0095);
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion();

  // Blender stats are z-up: height = max.z - min.z; the snow patch top sits patch_top above min.z
  const groundOf = (slug, s) => -(stats[slug].min[2] + stats[slug].patch_top) * s;
  const load = async (slug) => (await loader.loadAsync(`models/${slug}.glb`)).scene;
  const shade = (o, cast = true) => o.traverse((c) => { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = true; } });

  // --- light: moonlit night, dim before the first door and brighter with every door opened
  const glow = 0.2 + 0.8 * opened / 24;
  scene.add(new THREE.HemisphereLight('#5d76b0', '#1a2036', 0.5 * glow));
  const key = new THREE.DirectionalLight('#bcd0ff', 1.35 * glow);
  key.position.set(-16, 26, 20); key.target.position.set(0, 0, 0); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 0.5, far: 90 });
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight('#8fa6c8', 0.12 * glow); fill.position.set(14, 6, 16); scene.add(fill);
  const rim = new THREE.DirectionalLight('#9fc0ff', 0.9 * glow); rim.position.set(8, 10, -22); scene.add(rim);

  // --- island: snow slab with a perturbed edge, the island model as the rock underneath
  const EDGE = (a) => 20.5 + 1.0 * Math.sin(3 * a + 0.5) + 0.6 * Math.sin(7 * a + 1.3) + 0.3 * Math.sin(13 * a);
  const shape = new THREE.Shape(), N = 160;
  for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, r = EDGE(a); shape[i ? 'lineTo' : 'moveTo'](Math.sin(a) * r, Math.cos(a) * r); }
  const snowMat = new THREE.MeshStandardMaterial({ color: '#eaf0fa', roughness: 0.93 });
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelSize: 0.35, bevelThickness: 0.3, bevelSegments: 5, curveSegments: 2 }), snowMat);
  slab.rotation.x = Math.PI / 2; slab.position.y = -0.3; slab.receiveShadow = true; scene.add(slab);   // bevel lifts the top 0.3: top face at y = 0
  const rock = await load('p-island'), is = stats['p-island'];
  rock.scale.set(43, 28, 43); rock.position.y = -(is.max[2]) * 26 - 0.5; shade(rock, false); scene.add(rock);

  // --- paths (trodden snow)
  const pathMat = new THREE.MeshStandardMaterial({ color: '#cdd6e8', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  const strip = (pts, w) => {                                   // flat ribbon along pts [[x,z],...]
    const pos = [], idx = [];
    pts.forEach(([x, z], i) => {
      const [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
      let dx = nx - px, dz = nz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      pos.push(x - dz * w / 2, 0.012, z + dx * w / 2, x + dz * w / 2, 0.012, z - dx * w / 2);
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((_, i) => idx[i - (i % 3) + 2 - (i % 3)])); g.computeVertexNormals(); }   // face up
    const m = new THREE.Mesh(g, pathMat); m.receiveShadow = true; scene.add(m);
  };
  // A ring round the tree, then each door joined to the nearest point of the network built so far (inner houses first),
  // so every path connects and outer houses branch off inner paths like trodden desire lines. Bezier curves leave the door
  // straight out and join the network at a slant. ponytail: greedy, O(houses x network); fine for 24 houses.
  const paths = [];                                              // [{ pts, w }]
  const ring = [];
  for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2, r = RING_R + 0.25 * Math.sin(3 * a + 1); ring.push([Math.sin(a) * r, Math.cos(a) * r]); }
  paths.push({ pts: ring, w: 1.3 });
  const net = [];                                                // candidate join points: [x, z, tx, tz] with the path's tangent
  const addNet = (pts, owner, step = 2) => pts.forEach(([x, z], i) => {
    if (i % step) return;
    const [ax, az] = pts[Math.max(0, i - 1)], [bx, bz] = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(bx - ax, bz - az) || 1;
    net.push([x, z, (bx - ax) / l, (bz - az) / l, owner]);
  });
  addNet(ring, 0);
  const bez = (p0, p1, p2, p3, n) => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
  // a house's front faces local +z turned by rot_y (the data's door_path does not follow it); the path starts square to that face
  const front = (d) => [Math.sin(d.rot_y), Math.cos(d.rot_y)];
  const half = (d) => Math.max(stats[d.model].max[0] - stats[d.model].min[0], stats[d.model].max[1] - stats[d.model].min[1]) * d.scale / 2;
  const doorOf = (d) => { const [fx, fz] = front(d), r = (stats[d.model].max[1] - stats[d.model].min[1]) * d.scale / 2 + 0.2; return [d.pos[0] + fx * r, d.pos[2] + fz * r]; };
  const plotW = (d) => half(d) + 0.6;                             // plot half-width (house-local square)
  const roomy = new Set(days.filter((d) => true                    // any house with room gets a fenced garden plot
    && days.every((o) => o === d || Math.hypot(o.pos[0] - d.pos[0], o.pos[2] - d.pos[2]) > plotW(d) * 1.42 + half(o) + 0.2)));
  const plotted = (d) => roomy.has(d);
  const keepOut = (d) => (plotted(d) ? plotW(d) * 1.3 : half(d) + 0.6); // other paths stay this far from a house centre
  const blocked = (pts, self) => pts.some(([x, z], i) => i > 1 && (Math.hypot(x, z) < RING_R - 0.6
    || days.some((d) => Math.hypot(d.pos[0] - x, d.pos[2] - z) < (d === self ? half(d) : keepOut(d)))));
  for (const d of [...days].sort((a, b) => Math.hypot(...doorOf(a)) - Math.hypot(...doorOf(b)))) {
    const D = doorOf(d), out = front(d);
    let best = null;
    for (const [x, z, tx, tz, owner] of net) {
      const L = Math.hypot(x - D[0], z - D[1]); if (L < 1) continue;
      let nx = -tz, nz = tx; if (nx * (D[0] - x) + nz * (D[1] - z) < 0) { nx = -nx; nz = -nz; }   // side of the path facing the door
      const ax = nx + (D[0] - x) / L, az = nz + (D[1] - z) / L, al = Math.hypot(ax, az) || 1;          // join at a slant, not head-on
      const lead = Math.max(1.6, L * 0.4);                       // leave the door straight out before turning
      const pts = bez(D, [D[0] + out[0] * lead, D[1] + out[1] * lead], [x + ax / al * L * 0.35, z + az / al * L * 0.35], [x, z], Math.ceil(L / 0.35));
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const score = len + (blocked(pts, d) ? 1000 : 0);
      if (!best || score < best.score) best = { score, pts, owner };
    }
    paths.push({ pts: best.pts, w: 0.85, day: d.day, parent: best.owner }); addNet(best.pts, paths.length - 1);
  }
  for (const p of paths) strip(p.pts, p.w);
  // keep a plot only if no other path crosses its square (with a margin) and it sits fully on the island
  for (const d of [...roomy]) {
    const W = plotW(d) + 0.25, c = Math.cos(d.rot_y), sn = Math.sin(d.rot_y);
    const local = (x, z) => { const dx = x - d.pos[0], dz = z - d.pos[2]; return [dx * c - dz * sn, dx * sn + dz * c]; };
    const crossed = paths.some((p) => p.day !== d.day && p.pts.some(([x, z]) => { const [lx, lz] = local(x, z); return Math.abs(lx) < W + p.w / 2 && Math.abs(lz) < W + p.w / 2; }));
    const off = [[-1, -1], [-1, 1], [1, -1], [1, 1]].some(([a, b]) => {
      const x = d.pos[0] + a * W * c + b * W * sn, z = d.pos[2] - a * W * sn + b * W * c;
      return Math.hypot(x, z) > EDGE(Math.atan2(x, z)) - 0.8;
    });
    if (crossed || off) roomy.delete(d);
  }
  const onPath = (x, z, r) => paths.some((p) => p.pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < r + p.w / 2));

  // --- houses
  const houses = [], houseMeshes = [];
  const poolTex = (() => {                                       // soft round pool of light: drawn once, shared by every opened house
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
  })();
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: '#ffe6bf', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  await Promise.all(days.map(async (d) => {
    if (!d.model) return;
    const o = await load(d.model), mats = [];
    o.traverse((c) => {
      if (!c.isMesh) return;
      c.material = c.material.clone();
      const mat = c.material;
      mat.emissive = new THREE.Color(mat.emissiveMap ? '#ffffff' : '#000000'); mat.emissiveIntensity = 0;   // the window map
      mats.push(mat); c.userData.day = d.day; houseMeshes.push(c);
    });
    shade(o); o.scale.setScalar(d.scale); o.rotation.y = d.rot_y + (MODEL_TURN[d.model] || 0); o.position.set(d.pos[0], d.ground, d.pos[2]); scene.add(o);
    const belfry = d.extra_light === 'belfry';                 // a light inside the tower instead of a window map
    const lightPos = belfry ? V(d.pos[0], d.ground + d.height * 0.72 + 0.1, d.pos[2])
      : V(d.pos[0] + Math.sin(d.cam_dir) * 1.9, 0.6, d.pos[2] + Math.cos(d.cam_dir) * 1.9);
    let light = null;                                           // only belfries own a light; door lights share one (every point light costs every pixel)
    if (belfry) { light = new THREE.PointLight('#ffb36a', 0, 3.5, 1.8); light.position.copy(lightPos); scene.add(light); }
    const pool = new THREE.Mesh(poolGeo, poolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(d.pos[0], 0.03, d.pos[2]);
    pool.scale.setScalar(Math.max(5.5, d.height * 3)); pool.visible = false; scene.add(pool);   // the spotlight's pool on the snow
    houses.push({ d, o, mats, light, lightPos, pool });
  }));

  const litArea = [[0, 0, TREE_POOL]];                           // [x, z, width] discs of the lit area (lamps inside it are on)
  // --- lit area: light spreads from the tree along the paths to every opened house (each branch plus the paths back to the ring),
  // as one continuous soft region; unopened parts of the village stay in the night
  {
    const lit = new Set();
    for (const [k, p] of paths.entries()) if (p.day && p.day <= opened) for (let q = k; q > 0 && !lit.has(q); q = paths[q].parent) lit.add(q);
    const pts = litArea;                                         // starts with the tree and the ring round it
    for (const k of lit) {
      let last = null;
      for (const [x, z] of paths[k].pts) if (!last || Math.hypot(x - last[0], z - last[1]) >= 1.2) { last = [x, z]; pts.push([x, z, AREA_W]); }
    }
    const areaMat = poolMat.clone(); areaMat.opacity = AREA_OPACITY;
    const area = new THREE.InstancedMesh(poolGeo, areaMat, pts.length), q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -Math.PI / 2);
    pts.forEach(([x, z, w], i) => area.setMatrixAt(i, m4.compose(V(x, 0.025, z), q, V(w, w, w))));
    scene.add(area);
  }

  // --- the tree (with its own fairy-light emissive map)
  const tree = await load('tree'); const TS = 4.4;
  tree.scale.setScalar(TS); tree.position.y = -stats.tree.min[2] * TS; shade(tree); scene.add(tree);   // stand on its base: sinking to the snow patch buried the presents
  const waiting = opened === 0;                                 // before the first door: the tree carries the village
  tree.traverse((c) => { if (c.isMesh) { c.material.emissive = new THREE.Color('#ffffff'); c.material.emissiveIntensity = waiting ? 3.6 : 2.2; } });
  const treeLight = new THREE.PointLight('#ffcf8a', waiting ? 24 : 12, waiting ? 24 : 18, 1.4); treeLight.position.set(0, 4.5, 0); scene.add(treeLight);

  // --- props: cloned meshes share geometry and textures
  const props = Object.fromEntries(await Promise.all(['p-lamp', 'p-pine', 'p-snowman', 'p-presents', 'p-fence'].map(async (p) => [p, await load(p)])));
  const put = (p, x, z, s, ry = 0) => { const o = props[p].clone(); o.scale.setScalar(s); o.rotation.y = ry; o.position.set(x, groundOf(p, s), z); shade(o); scene.add(o); return o; };
  const lamps = [];
  const driftG = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);   // a dome: a soft snow drift
  const taken = [];                                              // [x, z, r] of everything standing on the snow, for the tree fill
  for (const d of days) taken.push([d.pos[0], d.pos[2], plotted(d) ? plotW(d) * 1.3 : half(d) + 0.5]);
  const inPlot = (x, z, r) => days.some((d) => plotted(d) && Math.hypot(d.pos[0] - x, d.pos[2] - z) < plotW(d) * 1.3 + r);
  for (const q of PROPS) {
    if (q.kind !== 'drift' && inPlot(q.pos[0], q.pos[1], 0.2)) continue;
    if (onPath(q.pos[0], q.pos[1], q.kind === 'drift' ? q.scale * 0.8 : q.kind === 'p-lamp' ? 0.25 : q.kind === 'p-pine' ? 0.35 * q.scale : 0.6)) continue;   // keep paths clear
    if (q.kind === 'drift') {
      const m = new THREE.Mesh(driftG, snowMat); m.scale.set(q.scale, q.scale * 0.2, q.scale * 0.7); m.rotation.y = q.rot;
      m.position.set(q.pos[0], -0.02, q.pos[1]); m.receiveShadow = m.castShadow = true; scene.add(m); continue;
    }
    put(q.kind, q.pos[0], q.pos[1], q.scale, q.rot); taken.push([q.pos[0], q.pos[1], q.kind === 'p-pine' ? 0.4 * q.scale : 0.6]);
    if (q.kind === 'p-lamp') lamps.push(V(q.pos[0], 0.88 * q.scale, q.pos[1]));
  }
  // lamp posts along the paths: every LAMP_EVERY units of path, beside it on alternating sides, where there is room
  {
    let side = 1;
    for (const p of paths) {
      let run = LAMP_EVERY * 0.5;
      for (let i = 1; i < p.pts.length - 1; i++) {
        const [x0, z0] = p.pts[i - 1], [x, z] = p.pts[i], [x1, z1] = p.pts[i + 1];
        run += Math.hypot(x - x0, z - z0); if (run < LAMP_EVERY) continue;
        const tl = Math.hypot(x1 - x0, z1 - z0) || 1, off = p.w / 2 + 0.45;
        const lx = x + (-(z1 - z0) / tl) * off * side, lz = z + ((x1 - x0) / tl) * off * side;
        if (onPath(lx, lz, 0.15) || inPlot(lx, lz, 0.3) || lamps.some((l) => Math.hypot(l.x - lx, l.z - lz) < 3.5)
          || taken.some(([tx, tz, tr]) => Math.hypot(tx - lx, tz - lz) < tr + 0.3)) continue;
        put('p-lamp', lx, lz, 1.1, 0); lamps.push(V(lx, 0.88 * 1.1, lz)); taken.push([lx, lz, 0.4]); run = 0; side = -side;
      }
    }
  }

  // garden plots: a fence on three sides and the front (gap for the path), two small firs at the back corners
  for (const d of days.filter(plotted)) {
    const W = plotW(d), c = Math.cos(d.rot_y), sn = Math.sin(d.rot_y);
    const at = (lx, lz) => [d.pos[0] + lx * c + lz * sn, d.pos[2] - lx * sn + lz * c];   // house-local (x right, z front) -> world
    const n = Math.round(2 * W), seg = 2 * W / n;
    for (let i = 0; i < n; i++) {
      const t = -W + seg * (i + 0.5);
      put('p-fence', ...at(t, -W), seg, d.rot_y);                       // back
      put('p-fence', ...at(-W, t), seg, d.rot_y + Math.PI / 2);         // left
      put('p-fence', ...at(W, t), seg, d.rot_y + Math.PI / 2);          // right
      if (Math.abs(t) > 0.9) put('p-fence', ...at(t, W), seg, d.rot_y);  // front, open where the path leaves
    }
    for (const sx of [-1, 1]) { const [fx, fz] = at(sx * (W - 0.3), -(W - 0.3)); put('p-pine', fx, fz, 0.4, R() * 6.28); taken.push([fx, fz, 0.25]); }
  }

  // fill the empty snow with firs: random spots clear of paths, houses, plots, the tree plaza and the island edge
  {
    const r2 = rng(11);
    let added = 0;
    for (let tries = 0; tries < 4000 && added < EXTRA_TREES; tries++) {
      const a = r2() * Math.PI * 2, rr = Math.sqrt(r2()) * 20, x = Math.sin(a) * rr, z = Math.cos(a) * rr, sc = 0.8 + r2() * 1.3;
      if (rr > EDGE(a) - 1.6 || rr < RING_R + 3.5 || onPath(x, z, 0.5 + 0.3 * sc)) continue;
      if (taken.some(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) < tr + 0.45 * sc + 0.3)) continue;
      put('p-pine', x, z, sc, r2() * 6.28); taken.push([x, z, 0.4 * sc]); added++;
    }
  }

  // camera for each house: the authored view, swung round the house in growing steps until no tree, lamp or house stands between
  const camOf = new Map();
  for (const d of days) {
    const T = [d.pos[0], d.pos[2]], ox = d.cam[0] - T[0], oz = d.cam[2] - T[1];
    const clear = ([cx, cz]) => taken.every(([tx, tz, tr]) => {
      if (Math.hypot(tx - T[0], tz - T[1]) < 0.01) return true;                       // the house itself
      const vx = T[0] - cx, vz = T[1] - cz, u = Math.max(0, Math.min(1, ((tx - cx) * vx + (tz - cz) * vz) / (vx * vx + vz * vz)));
      return Math.hypot(cx + vx * u - tx, cz + vz * u - tz) > tr + 0.35;
    });
    let cam = d.cam;
    for (const a of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.3, -1.3]) {
      const c = Math.cos(a), sn = Math.sin(a), x = T[0] + ox * c + oz * sn, z = T[1] - ox * sn + oz * c;
      if (clear([x, z])) { cam = [x, d.cam[1], z]; break; }
    }
    camOf.set(d.day, cam);
  }

  const glowGeo = new THREE.SphereGeometry(0.08, 10, 8);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb45a').multiplyScalar(5), fog: false });
  // only lamps inside the lit area burn; the rest stand dark in the night
  const onLamps = lamps.filter((p) => litArea.some(([x, z, w]) => Math.hypot(p.x - x, p.z - z) < w * 0.42)
    || houses.some((h) => h.d.day <= opened && Math.hypot(p.x - h.d.pos[0], p.z - h.d.pos[2]) < h.pool.scale.x * 0.45));
  for (const p of onLamps) { const g = new THREE.Mesh(glowGeo, glowMat); g.position.copy(p); scene.add(g); }
  const lampLights = [0, 1, 2].map(() => { const l = new THREE.PointLight('#ffb45a', 2.4, 6, 1.6); scene.add(l); return l; });

  // --- stars and snowfall
  const stars = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 4, 4), new THREE.MeshBasicMaterial({ color: '#cfd8ff', fog: false }), 700);
  for (let i = 0; i < 700; i++) { const a = R() * 6.283, e = (R() - 0.3) * 1.5, s = 0.4 + R() * 1.5; stars.setMatrixAt(i, m4.compose(V(Math.cos(a) * Math.cos(e) * 160, Math.sin(e) * 160 - 10, Math.sin(a) * Math.cos(e) * 160), q0, V(s, s, s))); }
  scene.add(stars);
  const FL = 6000, flakes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 5, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), FL);
  const fd = Array.from({ length: FL }, () => [(R() - 0.5) * 34, R() * 22, (R() - 0.5) * 34, 0.7 + R() * 0.9, R() * 6.283]);
  flakes.frustumCulled = false; scene.add(flakes);
  const fm = flakes.instanceMatrix.array;              // write scale + position straight into the matrices: no compose() per flake
  const snow = (cx, cz, t, cam) => {
    for (let i = 0, o = 0; i < FL; i++, o += 16) {
      const f = fd[i], y = ((f[1] - t * f[3] * 1.4) % 22 + 22) % 22 - 0.5;
      const x = cx + f[0] + Math.sin(t * 0.8 + f[4]) * 0.25, z = cz + f[2] + Math.cos(t * 0.6 + f[4]) * 0.25;
      const d2 = (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2;   // none at the lens; far away only a sparse sixth, so the overview stays clear
      const s = d2 < 2.25 ? 0 : d2 < 324 ? 1 : (i % 6 === 0 ? 1 : 0);
      fm[o] = fm[o + 5] = fm[o + 10] = s; fm[o + 12] = x; fm[o + 13] = y; fm[o + 14] = z;
    }
    flakes.instanceMatrix.needsUpdate = true;
  };

  // --- the day's state: which doors are lit, which house gets a door light, which lamps get real light
  const doorLight = new THREE.PointLight('#ffb36a', 0, 5, 1.8); scene.add(doorLight);
  const setLights = (day, lampDay) => {
    doorLight.intensity = 0;
    for (const h of houses) {
      const lit = h.d.day <= opened ? 1 : 0;
      // opened: lit as if by a spotlight (the night dimming undone for this house, so it keeps its real shading), windows at a normal glow
      for (const m of h.mats) { m.emissiveIntensity = WINDOW_GLOW * lit; m.color.setScalar(lit ? Math.min(SPOT / glow, 4) : 1); }
      if (h.pool) h.pool.visible = !!lit;
      if (h.light) h.light.intensity = 3.0 * lit;
      else if (h.d.day === day && lit) { doorLight.position.copy(h.lightPos); doorLight.intensity = 1.1 * (h.d.extra_light ? 2.2 : 1); }
    }
    const d = days[lampDay - 1], P = V(d.pos[0], 0, d.pos[2]);
    lampLights.forEach((l) => { l.intensity = 0; });
    onLamps.map((p) => [p.distanceTo(P), p]).sort((a, b) => a[0] - b[0]).slice(0, 3).forEach(([, p], i) => { lampLights[i].position.copy(p).setY(p.y + 0.15); lampLights[i].intensity = 2.4; });
  };
  const homeDay = Math.max(1, opened);
  setLights(opened, homeDay);

  // --- camera, controls, post
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.copy(START_POS);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(START_TARGET);
  Object.assign(controls, { enableDamping: true, minDistance: 6, maxDistance: 75, maxPolarAngle: 1.38, enablePan: false });
  controls.update();

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr());
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.5, 1.0));
  composer.addPass(new OutputPass());

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr());
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setPixelRatio(dpr());
    composer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);

  // --- the card
  const card = $('card'), back = $('back'), link = $('card-link'), hint = $('hint'), credit = $('credit');
  const subscribeUrl = booksData.channel.url + '?sub_confirmation=1';
  const showCard = (day) => {
    const b = books.get(day);
    if (day <= opened && b) {
      $('card-day').textContent = `Day ${day}`;
      $('card-title').textContent = b.title;
      $('card-author').textContent = `${b.author} · ${b.year}`;
      $('card-length').textContent = `Reading time: ${b.length}`;
      link.hidden = false;
      link.href = b.video ? `https://www.youtube.com/watch?v=${encodeURIComponent(b.video)}` : booksData.channel.url;
      link.textContent = b.video ? 'Listen on YouTube' : 'Listen on Cover to Cover';
    } else {
      $('card-day').textContent = `Door ${day}`;
      $('card-title').textContent = `Opens on ${day} ${MONTH}`;
      $('card-author').textContent = '';
      $('card-length').textContent = '';
      link.hidden = false;
      link.href = subscribeUrl;
      link.textContent = 'Subscribe so you don’t miss it';
    }
    $('prev').hidden = day === 1; $('next').hidden = day === 24;
    card.hidden = false;
  };
  const hideCard = () => { card.hidden = true; };

  // --- the channel credit: once per visit, 25 s in or after the first card closes, never over a card or the cookie banner
  const CREDIT_KEY = 'advent-village-credit';
  const creditSeen = () => { try { return sessionStorage.getItem(CREDIT_KEY); } catch { return null; } };
  const showCredit = () => {
    if (creditSeen() || !credit.hidden) return;
    if (atHouse || flight || !$('consent').hidden || !$('xmas').hidden) { setTimeout(showCredit, 8000); return; }
    credit.hidden = false; hint.classList.add('gone');
    try { sessionStorage.setItem(CREDIT_KEY, '1'); } catch {}
  };
  const hideCredit = () => { credit.hidden = true; if (!atHouse) hint.classList.remove('gone'); };
  $('credit-close').addEventListener('click', hideCredit);
  setTimeout(showCredit, 25000);

  // --- flying between views
  let flight = null, atHouse = false, atDay = 0;
  const ease = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * u * (u * (u * 6 - 15) + 10); };
  const flyTo = (pos, target, done) => {
    flight = { t0: performance.now(), from: camera.position.clone(), fromT: controls.target.clone(), pos, target, done };
    controls.enabled = false;
  };
  const stepFlight = (now) => {
    if (!flight) return;
    const u = Math.min(1, (now - flight.t0) / (FLY_SECONDS * 1000)), e = ease(u);
    camera.position.lerpVectors(flight.from, flight.pos, e);
    controls.target.lerpVectors(flight.fromT, flight.target, e);
    camera.lookAt(controls.target);
    if (u >= 1) { const f = flight; flight = null; controls.enabled = true; controls.update(); f.done(); }
  };

  const goHouse = (day) => {
    const d = days[day - 1]; atDay = day;
    hideCard(); credit.hidden = true; hint.classList.add('gone'); back.hidden = false; atHouse = true;
    setLights(day <= opened ? day : opened, day);
    flyTo(V(...camOf.get(day)), V(d.pos[0], d.height * 0.42, d.pos[2]), () => showCard(day));
  };
  const goHome = () => {
    if (!atHouse) return;
    atHouse = false; hideCard(); back.hidden = true; hint.classList.remove('gone');
    setLights(opened, homeDay);
    flyTo(START_POS.clone(), START_TARGET.clone(), showCredit);
  };
  $('prev').addEventListener('click', () => goHouse(atDay - 1));
  $('next').addEventListener('click', () => goHouse(atDay + 1));
  back.addEventListener('click', goHome);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') goHome();
    if (atHouse && !flight && e.key === 'ArrowLeft' && atDay > 1) goHouse(atDay - 1);
    if (atHouse && !flight && e.key === 'ArrowRight' && atDay < 24) goHouse(atDay + 1);
  });

  // --- tap: a pointerup that did not travel more than 6 px
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
    down = null;
    if (flight) return;
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(houseMeshes, false)[0];
    if (hit) goHouse(hit.object.userData.day);
  });

  // --- go
  renderer.shadowMap.needsUpdate = true;
  const t0 = performance.now();
  let slow = 0, prev = t0;
  const frame = (now) => {
    if (maxDpr > 1 && now - t0 > 1500) {               // after warm-up: 30 frames in a row over 30 ms -> render at 1x
      slow = now - prev > 30 ? slow + 1 : 0;
      if (slow > 30) { maxDpr = 1; resize(); }
    }
    prev = now;
    stepFlight(now);
    if (controls.enabled) controls.update();
    snow(controls.target.x, controls.target.z, (now - t0) / 1000, camera.position);
    composer.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  $('bar').style.width = '100%';
  $('loading').classList.add('done');
  if (christmas || afterwards) setTimeout(() => celebrate(afterwards, booksData), 900);
}

// --- Christmas Day: a full-screen thank-you page with confetti; after Christmas the same page, calm, saying see you next year
function celebrate(afterwards, booksData) {
  const page = $('xmas'), list = $('xmas-list');
  for (const b of booksData.books) {                              // every story, linked to its reading (or the channel until it is up)
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = b.video ? `https://www.youtube.com/watch?v=${encodeURIComponent(b.video)}` : booksData.channel.url;
    a.target = '_blank'; a.rel = 'noopener'; a.textContent = b.title;
    const by = document.createElement('span'); by.textContent = ` · ${b.author}`;
    li.append(a, by); list.append(li);
  }
  if (afterwards) {
    page.classList.add('calm');
    page.querySelector('.kicker').textContent = 'Advent 2026';
    $('xmas-text').textContent = 'All 24 stories are still open whenever you want a quiet listen. I’d love for you to join me again next year.';
    page.querySelector('.button').textContent = 'Subscribe for next year';
    page.querySelector('.button').href = booksData.channel.url + '?sub_confirmation=1';
  }
  const title = $('xmas-title');                                  // letters rise one by one
  const lines = afterwards ? ['See you', 'next December'] : ['Merry', 'Christmas!'];
  title.setAttribute('aria-label', lines.join(' '));
  let n = 0;
  title.replaceChildren(...lines.map((w) => {                       // two lines, letters rise one by one
    const word = document.createElement('span'); word.className = 'word'; word.setAttribute('aria-hidden', 'true');
    word.append(...[...w].map((ch) => { const sp = document.createElement('span'); sp.textContent = ch; sp.style.animationDelay = `${0.4 + n++ * 0.05}s`; return sp; }));
    return word;
  }));
  page.hidden = false;
  let running = !afterwards && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const close = () => { page.hidden = true; running = false; };
  for (const id of ['xmas-close', 'xmas-x']) $(id).addEventListener('click', close);
  page.addEventListener('click', (e) => { if (e.target === page) close(); });   // click outside the panel
  if (!running) return;
  const cv = $('confetti'), g = cv.getContext('2d');                // lives in the scene, between the 3D village and the title
  const fit = () => { cv.width = cv.clientWidth; cv.height = cv.clientHeight; }; fit(); new ResizeObserver(fit).observe(cv);
  const cols = ['#f2c46d', '#ffe2a3', '#e8574d', '#5fb37a', '#ffffff', '#7fa8ff'];
  const spawn = (b = {}) => Object.assign(b, { x: Math.random() * cv.width, y: -20 - Math.random() * cv.height, vx: (Math.random() - 0.5) * 2, vy: 1.5 + Math.random() * 2.5,
    r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 7, h: 3 + Math.random() * 4, c: cols[(Math.random() * cols.length) | 0] });
  const bits = Array.from({ length: 220 }, () => spawn());
  const tick = (t) => {
    g.clearRect(0, 0, cv.width, cv.height);
    if (!running) return;
    for (const b of bits) {
      b.x += b.vx + Math.sin((t + b.r * 500) / 400); b.y += b.vy; b.r += b.vr;
      if (b.y > cv.height + 20) spawn(b).y = -20;                 // recycle: it keeps snowing confetti while the page is open
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); g.restore();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

main().catch((err) => {
  const p = $('loading-msg');
  if (p) p.textContent = 'The village could not be loaded. Please reload the page.';
  console.error(err);
});
