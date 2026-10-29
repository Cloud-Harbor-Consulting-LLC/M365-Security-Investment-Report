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

### Security

- Build and test tooling updated past 4 published advisories, 2 of them rated high:
  `vite` 8.2.2 to 8.3.5, `vitest` and `@vitest/mocker` 5.0.0 to 5.0.5, and `source-map-js`
  1.2.1 to 1.2.2 through `vite`. None of these ships to a user, so the hosted app and every
  exported report were unaffected. 3 of the `vite` advisories affected the local
  development server on Windows.
- The declared minimum versions now exclude the vulnerable releases, so a fresh install
  cannot resolve one. Updating only the lockfile would have left them valid.

### Changed

- Security value shares re-derived for 12 SKUs after Microsoft's 1 July 2026 change, by
  splitting each price increase across what it added. Microsoft 365 E3 moves from 0.15 to
  0.16 and E5 is unchanged at 0.40. 9 of the other 10 come down, because the September 2026
  price sweep raised their prices without re-deriving their shares. Office 365 E3 goes up,
  from 0.10 to 0.17, because it gained Defender for Office 365 Plan 1. Only the security
  budget in the exports moves: on the sample tenant, from $49,209.60 to $50,515.44 a year.
  The method is in [Where prices come from](docs/METHODOLOGY.md#2-where-prices-come-from),
  and each SKU's arithmetic is in `pricelist.json`.
- `@azure/msal-browser` 5.21.0 to 5.26.0.

### Added

- **Since last review.** Compare the report on screen with an earlier run of the same
  tenant, from a snapshot or a saved session. A new view opens on what changed: spend
  realized, Secure Score, idle seat spend and annual commitment, then the controls that
  regressed, closed or improved, the licences bought or dropped, and seat-level waste by
  category. Both runs are priced the same way, so a price change never reads as something
  the tenant did, and a figure measured in only one run is marked not comparable rather
  than compared as zero. The board pack gains a page, the exports gain 2 sections and a
  `comparison` field in the JSON, and a session saved while comparing reopens on the
  comparison. Method in [Comparing 2 runs](docs/METHODOLOGY.md#10-comparing-2-runs).
- Dependabot version updates for npm and GitHub Actions, with a 7-day wait on new releases
  and 30 days for a major version. Security updates are unaffected by the wait.
- The app's licence inventory CSV carries the annual security budget, in a column whose
  header labels it an allocation, and the export README explains it. It was already in the
  PowerShell CSV and the app's JSON, but not in the app's CSV, which is the export most
  people take. Written to the cent.

### Fixed

- The app's CSV exports wrote any negative number as text. The guard against spreadsheet
  formulas prefixed every field starting with a minus sign, so -8 became '-8 and could be
  neither summed nor sorted. No v1.0 column held a negative figure, but the new change
  columns do. Numbers the tool computed are now written as numbers. Text from the tenant
  is still neutralised, including text such as "-5".
- The screenshot script no longer waits forever when headless Edge writes the image and
  then fails to exit. It stops after 90 seconds, and continues only if the image was
  written by that capture.
- CSV exports from both tiers wrote figures at full binary precision. The app's threat and
  roadmap sheets carried values such as 94829.26829268293, expected loss came out as
  42000.00000000001, and any price that is not a whole number of dollars put noise into
  every money column: 8.55 x 12 is 102.60000000000001. Money is now written to the cent,
  ratios to 4 decimal places and Secure Score points to 2, and the export README says so.
  The JSON exports keep full precision, and nothing in the model is rounded.
- Inactive accounts were measured against the date the report was opened, not the date
  the tenant was collected. The snapshot is fixed when it is read and
  the clock is not, so a saved session showed more inactive accounts every time it was
  reopened, and the test suite would have started failing on 23 November 2026 with no code
  changed. Inactivity is now measured back from the collection, and an account's detail
  reads "days before collection" rather than "days ago".

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
