# Changelog

## 0.0.38

- Uses the current file content when a clean editor backup predates an external update
- Restores unsaved drafts while retaining externally changed content as a conflict

## 0.0.37

- Preserves unsaved drafts across external snapshots, undo, redo, and IME composition
- Presents Git comparison with removed colors on the original side and inserted colors on the modified side

## 0.0.33

- Completes Markdown parsing before deriving rich tables in long documents
- Presents Raw documents as source text with empty decorations, atomic ranges, and widgets
- Verifies rich table and Raw behavior from installed Perwrite and theme VSIX packages

## 0.0.31

- Keeps a code block highlighted when another block loads a new language, instead of failing with a stale request error

## 0.0.30

- Aligns appearance-settings message decoding with `PERWRITE_SETTING_SCHEMA`, so the new padding and heading line-height fields reach the webview

## 0.0.29

- Declares Mermaid block padding and border on the appearance assignment table, and includes that chrome in estimated widget height and inline scale width
- Exposes math block padding, table cell and widget paddings, Mermaid block padding, and heading line heights as Perwrite settings
- Removes measurement-only inspection scripts from the packaged extension

## 0.0.28

- Reprojects an open Mermaid expand overlay when its viewport size changes, so window resize recenters and refits the diagram
- Prepares Mermaid geometry on document load and appearance change, and derives estimated widget height from that geometry scaled to available width

## 0.0.27

- Cached measured heights for Mermaid, KaTeX, fenced code, and table widgets so estimated layout height reuses the last measured height across viewport redraws, and clears that cache when appearance metrics change

## 0.0.26

- Resolved a fenced code block's widget by its language through a declared lookup, replacing a single hardcoded Mermaid branch

## 0.0.25

- Made clicking the Mermaid preview or an image open its expanded view directly, replacing the separate zoom button
- Added an edit action inside the expanded view that moves the caret to the block's raw source

## 0.0.24

- Unified edit success on a verified before-and-after document snapshot with matching content hashes, replacing the separate watcher, filesystem polling, and version guessing paths
- Resolved comparison and readonly revisions once into a snapshot carrying physical location, revision identity, content, and content hash
- Made the Mermaid, Shiki, comparison, and image presentation states discriminated unions keyed to the current request and document generation
- Converted unknown VS Code theme kinds and per-color decode failures into typed failures instead of an implicit dark fallback
- Added font resource preparation tracking so Mermaid measurements wait for required fonts before publishing
- Guarded the deferred search-reveal scroll write against a torn-down or since-changed editor view

## 0.0.23

- Confined Mermaid's asynchronous render and geometry measurement DOM to a hidden preparation target
- Made inline and expanded presentation consume only geometry-complete diagrams

## 0.0.22

- Hid modal contents during layout preparation and exposed them only after viewport presentation was complete
- Defined modal lifecycle transitions and reduced Mermaid viewport styling to a pure presentation calculation

## 0.0.21

- Added a reusable modal component with backdrop closing, focus return, and focus trapping
- Centered fitted Mermaid previews on both axes while preserving pointer-centered zoom and pan behavior

## 0.0.20

- Replaced handwritten Mermaid control paths with the official Heroicons SVG assets
- Added browser verification that every control icon is centered and contained in its 24px view box

## 0.0.19

- Replaced Mermaid text controls with translucent overlay icons
- Added configurable Mermaid zoom, keyboard movement, and edge limits with a default limit of 1024 edges

## 0.0.18

- Added Mermaid overview and zoom controls, code block wrapping, and in-flight edit delivery across delayed Host observations

## Unreleased

- Display KaTeX parse failures as ordinary Markdown text without replacing the source range
- Changed the default heading scales to 2.4, 2, 1.6, 1.2, 1, and 1
- Added the perwrite.revealTarget programmatic command that reveals a URI, range, and optional Git revision with two-tier line and match highlighting, panel-aware safe-band scrolling, and internal search integration
- Added structural list indentation, task checkbox editing, source-range deletion for rendered blocks, marker-aware deletion, and IME-safe decoration updates
- Replaced the unified HEAD diff with a side-by-side Git comparison for working tree, index, and commit revisions, including synchronized scrolling and VSCodium Insiders source-control diff integration
- Added editable raw, rich, and render view modes cycled by the toolbar button and Ctrl/Cmd+Shift+M
- Added the perwrite.defaultViewMode setting for the initial view mode of newly opened editors
- Added perwrite.mermaidLayout and perwrite.texRendering settings with live editor reconfiguration
- Added appearance settings for line height, editor width, heading scales, and spacing
- Added live inheritance for VS Code color themes and editor fonts
- Unified editor, widget, and CodeMirror styling through Perwrite CSS variables

## 0.0.1

- Initial release
- Obsidian-style inline Markdown editing (IR mode)
- Mermaid diagram rendering
- KaTeX math rendering (inline and block)
- Shiki code block highlighting with VSCode theme support
- GFM (GitHub Flavored Markdown) support
