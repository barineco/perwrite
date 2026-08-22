import 'katex/dist/katex.min.css'
import './theme/styles.css'
import { createEditor, setEditorContent } from './editor/setup'
import { revealTarget } from './editor/search-reveal'
import {
  disposeShikiTheme,
  prepareShikiTheme,
  publishShikiTheme,
} from './nodes/code-block-node'
import { refreshMermaidPresentations, updateMermaidTheme } from './nodes/mermaid-node'
import { setBaseResourceUri } from './editor/image-widget'
import { viewModeField, setViewModeEffect, cycleViewMode, type ViewMode } from './editor/view-mode'
import { ComparisonEditorState } from './editor/comparison-state'
import { changeSetToTextChanges } from './editor/edit-changes'
import { decodeHostMessage } from '../src/message-validation'
import { beginComparison, createWebviewState, initializeWebviewSession, settleComparison, transitionWebviewState, type WebviewState } from './session-state'
import type {
  ComparisonFailure, EditorConfiguration, GitRevision, HostMessage, ResolvedGitComparison,
  ResolvedReadonlyDocument, WebviewMessage,
} from '../src/protocol'
import { contentHash } from '../src/protocol'
import type { EditorView } from '@codemirror/view'
interface HostFailureDisplay { readonly title: string; readonly detail: string; readonly actions?: readonly { readonly label: string; readonly run: () => void }[] }
import { applyFailureDisplay } from './failure-dom'
import {
  applyAppearanceResolution,
  applyCssVariables,
  applyMetrics,
  invalidateEditorAppearance,
  resolveAppearanceFromDom,
  type AppliedAppearance,
  type AppearanceFailureDisplay,
} from './appearance'
import { observeThemeDom } from './vscode-theme-adapter'
import { beginFontResourcePreparation } from './font-resource'
import { appearanceSourceIdentity, type AppearanceHostSources } from '../src/appearance-profile'
import { reconfigureRendering } from './editor/rendering-profile'
import {
  acceptConfiguration, rejectConfiguration, updateInitialInvalidContent, type ConfigurationState,
} from './configuration-state'


declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

const vscode = acquireVsCodeApi()

type InitMessage = Extract<HostMessage, { type: 'init' }>
let configurationState: ConfigurationState<EditorView, InitMessage> = { kind: 'uninitialized' }
let isExternalUpdate = false
let appliedAppearance: AppliedAppearance | null = null
let currentAppearanceSources: AppearanceHostSources | null = null
let appearanceGeneration = 0
let controlsInitialized = false
let themeObserverInitialized = false
let comparisonState: ComparisonEditorState | null = null
let comparisonConfiguration: EditorConfiguration | null = null
let pendingComparisonIntent: { readonly original: GitRevision; readonly modified: GitRevision } | null = null
let comparisonIntentToken = 0
let pendingReadonly: ResolvedReadonlyDocument | null = null
let readonlyView: EditorView | null = null
let webviewState: WebviewState = createWebviewState('perwrite-webview')

function syncWebviewSessionDataset(): void {
  document.body.dataset.webviewSessionIdentity = webviewState.sessionIdentity
  document.body.dataset.webviewSessionGeneration = String(webviewState.sessionGeneration)
  document.body.dataset.webviewDisplaySession = webviewState.displaySession
}

function setWebviewState(next: WebviewState): void {
  webviewState = next
  syncWebviewSessionDataset()
}

let activeDocumentId: string | null = null
let draftGeneration = 0
let acceptedConfiguration: EditorConfiguration | null = null

function currentView(): EditorView | null {
  if (comparisonState) return comparisonState.original
  if (readonlyView) return readonlyView
  return configurationState.kind === 'active' ? configurationState.view : null
}

function currentMode(): ViewMode | null {
  return comparisonState?.mode() ?? (currentView()?.state.field(viewModeField) ?? null)
}

function postMessage(msg: WebviewMessage): void {
  vscode.postMessage(msg)
}

function selectionOffsets(view: EditorView): readonly number[] { return view.state.selection.ranges.flatMap(range => [range.anchor, range.head]) }
function scheduleEdit(view: EditorView, beforeContent: string, _afterContent: string, changes: import('@codemirror/state').ChangeSet): void {
  if (!activeDocumentId || isExternalUpdate) return
  postMessage({ type: 'draft-edit', uri: activeDocumentId, generation: draftGeneration, beforeHash: contentHash(beforeContent), changes: changeSetToTextChanges(changes), selection: selectionOffsets(view) })
  draftGeneration++
}

function reportReadyEditors(documentIds: readonly string[]): void {
  postMessage({ type: 'editor-ready', documentIds })
}

function showThemeFailure(display: AppearanceFailureDisplay | null): void {
  applyFailureDisplay(document, 'theme-error', 'status', display)
}

function showEditFailure(display: HostFailureDisplay | null): void {
  applyFailureDisplay(document, 'edit-error', 'alert', display)
}

function showDiffFailure(display: HostFailureDisplay | null): void {
  applyFailureDisplay(document, 'diff-error', 'alert', display)
}

function showReadonlyReason(documentValue: ResolvedReadonlyDocument | null): void {
  applyFailureDisplay(document, 'readonly-info', 'status', documentValue ? {
    title: documentValue.target,
    detail: documentValue.reason,
  } : null)
}

function comparisonFailureDisplay(error: ComparisonFailure): HostFailureDisplay {
  const side = error.side ? `${error.side}: ` : ''
  return { title: 'Comparison unavailable', detail: `${side}${error.target}: ${error.detail}` }
}

function showConfigurationFailure(error: string | null): void {
  applyFailureDisplay(document, 'configuration-error', 'alert', error ? {
    title: 'Configuration unavailable', detail: error,
  } : null)
}

function acceptConfigurationGeneration(configuration: EditorConfiguration): 'accepted' | 'stale' | 'conflict' {
  if (!acceptedConfiguration) {
    acceptedConfiguration = configuration
    return 'accepted'
  }
  const currentGeneration = acceptedConfiguration.rendering.generation
  const nextGeneration = configuration.rendering.generation
  if (nextGeneration < currentGeneration) return 'stale'
  if (nextGeneration === currentGeneration && JSON.stringify(configuration) !== JSON.stringify(acceptedConfiguration)) return 'conflict'
  acceptedConfiguration = configuration
  return 'accepted'
}

function modeLabel(mode: ViewMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1)
}

function refreshToggleLabel(): void {
  const toggle = document.getElementById('toggle-view')
  const mode = currentMode()
  if (toggle && mode) toggle.textContent = modeLabel(mode)
}

function revisionFromInput(value: string): GitRevision | null {
  const normalized = value.trim()
  if (normalized === 'working-tree') return { kind: 'working-tree' }
  if (normalized === 'index') return { kind: 'index' }
  if (normalized.length > 0) return { kind: 'commit', ref: normalized }
  return null
}

function showComparisonPresentation(): void {
  if (pendingComparisonIntent) {
    document.body.dataset.comparisonPresentation = 'pending'
    delete document.body.dataset.comparisonRequestId
    delete document.body.dataset.comparisonSessionGeneration
    return
  }
  const presentation = webviewState.comparison
  document.body.dataset.comparisonPresentation = presentation.kind
  if (presentation.kind === 'pending') {
    document.body.dataset.comparisonRequestId = String(presentation.requestId)
    document.body.dataset.comparisonSessionGeneration = String(presentation.sessionGeneration)
    return
  }
  if (presentation.kind === 'ready') {
    document.body.dataset.comparisonRequestId = presentation.requestId === null ? '' : String(presentation.requestId)
    document.body.dataset.comparisonSessionGeneration = String(presentation.sessionGeneration)
    return
  }
  if (presentation.kind === 'failed') {
    document.body.dataset.comparisonRequestId = presentation.requestId === null ? '' : String(presentation.requestId)
    document.body.dataset.comparisonSessionGeneration = String(presentation.sessionGeneration)
    return
  }
  delete document.body.dataset.comparisonRequestId
  delete document.body.dataset.comparisonSessionGeneration
}

function beginPendingComparison(token: number): void {
  if (token !== comparisonIntentToken || !pendingComparisonIntent) return
  const { original, modified } = pendingComparisonIntent
  pendingComparisonIntent = null
  const requestId = webviewState.nextComparisonRequest + 1
  const transition = beginComparison(webviewState, requestId, original, modified)
  setWebviewState(transition.state)
  showComparisonPresentation()
  for (const effect of transition.effects) if (effect.type === 'request-comparison') {
    postMessage({ type: 'comparison-request', requestId: effect.requestId, original: effect.original, modified: effect.modified })
  }
}

function requestComparison(original: GitRevision, modified: GitRevision): void {
  const token = ++comparisonIntentToken
  pendingComparisonIntent = { original, modified }
  document.body.dataset.comparisonPresentation = 'pending'
  beginPendingComparison(token)
}

function setDiffControlAvailable(available: boolean): void {
  const control = document.getElementById('toggle-diff') as HTMLButtonElement | null
  if (!control) return
  control.hidden = !available
  control.disabled = !available
}

function setupControls(): void {
  if (controlsInitialized) return
  controlsInitialized = true
  document.getElementById('toggle-view')?.addEventListener('click', () => {
    const mode = currentMode()
    if (!mode) return
    const next = cycleViewMode(mode)
    if (comparisonState) comparisonState.setMode(next)
    else currentView()?.dispatch({ effects: setViewModeEffect.of(next) })
    refreshToggleLabel()
  })
  document.getElementById('toggle-diff')?.addEventListener('click', event => {
    if ((event.currentTarget as HTMLButtonElement).disabled) return
    requestComparison({ kind: 'commit', ref: 'HEAD' }, { kind: 'working-tree' })
  })
  document.getElementById('apply-comparison')?.addEventListener('click', () => {
    const original = revisionFromInput((document.getElementById('comparison-original') as HTMLInputElement).value)
    const modified = revisionFromInput((document.getElementById('comparison-modified') as HTMLInputElement).value)
    if (original && modified) requestComparison(original, modified)
  })
}

function createConfiguredEditor(init: InitMessage, configuration: EditorConfiguration): EditorView {
  const root = document.getElementById('editor')!
  return createEditor(root, init.content, {
    onConfigurationFailure: showConfigurationFailure,
    onChanges: (changes, view, beforeContent, afterContent) => {
      if (isExternalUpdate) return
      scheduleEdit(view, beforeContent, afterContent, changes)
    },
    onLinkActivate: destination => postMessage({ type: 'activate-link', documentId: init.documentId, destination }),
  }, configuration.defaultViewMode, configuration.rendering)
}

function appearanceAdapter() {
  return {
    applyCssVariables: (values: Parameters<typeof applyCssVariables>[1]) => applyCssVariables(document.documentElement, values),
    prepareShikiTheme(theme: import('../src/appearance-profile').ThemeData, appearanceVersion: number) {
      return prepareShikiTheme(theme as unknown as Record<string, unknown>, appearanceVersion)
    },
    publishShikiTheme(candidate: unknown, isCurrent?: () => boolean) {
      return publishShikiTheme(candidate, isCurrent) !== null
    },
    applyMermaidTheme: updateMermaidTheme,
    applyMetrics,
    invalidateEditorAppearances() {
      const active = configurationState.kind === 'active' ? configurationState.view : null
      if (active) invalidateEditorAppearance(active)
      if (comparisonState) {
        invalidateEditorAppearance(comparisonState.original)
        invalidateEditorAppearance(comparisonState.modified)
      }
      if (readonlyView) invalidateEditorAppearance(readonlyView)
    },
    beginFontResourcePreparation,
    invalidateWidgets() {
      refreshMermaidPresentations()
    },
    showFailure(display: AppearanceFailureDisplay | null) {
      showThemeFailure(display)
    },
  }
}

async function reresolveAppearance(): Promise<void> {
  if (!currentAppearanceSources) return
  const generation = ++appearanceGeneration
  const resolution = resolveAppearanceFromDom(
    currentAppearanceSources,
    getComputedStyle(document.documentElement),
    document.body.dataset.vscodeThemeKind ?? null,
  )
  const applied = await applyAppearanceResolution(
    resolution, appliedAppearance, appearanceAdapter(), () => generation === appearanceGeneration, generation,
  )
  if (generation !== appearanceGeneration) return
  appliedAppearance = applied
}

async function applyAppearanceFromSources(sources: AppearanceHostSources): Promise<void> {
  if (currentAppearanceSources) {
    if (sources.version < currentAppearanceSources.version) return
    if (sources.version === currentAppearanceSources.version
      && appearanceSourceIdentity(sources) !== appearanceSourceIdentity(currentAppearanceSources)) {
      showThemeFailure({
        title: 'Appearance rendering unavailable',
        detail: `Conflicting appearance payload for version ${sources.version}`,
      })
      return
    }
  }
  currentAppearanceSources = sources
  await reresolveAppearance()
}

function setupThemeObserver(): void {
  if (themeObserverInitialized) return
  themeObserverInitialized = true
  observeThemeDom(() => { void reresolveAppearance() })
}

function createComparison(comparison: ResolvedGitComparison, configuration: EditorConfiguration): void {
  setWebviewState(transitionWebviewState(webviewState, { type: 'set-display-session', displaySession: 'comparison' }).state)
  const root = document.getElementById('editor')!
  if (configurationState.kind === 'active') {
    configurationState.view.destroy()
    configurationState = { kind: 'uninitialized' }
  }
  comparisonState?.destroy()
  readonlyView?.destroy()
  readonlyView = null
  showReadonlyReason(null)
  delete document.body.dataset.editorKind
  root.className = ''
  comparisonConfiguration = configuration
  comparisonState = new ComparisonEditorState(
    root,
    comparison,
    configuration.defaultViewMode,
    configuration.rendering,
    {
      onConfigurationFailure: showConfigurationFailure,
      onLinkActivate(documentId, destination) {
        postMessage({ type: 'activate-link', documentId, destination })
      },
      onEdit(_side, _documentId, changes, view, beforeContent, afterContent) {
        scheduleEdit(view, beforeContent, afterContent, changes)
      },
    },
  )
  document.body.classList.add('comparing')
  document.body.dataset.comparisonIdentity = comparison.identity
  ;(document.getElementById('comparison-original') as HTMLInputElement).value = comparison.original.label
  ;(document.getElementById('comparison-modified') as HTMLInputElement).value = comparison.modified.label
}

function createReadonlyDocument(
  documentValue: ResolvedReadonlyDocument,
  configuration: EditorConfiguration,
): void {
  setWebviewState(transitionWebviewState(webviewState, { type: 'set-display-session', displaySession: 'readonly' }).state)
  const root = document.getElementById('editor')!
  if (configurationState.kind === 'active') {
    configurationState.view.destroy()
    configurationState = { kind: 'uninitialized' }
  }
  comparisonState?.destroy()
  comparisonState = null
  comparisonConfiguration = null
  readonlyView?.destroy()
  root.className = 'readonly-editor'
  root.replaceChildren()
  readonlyView = createEditor(root, documentValue.snapshot.content, {
    onDocUpdate() {},
    onConfigurationFailure: showConfigurationFailure,
    onLinkActivate: destination => postMessage({ type: 'activate-link', documentId: documentValue.documentId, destination }),
  }, configuration.defaultViewMode, configuration.rendering, {
    editable: false,
    immutable: true,
  })
  document.body.classList.remove('comparing')
  delete document.body.dataset.comparisonOrigin
  delete document.body.dataset.comparisonIdentity
  document.body.dataset.editorKind = 'readonly-commit'
  showReadonlyReason(documentValue)
}

async function createPendingReadonlyDocument(): Promise<void> {
  if (!pendingReadonly) return
  if (configurationState.kind === 'uninitialized' || configurationState.kind === 'initial-invalid' || !acceptedConfiguration) return
  const documentValue = pendingReadonly
  if (pendingReadonly !== documentValue) return
  createReadonlyDocument(documentValue, acceptedConfiguration)
  pendingReadonly = null
  activeDocumentId = documentValue.documentId
  setWebviewState(initializeWebviewSession(webviewState, documentValue.documentId, 'readonly'))
  showComparisonPresentation()
  reportReadyEditors([documentValue.documentId])
  refreshToggleLabel()
}

async function handleHostMessage(msg: HostMessage): Promise<void> {
  switch (msg.type) {
    case 'draft-snapshot': {
      if (msg.uri !== activeDocumentId && activeDocumentId !== null) break
      draftGeneration = msg.generation
      const view = configurationState.kind === 'active' ? configurationState.view : null
      isExternalUpdate = true
      if (view) setEditorContent(view, msg.content, msg.selection)
      isExternalUpdate = false
      document.body.dataset.dirty = String(msg.dirty)
      document.body.dataset.externalConflict = String(msg.externalChange !== null)
      break
    }

    case 'init': {
      try {
        activeDocumentId = msg.documentId
        draftGeneration = msg.documentVersion ?? 0
        setWebviewState(initializeWebviewSession(webviewState, msg.documentId, 'editing'))
        delete document.body.dataset.comparisonIdentity
        setBaseResourceUri(msg.baseResourceUri)
        setupControls()
        setDiffControlAvailable(true)
        setupThemeObserver()
        const validConfiguration = msg.configuration.ok ? msg.configuration.value : null

        await applyAppearanceFromSources(msg.appearance)
        if (validConfiguration) {
          acceptedConfiguration = validConfiguration
          configurationState = {
            kind: 'active', init: msg, view: createConfiguredEditor(msg, validConfiguration),
            configuration: validConfiguration, configurationFailure: null,
          }
          showConfigurationFailure(validConfiguration.configurationFailure)
          reportReadyEditors([msg.documentId])
        } else if (!msg.configuration.ok) {
          configurationState = { kind: 'initial-invalid', init: msg, failure: msg.configuration.error }
          showConfigurationFailure(msg.configuration.error)
        }
        refreshToggleLabel()
      } catch (e) {
        const root = document.getElementById('editor')
        if (root) root.textContent = `Init error: ${e}`
      }
      break
    }

    case 'comparison-init': {
      setupControls()
      setDiffControlAvailable(true)
      setupThemeObserver()
      await applyAppearanceFromSources(msg.appearance)
      if (!msg.configuration.ok) {
        showConfigurationFailure(msg.configuration.error)
        showDiffFailure(msg.result.ok ? { title: 'Comparison unavailable', detail: 'Comparison configuration is unavailable' } : comparisonFailureDisplay(msg.result.error))
        break
      }
      const initialized = transitionWebviewState(webviewState, {
        type: 'initialize-comparison',
        sessionIdentity: msg.result.ok ? msg.result.value.modified.documentId : webviewState.sessionIdentity,
        result: msg.result,
      })
      if (initialized.effects.some(effect => effect.type === 'drop-invalid-event')) break
      setWebviewState(initialized.state)
      showComparisonPresentation()
      showConfigurationFailure(msg.configuration.value.configurationFailure)
      if (!msg.result.ok) {
        showDiffFailure(comparisonFailureDisplay(msg.result.error))
        setDiffControlAvailable(false)
        refreshToggleLabel()
        break
      }
      showDiffFailure(null)
      setBaseResourceUri(msg.result.value.modified.baseResourceUri)
      createComparison(msg.result.value, msg.configuration.value)
      acceptedConfiguration = msg.configuration.value
      reportReadyEditors([msg.result.value.original.documentId, msg.result.value.modified.documentId])
      document.body.dataset.comparisonOrigin = 'custom-editor-diff'
      refreshToggleLabel()
      break
    }

    case 'readonly-init': {
      setupControls()
      setDiffControlAvailable(false)
      setupThemeObserver()
      await applyAppearanceFromSources(msg.appearance)
      setBaseResourceUri(msg.document.baseResourceUri)
      pendingReadonly = msg.document
      if (!msg.configuration.ok) {
        showConfigurationFailure(msg.configuration.error)
        break
      }
      const configuration = msg.configuration.value
      showConfigurationFailure(configuration.configurationFailure)
      acceptedConfiguration = configuration
      if (pendingReadonly === msg.document) {
        createReadonlyDocument(msg.document, configuration)
        activeDocumentId = msg.document.documentId
        setWebviewState(initializeWebviewSession(webviewState, msg.document.documentId, 'readonly'))
        showComparisonPresentation()
        reportReadyEditors([msg.document.documentId])
        pendingReadonly = null
        refreshToggleLabel()
      }
      break
    }

    case 'reveal-target': {
      if (comparisonState?.reveal(msg.documentId, msg.from, msg.to, msg.source)) break
      const view = readonlyView ?? (configurationState.kind === 'active' ? configurationState.view : null)
      if (view) revealTarget(view, msg.from, msg.to, msg.source)
      break
    }

    case 'appearance-change': {
      await applyAppearanceFromSources(msg.appearance)
      break
    }

    case 'configuration-change': {
      if (!msg.configuration.ok) {
        showConfigurationFailure(msg.configuration.error)
        if (!comparisonState) configurationState = rejectConfiguration(configurationState, msg.configuration.error)
        break
      }
      const generationDecision = acceptConfigurationGeneration(msg.configuration.value)
      if (generationDecision === 'stale') break
      if (generationDecision === 'conflict') {
        showConfigurationFailure(`Conflicting perwrite configuration generation ${msg.configuration.value.rendering.generation}`)
        break
      }
      if (comparisonState) {
        comparisonConfiguration = msg.configuration.value
        comparisonState.reconfigureRendering(msg.configuration.value.rendering)
        showConfigurationFailure(msg.configuration.value.configurationFailure)
        break
      }
      if (readonlyView) {
        readonlyView.dispatch({ effects: reconfigureRendering(msg.configuration.value.rendering) })
        showConfigurationFailure(msg.configuration.value.configurationFailure)
        break
      }
      if (pendingReadonly) {
        showConfigurationFailure(msg.configuration.value.configurationFailure)
        void createPendingReadonlyDocument()
        break
      }
      const before = configurationState
      configurationState = acceptConfiguration(
        configurationState,
        msg.configuration.value,
        createConfiguredEditor,
        (view, configuration) => view.dispatch({ effects: reconfigureRendering(configuration.rendering) }),
      )
      showConfigurationFailure(msg.configuration.value.configurationFailure)
      if (before.kind !== 'active' && configurationState.kind === 'active') reportReadyEditors([configurationState.init.documentId])
      refreshToggleLabel()
      break
    }

    case 'comparison-result': {
      if (pendingComparisonIntent !== null) break
      const settled = settleComparison(webviewState, msg.requestId, msg.result)
      if (settled.effects.some(effect => effect.type === 'drop-invalid-event')) break
      setWebviewState(settled.state)
      showComparisonPresentation()
      if (msg.result.ok) {
        showDiffFailure(null)
        setBaseResourceUri(msg.result.value.modified.baseResourceUri)
        let constructed = false
        if (comparisonState) {
          comparisonState.update(document.getElementById('editor')!, msg.result.value)
          constructed = true
        } else if (comparisonConfiguration) {
          createComparison(msg.result.value, comparisonConfiguration)
          constructed = true
        } else {
          const configuration = comparisonConfiguration
            ?? (configurationState.kind === 'active' ? configurationState.configuration : null)
            ?? acceptedConfiguration
          if (configuration) {
            createComparison(msg.result.value, configuration)
            constructed = true
          }
        }
        if (constructed) {
          document.body.classList.add('comparing')
          reportReadyEditors([msg.result.value.original.documentId, msg.result.value.modified.documentId])
          if (!document.body.dataset.comparisonOrigin) document.body.dataset.comparisonOrigin = 'toolbar'
        }
      } else {
        showDiffFailure(comparisonFailureDisplay(msg.result.error))
      }
      break
    }
  }
}

let hostMessageQueue = Promise.resolve()
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const decoded = decodeHostMessage(event.data)
  if (!decoded.ok) return
  hostMessageQueue = hostMessageQueue.then(() => handleHostMessage(decoded.value)).catch(error => {
    const root = document.getElementById('editor')
    if (root) root.textContent = `Message error: ${error instanceof Error ? error.message : String(error)}`
  })
})

syncWebviewSessionDataset()
postMessage({ type: 'ready' })
