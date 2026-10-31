# Release checklist: a real tenant, before every release

CI proves the engine against fixtures. It cannot prove that Microsoft Graph still answers the
way the fixtures assume. In October 2026 every test passed while the apps usage report failed
on a live tenant, because Graph's v1.0 endpoint refused the JSON format its own docs list.
Only a live run found it. This checklist is that run, kept short enough to do every time.

Run it on a test tenant you own, never a customer's. Do not commit or attach anything it
produces: see [CONTRIBUTING.md](../CONTRIBUTING.md#never-commit-or-attach-a-tenant-snapshot).

## Before you start

| You need | Why |
|---|---|
| A test tenant with Entra ID P1 or higher | Sign-in activity needs it |
| An administrator who can grant consent | Steps 1 and 2 |
| An account with Global Reader, Security Reader and Reports Reader | The documented way to run the tool |
| The release candidate on `localhost`, or the Pages preview | You are testing what will ship |
| An InPrivate or Incognito window | So no earlier sign-in or saved answer hides a prompt |

## Sign-in and consent

1. [ ] **Fresh consent.** Sign in as the administrator. Microsoft's own consent screen lists
   all 6 permissions, and collection runs to the end.
2. [ ] **A declined permission.** Remove one optional permission's admin consent in Entra
   (Enterprise applications, the app, Permissions). Sign in again and decline. The app offers
   "Try again" and "Continue with what is already approved", and continuing produces a report
   that names what was not collected.
3. [ ] **Once per browser.** Start over and sign in again in the same window. The declined
   permission is not asked for a second time.
4. [ ] **Put consent back** before going on, so the remaining steps see the whole tenant.

## Collection

5. [ ] **Progress.** The bar fills through all 5 reads, and each step ends as done.
6. [ ] **Evidence.** In Evidence, every collector reads Available. Open each one that is not
   and confirm the reason names a real cause, such as a missing role, rather than an HTTP error.
7. [ ] **Apps usage.** Wasted spend shows over-provisioning figures, not "not measured".
8. [ ] **Logo.** If the tenant has company branding, its square logo replaces the initial in
   the top bar. If it has none, the initial shows and nothing in Evidence complains.

## The report

9. [ ] **Board pack.** Print preview gives 6 pages, and nothing on screen only (the corner
   notice, the buttons) appears in it.
10. [ ] **Redact.** Turning it on blurs the tenant name, domain and logo.
11. [ ] **Save and reopen.** Save the session, start over, drop the file back in. Prices you
    set are still there.
12. [ ] **One-file report.** Export it, open the file on its own, and check the Board view
    matches.
13. [ ] **Since last review.** Drop an earlier snapshot of the same tenant. The comparison
    opens and its dates are right.

## Look and feel

14. [ ] **Both themes.** Switch the system between light and dark. Every view reads cleanly.
15. [ ] **768px.** Narrow the window to about tablet width. Nothing spills sideways off the
    page, and 4 tiles sit 2 by 2.
16. [ ] **Keyboard only.** From the landing page, Tab reaches every button, including
    "choose files", and every focused control shows a visible ring.

## PowerShell tier

17. [ ] **Collector.** Run `Get-CHSISnapshot -Path snapshot.json` against the same tenant.
    It finishes without errors, and the file opens in the app with the same figures as the
    browser run.

## When something fails

Fix it before tagging the release, and add a test that would have caught it. If the cause is
Graph behaving differently from its documentation, record that next to the code that works
around it, as the apps usage collector does.
