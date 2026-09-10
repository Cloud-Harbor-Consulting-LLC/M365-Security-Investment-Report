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

The shipped table holds Microsoft public list prices, flagged unverified. List prices are
almost always higher than negotiated EA or CSP rates, so out of the box the report
overstates cost and understates the discount you already won. Supplying real rates moves
every figure.

The report always states which basis it used: list, negotiated, or mixed, with a count of
how many SKUs were overridden. A figure whose provenance is not stated is a figure nobody
should quote.

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

---

## 8. Risk, and its limits

Expected loss is `annual likelihood × impact`, per threat, from `risk-model.json`.

Neither input is measured in your tenant. They are industry-shaped assumptions, shipped so
they can be replaced, and stated wherever a risk figure appears. Use them to rank work.

2 limits worth knowing before quoting any of it:

**Coverage.** Microsoft tags only some controls with a threat. On one production tenant
that was 43 of 209 scored controls, so expected loss there described about a fifth of the
tenant. The proportion is printed in the exports and the board pack.

**Scale.** Impact is currently a flat assumption, so expected loss comes out identical for a
50-seat tenant and a 5,000-seat one. Scaling it is on the roadmap for v1.1. Until then the
ranking is useful and the absolute figure is not.

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

## Verifying any of this

The arithmetic exists twice, in PowerShell and TypeScript, and parity tests assert the 2
agree to the cent against the fixtures in `tests/fixtures/`. That is what made the port
safe, and it means either implementation can be read as the specification.

- Spend and realization: `app/src/engine/spend.ts`
- Entitlement and deployment: `app/src/engine/features.ts`
- Waste: `app/src/engine/waste.ts`
- Risk and roadmap: `app/src/engine/risk.ts`
- The entitlement research, cited and confidence-marked:
  [`CONTROL-ENTITLEMENTS.md`](CONTROL-ENTITLEMENTS.md)
