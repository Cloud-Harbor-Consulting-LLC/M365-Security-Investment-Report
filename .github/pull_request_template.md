## What this changes, and why

<!-- The why matters more than the what. The diff already says what. -->

Closes #

## Checklist

Each of these has cost someone something at least once.

- [ ] **No real tenant data.** No snapshot, no user principal names, no tenant ids or
      verified domains, in the diff, the description, or a screenshot.
- [ ] Tests added or updated. For a bug fix, a test that fails before and passes after.
- [ ] `cd app && npm test` passes.
- [ ] `cd app && npm run build` passes (type-check and production build).
- [ ] `Invoke-Pester ./tests` passes.
- [ ] PSScriptAnalyzer is clean across all 3 roots. CI checks more than `./src`:
      `foreach ($r in './src','./tests','./scripts') { Invoke-ScriptAnalyzer -Path $r -Recurse -Severity Warning, Error }`
- [ ] The repository hygiene checks pass: `check-no-tenant-data.sh`, `check-doc-links.mjs`,
      `check-doc-style.mjs`, `check-price-claims.mjs`.

### If you changed how a figure is derived

- [ ] Both tiers updated, or a reason why only one needed to change.
- [ ] Parity tests still pass. The TypeScript engine and the PowerShell fixtures agree.
- [ ] Nothing unavailable renders as `0`, `$0`, or a blank. It says so, and says why.

### If you changed reference data

- [ ] A primary source is cited (Microsoft Learn or an official service description).
- [ ] Confidence is marked, following `docs/CONTROL-ENTITLEMENTS.md`.
- [ ] Controls map to the minimum service plan, not straight to a SKU.

### If you changed the UI

- [ ] Contrast still passes in both themes (checked in CI from `tokens.css`).
- [ ] Keyboard: reachable, visible focus, and dialogs still trap and restore focus.
- [ ] New tables have `scope` on headers and a caption.
- [ ] The board pack still prints cleanly (`Ctrl+P`).

## Anything you are unsure about

<!-- Useful. Reviewers would rather know where you were unsure than guess. -->
