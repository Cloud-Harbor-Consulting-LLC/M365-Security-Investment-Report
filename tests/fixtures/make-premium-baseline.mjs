/**
 * Builds premium-baseline-snapshot.json: the same synthetic Contoso tenant as
 * premium-snapshot.json, collected 92 days earlier, for testing snapshot delta.
 *
 * Generated rather than hand-written so that every difference between the two runs is a
 * deliberate, listed change. Anything not changed below is identical, which is what lets
 * the delta tests assert exact figures: a stray difference would show up as a movement
 * nobody intended.
 *
 *   node tests/fixtures/make-premium-baseline.mjs
 *
 * Re-run it whenever premium-snapshot.json changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const current = JSON.parse(readFileSync(join(here, 'premium-snapshot.json'), 'utf8'));
const s = structuredClone(current);

const DAY = 86_400_000;
const SHIFT = 92 * DAY; // 3 September back to 3 June
const back = (iso) => (iso ? new Date(Date.parse(iso) - SHIFT).toISOString().replace('.000Z', 'Z') : iso);

s.GeneratedAt = back(s.GeneratedAt);
for (const collector of Object.values(s.Collectors)) collector.CollectedAt = back(collector.CollectedAt);

// Sign-in and creation dates move back with the collection, so the same people are
// inactive, never signed in and so on in both runs. Inactivity is measured from the
// collection, so only a deliberate change below can move those categories.
for (const user of s.Collectors.users.Data) {
  user.LastSignIn = back(user.LastSignIn);
  user.LastNonInteractiveSignIn = back(user.LastNonInteractiveSignIn);
}

// CHANGE: one more disabled account still holding an E5 licence. It was cleaned up
// before September, so disabled-but-licensed falls from 3 accounts to 2.
const grace = s.Collectors.users.Data.find((u) => u.UserPrincipalName === 'grace@contoso.com');
s.Collectors.users.Data.push({
  ...structuredClone(grace),
  Id: 'u12',
  DisplayName: 'Dorothy Vaughan',
  UserPrincipalName: 'dorothy@contoso.com',
  Department: 'Finance',
});

// CHANGE: licences. Fewer E5 seats bought and assigned, fewer E3 seats assigned, and EMS
// E3 still held. It was dropped before September, so it shows as a removed licence.
const skus = s.Collectors.subscribedSkus.Data;
const sku = (part) => skus.find((k) => k.SkuPartNumber === part);
Object.assign(sku('SPE_E5'), { PrepaidEnabled: 100, ConsumedUnits: 80 });
Object.assign(sku('SPE_E3'), { ConsumedUnits: 270 });
const plan = (name) =>
  structuredClone(skus.flatMap((k) => k.ServicePlans).find((p) => p.ServicePlanName === name));
skus.push({
  ...structuredClone(sku('AAD_PREMIUM')),
  SkuId: 'efccb6f7-5641-4e0e-bd10-b4976e1bf68e',
  SkuPartNumber: 'EMS',
  ConsumedUnits: 40,
  PrepaidEnabled: 40,
  ServicePlans: [plan('AAD_PREMIUM'), plan('INTUNE_A')],
});

// CHANGE: Secure Score. Each control movement the delta has to recognise, once or twice.
const score = s.Collectors.secureScore.Data;
const set = (name, value) => {
  score.ControlScores.find((c) => c.ControlName === name).Score = value;
};
set('MFARegistrationV2', 12); //             12/30 -> 30/30  closed
set('MailboxAuditing', 0); //                 0/20 -> 20/20  closed
set('AdminMFAV2', 0); //                      0/10 -> 4.5/10 improved, not yet closed
set('DefenderForEndpointOnboarding', 25); // 25/50 -> 40/50  improved, not yet closed
set('AntiPhishPolicy', 40); //               40/40 -> 32/40  regressed
set('SpamPolicyBlockList', 20); //           20/20 -> 15/20  regressed
// DLPPolicy is not yet scored in June: it appears by September.
score.ControlScores = score.ControlScores.filter((c) => c.ControlName !== 'DLPPolicy');
// A control scored in June that Microsoft retired before September.
const mailbox = score.ControlProfiles.find((p) => p.ControlName === 'MailboxAuditing');
score.ControlProfiles.push({
  ...structuredClone(mailbox),
  ControlName: 'AuditLogSearch',
  Title: 'Turn on audit log search',
  MaxScore: 10,
  Rank: 40,
});
score.ControlScores.push({
  ControlName: 'AuditLogSearch',
  ControlCategory: 'Data',
  Score: 10,
  Description: 'Turn on audit log search',
  State: 'Default',
});

// The tenant totals are the sums of the scored controls, as Microsoft reports them.
const profileMax = new Map(score.ControlProfiles.map((p) => [p.ControlName, p.MaxScore]));
score.CurrentScore = score.ControlScores.reduce((sum, c) => sum + c.Score, 0);
score.MaxScore = score.ControlScores.reduce((sum, c) => sum + profileMax.get(c.ControlName), 0);
score.CreatedDateTime = back(score.CreatedDateTime);

// History up to the June collection, rising towards the June score.
const ratio = score.CurrentScore / current.Collectors.secureScore.Data.CurrentScore;
score.History = current.Collectors.secureScore.Data.History.map((h) => ({
  CreatedDateTime: back(h.CreatedDateTime),
  CurrentScore: Math.round(h.CurrentScore * ratio * 2) / 2,
  MaxScore: score.MaxScore,
})).filter((h) => Date.parse(h.CreatedDateTime) <= Date.parse(s.GeneratedAt));

writeFileSync(join(here, 'premium-baseline-snapshot.json'), JSON.stringify(s, null, 2) + '\n');
console.log(
  `premium-baseline-snapshot.json: collected ${s.GeneratedAt}, ` +
    `Secure Score ${score.CurrentScore}/${score.MaxScore}, ` +
    `${score.ControlScores.length} scored controls, ${skus.length} SKUs, ${s.Collectors.users.Data.length} users, ` +
    `${score.History.length} history points`,
);
