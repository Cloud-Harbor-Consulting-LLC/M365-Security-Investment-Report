# Third-party notices

This project is MIT licensed, see [LICENSE](LICENSE). It also redistributes the work below,
and this page is the attribution that goes with it.

Sorted by what actually reaches a user, because that is what decides whether a notice is
owed.

---

## Bundled into the browser app

These are compiled into the hosted app and into every one-file HTML report. A customer who
opens an exported report is running this code.

### Preact

Copyright (c) 2015-present Jason Miller. MIT Licence.
<https://github.com/preactjs/preact>

### Microsoft Authentication Library for JavaScript (@azure/msal-browser)

Copyright (c) Microsoft Corporation. All rights reserved. MIT Licence.
<https://github.com/AzureAD/microsoft-authentication-library-for-js>

Both licences require the copyright notice and permission notice to travel with the
software, which is what this page does. The full MIT text is the same as
[LICENSE](LICENSE).

---

## Bundled into every report

### Lato

Copyright (c) 2010-2014 by tyPoland Lukasz Dziedzic (team@latofonts.com) with Reserved Font
Name "Lato". Licensed under the SIL Open Font License, Version 1.1.

Full licence text:
[`src/CloudHarbor.M365SecurityInvestment/Assets/Fonts/OFL.txt`](src/CloudHarbor.M365SecurityInvestment/Assets/Fonts/OFL.txt)

The font is embedded as a data URI in the one-file report so the report reaches no font
host. The OFL permits embedding and redistribution. It also reserves the name "Lato", which
means a modified version of the font may not be distributed under that name. This project
ships the font unmodified.

---

## Reference data derived from Microsoft's published tables

[`sku-catalog.json`](src/CloudHarbor.M365SecurityInvestment/Data/sku-catalog.json) maps
Microsoft 365 SKU part numbers to product names. 568 of its 619 entries derive from
Microsoft's published table of product names and service plan identifiers. The remaining 51
are ours and win on conflict.

That table is published in 2 places:

- On Microsoft Learn, at
  [licensing-service-plan-reference](https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference).
  The page lives in [MicrosoftDocs/entra-docs](https://github.com/MicrosoftDocs/entra-docs),
  whose `LICENSE` and `LICENSE-CODE` are both the MIT Licence, Copyright (c) Microsoft
  Corporation.
- As a CSV on `download.microsoft.com`, which states no licence terms of its own.

**We treat the MIT-licensed Learn content as the source.** The data is identical either
way, and only one of the 2 routes carries terms that permit redistribution in writing.

The content is also factual: product names, part numbers and GUIDs. It is reproduced here
to identify Microsoft products by the names Microsoft gives them, which is the only way a
licensing report can be read by the person holding the invoice.

This is a documented reasoning rather than legal advice. If your own counsel reaches a
different view, the catalogue is a single JSON file and can be replaced.

---

## Declared prerequisites, not redistributed

No code from these ships in this repository. They are installed by the user from their own
source, and their terms are between the user and the publisher.

### Microsoft.Graph.Authentication

Required by the PowerShell collector, version 2.15.0 or later, installed from the
PowerShell Gallery. Published by Microsoft under the
[Microsoft Services Agreement](https://aka.ms/devservicesagreement).
<https://github.com/microsoftgraph/msgraph-sdk-powershell>

---

## Build and test only

None of these reach a user. They are listed for completeness, and because a reader checking
the supply chain of a security tool should not have to go and look.

`vite`, `vitest`, `typescript`, `jsdom`, `preact-render-to-string`, `@preact/preset-vite`,
`@types/node`.

The runtime dependency list is deliberately 2 packages. Every addition is a supply-chain
risk in a tool pointed at customer tenants, which is why
[CONTRIBUTING.md](CONTRIBUTING.md) says a new one will be questioned.

---

## Trademarks

Microsoft, Microsoft 365, Microsoft Entra, Microsoft Defender, Microsoft Purview, Microsoft
Graph, Azure, Exchange Online, SharePoint, Teams, Power BI, Power Apps, Power Automate,
Visio, Dynamics 365 and Windows are trademarks of the Microsoft group of companies. Lato is
a trademark of tyPoland Lukasz Dziedzic.

They appear here to identify the products this tool reports on. This project is not
affiliated with, endorsed by, or sponsored by Microsoft.

No logo, wordmark or favicon belonging to any company ships in this repository, including
the one belonging to the firm that built it. A trademark travelling with every fork is
wrong for the forker and for the owner of the mark.
[`tests/EndToEnd.Offline.Tests.ps1`](tests/EndToEnd.Offline.Tests.ps1) fails the build if
one appears.
