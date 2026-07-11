# Contributing

## Setup

```bash
git clone https://github.com/Chintanpatel24/arrowcode.git
cd arrowcode
bun install
bun run ci
```

## Checks before PR

```bash
bun run typecheck
bun run test:smoke
bun run src/index.ts --help
bun run src/index.ts --banner
```

## Guidelines

- Keep file tools sandboxed via `Workspace`
- Prefer workspace-local session/checkpoint data over creating `~/.arrowcode` unless install/setup
- No emoji in TUI output
- Update `GUIDE.md` / `docs/` when adding commands or flows
- Add smoke coverage for new critical paths when practical

## Layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [GUIDE.md](GUIDE.md).
