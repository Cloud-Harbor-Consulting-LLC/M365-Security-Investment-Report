# Delivery Plan — M365 Security Investment Report v1.0

Status: **M0 and M1 complete** (310 tests green, PSScriptAnalyzer clean) · Responds to `CLAUDE-CODE-BRIEF.md` §0

**Signed off 2026-09-03:** Secure Score as the sole deployment-evidence source · `securityValueShare` × `valueWeight` allocation model approved · module `CloudHarbor.M365SecurityInvestment`, prefix `CHSI` · Cloud Harbor brand applied per §8.

---

## 1. Architecture

### 1.1 Naming

- **Module:** `CloudHarbor.M365SecurityInvestment`
- **Cmdlet prefix:** `CHSI` (Cloud Harbor Security Investment)
- **Entry point:** `New-CHSIReport`

Public surface (7 functions):

| Function | Purpose |
|---|---|
| `Connect-CHSITenant` | Interactive or certificate auth; validates granted scopes up front |
| `Disconnect-CHSITenant` | Clean teardown |
| `Test-CHSIPrerequisite` | Pre-flight: module versions, scopes, licence tier, config validity |
| `Get-CHSISnapshot` | Collect only — returns/saves the raw read-only Graph snapshot |
| `Invoke-CHSIAnalysis` | Snapshot → analysed report model (no I/O, pure) |
| `Export-CHSIReport` | Report model → HTML / JSON / CSV |
| `New-CHSIReport` | The one-liner that runs all of the above |

`New-` is used only for creating **local files**; nothing writes to the tenant.

### 1.2 Folder layout

```
/
├── src/CloudHarbor.M365SecurityInvestment/
│   ├── CloudHarbor.M365SecurityInvestment.psd1
│   ├── CloudHarbor.M365SecurityInvestment.psm1     # dot-sources Public/Private, exports Public only
│   ├── Public/                                     # 7 files, one per exported function
│   ├── Private/
│   │   ├── Collect/       Get-CHSIOrganizationData, ...SkuData, ...UserData, ...SecureScoreData
│   │   ├── Analyze/       Resolve-CHSISku, Measure-CHSISpend, Find-CHSIFeatureGap,
│   │   │                  Measure-CHSISeatWaste, Measure-CHSIRiskReduction, Build-CHSIRoadmap
│   │   ├── Render/        ConvertTo-CHSIHtml, ConvertTo-CHSIJson, ConvertTo-CHSICsv,
│   │   │                  New-CHSISvgChart (inline SVG — no chart library)
│   │   └── Common/        Invoke-CHSIGraphRequest, Write-CHSILog, Import-CHSIConfig,
│   │                      Assert-CHSIScope, Format-CHSICurrency
│   ├── Data/              sku-catalog.json, pricelist.json, feature-map.json, risk-model.json
│   └── Assets/            report.css, report.js, logo (all inlined at render time)
├── config/chsi-config.example.json
├── tests/                 Pester 5 unit + integration + fixtures/
├── samples/               sample-snapshot.json, sample-report.html
├── docs/                  DELIVERY-PLAN.md, SCOPES.md, METHODOLOGY.md, FEATURE-MAP.md
├── .github/workflows/ci.yml
└── README.md · LICENSE
```

### 1.3 Data flow

```
Connect-CHSITenant
        │  (delegated or cert; scopes asserted, not assumed)
        ▼
COLLECT ── Invoke-CHSIGraphRequest (GET-only chokepoint) ──► Snapshot object
        │   • every collector returns { Data, Available:bool, Degraded:bool, Reason }
        │   • no analysis, no pricing, no opinion — raw payloads only
        ▼
ANALYSE ── pure functions, zero network calls ──► Report model
        │   snapshot + config + Data/*.json  →  inventory, spend, gaps,
        │   seat waste, risk estimate, roadmap, provenance block
        ▼
RENDER  ── model → HTML (3 layers) + JSON + CSV
```

Two invariants that make the whole thing testable and auditable:

1. **All Graph traffic goes through `Invoke-CHSIGraphRequest`.** It hard-rejects any method that isn't GET, handles paging, throttling/429 backoff, and converts a 403 into a structured "degraded" result instead of an exception. One place to audit for the read-only guarantee.
2. **The analysis layer never touches the network.** Snapshot in, model out. That is what makes offline testing with fixtures a true end-to-end test rather than a stub.

---

## 2. Data-collection map

All calls are GET. Scope column is the *minimum* required.

| # | Data | Endpoint / cmdlet | Scope | If unavailable |
|---|---|---|---|---|
| 1 | Tenant identity, verified domains, seat count | `GET /organization` | `Organization.Read.All` | **Fatal** — abort with a clear message |
| 2 | Subscribed SKUs: purchased vs. consumed, service plans + provisioning status | `GET /subscribedSkus` | `Organization.Read.All` | **Fatal** — this is the spine of the report |
| 3 | Users: `id, displayName, userPrincipalName, accountEnabled, userType, createdDateTime, assignedLicenses, assignedPlans, department` | `GET /users` (paged, `$select`) | `User.Read.All` | **Fatal** for seat waste; licence inventory still renders |
| 4 | Sign-in activity: `signInActivity/lastSignInDateTime`, `lastNonInteractiveSignInDateTime` | same `GET /users` call, `signInActivity` added to `$select` | `AuditLog.Read.All` **+ Entra ID P1** | **Expected failure path.** 403 kills the *whole* query, so: attempt with `signInActivity`; on 403 / `Authentication_RequestFromNonPremiumTenantOrB2CTenant`, re-run the identical query without it, set `Degraded=true`, and suppress the never-signed-in + inactive waste categories with an explicit "requires Entra ID P1" note in the report rather than a silent zero |
| 5 | Secure Score, last 90 days (`currentScore`, `maxScore`, `createdDateTime`, `controlScores[]`, `averageComparativeScores[]`) | `GET /security/secureScores?$top=90` | `SecurityEvents.Read.All` | Degrade: drop trend, benchmark, and any gap whose evidence is Secure Score-only; report says why |
| 6 | Secure Score control profiles (`maxScore`, `tier`, `service`, `remediation`, `remediationImpact`, `userImpact`, `implementationCost`, `rank`, `threats`, `actionUrl`) | `GET /security/secureScoreControlProfiles` | `SecurityEvents.Read.All` | Degrade: roadmap falls back to feature-map static weights only |
| 7 | Directory roles (sanity-check that the running identity is a reader) | `GET /directoryRoles` | `Directory.Read.All` | Non-fatal; provenance note only |

**Fallback philosophy:** every degraded signal is rendered as an explicit *"not measured, and here's why"* block. A CFO-facing report must never show `$0` where the truth is "we couldn't look."

### 2.1 The "actually deployed" evidence question

The brief's example — *"0 Safe Links policies exist"* — cannot be proven with the five approved scopes. Reading Safe Links / Safe Attachments policy objects requires Exchange Online or Defender endpoints; reading Conditional Access requires `Policy.Read.All`.

**Proposed v1.0 answer:** Secure Score `controlScores` is the deployment-evidence source. It already knows whether Safe Links, MFA, legacy-auth blocking, DKIM, etc. are actually enforced, and it costs no additional scope beyond `SecurityEvents.Read.All`. The feature map is therefore keyed to Secure Score control names, with `scoreRatio` thresholds deciding deployed / partial / not-deployed.

This keeps least-privilege intact, keeps the consent dialog short, and keeps the trust story clean. **Flagged for sign-off** — Open Question 1.

---

## 3. The core IP: `feature-map.json`

Data, not code. One entry per security-bearing capability:

```jsonc
{
  "id": "mdo-safe-links",
  "displayName": "Safe Links (time-of-click URL protection)",
  "category": "Email & collaboration",
  "entitledBy": {
    "servicePlanNames": ["ATP_ENTERPRISE", "THREAT_INTELLIGENCE"]
  },
  "evidence": [
    { "type": "secureScoreControl", "controlName": "MDO_SafeLinksForOfficeApps",
      "deployedWhen": ">=0.9", "partialWhen": ">0" }
  ],
  "valueWeight": 3,
  "risk": { "threatScenario": "credential-phishing",
            "likelihoodReductionPct": 0.35 },
  "learnUrl": "https://learn.microsoft.com/..."
}
```

`valueWeight` drives feature-level dollarisation (§4). `risk.likelihoodReductionPct` feeds the ROI sentence. Adding a capability in v1.1 is a JSON edit, not a code change.

---

## 4. Dollarisation model (must be defensible to a CFO)

**Seat-level waste** is arithmetic and uncontroversial: `wastedSeats × pricePerSeatPerYear`, across the five canonical categories.

**Feature-level waste** needs an explicit, stated allocation model, because no vendor publishes "the Safe Links portion of an E5 seat." Proposal:

```
securityValueShare(SKU)          # e.g. E5 = 0.40, E3 = 0.15 — declared per SKU in pricelist.json
securityBudget(SKU) = price × seats × securityValueShare
featureValue(f)     = securityBudget × valueWeight(f) / Σ valueWeight(all security features in SKU)
idleFeatureSpend    = Σ featureValue(f) for every f that is entitled but not deployed
```

Every number in that chain lives in a JSON file the user can override, and the report prints the allocation model and the `securityValueShare` values it used. Framed in the report as *"the share of your security budget attached to controls that are switched off"* — an allocation, explicitly not a Microsoft price. **Flagged for sign-off** — Open Question 3.

**Risk reduction (single highest-impact gap only, per §2.6):**

```
expectedAnnualLoss   = likelihood × impact                    # from risk-model.json
residualLoss         = likelihood × (1 - likelihoodReductionPct) × impact
annualRiskReduction  = expectedAnnualLoss - residualLoss
```

Output sentence: *"$X/year you already pay for is sitting idle in &lt;feature&gt;. Turning it on is estimated to reduce expected annual loss by ~$Y."*

---

## 5. Build sequence

| M | Milestone | Exit criterion |
|---|---|---|
| **M0** ✅ | Repo scaffold: module manifest, loader, config schema, PSScriptAnalyzer + Pester CI, read-only guard test | `Import-Module` clean, CI green, `Test-CHSIPrerequisite` runs |
| **M1** ✅ | **Walking skeleton** — end-to-end: `/organization` + `/subscribedSkus` → pricelist → spend + seat realization → three-layer HTML + JSON + CSV | One command produces a real, openable, self-contained HTML file from a fixture; live-tenant run pending |
| **M2** | Collectors: users (with the `signInActivity` 403 dance), Secure Score + 90-day history + comparative scores | Snapshot schema frozen; degradation paths unit-tested |
| **M3** | Analysis: 5 seat-waste categories + all 3 edge cases (403, unlimited free SKUs, exemption list); feature map + gap detection across ~20 controls | Numbers reconcile against fixtures to the cent |
| **M4** | Dollarisation, risk model, roadmap ranking (value ÷ effort, using `implementationCost` / `userImpact` / `rank`) | The ROI sentence renders correctly |
| **M5** | Full renderer: three layers (board / exec / architect), inline SVG trend + bar charts, base64 assets, print stylesheet | Passes offline test: airplane mode, `file://`, no console errors |
| **M6** | Docs + samples: README (what it is, read-only statement, scopes, quick start, sample output, v1.1 roadmap), `SCOPES.md`, `METHODOLOGY.md`, published sample report | Definition of Done §6 satisfied line by line |

M1 is deliberately thin and vertical — a real report file from a real tenant before any breadth.

---

## 6. Test approach

- **Pester 5**, three tiers:
  - *Unit* — analysis functions against hand-built objects. Every waste category, every degradation path, every edge case.
  - *Contract* — collectors with `Invoke-CHSIGraphRequest` mocked to return recorded fixtures. Verifies paging, 403 → degrade, 429 backoff.
  - *End-to-end offline* — `New-CHSIReport -FromSnapshot tests/fixtures/*.json` renders a complete HTML/JSON/CSV set with **zero credentials and zero network**. This is the primary regression gate.
- **Fixtures**: three synthetic tenants — `premium` (E5, P1, full Secure Score), `basic` (Business Premium, no P1 → 403 path), `messy` (free SKUs with unlimited seat counts, service accounts, disabled users, over-provisioned E5).
- **Read-only guard test** (the trust signal, enforced in CI): a Pester test that fails the build if any source file contains a mutating Graph verb (`New-Mg*`, `Set-Mg*`, `Update-Mg*`, `Remove-Mg*`) or an `Invoke-MgGraphRequest` with a method other than GET. Cite it in the README — "enforced by CI," not just "we promise."
- **PSScriptAnalyzer** clean at Warning level.
- **HTML render test**: structural assertions (required sections present, no external `http(s)://` asset references, single file, opens standalone) rather than byte comparison.

Snapshot save/replay (`-SaveSnapshot` / `-FromSnapshot`) is a **developer and support** affordance, not state: nothing is read back automatically, no run depends on a prior run. Noted because it brushes against the "stateless in v1.0" constraint — Open Question 4.

---

## 7. Open questions / assumptions

| # | Question | My assumption if you don't override |
|---|---|---|
| 1 | **Deployment evidence source.** | ✅ **RESOLVED** — Secure Score `controlScores` only. Direct policy reads (`Policy.Read.All`, Exchange Online) deferred to the v1.1 roadmap. |
| 2 | **Naming.** | ✅ **RESOLVED** — `CloudHarbor.M365SecurityInvestment`, prefix `CHSI`. |
| 3 | **Feature-level dollar allocation.** | ✅ **RESOLVED** — §4 model approved; printed in the report's methodology block. |
| 5 | **Cloud Harbor brand assets.** | ✅ **RESOLVED** — see §8. No ZTRA doc supplied; methodology wording stays generic until one is. |
| 4 | **Snapshot save/replay** as a dev/support affordance under the stateless constraint. | Included, off by default, documented as non-state |
| 6 | **Currency / pricing basis** — USD, Microsoft public list, annual-commitment monthly rates, annualised for reporting. | As stated, labelled in the report header |
| 7 | **Test tenant.** | ✅ **RESOLVED** — `cloudharbor-demo.com` (`cloudharbordemo.onmicrosoft.com`). Not yet run against live; fixture validation only so far. |

---

## 8. Brand implementation

Source of truth: `…/Documents/Visual Identity Brand Project`. Values below are taken from `Cloud_Harbor_Colors.pdf`, which is the colour spec sheet and wins over the exported SVGs where they disagree (the SVGs are off by one value in several channels — e.g. Saffron `#FCEB2E` vs the spec's `#FCEB2F`). Note also that the *file names* use older colour names (`Cumulus_Cyan`, `Cyclone_Smoke`, `Storm_Gray`) than the spec sheet (`Cumulus Blue`, `Tornado Smoke`, `Dust Storm Gray`); the code uses spec-sheet names.

| Brand colour | Hex | Role in the report |
|---|---|---|
| Cumulus Blue | `#269CDD` | Primary accent — headings, chart series 1, key figures |
| Stratus Blue | `#7DCFF6` | Secondary fills, chart series 2, benchmark bands |
| Fractus Saffron | `#FCEB2F` | Highlight / attention only — **never text**, 1.1:1 on white |
| Tornado Smoke | `#222121` | Body text, dark surfaces |
| Dust Storm Gray | `#868484` | Borders, axis lines, de-emphasised labels |
| Cloud White | `#FFFFFF` | Page ground |

**Derived accessible tokens.** The brand palette alone can't carry a document that a CFO reads on a projector: Cumulus Blue is 3.1:1 on white (fails WCAG AA for body text) and Saffron is unreadable as text. So the report stylesheet defines the six brand colours as the base layer, plus a small set of derived shades for text-bearing roles (a darkened Cumulus for links and small text at ≥4.5:1, a darkened Storm Gray for secondary text). Every derived value is a documented tint/shade of a brand colour, not a new colour, and I'll list them in `METHODOLOGY.md` so the palette stays auditable.

**Typography:** Lato (confirmed as the brand face by `CH_PowerPoint_Guide.pdf`). Lato ships under the SIL Open Font License, so it can be legally base64-embedded in a report that gets emailed to clients. Regular + Bold only — two faces, ~148 KB total as WOFF2 after conversion, well inside a self-contained HTML budget. `ScaleVariable.otf` is **not** embedded: it's 380 KB, its licence isn't in the brand pack, and redistributing it inside a client deliverable is a risk not worth taking for a display face.

**Logo:** `Web_Files/Logos_SVG/CH_Logo_Horizontal_.svg` — 11 KB, pure paths, zero `<text>` elements, single fill. Inlined directly into the HTML (not base64) with `fill="currentColor"` so it recolours for light/dark and print without shipping five variants. `Web_Files/Favicons/Favicon.svg` becomes the base64 `<link rel="icon">`.

Total brand asset weight in the finished HTML: roughly 160 KB, before any report data.

Assumptions applied without asking (say the word if any are wrong): PowerShell 7.6+ only, no 5.1 back-compat; Microsoft Graph SDK v2 with narrow sub-modules rather than the meta-module; commercial cloud only (no GCC High / DoD endpoint switching in v1.0); HTML report is English-only.
