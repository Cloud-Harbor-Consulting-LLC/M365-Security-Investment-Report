# Methodology

How every figure in the report is arrived at, and what it does and does not claim.

One rule governs the rest:

> A CFO-facing report must never show `$0` where the truth is "we could not look."

Where something cannot be established it renders as *not measured*, with the reason. Zero
is a claim about the tenant. An empty figure is a known gap. Confusing the 2 is how these
reports lose the room.

---

## 1. The 2 dollar totals, kept apart

These are never summed or blended, because conflating them is the fastest way to lose a
CFO's trust:

- **Annual commitment.** Purchased seats times price. What an EA or CSP agreement actually
  invoices, assigned or not.
- **Spend in use.** Assigned seats times price. The portion in someone's hands.

The gap between them is idle seat spend: money already committed and reaching nobody.

### Edge cases, and what the report does with each

| Case | Behaviour |
|---|---|
| A SKU with no price | Counted in seat totals, excluded from every dollar figure, and named in the report. Totals are a floor and say so. |
| Free SKUs reporting unlimited seats | Excluded, with the reason shown. 100,000 seats excludes on count alone. 10,000 excludes only when the SKU is also unknown to the catalogue and unpriced, since 10,000 is a plausible real purchase. |
| Zero purchased seats | Realization renders `n/a`, never `0%`. |
| A real amount below half a unit | Renders `<$1`. 26 cents would otherwise print as `$0`, which reads as free. |

---

## 2. Where prices come from

Microsoft Graph does not expose contract pricing. There is no API for what you actually
pay, so every dollar figure derives from a price table you control.

The shipped table holds Microsoft public list prices. List prices are almost always higher
than negotiated EA or CSP rates, so out of the box the report overstates cost and
understates the discount you already won. Supplying real rates moves every figure.

The table prices 44 SKUs, and each entry carries its own provenance rather than inheriting
the file's:

| Confidence | Entries | What it means |
|---|---|---|
| `verified` | 28 | Checked against a Microsoft page in September 2026, including the 1 July 2026 increase |
| `reasoned` | 2 | Derived from a related SKU, with the derivation written out in the entry |
| `unverified` | 14 | Seed data carried forward, because no public Microsoft figure was found |

The 14 are mostly the standalone Defender components. Microsoft withdrew public per-seat
pricing for those: the Defender pricing page now shows the suites and sends the rest to
Contact Sales. Treat them as indicative and override them.

A SKU with no entry at all is never priced at zero. It is reported as unpriced, its seats
are still counted, and the totals are labelled a floor until you supply a price.

The report always states which basis it used: list, negotiated, or mixed, with a count of
how many SKUs were overridden. A figure whose provenance is not stated is a figure nobody
should quote.

### The security budget, an export-only figure

The CSV and JSON exports carry a security budget: for each SKU, assigned seats times annual
price times a security value share, the fraction of that SKU's price attributed to security.
The share is this tool's allocation model. No vendor publishes it, and the dashboard and
board pack deliberately do not show it, because a reader would take it for a measurement.

When Microsoft changes a SKU's price or contents, the share is re-derived rather than held.
The security dollars from before the change are kept, and the price change is split across
what was added, in proportion to each addition's standalone list price and weighted by how
much of it is security: 1.0 for a security product, 0.5 for device and app management, 0
for support, analytics and productivity. Holding a share fixed through a price increase
would credit security with part of every increase, including increases that bought storage.

Each SKU's arithmetic is written beside its share in `pricelist.json`, under `$shareBasis`.

---

## 3. 3 layers of licensing, which answer different questions

This distinction is the core of the tool, and it is where most licence reporting goes
wrong:

| Layer | The question |
|---|---|
| **Capability** | Which product technically enforces this control? |
| **Visibility** | Why does this control appear in this tenant's Secure Score at all? |
| **Deployment** | What would you have to buy to switch it on? |

The report maps controls on **visibility**: the licence that puts the control in front of
this tenant. That layer answers "what am I paying for and not using", which is the question
the tool exists to answer.

Controls map to the minimum service plan that enables them, never straight to a SKU. The
engine then attaches that plan to the dearest SKU the tenant owns which carries it. If a
control is entitled by a plan inside E5, the cost of that control is the cost of E5.

### Newly entitled

Microsoft adds capabilities to suites a tenant already pays for, and nothing in the tenant
announces it. On 1 July 2026 Defender for Office 365 Plan 1 was added to Microsoft 365 E3
and Office 365 E3, unlocking Safe Links, Safe Attachments and impersonation protection for
tenants that never bought them. The tenant's licences simply start listing the new service
plan, so without a flag those controls look like gaps the tenant has been ignoring for
years.

A control is marked **new in your licence** when all of these hold:

- The tenant is entitled to it through a service plan that a dated packaging change added
  to a licence it holds. The changes are listed, with sources, in `packagingChanges` in
  `feature-map.json`.
- No other licence the tenant holds carried a qualifying plan already. A tenant that also
  holds E5 or standalone Defender for Office was paying for the control before, and it is
  not flagged.
- The change took effect no more than 365 days before the tenant was collected. Measured
  from the collection rather than from today, so a saved report keeps saying what it said.

Only additions that unlock a scored control are listed. The same July change added Intune
Plan 2, Remote Help, Cloud PKI and other Intune capabilities, but no Secure Score control
maps to those plans yet.

Some additions cannot be detected. Microsoft added URL time-of-click protection to Office
365 E1 and Microsoft 365 Business Basic and Standard, but publishes no service plan for it
in those licences, so a tenant's licences cannot show whether it has arrived. A tenant
holding one of them sees this under **Not measured** rather than a guess.

---

## 4. Deployment evidence comes from Secure Score

Whether a control is switched on is read from Microsoft Secure Score `controlScores`.
Direct policy reads, such as Exchange Online configuration or Conditional Access policy
contents, are deliberately not used.

This is a real constraint, stated plainly. With the 5 read-only scopes this tool requests,
a claim like "zero Safe Links policies exist" is not provable. Secure Score's own
assessment is. Reading policy directly would need broader permission than the trust
argument can afford.

One consequence: a control Microsoft does not score for your tenant is invisible to this
report. The report says how many, so the scored set is never presented as everything.

---

## 5. Spend realized

The headline figure. 3 things must all be true before money does any work:

1. the licence was bought,
2. it was assigned to somebody,
3. what it carries was switched on.

So:

```
spend realized = (assigned seats ÷ purchased seats) × (current Secure Score ÷ maximum)
```

A tenant can be fully licensed, fully assigned, and still have most of its security
capability switched off. That gap is the finding.

When Secure Score is unavailable the composite is withheld and the seat-only figure is
shown under its own name. Presenting a seat-only number as "spend realized" would overstate
the tenant, which is the failure this tool exists to correct.

The feature share, the per-licence table and this figure all reconcile to each other, so
they are 3 views of one quantity.

---

## 6. The per-control cost column does not sum

This is the most dangerous number in the tool.

Several controls can depend on one licence, so adding up a per-control cost column invents
money that was never spent, potentially several times over.

Every surface that shows it says so: on screen, in the CSV's own description, in the export
README, and on the board pack. The per-licence rollup is the additive view, and it is what
the board pack prints.

---

## 7. Wasted spend

5 categories, each measured independently:

| Category | Basis |
|---|---|
| Unassigned purchased seats | SKU counts |
| Disabled but licensed | Account state |
| Never signed in | Sign-in activity |
| Inactive beyond the threshold | Sign-in activity |
| Over-provisioned | Not measured. Needs per-user service-plan usage, which is not collected. |

Sign-in activity requires Entra ID P1. Without it Graph refuses the entire user query, so
the tool retries without that field and the 2 sign-in categories report as not measured.

An account holding a licence is never exempt, whatever the exemption rules say. Service
accounts, shared mailboxes and room resources are excluded from waste. An exemption that
can hide paid-for seats turns the tool's central claim inside out, under-stating waste in
exactly the tenants that most need it found. The count of exempted accounts is always
shown.

Where a category is measured but only partly priced, its total is marked a floor.

Inactivity is measured back from the moment the sign-in data was collected, not from the
moment the report is opened. A snapshot is fixed when it is read, so a report says the
same thing however long it sits before someone opens it, and 2 runs collected months apart
are each judged against their own date.

---

## 8. Risk, and its limits

Expected loss is `annual likelihood × impact`, per threat, from `risk-model.json`, with
the impact sized to the tenant.

Neither input is measured in your tenant. They are industry-shaped assumptions, shipped so
they can be replaced, and stated wherever a risk figure appears. Use them to rank work.

### Sized to the tenant

Every impact in `risk-model.json` describes an organisation of 500 people. A tenant's
impacts are multiplied by `(headcount / 500) ^ 0.5`:

| Headcount | Multiplier |
|---|---|
| 50 | 0.32 |
| 500 | 1.00 |
| 5,000 | 3.16 |

Impact grows with size, but more slowly. Much of an incident's cost does not depend on
headcount: a fraudulent payment, an incident-response retainer and a legal fee cost about
the same at 50 people as at 5,000. Downtime, recovery and notification do grow with it.
IBM's Cost of a Data Breach study shows how slowly the total rises: in 2023, organisations
with fewer than 500 employees averaged $3.31 million a breach, against $4.45 million across
all sizes. The square root sits between flat and proportional. The reference size and the
exponent are assumptions, kept in `sizeScaling` beside the impacts they qualify.

**Headcount** is the number of enabled accounts holding at least one licence. It is never
taken as lower than the most seats assigned on any one paid licence, because each of those
seats is held by a different account. That figure alone is used when users were not
collected, and the report says which one it used. Free licences are left out, because a
free Power BI or Power Automate seat goes to anyone who starts a trial. Likelihood is not
sized: it is the chance of an incident a year, and is left as stated.

Sizing moves the roadmap order as well as the totals. A step's value is the risk it
retires plus the licence spend it starts earning, and only the first is sized, so in a
small tenant licence spend carries more of the ranking.

When 2 runs are compared, retained risk in the earlier run is recalculated at the later
run's headcount. A tenant that hired 100 people has more at stake, but its controls did not
get worse, and the comparison is about the controls.

2 limits worth knowing before quoting any of it:

**Coverage.** Microsoft tags only some controls with a threat. On one production tenant
that was 43 of 209 scored controls, so expected loss there described about a fifth of the
tenant. The proportion is printed in the exports and the board pack.

**Scale.** Sizing makes a 50-person tenant and a 5,000-person one carry different figures,
but the curve is an assumption, not a fit to your industry or your data. Quote an absolute
figure as "under these assumptions", and change the reference size or the exponent if
you have better evidence.

The roadmap orders remediation by value against effort. Unknown effort is treated as
moderate, never low, because guessing "easy" is how a plan loses credibility on contact
with the first step.

---

## 9. Provenance, and what is not measured

Every report carries which collectors ran, which degraded, and why. The **Not measured**
view makes gaps a visible part of the report, so the reader does not have to notice an
absence.

Exports carry the same qualifications inside the files, because the file is the copy that
gets forwarded and the report will not be around it.

---

## 10. Comparing 2 runs

A quarterly review asks what changed since the last one. The app answers by comparing the
run on screen with an earlier run of the same tenant, from a snapshot or a saved session.

**Both runs are priced the same way.** The earlier run is analysed again, at the prices and
with the reference data the report uses now. Comparing 2 reports as they were saved would
show a Microsoft price increase, or a correction to the entitlement map, as something the
tenant did. Prices saved inside an earlier session are not used, and the report says so
when there were any.

**A figure measured in only one run is not comparable.** It is listed with the reason, and
no change is stated for it. "We could not look" in June and "we looked" in September is
not an improvement. Today's figure is still shown, because it is known; only the change is
not.

**A control moves by its share of the maximum, not by points.** Microsoft re-weights
controls between runs. A control that was worth 10 points and is now worth 12, fully
deployed both times, has not changed, and is not shown as having changed. Each control
that moved is placed in one group, checked in this order:

| Group | Meaning |
|---|---|
| Regressed | A lower share of its maximum than before |
| Closed | Fully deployed now, and not before |
| Improved | A higher share of its maximum than before |
| Newly scored | Scored now, not in the earlier run |
| No longer scored | Scored in the earlier run, not now |

Regressions are listed first, because a control that slipped is the easiest thing to bury
under good news.

**Licences** are compared by SKU: added, removed, or changed in seats bought, seats
assigned, or annual commitment. Free SKUs that report unlimited seats are left out, as
they are everywhere else in the report.

**Seat-level waste** is compared by category. A category not measured in either run is
not comparable, and so is the waste total unless both runs measured the same categories.

**What is refused.** A run from a different tenant, the same run twice, and an "earlier"
run collected after the one on screen. Each is refused with the reason rather than
compared.

The comparison is in the app only. The PowerShell module produces each run's snapshot, and
the app compares them.

---

## Verifying any of this

The arithmetic exists twice, in PowerShell and TypeScript, and parity tests assert the 2
agree to the cent against the fixtures in `tests/fixtures/`. That is what made the port
safe, and it means either implementation can be read as the specification.

- Spend and realization: `app/src/engine/spend.ts`
- Entitlement and deployment: `app/src/engine/features.ts`
- Waste: `app/src/engine/waste.ts`
- Risk and roadmap: `app/src/engine/risk.ts`
- Comparing 2 runs: `app/src/engine/compare.ts`
- The entitlement research, cited and confidence-marked:
  [`CONTROL-ENTITLEMENTS.md`](CONTROL-ENTITLEMENTS.md)
