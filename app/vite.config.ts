// defineConfig from vitest/config rather than vite: it is the Vite config type widened
// to accept the `test` key, so the aliases below are shared by the build and the tests
// instead of being maintained twice.
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// GitHub Pages project sites are served from /<repo>/. Overridable so a custom
// domain (or a local single-file build) needs no code change.
const base = process.env.VITE_BASE ?? '/M365-Security-Investment-Report/';

export default defineConfig({
  base,
  plugins: [preact()],
  resolve: {
    alias: {
      // The engine reads the SAME reference data the PowerShell collector ships.
      // Not a copy — the actual files. This is the anti-drift guarantee.
      '@data': here('../src/CloudHarbor.M365SecurityInvestment/Data'),
      '@fixtures': here('../tests/fixtures'),
      '@': here('./src'),
    },
  },
  server: {
    // Needed because @data and @fixtures resolve outside the app root.
    fs: { allow: [here('..')] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        // Two entry points. redirect.html is the sign-in popup's landing page and must
        // be bundled, not static, because the MSAL redirect bridge is a package subpath
        // import that only a bundler can resolve.
        main: here('./index.html'),
        redirect: here('./redirect.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
