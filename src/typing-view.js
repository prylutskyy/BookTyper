// A bounded text surface. The caret is a single compositor layer, independent
// of character annotations, so typing and deleting never restart its animation.
export class TypingView {
  constructor(area) {
    this.area = area;
    this.flow = area.querySelector('.typing-content');
    this.text = area.querySelector('#text-window');
    this.history = area.querySelector('.typing-history');
    this.upcoming = area.querySelector('.typing-preview');
    this.caret = area.querySelector('#typing-caret');
    this.nodes = new Map();
    this.position = 0;
    this.visual = null;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.onMotion = () => this.update(this.position, true);
    this.motion.addEventListener('change', this.onMotion);
    this.resize = new ResizeObserver(() => this.update(this.position, true));
    this.resize.observe(area);
  }
  render(record, position, continuous = false) {
    let history = [];
    if (continuous) {
      const before = [...this.flow.querySelectorAll('[data-offset]')].filter(node => Number(node.dataset.offset) < record.start);
      const last = before.at(-1);
      if (last) {
        const line = parseFloat(getComputedStyle(this.flow).lineHeight);
        // Start on an existing visual line to preserve wrapping across chunks.
        history = before.filter(node => node.offsetTop >= last.offsetTop - line * 2 - 1);
      }
    }
    const oldOrigin = history[0]?.offsetTop;
    this.history.replaceChildren(...history);
    this.upcoming.replaceChildren();
    this.nodes.clear();
    const fragment = document.createDocumentFragment();
    let offset = record.start;
    for (const char of record.text) {
      const node = this.character(char, offset);
      if (offset < position) node.className = record.wrongOffsets.has(offset - record.start) ? 'wrong' : 'typed';
      if (offset === position) node.classList.add('caret');
      this.nodes.set(offset, node); fragment.append(node); offset += char.length;
    }
    this.text.replaceChildren(fragment);
    this.position = position;
    if (history.length && this.visual) {
      // Removing old lines changes the coordinate origin, not their visible
      // position. Rebase an in-flight animation rather than snapping it.
      const shift = oldOrigin - history[0].offsetTop;
      this.visual.y -= shift; this.visual.scroll -= shift;
      if (this.target) { this.target.y -= shift; this.target.scroll -= shift; }
      this.draw();
      this.update(position);
    } else this.update(position, true);
  }
  character(char, offset) {
    const node = document.createElement('span');
    node.textContent = char === '\n' ? '↵\n' : char;
    node.dataset.offset = offset;
    return node;
  }
  preview(record) {
    if (!record) return;
    const fragment = document.createDocumentFragment();
    let offset = record.start;
    // Enough ahead for several lines on a phone; independent of book size.
    for (const char of record.text) {
      if (offset - record.start >= 400) break;
      const node = this.character(char, offset);
      this.nodes.set(offset, node); fragment.append(node); offset += char.length;
    }
    this.upcoming.replaceChildren(fragment);
  }
  activity() {
    this.area.classList.add('is-typing');
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.area.classList.remove('is-typing'), 650);
  }
  update(position, snap = false) {
    this.position = position;
    const node = this.nodes.get(position);
    if (!node || !this.area.isConnected) return;
    // One geometry read per animation frame, before statistics DOM writes.
    const top = node.offsetTop, left = node.offsetLeft;
    const size = parseFloat(getComputedStyle(this.flow).fontSize);
    const line = parseFloat(getComputedStyle(this.flow).lineHeight);
    const anchor = Math.min(line * 2 + 8, this.area.clientHeight * .3);
    const target = { x: left - 1, y: top, scroll: Math.max(0, top - anchor) };
    // A line wrap must not sweep the caret diagonally across the paragraph.
    if (this.visual && this.target && Math.abs(top - this.target.y) > line / 2) this.visual.x = target.x;
    this.target = target;
    this.caret.style.height = `${size * 1.2}px`;
    if (snap || !this.visual || this.motion.matches) {
      cancelAnimationFrame(this.frame); this.frame = null;
      this.visual = { ...target }; this.draw();
    } else if (!this.frame) {
      this.lastFrame = performance.now() - 16;
      this.animate(performance.now());
    }
  }
  draw() {
    this.flow.style.transform = `translate3d(0,${-this.visual.scroll}px,0)`;
    this.caret.style.transform = `translate3d(${this.visual.x}px,${this.visual.y}px,0)`;
  }
  animate(now) {
    // One clock and one interpolation factor for text and caret. Equal changes
    // in line position and scroll cancel exactly, avoiding a vertical bounce.
    const blend = 1 - Math.exp(-Math.min(64, now - this.lastFrame) / 22);
    this.lastFrame = now;
    let distance = 0;
    for (const key of ['x', 'y', 'scroll']) {
      this.visual[key] += (this.target[key] - this.visual[key]) * blend;
      distance = Math.max(distance, Math.abs(this.target[key] - this.visual[key]));
    }
    if (distance < .08) this.visual = { ...this.target };
    this.draw();
    this.frame = distance < .08 ? null : requestAnimationFrame(time => this.animate(time));
  }
  destroy() {
    this.resize.disconnect();
    clearTimeout(this.idle);
    cancelAnimationFrame(this.frame);
    this.motion.removeEventListener('change', this.onMotion);
  }
}
