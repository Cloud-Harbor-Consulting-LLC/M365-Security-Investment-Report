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

## Quick start

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

---

## Sample output

[`samples/sample-report.html`](samples/sample-report.html) is a complete report generated from [`tests/fixtures/premium-snapshot.json`](tests/fixtures/premium-snapshot.json), a synthetic tenant built to exercise the edge cases: unlimited-seat free SKUs, an unpriced SKU, and the `O365_BUSINESS_PREMIUM` naming trap. Download and open it — it renders offline with no network access.

The report has three layers in one document:

- **Board one-pager** — annual commitment, spend in use, idle seat spend, realization.
- **Executive summary** — where the spend sits, on what pricing basis, and what is not yet measured.
- **Architect appendix** — per-SKU detail, exclusions with reasons, scopes used, collection provenance, and methodology.

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
| **M2** | Web app skeleton, GitHub Pages deployment, snapshot load | ⬜ Next |
| **M3** | Calculation engine in TypeScript, parity-tested against the M1 fixtures | ⬜ |
| **M4** | Sign in from the browser (MSAL, read-only scopes, admin consent) | ⬜ |
| **M5** | Dashboard views: board, executive, waste, features, roadmap | ⬜ |
| **M6** | Live overrides and scenario modelling | ⬜ |
| **M7** | Secure Score, feature gaps, remaining waste categories, risk, roadmap | ⬜ |
| **M8** | PDF board pack, single-file interactive HTML, JSON/CSV | ⬜ |
| **M9** | Custom domain, docs, accessibility, public launch | ⬜ |

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

Lato is used under the SIL Open Font License 1.1. The Cloud Harbor logo and wordmark are trademarks of Cloud Harbor Consulting LLC and are not licensed for reuse under the MIT License.

Built by [Cloud Harbor Consulting](https://cloudharborconsulting.cloud).
