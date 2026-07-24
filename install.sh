set -euo pipefail

VERSION="1.0.0"
REPO_URL="${ARROWCODE_REPO:-https://github.com/Chintanpatel24/arrowcode.git}"
INSTALL_DIR="${ARROWCODE_DIR:-$HOME/.local/share/arrowcode}"
BIN_DIR="${ARROWCODE_BIN:-$HOME/.local/bin}"
DO_LINK=1
DO_SETUP=0
BRANCH="${ARROWCODE_BRANCH:-main}"

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
CYN=$'\033[0;36m'
DIM=$'\033[2m'
RST=$'\033[0m'
BLD=$'\033[1m'

banner() {
  cat <<'EOF'

      >>                                                                      >=>           
     >>=>                                                                     >=>           
    >> >=>     >> >==> >> >==>    >=>     >=>      >=>    >==>    >=>         >=>   >==>    
   >=>  >=>     >=>     >=>     >=>  >=>   >=>  >  >=>  >=>     >=>  >=>   >=>>=> >>   >=>  
  >=====>>=>    >=>     >=>    >=>    >=>  >=> >>  >=> >=>     >=>    >=> >>  >=> >>===>>=> 
 >=>      >=>   >=>     >=>     >=>  >=>   >=>>  >=>=>  >=>     >=>  >=>  >>  >=> >>        
>=>        >=> >==>    >==>       >=>     >==>    >==>    >==>    >=>      >=>>=>  >====>   
                                                                                            
                                                                                                                                                                                                                                                                                                    
         multi-agent swarm coding harness  ·  plan → confirm → ship

EOF
}

log()  { printf '%s==>%s %s\n' "$CYN" "$RST" "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$GRN" "$RST" "$*"; }
err()  { printf '%s[err]%s %s\n' "$RED" "$RST" "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<EOF
ArrowCode installer v${VERSION}

Usage: install.sh [options]

Options:
  --dir <path>     Install directory (default: ${INSTALL_DIR})
  --bin <path>     Bin directory for symlink (default: ${BIN_DIR})
  --repo <url>     Git clone URL
  --branch <name>  Git branch (default: main)
  --no-link        Do not create ~/.local/bin/arrowcode symlink
  --setup          Run interactive API setup after install
  --help           Show this help

Environment:
  ARROWCODE_DIR, ARROWCODE_BIN, ARROWCODE_REPO, ARROWCODE_BRANCH
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --bin) BIN_DIR="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --no-link) DO_LINK=0; shift ;;
    --setup) DO_SETUP=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

banner
log "ArrowCode installer v${VERSION}"

# --- Bun ---
if ! command -v bun >/dev/null 2>&1; then
  log "Bun not found — installing from https://bun.sh"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "Bun install failed. Install manually: https://bun.sh"
fi
ok "Bun $(bun --version)"

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# Prefer in-place install when running from a full checkout
if [[ -n "$SCRIPT_DIR" && -z "${ARROWCODE_DIR:-}" && -f "$SCRIPT_DIR/package.json" && -f "$SCRIPT_DIR/src/index.ts" ]]; then
  INSTALL_DIR="$SCRIPT_DIR"
  log "Detected local repo — installing in-place: $INSTALL_DIR"
fi

# --- Clone or update ---
if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Updating existing install at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH" 2>/dev/null || true
  git -C "$INSTALL_DIR" checkout "$BRANCH" 2>/dev/null || true
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" 2>/dev/null || \
    log "git pull skipped (local changes or offline)"
elif [[ -f "$INSTALL_DIR/package.json" && -f "$INSTALL_DIR/src/index.ts" ]]; then
  log "Using existing directory $INSTALL_DIR"
else
  log "Cloning $REPO_URL → $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if command -v git >/dev/null 2>&1 && git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null; then
    ok "Cloned repository"
  elif [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/package.json" ]]; then
    log "Clone unavailable — copying local repo from $SCRIPT_DIR"
    mkdir -p "$INSTALL_DIR"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude node_modules --exclude .git "$SCRIPT_DIR/" "$INSTALL_DIR/"
    else
      cp -R "$SCRIPT_DIR"/. "$INSTALL_DIR"/
      rm -rf "$INSTALL_DIR/node_modules" 2>/dev/null || true
    fi
  else
    die "git clone failed and no local package.json found. Clone the repo and run ./install.sh"
  fi
fi

cd "$INSTALL_DIR"
log "Installing dependencies (bun install)"
bun install
ok "Dependencies installed"

chmod +x "$INSTALL_DIR/bin/arrowcode" 2>/dev/null || true
chmod +x "$INSTALL_DIR/install.sh" 2>/dev/null || true

# Materialize ~/.arrowcode from packaged defaults/ (only creates missing files)
log "Bootstrapping user home from defaults/ → ~/.arrowcode"
bun run src/index.ts --init
ok "User data ready at ~/.arrowcode (created only if missing)"

# Symlink
if [[ "$DO_LINK" -eq 1 ]]; then
  mkdir -p "$BIN_DIR"
  ln -sfn "$INSTALL_DIR/bin/arrowcode" "$BIN_DIR/arrowcode"
  ln -sfn "$INSTALL_DIR/bin/arrowcode" "$BIN_DIR/ac"
  ok "Linked $BIN_DIR/arrowcode and $BIN_DIR/ac"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      log "Add to your shell profile:"
      echo "  export PATH=\"$BIN_DIR:\$PATH\""
      # try append for common shells if interactive-ish
      for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
        if [[ -f "$rc" ]] && ! grep -q 'ARROWCODE_BIN\|.local/bin' "$rc" 2>/dev/null; then
          echo "" >>"$rc"
          echo "# ArrowCode" >>"$rc"
          echo "export PATH=\"$BIN_DIR:\$PATH\"" >>"$rc"
          ok "Appended PATH to $rc"
          break
        fi
      done
      ;;
  esac
fi

if [[ "$DO_SETUP" -eq 1 ]]; then
  log "Running interactive setup"
  bun run src/index.ts --setup || true
fi

echo ""
printf '%s' "$BLD"
echo "────────────────────────────────────────────────────────────────"
echo "  ArrowCode installed"
echo "────────────────────────────────────────────────────────────────"
printf '%s' "$RST"
echo "  Location : $INSTALL_DIR"
echo "  Binary   : $BIN_DIR/arrowcode"
echo ""
echo "  Next:"
echo "    1. export PATH=\"$BIN_DIR:\$PATH\"   # if needed"
echo "    2. arrowcode --setup               # API key"
echo "    3. cd your-project && arrowcode"
echo ""
echo "  Docs: $INSTALL_DIR/README.md"
echo "        $INSTALL_DIR/docs/"
echo ""
