# Contributing

Perwrite is a VS Code extension written in TypeScript. The editor surface runs in a webview built on CodeMirror 6.

## Requirements

- Node.js 22 or later
- pnpm
- VS Code 1.120.0 or a compatible editor

## Setup

```bash
pnpm install
```

## Development

Four scripts cover the everyday loop.

```bash
pnpm build
pnpm watch
pnpm lint
pnpm test
```

- `build`: bundles the extension and the webview once
- `watch`: rebuilds on change
- `lint`: type-checks the sources
- `test`: runs the unit tests

The build step also builds the companion theme extension under `theme-source/`.

## Browser tests

The browser tests drive a real editor surface and take longer than the unit tests.

```bash
pnpm test:browser
pnpm test:vscode-version
pnpm test:vscodium-search-reveal
pnpm test:vscodium-code-block-wrap
```

The first script covers webview rendering and interactions. The remaining three launch a real editor instance and require the editor binary on the search path.

## Packaging

The build script bumps the version, builds, and packages both extensions.

```bash
./build.sh
./build.sh minor
./build.sh major
./build.sh none
```

The argument selects how the version moves. A patch release is the default. The last form keeps the version already declared in the manifest.

The script writes the new version into the manifest without creating a git tag. It produces one package for the extension and one for the companion theme extension.

To package without changing the version, run the package script directly.

```bash
pnpm package
```

## Project layout

| Path | Contents |
|---|---|
| `src/` | extension host: the custom editor provider and message validation |
| `webview/` | editor surface: setup, rendering rules, and widgets |
| `webview/editor/render-rules.ts` | the declarative table that decides how each node renders |
| `tests/` | unit tests |
| `tests/browser/` | browser and editor-instance tests |
| `theme-source/` | companion extension that exposes theme colors |

Rendering behavior is derived from declarations rather than written per node. Adding a syntax takes three steps: declare how it renders, assign it to a deriver, and implement that deriver.
