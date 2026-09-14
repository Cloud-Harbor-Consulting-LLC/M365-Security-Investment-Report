# Architecture

How this tool is put together, and why each piece is where it is. Written for someone who
has forked the repository and wants to change something without breaking a guarantee.

For how figures are derived, see [METHODOLOGY.md](METHODOLOGY.md). For consent and app
registration, see [APP-REGISTRATION.md](APP-REGISTRATION.md).

---

## The shape of it

Three tiers, and one rule that explains most of the design: **each fact is produced in
exactly one place.**

```
   ┌─ MODE A · CONNECT ──────────┐      ┌─ MODE B · LOAD A SNAPSHOT ────────┐
   │ MSAL.js, auth code + PKCE   │      │ PowerShell collector runs locally │
   │ Browser calls Graph, GET     │      │ Get-CHSISnapshot -> snapshot.json │
   │ Nothing to install           │      │ The file is dropped on the page   │
   │ Needs admin consent, once    │      │ No consent, no app registration   │
   └─────────────┬────────────────┘      └───────────────┬───────────────────┘
                 └───────────────┬───────────────────────┘
                                 v
┌─ ENGINE ──────────────────────────────── TypeScript, runs in the browser ──┐
│  Pure functions. Facts + reference data + overrides -> model.              │
│  inventory · spend · seat waste · feature gaps · risk · roadmap            │
│  Recomputes in full on every override                                      │
└────────────────────────────────────────────────────────────────────────────┘
                                 v
┌─ SURFACES ─────────────────────────────────────────────────────────────────┐
│  Dashboard · board pack · single-file HTML · JSON and CSV · session files   │
└────────────────────────────────────────────────────────────────────────────┘
```

The app is a static site. There is no backend, which is why there is nowhere for tenant
data to go. That is a structural property, not a policy: see [PRIVACY.md](PRIVACY.md).

---

## Why there are two ways in

Mode A asks an administrator to consent to a third-party application in their directory.
Some organisations will not do that, and no amount of documentation changes it.

Mode B exists for them. The PowerShell collector is a few hundred lines they can read line
by line, it registers nothing and consents to nothing, and it produces a file they can
inspect before it goes anywhere near the app. Both modes reach the same dashboard with the
same figures, so neither is a degraded path.

---

## Why the engine runs in the browser

Changing a price recalculates everything downstream: spend, seat waste, the dollar value on
each undeployed capability, expected loss, and the roadmap ranking that depends on all of
them. Putting that arithmetic in the page means the whole model recomputes as the figure is
typed, and an exported report stays interrogable after the fact rather than being a
snapshot of one set of assumptions.

## Why the engine exists twice anyway

The PowerShell module computes the same figures, and parity tests assert the two agree to
the cent against shared fixtures.

This is the cost of Mode B: an organisation running the collector on its own infrastructure
should be able to produce a report there too, without a browser. The parity tests are what
make the duplication safe, and they are the reason a change to how a figure is derived is
usually 2 changes rather than 1.

Both tiers read the same reference data from
`src/CloudHarbor.M365SecurityInvestment/Data/`, the TypeScript side through the `@data`
alias. Neither tier owns a private copy, so the catalogue, the price table, the entitlement
map and the scope list cannot drift between them.

---

## The read-only guarantee

The guarantee spans 2 languages, and is enforced in both rather than documented in either.

- **PowerShell.** One `GET`-only chokepoint. No mutating `*-Mg*` cmdlet appears anywhere.
  Enforced by [`tests/ReadOnly.Guard.Tests.ps1`](../tests/ReadOnly.Guard.Tests.ps1).
- **TypeScript.** A single `graphGet()` client that hardcodes the method and exposes no
  parameter for it, so no caller can choose a verb. A test fails the build on any request
  to Graph with another method, and on any request to a non-Microsoft origin. See
  [`app/src/graph/readonly.test.ts`](../app/src/graph/readonly.test.ts).

Both derive their scope list from the same JSON, and the tests assert the 2 tiers request
an identical set. The consent screen, the documentation and the code therefore cannot
disagree about what is being asked for.

There is no remediation feature and no code path that could acquire one. Adding a write
would mean deleting a test, which is a visible act in a pull request rather than an
accident.

---

## Browser security

- **Authorization code flow with PKCE.** No implicit flow and no client secret, neither of
  which a single-page application can hold safely.
- **Read-only delegated scopes only**, 5 of them, 2 optional.
- **Tokens in `sessionStorage`**, cleared when the tab closes. Never `localStorage`, never
  a cookie, never written into an export or a session file.
- **A strict Content-Security-Policy**, with Microsoft's endpoints explicitly allow-listed
  and nothing else reachable. The one-file export goes further: `default-src 'none'`, and a
  test scans the built artifact for any external reference.
- **No analytics, telemetry, or error-reporting endpoint.** A tool pointed at a customer's
  directory must not phone home, and the absence is asserted rather than promised.

---

## The model contract

The seam between tiers is a small set of types, validated on both sides:

| | |
|---|---|
| `Snapshot` | Facts as collected, plus provenance. PowerShell writes it, the engine reads it. |
| `ReferenceData` | Catalogue, price table, entitlement map, risk model. |
| `Overrides` | User-supplied prices and settings. |
| `ReportModel` | Everything computed. The engine writes it; views and exports only read it. |

Views never compute. If a figure appears on screen it came from `ReportModel`, which is
what keeps the dashboard, the board pack, the one-file report and the CSV exports in
agreement.

---

## Front-end stack

- **Preact and TypeScript, built with Vite.** Preact's runtime is around 10 kB where
  React's is nearer 45 kB, which matters because the whole application inlines into the
  single-file export.
- **`@azure/msal-browser`** for Mode A.
- **2 build targets from one codebase**: the multi-file build deployed to GitHub Pages, and
  a single-file build that inlines everything, including fonts, into one HTML file that
  opens offline.
- **Charts are hand-written SVG components.** The needs are few and specific, and a charting
  library costs 40 kB to 200 kB, brings its own licence, and has to be fought to match a
  palette.
- **PDF comes from the browser's own print path** against a dedicated print stylesheet.
  No PDF library, and no server.

The runtime dependency list is deliberately 2 packages. Every addition is supply-chain risk
in a tool pointed at customer tenants, which is why
[CONTRIBUTING.md](../CONTRIBUTING.md) says a new one will be questioned.

---

## No marks ship in this repository

The palette and the typeface carry the visual identity. No logo, wordmark or favicon
belonging to any company is in this repository, including the one belonging to the firm
that wrote it.

A trademark travelling with every fork is wrong twice: the forker inherits a mark they have
no right to use, and the owner of the mark loses control of where it appears. So a fork
inherits a complete, usable tool and no marks.

Reports credit whoever prepared them through the `preparedBy` setting, and omit the line
entirely when it is unset. [`tests/EndToEnd.Offline.Tests.ps1`](../tests/EndToEnd.Offline.Tests.ps1)
fails the build if a mark reappears.

What does ship: the 6-colour palette with accessible derived shades, and **Lato**,
self-hosted from the repository under the SIL Open Font License rather than fetched from a
font host, so the CSP stays tight and no third party sees a viewer's IP address.

---

## Tests, and what each kind is for

| | |
|---|---|
| **Engine parity** | The 2 engines agree to the cent on shared fixtures. This is what makes the duplication safe. |
| **Read-only guards** | Both tiers, including the scope sets. Described above. |
| **View and component tests** | Nothing unknown renders as `0`, `$0` or a blank. "Not measured" is a state, not an absence. |
| **Accessibility** | Contrast computed from the design tokens for both themes, focus behaviour, table semantics. The report gets projected in meeting rooms. |
| **Export integrity** | The single-file pack reaches no external origin, and still shows correct board figures with JavaScript disabled. |
| **Repository hygiene** | No real tenant data, links resolve, the writing rules hold, and the documented price counts match the price table. |

The whole suite runs offline, with no tenant and no credentials.

---

## Deployment

GitHub Actions builds and publishes to GitHub Pages on merge to `main`. The client ID for
Mode A is a build-time constant, and supplying your own is an option rather than a
prerequisite. A fork that wants its own hosted instance needs its own app registration and
its own redirect URI; [APP-REGISTRATION.md](APP-REGISTRATION.md) covers both.
