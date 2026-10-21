import { defineConfig } from 'vite';

export default defineConfig({
  // The same static build works at /, /BookTyper/, or another directory.
  base: './',
  worker: { format: 'es' },
});
