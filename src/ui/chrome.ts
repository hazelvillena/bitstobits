import { TOOLS, type ToolKind } from '../sculpt/sculptor';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Minimal line glyphs for each tool.
const GLYPHS: Record<ToolKind, string> = {
  drill: '<circle cx="11" cy="8" r="5.5"/><circle cx="11" cy="8" r="1.6"/>',
  pull: '<path d="M3 12 C8 12 9 4 19 4"/><circle cx="19" cy="4" r="1.4"/>',
  press: '<path d="M3 4 H19"/><path d="M4 12 C8 8 14 8 18 12"/>',
  smooth: '<path d="M3 10 C6 6 8 14 11 10 S16 6 19 10"/>',
  turn: '<path d="M5 9 A6 6 0 1 0 11 3"/><path d="M11 1 L13 3 L11 5"/>',
};

export class Chrome {
  private toolEls = new Map<ToolKind, HTMLLIElement>();

  constructor() {
    const list = $('tools');
    for (const t of TOOLS) {
      const li = document.createElement('li');
      li.innerHTML = `<svg class="glyph" viewBox="0 0 22 16">${GLYPHS[t.kind]}</svg><span>${t.name}</span><span class="how" data-hand="${t.hand}" data-key="${t.key}"></span>`;
      li.dataset.tool = t.kind;
      list.appendChild(li);
      this.toolEls.set(t.kind, li);
    }
  }

  onToolClick(fn: (t: ToolKind) => void) {
    for (const [kind, li] of this.toolEls) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => fn(kind));
    }
  }

  /** Show either the hand pose or the keyboard key beside each tool. */
  setInputMode(mode: 'hands' | 'pointer') {
    for (const li of this.toolEls.values()) {
      const how = li.querySelector<HTMLElement>('.how')!;
      how.textContent = mode === 'hands' ? `${how.dataset.key}  ${how.dataset.hand}` : how.dataset.key!;
    }
  }

  setActive(kind: ToolKind | null) {
    for (const [k, li] of this.toolEls) li.classList.toggle('active', k === kind);
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
