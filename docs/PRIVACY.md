# Privacy

This tool reads a Microsoft 365 tenant. It handles the names, addresses and licence
assignments of real people, and it produces files that carry them. This page says what is
read, where it goes, and what you are holding afterwards.

Everything below is verifiable in the source, and the last section says where to look.

---

## The short version

- There is no backend. No server of ours receives tenant data, because there is no server
  of ours. The app is static files on GitHub Pages.
- Nothing is uploaded. Collection goes browser to Microsoft Graph and back. Analysis
  happens in the page.
- Nothing is stored. No database, no account, no cookies, no analytics, no telemetry.
- Files leave only when you save them, to a location you choose, and they stay on your
  disk.
- The tool cannot write to your tenant. Every Graph call is a `GET`, and CI fails the build
  if that stops being true.

---

## What is read from the tenant

4 collectors, all `GET`, all against `graph.microsoft.com`:

| Endpoint | What comes back |
|---|---|
| `/v1.0/organization` | Tenant name, id, verified domains |
| `/v1.0/subscribedSkus` | Subscribed licence SKUs, seat counts, service plans |
| `/v1.0/users` | The fields listed below, one row per account |
| `/v1.0/security/secureScores`, `/secureScoreControlProfiles` | Secure Score, its history, and per-control status |

Personal data is limited to the user query, and to these fields:

```
id, displayName, userPrincipalName, accountEnabled, userType,
createdDateTime, assignedLicenses, department, signInActivity
```

That list is what seat-waste analysis needs, and it is the whole of the personal data.

No mail, no files, no calendars, no group membership, no device data, no message content.
The permissions to read any of that were never requested, so the tool could not read it
even if asked to.

`signInActivity` is dropped automatically when the tenant has no Entra ID P1, because Graph
refuses the whole query without it.

---

## Where the data goes

**Mode A, connect from the browser.** Your browser authenticates against
`login.microsoftonline.com`, then calls `graph.microsoft.com` directly. The results stay in
the page's memory. The only origins the page may contact are Microsoft's own, enforced by a
Content-Security-Policy on the page.

**Mode B, PowerShell collector.** You run the collector yourself, it writes a snapshot file
to your disk, and you drop that file into the app. Nothing is transmitted anywhere. The
file is read locally by the page.

Either way the analysis is arithmetic performed in your browser, and there is nowhere for
the data to go afterwards.

### What Microsoft sees

An authentication event in your own sign-in logs, and the Graph read requests, which appear
in your own audit logs. This is your tenant reading itself, and you are the one who can see
it.

### What GitHub sees

The app is hosted on GitHub Pages. GitHub serves the HTML, JavaScript, CSS and fonts, and
like any web host it can see the requests for those files: IP address, user agent,
timestamp.

That is the hosting of the application. No tenant data is in those requests, because
collection happens after the page has loaded and goes directly to Microsoft.

If that is unacceptable, 2 options remove it. Use Mode B with the PowerShell collector, or
fork and host the app yourself.

There is no analytics, no tag manager, no error-reporting service, and no third-party
script of any kind. The page loads nothing from any origin except itself.

---

## Tokens

- Held in `sessionStorage`, so they die when the tab closes.
- Never written to `localStorage`, to a session file, or to any export.
- Never sent to any origin except `graph.microsoft.com`. The client refuses, and a test
  enforces it.
- Authorization code flow with PKCE. There is no client secret, because a single-page
  application cannot keep one.

---

## What the files you save contain

This is the section worth reading twice, because these are the files that get forwarded.

| File | Contains personal data? |
|---|---|
| **Session file** (`.m365session.json`) | **Yes.** The full snapshot, including every user row, plus your prices. |
| **Report JSON** | **Yes.** The whole model, including provenance. |
| **`wasted-spend-accounts.csv`** | **Yes.** User principal names and display names, one row per account. |
| Other CSV sections | No. Licences, controls, threats and roadmap only. |
| **One-file HTML report** | **Yes.** It embeds the snapshot so the report can be re-derived. |
| **Board pack (PDF or print)** | No. Aggregates only, with no account-level rows. |

The board pack is the artifact designed to circulate. The account-level CSV is the one to
think about before attaching it to an email.

Every export names this in its own README, so a folder of CSVs on someone else's desk still
says what it holds.

**Redaction** blurs tenant identity on screen for screen-sharing. It is a presentation
setting. It does not remove data from the model, and it does not redact exports.

---

## Retention

We hold nothing, so there is nothing to retain and no deletion to request.

What exists is what you saved: files on your own disk, and whatever you have forwarded.
Deleting them is the whole of it.

To revoke the tool's access to your tenant, see
[APP-REGISTRATION.md, Removing access](APP-REGISTRATION.md#removing-access).

---

## Children's data, special categories, and lawful basis

The tool reads directory metadata about employee accounts. It does not read content, does
not profile individuals, and produces no automated decision about any person. The
account-level output exists to identify licences that nobody is using, so the subject is
the seat.

If you operate under the UK GDPR, the EU GDPR or similar, you remain the controller for
your own tenant's data throughout. Nothing here creates a processor relationship, because
nothing is processed anywhere except your own browser.

---

## How to verify any of this

- Graph is `GET`-only: `app/src/graph/client.ts`, plus the tests in
  `app/src/graph/readonly.test.ts` and `tests/ReadOnly.Guard.Tests.ps1` that fail the build
  if a mutating call or a non-read scope appears.
- The origins the page may contact: the `Content-Security-Policy` in `app/index.html`.
- The one-file report contacts nothing at all: its policy is `default-src 'none'`, and a
  test scans the built artifact for any external reference.
- The fields read from `/users`: `collectUsers` in `app/src/graph/collect.ts`.
- What each export contains: `app/src/engine/export.ts`.

---

## Questions

Open an issue, or email <derek.morgan@cloudharborconsulting.cloud>.

For a suspected vulnerability, use [SECURITY.md](../SECURITY.md) instead of a public issue.
