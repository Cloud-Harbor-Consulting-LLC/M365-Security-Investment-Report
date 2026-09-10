# App registration and consent

Everything this tool does against a tenant is a Microsoft Graph `GET`. It holds no write
permission at any point, and there is no backend for tenant data to reach — the app is a
static site, and what it reads stays in your browser.

This page is about the one piece of setup that touches your directory: how the app is
allowed to sign someone in and read.

---

## Which of these are you?

| You | What you need to do |
|---|---|
| **Running a report against a tenant you administer** | Probably nothing. Sign in at the hosted app and consent once. → [Option 1](#option-1--sign-in-and-consent) |
| **Your organisation will not accept a third-party app in its directory** | Register the app in your own tenant and paste the client ID into the tool. → [Option 2](#option-2--bring-your-own-app-registration) |
| **You would rather not consent to anything at all** | Skip sign-in entirely. Run the PowerShell collector and drop the snapshot file into the app. → [Option 3](#option-3--no-app-registration-at-all) |
| **You forked this and are hosting your own copy** | Your own registration, with your own redirect URI. → [Self-hosting](#self-hosting-a-fork) |

---

## What is being approved

Five delegated permissions. All read-only, and the same five whichever option you take —
the app and the registration script both read them from
[`graph-scopes.json`](../src/CloudHarbor.M365SecurityInvestment/Data/graph-scopes.json),
so the consent screen and this table cannot drift apart.

| Permission | Required | What it is for | Least-privilege role |
|---|---|---|---|
| `Organization.Read.All` | Yes | Tenant identity, verified domains, and the subscribed SKU inventory the whole report is built on | Global Reader |
| `Directory.Read.All` | Yes | Directory objects and role assignments; confirms the running identity is a reader and resolves licence assignment | Global Reader |
| `User.Read.All` | Yes | Per-user account state and licence assignment — the basis for seat-level waste analysis | Global Reader |
| `AuditLog.Read.All` | No | Sign-in activity, for the never-signed-in and inactive waste categories | Global Reader |
| `SecurityEvents.Read.All` | No | Secure Score, its history, and the control-level status that proves whether a licensed security feature is actually deployed | Security Reader |

**Delegated, not application.** The app can only ever see what the person signed in can
see. It cannot run unattended, and it cannot act when nobody is signed in.

**The two optional ones are worth granting.** They are ordinary delegated permissions any
tenant can consent to, but they are *entitlement*-gated at the point of use:
`AuditLog.Read.All` needs Entra ID P1 for sign-in activity, and `SecurityEvents.Read.All`
needs the Security Reader role for Secure Score. Without them the report still runs — the
affected sections report themselves as **not measured**, with the reason, rather than
showing zero. But Secure Score is where the entire "paid for and not switched on" analysis
comes from, so a report without it is a licence inventory rather than a spend-realization
report.

If an administrator declines the full set, the app retries with the three required
permissions rather than failing outright. Entra's consent screen is all-or-nothing, so
without that retry an admin uneasy about one permission would get no report at all.

### Who can consent

Because this app requests **delegated permissions only** — no application permissions, no
Graph app roles — the least-privileged roles that can grant tenant-wide consent are:

- **Cloud Application Administrator**
- **Application Administrator**
- **AI Administrator**

**Privileged Role Administrator** can also consent, and is the role Microsoft names for
apps requesting *any* permission including app roles. **Global Administrator** works too,
being a superset of all of these — but it is not the least-privileged answer, and asking
for it when Cloud Application Administrator would do is how these requests get refused.

### Who can register, and who can run

Three different things, deliberately:

| Task | Minimum role |
|---|---|
| Register the app (Option 2) | **Application Developer** |
| Grant tenant-wide consent | **Cloud Application Administrator** (see above) |
| Run reports, once consented | **Global Reader**, plus **Security Reader** for Secure Score |

Consenting is not the same as using. Once consent is granted, the people actually running
reports need no administrator role at all.

---

## Option 1 — Sign in and consent

Nothing to create. The registration exists once, in the project's tenant, and is
multi-tenant; when an administrator in your tenant consents, Entra creates the enterprise
application on your side automatically.

1. Open the app: <https://cloud-harbor-consulting-llc.github.io/M365-Security-Investment-Report/>
2. Choose **Connect to a tenant**.
3. Read the pre-flight screen. It lists every permission and why it is needed, before
   anything is requested.
4. Sign in as someone who can consent, and approve.

The app then appears in your directory under **Entra ID** → **Enterprise apps**. To remove it later,
see [Removing access](#removing-access).

> **On "unverified publisher".** Publisher verification is not yet complete, so the
> consent screen currently shows that warning. It is accurate, and you should treat it the
> way you would treat it for any third-party app: if that is not acceptable to your
> organisation, use Option 2 or Option 3, both of which avoid trusting a third-party
> registration entirely.

**The client ID is not a secret.** A single-page application cannot hold one — there is no
server to keep it on. It ships in the browser bundle by design. The security boundary is
the redirect URI, which Entra enforces, and your tenant's consent.

---

## Option 2 — Bring your own app registration

The app is then registered by you, in your directory, under your control, and nothing
belonging to anyone else appears in your tenant. You still use the hosted site; only the
client ID changes.

### With the script

The repository ships one. It is the only thing here that writes to a directory, and it is
deliberately not part of the reporting module.

```bash
./scripts/New-AppRegistration.ps1 -TenantId contoso.onmicrosoft.com
```

It creates a multi-tenant registration with the SPA redirect URIs and the five delegated
read-only permissions, refuses to continue if any scope is not read-only, and prints the
client ID and an admin-consent URL. It does **not** grant consent — that stays a
deliberate act — and it creates no client secret. Re-running updates the existing
registration rather than duplicating it.

Use `-WhatIf` to see what it would do without touching anything.

Two guards worth knowing about. It refuses a tenant whose name looks like a demo or
sandbox unless you pass `-Force`, because a registration cannot be moved between tenants
later and correcting it means a new client ID and re-consent from everyone. And it reads
the scope list from the shared file rather than carrying its own copy, so it cannot ask
for something the app does not.

### By hand, in the portal

Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) as at least an
**Application Developer**.

1. Browse to **Entra ID** → **App registrations**, and select **New registration**.
2. Give it a **Name**. Your users see this on the consent screen and in Enterprise apps,
   so choose plainly.
3. Under **Supported account types**, choose **Single tenant only** if you are only
   reporting on your own tenant, or **Multiple Entra ID tenants** if you are a consultant
   reporting on customers'.
4. Select **Register**. The **Overview** page appears — record the **Application (client)
   ID** from it.
5. Under **Manage**, select **Authentication**. On the **Redirect URI configuration** tab,
   select **Add Redirect URI**, choose the **Single-page application** tile, and enter:

   ```
   https://cloud-harbor-consulting-llc.github.io/M365-Security-Investment-Report/redirect.html
   ```

   Then select **Configure**. It must match exactly, including the trailing
   `redirect.html`. Do **not** use the **Web** platform — that expects a client secret,
   which a single-page application cannot hold.

   If you will also run the app locally, add this second URI now:

   ```
   http://localhost:5173/M365-Security-Investment-Report/redirect.html
   ```

   Each origin needs its own entry, and testing against a dev server without one fails
   with `AADSTS50011`.
6. Under **Manage**, select **API permissions** → **Add a permission** → **Microsoft
   Graph** → **Delegated permissions**, and add all five from the table above.
7. Select **Grant admin consent for &lt;tenant&gt;**, then **Yes**. Select **Refresh** and
   confirm each permission reads **Granted for &lt;tenant&gt;** under **Status**.

> Steps 1–6 need only **Application Developer**. Step 7 needs one of the consent roles
> above, so in many organisations it is a different person — the registration can be
> handed over ready to consent.

Then in the app: **Connect to a tenant** → **Use your own app registration** → paste the
client ID. Optionally set the tenant too, if you want sign-in pinned to one directory
rather than letting the account choose.

### You do not sign in "as" the app registration

A registration is a **client**, not an account. There is nothing in the portal to sign in
with, and no credential attached to it — a single-page application cannot hold one.

What actually happens: you paste the client ID into the report, click connect, and sign in
**as yourself**, with your own account. The client ID only tells Entra which application
is asking. The report then sees exactly what your account can see, and nothing more —
which is what "delegated permissions" means, and why this tool can never run unattended or
act when nobody is signed in.

So the portal is where the registration is *created*. The app is where it is *used*.

To check a registration before using it, open the admin-consent URL directly — the same
one the script prints:

```
https://login.microsoftonline.com/<your-tenant>/adminconsent?client_id=<your-client-id>
```

And in **API permissions**, all five permissions should read **Granted for &lt;tenant&gt;**
under **Status**. If they do not, sign-in fails with `AADSTS65001`.

> **Why `redirect.html` and not the app itself.** That page runs the MSAL redirect bridge.
> Pointing at the app would boot the whole single-page application a second time inside
> the popup; pointing at a blank page never completes the handshake at all, because MSAL
> returns the popup's result over `BroadcastChannel` rather than by polling the popup's
> URL. Both were learned the hard way.

---

## Option 3 — No app registration at all

Nothing to register, nothing to consent, no third-party app in your directory.

Run the read-only PowerShell collector yourself — code you can read before you run it —
and drop the snapshot into the app:

```powershell
Connect-CHSITenant -TenantId contoso.onmicrosoft.com
Get-CHSISnapshot -Path snapshot.json
Disconnect-CHSITenant
```

Then choose **Load a snapshot or session** and drop the file in. Same dashboard, same
figures, same exports. The file never leaves your browser.

This is the right path for customers who will consent to nothing, and for anyone who wants
to inspect exactly what was read before any of it is analysed.

---

## Self-hosting a fork

A fork needs its own registration, because the redirect URI must match the site serving
the app.

1. Create the registration as in Option 2, with **your** origin:
   `https://<your-site>/<base-path>/redirect.html`
2. Build with your client ID:

   ```bash
   VITE_MSAL_CLIENT_ID=<your-client-id> npm run build
   ```

Each origin you serve from needs registering once — the production URL and
`http://localhost:5173/M365-Security-Investment-Report/redirect.html` for local
development. The app derives its redirect URI from the page it is running on rather than
hardcoding one, so the same build works on all of them.

---

## Troubleshooting

The app translates these into plain language on screen; this is the same list with the fix.

| What you see | What it means | Fix |
|---|---|---|
| `AADSTS650053` / `invalid_scope` | The registration does not expose one of the permissions | Add all five delegated Graph permissions, then grant admin consent |
| `AADSTS65001` / `consent_required` | Nobody has consented yet | Have an admin (see [Who can consent](#who-can-consent)) sign in once and approve |
| `AADSTS90094` / *Need admin approval* | The tenant requires admin approval for these permissions | Same as above |
| `AADSTS50011` / `redirect_uri` mismatch | The redirect URI is not registered, or not registered as SPA | Add the exact URI the error names, platform **Single-page application** |
| `AADSTS700016` / `unauthorized_client` | That client ID is not in this tenant | Check the Application (client) ID, and that the registration's audience allows this directory |
| `block_nested_popups` | A previous sign-in left a stale authorization response in the page | Reload the page and sign in again |
| Pop-up closed or blocked | Exactly that | Allow pop-ups for the site |

**A previous session's sign-in keeps being reused, or sign-in fails on the second
attempt.** Tokens are held in `sessionStorage` and die with the tab, so the usual fix is a
new tab. If a stale authorization response is stuck in the URL, reload the page — the app
clears it on the next initialise.

**Can I reuse the Microsoft Graph PowerShell client ID?** No. `14d82eec-204b-4c2f-b7e8-296a70dab67e`
("Microsoft Graph Command Line Tools") has its redirect URIs registered for native and
broker flows, not the SPA platform. Any browser app needs a registration behind it.

---

## Removing access

Requires **Cloud Application Administrator**, **Application Administrator**, or ownership
of the service principal.

**To revoke consent but keep the app:** **Entra ID** → **Enterprise apps** → **All
applications** → find the app → **Permissions** under **Security** → review and remove the
granted permissions.

**To remove it entirely:** same path to the app, then **Properties** under **Manage** →
**Delete** → **Yes**. A deleted enterprise application sits in the recycle bin for 30 days
and can be restored during that window; after that it is hard-deleted.

**To suspend it without deleting:** deactivating the application blocks token issuance and
sign-in while preserving its configuration — the better choice during an investigation.

Any of these revokes the tokens issued to it. Because the tool holds nothing server-side —
there is no server — there is nothing else to clean up. Anything already exported is a
file on your own disk, and yours to delete.

---

## Related

- [`README.md`](../README.md) — what the tool does and the two ways in
- [`DELIVERY-PLAN.md`](DELIVERY-PLAN.md) §5.1 — why both options exist, and the consent design
- [`New-AppRegistration.ps1`](../scripts/New-AppRegistration.ps1) — the script, worth reading before running
