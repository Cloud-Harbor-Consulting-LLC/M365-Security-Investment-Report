/**
 * The build that produces the one-file report template.
 *
 * Its output is not a site. It is a single HTML document with every script, stylesheet
 * and font inlined, carrying placeholders where a tenant's data will go, which the
 * running app fills in when someone exports. That document then becomes the deliverable
 * a consultant leaves with a customer.
 *
 * Three settings carry the whole design, and none of them is incidental:
 *
 *   format: 'iife'  — a classic script, not a module. Chrome and Edge refuse module
 *                     scripts over file://, and this file's entire purpose is to be
 *                     double-clicked from a desktop.
 *   inlineDynamicImports — one chunk. Nothing to fetch means nothing to fail.
 *   assetsInlineLimit    — high enough to swallow the Lato faces as data URIs, so the
 *                          report keeps its typography with no font host to call.
 */
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const OUT_DIR = here('./.standalone-build');
const TEMPLATE = here('./src/standalone/template.html');

/**
 * Folds the built assets into the HTML and writes the template the app imports.
 *
 * Vite has no built-in way to emit a genuinely single file, so this reads what the
 * build produced and does the substitution itself. Anything left referencing an asset
 * path afterwards is a bug, and the standalone tests assert exactly that by scanning
 * the finished template for absolute URLs.
 */
function foldIntoOneFile() {
  return {
    name: 'chsi-fold-into-one-file',
    closeBundle() {
      const htmlPath = join(OUT_DIR, 'standalone.html');
      let html = readFileSync(htmlPath, 'utf8');

      const asset = (file: string) => readFileSync(join(OUT_DIR, file), 'utf8');

      // A script element ends at the literal text "</script>" wherever it occurs — a
      // bundled string containing it would end the block early and spill code into the
      // document. The escape is invisible to the JavaScript parser.
      const safeScript = (js: string) => js.replace(/<\/script/gi, '<\\/script');

      // Vite hoists the entry script into <head>. That is right for a module script,
      // which defers by definition, and wrong for this one: an inline classic script
      // cannot defer — the attribute is ignored on inline scripts — so in <head> it
      // would run before #app exists and the report would silently never mount, leaving
      // every reader with the printed summary. So it is pulled out and re-inserted last,
      // which also means the board figures are parsed and painted before 440 kB of
      // bundle is handed to the JavaScript engine.
      let entry = '';
      html = html.replace(/<script[^>]*\ssrc="([^"]+)"[^>]*><\/script>/g, (_m, src: string) => {
        entry = safeScript(asset(src.replace(/^\.?\//, '')));
        return '';
      });
      if (!entry) throw new Error('The standalone build emitted no entry script to inline.');

      html = html.replace(
        /<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"[^>]*>/g,
        (_m, href: string) => `<style>${asset(href.replace(/^\.?\//, ''))}</style>`,
      );

      // Vite writes a crossorigin attribute for the hosted case. On file:// it is at
      // best meaningless and at worst a reason for a browser to refuse the tag.
      html = html.replace(/\s+crossorigin(?:="[^"]*")?/g, '');

      // Nothing may still point at a file. Vite does not fail when it cannot resolve an
      // asset — it leaves the URL alone — so a missing font produced a report that
      // silently rendered in a fallback face and referenced a path that would not exist
      // beside the delivered file. CI caught it; the build should have. Anything that is
      // not a data: URI or an in-document fragment is a dangling reference.
      // Scoped to the stylesheets. A case-insensitive url( scan over the whole document
      // also matches URL( in minified JavaScript, which is not a stylesheet reference.
      const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n');
      const dangling = [...css.matchAll(/url\(\s*["']?([^)"']+)/gi)]
        .map((m) => m[1]!.trim())
        .filter((u) => !u.startsWith('data:') && !u.startsWith('#'));
      if (dangling.length > 0) {
        throw new Error(
          `The standalone template still references ${dangling.length} external file(s), so it is not self-contained: ${[
            ...new Set(dangling),
          ]
            .slice(0, 5)
            .join(', ')}. Check that "npm run sync-assets" ran and that assetsInlineLimit is above their size.`,
        );
      }

      if (!html.includes('</body>')) throw new Error('The standalone shell has no </body> to insert before.');
      // A replacer function, not a replacement string. In a replacement string "$&" and
      // "$'" are substitution patterns, and minified JavaScript is full of both — the
      // first attempt at this line spliced a second copy of the document into itself and
      // tripled the file. A function receives the text verbatim.
      html = html.replace('</body>', () => `<script>${entry}</script>\n  </body>`);

      mkdirSync(dirname(TEMPLATE), { recursive: true });
      writeFileSync(TEMPLATE, html, 'utf8');
      rmSync(OUT_DIR, { recursive: true, force: true });

      const kb = (html.length / 1024).toFixed(0);
      // eslint-disable-next-line no-console
      console.log(`\n  standalone template  ${kb} kB  →  src/standalone/template.html\n`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), foldIntoOneFile()],
  resolve: {
    alias: [
      // The export panel lazy-imports the builder. Inside this build that import must
      // not resolve to the real one: it would pull in both the template (a copy of this
      // very file) and the placeholder tokens the template is assembled around, and a
      // report carrying those tokens would rewrite its own JavaScript on the next
      // substitution. The stub keeps the code path compiling and makes the button's
      // absence in this build a fact rather than a hope.
      { find: /^@\/standalone\/build$/, replacement: here('./src/standalone/no-builder.ts') },
      { find: '@data', replacement: here('../src/CloudHarbor.M365SecurityInvestment/Data') },
      { find: '@fixtures', replacement: here('../tests/fixtures') },
      { find: '@', replacement: here('./src') },
    ],
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    // Comfortably above the two Lato faces (~75 kB each) so they inline as data URIs.
    assetsInlineLimit: 512 * 1024,
    // Nothing is served from this build, so a map would only be a dangling reference
    // in a file that is meant to reference nothing.
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: here('./standalone.html'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
