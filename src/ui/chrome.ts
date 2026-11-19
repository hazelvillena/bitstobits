import { TOOLS, type ToolKind } from '../sculpt/sculptor';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Minimal line glyphs for each tool.
const GLYPHS: Record<ToolKind, string> = {
  extrude: '<path d="M3 13 H19"/><path d="M7.5 13 C10 12 10.6 7 11 2 C11.4 7 12 12 14.5 13"/>',
  drill: '<circle cx="11" cy="8" r="5.5"/><circle cx="11" cy="8" r="1.6"/>',
  smooth: '<path d="M3 10 C6 6 8 14 11 10 S16 6 19 10"/>',
  turn: '<path d="M5 9 A6 6 0 1 0 11 3"/><path d="M11 1 L13 3 L11 5"/>',
};

export class Chrome {
  private toolEls = new Map<ToolKind, HTMLButtonElement>();
  private sizeEl: HTMLElement;
  onBrush: (dir: -1 | 1) => void = () => {};

  constructor() {
    const bar = $('tools');
    const group = document.createElement('div');
    group.className = 'tool-group';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Tool');
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
    size.innerHTML = `<button type="button" aria-label="Smaller brush">−</button><span class="size-dot" aria-hidden="true"><i></i></span><button type="button" aria-label="Larger brush">+</button>`;
    const [minus, plus] = size.querySelectorAll('button');
    minus.addEventListener('click', () => this.onBrush(-1));
    plus.addEventListener('click', () => this.onBrush(1));
    this.sizeEl = size.querySelector('.size-dot i')!;
    bar.appendChild(size);
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
    for (const [k, b] of this.toolEls) {
      b.classList.toggle('active', k === kind);
      b.setAttribute('aria-checked', String(k === kind));
    }
  }

  /** Brush radius 0.05 … 0.28 shown as a dot from 4 to 14 px. */
  setBrush(r: number) {
    const px = 4 + ((r - 0.05) / 0.23) * 10;
    this.sizeEl.style.width = this.sizeEl.style.height = `${px.toFixed(1)}px`;
  }

  setSpecimenNumber(n: number) {
    $('specimen-no').textContent = `Form ${n}`;
  }

  setAcceptProgress(p: number) {
    const ring = $('accept-ring');
    ring.hidden = p <= 0;
    const fill = ring.querySelector<SVGCircleElement>('.fill')!;
    fill.style.strokeDashoffset = String(339.3 * (1 - p));
  }
}
