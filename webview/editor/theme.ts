import { EditorView } from '@codemirror/view'

export const perwriteTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--perwrite-editor-background)',
    color: 'var(--perwrite-editor-foreground)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--perwrite-font-family)',
    lineHeight: 'var(--perwrite-line-height)',
  },
  '.cm-content': {
    caretColor: 'var(--perwrite-cursor-foreground)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--perwrite-cursor-foreground)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--perwrite-selection-background)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--perwrite-gutter-background)',
    borderRight: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'var(--perwrite-gutter-foreground)',
    fontSize: 'var(--perwrite-font-size)',
    minWidth: '3ch',
  },
  '.cm-lineNumbers .cm-gutterElement.cm-activeLineGutter': {
    color: 'var(--perwrite-gutter-active-foreground)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
})
