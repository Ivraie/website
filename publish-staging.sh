#!/bin/bash
# Puts a version of the site at ivraie.ink/staging/, to test it on phones
# before it goes live: copies the site files of a commit or branch (default:
# the current one) into staging/ on master, without analytics and hidden from
# search engines, and commits on master. Then push master to publish:
#   ./publish-staging.sh [REF]
#   git push origin master
# The live site at the root does not change. ./publish-staging.sh --remove
# takes staging/ away again.
set -euo pipefail
cd "$(dirname "$0")"

# Where master is checked out: here, or in a temporary worktree.
if [ "$(git rev-parse --abbrev-ref HEAD)" = master ]; then
    TARGET=$PWD
    CLEANUP=""
else
    TARGET=$(mktemp -d)/master
    git worktree add -q "$TARGET" master
    CLEANUP="$TARGET"
fi
trap '[ -n "$CLEANUP" ] && git worktree remove --force "$CLEANUP"' EXIT

if [ "${1:-}" = --remove ]; then
    git -C "$TARGET" rm -rq staging
    git -C "$TARGET" commit -qm "Remove staging"
    echo "staging/ removed on master. Publish with: git push origin master"
    exit 0
fi

REF=${1:-HEAD}
SHA=$(git rev-parse --short "$REF")
NAME=$(git rev-parse --abbrev-ref "$REF" 2>/dev/null || echo "$REF")
[ "$NAME" = HEAD ] && NAME=$(git rev-parse --abbrev-ref HEAD)

STAGING="$TARGET/staging"
rm -rf "$STAGING"
mkdir -p "$STAGING"
git archive "$REF" | tar -x -C "$STAGING"
# Only the page and what it loads.
( cd "$STAGING" && rm -rf staging CNAME package.json package-lock.json bs-config.js \
    dev-server.js .gitignore publish-staging.sh og-video.mp4 )
# No analytics (staging visits would count as visitors), not indexed.
sed -i '/cloud\.umami\.is\/script\.js/d' "$STAGING/index.html"
sed -i 's#^\(\s*\)<meta name="viewport"#\1<meta name="robots" content="noindex, nofollow" />\r\n\1<meta name="viewport"#' "$STAGING/index.html"
grep -q 'name="robots"' "$STAGING/index.html" || { echo "could not add the robots tag"; exit 1; }

git -C "$TARGET" add -A staging
if git -C "$TARGET" diff --cached --quiet; then
    echo "staging/ already holds $NAME $SHA"
    exit 0
fi
git -C "$TARGET" commit -qm "Staging: $NAME $SHA"
echo "Committed $NAME $SHA in staging/ on master."
echo "Publish with: git push origin master"
echo "Then open https://ivraie.ink/staging/ (add ?worker&debug to test the worker)"
