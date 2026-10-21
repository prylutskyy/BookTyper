// Decode only the selected FB2 image, in aligned blocks, without retaining its base64 text.
export class Base64Cover {
  constructor(type) { this.type = type; this.pending = ''; this.parts = []; this.invalid = false; }
  write(text) {
    if (this.invalid) return;
    this.pending += text.replace(/\s+/g, '');
    const count = this.pending.length - this.pending.length % 4;
    if (count) {
      try {
        const decoded = atob(this.pending.slice(0, count));
        this.parts.push(Uint8Array.from(decoded, char => char.charCodeAt(0)));
      } catch { this.invalid = true; this.parts = []; }
      this.pending = this.pending.slice(count);
    }
  }
  finish() {
    if (this.pending) this.write('='.repeat((4 - this.pending.length % 4) % 4));
    return !this.invalid && this.parts.length ? new Blob(this.parts, { type: this.type }) : null;
  }
}
