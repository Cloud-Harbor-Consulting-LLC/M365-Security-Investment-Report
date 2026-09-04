# Delivery Plan — M365 Security Investment Report

**v2.1** · Status: **approved 2026-09-04; M2 next** · Supersedes v1.0 (see [git history](../../commits/main/docs/DELIVERY-PLAN.md))

**Decisions signed off:** the app is **hosted on GitHub Pages** as a static site · single TypeScript calculation engine, so exported packs recalculate offline · PDF is the primary board deliverable, interactive HTML secondary · full console scope, ship when polished · Preact + TypeScript + Vite.

Interactive prototype of the target console: <https://claude.ai/code/artifact/5ab9ce9c-4c92-4118-85cf-7d61f9fff257>

---

## 0. What changed, and why

v1.0 of this plan built a PowerShell tool that emits a static HTML file. M0 and M1 shipped on that basis. Derek's review on 2026-09-04 reset the target:

> *"I expected this to be an interactive web app where myself, a customer, and a colleague can walk through a UI experience connecting to a tenant, scripts running in the background, and an interactive dashboard appears, along with tabs containing other detailed information… within the interactive dashboard, there should be areas to override, such as pricing."*

That is not a change of features. It is a change of **medium**, and it changes the product's centre of gravity:

| | v1.0 plan | v2.0 plan |
|---|---|---|
| What it is | A report generator | A **console** you run a meeting from, that also produces reports |
| Primary moment | Opening an HTML file after the fact | **Sitting with the customer while the numbers appear** |
| Pricing | A JSON file edited beforehand | **A field you change live, mid-conversation, and the board number moves** |
| Audience layers | Three sections of one document | **Tabs you switch between, in front of the room** |

The single most valuable consequence: **the override stops being a config feature and becomes a meeting feature.** When the CFO says *"we don't pay list, we pay $28"*, you type 28 and the idle-spend figure recalculates in front of them. That moment is the product. Nothing in a static file can do it.

### What survives from M0/M1

Roughly 60% of the code, and all of the hard-won correctness:

- The Graph collection layer and the GET-only chokepoint — unchanged, still the trust story.
- `sku-catalog.json`, `pricelist.json`, `feature-map.json`, `risk-model.json` — unchanged; still the IP.
- Scope assertion, config merge, snapshot capture/replay, run log, provenance.
- Every correctness lesson the live run taught: null-not-zero, seat claims never branching on dollar figures, unlimited-seat heuristics, scope disclosure.
- The whole test suite's *intent*, and the fixtures.

### What gets superseded

- `ConvertTo-CHSIHtml.ps1` and the SVG chart helpers (~700 lines). The rendering layer moves to the browser.
- Probably `Measure-CHSISpend.ps1` / `Resolve-CHSISku.ps1`, depending on Open Question 1 — the calculation engine likely moves to TypeScript so that overrides can recalculate without a round-trip.

Pivoting at two commits is cheap. Pivoting at twenty is not. This is the right moment.

---

## 1. The product, restated

A **read-only consultant's console** for Microsoft 365 security spend realization.

You run one command. A browser opens on your machine. You walk a customer through connecting to their tenant, watch the collection happen, and land in a live dashboard you can drive in the meeting — switching between board, executive and architect views, changing pricing assumptions on the spot, and modelling what closing each gap is worth. When the conversation ends, you export the agreed picture as a deliverable.

Everything else about the brief holds: read-only, single-tenant, consultant-run, Graph exposes no price, spend realization is the framing.

---

## 2. Architecture

Three tiers, with one deliberate rule: **each fact is produced in exactly one place.**

The app is a **static site on GitHub Pages**. There is no backend, and there is nowhere for customer data to go — a stronger privacy position than any hosted SaaS could offer.

```
                    ┌──────── TWO WAYS IN, ONE APP ────────┐
                    │                                       │
   ┌─ MODE A · CONNECT ─────────┐        ┌─ MODE B · LOAD SNAPSHOT ──────────┐
   │ MSAL.js, auth code + PKCE  │        │ PowerShell collector runs locally │
   │ Browser calls Graph, GET   │        │ Get-CHSISnapshot → snapshot.json  │
   │ Zero install. Needs an app │        │ Dropped onto the page             │
   │ registration + admin consent│       │ No consent, no app registration   │
   └────────────┬───────────────┘        └───────────────┬───────────────────┘
                └────────────────┬───────────────────────┘
                                 ▼
┌─ ENGINE ─────────────────────────────── TypeScript, runs in the browser ───┐
│  Pure functions. Facts + reference data + overrides → model.               │
│  inventory · spend · seat waste · feature gaps · risk · roadmap            │
│  Recomputes in full on every override, in single-digit milliseconds        │
└────────────────────────────────────────────────────────────────────────────┘
                                 ▼
┌─ SURFACES ─────────────────────────────────────────────────────────────────┐
│  Dashboard (hosted)   ·   PDF board pack   ·   Single-file HTML   ·  JSON/CSV │
└────────────────────────────────────────────────────────────────────────────┘
```

**Why two modes rather than one.** Mode A is the sales motion: send a URL, the customer signs in, numbers appear, nothing to install. Mode B is the one that closes deals with security-conscious customers — some CISOs will not consent a third-party browser app against their directory, and for them the PowerShell collector they can read line by line is the *reason they say yes*. The M0/M1 collector is not a legacy path; it is the high-trust path.

**Why the engine is in the browser.** An override recalculates everything downstream — spend, waste, feature dollarization, risk, roadmap ranking. One TypeScript implementation means no drift, instant feedback, and an export a CFO can still interrogate offline.

**Where the data lives: nowhere but the tab.** No backend, no telemetry, no analytics, no logging endpoint. In Mode A, tokens live in session storage and die with the tab; in Mode B, the snapshot never leaves the browser. This must be stated plainly on the landing page and be *true* — no analytics scripts, ever, however tempting the funnel metrics.

---

## 3. The app experience

Open the URL. No install, nothing to download to get started.

| # | Screen | What happens | Why it earns its place |
|---|---|---|---|
| 1 | **Landing** | What the tool does, the read-only statement, where data goes (nowhere), and three ways in: **Connect**, **Load a snapshot**, **Explore the sample tenant** | The sample tenant means a prospect who found the repo sees the product working in 30 seconds. That is the top of the funnel. |
| 2 | **Pre-flight** | The exact five read-only scopes about to be requested, why each is needed, the least-privilege role, and a plain statement that nothing is written and nothing leaves the browser | The consent moment becomes a trust moment, *with the customer watching the screen* |
| 3 | **Connect** | MSAL sign-in, or drop a `snapshot.json` from the PowerShell collector | Two doors, one dashboard |
| 4 | **Collecting** | Live per-endpoint progress: what is being read, what succeeded, what degraded and why | Turns a 60-second wait into a demonstration of exactly what is and is not being touched |
| 5 | **Dashboard** | The working surface (§4) | — |

The consultant runs this on their own laptop in a meeting, or sends the link and talks the customer through it on a call. Same app either way.

### Dashboard tabs

| Tab | Audience | Content |
|---|---|---|
| **Board** | Board, CFO | Spend realized, idle spend, peer benchmark, the single highest-value opportunity. One screen, no scrolling, projector-legible. |
| **Executive** | CISO, CIO, CFO | Spend by product, realization trend, waste summary, roadmap headlines |
| **Wasted spend** | CFO, IT ops | Five seat-waste categories + feature-level idle spend, each drillable to the accounts or controls behind it |
| **Security features** | Architect | Entitled vs. deployed per capability, with the Secure Score control that proves it |
| **Roadmap** | Architect, CISO | Prioritized sequence, value ÷ effort, how-to-enable pointers |
| **Assumptions** | Everyone | Every override, every model input, every default — in one place, with what each one moves |
| **Not measured** | Everyone | First-class, not a footnote. What we couldn't see, why, and what it would take |
| **Evidence** | Architect | Per-endpoint provenance, scope disclosure, raw snapshot inspector |

---

## 4. Overrides, and the ideas I'd add

Derek asked for pricing overrides. These are the ones I'd argue for alongside, in priority order:

1. **Inline, not buried.** Every dollar figure is click-to-edit at the point it appears. A settings page loses the meeting; an editable number wins it. Changing one price re-renders every dependent figure with a brief highlight so the room *sees* what moved.

2. **Provenance on every number.** Click any figure for its derivation, the endpoint it came from, and whether it is measured, allocated, or assumed. This is the natural extension of the discipline already in the code — never show `$0` where the truth is "we could not look" — and it is what makes a CFO stop treating the report as a black box.

3. **Scenario modelling.** Toggle undeployed controls on and watch spend-realized and expected-loss move. This turns the roadmap from a list into a planning instrument, and it is the same arithmetic the report already does — just run forward.

4. **Presenter mode + redaction.** Full-screen, larger type, and a switch that replaces the tenant name and domain with a placeholder. You need this to screen-share, and you need it again to turn an engagement into a public case study.

5. **Session files (`.chsi`).** Save snapshot + overrides + notes; reopen to resume. Beyond the obvious convenience, **this is precisely the state model v1.1 delta tracking needs** — building it now de-risks the highest-value future feature instead of bolting it on later.

6. **Audience switch, not audience documents.** One dataset, three presentations, toggled live. Avoids the classic failure where the board deck and the architect appendix quietly disagree.

Overridable inputs: per-SKU price and pricing basis · security value share · inactivity threshold · exemption list · risk likelihood and impact · feature value weights · currency label.

---

## 5. Identity, consent and security

Hosting on GitHub Pages removes the local-server problem and replaces it with an identity problem. This is the part a customer's security team will actually review, so it gets designed first.

### 5.1 Two ways to authorise, both supported

Every `.Read.All` scope this tool uses requires **admin consent**. And the Microsoft Graph PowerShell client ID (`14d82eec-204b-4c2f-b7e8-296a70dab67e`, "Microsoft Graph Command Line Tools" — the one that appeared in our own live run) **cannot be reused**: its redirect URIs are registered for native and broker flows, not the SPA platform. Any browser app needs a registration behind it.

| | **Option 1 · Sign in and consent** | **Option 2 · Bring your own app registration** |
|---|---|---|
| How | Admin signs in to the published app and grants consent at the prompt | Customer registers an app, adds the SPA redirect URI, pastes the client ID into the tool |
| Setup | One click | ~5 minutes |
| Who can do it | See the roles below | Anyone who can register an app, plus an admin to consent |
| Trade-off | A third-party app appears in their directory | Nothing of ours in their tenant |
| Best for | Demos, prospects, fast engagements | Regulated or security-conscious customers |

**Which roles can consent.** Because this tool uses **delegated** permissions only, the bar is lower than Global Administrator. **Global Administrator**, **Privileged Role Administrator**, **Cloud Application Administrator** and **Application Administrator** can all grant tenant-wide admin consent here. The documented restriction on the last two — that they cannot consent to Microsoft Graph *app roles* — applies to application permissions, which this tool never requests. Worth stating in the docs, because "you need Global Admin" is the assumption that stalls these conversations.

Option 1 requires publishing a multi-tenant app registration. Two things to do before a customer sees that consent screen:

- **Complete publisher verification.** Without it the consent prompt says "unverified publisher", which is precisely the wrong first impression for a security tool.
- **Request the minimum, visibly.** The consent screen lists exactly five read-only permissions and nothing else. That screen *is* the trust pitch.

And a customer who refuses both still has Mode B, where nothing is registered and nothing is consented at all.

### 5.2 Browser security

- **Auth code flow with PKCE** (MSAL.js v2+). No implicit flow, no client secret — neither is available or acceptable on a static host.
- **Read-only delegated scopes only.** The scope list is identical to the PowerShell path and asserted in tests against one shared definition, so the two can never drift apart.
- **Tokens in session storage**, cleared on tab close. Never `localStorage`, never a cookie, never written to an export or a session file.
- **Strict CSP** served via `<meta>`: `default-src 'self'`, Graph and Entra endpoints explicitly allow-listed, `object-src 'none'`, no inline script in the hosted build.
- **No analytics, no telemetry, no error reporting endpoint.** A security tool that phones home is not a security tool.
- **Subresource integrity** on anything not first-party; prefer vendoring outright.
- Session resume writes overrides and notes to `localStorage` **only on explicit opt-in**, and never the snapshot or any token.

### 5.3 The read-only guarantee, extended

The guard now spans two languages:

- PowerShell: unchanged — one GET-only chokepoint, no mutating `*-Mg*` cmdlets, enforced by `tests/ReadOnly.Guard.Tests.ps1`.
- TypeScript: a single `graphGet()` client with no method parameter, plus a lint rule and unit test failing the build on any `fetch` to Graph with a method other than GET, and on any request to a non-Graph origin.

Both derive their scope list from the same JSON so the consent screen and the docs cannot disagree.

---

## 6. Export and delivery — an evidence-based correction

The v1.0 brief required the deliverable to "survive being emailed as an attachment." **Research says that premise is unsound, and getting weaker.** Outlook maintains a hard-coded block list, many organisations block `.htm`/`.html` attachments outright as a phishing control, and Outlook's preview pane disables scripting entirely. Microsoft's own guidance for blocked file types is to share a OneDrive or SharePoint link instead.

So the export strategy changes:

| Artifact | Purpose | Survives email? |
|---|---|---|
| **PDF board pack** | The thing you actually send to a board | Yes — this becomes the primary emailable deliverable |
| **Interactive HTML pack** | Self-contained, offline, fully interactive; shared via link or file transfer | Often blocked as an attachment; excellent via OneDrive/SharePoint link |
| **JSON + CSV** | Finance and automation | Yes |

The interactive HTML is built **static-first**: the board and executive figures render as plain HTML with zero JavaScript, and interactivity layers on when scripts are allowed to run. A preview pane with scripting disabled still shows correct, readable numbers — it simply cannot recalculate. That is progressive enhancement doing real work, not a nicety.

---

## 7. Front-end stack and hosting

- **Preact + TypeScript, built with Vite.** Preact keeps the runtime near 10 KB against React's ~45 KB, which matters when the whole pack inlines into one file.
- **`@azure/msal-browser`** for Mode A. Auth code + PKCE, no secret.
- **Two Vite build targets from one codebase:** a multi-file build deployed to Pages, and a `vite-plugin-singlefile` build that inlines everything into the offline export.
- **Charts hand-rolled as SVG components.** The needs are few and specific (gauge, bars, trend, waterfall). A library costs 40–200 KB, brings its own licence, and fights the brand palette. The M1 SVG work moves to Preact components.
- **PDF via headless Chromium print-to-PDF.** Edge ships on every Windows machine, so the PowerShell path can drive `--headless --print-to-pdf` with no extra install; the hosted app falls back to the browser's own print dialogue against a dedicated print stylesheet. No PDF library, no server.
- **Deployment:** GitHub Actions builds and publishes to Pages on merge to `main`. Hosted on the default `github.io` URL for now; a custom domain stays on the list for later, and the only real cost of deferring it is that the redirect URI has to be re-registered when it changes.

### 7.1 Visual identity

The palette and the typeface carry the identity. **No logo, wordmark or favicon ships in this repo.**

This is an open-source, public, forkable tool, and a trademark travelling with every fork is wrong twice over: the forker inherits a mark they have no right to, and the mark's owner loses control of where it appears. So M1's logo and favicon have been removed from the module, `preparedBy` no longer defaults to any firm's name — a report carries the name of whoever actually prepared it, or no name at all — and the report footer credits the project rather than a company. `tests/EndToEnd.Offline.Tests.ps1` asserts all of this so it cannot creep back.

What stays: the six-colour palette (Cumulus Blue `#269CDD`, Stratus Blue `#7DCFF6`, Fractus Saffron `#FCEB2F`, Tornado Smoke `#222121`, Dust Storm Gray `#868484`, Cloud White) with the derived accessible shades from M1, and **Lato**, self-hosted from the repo under the SIL OFL rather than fetched from Google Fonts — so the CSP stays tight and no third party sees viewer IPs.

---

## 8. Model contract

The seam between tiers is a versioned TypeScript type, generated to JSON Schema and validated on both sides:

```
Snapshot        facts as collected, plus provenance   (PowerShell writes, engine reads)
ReferenceData   catalog · pricelist · feature map · risk model
Overrides       user changes, each with author and timestamp
ReportModel     everything computed  (engine writes, views and exports read)
```

`Snapshot` and `ReferenceData` are already close to this shape — the M1 schemas mostly stand.

---

## 9. Build sequence

| M | Milestone | Exit criterion |
|---|---|---|
| **M0** ✅ | Module scaffold, config, CI, read-only guard | Done |
| **M1** ✅ | Collector + static report walking skeleton | Done; renderer to be superseded |
| **M2** | **App walking skeleton** — Vite/Preact scaffold, Pages deploy pipeline, snapshot drop (Mode B), one real dashboard tile from the M1 fixture | A public URL renders a real number from a real snapshot |
| **M3** | **Engine in TypeScript** — port inventory/spend/waste; model contract; parity tests against the M1 fixtures | Identical figures to M1 on `premium` and `unpriced`, to the cent |
| **M4** | **Mode A: connect** — MSAL PKCE, pre-flight consent screen, GET-only Graph client, live collection progress, BYO client ID | Sign in to a real tenant from the hosted app and collect |
| **M5** | **Dashboard views** — all tabs, brand system, presenter mode, redaction, sample-tenant mode | Demoable end-to-end with no tenant and no install |
| **M6** | **Overrides + scenarios** — inline editing, provenance popovers, what-if modelling | Change a price mid-meeting; every dependent figure moves |
| **M7** | **Remaining analysis** — Secure Score + history + benchmark, feature gaps, five waste categories, risk, roadmap | The brief's §2 in full |
| **M8** | **Exports** — PDF board pack, single-file interactive HTML, JSON/CSV, session files | A board pack a CFO would accept |
| **M9** | **Public-ready** — custom domain, app-registration walkthrough, accessibility pass, docs, screenshots, licence and privacy review | Someone who has never met us can run it against their own tenant |

M2 stays deliberately thin and vertical — a deployed URL showing one real number — and deliberately starts with **Mode B**, because it needs no app registration and therefore no external dependency to get the pipeline proven end to end.

---

## 10. Test approach

Extends M1's rather than replacing it.

- **Engine parity** — the TypeScript engine and the M1 fixtures must agree exactly. Vitest, run in CI, using `premium-snapshot.json` and `unpriced-snapshot.json` as golden inputs. This is what makes the port safe.
- **PowerShell** — Pester, unchanged, now covering collection and the console host rather than rendering.
- **Read-only guard** — extended to the HTTP surface: no route reaches a mutating Graph call; the listener refuses non-loopback binds.
- **Component and view tests** — the correctness lessons become UI assertions: no `$0` where a figure is unknown, no seat claim derived from a dollar figure, "not measured" rendered as a state rather than a blank.
- **Accessibility** — contrast and keyboard-navigation checks in CI. This gets projected in meeting rooms.
- **Export integrity** — the single-file pack references no external origin; the no-JS render still shows correct board figures.

---

## 11. Conflicts with the original brief, for explicit sign-off

| Brief constraint | Status |
|---|---|
| "Self-contained HTML, one file, renders offline" | **Kept.** Still one file, still offline, now interactive. |
| "…survive being emailed as an attachment" | **Challenged on evidence** (§6). PDF becomes the emailable artifact. |
| "Stateless in v1.0" | **Relaxed deliberately.** Session files are local, user-owned, and never auto-read — the same justification as snapshots. They are also the foundation for v1.1 delta tracking. |
| "PowerShell 7 + Graph SDK" | **Kept** for everything touching the tenant. TypeScript is presentation and arithmetic only. |
| "Read-only, no write, ever" | **Kept, and hardened** — the guard now covers the HTTP surface too. |
| "Support unattended (cert) auth" | **Kept** for authentication on the PowerShell path. Unattended *report generation* defers to v1.1 (§12). |
| Delivery model | **Changed.** A publicly hosted web app, not only a module you install. The PowerShell collector stays as the high-trust path for customers who will not consent a browser app. |
| "No multi-tenant / MSP mode" | **Kept.** One tenant per session, no cross-tenant storage, nothing persisted server-side — there is no server. An optional Cloud Harbor multi-tenant *app registration* (§5.1) is a consent convenience, not MSP mode. |

---

## 12. Open questions

| # | Question | Resolution |
|---|---|---|
| 1 | Does the **exported** pack recalculate overrides offline? | ✅ **Yes.** One TypeScript engine; PowerShell collects facts and computes nothing monetary. No dual implementation, no drift, and the pack stays interrogable after the meeting. |
| 2 | **Front-end stack** | ✅ **Preact + TypeScript + Vite**, `vite-plugin-singlefile` for the export build. Contributors need Node; end users never do. |
| 3 | **Primary board deliverable** | ✅ **PDF primary, interactive HTML secondary** (§6). |
| 4 | Does **unattended/CI report generation** stay in v1.0? | **Deferred to v1.1** — it follows from decision 1. `Get-CHSISnapshot` still runs unattended; computed exports come from the engine. |
| 5 | Scope of "ready for public use" | ✅ **Full console, M2–M8, ship when polished.** Roughly 3× the original v1.0 scope, accepted deliberately. |

### Still open, raised by the hosting decision

| # | Question | Resolution |
|---|---|---|
| 6 | **Authorisation model** | ✅ **Both, first-class.** Sign in and consent against the published app, or supply your own app registration (§5.1). |
| 7 | **Domain** | ✅ **`github.io` for now.** Custom domain deferred; re-registering the redirect URI is the only cost of changing later. |
| 8 | **Repo layout** | ✅ **One repo.** The app and the module share reference data, the scope list and the fixtures; splitting them invites exactly the drift the parity tests exist to prevent. |
| 9 | **Visual identity** | ✅ **Palette and typeface only, no marks** (§7.1). |

### Now open, following from those

| # | Question | My recommendation |
|---|---|---|
| 10 | **Who publishes the multi-tenant app** for Option 1, and under what publisher identity? | Cloud Harbor's own tenant, with publisher verification completed before any customer sees the consent screen. An "unverified publisher" warning on a security tool undoes the whole trust argument. |
| 11 | **What is the product called** in the consent prompt and the page title, now that no wordmark ships? | Something plain and descriptive — "M365 Security Investment Report" — rather than a brand. It is what the customer will see in their enterprise-apps list forever. |

### Consequence of decision 4, recorded so it does not surprise us

PowerShell keeps `Connect-CHSITenant`, `Get-CHSISnapshot` and `Test-CHSIPrerequisite` as unattended-capable cmdlets, but `New-CHSIReport` loses its ability to produce computed HTML/JSON/CSV without the engine. Until an unattended export path exists in v1.1, a scheduled or CI run captures a snapshot; producing figures from it needs the console. Anyone relying on the M1 behaviour needs to know that before we remove it.

---

## 13. Onboarding: why nobody registers an app

Settled 2026-09-04, after examining a working precedent (`ca-policy-analyzer`, same architecture: GitHub Pages, browser-only, Graph, offline import).

**The chicken-and-egg is real.** Creating an app registration requires a Graph token; obtaining a token in a browser requires an app registration with a SPA redirect URI. Microsoft's own first-party client IDs cannot substitute, because their redirect URIs are registered for native and broker flows and ours cannot be added to them.

**The question dissolves anyway.** One multi-tenant registration exists, once, in the project's tenant. When an administrator consents, **Entra creates the enterprise application in their tenant automatically**. Nothing is created by this tool, which is what keeps the read-only guarantee intact — a tool that created app registrations would need `Application.ReadWrite.All`, and the trust story would collapse with it.

The distinction that causes the confusion:

| | App registration | Enterprise application (service principal) |
|---|---|---|
| What | The definition: client ID, redirect URI, requested permissions | An instance of it inside one tenant |
| Lives in | Our tenant. One, forever | Each customer's tenant. One per customer |
| Created by | Us, once, by hand | Entra, automatically, on consent |

So the client ID is a build-time constant (`VITE_MSAL_CLIENT_ID`), and supplying your own is an option for organisations that will not accept a third-party app in their directory — never a prerequisite.

### Incremental consent

`AuditLog.Read.All` and `SecurityEvents.Read.All` are **not** requested at sign-in. Both are entitlement-gated — the first needs Entra ID P1, the second Security Reader — so requesting them up front makes sign-in fail outright in tenants that cannot grant them, taking the licence inventory and spend analysis with it. Those need neither.

This is the auth-layer expression of the rule the report already follows: **an optional signal degrades a section, it never fails the run.** The optional scopes are requested at the moment a section needing them is used, and a refusal renders that section as not measured.

### Consent roles

Because these are delegated permissions, tenant-wide consent does **not** require Global Administrator. Privileged Role Administrator, Cloud Application Administrator and Application Administrator can each grant it; the documented restriction on the latter two covers Microsoft Graph *app roles*, which are application permissions this tool never requests. The app states this on the pre-flight screen, because "you need Global Admin" is the assumption that stalls these conversations.
