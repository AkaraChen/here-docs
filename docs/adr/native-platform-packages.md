# ADR: Native platform packages

## Status

Accepted

## Context and forces

Conversion needs four native stacks: `@firecrawl/anydoc`, `@firecrawl/pdf-inspector`, `@arcships/light-ocr`, and `sharp`. Each ships a JS facade plus per-OS/arch (and on Linux, per-libc) addon packages.

Those addons are **optionalDependencies of the facade, or of a nested runtime** (`@arcships/light-ocr` → `@arcships/light-ocr-runtime` → `@arcships/light-ocr-<platform>`). A consumer `npm install github:AkaraChen/here-docs` can succeed while the matching addon is absent or not visible to the facade’s `require()`:

- optional dependencies of nested packages are dropped under `--omit=optional`, some CI defaults, and several package-manager layouts;
- isolated `node_modules` (pnpm, Yarn PnP) only lets a package require what it declared, so a platform package hoisted under `here-docs` is invisible to `light-ocr-runtime` / anydoc / pdf-inspector / sharp;
- Git installs pack `files: ["dist"]` and reinstall the dependency tree in the consumer — the clone’s own `node_modules` is not shipped.

The failure is not macOS-specific. Every official triple the engines publish can miss its addon the same way. pdf-inspector has no darwin-x64 build; light-ocr has no musl build; anydoc and pdf-inspector have no win32-arm64 build. Pretending those hosts work, or only listing `darwin-arm64`, leaves other installers broken.

Missing natives must not become convert warnings. Without addons there is no engine.

## Decision

1. Pin the four engine packages to exact versions and **re-declare every official optional platform package they publish** as `optionalDependencies` of `here-docs`, at those same versions. Package managers then install the one matching the current `os` / `cpu` / libc at a path `here-docs` can resolve.
2. Keep a **host matrix** in library code: the intersection of addons required to start all four engines. Supported hosts today are `darwin-arm64`, `linux-x64-gnu`, `linux-arm64-gnu`, and `win32-x64`. Other hosts fail closed with the upstream gap named.
3. Before loading facades, `createEngine()` resolves each required package from `here-docs` and **installs a CommonJS resolve hook** so nested facades find those absolute paths. light-ocr also gets `LIGHT_OCR_NODE_BINARY` / `LIGHT_OCR_RUNTIME_DESCRIPTOR` (its documented override). Do not set `NAPI_RS_NATIVE_LIBRARY_PATH` — it is a single path and would break the other napi-rs engine.
4. Install `postinstall` and `createEngine()` both run the same check. Absence or an unsupported host throws a typed error. `--omit=optional` is unsupported.

## Considered alternatives

- List only `darwin-arm64`. Rejected: the same nest/hoist failure exists on every host the engines ship.
- Rely on nested optionalDependencies alone. Rejected: that is the layout that already fails after Git install and under isolated `node_modules`.
- Treat missing addons as convert warnings. Rejected: there is no engine to convert with.
- Auto-download binaries in `postinstall`. Rejected: duplicates upstream packages, fights `--ignore-scripts`, and still needs a resolve hook.
- Degrade PDF on hosts where pdf-inspector has no build. Rejected: mixed-PDF completeness is a product invariant; fail closed instead.

## Trade-offs and consequences

- `package.json` must stay in lockstep with engine versions. A test compares the optional set and pins to the catalog in code.
- Install size on disk is still one platform’s addons; the other triples are skipped by `os` / `cpu`.
- Yarn PnP still needs the resolve hook; consumers who disable install scripts still fail at `createEngine()` rather than with a silent empty manuscript.
- When an engine adds or drops a triple, the catalog, optionalDependencies, and this ADR’s supported-host list must change together.
- GitHub Actions must keep a job on each supported host (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, `windows-2025`) that installs optional addons, runs unit tests, and runs a packed consumer `createEngine()` / `convert()` smoke. A musl job asserts fail-closed startup.
