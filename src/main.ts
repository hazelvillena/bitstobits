import './ui/base.css';
import { Atelier } from './render/atelier';
import { Sculptor, type ToolKind } from './sculpt/sculptor';
import { PointerInput } from './input/pointer';
import { ARCHETYPES, fillLump, sculptSample, type Archetype } from './sculpt/seed';
import { Volume } from './sculpt/volume';
import { Chrome } from './ui/chrome';
import { HandOverlay } from './ui/handOverlay';
import { HandTracker } from './input/handTracker';
import { HandInput } from './input/handInput';
import { Calibration } from './input/calibration';
import { Field } from './field/field';
import { codeOf, createSpecimen, loadSpecimens, saveSpecimens, type Specimen } from './specimen/specimen';
import { traitLabel } from './ui/tokens';
import { radarSVG } from './ui/radar';
import { Thumbnailer } from './field/thumbs';
import { Tour } from './ui/tour';
import { initDivider } from './ui/divider';
import { DEFAULT_MATERIAL, MATERIALS, preset, swatch } from './render/materials';
import { Dropdown } from './ui/dropdown';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Layout: side by side by default; ?layout=rows stacks them for a portrait screen.
if (new URLSearchParams(location.search).get('layout') === 'rows') $('stage').classList.add('rows');

initDivider($('stage'), $('seam'));

const atelierEl = $('atelier');
const atelier = new Atelier($<HTMLCanvasElement>('atelier-canvas'));
const sculptor = new Sculptor(atelier);
const chrome = new Chrome();
// Listen on the canvas only, so pointer capture never swallows clicks on the UI above it.
const pointer = new PointerInput($<HTMLCanvasElement>('atelier-canvas'), atelier, sculptor);
const overlay = new HandOverlay($<HTMLCanvasElement>('hand-canvas'));
const tracker = new HandTracker($<HTMLVideoElement>('camera'));
const hands = new HandInput(tracker, atelier, sculptor, overlay.map);
const calibration = new Calibration(tracker);
const field = new Field($<HTMLCanvasElement>('field-canvas'), $('field-labels'));

// A short tour of the essentials after choosing how to sculpt.
const tour = new Tour([
  {
    target: () => document.querySelector('.tool-group'),
    title: 'Tools',
    text: 'Pick one here or press 1 to 5. Extrude, Spike and Press shape a face; Pierce bores through; Rotate turns the form.',
  },
  {
    target: () => document.querySelector('.size-group'),
    title: 'Brush size',
    text: 'Type a number, or use minus and plus. The outline on the form shows exactly what you will touch.',
  },
  {
    target: () => $('btn-accept'),
    title: 'When you are done',
    text: 'Keep the form. It joins the collection and connects to the forms most like it.',
  },
]);

let specimens: Specimen[] = [];
let mode: 'intro' | 'calibrate' | 'sculpt' = 'intro';
let input: 'hands' | 'pointer' = 'pointer';
let accepting = false;

fillLump(atelier.volume);

// ───── Material ─────
const matPicker = new Dropdown(
  $('materials'),
  MATERIALS.map((m) => ({ value: m.key, label: m.name, swatch: swatch(m.key) })),
  'Material',
);
function setMaterial(key: string) {
  atelier.setMaterial(key);
  matPicker.set(atelier.material);
  try {
    localStorage.setItem('b2b.material', atelier.material);
  } catch { /* ignore */ }
}
matPicker.onChange = setMaterial;
let savedMaterial = DEFAULT_MATERIAL;
try {
  savedMaterial = localStorage.getItem('b2b.material') ?? DEFAULT_MATERIAL;
} catch { /* ignore */ }
setMaterial(preset(savedMaterial).key);

// ───── Intro ─────
function begin(kind: 'hands' | 'pointer') {
  $('welcome').classList.add('gone');
  input = kind;
  chrome.setInputMode(kind);
  if (kind === 'pointer') {
    pointer.enabled = true;
    mode = 'sculpt';
    chrome.setActive(pointer.tool);
    setTimeout(() => tour.start(), 700);
  }
}

$('btn-start').addEventListener('click', () => {
  $('welcome').querySelector<HTMLElement>('[data-step="1"]')!.hidden = true;
  $('welcome').querySelector<HTMLElement>('[data-step="2"]')!.hidden = false;
  $('btn-calibrate').focus();
});
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

// After the pinch step, hands start sculpting for one practice pull.
calibration.onPractice = () => {
  mode = 'sculpt';
  hands.enabled = true;
  pointer.setTool('extrude');
};
calibration.onDone = () => tour.start();
// Hands act with whichever tool is selected; they never pick it themselves.
hands.tool = () => pointer.tool;

pointer.onToolChange = (t) => chrome.setActive(t);
chrome.onToolClick((t) => pointer.setTool(t));
chrome.onBrush = (dir) => sculptor.setBrush(dir > 0 ? sculptor.brush / 0.85 : sculptor.brush * 0.85);
chrome.onBrushValue = (size) => sculptor.setBrush(size / 100);

const KEYS: Record<string, ToolKind> = { '1': 'extrude', '2': 'spike', '3': 'press', '4': 'drill', '5': 'turn' };
window.addEventListener('keydown', (e) => {
  // Typing in a field never triggers shortcuts.
  if (e.target instanceof Element && e.target.closest('input, textarea')) return;
  if (KEYS[e.key] && mode === 'sculpt') pointer.setTool(KEYS[e.key]);
  if (e.key === 'Enter' && mode === 'sculpt') accept();
  if (e.key === 'm' || e.key === 'M') {
    const i = MATERIALS.findIndex((m) => m.key === atelier.material);
    setMaterial(MATERIALS[(i + 1) % MATERIALS.length].key);
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
  fillLump(atelier.volume);
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
  startOver();
  setTimeout(() => (accepting = false), 900);
}

// ───── Collection ─────
function updateCount() {
  if (view === 'grid') renderGrid();
  const n = specimens.length;
  $('field-count').textContent = String(n);
  $('field-empty').classList.toggle('gone', n > 0);
}

// Samples: every family, four forms each, so the collection fills with
// varied groups that recognise each other.
$('btn-seed').addEventListener('click', () => {
  const tmp = new Volume(128);
  const families = (Object.keys(ARCHETYPES) as Archetype[]).sort(() => Math.random() - 0.5);
  const queue: Archetype[] = families.flatMap((f) => [f, f, f, f]);
  const one = () => {
    const kind = queue.shift();
    if (!kind) {
      saveSpecimens(specimens);
      return;
    }
    const material = sculptSample(tmp, kind, Math.floor(Math.random() * 1e6));
    const spec = createSpecimen(tmp, specimens.length + 1, material);
    specimens.push(spec);
    field.add(spec, true);
    updateCount();
    setTimeout(one, 140);
  };
  one();
});
$('btn-clear').addEventListener('click', () => {
  specimens = [];
  field.clear();
  updateCount();
  saveSpecimens(specimens);
});

const inspector = $('inspector');
field.onHover = (spec, kin) => {
  if (!spec) {
    inspector.hidden = true;
    return;
  }
  // One chart: this form over its closest relative, so the overlap reads.
  const top = kin[0];
  const legend = top
    ? `<div class="legend"><span><i class="self"></i>${codeOf(spec)}</span><span><i class="kin"></i>${codeOf(top.spec)}</span></div>
       <div class="match"><span>Alike by ${traitLabel[top.trait].toLowerCase()}</span><b class="num">${Math.round(top.k * 100)}%</b></div>`
    : `<div class="match"><span>No relatives yet</span></div>`;
  card.placed = false;
  inspector.innerHTML = `<header><h3 class="num">${codeOf(spec)}</h3><span class="sub">${preset(spec.material).name}</span></header>${radarSVG(spec.sig, top?.spec.sig)}${legend}`;
  inspector.hidden = false;
};

loadSpecimens().then((list) => {
  specimens = list;
  for (const s of list) field.add(s, false);
  updateCount();
});

// The card sits beside the hovered form and follows it.
const fieldEl = $('field');
const card = { x: 0, y: 0, placed: false };
function placeInspector(dt: number) {
  const a = field.hoverAnchor();
  if (!a || inspector.hidden) {
    card.placed = false;
    return;
  }
  const w = inspector.offsetWidth, h = inspector.offsetHeight;
  const W = fieldEl.clientWidth, H = fieldEl.clientHeight, gap = 16, m = 12;
  let x = a.x + a.r + gap;
  if (x + w > W - m) x = a.x - a.r - gap - w;
  x = Math.min(Math.max(x, m), W - w - m);
  const y = Math.min(Math.max(a.y - h / 2, m + 32), H - h - m - 48);
  if (!card.placed) Object.assign(card, { x, y, placed: true });
  const k = 1 - Math.exp(-dt * 14);
  card.x += (x - card.x) * k;
  card.y += (y - card.y) * k;
  inspector.style.transform = `translate(${card.x.toFixed(1)}px, ${card.y.toFixed(1)}px)`;
}

// ───── Grid view ─────
const thumbs = new Thumbnailer();
const viewSwitch = document.querySelector<HTMLElement>('.view-switch')!;
let view: 'network' | 'grid' = 'network';
function setView(v: 'network' | 'grid') {
  view = v;
  viewSwitch.dataset.view = v;
  for (const b of viewSwitch.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.view === v));
  $('grid-view').hidden = v !== 'grid';
  if (v === 'grid') {
    inspector.hidden = true;
    renderGrid();
  }
}
function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  // Newest first; cards stagger in.
  [...specimens].reverse().forEach((spec, i) => {
    const card = document.createElement('figure');
    card.className = 'card';
    card.style.animationDelay = `${Math.min(i, 16) * 35}ms`;
    card.innerHTML = `<img alt="Form ${codeOf(spec)}" src="${thumbs.get(spec)}" /><figcaption class="meta"><span class="code">${codeOf(spec)}</span><span class="mat">${preset(spec.material).name}</span></figcaption>`;
    grid.appendChild(card);
  });
}
for (const b of viewSwitch.querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => setView(b.dataset.view as 'network' | 'grid'));

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
let calm = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  let tips = pointer.update(dt);
  if (input === 'hands' && tracker.ready) {
    // The calibration card sits beside the first hand and follows it.
    const h0 = tracker.hands[0];
    const anchor = h0 ? { x: overlay.map.x((h0.lm[0] + h0.lm[27]) / 2), y: overlay.map.y((h0.lm[1] + h0.lm[28]) / 2) } : null;
    const pane = { w: atelierEl.clientWidth, h: atelierEl.clientHeight };
    if (mode === 'calibrate') {
      calibration.update(dt, anchor, pane);
      overlay.draw(tracker.hands, 'calibrate', dt, tracker.cal.mmPerUnit);
    } else {
      tips = tips.concat(hands.update(dt).tips);
      if (calibration.active) {
        calibration.update(dt, anchor, pane);
        calibration.practiceProgress(dt, [...hands.activity.values()].some((a) => a.engaged && a.tool === 'extrude'));
      }
      overlay.draw(tracker.hands, 'sculpt', dt, tracker.cal.mmPerUnit, hands.activity);
    }
  }
  atelier.brush = sculptor.brush;
  chrome.setBrush(sculptor.brush);
  atelier.setTips(tips);
  atelier.update(dt);
  atelier.render();
  field.update(dt);
  if (view === 'network') field.render();
  placeInspector(dt);

  // Adaptive resolution: protect the frame rate first.
  // Adaptive resolution: step down when frames run long, recover when calm.
  slow = slow * 0.95 + (dt > 1 / 45 ? 1 : 0) * 0.05;
  calm = dt < 1 / 70 ? calm + dt : 0;
  if (slow > 0.5) {
    atelier.setPixelRatio(Math.max(1, atelier.currentPixelRatio - 0.25));
    slow = 0;
  } else if (calm > 2 && atelier.currentPixelRatio < Math.min(window.devicePixelRatio, 2)) {
    atelier.setPixelRatio(atelier.currentPixelRatio + 0.25);
    calm = 0;
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
        $('welcome').classList.add('gone');
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
