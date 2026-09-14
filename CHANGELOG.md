# Changelog

Notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Two things in this repository are versioned together: the PowerShell module
`CloudHarbor.M365SecurityInvestment` and the browser app. They share a version because they
share an engine, and a change to how a figure is derived usually touches both.

**A note on what counts as breaking.** A change to the shipped price table or the
entitlement map can move every dollar figure in a customer's board pack without changing a
single function signature. Those changes are listed under Changed with the figures they
move, and the price table records the date and source of every entry.

## [Unreleased]

Nothing yet.

## [1.0.0] - 2026-09-14

First public release.

### Added

- **Spend realization.** Reads one Microsoft 365 tenant through Microsoft Graph and reports
  how much of the security capability the licences pay for is actually deployed, what the
  gap costs, and what to fix first.
- **Three ways in.** A synthetic sample tenant that needs nothing, browser sign-in with
  one-time admin consent, or a snapshot produced by the PowerShell collector for
  organisations that prefer to run code they can read.
- **Read-only by construction.** Every Graph call goes through a single function that
  hardcodes `GET` and exposes no method parameter. 5 delegated read-only scopes, and the
  guards reject any scope that is not `.Read` or `.Read.All`. Both tiers are checked, and
  the 2 test files must request the identical scope set.
- **Entitled versus deployed.** Every control Microsoft scores for the tenant, what
  entitles it, whether it is switched on, and the spend riding on it. Entitlement is
  derived from the tenant's own service plans rather than a hardcoded table of SKUs.
- **Secure Score as the only deployment evidence**, so the consent dialog stays short and
  every claim about deployment traces to something Microsoft measured.
- **5 categories of seat-level waste**, with the category that cannot be measured reported
  as *not measured* rather than as zero.
- **Expected loss and a ranked roadmap**, ordered by value against effort.
- **Live pricing.** Edit any price in the app and every dependent figure moves. A SKU the
  shipped table has never heard of can be priced inline, which is what makes a tenant with
  no priceable SKU analysable at all.
- **Exports.** A 6-page board pack for print or PDF, a single interactive HTML file that
  opens offline and reaches no external origin, JSON and CSV for finance, and session files
  that reopen with your negotiated prices intact.
- **Accessibility checked in CI.** Contrast computed from the design tokens for both
  themes, overlays as modal dialogs with focus trapped and restored, captions and column
  scopes on every table.
- **Documentation**: methodology, privacy, app registration, entitlement research with
  citations and confidence marks, security policy, and a contributor guide covering both
  code and reference data.

### Notes for this release

- **Prices are public list prices.** The table prices 44 SKUs and every entry carries its
  own source and confidence. 28 were checked against Microsoft's published pricing in
  September 2026, including the increase effective 1 July 2026. None of them is your
  contract rate. See [Where prices come from](docs/METHODOLOGY.md#2-where-prices-come-from).
- **The engine exists twice.** PowerShell collects, TypeScript computes, and parity tests
  assert the two agree to the cent on the same fixtures.
- **Stateless by design.** Snapshots are a convenience, not state. No run depends on a
  previous one, which is what keeps the future delta feature honest.

### Known limitations

- **Expected loss does not scale with tenant size.** Impact is a flat assumption, so a
  300-seat tenant and a 30,000-seat tenant carry the same per-threat impact figure. Tuneable
  in the risk model, and addressed properly in a later release.
- **Over-provisioned licensing is not measured.** Detecting a user on a richer licence than
  they use needs per-user service-plan activity, which the collector does not gather. The
  waste total is reported as a floor and the category says why.
- **14 of the 44 priced SKUs are unverified**, mostly the standalone Defender components,
  for which Microsoft withdrew public per-seat pricing. They carry seed values, are marked
  `unverified`, and should be overridden with the customer's actual rate.
- **The dollarized capability subset is smaller than the reported one.** Every control
  Secure Score scores for a tenant appears in the report; a capability earns a dollar figure
  only once its entitlement has been researched and cited, because a wrong mapping moves
  money silently.

[Unreleased]: https://github.com/Cloud-Harbor-Consulting-LLC/M365-Security-Investment-Report/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Cloud-Harbor-Consulting-LLC/M365-Security-Investment-Report/releases/tag/v1.0.0
