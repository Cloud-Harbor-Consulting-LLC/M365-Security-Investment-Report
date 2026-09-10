# Security policy

This tool is pointed at customers' Microsoft 365 tenants by people who are trusting it not
to make things worse. Reports are welcome and taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for a suspected vulnerability.**

Two ways, either is fine:

1. **GitHub private vulnerability reporting** — the **Report a vulnerability** button under
   this repository's **Security** tab. Preferred: it keeps the report private, threads the
   discussion, and produces an advisory with a CVE if one is warranted.
2. **Email** <derek.morgan@cloudharborconsulting.cloud>, with `SECURITY` in the subject.

Useful to include: what you did, what happened, what you expected, and the affected version
or commit. A proof of concept helps. If you are unsure whether something counts, report it —
deciding that is not your job.

**Please do not include a real tenant snapshot.** They contain user principal names,
tenant identifiers and verified domains. A redacted extract, or the synthetic fixtures in
`tests/fixtures/`, will almost always demonstrate the point.

### What to expect

- Acknowledgement within **5 working days**.
- An assessment, and a fix or an explanation of why it is not one, within **30 days** for
  anything exploitable.
- Credit in the advisory and the release notes, unless you would rather not be named.

This is a small open-source project maintained alongside client work. There is no bug
bounty, and no legal threat either: research in good faith against your own tenant, or
against the sample tenant, is welcome.

## Supported versions

`main` is the supported version. Fixes land there and deploy to the hosted app on merge.
There are no maintained release branches.

## What is in scope

- The hosted app and anything it does in a browser.
- The PowerShell module and the collector.
- The build and release pipeline, and anything that could poison what gets published.
- The exported artifacts — the one-file HTML report, CSV, JSON, session files.

Particularly interested in anything that would:

- **cause a write to a tenant**, in any path, under any conditions;
- **send tenant data to any origin** other than Microsoft's;
- **execute attacker-controlled content** from a tenant — a display name, a Secure Score
  remediation string — in the app, in an export opened in Excel, or in the one-file report;
- **leak a token** into a file, a URL, or storage that outlives the tab.

## What is out of scope

- Microsoft's own services, the Entra consent model, and the contents of Secure Score.
  Report those to Microsoft.
- "Unverified publisher" on the consent screen. That is a known state, documented in
  [`docs/APP-REGISTRATION.md`](docs/APP-REGISTRATION.md), and pending publisher
  verification.
- Missing security headers that a static host cannot set, where the page already sets the
  equivalent via `<meta>`.
- Anything requiring an already-compromised administrator account, since the tool's whole
  access is the signed-in user's.
- Findings from automated scanners with no demonstrated impact.

## The guarantees, and how they are enforced

These are the claims the tool makes. Each is enforced by a test that fails the build, not
by a promise:

| Claim | Enforced by |
|---|---|
| Every Graph call is a `GET` | `app/src/graph/readonly.test.ts`, `tests/ReadOnly.Guard.Tests.ps1` — one module may call `fetch`, the verb is hardcoded, no caller can choose a method, and no mutating verb may appear in the source |
| Only read scopes are requested | Both guards reject any scope not matching `.Read`/`.Read.All`; the PowerShell and TypeScript tiers must request the identical set |
| Tokens go nowhere but Graph | The client refuses any non-Graph origin |
| The page reaches only Microsoft | `Content-Security-Policy` in `app/index.html` |
| The one-file report reaches nothing | `default-src 'none'`, plus a test that scans the built artifact for any external reference |
| A tenant string cannot execute in a spreadsheet | Formula-injection escaping, tested end to end with a hostile display name |
| A tenant string cannot break out of the HTML report | HTML and `<script>`-context escaping, tested with `</script>` payloads |

If you find a way past any of these, that is exactly the report worth sending.

## Dependencies

Deliberately few, because each one is a supply-chain risk in a tool that touches tenants.

Browser runtime: **Preact** and **@azure/msal-browser**. That is all.
PowerShell: **Microsoft.Graph.Authentication**.

Everything else is a build or test dependency and does not ship. The report's fonts are
vendored from the repository rather than fetched from a font host, so no third party sees
a viewer's IP.

## Cryptography

None of our own. Authentication is authorization code flow with PKCE via MSAL; transport
is HTTPS. There is no bespoke crypto, no secret storage, and no client secret anywhere —
a single-page application cannot hold one.

---

For what the tool reads and what the files you save contain, see
[`docs/PRIVACY.md`](docs/PRIVACY.md).
