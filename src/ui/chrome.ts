import { TOOLS, type ToolKind } from '../sculpt/sculptor';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Minimal line glyphs for each tool.
const GLYPHS: Record<ToolKind, string> = {
  extrude: '<path d="M3 13 H19"/><path d="M7.5 13 C8 7.5 9 4 11 3.6 C13 4 14 7.5 14.5 13"/>',
  spike: '<path d="M3 13 H19"/><path d="M8 13 L11 1.5 L14 13"/>',
  drill: '<circle cx="11" cy="8" r="5.5"/><circle cx="11" cy="8" r="1.6"/>',
  smooth: '<path d="M3 10 C6 6 8 14 11 10 S16 6 19 10"/>',
  turn: '<path d="M5 9 A6 6 0 1 0 11 3"/><path d="M11 1 L13 3 L11 5"/>',
};

export class Chrome {
  private toolEls = new Map<ToolKind, HTMLButtonElement>();
  private sizeEl: HTMLElement;
  private sizeNum: HTMLInputElement;
  private indicator: HTMLElement;
  private active: ToolKind | null = null;
  private shownSize = -1;
  private sizeTarget = 0;
  private sizeRaf = 0;
  onBrush: (dir: -1 | 1) => void = () => {};
  /** A typed size, 5 to 28. */
  onBrushValue: (size: number) => void = () => {};

  constructor() {
    const bar = $('tools');
    const group = document.createElement('div');
    group.className = 'tool-group';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Tool');
    // One pill that slides to the selected tool.
    this.indicator = document.createElement('span');
    this.indicator.className = 'tool-indicator';
    this.indicator.setAttribute('aria-hidden', 'true');
    group.appendChild(this.indicator);
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.tool = t.kind;
      b.dataset.key = t.key;
      b.dataset.hand = t.hand;
      b.innerHTML = `<svg class="glyph" viewBox="0 0 22 16">${GLYPHS[t.kind]}</svg><span>${t.name}</span><kbd>${t.key}</kbd>`;
      group.appendChild(b);
      this.toolEls.set(t.kind, b);
    }
    bar.appendChild(group);

    // Brush size: minus, a dot that scales with the size, plus.
    const size = document.createElement('div');
    size.className = 'size-group';
    size.innerHTML = `<button type="button" aria-label="Smaller brush">−</button><span class="size-dot" aria-hidden="true"><i></i></span><input class="size-num num" type="text" inputmode="numeric" maxlength="2" aria-label="Brush size, 5 to 28" /><button type="button" aria-label="Larger brush">+</button>`;
    const [minus, plus] = size.querySelectorAll('button');
    minus.addEventListener('click', () => this.onBrush(-1));
    plus.addEventListener('click', () => this.onBrush(1));
    this.sizeEl = size.querySelector('.size-dot i')!;
    this.sizeNum = size.querySelector<HTMLInputElement>('.size-num')!;
    // Type a size and press Enter (or leave the field) to apply it.
    const commit = () => {
      const v = parseInt(this.sizeNum.value, 10);
      if (Number.isFinite(v)) this.onBrushValue(Math.min(28, Math.max(5, v)));
      this.sizeNum.value = String(this.sizeTarget);
    };
    this.sizeNum.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.sizeNum.blur();
      if (e.key === 'Escape') {
        this.sizeNum.value = String(this.sizeTarget);
        this.sizeNum.blur();
      }
    });
    this.sizeNum.addEventListener('focus', () => this.sizeNum.select());
    this.sizeNum.addEventListener('blur', commit);
    bar.appendChild(size);
    // Keep the pill on its tool when the toolbar reflows.
    new ResizeObserver(() => this.placeIndicator(false)).observe(group);
  }

  onToolClick(fn: (t: ToolKind) => void) {
    for (const [kind, b] of this.toolEls) b.addEventListener('click', () => fn(kind));
  }

  /** The hand gesture for each tool lives in its tooltip, not on screen. */
  setInputMode(mode: 'hands' | 'pointer') {
    for (const b of this.toolEls.values()) {
      b.title = mode === 'hands' ? `Pinch to start, then ${b.dataset.hand!.replace('pinch and ', '')}` : `Key ${b.dataset.key}`;
    }
  }

  setActive(kind: ToolKind | null) {
    const first = this.active === null;
    this.active = kind;
    for (const [k, b] of this.toolEls) {
      b.classList.toggle('active', k === kind);
      b.setAttribute('aria-checked', String(k === kind));
    }
    this.placeIndicator(!first);
  }

  private placeIndicator(animate: boolean) {
    const b = this.active ? this.toolEls.get(this.active) : null;
    const ind = this.indicator;
    if (!b) {
      ind.style.opacity = '0';
      return;
    }
    if (!animate) ind.style.transition = 'none';
    ind.style.opacity = '1';
    ind.style.width = `${b.offsetWidth}px`;
    ind.style.transform = `translateX(${b.offsetLeft - 4}px)`;
    if (!animate) {
      void ind.offsetWidth; // apply without animating, then restore transitions
      ind.style.transition = '';
    }
  }

  /**
   * Brush radius 0.05 … 0.28: a dot from 4 to 14 px, and a size from 5 to 28
   * that counts to its new value.
   */
  setBrush(r: number) {
    const px = 4 + ((r - 0.05) / 0.23) * 10;
    this.sizeEl.style.width = this.sizeEl.style.height = `${px.toFixed(1)}px`;
    const target = Math.round(r * 100);
    if (target === this.sizeTarget && this.shownSize >= 0) return;
    this.sizeTarget = target;
    if (this.shownSize < 0) {
      this.shownSize = target;
      this.sizeNum.value = String(target);
      return;
    }
    cancelAnimationFrame(this.sizeRaf);
    const from = this.shownSize, t0 = performance.now(), dur = 280;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.shownSize = from + (target - from) * e;
      if (document.activeElement !== this.sizeNum) this.sizeNum.value = String(Math.round(this.shownSize));
      if (k < 1) this.sizeRaf = requestAnimationFrame(tick);
    };
    this.sizeNum.classList.remove('bump');
    void this.sizeNum.offsetWidth;
    this.sizeNum.classList.add('bump');
    this.sizeRaf = requestAnimationFrame(tick);
  }

  setAcceptProgress(p: number) {
    const ring = $('accept-ring');
    ring.hidden = p <= 0;
    const fill = ring.querySelector<SVGCircleElement>('.fill')!;
    fill.style.strokeDashoffset = String(339.3 * (1 - p));
  }
}
