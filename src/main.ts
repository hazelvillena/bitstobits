import './ui/base.css';
import { Atelier } from './render/atelier';
import { Sculptor, type ToolKind } from './sculpt/sculptor';
import { PointerInput } from './input/pointer';
import { fillLump } from './sculpt/seed';
import { Chrome } from './ui/chrome';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const atelierEl = $('atelier');
const atelier = new Atelier($<HTMLCanvasElement>('atelier-canvas'));
const sculptor = new Sculptor(atelier);
const chrome = new Chrome();
const pointer = new PointerInput(atelierEl, atelier, sculptor);

let specimenNo = 1;
fillLump(atelier.volume, Date.now() % 100000);

// ───── Intro ─────
function startPointer() {
  $('intro').classList.add('gone');
  pointer.enabled = true;
  chrome.setInputMode('pointer');
  chrome.setActive(pointer.tool);
}
$('btn-pointer').addEventListener('click', startPointer);

pointer.onToolChange = (t) => chrome.setActive(t);
chrome.onToolClick((t) => pointer.setTool(t));

const KEYS: Record<string, ToolKind> = { '1': 'drill', '2': 'pull', '3': 'press', '4': 'smooth', '5': 'turn' };
window.addEventListener('keydown', (e) => {
  if (KEYS[e.key] && pointer.enabled) pointer.setTool(KEYS[e.key]);
  if (e.key === 'n' || e.key === 'N') beginAgain();
});

function beginAgain() {
  fillLump(atelier.volume, Date.now() % 100000);
  atelier.growIn();
}
$('btn-reset').addEventListener('click', beginAgain);

// ───── Loop ─────
const ro = new ResizeObserver(() => atelier.resize());
ro.observe(atelierEl);

let last = performance.now();
let slow = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const tips = pointer.update(dt);
  atelier.setTips(tips);
  atelier.update(dt);
  atelier.render();

  // Adaptive resolution: protect the frame rate before anything else.
  slow = slow * 0.95 + (dt > 1 / 45 ? 1 : 0) * 0.05;
  if (slow > 0.5) {
    atelier.setPixelRatio(Math.max(0.75, atelier.currentPixelRatio - 0.25));
    slow = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

chrome.setSpecimenNumber(specimenNo);
Object.assign(window, { atelier });
