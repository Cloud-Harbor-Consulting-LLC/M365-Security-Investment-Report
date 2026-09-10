#!/usr/bin/env bash
#
# Refuses to let real tenant data into the repository.
#
# .gitignore already blocks *snapshot*.json, but .gitignore is advice: `git add -f`
# overrides it, and a rename escapes the pattern entirely. This is the backstop, and it
# runs on every pull request.
#
# What a snapshot carries is the point -- user principal names, display names, tenant ids,
# verified domains, sign-in dates and licence counts for real people at a real customer.
# Once that is in git history it is effectively permanent, deletion or not.
#
# Deliberately narrow. An earlier version also grepped for known tenant domains and lit up
# on every "contoso.onmicrosoft.com" placeholder in the docs; a guard that cries wolf is a
# guard someone switches off. These three checks look for the structure of collected data,
# which placeholders do not have.
set -uo pipefail

fail=0
note() { printf '  %s\n' "$1"; }
flag() { if [ "$fail" -eq 0 ]; then echo 'Tenant data guard: FAILED'; fi; fail=1; note "$1"; }

# Synthetic and reviewed: the fixtures are hand-built at contoso.com and are what
# contributors are told to use instead of real data.
is_allowed() {
  case "$1" in
    tests/fixtures/*) return 0 ;;
    scripts/check-no-tenant-data.sh) return 0 ;;
  esac
  return 1
}

tracked=$(git ls-files)
json_files=$(printf '%s\n' "$tracked" | grep -E '\.json$' || true)

# --- 1. Snapshot-shaped filenames -------------------------------------------------
while IFS= read -r f; do
  [ -z "$f" ] && continue
  is_allowed "$f" && continue
  flag "Snapshot-shaped file is tracked: $f"
done < <(printf '%s\n' "$tracked" | grep -Ei '(^|/)[^/]*snapshot[^/]*\.json$' || true)

# --- 2. The structure the collector stamps on every snapshot -----------------------
# Catches a real collection committed under an innocent name.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  is_allowed "$f" && continue
  if grep -q '"Collectors"' "$f" 2>/dev/null && grep -q '"ScopeAssessment"' "$f" 2>/dev/null; then
    flag "Tracked file has the shape of a collected snapshot: $f"
  fi
done < <(printf '%s\n' "$json_files")

# --- 3. Account-level personal data in tracked data files --------------------------
# userPrincipalName only ever appears in collected user rows or an export derived from
# them. Prose and placeholders do not carry the JSON key.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  is_allowed "$f" && continue
  if grep -q '"userPrincipalName"' "$f" 2>/dev/null; then
    flag "Tracked file contains user principal names: $f"
  fi
done < <(printf '%s\n' "$json_files")

# --- 4. The account-level export, in any form -------------------------------------
while IFS= read -r f; do
  [ -z "$f" ] && continue
  is_allowed "$f" && continue
  flag "Account-level waste export is tracked: $f"
done < <(printf '%s\n' "$tracked" | grep -E 'wasted-spend-accounts.*\.csv$' || true)

if [ "$fail" -ne 0 ]; then
  cat <<'MSG'

  Real tenant data must not enter this repository. Once committed it is effectively
  permanent, even after a later deletion.

  Use the synthetic fixtures in tests/fixtures/ instead, or build a minimal redacted
  example. See CONTRIBUTING.md.
MSG
  exit 1
fi

echo 'Tenant data guard: clean'
