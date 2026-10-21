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
    this.scroll = 0;
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
    this.update(position, true);
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
    this.scroll = Math.max(0, top - 65);
    if (snap) this.flow.classList.add('instant');
    this.flow.style.transform = `translate3d(0,${-this.scroll}px,0)`;
    this.caret.style.height = `${size * 1.2}px`;
    this.caret.style.transform = `translate3d(${left - 1}px,${top}px,0)`;
    if (snap) {
      // Commit the new coordinate origin before restoring movement transitions.
      this.flow.getBoundingClientRect();
      this.flow.classList.remove('instant');
    }
  }
  destroy() {
    this.resize.disconnect();
    clearTimeout(this.idle);
  }
}
