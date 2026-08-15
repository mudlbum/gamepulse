#!/usr/bin/env bash
#
# One-shot GitHub Pages setup for GamePulse.
#
#   ./setup-github.sh                  # creates a repo called "gamepulse"
#   ./setup-github.sh my-repo-name     # creates a repo with your name
#   ./setup-github.sh --domain gamepulse.dev my-repo-name
#   ./setup-github.sh --dry-run        # print the plan, change nothing
#
# Creates the repo, pushes, sets SITE_URL and BASE_PATH, turns on Pages with
# the Actions build source, and kicks off the first deploy. Safe to re-run:
# every step checks whether it has already been done.

set -euo pipefail

DRY=0
DOMAIN=""
REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --domain)  DOMAIN="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown flag: $1" >&2; exit 1 ;;
    *) REPO="$1"; shift ;;
  esac
done

REPO="${REPO:-gamepulse}"

c_ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
c_do()   { printf '  \033[36m→\033[0m %s\n' "$1"; }
c_warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
c_err()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; }
run()    { if [[ $DRY -eq 1 ]]; then printf '      \033[90m$ %s\033[0m\n' "$*"; else "$@"; fi; }

echo ""
echo "GamePulse → GitHub Pages"
echo "────────────────────────────────────────────"

# ---------- 1. prerequisites ----------
if ! command -v gh >/dev/null 2>&1; then
  c_err "GitHub CLI not found."
  echo ""
  echo "    macOS:    brew install gh"
  echo "    Windows:  winget install GitHub.cli"
  echo "    Linux:    https://github.com/cli/cli#installation"
  exit 1
fi
c_ok "GitHub CLI present"

if ! gh auth status >/dev/null 2>&1; then
  c_warn "Not signed in to GitHub. Starting login…"
  [[ $DRY -eq 0 ]] && gh auth login
fi

OWNER="$(gh api user --jq .login)"
c_ok "Signed in as ${OWNER}"

# ---------- 2. work out the URLs ----------
# A repo named exactly <user>.github.io is a *user site* and serves from the
# domain root. Anything else is a *project site* and serves from a subpath —
# which the build must know about, or every CSS and JS URL 404s.
if [[ -n "$DOMAIN" ]]; then
  SITE_URL="https://${DOMAIN}"
  BASE_PATH="/"
  KIND="custom domain"
elif [[ "$REPO" == "${OWNER}.github.io" ]]; then
  SITE_URL="https://${OWNER}.github.io"
  BASE_PATH="/"
  KIND="user site"
else
  SITE_URL="https://${OWNER}.github.io"
  BASE_PATH="/${REPO}/"
  KIND="project site"
fi
LIVE_URL="${SITE_URL}${BASE_PATH}"

echo ""
c_ok "Repository:  ${OWNER}/${REPO}  (${KIND})"
c_ok "SITE_URL:    ${SITE_URL}"
c_ok "BASE_PATH:   ${BASE_PATH}"
c_ok "Will serve:  ${LIVE_URL}"
echo ""

if [[ $DRY -eq 1 ]]; then
  echo "  Dry run — nothing was changed. Re-run without --dry-run to apply."
  echo ""
  exit 0
fi

# ---------- 3. git repo ----------
if [[ ! -d .git ]]; then
  c_do "Initialising git"
  run git init -q
  run git add -A
  run git commit -q -m "Initial commit"
fi
run git branch -M main
c_ok "Local repo on main"

# ---------- 4. remote repo ----------
if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
  c_ok "Repo ${OWNER}/${REPO} already exists"
else
  c_do "Creating ${OWNER}/${REPO}"
  gh repo create "${OWNER}/${REPO}" --public \
    --description "Live game data, honest coverage. Automated bilingual gaming publication." \
    >/dev/null
  c_ok "Repo created"
fi

if git remote get-url origin >/dev/null 2>&1; then
  run git remote set-url origin "https://github.com/${OWNER}/${REPO}.git"
else
  run git remote add origin "https://github.com/${OWNER}/${REPO}.git"
fi

c_do "Pushing to main"
git push -u origin main --force-with-lease 2>&1 | tail -2 || {
  c_err "Push failed. If the repo already had commits, run:"
  echo "      git pull --rebase origin main && git push -u origin main"
  exit 1
}
c_ok "Pushed"

# ---------- 5. Actions variables ----------
# The build reads these; without them it deploys against the placeholder domain.
c_do "Setting Actions variables"
gh variable set SITE_URL  --repo "${OWNER}/${REPO}" --body "${SITE_URL}"  >/dev/null
gh variable set BASE_PATH --repo "${OWNER}/${REPO}" --body "${BASE_PATH}" >/dev/null
c_ok "SITE_URL and BASE_PATH set"

# ---------- 6. Pages ----------
c_do "Enabling GitHub Pages (source: GitHub Actions)"
if gh api "repos/${OWNER}/${REPO}/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/${OWNER}/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
    && c_ok "Pages already on, build source set to Actions" \
    || c_warn "Pages exists; could not change build source — check Settings → Pages"
else
  gh api -X POST "repos/${OWNER}/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
    && c_ok "Pages enabled" \
    || c_warn "Could not enable Pages automatically. Do it manually: Settings → Pages → Source: GitHub Actions"
fi

if [[ -n "$DOMAIN" ]]; then
  gh api -X PUT "repos/${OWNER}/${REPO}/pages" -f cname="${DOMAIN}" >/dev/null 2>&1 \
    && c_ok "Custom domain set to ${DOMAIN}" \
    || c_warn "Set the custom domain manually in Settings → Pages"
  echo "${DOMAIN}" > public/CNAME
  git add public/CNAME && git commit -q -m "chore: add CNAME" && git push -q
fi

# ---------- 7. first deploy ----------
c_do "Triggering the first deploy"
sleep 3
gh workflow run deploy.yml --repo "${OWNER}/${REPO}" >/dev/null 2>&1 \
  && c_ok "Deploy started" \
  || c_warn "Could not dispatch. Run it from the Actions tab."

echo ""
echo "────────────────────────────────────────────"
echo "  Watch the build:  gh run watch --repo ${OWNER}/${REPO}"
echo "  Actions tab:      https://github.com/${OWNER}/${REPO}/actions"
echo ""
echo "  Site will be live at:"
echo "      ${LIVE_URL}"
echo "      ${LIVE_URL}ko/"
echo ""
echo "  First build takes 2-4 minutes. The data-refresh job starts on its own"
echo "  30-minute cycle; to populate real data immediately:"
echo "      gh workflow run refresh-data.yml --repo ${OWNER}/${REPO}"
echo ""
echo "  Still to do by hand:"
echo "    • Replace hello@example.com in src/views/pages/Contact.astro"
echo "    • Add your AdSense publisher ID to public/ads.txt and src/config.ts"
echo "      (only after you are approved — leave ads off until then)"
echo ""
