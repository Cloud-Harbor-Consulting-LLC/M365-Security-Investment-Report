# Secure Score control → service plan → SKU

Research backing the Spend column on the Security features page. Every dollar figure in
that column traces to a row here.

The mapping lives in `src/CloudHarbor.M365SecurityInvestment/Data/feature-map.json` under
`controlEntitlements`, and every rule here is marked with its confidence.

It was researched against a reference tenant scoring 210 controls, which is why the
examples below name real SKUs and real service plans. Encoding a rule and running it
against actual tenant data is what caught most of the errors recorded here, and it is the
bar for changing any of it.

**Layer: VISIBILITY** (see §6.1). A control is priced from the licence that makes it
assessable for the tenant being reported on.

**Pricing rule, in two steps.** They answer different questions and are decided
separately:

1. *Licensing question.* A control maps to the **minimum service plan** Microsoft
   requires. Supersets are listed alongside the minimum, so a tenant holding only the
   richer plan still matches -- Defender for Office P2 satisfies a P1 requirement, Entra
   P2 satisfies a P1 one.
2. *Money question.* Among the SKUs the tenant owns that carry one of those plans, the
   control is costed from the **dearest**, because that is the licence whose value is
   most at stake while the control stays switched off.

An earlier pass costed from the cheapest qualifying SKU, on the reasoning that the
minimum requirement should set the price. That understates precisely the tenants this
report exists for: an organisation holding a rich suite it is not using. The minimum plan
still decides *which* licences qualify; it no longer decides which one pays.

- **Verified.** Read from a named Microsoft Learn page, cited inline.
- **Reasoned.** Follows from a cited statement, but Microsoft does not state it per control.
- **Open.** Not settled, and flagged rather than given a dollar figure. Listed in §6.

---

## 1. The finding that matters most

**A Secure Score control has up to three different licences attached to it, and they are
not the same licence.**

Take *"Block abuse of exploited vulnerable signed drivers"*:

| Layer | What it means | Licence |
|---|---|---|
| **Capability** | The ASR engine that enforces the rule | Microsoft Defender Antivirus, **free, in Windows** |
| **Visibility** | Why the control appears in *your* Secure Score at all | **Defender for Endpoint Plan 2** |
| **Deployment** | The supported way to switch it on at scale | **Intune Plan 1** |

All three are true simultaneously. Which one is "the minimum service required" is a
product decision rather than a research finding, and it changes the numbers materially. §6.1.

Worth noting: your two examples land on **different layers**. Mailbox auditing → Exchange
Online Plan 1 is the *capability* layer. ASR → Intune Plan 1 is the *deployment* layer. A
single consistent rule cannot honour both, so we have to choose deliberately.

---

## 2. The 118 "MDATP" controls: the largest and most mis-labelled group

Graph labels these `MDATP`, which reads as "Defender for Endpoint capabilities". They are
not. Classified by title:

| Group | Count | What the capability actually is |
|---|---|---|
| Windows OS hardening | 44 | LDAP signing, NTLM, SMB relay, Remote Registry. **Windows, no M365 SKU** |
| ASR rules | 20 | Defender Antivirus feature. **Free in Windows** |
| Enable feature | 19 | LSA protection, Firewall, controlled folder access. **Windows** |
| Device configuration | 17 | SmartScreen, RDP TLS. **Windows** |
| Defender AV settings | 9 | Real-time protection, PUA, cloud protection. **Free in Windows** |
| Update hygiene | 4 | Windows Update settings. **Windows** |
| Agent health | 4 | Sensor/communication health. **Requires MDE onboarding** |
| Onboarding | 1 | Onboard devices. **Requires MDE** |

**The capability in 113 of 118 cases costs nothing beyond the Windows licence.** What a
Microsoft 365 SKU buys is the *assessment*: being told which devices fail.

### Decisive: Business Premium cannot fund these

> Microsoft Defender Vulnerability Management **isn't currently available to Microsoft
> Defender for Business customers.**
> Source: [Compare DVM plans](https://learn.microsoft.com/en-us/defender-vulnerability-management/defender-vulnerability-management-capabilities)

That page also confirms that **Configuration assessment**, which links to *Microsoft Secure
Score for Devices*, the exact source of the `scid_*` controls, is **core Defender for
Endpoint Plan 2**.

So `Microsoft_365_Business_Premium_(no Teams)` (carrying `MDE_SMB`, Defender for Business)
is **not** the enabling licence for these. `MDATP_XPLAT` (carrying `WINDEFATP`) is.
**Verified.**

This is the trap that makes a cheapest-qualifying-SKU rule wrong. Business Premium
undercuts a standalone Defender licence and would have funded these rows, so `MDE_SMB` is
excluded from the `MDATP` mapping outright. See §6.2.

**Service plans:** `WINDEFATP`, and deliberately **not** `MDE_SMB`.

---

## 3. Microsoft Defender for Office (38 controls)

The EOP / Defender boundary follows the section split in
[Recommended settings for EOP and Defender for Office 365](https://learn.microsoft.com/en-us/defender-office-365/recommended-settings-for-eop-and-office365).
**Verified.**

**Exchange Online Protection, any Exchange Online plan** (20 controls)
Anti-malware (common attachments filter, ZAP malware), anti-spam (spam/bulk actions,
thresholds, connection filter, quarantine retention, recipient limits, outbound
notifications), and baseline anti-phishing (spoof intelligence).
`EXCHANGE_S_STANDARD`, `EXCHANGE_S_ENTERPRISE`, `EXCHANGE_S_DESKLESS`

**Defender for Office 365 Plan 1** (17 controls)
Impersonation protection (targeted users/domains and their actions), mailbox
intelligence, phishing threshold, Safe Links, Safe Attachments, similar-domain /
similar-user / unusual-character safety tips.
`ATP_ENTERPRISE`, or `THREAT_INTELLIGENCE` (P2 is a superset)

**Defender for Office 365 Plan 2** (1 control)
`mdo_safedocuments`: Safe Documents. `THREAT_INTELLIGENCE`

> ⚠️ **`EXCHANGE_S_FOUNDATION` must never be treated as Exchange Online.** It is a stub
> plan carried by nearly every SKU including Visio, Project and Dynamics. Treating it as a
> mailbox plan made unrelated products appear to fund email security.

---

## 4. Microsoft Entra ID (20 controls)

Three tiers, and one feature that spans two of them. **Verified** against the licensing
tables in
[ID Protection](https://learn.microsoft.com/en-us/entra/id-protection/overview-identity-protection),
[Password protection](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-password-ban-bad) and
[SSPR](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sspr-licensing).

**Free, no paid licence** (10 controls)
`OneAdmin`, `RoleOverlap`, `PWAgePolicyNew`, `MFARegistrationV2` (via security defaults),
`IntegratedApps`, `aad_third_party_apps`, `aad_admin_consent_workflow`,
`aad_linkedin_connection_disables`, `aad_limited_administrative_roles`,
`aad_admin_accounts_separate_unassigned_cloud_only`

**Entra ID P1** (7 controls): `AAD_PREMIUM`
Conditional Access dependants: `BlockLegacyAuthentication`,
`aad_sign_in_freq_session_timeout`, `aad_phishing_MFA_strength`, `AdminMFAV2`.
Plus `aad_custom_banned_passwords`, `SelfServicePasswordReset`, and
`aad_password_protection`.

> **Correction from an earlier pass.** `aad_password_protection` was mapped as Free. Its
> title is *"password protection for on-prem Active Directory"*, and the licensing table
> is explicit: cloud-only users get the **global** banned list on Free, but
> **users synchronised from on-premises AD DS require P1**. Only the cloud global list is
> free. This error was caught by displaying the no-licence list, which is a good argument for
> showing that list in the UI permanently.

**Entra ID P2** (3 controls): `AAD_PREMIUM_P2`
`SigninRiskPolicy`, `UserRiskPolicy`, `AATP_AccountWithLeakedCredentials`.
The ID Protection table states risk policies are **P2: "No / No / Yes"** across
Free / P1 / P2. Leaked-credential detection is a risk detection, full access at P2.

---

## 5. Remaining families

| Service | Controls | Minimum service | Plans | Confidence |
|---|---|---|---|---|
| Exchange Online | 8 | Any Exchange Online plan | `EXCHANGE_S_STANDARD`, `EXCHANGE_S_ENTERPRISE` | Verified |
| Exchange Online | 1 | **Customer Lockbox, E5 only** | `LOCKBOX_ENTERPRISE` | Verified |
| Purview / MIP | 3 | Sensitivity labels, audit search | `RMS_S_ENTERPRISE`, `MIP_S_Exchange` | Reasoned |
| Purview / MIP | 1 | Auto-labelling, **E5** | `MIP_S_CLP2` | Reasoned |
| Purview / DLP | 2 | DLP for Exchange/SPO/OneDrive and Teams | `BPOS_S_DlpAddOn`, `COMMUNICATIONS_DLP` | Reasoned |
| Microsoft Teams | 6 | Any Teams plan | `TEAMS1`, `MCOSTANDARD` | Reasoned |
| SharePoint Online | 4 | Any SharePoint plan | `SHAREPOINTSTANDARD`, `SHAREPOINTENTERPRISE` | Reasoned |
| SharePoint Online | 1 | Block sync from unmanaged devices, needs **Conditional Access** | `AAD_PREMIUM` | Reasoned |
| Defender for Cloud Apps | 2 | Full MDA, not discovery-only | `ADALLOM_S_STANDALONE` | Reasoned |
| App Governance | 2 | MDA add-on | `ADALLOM_S_STANDALONE` | Open |
| Defender for Identity | 1 | Defender for Identity | `ATA` | Verified |
| Admin center | 1 | None | n/a | Reasoned |
| Forms | 1 | Any Forms plan | `FORMS_PLAN_E1`, `FORMS_PLAN_E5` | Reasoned |
| Sway | 1 | None | n/a | Reasoned |

**Customer Lockbox** is worth calling out: the service description table lists it under
**Office 365 E5 / Microsoft 365 E5 only**. Where no owned SKU carries `LOCKBOX_ENTERPRISE`,
this is correctly a *"not licensed"* row: a gap that costs new money to close, rather than
idle spend.

**Defender for Identity.** `IDENTITY_THREAT_PROTECTION` carries the `ATA` plan, so
`AATP_DefenderForIdentityIsNotInstalled` resolves to an owned licence wherever that SKU is
held. This research originally recorded the opposite, from a regex over service plan names
that missed the match. Encoding the mapping and running it against real tenant data is what
caught it, which is why that is the bar for changing anything here.

---

## 6. The judgement calls, and where they could go the other way

Each of these decides which licence pays for a control, so each one moves money in a
report. They are written down so a fork can disagree with them deliberately rather than
discover them.

### 6.1 Which layer counts as the minimum service required: Visibility

| Option | 118 device controls funded by | Consequence |
|---|---|---|
| **Capability** | Nothing (Windows) | 113 of 118 become "no licence needed", so the largest group drops out of the dollar figures entirely. Most literally true, least useful. |
| **Visibility** | Defender for Endpoint P2 (`MDATP_XPLAT`) | These rows carry the Defender licence actually bought. Answers "what is my Defender spend earning?" |
| **Deployment** | Intune Plan 1 | The supported deployment path. But Group Policy and PowerShell deploy ASR rules for free, so this is the cost of the convenient route, not a hard requirement. |

**Visibility is what this uses.** It is the only layer where the licence is genuinely
tenant-specific, it is money already committed, and it makes the page answer the question
the tool exists to ask. Capability understates to the point of emptiness, and Deployment
attributes cost to a licence an organisation may legitimately not need.

Deployment stays one data edit away for anyone who disagrees: swap the `MDATP` service
default from `WINDEFATP` to the Intune plans. No code changes.

### 6.2 Cheapest-per-seat is not always right

Selecting the cheapest qualifying SKU by per-seat price would pick Business Premium over
`MDATP_XPLAT` for the 118 device controls, which §2 shows is wrong: Defender for Business
does not provide the assessment. `MDE_SMB` is therefore absent from the `MDATP` mapping,
and the encoded result confirms it. `MDATP_XPLAT` carries all 118, and Business Premium
drops to the 34 controls it genuinely enables.

Watch for the same shape elsewhere: a cheap SKU carrying a *similarly named* plan that
does not actually deliver the capability.

### 6.3 A "not licensed" row can only cost the gap if the SKU has a price

`LOCKBOX_ENTERPRISE` has no entry in `pricelist.json`, so a "not licensed" row naming it
shows the required plan and no cost. That is correct behaviour rather than a zero, but the
row cannot say what closing the gap would cost. Supplying a price, in the table or inline
in the app, makes it say so.

### 6.5 SKUs that license agents, not people

Microsoft Agent 365 Frontier (`MICROSOFT_AGENT_365_TIER_3`) carries an E5-grade service
plan list (`AAD_PREMIUM_P2`, `MIP_S_CLP2`, `ADALLOM_S_STANDALONE`, `EXCHANGE_S_STANDARD`)
so matching on plan names alone made it an entitler for **60 controls** on the reference
tenant. What it actually entitles is Agent 365 functionality, for agent identities.

Graph offers no way to tell the two apart: `appliesTo` reads `User` on the SKU and on
every one of its plans, including the ones whose own names end in `FOR_AGENTS`. The plan
names are the only signal, so `nonUserLicensing` detects the SKU by marker plans
(`AGENT_365`, `AGENT_365_TOOLS`, `*_FOR_AGENTS`, `*_FOR_ASSISTIVE_AGENTS`) rather than by
part number, which covers future agent SKUs without an edit.

Related: `mip_autosensitivitylabelspolicies` was mapped to `MIP_S_CLP2` alone, which on the
reference tenant existed only inside the agent SKU. Automatic classification also ships in
Azure Information Protection P2 (`RMS_S_PREMIUM`), which Microsoft 365 Business Premium
carries, and that is the licence genuinely entitling it.

### 6.6 App Governance, still open

Listed as `AppG`, 2 controls, 14 points. Whether it requires the Defender for Cloud Apps
add-on or is included with `ADALLOM_S_STANDALONE` is **unresolved**: the service description
does not state it cleanly. Left mapped to MDA, and marked Open rather than given a confident
dollar figure. A cited answer here would be a welcome contribution.

---

## 7. Coverage on the reference tenant

| | |
|---|---|
| Scored controls | 210 |
| Explicitly mapped | 92 |
| Covered by a service-level rule | 118 |
| Unmapped | **0** |
| Need no paid licence | 13 (6 not deployed, free to close) |
| Scored but not licensed | 2 (Customer Lockbox, Defender for Identity) |

---

## Sources

- [Compare Defender Vulnerability Management plans](https://learn.microsoft.com/en-us/defender-vulnerability-management/defender-vulnerability-management-capabilities)
- [ASR rules overview](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-overview)
- [Recommended settings for EOP and Defender for Office 365](https://learn.microsoft.com/en-us/defender-office-365/recommended-settings-for-eop-and-office365)
- [Microsoft Entra ID Protection](https://learn.microsoft.com/en-us/entra/id-protection/overview-identity-protection)
- [Entra password protection](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-password-ban-bad)
- [SSPR licensing](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sspr-licensing)
- [Microsoft Purview service description](https://learn.microsoft.com/en-us/office365/servicedescriptions/microsoft-365-service-descriptions/microsoft-365-tenantlevel-services-licensing-guidance/microsoft-purview-service-description)
