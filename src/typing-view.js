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
    const oldOrigin = history.length ? history[0].getClientRects()[0].top - this.flow.getBoundingClientRect().top : 0;
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
      const shift = oldOrigin - (history[0].getClientRects()[0].top - this.flow.getBoundingClientRect().top);
      this.visual.y -= shift; this.visual.scroll -= shift;
      if (this.target) { this.target.y -= shift; this.target.scroll -= shift; }
      if (this.from) { this.from.y -= shift; this.from.scroll -= shift; }
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
    const rect = node.getClientRects()[0], origin = this.flow.getBoundingClientRect();
    if (!rect) return;
    const top = rect.top - origin.top, left = rect.left - origin.left;
    const size = parseFloat(getComputedStyle(this.flow).fontSize);
    const line = parseFloat(getComputedStyle(this.flow).lineHeight);
    const anchor = Math.min(line * 2 + 8, this.area.clientHeight * .3);
    const target = { x: left - 1, y: top, scroll: Math.max(0, top - anchor) };
    const now = performance.now();
    // Retarget from the position at this instant, not the previous frame.
    if (this.frame) this.sample(now);
    const unchanged = this.target && ['x', 'y', 'scroll'].every(key => Math.abs(target[key] - this.target[key]) < .001);
    if (unchanged && !snap && !this.motion.matches) return;
    // A line wrap must not sweep the caret diagonally across the paragraph.
    if (this.visual && this.target && Math.abs(top - this.target.y) > line / 2) {
      this.visual.x = target.x;
    }
    this.target = target;
    this.caret.style.height = `${size * 1.2}px`;
    if (snap || !this.visual || this.motion.matches || Math.abs(target.scroll - this.visual.scroll) > this.area.clientHeight) {
      cancelAnimationFrame(this.frame); this.frame = null;
      this.visual = { ...target }; this.draw();
    } else {
      this.from = { ...this.visual };
      this.started = now;
      if (!this.frame) this.frame = requestAnimationFrame(time => this.animate(time));
    }
  }
  draw() {
    this.flow.style.transform = `translate3d(0,${-this.visual.scroll}px,0)`;
    this.caret.style.transform = `translate3d(${this.visual.x}px,${this.visual.y}px,0)`;
  }
  sample(now) {
    // A finite 85 ms movement with gentle, symmetric power easing. It arrives
    // exactly at the letter instead of leaving a slowly settling spring tail.
    const progress = Math.max(0, Math.min(1, (now - this.started) / 85));
    const blend = progress < .5 ? (2 * progress) ** 1.25 / 2 : 1 - (2 * (1 - progress)) ** 1.25 / 2;
    for (const key of ['x', 'y', 'scroll']) {
      this.visual[key] = this.from[key] + (this.target[key] - this.from[key]) * blend;
    }
    return progress === 1;
  }
  animate(now) {
    const settled = this.sample(now);
    this.draw();
    this.frame = settled ? null : requestAnimationFrame(time => this.animate(time));
  }
  destroy() {
    this.resize.disconnect();
    clearTimeout(this.idle);
    cancelAnimationFrame(this.frame);
    this.motion.removeEventListener('change', this.onMotion);
  }
}
