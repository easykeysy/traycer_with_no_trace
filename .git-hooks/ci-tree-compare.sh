#!/usr/bin/env bash
# ci-tree-compare.sh - LAW-11.R3 non-bypassable backstop.
#
# Local hooks (pre-commit Gate 6, pre-push/post-tag) can be skipped with
# --no-verify; this script re-checks the same facts server-side in CI, where
# no local flag can reach. It verifies, against the pinned upstream base:
#   1. manifest honesty  - .git-hooks/upstream-base.manifest is exactly the
#                          tree of the pinned upstream base (regenerated live)
#   2. base resolution   - the pinned base still resolves to the pinned commit
#   3. pin lineage       - the base commit is an ancestor of the checked commit
#   4. allowlist valid   - every wiring-allowlist entry is a real base path
#   5. tree compare      - every upstream path in the checked tree matches its
#                          base blob unless the path is allowlisted; deleting
#                          an upstream path likewise requires the allowlist
#
# Usage:
#   ci-tree-compare.sh                      # CI mode: fetches the pinned base
#                                           # from UPSTREAM_URL, checks HEAD
#   ci-tree-compare.sh <upstream-ref> \     # offline mode: use a local ref as
#     [current-ls-tree-file]                # the base and (optionally) a file
#                                           # of `git ls-tree -r` output as the
#                                           # current tree (for testing)
set -uo pipefail

fail() { echo "ci-tree-compare: FAIL: $*" >&2; exit 1; }

MANIFEST=".git-hooks/upstream-base.manifest"
ALLOWLIST=".git-hooks/wiring-allowlist"
UPSTREAM_URL="https://github.com/traycerai/traycer.git"

[ -f "$MANIFEST" ] || fail "missing $MANIFEST (run from the repo root)"
[ -f "$ALLOWLIST" ] || fail "missing $ALLOWLIST (run from the repo root)"

UPREF="${1:-}"
CURFILE="${2:-}"
LIVE=0
[ -z "$UPREF" ] && LIVE=1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- resolve the pinned base from the manifest header -----------------------
# This fork pins a raw upstream commit (the main tip it was cut from), which
# carries no tag; the header form is:
#   "# ... pinned base: upstream main = <40-hex sha> ..."
BASE_LINE="$(grep -m1 'pinned base: upstream' "$MANIFEST")" \
  || fail "manifest header lacks a 'pinned base: upstream <ref> = <sha>' line"
BASE_REF="$(printf '%s\n' "$BASE_LINE" | sed -n 's/.*pinned base: upstream \([^ =]*\) = .*/\1/p')"
BASE_SHA="$(printf '%s\n' "$BASE_LINE" | sed -n 's/.*= \([0-9a-f]\{40\}\).*/\1/p')"
[ -n "$BASE_REF" ] && [ -n "$BASE_SHA" ] \
  || fail "cannot parse base ref/commit from manifest header: $BASE_LINE"

# ---- resolve the upstream side ----------------------------------------------
if [ "$LIVE" = 1 ]; then
  if printf '%s' "$BASE_SHA" | grep -qE '^[0-9a-f]{40}$'; then
    # Fetching the pinned commit proves it still exists and is reachable
    # upstream; a commit pin cannot "drift" the way a moved tag can.
    git fetch --quiet --no-tags --filter=blob:none "$UPSTREAM_URL" "$BASE_SHA" \
      || fail "could not fetch pinned base commit '$BASE_SHA' from $UPSTREAM_URL"
  else
    git fetch --quiet --no-tags --filter=blob:none "$UPSTREAM_URL" \
      "refs/tags/$BASE_REF:refs/ci-upstream-base" \
      || fail "could not fetch pinned base tag '$BASE_REF' from $UPSTREAM_URL"
    UP_COMMIT="$(git rev-parse -q --verify 'refs/ci-upstream-base^{commit}')" \
      || fail "upstream tag '$BASE_REF' does not resolve to a commit"
    [ "$UP_COMMIT" = "$BASE_SHA" ] \
      || fail "base drift: manifest pins $BASE_SHA but upstream tag '$BASE_REF' now resolves to $UP_COMMIT"
  fi
  UPREF="$BASE_SHA"
fi
UP_COMMIT="$(git rev-parse -q --verify "$UPREF^{commit}")" \
  || fail "upstream ref '$UPREF' does not resolve to a commit"
[ "$UP_COMMIT" = "$BASE_SHA" ] \
  || fail "base drift: manifest pins $BASE_SHA but '$BASE_REF' resolves to $UP_COMMIT"
echo "ci-tree-compare: PASS base resolution ($BASE_REF = $BASE_SHA)"

# ---- check 1: manifest honesty ----------------------------------------------
regen() { git -c core.quotePath=false ls-tree -r "$1" | sed -E 's/^[0-7]+ blob ([0-9a-f]{40})\t/\1\t/'; }
regen "$UPREF" | LC_ALL=C sort > "$TMP/regen.manifest" \
  || fail "cannot list the tree of $UPREF"
grep -v '^#' "$MANIFEST" | grep -v '^[[:space:]]*$' | LC_ALL=C sort \
  > "$TMP/committed.manifest"
if ! cmp -s "$TMP/regen.manifest" "$TMP/committed.manifest"; then
  fail "manifest honesty: .git-hooks/upstream-base.manifest does not match the tree of pinned base $BASE_REF ($BASE_SHA). Regenerate the manifest at the base bump (LAW-11.R3)."
fi
echo "ci-tree-compare: PASS manifest honesty ($(grep -vc '^#' "$TMP/committed.manifest") paths match upstream base $BASE_REF)"

# ---- check 3: pin lineage (only when the current tree really is HEAD) --------
if [ -z "$CURFILE" ]; then
  git merge-base --is-ancestor "$UP_COMMIT" HEAD 2>/dev/null \
    || fail "pin lineage: base commit $BASE_SHA ($BASE_REF) is not an ancestor of HEAD"
  echo "ci-tree-compare: PASS pin lineage ($BASE_REF is an ancestor of HEAD)"
fi

# ---- check 4: allowlist validity ---------------------------------------------
while IFS= read -r p; do
  case "$p" in ''|\#*) continue ;; esac
  awk -F '\t' -v q="$p" '$1 ~ /^#/ {next} $2 == q {f=1} END {exit !f}' "$MANIFEST" \
    || fail "allowlist validity: '$p' is not a path in the base manifest (the allowlist may only shrink and may only contain real base paths)"
done < "$ALLOWLIST"
echo "ci-tree-compare: PASS allowlist validity ($(grep -vc '^#' "$ALLOWLIST") entries, all real base paths)"

# ---- check 5: tree compare ----------------------------------------------------
if [ -n "$CURFILE" ]; then
  cp "$CURFILE" "$TMP/current.manifest" || fail "cannot read current-tree file '$CURFILE'"
else
  regen HEAD > "$TMP/current.manifest" || fail "cannot list the tree of HEAD"
fi
awk -F '\t' '
  FNR==1 { fn++ }
  fn==1 && $0 !~ /^#/ && $0 != "" { base[$2]=$1; next }
  fn==2 && $0 !~ /^#/ && $0 != "" { allow[$0]=1; next }
  fn==3 { cur[$2]=$1; next }
  END {
    bad=0; shown=0
    for (p in base) {
      if (p in allow) continue
      if (!(p in cur)) { if (shown<20) print "  DELETED upstream path: " p; bad++; shown++; continue }
      if (cur[p] != base[p]) { if (shown<20) print "  MODIFIED upstream path: " p; bad++; shown++ }
    }
    if (bad>20) print "  ... and " (bad-20) " more"
    if (bad>0) { print "  " bad " upstream path(s) altered outside the wiring allowlist"; exit 1 }
    print "  all " length(base) " upstream paths unmodified or allowlisted"
    exit 0
  }
' "$TMP/committed.manifest" "$ALLOWLIST" "$TMP/current.manifest" \
  || fail "LAW-11 tree compare failed (list above). Fork work must go in standalone files; allowlist changes need maintainer sign-off."
echo "ci-tree-compare: PASS tree compare"

echo "ci-tree-compare: ALL CHECKS PASSED (LAW-11 backstop, base $BASE_REF)"
exit 0
