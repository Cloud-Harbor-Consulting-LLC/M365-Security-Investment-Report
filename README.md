# M365 Security Investment Report

**Find the security you already bought but never switched on.**

Most Microsoft 365 assessment tools tell you what is misconfigured. This one answers the
question a CFO actually asks:

> *Here is the security value you already paid for, how much of it you have actually turned
> on, and what it is worth to close the gap.*

It reads one tenant through Microsoft Graph, read-only, and produces a board pack, an
interactive report that works offline, and JSON and CSV for finance.

**<https://cloud-harbor-consulting-llc.github.io/M365-Security-Investment-Report/>** —
choose **Explore the sample tenant** to see the whole thing with no sign-in and nothing
installed.

> [!WARNING]
> **Pre-1.0.** Everything described here works, but the public-launch pass (docs, licence
> review, screenshots) is still in progress — see [Status](#status). The shipped price list
> holds **unverified public list prices** and must be checked or replaced before any client
> engagement.

---

## Read-only, and provably so

This tool never writes to your tenant. It has no remediation capability, no write scopes,
and no code path that could acquire one.

That is not a promise in a README — it is enforced by tests that fail the build:

1. **One chokepoint.** Every Graph call goes through a single function that hardcodes `GET`
   and **exposes no method parameter**. No caller can choose a verb.
2. **No write scope is ever requested.** Five read-only scopes, and the guards reject any
   scope that is not `.Read` or `.Read.All`.
3. **CI enforces both**, on both tiers —
   [`tests/ReadOnly.Guard.Tests.ps1`](tests/ReadOnly.Guard.Tests.ps1) and
   [`app/src/graph/readonly.test.ts`](app/src/graph/readonly.test.ts) — and they must
   request the identical scope set.

Read those tests before you consent the app. They are short, and they are the whole trust
argument.

There is also **no backend**. The app is static files; collection goes browser → Microsoft
Graph → browser, and nothing is uploaded anywhere. See [PRIVACY.md](docs/PRIVACY.md).

---

## Three ways in

| | What it needs |
|---|---|
| **Explore the sample tenant** | Nothing. A synthetic tenant with the awkward cases built in. |
| **Connect to a tenant** | An administrator consents once. Nothing to register, nothing to install. |
| **Load a snapshot** | Run the PowerShell collector yourself and drop the file in — for organisations that would rather run code they can read than consent a browser app. |

Same dashboard, same figures, same exports either way.

Consent, registering your own app, or avoiding registration entirely:
[APP-REGISTRATION.md](docs/APP-REGISTRATION.md).

---

## What you get

- **Board pack** — six pages for print or PDF, in the order a sceptical CFO asks the
  questions, ending with what is measured, what was supplied, and what is assumed.
- **One interactive HTML file** — the whole report, offline, reaching no external origin,
  and still showing the board figures with JavaScript disabled. The artifact to leave
  behind.
- **JSON and CSV** — seven sections plus a README naming which figures are measured and
  which are assumed, because the file is the copy that gets forwarded.
- **Session files** — tenant data plus your negotiated prices, reopenable later.

---

## Quick start (PowerShell collector)

```powershell
Import-Module ./src/CloudHarbor.M365SecurityInvestment/CloudHarbor.M365SecurityInvestment.psd1

Connect-CHSITenant -TenantId contoso.onmicrosoft.com
Test-CHSIPrerequisite          # optional: confirms scopes and config before you collect
Get-CHSISnapshot -Path snapshot.json
Disconnect-CHSITenant
```

Then drop `snapshot.json` into the app. Or produce the static report locally:

```powershell
New-CHSIReport -OutputPath ./out
```

### With negotiated pricing

Microsoft Graph does not expose contract pricing, so every dollar figure comes from a price
table you control. The shipped table holds public list prices, which **overstate** what you
actually pay:

```powershell
New-CHSIReport -CustomPricing ./contoso-ea-rates.json -ConfigPath ./contoso.json -OutputPath ./out
```

The report states which basis produced its numbers, every time. In the app, prices can be
edited live and every dependent figure moves.

### Unattended, and offline

```powershell
Connect-CHSITenant -TenantId contoso.onmicrosoft.com -ClientId $appId -CertificateThumbprint $thumbprint

New-CHSIReport -SaveSnapshot ./contoso-snapshot.json -OutputPath ./out   # collect and report
New-CHSIReport -FromSnapshot ./contoso-snapshot.json -OutputPath ./out   # re-analyse, no credentials
```

Collection and analysis are separate, so a snapshot taken on site can be re-priced later
without going back to the tenant. Snapshots are a convenience, not state: nothing is read
back automatically, and no run depends on a previous one.

---

## Requirements

| | |
|---|---|
| PowerShell | 7.4 or later |
| Module | `Microsoft.Graph.Authentication` 2.15.0+ |
| Tenant | Any Microsoft 365 commercial tenant |
| Role to run | Global Reader, plus Security Reader for the Secure Score sections |
| Role to consent | Cloud Application Administrator or equivalent, once |

Five delegated read-only scopes: `Organization.Read.All`, `Directory.Read.All`,
`User.Read.All`, and optionally `AuditLog.Read.All` and `SecurityEvents.Read.All`. The
optional two are entitlement-gated; without them the affected sections report as *not
measured* rather than as zero. Full table and reasoning:
[APP-REGISTRATION.md](docs/APP-REGISTRATION.md#what-is-being-approved).

---

## Documentation

| | |
|---|---|
| [METHODOLOGY.md](docs/METHODOLOGY.md) | How every figure is derived, and what it does not claim |
| [APP-REGISTRATION.md](docs/APP-REGISTRATION.md) | Consent, your own app registration, or neither |
| [PRIVACY.md](docs/PRIVACY.md) | What is read, where it goes, what your exports contain |
| [SECURITY.md](SECURITY.md) | Reporting a vulnerability, and the guarantees CI enforces |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Code and data contributions, and the two rules that will surprise you |
| [CONTROL-ENTITLEMENTS.md](docs/CONTROL-ENTITLEMENTS.md) | The entitlement research, cited and confidence-marked |
| [DELIVERY-PLAN.md](docs/DELIVERY-PLAN.md) | Architecture, consent design, and the full plan |

**The one rule worth knowing before reading any figure:** a CFO-facing report must never
show `$0` where the truth is "we could not look." Every degraded signal renders as an
explicit *not measured, and here is why*.

---

## Accessibility

Checked in CI, not asserted in a paragraph. Contrast is computed from the design tokens
themselves for both themes; overlays are modal dialogs with focus trapped and restored;
tables carry captions and column scopes. The report gets projected in meeting rooms, where
a bright room does to everyone what low contrast does to some people always.

---

## Configuration

Copy [`config/chsi-config.example.json`](config/chsi-config.example.json) and pass it with
`-ConfigPath`. It drives the pricing basis and currency, the inactivity threshold (default
90 days), the exemption list for service accounts and room resources, the free-SKU seat
thresholds, and the risk-model inputs. Anything omitted keeps its default.

---

## Status

| Milestone | Scope | State |
|---|---|---|
| **M0–M6** | Module, collector, TypeScript engine, browser sign-in, dashboard, live pricing | ✅ Complete |
| **M7** | Secure Score, feature gaps, waste categories, risk, roadmap | ✅ Complete |
| **M8** | Session files, JSON/CSV, single-file interactive HTML, PDF board pack | ✅ Complete |
| **M9** | Docs, accessibility, licence and privacy review, public launch | 🟡 In progress |

Full plan, including the security and consent design:
[`docs/DELIVERY-PLAN.md`](docs/DELIVERY-PLAN.md).

---

## Development

```bash
cd app && npm install
npm run dev          # dev server, with the sample tenant
npm test             # engine parity, exports, accessibility
npm run build        # type-check and production build
```

```powershell
Invoke-Pester ./tests
Invoke-ScriptAnalyzer -Path ./src, ./tests, ./scripts -Recurse -Severity Warning, Error
```

The engine exists twice — PowerShell collects, TypeScript computes — and **parity tests
assert the two agree to the cent**. That is what made the port safe, and it means a change
to how a figure is derived is usually two changes. The whole suite runs offline, with no
tenant and no credentials.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

---

## Roadmap beyond v1.0

- **Snapshot delta between runs** — the quarterly QBR story: *"spend realized 61% → 74%."*
  The highest-value future feature, and the reason v1.0 stays stateless.
- **Risk scaled to tenant size** — impact is currently a flat assumption, so expected loss
  does not vary with headcount.
- **Per-gap remediation navigation** — exact portal click-paths instead of Learn links.
- **"Newly entitled" flags** — gaps created by Microsoft packaging changes, so a control
  that silently appeared in your SKU does not sit unconfigured for a year.
- **Direct policy evidence** — reading Conditional Access and Defender policy objects, at
  the cost of additional scopes. v1.0 relies on Secure Score to keep the consent dialog
  short.

## Deliberately out of scope

- **Compliance-framework mapping (NIST/CIS/ISO).** A saturated lane — ScubaGear, monkey365
  and M365-Assess already do it well.
- **Copilot and AI-readiness assessment.** Different tool, different audience.
- **Multi-tenant or MSP mode.** Single-tenant, consultant-run, by design.
- **Any write or remediation capability.** Read-only, always.

---

## License

MIT — see [LICENSE](LICENSE).

Lato is bundled under the
[SIL Open Font License 1.1](src/CloudHarbor.M365SecurityInvestment/Assets/Fonts/OFL.txt).

**No logo, wordmark or trademark ships in this repository.** The palette and typeface carry
the visual identity, so a fork inherits a complete, usable tool and no marks it has no
right to use. Reports credit whoever prepared them via the `preparedBy` setting, and omit
the line entirely when it is unset.

Originally built by [Cloud Harbor Consulting](https://cloudharborconsulting.cloud).
