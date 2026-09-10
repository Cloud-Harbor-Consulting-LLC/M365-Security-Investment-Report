# Contributing

Contributions are welcome in code and in data. Both matter here, and they have different
bars, so this page covers each on its own terms.

Before anything large, open an issue. A design disagreement is much cheaper to have before
the work than after it.

---

## First, the 2 things that will surprise you

Read these before writing code. Both are enforced by CI, and both will fail a PR for
reasons that look arbitrary if nobody told you.

### 1. The engine exists twice, and the 2 copies must agree

PowerShell collects from Microsoft Graph. TypeScript computes the report. The same
arithmetic is implemented on both sides, and parity tests assert they produce identical
figures to the cent against the fixtures in `tests/fixtures/`.

A change to how a number is derived is therefore usually 2 changes. Change one side only
and the parity tests fail, correctly.

Both tiers read the same reference data, through the `@data` alias:

```
src/CloudHarbor.M365SecurityInvestment/Data/
  sku-catalog.json      feature-map.json      price-list.json
  graph-scopes.json     risk-model.json       default-config.json
```

That is what stops the 2 tiers drifting apart. Never duplicate one of these files into the
app.

### 2. Read-only is enforced, not encouraged

Every Microsoft Graph call is a `GET`. `app/src/graph/readonly.test.ts` and
`tests/ReadOnly.Guard.Tests.ps1` fail the build if a mutating call, a non-read scope, or a
second module calling `fetch` ever appears.

This is the product. It is what persuades a CISO to consent the app. A PR that needs a
write is a PR that needs a conversation first.

The one exception is `scripts/New-AppRegistration.ps1`, which writes to a directory, sits
deliberately outside the module, and is never run by anyone producing a report.

---

## Code contributions

### Setting up

```bash
git clone https://github.com/Cloud-Harbor-Consulting-LLC/M365-Security-Investment-Report.git
cd M365-Security-Investment-Report/app
npm install
npm run dev
```

Open the dev server and choose **Explore the sample tenant**, a synthetic tenant with the
awkward cases built in. You need no Microsoft 365 tenant, no app registration, and no
credentials to work on almost anything here.

For the PowerShell tier you need PowerShell 7.4+, `Microsoft.Graph.Authentication`, Pester
and PSScriptAnalyzer.

### Running what CI runs

```bash
cd app && npm test           # Vitest: engine, parity, exports, accessibility
cd app && npm run build      # type-check and production build
```

```powershell
Invoke-Pester ./tests
Invoke-ScriptAnalyzer -Path ./src, ./tests, ./scripts -Recurse -Severity Warning, Error
```

Run all 4 before opening a PR. CI checks `src`, `tests` and `scripts`. Analysing only
`./src` locally has let a failure through before.

### What makes a change land easily

- **A test that fails before your fix and passes after.** For a bug, this matters more than
  the fix.
- **Real numbers.** Most defects in this project were found against live tenants, not
  fixtures. If you hit one that way, say so, and read the snapshot warning below.
- **The "not measured" rule respected.** Where something cannot be established, the report
  says so and why. It never renders as `0`, `$0`, or a blank. A CFO-facing report must
  never show `$0` where the truth is "we could not look." This has been re-learned enough
  times to be non-negotiable.
- **Comments that say why.** The codebase explains reasoning and records defects that were
  fixed, because that is what stops them coming back.

### Things that will be questioned

- New runtime dependencies. Browser runtime is Preact and MSAL, and that is the whole list.
  Each addition is a supply-chain risk in a tool that touches tenants.
- Anything fetched from a third-party origin at runtime. Fonts are vendored for this
  reason.
- Compliance-framework mapping, Copilot readiness, multi-tenant or MSP mode, and any write
  capability. All deliberately out of scope to protect the positioning, see
  [`docs/DELIVERY-PLAN.md`](docs/DELIVERY-PLAN.md).

---

## Data contributions

The reference data holds the domain knowledge, and it is genuinely hard to get right.
Corrections here matter as much as code.

| File | What it holds |
|---|---|
| `sku-catalog.json` | SKU part numbers, friendly product names, service plans |
| `feature-map.json` | Secure Score controls, and the service plans that entitle them |
| `price-list.json` | Public list prices per SKU |
| `risk-model.json` | Threat likelihood and impact assumptions |

### The evidence bar

Higher than for code, because a wrong mapping produces a confidently wrong dollar figure in
front of a CFO and nobody can tell by looking.

- **Cite a primary source.** Microsoft Learn, the Microsoft 365 service description, or the
  official licensing datasheet. Not a blog, not a forum answer, not an LLM.
- **Mark your confidence**, following the pattern in
  [`docs/CONTROL-ENTITLEMENTS.md`](docs/CONTROL-ENTITLEMENTS.md). "Probably Entra ID P2" is
  a useful contribution when it says so, and a liability when it does not.
- **Map to the minimum service plan** that enables the control, then let the engine attach
  it to the dearest SKU the tenant owns that carries it. Do not map straight to a SKU.
- **Say which tenant shape you saw it on**, such as E3, E5, Business Premium or E7. Coverage
  differs, and the map has been wrong for exactly this reason before.

Prices go stale. A price correction should say what it is as at.

---

## Never commit or attach a tenant snapshot

A snapshot contains user principal names, display names, tenant identifiers, verified
domains, sign-in dates and licence counts.

- `.gitignore` blocks `*snapshot*.json`, and CI fails if one appears outside
  `tests/fixtures/`. Do not work around either.
- The same applies to issues and pull requests. Do not paste one, and do not attach one.

To report something you found on a real tenant, use the synthetic fixtures, or build a
minimal redacted example. The maintainers cannot accept a real snapshot even privately.

---

## Pull requests

- Branch from `main`. Name it for the work: `feat/…`, `fix/…`, `docs/…`.
- One concern per PR. A refactor bundled with a fix is 2 reviews wearing one hat.
- Keep the commit message about why. The diff already says what.
- Fill in the PR template. The checklist is short, and each line has cost someone
  something.
- CI must be green: Vitest, the production build, Pester on Windows and Linux,
  PSScriptAnalyzer, and the repository hygiene checks.

### If your change touches the UI

- Contrast is computed from `tokens.css` in CI, for both themes. New colours must pass.
- Overlays are modal dialogs: Escape, focus trap, focus returned to the trigger.
- Tables need `scope` on headers and a caption.
- The board pack prints. Check `Ctrl+P` still produces 6 clean pages.

---

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Licence

Contributions are accepted under the [MIT Licence](LICENSE), the licence this project ships
under.
