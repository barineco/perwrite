# Perwrite

[日本語](README-ja.md)

Perwrite is a Markdown editor extension for VS Code and compatible editors. It lets you edit Markdown and preview rich rendering in one editor.

It renders:

- Mermaid diagrams and KaTeX math
- Shiki syntax highlighting
- GFM tables, task lists, and internal links

## Example

![Perwrite rendering example](https://raw.githubusercontent.com/barineco/perwrite/publish/docs/perwrite-rendering.png)

## Usage

1. Install Perwrite in VS Code or a compatible editor.
2. Open a Markdown file.
3. Use the buttons in the upper-right corner to switch view modes.

Perwrite provides three view modes:

```text
raw
rich
render
```

[`docs/perwrite-showcase.md`](./docs/perwrite-showcase.md) collects the supported Markdown structures and lets you inspect their result in each view mode.

## Supported environments

- VS Code 1.120.0 or later
- VS Code-compatible editors that support the VS Code extension API

KaTeX input that cannot be interpreted as a formula remains ordinary Markdown text.

## Mermaid diagrams

Rendered Mermaid diagrams provide a translucent icon in the upper-right corner for opening the expanded view. The expanded view supports icon controls, keyboard movement, pointer dragging, wheel movement, and Ctrl / Meta plus wheel zooming.

- `perwrite.mermaidLayout`: layout engine, with `elk` as the default
- `perwrite.mermaidMaxEdges`: edge limit, with `1024` as the default
- `perwrite.mermaidPanStep`: arrow-key movement in pixels, with `80` as the default
- `perwrite.mermaidZoomStep`: button, keyboard, and wheel-notch scale factor, with `1.5` as the default

## Code block wrapping

This setting controls visual wrapping for fenced code block lines.

- Setting: `perwrite.codeBlockWrap`
- Default: `true` wraps lines to the document width
- Disabled: `false` preserves logical lines with horizontal scrolling inside the code block

Inline code, Mermaid diagrams, KaTeX formulas, and tables retain their existing rendering.

## Documentation

- [Documentation index](./docs/en/INDEX.md)
- [Editing architecture](./docs/en/architecture/overview.md)

## Contributing

Build, test, and packaging instructions are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Perwrite is distributed under the [MIT License](./LICENSE).
