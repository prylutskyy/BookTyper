const codes = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];
const layouts = {
  en: ['`~ 1! 2@ 3# 4$ 5% 6^ 7& 8* 9( 0) -_ =+', 'qQ wW eE rR tT yY uU iI oO pP [{ ]} \\|', 'aA sS dD fF gG hH jJ kK lL ;: \'"', 'zZ xX cC vV bB nN mM ,< .> /?'],
  uk: ["'₴ 1! 2\" 3№ 4; 5% 6: 7? 8* 9( 0) -_ =+", 'йЙ цЦ уУ кК еЕ нН гГ шШ щЩ зЗ хХ їЇ \\/', 'фФ іІ вВ аА пП рР оО лЛ дД жЖ єЄ', 'яЯ чЧ сС мМ иИ тТ ьЬ бБ юЮ .,'],
};
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const normal = char => ({ '«': '"', '»': '"', '“': '"', '”': '"', '„': '"', '’': "'", '‘': "'", 'ʼ': "'", '—': '-', '–': '-', '\u00a0': ' ' })[char] || char;

export class KeyboardGuide {
  constructor(root, settings) {
    this.root = root; this.settings = settings; this.layout = 'uk';
    this.expected = ''; this.keys = [];
  }
  render(layout) {
    this.layout = layout;
    const special = (code, label, width) => `<span class="keyboard-key key-wide" data-code="${code}" style="--key-width:${width}">${label}</span>`;
    this.root.innerHTML = `<div class="keyboard-caption"><span>${layout === 'uk' ? 'Українська' : 'English'}</span><span>Підсвічено наступну клавішу</span></div><div class="keyboard-keys" aria-hidden="true">${layouts[layout].map((row, r) => `<div class="keyboard-row">${r === 1 ? special('Tab', 'Tab', 1.45) : r === 2 ? special('CapsLock', 'Caps', 1.8) : r === 3 ? special('ShiftLeft', 'Shift', 2.3) : ''}${row.split(' ').map((pair, i) => `<span class="keyboard-key" data-code="${codes[r][i]}" data-pair="${escape(pair)}">${escape(pair[0])}</span>`).join('')}${r === 0 ? special('Backspace', '⌫', 1.7) : r === 2 ? special('Enter', 'Enter', 2.1) : r === 3 ? special('ShiftRight', 'Shift', 2.6) : ''}</div>`).join('')}<div class="keyboard-row">${special('Space', 'Пробіл', 7)}</div></div>`;
    this.keys = [...this.root.querySelectorAll('.keyboard-key')];
  }
  keyFor(char) {
    if (char === '\n') return this.keys.find(key => key.dataset.code === 'Enter');
    if (char === ' ') return this.keys.find(key => key.dataset.code === 'Space');
    const value = this.settings.relaxed ? normal(char) : char;
    return this.keys.find(key => key.dataset.pair?.includes(value));
  }
  update(expected) {
    this.expected = expected || '';
    let layout = this.settings.keyboardLayout || 'auto';
    if (layout === 'auto') layout = /[a-z]/i.test(expected) ? 'en' : /[\u0400-\u04ff]/.test(expected) ? 'uk' : this.layout;
    if (this.layout !== layout || !this.keys.length) this.render(layout);
    for (const key of this.keys) key.classList.remove('next-key');
    const key = this.keyFor(expected);
    key?.classList.add('next-key');
    if (expected === '\n') this.keys.find(key => key.dataset.code === 'Space')?.classList.add('next-key');
    const value = this.settings.relaxed ? normal(expected) : expected;
    if (key?.dataset.pair?.indexOf(value) === 1) this.keys.filter(key => key.dataset.code.startsWith('Shift')).forEach(key => key.classList.add('next-key'));
    this.root.hidden = this.settings.keyboard === false;
  }
  press(char, correct = true) {
    const key = this.keyFor(char);
    if (!key) return;
    key.classList.add(correct ? 'key-pressed' : 'key-error');
    clearTimeout(this.release);
    this.release = setTimeout(() => this.keys.forEach(key => key.classList.remove('key-pressed', 'key-error')), 120);
  }
  destroy() { clearTimeout(this.release); }
}
