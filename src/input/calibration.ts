import { dist, palmSpan, readPose, DEFAULT_CAL, type HandFrame } from './handModel';
import type { HandTracker } from './handTracker';

const $ = (id: string) => document.getElementById(id)!;

type Step = { pose: 'open' | 'fist' | 'pinch'; title: string; sub: string; label: string; hold: number; glyph: string };

const STEPS: Step[] = [
  {
    pose: 'open', label: 'Open', hold: 1.2,
    title: 'Show your open hand', sub: "About an arm's length from the screen, palm facing you.",
    glyph: '<path d="M28 42 V24 M23 40 V20 M33 40 V20 M38 40 V24 M28 42 C20 42 18 36 18 30 M38 32 C38 40 34 44 28 44"/>',
  },
  {
    pose: 'fist', label: 'Fist', hold: 0.9,
    title: 'Now close it', sub: 'A loose fist is enough.',
    glyph: '<rect x="19" y="21" width="18" height="16" rx="6"/><path d="M23 21 V27 M28 21 V27 M33 21 V27"/>',
  },
  {
    pose: 'pinch', label: 'Pinch', hold: 0.9,
    title: 'Touch thumb and index', sub: 'This is how you pull matter out.',
    glyph: '<circle cx="28" cy="25" r="5"/><path d="M23 27 C20 34 22 40 28 42 C34 40 36 34 33 27"/>',
  },
];

/** Three held poses measure the hand and set its personal thresholds. */
export class Calibration {
  active = false;
  onDone: () => void = () => {};
  private i = 0;
  private held = 0;
  private samples = { span: [] as number[], openPinch: [] as number[], pinch: [] as number[], index: [] as number[] };
  private items: HTMLLIElement[] = [];

  constructor(private tracker: HandTracker) {
    const list = $('poses');
    list.innerHTML = '';
    for (const s of STEPS) {
      const li = document.createElement('li');
      li.innerHTML = `<div class="pose-dial"><svg viewBox="0 0 56 56"><circle class="ring-track" cx="28" cy="28" r="26"/><circle class="ring-fill" cx="28" cy="28" r="26" stroke-dasharray="163.4" stroke-dashoffset="163.4"/><g class="pose-glyph">${s.glyph}</g></svg></div><span>${s.label}</span>`;
      list.appendChild(li);
      this.items.push(li);
    }
  }

  start() {
    this.active = true;
    this.i = 0;
    this.held = 0;
    this.samples = { span: [], openPinch: [], pinch: [], index: [] };
    $('calibration').hidden = false;
    $('hand-signature').hidden = true;
    this.items.forEach((li) => li.classList.remove('done', 'current'));
    this.show();
  }

  private show() {
    const s = STEPS[this.i];
    $('calib-title').textContent = s.title;
    $('calib-sub').textContent = s.sub;
    this.items.forEach((li, k) => li.classList.toggle('current', k === this.i));
  }

  private setRing(k: number, p: number) {
    const c = this.items[k].querySelector<SVGCircleElement>('.ring-fill')!;
    c.style.strokeDashoffset = String(163.4 * (1 - p));
  }

  update(dt: number) {
    if (!this.active) return;
    const h: HandFrame | undefined = this.tracker.hands[0];
    const step = STEPS[this.i];
    const asp = this.tracker.cal.aspect;
    let ok = false;
    if (h) {
      const r = readPose(h.lm, { ...DEFAULT_CAL, aspect: asp });
      if (step.pose === 'open') ok = r.pose === 'open';
      if (step.pose === 'fist') ok = r.pose === 'fist' || r.pose === 'thumb';
      if (step.pose === 'pinch') ok = r.pinchRatio < 0.3;
      if (ok) {
        if (step.pose === 'open') {
          this.samples.span.push(palmSpan(h.lm, asp));
          this.samples.openPinch.push(r.pinchRatio);
          let idx = 0;
          for (let j = 5; j < 8; j++) idx += dist(h.lm, j, j + 1, asp);
          this.samples.index.push(idx);
        }
        if (step.pose === 'pinch') this.samples.pinch.push(r.pinchRatio);
      }
    }
    this.held = ok ? this.held + dt : Math.max(0, this.held - dt * 2);
    this.setRing(this.i, Math.min(1, this.held / step.hold));
    if (this.held >= step.hold) {
      this.items[this.i].classList.add('done');
      this.i++;
      this.held = 0;
      if (this.i >= STEPS.length) this.finish();
      else this.show();
    }
  }

  private finish() {
    const avg = (a: number[], d: number) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : d);
    const cal = this.tracker.cal;
    cal.span = avg(this.samples.span, DEFAULT_CAL.span);
    const open = avg(this.samples.openPinch, 1.2);
    const pinch = avg(this.samples.pinch, 0.15);
    cal.pinchOn = pinch + (open - pinch) * 0.3;
    // An adult palm (wrist to knuckle, blended with width) is roughly 90 mm.
    cal.mmPerUnit = 90 / cal.span;
    this.tracker.saveCalibration();

    const sig = $('hand-signature');
    const indexMm = Math.round(avg(this.samples.index, 0.1) * cal.mmPerUnit);
    sig.innerHTML = `
      <h3>Your hand</h3>
      <div class="row"><span>Palm</span><b>${Math.round(cal.span * cal.mmPerUnit)} mm</b></div>
      <div class="row"><span>Index finger</span><b>${indexMm} mm</b></div>
      <div class="row"><span>Pinch at</span><b>${cal.pinchOn.toFixed(2)}</b></div>`;
    sig.hidden = false;
    $('calib-title').textContent = 'Calibrated';
    $('calib-sub').textContent = 'Reach toward the form to begin. A held thumbs up keeps it.';
    this.active = false;
    setTimeout(() => {
      $('calibration').hidden = true;
      this.onDone();
    }, 2200);
  }
}
