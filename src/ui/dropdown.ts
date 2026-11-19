/**
 * A small, reusable dropdown: a quiet trigger and a popover list.
 * Keyboard: Enter/Space/ArrowDown open, arrows move, Enter picks, Esc closes.
 */
export interface DropdownOption {
  value: string;
  label: string;
  /** Optional CSS background for a leading swatch. */
  swatch?: string;
  /** Optional inline SVG paths (24×24 line icon) instead of a swatch. */
  icon?: string;
}

export class Dropdown {
  readonly el: HTMLElement;
  onChange: (value: string) => void = () => {};
  private trigger: HTMLButtonElement;
  private pop: HTMLElement;
  private items: HTMLButtonElement[] = [];
  private value = '';

  constructor(host: HTMLElement, private options: DropdownOption[], label: string) {
    this.el = host;
    host.classList.add('dropdown');
    host.innerHTML = '';

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'dropdown-trigger';
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-label', label);
    host.appendChild(this.trigger);

    this.pop = document.createElement('div');
    this.pop.className = 'popover dropdown-list';
    this.pop.setAttribute('role', 'listbox');
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dropdown-item';
      b.setAttribute('role', 'option');
      b.dataset.value = o.value;
      b.innerHTML = `${lead(o)}<span>${o.label}</span>`;
      b.addEventListener('click', () => {
        this.set(o.value, true);
        this.close();
        this.trigger.focus();
      });
      this.pop.appendChild(b);
      this.items.push(b);
    }
    host.appendChild(this.pop);

    this.trigger.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.open();
      }
    });
    this.pop.addEventListener('keydown', (e) => {
      const i = this.items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') this.items[Math.min(this.items.length - 1, i + 1)].focus();
      else if (e.key === 'ArrowUp') this.items[Math.max(0, i - 1)].focus();
      else if (e.key === 'Escape') {
        this.close();
        this.trigger.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !host.contains(e.target as Node)) this.close();
    });
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  open() {
    this.el.classList.add('open');
    this.trigger.setAttribute('aria-expanded', 'true');
    const cur = this.items.find((b) => b.dataset.value === this.value) ?? this.items[0];
    requestAnimationFrame(() => cur.focus({ preventScroll: true }));
  }

  close() {
    this.el.classList.remove('open');
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  set(value: string, notify = false) {
    const o = this.options.find((x) => x.value === value) ?? this.options[0];
    this.value = o.value;
    this.trigger.innerHTML = `${lead(o)}<span>${o.label}</span><svg class="chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1 L5 5 L9 1"/></svg>`;
    for (const b of this.items) b.setAttribute('aria-selected', String(b.dataset.value === o.value));
    if (notify) this.onChange(o.value);
  }
}

/** A swatch or a small line icon in front of a label. */
function lead(o: DropdownOption) {
  if (o.icon) return `<svg class="lucide opt-icon" viewBox="0 0 24 24" aria-hidden="true">${o.icon}</svg>`;
  if (o.swatch) return `<i class="swatch" style="background:${o.swatch}"></i>`;
  return '';
}
