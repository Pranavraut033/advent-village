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
const MONTH = 'December';

async function main() {
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;

  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => { $('bar').style.width = Math.round(100 * loaded / total) + '%'; };
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(draco);

  const getJson = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
  const [{ days, lanes, props: PROPS }, stats, booksData] = await Promise.all([getJson('data/days.json'), getJson('data/stats.json'), getJson('data/books.json')]);
  const books = new Map(booksData.books.map((b) => [b.day, b]));

  const opened = openedDoors(new Date(), new URLSearchParams(location.search).get('day'));
  $('count').textContent = `${opened} of 24 doors open`;

  const R = rng(7), scene = new THREE.Scene();
  scene.background = new THREE.Color('#050916');
  scene.fog = new THREE.FogExp2('#0a1024', 0.0095);
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion();

  // Blender stats are z-up: height = max.z - min.z; the snow patch top sits patch_top above min.z
  const groundOf = (slug, s) => -(stats[slug].min[2] + stats[slug].patch_top) * s;
  const load = async (slug) => (await loader.loadAsync(`models/${slug}.glb`)).scene;
  const shade = (o, cast = true) => o.traverse((c) => { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = true; } });

  // --- light: moonlit night
  scene.add(new THREE.HemisphereLight('#5d76b0', '#1a2036', 0.5));
  const key = new THREE.DirectionalLight('#bcd0ff', 1.35);
  key.position.set(-16, 26, 20); key.target.position.set(0, 0, 0); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 0.5, far: 90 });
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight('#8fa6c8', 0.12); fill.position.set(14, 6, 16); scene.add(fill);
  const rim = new THREE.DirectionalLight('#9fc0ff', 0.9); rim.position.set(8, 10, -22); scene.add(rim);

  // --- island: snow slab with a perturbed edge, the island model as the rock underneath
  const EDGE = (a) => 20.5 + 1.0 * Math.sin(3 * a + 0.5) + 0.6 * Math.sin(7 * a + 1.3) + 0.3 * Math.sin(13 * a);
  const shape = new THREE.Shape(), N = 160;
  for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, r = EDGE(a); shape[i ? 'lineTo' : 'moveTo'](Math.sin(a) * r, Math.cos(a) * r); }
  const snowMat = new THREE.MeshStandardMaterial({ color: '#eaf0fa', roughness: 0.93 });
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelSize: 0.35, bevelThickness: 0.3, bevelSegments: 5, curveSegments: 2 }), snowMat);
  slab.rotation.x = Math.PI / 2; slab.position.y = -0.3; slab.receiveShadow = true; scene.add(slab);   // bevel lifts the top 0.3: top face at y = 0
  const rock = await load('p-island'), is = stats['p-island'];
  rock.scale.set(43, 28, 43); rock.position.y = -(is.max[2]) * 26 - 0.5; shade(rock, false); scene.add(rock);

  // --- paths (trodden snow): the lanes and each door's path
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
  for (const p of lanes) strip(p, 1.2);
  for (const d of days) if (d.model) strip(d.door_path, 0.7);

  // --- houses
  const houses = [], houseMeshes = [];
  await Promise.all(days.map(async (d) => {
    if (!d.model) return;
    const o = await load(d.model), mats = [];
    o.traverse((c) => {
      if (!c.isMesh) return;
      c.material = c.material.clone();
      const mat = c.material;
      mat.emissive = new THREE.Color(mat.emissiveMap ? '#ffffff' : '#000000'); mat.emissiveIntensity = 0;
      mats.push(mat); c.userData.day = d.day; houseMeshes.push(c);
    });
    shade(o); o.scale.setScalar(d.scale); o.rotation.y = d.rot_y; o.position.set(d.pos[0], d.ground, d.pos[2]); scene.add(o);
    const belfry = d.extra_light === 'belfry';                 // a light inside the tower instead of a window map
    const light = new THREE.PointLight('#ffb36a', 0, belfry ? 3.5 : 5, 1.8); scene.add(light);
    if (belfry) light.position.set(d.pos[0], d.ground + d.height * 0.72 + 0.1, d.pos[2]);
    else light.position.set(d.pos[0] + Math.sin(d.cam_dir) * 1.9, 0.6, d.pos[2] + Math.cos(d.cam_dir) * 1.9);
    houses.push({ d, o, mats, light });
  }));

  // --- the tree (with its own fairy-light emissive map)
  const tree = await load('tree'); const TS = 4.4;
  tree.scale.setScalar(TS); tree.position.y = groundOf('tree', TS); shade(tree); scene.add(tree);
  tree.traverse((c) => { if (c.isMesh) { c.material.emissive = new THREE.Color('#ffffff'); c.material.emissiveIntensity = 2.2; } });
  const treeLight = new THREE.PointLight('#ffcf8a', 12, 18, 1.4); treeLight.position.set(0, 4.5, 0); scene.add(treeLight);

  // --- props: cloned meshes share geometry and textures
  const props = Object.fromEntries(await Promise.all(['p-lamp', 'p-pine', 'p-snowman', 'p-presents', 'p-fence'].map(async (p) => [p, await load(p)])));
  const put = (p, x, z, s, ry = 0) => { const o = props[p].clone(); o.scale.setScalar(s); o.rotation.y = ry; o.position.set(x, groundOf(p, s), z); shade(o); scene.add(o); return o; };
  const lamps = [];
  const driftG = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);   // a dome: a soft snow drift
  for (const q of PROPS) {
    if (q.kind === 'drift') {
      const m = new THREE.Mesh(driftG, snowMat); m.scale.set(q.scale, q.scale * 0.2, q.scale * 0.7); m.rotation.y = q.rot;
      m.position.set(q.pos[0], -0.02, q.pos[1]); m.receiveShadow = m.castShadow = true; scene.add(m); continue;
    }
    put(q.kind, q.pos[0], q.pos[1], q.scale, q.rot);
    if (q.kind === 'p-lamp') lamps.push(V(q.pos[0], 0.88 * q.scale, q.pos[1]));
  }
  const glowGeo = new THREE.SphereGeometry(0.08, 10, 8);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb45a').multiplyScalar(5), fog: false });
  for (const p of lamps) { const g = new THREE.Mesh(glowGeo, glowMat); g.position.copy(p); scene.add(g); }
  const lampLights = [0, 1, 2].map(() => { const l = new THREE.PointLight('#ffb45a', 2.4, 6, 1.6); scene.add(l); return l; });

  // --- stars and snowfall
  const stars = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 4, 4), new THREE.MeshBasicMaterial({ color: '#cfd8ff', fog: false }), 700);
  for (let i = 0; i < 700; i++) { const a = R() * 6.283, e = (R() - 0.3) * 1.5, s = 0.4 + R() * 1.5; stars.setMatrixAt(i, m4.compose(V(Math.cos(a) * Math.cos(e) * 160, Math.sin(e) * 160 - 10, Math.sin(a) * Math.cos(e) * 160), q0, V(s, s, s))); }
  scene.add(stars);
  const FL = 6000, flakes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 5, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), FL);
  const fd = Array.from({ length: FL }, () => [(R() - 0.5) * 34, R() * 22, (R() - 0.5) * 34, 0.7 + R() * 0.9, R() * 6.283]);
  flakes.frustumCulled = false; scene.add(flakes);
  const fp = V(0, 0, 0), fs = V(1, 1, 1);
  const snow = (cx, cz, t, cam) => {
    for (let i = 0; i < FL; i++) {
      const f = fd[i], y = ((f[1] - t * f[3] * 1.4) % 22 + 22) % 22 - 0.5;
      fp.set(cx + f[0] + Math.sin(t * 0.8 + f[4]) * 0.25, y, cz + f[2] + Math.cos(t * 0.6 + f[4]) * 0.25);
      const dist = fp.distanceTo(cam);                 // none at the lens; far away only a sparse sixth, so the overview stays clear
      fs.setScalar(dist < 1.5 ? 0 : dist < 18 ? 1 : (i % 6 === 0 ? 1 : 0));
      flakes.setMatrixAt(i, m4.compose(fp, q0, fs));
    }
    flakes.instanceMatrix.needsUpdate = true;
  };

  // --- the day's state: which doors are lit, which house gets a door light, which lamps get real light
  const setLights = (day, lampDay) => {
    for (const h of houses) {
      const lit = h.d.day <= opened ? 1 : 0;
      for (const m of h.mats) { m.emissiveIntensity = 2.0 * lit; m.color.setScalar(lit ? 1 : 0.78); }
      h.light.intensity = h.d.extra_light === 'belfry' ? 3.0 * lit : h.d.day === day && lit ? 1.1 * (h.d.extra_light ? 2.2 : 1) : 0;
    }
    const d = days[lampDay - 1], P = V(d.pos[0], 0, d.pos[2]);
    lamps.map((p) => [p.distanceTo(P), p]).sort((a, b) => a[0] - b[0]).slice(0, 3).forEach(([, p], i) => lampLights[i].position.copy(p).setY(p.y + 0.15));
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
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.5, 1.0));
  composer.addPass(new OutputPass());

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- the card
  const card = $('card'), back = $('back'), link = $('card-link'), hint = $('hint');
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
      link.hidden = true;
    }
    card.hidden = false;
  };
  const hideCard = () => { card.hidden = true; };

  // --- flying between views
  let flight = null, atHouse = false;
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
    const d = days[day - 1];
    hideCard(); hint.classList.add('gone'); back.hidden = false; atHouse = true;
    setLights(day <= opened ? day : opened, day);
    flyTo(V(...d.cam), V(d.pos[0], d.height * 0.42, d.pos[2]), () => showCard(day));
  };
  const goHome = () => {
    if (!atHouse) return;
    atHouse = false; hideCard(); back.hidden = true; hint.classList.remove('gone');
    setLights(opened, homeDay);
    flyTo(START_POS.clone(), START_TARGET.clone(), () => {});
  };
  back.addEventListener('click', goHome);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') goHome(); });

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
  const t0 = performance.now();
  const frame = (now) => {
    stepFlight(now);
    if (controls.enabled) controls.update();
    snow(controls.target.x, controls.target.z, (now - t0) / 1000, camera.position);
    composer.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  $('bar').style.width = '100%';
  $('loading').classList.add('done');
}

main().catch((err) => {
  const p = document.querySelector('#loading p');
  if (p) p.textContent = 'The village could not be loaded. Please reload the page.';
  console.error(err);
});
