# Sample output

A generated report, so you can see what the tool produces without running it.

| File | What it is |
|---|---|
| `sample-report.html` | The self-contained HTML report. Open it in a browser. It reaches no external origin. |
| `sample-report.json` | The full model, including provenance for every figure |
| `sample-report-summary.csv` | One row: the tenant totals |
| `sample-report-inventory.csv` | One row per SKU |

Every figure comes from [`tests/fixtures/premium-snapshot.json`](../tests/fixtures/premium-snapshot.json),
a synthetic tenant. Contoso Ltd is not real, and no real tenant appears anywhere in this
repository.

The awkward cases are in there deliberately, because they are the ones worth seeing before
you trust a tool with a real tenant: a SKU with no price that is counted in seats and
excluded from every dollar total, 2 free SKUs reporting unlimited seats, and a licence
whose name suggests one product and whose contents are another.

## Regenerating these

They are generated, not written, and they go stale when prices or figures move. Pester
fails if they no longer describe the current build, so regenerate rather than hand-edit:

```powershell
Import-Module ./src/CloudHarbor.M365SecurityInvestment/CloudHarbor.M365SecurityInvestment.psd1 -Force

New-CHSIReport -FromSnapshot ./tests/fixtures/premium-snapshot.json `
               -OutputPath ./samples -BaseName sample-report -Format Html,Json,Csv
```
