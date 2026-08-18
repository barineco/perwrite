import '../../webview/theme/styles.css'
import { ComparisonEditorState } from '../../webview/editor/comparison-state'
import type { RenderingProfile, ResolvedGitComparison, RevisionSnapshot } from '../../src/protocol'
import { contentHash } from '../../src/protocol'

const prefix = Array.from({ length: 20 }, (_, index) => `before ${index}`).join('\n')
const suffix = Array.from({ length: 30 }, (_, index) => `after ${index}`).join('\n')
const original = `# \`Original\` title\n\nstable before deletion\n\`deleted\` line\nstable after deletion\n\n$$\nx^2\n$$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\`\n\n${prefix}\n\n${suffix}\n`
const modified = `# \`Modified\` title\n\nstable before deletion\nstable after deletion\n\n\`added\` line\n\n$$\nx^2\n$$\n\n| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n\`\`\`mermaid\ngraph TD\n  A --> B\n  B --> C\n  C --> D\n  D --> E\n\`\`\`\n\n${prefix}\n\n${suffix}\nnew tail\n`

function snapshot(content: string, revisionIdentity: RevisionSnapshot['revisionIdentity'], provenance: RevisionSnapshot['provenance']): RevisionSnapshot {
  return { physicalUri: 'file:///repo/note.md', revisionIdentity, content, contentHash: contentHash(content), provenance }
}

const comparison: ResolvedGitComparison = {
  identity: 'browser-scenario',
  original: { snapshot: snapshot(original, { kind: 'commit', fullHash: '0000000000000000000000000000000000000000' }, { kind: 'commit', requestedRef: 'HEAD', documentVersion: 0 }), label: 'HEAD', documentId: 'git:original', baseResourceUri: 'https://perwrite.test/' },
  modified: { snapshot: snapshot(modified, { kind: 'working-tree' }, { kind: 'working-tree', documentVersion: 1 }), label: 'Working Tree', documentId: 'file:modified', baseResourceUri: 'https://perwrite.test/' },
  editableSide: 'modified',
}

const root = document.getElementById('editor')!
let rendering: RenderingProfile = { generation: 0, codeBlockWrap: true, mermaidLayout: 'elk', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: true }
const state = new ComparisonEditorState(root, comparison, 'render', rendering, { onEdit() {} })
for (const mode of ['raw', 'rich', 'render'] as const) document.getElementById(`mode-${mode}`)!.addEventListener('click', () => state.setMode(mode))
document.getElementById('tex-off')!.addEventListener('click', () => { rendering = { ...rendering, texRendering: false }; state.reconfigureRendering(rendering) })
for (const layout of ['elk', 'dagre'] as const) document.getElementById(`layout-${layout}`)!.addEventListener('click', () => { rendering = { ...rendering, mermaidLayout: layout }; state.reconfigureRendering(rendering) })
Object.assign(globalThis, { comparisonScenario: state, comparisonSnapshot: snapshot })
