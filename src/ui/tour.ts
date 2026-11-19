/**
 * A three-step tour: a soft highlight around a part of the interface and a
 * small popover explaining it. Skippable at any point.
 */
interface TourStep {
  target: () => HTMLElement | null;
  title: string;
  text: string;
}

export class Tour {
  private i = 0;
  private ring: HTMLElement;
  private card: HTMLElement;
  private raf = 0;

  constructor(private steps: TourStep[]) {
    this.ring = document.createElement('div');
    this.ring.className = 'tour-ring';
    this.card = document.createElement('div');
    this.card.className = 'tour-card popover';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    this.ring.hidden = this.card.hidden = true;
    document.body.append(this.ring, this.card);
    window.addEventListener('keydown', (e) => {
      if (this.card.hidden) return;
      if (e.key === 'Escape') this.end();
    });
  }

  start() {
    this.i = 0;
    this.ring.hidden = this.card.hidden = false;
    this.render();
    const follow = () => {
      this.place();
      this.raf = requestAnimationFrame(follow);
    };
    cancelAnimationFrame(this.raf);
    follow();
  }

  private render() {
    const s = this.steps[this.i];
    const last = this.i === this.steps.length - 1;
    const dots = this.steps.map((_, k) => `<i class="${k === this.i ? 'current' : k < this.i ? 'done' : ''}"></i>`).join('');
    this.card.innerHTML = `
      <div class="tour-body">
        <h3>${s.title}</h3>
        <p>${s.text}</p>
      </div>
      <div class="tour-foot">
        <div class="step-dots">${dots}</div>
        <div class="tour-actions">
          ${last ? '' : '<button type="button" class="btn ghost tour-skip">Skip</button>'}
          <button type="button" class="btn primary tour-next">${last ? 'Got it' : 'Next'}</button>
        </div>
      </div>`;
    this.card.querySelector('.tour-next')!.addEventListener('click', () => this.next());
    this.card.querySelector('.tour-skip')?.addEventListener('click', () => this.end());
    this.card.classList.remove('enter');
    void this.card.offsetWidth;
    this.card.classList.add('enter');
    (this.card.querySelector('.tour-next') as HTMLElement).focus({ preventScroll: true });
  }

  private next() {
    if (this.i >= this.steps.length - 1) return this.end();
    this.i++;
    this.render();
  }

  private end() {
    cancelAnimationFrame(this.raf);
    this.ring.classList.add('leaving');
    this.card.classList.add('leaving');
    setTimeout(() => {
      this.ring.hidden = this.card.hidden = true;
      this.ring.classList.remove('leaving');
      this.card.classList.remove('leaving');
    }, 280);
  }

  /** Ring hugs the target; the card sits above it (or below, if no room). */
  private place() {
    const el = this.steps[this.i].target();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 6;
    Object.assign(this.ring.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const w = this.card.offsetWidth, h = this.card.offsetHeight, m = 16, gap = 14;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.min(Math.max(x, m), window.innerWidth - w - m);
    let y = r.top - pad - gap - h;
    if (y < m) y = r.bottom + pad + gap;
    this.card.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}
