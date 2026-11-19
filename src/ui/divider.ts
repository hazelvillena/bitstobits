/** Draggable divider between the two panes. Position is remembered. */
export function initDivider(stage: HTMLElement, seam: HTMLElement) {
  const KEY = 'b2b.split.v2';
  const rows = () => stage.classList.contains('rows');
  const set = (pct: number) => {
    const v = Math.min(80, Math.max(20, pct));
    stage.style.setProperty('--split', `${v}%`);
    return v;
  };
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved) set(saved);
  } catch { /* storage unavailable */ }

  let current = 66.667;
  const move = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    current = set(rows() ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100);
  };
  seam.addEventListener('pointerdown', (e) => {
    seam.setPointerCapture(e.pointerId);
    seam.classList.add('dragging');
    document.body.classList.add('resizing');
    document.body.classList.toggle('rows-resize', rows());
    move(e);
  });
  seam.addEventListener('pointermove', (e) => {
    if (seam.hasPointerCapture(e.pointerId)) move(e);
  });
  const end = (e: PointerEvent) => {
    if (!seam.hasPointerCapture(e.pointerId)) return;
    seam.releasePointerCapture(e.pointerId);
    seam.classList.remove('dragging');
    document.body.classList.remove('resizing', 'rows-resize');
    try {
      localStorage.setItem(KEY, String(current));
    } catch { /* ignore */ }
  };
  seam.addEventListener('pointerup', end);
  seam.addEventListener('pointercancel', end);
  // Double-click returns to the default: sculpting gets two thirds.
  seam.addEventListener('dblclick', () => {
    current = set(66.667);
    try {
      localStorage.setItem(KEY, '66.667');
    } catch { /* ignore */ }
  });
}
