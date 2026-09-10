# Methodology

How every figure in the report is arrived at, and what it does and does not claim.

The governing rule, which everything else follows from:

> **A CFO-facing report must never show `$0` where the truth is "we could not look."**

Where something cannot be established it renders as *not measured*, with the reason. Zero
is a claim about the tenant. An empty figure is an honest gap. Confusing the two is how
these reports lose the room.

---

## 1. The two dollar totals, kept apart

Conflating these is the fastest way to lose a CFO's trust, so they are never summed or
blended:

- **Annual commitment** — purchased seats × price. What an EA or CSP agreement actually
  invoices, assigned or not.
- **Spend in use** — assigned seats × price. The portion in someone's hands.

The gap between them is **idle seat spend**: money already committed and not reaching
anybody.

### Edge cases, handled explicitly rather than silently

| Case | Behaviour |
|---|---|
| A SKU with no price | Counted in seat totals, excluded from every dollar figure, and named in the report. Totals are a floor and say so. |
| Free SKUs reporting unlimited seats | Excluded with the reason shown. 100,000 seats excludes on count alone; 10,000 only when the SKU is *also* unknown to the catalogue and unpriced, since 10,000 is a plausible real purchase. |
| Zero purchased seats | Realization renders `n/a`, never `0%`. |
| A real amount below half a unit | Renders `<$1`, never `$0`. Twenty-six cents is not a claim that something is free. |

---

## 2. Where prices come from

**Microsoft Graph does not expose contract pricing.** There is no API for what you actually
pay. So every dollar figure derives from a price table you control.

The shipped table holds Microsoft **public list prices**, flagged unverified. List prices
are almost always higher than negotiated EA or CSP rates, so out of the box the report
**overstates cost** and understates the discount already won. Supplying real rates makes
every figure move.

The report always states which basis it used — list, negotiated, or mixed, with a count of
how many SKUs were overridden. A figure whose provenance is not stated is a figure nobody
should quote.

---

## 3. Three layers of licensing, which are not the same question

This distinction is the core of the tool, and it is where most licence reporting goes
wrong:

| Layer | The question |
|---|---|
| **Capability** | Which product technically enforces this control? |
| **Visibility** | Why does this control appear in *this* tenant's Secure Score at all? |
| **Deployment** | What would you have to buy to switch it on? |

The report maps controls on **visibility** — the licence that puts the control in front of
this tenant. That is the layer that answers "what am I paying for and not using", which is
the question the tool exists to answer.

**Controls map to the minimum service plan** that enables them, never straight to a SKU.
The engine then attaches that plan to the **dearest SKU the tenant owns** which carries
it — because if a control is entitled by a plan inside E5, the cost of that control is the
cost of E5, not of a hypothetical standalone.

---

## 4. Deployment evidence comes from Secure Score, and only Secure Score

Whether a control is actually switched on is read from Microsoft Secure Score
`controlScores`. Direct policy reads — Exchange Online configuration, Conditional Access
policy contents — are deliberately **not** used.

This is a real constraint, honestly stated: with the five read-only scopes this tool
requests, a claim like "zero Safe Links policies exist" is not provable. Secure Score's
own assessment is. Reading policy directly would need broader permission than the trust
argument can afford.

**Consequence:** a control Microsoft does not score for your tenant is invisible to this
report. The report says how many, rather than implying the scored set is everything.

---

## 5. Spend realized

The headline figure. Three things must all be true before money is doing any work:

1. the licence was **bought**,
2. it was **assigned** to somebody,
3. what it carries was **switched on**.

So:

```
spend realized = (assigned seats ÷ purchased seats) × (current Secure Score ÷ maximum)
```

A tenant can be fully licensed, fully assigned, and still have most of its security
capability switched off. That gap is the finding.

When Secure Score is unavailable the composite is withheld and the seat-only figure is
shown under its own name — presenting a seat-only number as "spend realized" would
overstate the tenant, which is the exact failure this tool exists to correct.

The feature share, the per-licence table and this figure all reconcile to one another
rather than being three independently plausible numbers.

---

## 6. The per-control cost column is not additive

**This is the single most dangerous number in the tool.**

Several controls can depend on one licence. Summing a per-control cost column therefore
invents money that was never spent — potentially several times over.

Every surface that shows it says so: on screen, in the CSV's own description, in the export
README, and on the board pack. The **per-licence rollup** is the additive view, and it is
what the board pack prints.

---

## 7. Wasted spend

Five categories, each measured independently:

| Category | Basis |
|---|---|
| Unassigned purchased seats | SKU counts |
| Disabled but licensed | Account state |
| Never signed in | Sign-in activity |
| Inactive beyond the threshold | Sign-in activity |
| Over-provisioned | Not measured — needs per-user service-plan usage, which is not collected |

Sign-in activity requires Entra ID P1. Without it Graph refuses the entire user query, so
the tool retries without that field and the two sign-in categories report as not measured.

**An account holding a licence is never exempt**, whatever the exemption rules say. Service
accounts, shared mailboxes and room resources are excluded from waste — but an exemption
that can hide paid-for seats turns the tool's central claim inside out, under-stating waste
in exactly the tenants that most need it found. The count of exempted accounts is always
shown.

Where a category is measured but only partly priced, its total is marked a **floor**.

---

## 8. Risk, and what it is not

Expected loss is `annual likelihood × impact`, per threat, from `risk-model.json`.

**Neither input is measured in your tenant.** They are industry-shaped assumptions, shipped
so they can be replaced, and stated wherever a risk figure appears. Treat them as a way of
**ranking work**, not as a forecast.

Two limits worth knowing before quoting any of it:

- **Coverage.** Microsoft tags only some controls with a threat. On one production tenant
  that was 43 of 209 scored controls — so expected loss there described about a fifth of
  the tenant. The proportion is printed in the exports and the board pack.
- **Scale.** Impact is currently a flat assumption, so expected loss comes out identical
  for a 50-seat tenant and a 5,000-seat one. Scaling it is on the roadmap for v1.1; until
  then, the ranking is useful and the absolute figure is not.

The roadmap orders remediation by value against effort, not severity. Unknown effort is
treated as **moderate**, never low — guessing "easy" is how a plan loses credibility on
contact with the first step.

---

## 9. Provenance, and what is not measured

Every report carries which collectors ran, which degraded, and why. The **Not measured**
view exists so that gaps are a first-class part of the report rather than an absence the
reader has to notice.

Exports carry the same qualifications in the files themselves, because the file is the copy
that gets forwarded and the report will not be around it.

---

## Verifying any of this

The arithmetic exists twice — PowerShell and TypeScript — and parity tests assert the two
agree to the cent against the fixtures in `tests/fixtures/`. That is what makes the port
safe, and it means either implementation can be read as the specification.

- Spend and realization: `app/src/engine/spend.ts`
- Entitlement and deployment: `app/src/engine/features.ts`
- Waste: `app/src/engine/waste.ts`
- Risk and roadmap: `app/src/engine/risk.ts`
- The entitlement research, cited and confidence-marked:
  [`CONTROL-ENTITLEMENTS.md`](CONTROL-ENTITLEMENTS.md)
