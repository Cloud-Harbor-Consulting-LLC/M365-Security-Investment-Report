# M365 Security Investment Report

**Find the security you already bought but never switched on.**

A read-only PowerShell tool that connects to a single Microsoft 365 tenant, reads its licensing and security-posture signals through Microsoft Graph, and produces a self-contained HTML report — plus JSON and CSV — for two audiences: executives and security architects.

Most Microsoft 365 assessment tools tell you what is misconfigured. This one answers a different question, the one a CFO actually asks:

> *Here is the security value you already paid for, how much of it you have actually turned on, and what it is worth to close the gap.*

> [!WARNING]
> **Pre-release (v0.1.0).** The read-only collector works today and produces a static report. v1.0 is being rebuilt around a **hosted interactive dashboard** with live pricing overrides — see [Status](#status). The shipped price list is **unverified seed data** and must be checked before any client engagement.

---

## Read-only, and provably so

This tool never writes to your tenant. It has no remediation capability, no write scopes, and no code path that could acquire one.

That is not a promise in a README — it is enforced three ways:

1. **One chokepoint.** Every Graph call goes through a single function, `Invoke-CHSIGraphRequest`, which hardcodes the `GET` verb and **exposes no `-Method` parameter**. There is no way for a caller to select a different verb.
2. **No write scopes are ever requested.** The consent dialog shows five read-only scopes and nothing else.
3. **CI enforces it.** [`tests/ReadOnly.Guard.Tests.ps1`](tests/ReadOnly.Guard.Tests.ps1) fails the build if any source file introduces a mutating Graph cmdlet (`New-Mg*`, `Set-Mg*`, `Update-Mg*`, `Remove-Mg*`, …), calls `Invoke-RestMethod`/`Invoke-WebRequest` directly, or gives the chokepoint a `-Method` parameter.

Read that test before you consent the app. It is short, and it is the whole trust argument.

---

## Requirements

| | |
|---|---|
| PowerShell | 7.4 or later |
| Module | `Microsoft.Graph.Authentication` 2.15.0+ |
| Tenant | Any Microsoft 365 commercial tenant |
| Role | Global Reader (plus Security Reader for the Secure Score sections) |

---

## The app

The dashboard is a static site — no backend, no telemetry, nowhere for your tenant data to go.

```bash
npm --prefix app ci
npm --prefix app run dev
```

Or just use the hosted one: **<https://cloud-harbor-consulting-llc.github.io/M365-Security-Investment-Report/>**

Three ways in: **explore the sample tenant** (no sign-in, nothing to install), **connect to a tenant** and sign in — an administrator consents once and Microsoft adds the app to your directory, nothing to register — or **load a snapshot** produced by the PowerShell collector below, for organisations that would rather run code they can read than consent a browser app.

`npm --prefix app test` runs the engine parity suite, which asserts the TypeScript engine produces figures identical to the PowerShell one on the shared fixtures. CI blocks a deploy if they ever disagree.

---

## Quick start (PowerShell collector)

```powershell
Import-Module ./src/CloudHarbor.M365SecurityInvestment/CloudHarbor.M365SecurityInvestment.psd1

Connect-CHSITenant -TenantId contoso.onmicrosoft.com
Test-CHSIPrerequisite          # optional: confirms scopes and config before you collect
New-CHSIReport -OutputPath ./out
Disconnect-CHSITenant
```

That writes four files into `./out`:

```
M365-Security-Investment-contoso-20260903.html            self-contained report
M365-Security-Investment-contoso-20260903.json            full dataset
M365-Security-Investment-contoso-20260903-inventory.csv   one row per SKU
M365-Security-Investment-contoso-20260903-summary.csv      one row per tenant
```

### With negotiated pricing

Microsoft Graph does not expose contract pricing, so every dollar figure comes from a price table you control. The shipped table holds Microsoft public list prices; supply your customer's real EA or CSP rates to replace them:

```powershell
New-CHSIReport -CustomPricing ./contoso-ea-rates.json -ConfigPath ./contoso.json -OutputPath ./out
```

The report states which basis produced its numbers, in the header, every time.

### Unattended

```powershell
Connect-CHSITenant -TenantId contoso.onmicrosoft.com -ClientId $appId -CertificateThumbprint $thumbprint
New-CHSIReport -OutputPath ./out
```

### Offline

Collection and analysis are separate, so a snapshot taken on site can be re-analysed later — with different pricing, say — without going back to the tenant:

```powershell
New-CHSIReport -SaveSnapshot ./contoso-snapshot.json -OutputPath ./out     # collect and report
New-CHSIReport -FromSnapshot ./contoso-snapshot.json -OutputPath ./out     # re-analyse, no credentials
```

Snapshots are a convenience, not state. Nothing is read back automatically and no run depends on a previous one — v1.0 is stateless by design.

---

## Required scopes

Five, all read-only, each earning its place:

| Scope | Required | What it buys | Least-privilege role |
|---|---|---|---|
| `Organization.Read.All` | Yes | Tenant identity and the subscribed SKU inventory the whole report is built on | Global Reader |
| `Directory.Read.All` | Yes | Directory objects and role assignments | Global Reader |
| `User.Read.All` | Yes | Per-user account state and licence assignment — the basis for seat-level waste | Global Reader |
| `AuditLog.Read.All` | No | Sign-in activity, for the never-signed-in and inactive categories | Global Reader |
| `SecurityEvents.Read.All` | No | Secure Score, 90-day history, peer benchmark, and control-level deployment evidence | Security Reader |

**`AuditLog.Read.All` also requires Entra ID P1 on the tenant.** Without it, Graph returns 403 for the *entire* user query, not just the sign-in field. The tool expects this: it retries the identical query without `signInActivity`, still reports unassigned and disabled waste, and labels the sign-in-dependent sections "requires Entra ID P1" rather than showing a misleading zero.

That principle runs throughout. **A CFO-facing report must never show `$0` where the truth is "we could not look."** Every degraded signal renders as an explicit *not measured, and here is why*.

**How to grant these** — including registering the app in your own tenant instead of
consenting to a third-party one, and how to avoid an app registration entirely:
[`docs/APP-REGISTRATION.md`](docs/APP-REGISTRATION.md).

---

## Sample output

[`samples/sample-report.html`](samples/sample-report.html) is a complete report generated from [`tests/fixtures/premium-snapshot.json`](tests/fixtures/premium-snapshot.json), a synthetic tenant built to exercise the edge cases: unlimited-seat free SKUs, an unpriced SKU, and the `O365_BUSINESS_PREMIUM` naming trap. Download and open it — it renders offline with no network access.

The report has three layers in one document:

- **Board one-pager** — annual commitment, spend in use, idle seat spend, realization.
- **Executive summary** — where the spend sits, on what pricing basis, and what is not yet measured.
- **Architect appendix** — per-SKU detail, exclusions with reasons, scopes used, collection provenance, and methodology.

---

## The report as one file

From the app, **Export → The whole report, as one file** produces a single HTML document
holding the tenant's data, the full interactive report, and its own fonts and styles. It
is the artifact to leave with a customer.

Two properties are enforced by tests that run against the built file, not against the
code that assembles it:

- **It reaches no external origin.** No CDN, no font host, no beacon, not even Microsoft.
  Its own Content-Security-Policy is `default-src 'none'`. Opening it tells nobody that
  it was opened — which matters, because it carries a customer's licensing and security
  posture and will end up on mail servers and file shares nobody is auditing.
- **The board figures render without JavaScript.** Locked-down desktops and mail
  previewers refuse scripts, and a security report that appears as a blank page in front
  of a CFO has failed. The headline figures are written into the document as ordinary
  HTML and are replaced by the interactive report only once it has actually mounted, so a
  bundle that fails to run still leaves correct numbers on screen. That summary is also
  what prints.

It is a classic script rather than a module, because Chrome and Edge refuse module scripts
over `file://` — and being double-clicked from a desktop is the entire point.

---

## The board pack

**Board pack** in the app produces six pages for print or PDF, in the order a sceptical
CFO asks the questions: the position, wasted spend, what is paid for and not switched on,
what to do first, and how every figure was made.

There is no PDF library and no server. The browser's own print engine produces the file,
so the text stays selectable and searchable, the type stays vector, and the result is a
few hundred kilobytes rather than the several megabytes a rasterised export would be. A
board pack that cannot be copied out of is a board pack that gets retyped.

The last page is not an appendix. It states which figures are **measured** (Graph, read
only), which were **supplied** (pricing — Graph does not expose contract rates), and which
are **assumed** (likelihood and impact behind any expected-loss figure), because that page
decides whether the other five are believed. Every qualification that lives in a popover
on screen is printed as words on the page: that the per-control costs do not sum, that a
total is a floor, and how much of the tenant the risk figures actually rest on.

Pressing Ctrl+P gives the same pack. The dashboard itself never prints.

---

## Accessibility

The report gets projected in meeting rooms and driven from a keyboard while someone talks
over it, so this is checked in CI rather than asserted in a paragraph.

- **Contrast is computed from `tokens.css` itself**, for both themes, against the pairings
  that actually appear on screen. It cannot drift from the palette: change a token and the
  check recomputes. Text meets WCAG AA (4.5:1); control borders and the focus ring meet
  3:1.
- **The focus ring has its own token.** Cumulus Blue is 2.8:1 on the page background, so
  the brand colour cannot be the focus indicator — a ring below 3:1 is one a keyboard user
  cannot find. The brand hues stay the brand hues; text- and affordance-bearing roles use
  derived shades.
- **Control borders are separate from decorative rules**, because WCAG asks 3:1 of the
  boundary that identifies a control, not of every line on the page.
- **Both overlays are modal dialogs**: Escape closes them, Tab cycles inside them, and
  focus returns to whatever opened them. Tested by pressing the keys, in a DOM.
- **Every table has a caption and column scopes**, so a fifteen-column capability table is
  navigable rather than an unlabelled grid of values.
- The view area is a `main` landmark named by the current view, and changing view is
  announced politely.

---

## How the numbers are built

Two dollar totals, deliberately kept apart, because conflating them is how these reports lose a CFO's trust:

- **Annual commitment** — purchased seats × price. What most EA and CSP agreements actually invoice, assigned or not.
- **Spend in use** — assigned seats × price. The portion in someone's hands.

The gap between them is idle seat spend: money already gone.

Three edge cases are handled explicitly rather than silently:

| Case | Behaviour |
|---|---|
| A SKU with no price entry | Counted in seat totals, excluded from every dollar figure, and named in the report. The totals are a floor, and say so. |
| Free SKUs reporting unlimited seats | Excluded, with the reason shown. Two thresholds: 100,000 seats excludes on count alone; 10,000 only when the SKU is *also* unknown to the catalog and unpriced, since 10,000 is a plausible real purchase. |
| Zero purchased seats | Realization renders as `n/a`, never `0%`. |

**Pricing basis is always stated.** The shipped `pricelist.json` is seeded with Microsoft public list prices and flagged `"verified": false`. Verify it, or supply negotiated rates, before it reaches a client.

---

## Configuration

Copy [`config/chsi-config.example.json`](config/chsi-config.example.json) and pass it with `-ConfigPath`. It drives the pricing basis and currency, the inactivity threshold (default 90 days), the exemption list for service accounts and room resources, the free-SKU seat thresholds, and the risk-model inputs. Anything omitted keeps its default.

---

## Status

| Milestone | Scope | State |
|---|---|---|
| **M0** | Module scaffold, config, CI, read-only guard | ✅ Complete |
| **M1** | Read-only collector, licence inventory, spend, seat realization, static report | ✅ Complete |
| **M2** | Web app skeleton, GitHub Pages deployment, snapshot load | ✅ Complete |
| **M3** | Calculation engine in TypeScript, parity-tested against the M1 fixtures | ✅ Complete |
| **M4** | Sign in from the browser (MSAL, read-only scopes, admin consent) | ✅ Complete |
| **M5** | Dashboard views: board, executive, waste, features, roadmap | ✅ Complete |
| **M6** | Live pricing overrides | ✅ Complete |
| **M7** | Secure Score, feature gaps, remaining waste categories, risk, roadmap | ✅ Complete |
| **M8** | Session files, JSON/CSV, single-file interactive HTML, PDF board pack | ✅ Complete |
| **M9** | Docs, accessibility, licence and privacy review, public launch | 🟡 Accessibility and app-registration guide done |

**Two ways in, by design.** *Connect* signs in from the browser — nothing to install. *Load a snapshot* takes the output of the PowerShell collector, for customers who would rather run code they can read than consent a browser app. Same dashboard either way, and no backend in either case: your tenant data never leaves your browser.

Full plan, including the security and consent design: [`docs/DELIVERY-PLAN.md`](docs/DELIVERY-PLAN.md).

---

## Development

```powershell
'./src', './tests' | ForEach-Object { Invoke-ScriptAnalyzer -Path $_ -Recurse -Severity Error, Warning }
Invoke-Pester -Path ./tests
```

The suite runs entirely offline — no tenant, no credentials — because analysis and rendering never touch the network. `tests/EndToEnd.Offline.Tests.ps1` drives the whole pipeline from a fixture and is the primary regression gate.

---

## Roadmap beyond v1.0

- **Snapshot delta and change tracking between runs** — the quarterly QBR story: *"spend realized 61% → 74%."* The highest-value future feature, and the reason v1.0 stays stateless.
- **Per-gap remediation navigation** — exact portal click-paths instead of Microsoft Learn links.
- **"Newly entitled" flags** — gaps created by Microsoft packaging changes, so a control that silently appeared in your SKU does not sit unconfigured for a year.
- **Direct policy evidence** — reading Conditional Access and Defender policy objects for deployment proof, at the cost of additional scopes. v1.0 deliberately relies on Secure Score control evidence to keep the consent dialog short.
- **Cloud Licensing API** — richer per-subscription allotment detail once it leaves preview.

## Deliberately out of scope

- **Compliance-framework mapping (NIST/CIS/ISO).** A saturated lane — ScubaGear, monkey365 and M365-Assess already do it well.
- **Copilot and AI-readiness assessment.** Different tool, different audience.
- **Multi-tenant or MSP mode.** Single-tenant, consultant-run, by design.
- **Any write or remediation capability.** Read-only, always.

---

## License

MIT — see [LICENSE](LICENSE).

Lato is bundled under the [SIL Open Font License 1.1](src/CloudHarbor.M365SecurityInvestment/Assets/Fonts/OFL.txt).

**No logo, wordmark or trademark ships in this repository.** The palette and typeface carry the visual identity, so a fork inherits a complete, usable tool and no marks it has no right to use. Reports credit whoever prepared them via the `preparedBy` setting, and omit the line entirely when it is unset.

Originally built by [Cloud Harbor Consulting](https://cloudharborconsulting.cloud).
