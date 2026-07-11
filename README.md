<div >
<img align="left" src="assets/arrowcode.png" alt="LOGO" width="150" height="150">
<pre>
     █████╗ ██████╗ ██████╗  ██████╗ ██╗    ██╗ ██████╗ ██████╗ ██████╗ ███████╗
    ██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝
    ███████║██████╔╝██████╔╝██║   ██║██║ █╗ ██║██║     ██║   ██║██║  ██║█████╗
    ██╔══██║██╔══██╗██╔══██╗██║   ██║██║███╗██║██║     ██║   ██║██║  ██║██╔══╝
    ██║  ██║██║  ██║██║  ██║╚██████╔╝╚███╔███╔╝╚██████╗╚██████╔╝██████╔╝███████╗
    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
</pre>

</div>

**Multi-agent terminal coding harness** — plan → questions → confirm → execute → accept.

Four agents (**ORCH · FE · BE · QA**) work in parallel, can spawn swarm workers, use **25+ tools**, and support **per-agent APIs/models**.

| Doc | Contents |
|-----|----------|
| **[GUIDE.md](docs/GUIDE.md)** | Full command reference + working playbooks + diagrams |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [docs/SESSIONS.md](docs/SESSIONS.md) | Session memory |
| [docs/SECURITY.md](docs/SECURITY.md) | Policy / sandbox |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Speed kit |
| [docs/TOOLS.md](docs/TOOLS.md) | Tool catalog |
| [FEATURES.md](FEATURES.md) | Feature list / roadmap |

---

## Features

- **Gated harness:** `/plan` → Q&A → `/confirm` → swarm execute → `/accept`
- **Dashboard TUI:** 2×2 agents · plan · swarm map · files · diff · bus · timeline
- **Sessions:** workspace `.arrowcode-sessions/` (resume, memory, metrics)
- **Safety:** path deny, secret scan, bash allowlist, dry-run, token budget, `/undo`
- **Perf:** parallel read tools, prompt/file caches, fast context trim (`/perf`)
- **Packaging:** `defaults/` in repo; `~/.arrowcode` only after install/setup

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.1  
  `curl -fsSL https://bun.sh/install | bash`
- Git (recommended)
- An OpenAI-compatible API key (default: [NVIDIA NIM](https://build.nvidia.com) `nvapi-...`)

---

## Install

### One-liner (recommended)

**Linux / macOS / WSL (`install.sh`)**

```bash
curl -fsSL https://raw.githubusercontent.com/Chintanpatel24/arrowcode/main/install.sh | bash
```

Install + open API setup wizard:

```bash
curl -fsSL https://raw.githubusercontent.com/Chintanpatel24/arrowcode/main/install.sh | bash -s -- --setup
```

**Windows PowerShell (`install.ps1`)**

```powershell
irm https://raw.githubusercontent.com/Chintanpatel24/arrowcode/main/install.ps1 | iex
```

Install + API setup wizard:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Chintanpatel24/arrowcode/main/install.ps1))) -Setup
```

Or clone first, then:

```powershell
git clone https://github.com/Chintanpatel24/arrowcode.git
cd arrowcode
.\install.ps1 -Setup
```

What the one-liners do:

1. Install Bun if missing  
2. Clone/update ArrowCode  
3. `bun install`  
4. Seed `~/.arrowcode` from `defaults/`  
5. Link `arrowcode` / `ac` onto your PATH  

### From a clone

```bash
git clone https://github.com/Chintanpatel24/arrowcode.git
cd arrowcode
chmod +x install.sh bin/arrowcode
./install.sh
# or without install script:
bun install
bun link          # optional global arrowcode / ac
```

### Setup API key

```bash
arrowcode --setup
# or
export NVIDIA_API_KEY=nvapi-...
```

`~/.arrowcode` is created **only** by `--setup`, `--init`, or `./install.sh` / `install.ps1` (copied from `defaults/`).

---

## Usage

```bash
cd /path/to/your-project
arrowcode
```

### Core loop

```text
/session new my-feature
/templates fullstack
/plan Add a /health API and status page
# answer 1. … 2. …
/confirm
/accept
```

### Useful commands

| Area | Commands |
|------|----------|
| Loop | `/plan` `/confirm` `/accept` `/reject` `/stop` `/review` |
| Sessions | `/session new\|list\|load\|save\|memory\|delete` |
| Safety | `/yolo` `/dryrun` `/allowlist` `/secretscan` `/budget` `/undo` |
| System | `/settings` `/status` `/cost` `/swarm` `/perf` `/help` `/exit` |

Routing: `@fe` `@be` `@qa` `@orch` `@all`

Full list: **[GUIDE.md](GUIDE.md)**

---

## Defaults vs user home

| Location | When | What |
|----------|------|------|
| `defaults/` in git | always | personalities, templates, example config |
| `~/.arrowcode/` | after install/setup only | your keys + overrides |
| `<project>/.arrowcode-sessions/` | while coding | sessions / exports |
| `<project>/.arrowcode-checkpoints/` | while coding | `/undo` snapshots |

Runtime works **without** `~/.arrowcode` using packaged `defaults/`.

---

## Development / CI

```bash
bun install
bun run typecheck
bun run test:smoke
bun run ci
bun run src/index.ts --help
```

GitHub Actions: `.github/workflows/ci.yml` runs typecheck, CLI smoke, and integration smoke.

---

## Publish checklist

1. Replace `YOUR_USER` in `README.md`, `docs/INSTALL.md`, `install.sh`, `install.ps1`, `package.json`, `CONTRIBUTING.md`
2. `bun run ci`
3. Create GitHub repo → push `main`
4. Optional: enable as **template repository**
5. Tag release: `v1.0.0`

---

## License

MIT — see [LICENSE](LICENSE)
