# M365 Security Investment Report

Find the security capability you already bought and never switched on.

This tool reads one Microsoft 365 tenant through Microsoft Graph, read only, and reports
how much of the security capability your licences pay for is actually deployed, what the
gap costs, and what to fix first.

It produces a board pack, an interactive report that opens offline, and JSON and CSV for
finance.

**<https://cloud-harbor-consulting-llc.github.io/M365-Security-Investment-Report/>**

Choose **Explore the sample tenant** to see all of it with no sign-in and nothing
installed.

> [!IMPORTANT]
> **The shipped prices are list prices, not yours.** The table prices 44 SKUs: 33 checked
> against a price Microsoft prints or last printed, including the increase effective
> 1 July 2026, 9 quoted publicly by Microsoft partners because Microsoft no longer prints a
> per-seat figure for them, mostly the standalone Defender components, and 2 inferred from
> a related SKU. Every entry says which it is and cites its sources. List prices are almost always higher than
> negotiated EA, MCA or CSP rates, so check or replace the table before any client
> engagement. The report states which basis produced its figures, every time.

---

## What it looks like

Every figure below comes from the synthetic sample tenant, which is the same one the
**Explore the sample tenant** button opens. No real tenant appears anywhere in this
repository.

### Board

What a CFO sees first: the commitment, what is idle, and how much of it is earned.

![The board view, showing annual commitment, spend in use, idle seat spend, and the share of spend realized](docs/images/board.png)

### Security features

The view the rest of this tool exists for. Every control Microsoft scores, what entitles
you to it, whether it is deployed, and the spend riding on it. A control Microsoft has
recently added to a licence you already hold is marked **new in your licence**, so it does
not sit unconfigured for a year looking like an old gap.

![The security features view, showing entitled versus deployed controls with the licence that entitles each one and the spend at risk](docs/images/features.png)

### Wasted spend

6 categories of seat-level waste, each measured on its own. One that could not be measured
says so in the table and again underneath, rather than reading as zero. Over-provisioning
counts accounts licensed for the desktop apps that only used them on the web or a phone,
and puts a price only on a move that costs the account no security. A licence whose every
plan the account already gets from another is priced in full, and names the packaging
change that made it a duplicate when there is one.

![The wasted spend view, showing 6 measured waste categories, with over-provisioning counted and not priced](docs/images/waste.png)

### Roadmap

What to fix first, ranked by value against effort, with the expected loss each gap still
carries. Expected loss is sized to the tenant's headcount, and the view says how.

![The roadmap view, showing expected annual loss, the share already avoided, and remaining risk broken down by threat](docs/images/roadmap.png)

### Since last review

Open an earlier run of the same tenant and the report says what changed between them: the
controls that closed or slipped, the licences bought or dropped, and what that did to the
money. Regressions are listed first.

![The since last review view, comparing a June run with a September run: spend realized up from 30.2% to 38.5%, Secure Score, idle seat spend and annual commitment with their changes, and the controls that moved](docs/images/since.png)

### Portfolio

Drop several snapshots or sessions at once, one or more per client, and the app lists every
client on one screen: spend realized, annual commitment, spend not switched on, seat waste
and newly entitled controls, largest opportunity first. Where the files hold an earlier run
of a client, the newest run is shown and compared with the one before it, so "since last
review" works across a whole book of clients without pairing files by hand. Open a client
for its full report, and come back with any prices you changed still in place.

The portfolio lives only in the browser tab. Nothing is stored or uploaded, closing the tab
forgets it, and dropping the same files again rebuilds it exactly.

Regenerate these from the sample tenant with `node scripts/make-screenshots.mjs`, which
builds the one-file report through the same code path the Export button uses.

---

## Read-only, and provably so

This tool never writes to your tenant. It has no remediation capability, no write scopes,
and no code path that could acquire one.

Three tests enforce that, and they fail the build:

1. **One chokepoint.** Every Graph call goes through a single function that hardcodes
   `GET` and exposes no method parameter. No caller can choose a verb.
2. **No write scope is ever requested.** 5 read-only scopes, and the guards reject any
   scope that is not `.Read` or `.Read.All`.
3. **Both tiers are checked**, by
   [`tests/ReadOnly.Guard.Tests.ps1`](tests/ReadOnly.Guard.Tests.ps1) and
   [`app/src/graph/readonly.test.ts`](app/src/graph/readonly.test.ts). They must also
   request the identical scope set.

Read those tests before you consent the app. They are short, and they carry the whole
trust argument.

There is also no backend. The app is static files. Collection goes browser to Microsoft
Graph and back, and nothing is uploaded anywhere. See [PRIVACY.md](docs/PRIVACY.md).

---

## Three ways in

| | What it needs |
|---|---|
| **Explore the sample tenant** | Nothing. A synthetic tenant with the awkward cases built in. |
| **Connect to a tenant** | An administrator consents once. Nothing to register, nothing to install. |
| **Load a snapshot** | Run the PowerShell collector yourself and drop the file in. For organisations that prefer to run code they can read. |

Same dashboard, same figures, same exports either way.

For consent, registering your own app, or avoiding registration entirely, see
[APP-REGISTRATION.md](docs/APP-REGISTRATION.md).

---

## What you get

**Board pack.** 6 pages for print or PDF, in the order a sceptical CFO asks the questions,
ending with what was measured, what you supplied, and what is assumed. 7 when comparing
with an earlier run, with what changed second.

**One interactive HTML file.** The whole report, offline, reaching no external origin, and
still showing the board figures with JavaScript disabled. This is the file to leave with a
customer.

**JSON and CSV.** 7 sections plus a README naming which figures are measured and which are
assumed, because the file is the copy that gets forwarded. 2 more when comparing: the
controls and the licences that changed.

**Session files.** Tenant data plus your negotiated prices, reopenable later. A session
saved while comparing keeps the earlier run too, and reopens on the comparison.

**A comparison with the last review.** Choose **Compare** and open an earlier snapshot or
session of the same tenant. Both runs are priced the same way, so every difference is
something the tenant changed. See
[Comparing 2 runs](docs/METHODOLOGY.md#10-comparing-2-runs).

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
table you control. The shipped table holds public list prices, which overstate what you
actually pay. A SKU the table cannot price is reported as unpriced rather than as $0, and
you can price it inline in the app or supply a table:

```powershell
New-CHSIReport -CustomPricing ./contoso-ea-rates.json -ConfigPath ./contoso.json -OutputPath ./out
```

The report states which basis produced its numbers, every time. In the app you can edit
prices live and every dependent figure moves.

### Unattended, and offline

```powershell
Connect-CHSITenant -TenantId contoso.onmicrosoft.com -ClientId $appId -CertificateThumbprint $thumbprint

New-CHSIReport -SaveSnapshot ./contoso-snapshot.json -OutputPath ./out   # collect and report
New-CHSIReport -FromSnapshot ./contoso-snapshot.json -OutputPath ./out   # re-analyse, no credentials
```

Collection and analysis are separate, so a snapshot taken on site can be re-priced later
without going back to the tenant. Snapshots are a convenience, not state. Nothing is read
back automatically, and no run depends on a previous one.

---

## Requirements

| | |
|---|---|
| PowerShell | 7.4 or later |
| Module | `Microsoft.Graph.Authentication` 2.15.0+ |
| Tenant | Any Microsoft 365 commercial tenant |
| Role to run | Global Reader, plus Security Reader for the Secure Score sections and Reports Reader for over-provisioning |
| Role to consent | Cloud Application Administrator or equivalent, once |

6 delegated read-only scopes: `Organization.Read.All`, `Directory.Read.All`,
`User.Read.All`, and optionally `AuditLog.Read.All`, `SecurityEvents.Read.All` and
`Reports.Read.All`. The optional 3 are gated on a licence or a role. Without them the affected sections report as *not
measured* and say why. Full table and reasoning:
[APP-REGISTRATION.md](docs/APP-REGISTRATION.md#what-is-being-approved).

---

## Documentation

| | |
|---|---|
| [METHODOLOGY.md](docs/METHODOLOGY.md) | How every figure is derived, and what it does not claim |
| [APP-REGISTRATION.md](docs/APP-REGISTRATION.md) | Consent, your own app registration, or neither |
| [PRIVACY.md](docs/PRIVACY.md) | What is read, where it goes, what your exports contain |
| [SECURITY.md](SECURITY.md) | Reporting a vulnerability, and the guarantees CI enforces |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Code and data contributions, and the 2 rules that will surprise you |
| [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) | What this project redistributes, and under what terms |
| [CONTROL-ENTITLEMENTS.md](docs/CONTROL-ENTITLEMENTS.md) | The entitlement research, cited and confidence-marked |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is put together, and why each guarantee holds |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release, and what each one still cannot do |

One rule governs every figure in the report: a CFO-facing report must never show `$0` where
the truth is "we could not look." Every degraded signal renders as an explicit *not
measured, and here is why*.

---

## Accessibility

Checked in CI. Contrast is computed from the design tokens themselves, for both themes.
Overlays are modal dialogs with focus trapped and restored. Tables carry captions and
column scopes.

The report gets projected in meeting rooms, where a bright room does to everyone what low
contrast does to some people always.

---

## Configuration

Copy [`config/chsi-config.example.json`](config/chsi-config.example.json) and pass it with
`-ConfigPath`. It sets the pricing basis and currency, the inactivity threshold (default 90
days), the exemption list for service accounts and room resources, the free-SKU seat
thresholds, and the report header. Anything omitted keeps its default. The threat
likelihoods and impacts behind the risk figures are not set here: they are in
[`risk-model.json`](src/CloudHarbor.M365SecurityInvestment/Data/risk-model.json).

---

## Status

**v1.0.** Everything on this page works today. What each release changed, and what it
still cannot do, is in [CHANGELOG.md](CHANGELOG.md), which carries a known-limitations
section for exactly that reason.

How the pieces fit together: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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
foreach ($root in './src', './tests', './scripts') {
    Invoke-ScriptAnalyzer -Path $root -Recurse -Severity Warning, Error
}
```

The engine exists twice. PowerShell collects, TypeScript computes, and parity tests assert
the two agree to the cent. That is what made the port safe, and it means a change to how a
figure is derived is usually 2 changes.

The whole suite runs offline, with no tenant and no credentials.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

---

## Roadmap beyond v1.0

- **Per-gap remediation navigation.** Exact portal click-paths instead of Learn links.
- **Direct policy evidence.** Reading Conditional Access and Defender policy objects, at
  the cost of additional scopes. v1.0 relies on Secure Score to keep the consent dialog
  short.

## Deliberately out of scope

- **Compliance-framework mapping (NIST, CIS, ISO).** A saturated lane. ScubaGear, monkey365
  and M365-Assess already do it well.
- **Copilot and AI-readiness assessment.** Different tool, different audience.
- **Multi-tenant or MSP mode.** Single-tenant, consultant-run, by design.
- **Any write or remediation capability.** Read-only, always.

---

## License

MIT, see [LICENSE](LICENSE).

Everything this project redistributes, and under what terms, is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The short version: Preact and MSAL are
MIT, Lato is under the SIL Open Font License 1.1, and 568 of the 619 SKU catalogue
entries come from Microsoft's MIT-licensed documentation.

No logo, wordmark or trademark ships in this repository. The palette and typeface carry the
visual identity, so a fork inherits a complete, usable tool and no marks it has no right to
use. Reports credit whoever prepared them through the `preparedBy` setting, and omit the
line entirely when it is unset.

Originally built by [Cloud Harbor Consulting](https://cloudharborconsulting.cloud).
