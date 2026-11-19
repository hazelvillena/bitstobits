import { dist, palmSpan, readPose, DEFAULT_CAL, type HandFrame } from './handModel';
import type { HandTracker } from './handTracker';

const $ = (id: string) => document.getElementById(id)!;

type StepKey = 'open' | 'pinch' | 'practice';
const STEPS: { key: StepKey; title: string; sub: string; hold: number }[] = [
  { key: 'open', title: 'Hold up your open hand', sub: 'Palm toward the screen, about an arm away.', hold: 1.8 },
  { key: 'pinch', title: 'Now pinch', sub: 'Touch thumb and index, and hold.', hold: 1.2 },
  { key: 'practice', title: 'Try it', sub: 'Point at the form, pinch, and pull.', hold: 0 },
];

/**
 * Calibration as a short, hand-anchored conversation. A small card sits
 * beside your hand and follows it, so it is clear the moment you are seen:
 * 1. Open hand: measures palm size and how far apart your fingers rest.
 * 2. Pinch: measures your own pinch, in 3D, to set start and release.
 * 3. Practice: one real pull on the form, then you're done.
 */
export class Calibration {
  active = false;
  /** Called after the pinch step; hands should start sculpting for practice. */
  onPractice: () => void = () => {};
  onDone: () => void = () => {};

  private i = 0;
  private held = 0;
  private shown = 0;
  private samples = { span: [] as number[], open: [] as number[], closed: [] as number[], index: [] as number[] };
  private card = $('calib-card');
  private ring = this.card.querySelector<SVGCircleElement>('.ring-fill')!;
  private dots = [...this.card.querySelectorAll<HTMLElement>('.step-dots i')];
  private pos = { x: 0, y: 0, placed: false };
  private practiced = 0;

  constructor(private tracker: HandTracker) {}

  start() {
    this.active = true;
    this.i = 0;
    this.held = this.shown = this.practiced = 0;
    this.samples = { span: [], open: [], closed: [], index: [] };
    this.pos.placed = false;
    $('calibration').hidden = false;
    $('calibration').classList.remove('leaving');
    this.show();
  }

  private show() {
    const s = STEPS[this.i];
    swapText('calib-title', s.title);
    swapText('calib-sub', s.sub);
    this.dots.forEach((d, k) => {
      d.classList.toggle('done', k < this.i);
      d.classList.toggle('current', k === this.i);
    });
    this.held = this.shown = 0;
    this.setRing(0);
  }

  private setRing(p: number) {
    this.ring.style.strokeDashoffset = String(119.4 * (1 - p));
  }

  /**
   * Per frame. `anchor` is where the hand is on screen (or null); the card
   * eases toward a spot beside it.
   */
  update(dt: number, anchor: { x: number; y: number } | null, pane: { w: number; h: number }) {
    if (!this.active) return;
    this.place(dt, anchor, pane);
    const step = STEPS[this.i];
    const h: HandFrame | undefined = this.tracker.hands[0];
    this.card.classList.toggle('seen', !!h);
    if (step.key === 'practice') return;

    const asp = this.tracker.cal.aspect;
    let ok = false;
    if (h) {
      if (step.key === 'open') {
        ok = readPose(h.lm, { ...DEFAULT_CAL, aspect: asp }).pose === 'open';
        if (ok) {
          this.samples.span.push(palmSpan(h.lm, asp));
          this.samples.open.push(h.pinchDist);
          let idx = 0;
          for (let j = 5; j < 8; j++) idx += dist(h.lm, j, j + 1, asp);
          this.samples.index.push(idx);
        }
      } else {
        // A pinch is the fingers coming well inside their open spread.
        const open = median(this.samples.open, DEFAULT_CAL.pinchOpen);
        ok = h.pinchDist < Math.min(0.035, open * 0.45);
        if (ok) this.samples.closed.push(h.pinchDist);
      }
    }
    // Forgiving: losing the pose for a moment only eases the ring back.
    this.held = ok ? this.held + dt : Math.max(0, this.held - dt * 0.6);
    this.shown += (Math.min(1, this.held / step.hold) - this.shown) * (1 - Math.exp(-dt * 6));
    this.setRing(this.shown);
    if (this.held >= step.hold) this.next();
  }

  /** Main reports whether a real stroke is in progress during practice. */
  practiceProgress(dt: number, engaged: boolean) {
    if (!this.active || STEPS[this.i].key !== 'practice') return;
    if (engaged) this.practiced += dt;
    this.setRing(Math.min(1, this.practiced / 0.8));
    if (this.practiced >= 0.8) this.finish();
  }

  private next() {
    if (STEPS[this.i].key === 'pinch') this.commit();
    this.i++;
    this.show();
    if (STEPS[this.i].key === 'practice') this.onPractice();
  }

  private commit() {
    const cal = this.tracker.cal;
    cal.span = median(this.samples.span, DEFAULT_CAL.span);
    // An adult palm (wrist to knuckle, blended with width) is roughly 90 mm.
    cal.mmPerUnit = 90 / cal.span;
    const open = median(this.samples.open, DEFAULT_CAL.pinchOpen);
    const closed = median(this.samples.closed, 0.012);
    cal.pinchOpen = open;
    // Start a little above your pinch; release well before your open hand.
    cal.pinchStart = clamp(closed + (open - closed) * 0.28, 0.016, 0.04);
    cal.pinchRelease = Math.min(open * 0.85, cal.pinchStart + Math.max(0.012, (open - closed) * 0.22));
    this.tracker.saveCalibration();
  }

  private finish() {
    swapText('calib-title', 'Nicely done');
    swapText('calib-sub', 'Keep the form when you like it.');
    this.dots.forEach((d) => d.classList.add('done'));
    this.active = false;
    setTimeout(() => {
      $('calibration').classList.add('leaving');
      setTimeout(() => {
        $('calibration').hidden = true;
        this.onDone();
      }, 600);
    }, 1800);
  }

  private place(dt: number, anchor: { x: number; y: number } | null, pane: { w: number; h: number }) {
    const w = this.card.offsetWidth, ht = this.card.offsetHeight, m = 16;
    let x: number, y: number;
    if (anchor) {
      // Beside the hand, on whichever side has room.
      x = anchor.x + 110;
      if (x + w > pane.w - m) x = anchor.x - 110 - w;
      y = anchor.y - ht / 2;
    } else {
      x = (pane.w - w) / 2;
      y = pane.h * 0.62 - ht / 2;
    }
    x = Math.min(Math.max(x, m), pane.w - w - m);
    y = Math.min(Math.max(y, m + 48), pane.h - ht - m - 64);
    if (!this.pos.placed) Object.assign(this.pos, { x, y, placed: true });
    const k = 1 - Math.exp(-dt * 7);
    this.pos.x += (x - this.pos.x) * k;
    this.pos.y += (y - this.pos.y) * k;
    this.card.style.transform = `translate(${this.pos.x.toFixed(1)}px, ${this.pos.y.toFixed(1)}px)`;
  }
}

function median(a: number[], d: number) {
  if (!a.length) return d;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Crossfade a text element to new content. */
function swapText(id: string, text: string) {
  const el = $(id);
  if (el.textContent === text) return;
  el.classList.remove('swap');
  void el.offsetWidth;
  el.textContent = text;
  el.classList.add('swap');
}
