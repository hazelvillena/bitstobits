import './ui/base.css';
import { Atelier } from './render/atelier';
import { Sculptor, type ToolKind } from './sculpt/sculptor';
import { PointerInput } from './input/pointer';
import { fillLump, sculptRandom } from './sculpt/seed';
import { Volume } from './sculpt/volume';
import { Chrome } from './ui/chrome';
import { HandOverlay } from './ui/handOverlay';
import { HandTracker } from './input/handTracker';
import { HandInput } from './input/handInput';
import { Calibration } from './input/calibration';
import { Field } from './field/field';
import { createSpecimen, loadSpecimens, saveSpecimens, type Specimen } from './specimen/specimen';
import { TRAITS } from './specimen/signature';
import { traitHex, traitLabel } from './ui/tokens';
import { initDivider } from './ui/divider';
import { MATERIALS, type MaterialKind } from './render/materials';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Layout: side by side by default; ?layout=rows stacks them for a portrait screen.
if (new URLSearchParams(location.search).get('layout') === 'rows') $('stage').classList.add('rows');

initDivider($('stage'), $('seam'));

const atelierEl = $('atelier');
const atelier = new Atelier($<HTMLCanvasElement>('atelier-canvas'));
const sculptor = new Sculptor(atelier);
const chrome = new Chrome();
const pointer = new PointerInput(atelierEl, atelier, sculptor);
const overlay = new HandOverlay($<HTMLCanvasElement>('hand-canvas'));
const tracker = new HandTracker($<HTMLVideoElement>('camera'));
const hands = new HandInput(tracker, atelier, sculptor, overlay.map);
const calibration = new Calibration(tracker);
const field = new Field($<HTMLCanvasElement>('field-canvas'), $('field-labels'));

let specimens: Specimen[] = [];
let mode: 'intro' | 'calibrate' | 'sculpt' = 'intro';
let input: 'hands' | 'pointer' = 'pointer';
let accepting = false;

fillLump(atelier.volume, (Date.now() % 100000) + 1);

// ───── Material ─────
const matNav = $('materials');
function setMaterial(kind: MaterialKind) {
  atelier.setMaterial(kind);
  for (const b of matNav.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
  try {
    localStorage.setItem('b2b.material', kind);
  } catch { /* ignore */ }
}
for (const m of MATERIALS) {
  const b = document.createElement('button');
  b.textContent = m.name;
  b.dataset.kind = m.kind;
  b.addEventListener('click', () => setMaterial(m.kind));
  matNav.appendChild(b);
}
let savedMaterial: MaterialKind = 'pearl';
try {
  savedMaterial = (localStorage.getItem('b2b.material') as MaterialKind) || 'pearl';
} catch { /* ignore */ }
setMaterial(MATERIALS.some((m) => m.kind === savedMaterial) ? savedMaterial : 'pearl');

// ───── Intro ─────
function begin(kind: 'hands' | 'pointer') {
  $('intro').classList.add('gone');
  input = kind;
  chrome.setInputMode(kind);
  if (kind === 'pointer') {
    pointer.enabled = true;
    mode = 'sculpt';
    chrome.setActive(pointer.tool);
  }
}

$('btn-pointer').addEventListener('click', () => begin('pointer'));
$('btn-calibrate').addEventListener('click', async () => {
  begin('hands');
  const status = $('status');
  status.hidden = false;
  tracker.onStatus = (s) => {
    status.textContent = s;
    status.hidden = !s;
  };
  try {
    await tracker.start();
    overlay.resize(tracker.cal.aspect);
    mode = 'calibrate';
    calibration.start();
  } catch (err) {
    console.error(err);
    status.textContent = 'Camera unavailable. Using the mouse instead.';
    setTimeout(() => (status.hidden = true), 2600);
    begin('pointer');
  }
});

calibration.onDone = () => {
  mode = 'sculpt';
  hands.enabled = true;
  pointer.setTool('extrude');
};
// Hands act with whichever tool is selected; they never pick it themselves.
hands.tool = () => pointer.tool;

pointer.onToolChange = (t) => chrome.setActive(t);
chrome.onToolClick((t) => pointer.setTool(t));
chrome.onBrush = (dir) => sculptor.setBrush(dir > 0 ? sculptor.brush / 0.85 : sculptor.brush * 0.85);

const KEYS: Record<string, ToolKind> = { '1': 'extrude', '2': 'drill', '3': 'smooth', '4': 'turn' };
window.addEventListener('keydown', (e) => {
  if (KEYS[e.key] && mode === 'sculpt') pointer.setTool(KEYS[e.key]);
  if (e.key === 'Enter' && mode === 'sculpt') accept();
  if (e.key === 'm' || e.key === 'M') {
    const i = MATERIALS.findIndex((m) => m.kind === atelier.material);
    setMaterial(MATERIALS[(i + 1) % MATERIALS.length].kind);
  }
  if (e.key === '[') sculptor.setBrush(sculptor.brush * 0.85);
  if (e.key === ']') sculptor.setBrush(sculptor.brush / 0.85);
  if ((e.key === 'n' || e.key === 'N') && mode === 'sculpt') startOver();
  if ((e.key === 'c' || e.key === 'C') && input === 'hands' && mode === 'sculpt') {
    hands.enabled = false;
    mode = 'calibrate';
    calibration.start();
  }
});

// ───── Keep / start over ─────
function startOver() {
  fillLump(atelier.volume, (Date.now() % 100000) + 1);
  atelier.growIn();
}
$('btn-reset').addEventListener('click', startOver);
$('btn-accept').addEventListener('click', () => accept());

async function accept() {
  if (accepting) return;
  accepting = true;
  const spec = createSpecimen(atelier.volume, specimens.length + 1, atelier.material);
  await atelier.dissolveOut();
  specimens.push(spec);
  field.add(spec, true);
  updateCount();
  saveSpecimens(specimens);
  chrome.setSpecimenNumber(specimens.length + 1);
  startOver();
  setTimeout(() => (accepting = false), 900);
}

// ───── Collection ─────
function updateCount() {
  const n = specimens.length;
  $('field-count').textContent = n === 0 ? 'Empty' : n === 1 ? '1 form' : `${n} forms`;
  $('field-empty').classList.toggle('gone', n > 0);
}

$('btn-seed').addEventListener('click', () => {
  const tmp = new Volume(128);
  let left = 6;
  const one = () => {
    sculptRandom(tmp, Math.floor(Math.random() * 1e6));
    const spec = createSpecimen(tmp, specimens.length + 1, MATERIALS[Math.floor(Math.random() * 3)].kind);
    specimens.push(spec);
    field.add(spec, true);
    updateCount();
    chrome.setSpecimenNumber(specimens.length + 1);
    if (--left > 0) setTimeout(one, 260);
    else saveSpecimens(specimens);
  };
  one();
});
$('btn-clear').addEventListener('click', () => {
  specimens = [];
  field.clear();
  updateCount();
  saveSpecimens(specimens);
  chrome.setSpecimenNumber(1);
});

const inspector = $('inspector');
field.onHover = (spec, kin) => {
  if (!spec) {
    inspector.hidden = true;
    return;
  }
  const bars = TRAITS.map((t) => {
    const v = spec.sig[t];
    const shown = t === 'genus' ? String(spec.raw.holes) : v.toFixed(2).replace(/^0/, '');
    return `<div class="bar"><span>${traitLabel[t]}</span><span class="track"><span style="width:${(v * 100).toFixed(1)}%;background:${traitHex[t]}"></span></span><span class="v">${shown}</span></div>`;
  }).join('');
  const kinHtml = kin.length
    ? kin.map((k) => `<div><span><b>${k.spec.name}</b> by ${traitLabel[k.trait].toLowerCase()}</span><span class="num">${Math.round(k.k * 100)}%</span></div>`).join('')
    : `<div><span>No relatives yet</span></div>`;
  inspector.innerHTML = `<div><h3>${spec.name}</h3></div><div class="sub">Form ${spec.no}</div><div class="bars">${bars}</div><div class="kin">${kinHtml}</div>`;
  inspector.hidden = false;
};

loadSpecimens().then((list) => {
  specimens = list;
  for (const s of list) field.add(s, false);
  updateCount();
  chrome.setSpecimenNumber(specimens.length + 1);
});

// ───── Loop ─────
const ro = new ResizeObserver(() => {
  atelier.resize();
  field.resize();
  overlay.resize(tracker.cal.aspect);
});
ro.observe(atelierEl);
ro.observe($('field'));

let last = performance.now();
let slow = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  let tips = pointer.update(dt);
  if (input === 'hands' && tracker.ready) {
    if (mode === 'calibrate') {
      calibration.update(dt);
      overlay.draw(tracker.hands, 'calibrate', dt, tracker.cal.mmPerUnit);
    } else {
      tips = tips.concat(hands.update(dt).tips);
      overlay.draw(tracker.hands, 'sculpt', dt, tracker.cal.mmPerUnit, hands.activity);
    }
  }
  atelier.brush = sculptor.brush;
  chrome.setBrush(sculptor.brush);
  atelier.setTips(tips);
  atelier.update(dt);
  atelier.render();
  field.update(dt);
  field.render();

  // Adaptive resolution: protect the frame rate first.
  slow = slow * 0.95 + (dt > 1 / 45 ? 1 : 0) * 0.05;
  if (slow > 0.5) {
    atelier.setPixelRatio(Math.max(0.75, atelier.currentPixelRatio - 0.25));
    slow = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateCount();

// Dev-only hook: lets tests drive the hand pipeline with synthetic landmarks.
if (import.meta.env.DEV) {
  Object.assign(window, {
    b2b: {
      tracker, hands, atelier, overlay, pointer,
      useHands() {
        $('intro').classList.add('gone');
        input = 'hands';
        mode = 'sculpt';
        tracker.ready = true;
        hands.enabled = true;
        overlay.resize(tracker.cal.aspect);
        chrome.setInputMode('hands');
      },
    },
  });
}
