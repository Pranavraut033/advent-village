// Checks for the advent-village site. Run from the repo root:  node tools/check.mjs
// Prints one line per check, PASS or FAIL, and exits 1 on any failure. Written by the orchestrator; do not edit.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const Y = path.join(root, '2026');
let fail = 0;
const ok = (name, cond, why = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !why ? '' : ' - ' + why}`); if (!cond) fail++; };
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

// files
for (const f of ['index.html', '.nojekyll', 'README.md', '2026/index.html', '2026/main.js', '2026/js/calendar.js', '2026/style.css'])
  ok(`file ${f}`, exists(f));

// root page sends visitors to this year's page
if (exists('index.html')) ok('root redirects to 2026/', /2026\//.test(read('index.html')) && /http-equiv=["']refresh["']|location\.replace/i.test(read('index.html')));

// pinned three.js, only allowed hosts
if (exists('2026/index.html')) {
  const html = read('2026/index.html');
  ok('importmap pins three@0.186.1', /"three"\s*:\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.186\.1\/build\/three\.module\.js"/.test(html));
  ok('importmap pins three/addons@0.186.1', /"three\/addons\/"\s*:\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.186\.1\/examples\/jsm\/"/.test(html));
  const hosts = [...(html + (exists('2026/main.js') ? read('2026/main.js') : '')).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  const bad = [...new Set(hosts)].filter((h) => !['cdn.jsdelivr.net', 'www.youtube.com', 'youtube.com', 'youtu.be', 'www.w3.org'].includes(h));
  ok('only allowed hosts (jsdelivr, youtube)', bad.length === 0, bad.join(', '));
  ok('page has a title', /<title>[^<]{3,}<\/title>/.test(html));
  ok('page has a viewport meta', /name=["']viewport["']/.test(html));
}

// scripts parse
for (const f of ['2026/main.js', '2026/js/calendar.js']) if (exists(f)) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); ok(`${f} parses`, true); }
  catch (e) { ok(`${f} parses`, false, String(e.stderr).split('\n')[0]); }
}

// data untouched, every model present
const sha = (p) => createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex').slice(0, 16);
ok('books.json unchanged', sha('2026/data/books.json') === '22105138e9a5bc32');
ok('days.json unchanged', sha('2026/data/days.json') === 'a817c361871061f5');
const days = JSON.parse(read('2026/data/days.json'));
const need = new Set([...days.days.filter((d) => d.model).map((d) => d.model), ...days.props.filter((p) => p.kind !== 'drift').map((p) => p.kind), 'tree', 'p-island']);
const missing = [...need].filter((m) => !exists(`2026/models/${m}.glb`));
ok(`all ${need.size} models present`, missing.length === 0, missing.join(', '));
if (exists('2026/main.js')) {
  const js = read('2026/main.js');
  ok('main.js uses DRACOLoader', /DRACOLoader/.test(js));
  ok('main.js uses OrbitControls', /OrbitControls/.test(js));
  ok('main.js reads days.json and books.json', /days\.json/.test(js) && /books\.json/.test(js));
}

// the calendar rule (pure module)
if (exists('2026/js/calendar.js')) {
  const mod = await import(path.join(Y, 'js', 'calendar.js'));
  const f = mod.openedDoors;
  ok('calendar.js exports openedDoors', typeof f === 'function');
  if (typeof f === 'function') {
    const cases = [
      ['2026-11-30T12:00:00', null, 0], ['2026-12-01T00:00:01', null, 1], ['2026-12-13T09:00:00', null, 13],
      ['2026-12-24T23:59:00', null, 24], ['2026-12-25T10:00:00', null, 24], ['2027-03-01T10:00:00', null, 24],
      ['2025-12-10T10:00:00', null, 0], ['2026-11-20T10:00:00', '7', 7], ['2026-12-20T10:00:00', '30', 24],
      ['2026-12-20T10:00:00', 'abc', 20], ['2026-12-20T10:00:00', '0', 0],
    ];
    for (const [d, q, want] of cases) {
      const got = f(new Date(d), q);
      ok(`openedDoors(${d}, ${q}) = ${want}`, got === want, `got ${got}`);
    }
  }
}
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
