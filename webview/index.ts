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
import { EditDeliveryScheduler, type EditDeliveryTarget, type PendingEditDelivery } from './editor/edit-delivery'
import { decodeHostMessage } from '../src/message-validation'
import { beginComparison, createWebviewState, initializeWebviewSession, settleComparison, transitionWebviewState, type WebviewState } from './session-state'
import type {
  ComparisonFailure, HostDocumentObservation, EditorConfiguration, GitRevision, HostMessage, ResolvedGitComparison,
  ResolvedReadonlyDocument, WebviewMessage,
} from '../src/protocol'
import { contentHash } from '../src/protocol'
import type { EditorView } from '@codemirror/view'
import { handleHostResult, type HostFailureDisplay } from './host-result'
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
let editVersion = 0
let isExternalUpdate = false
let appliedAppearance: AppliedAppearance | null = null
let currentAppearanceSources: AppearanceHostSources | null = null
let appearanceGeneration = 0
let controlsInitialized = false
let themeObserverInitialized = false
let comparisonState: ComparisonEditorState | null = null
let comparisonConfiguration: EditorConfiguration | null = null
let pendingComparison: ResolvedGitComparison | null = null
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
let activeDocumentVersion = 0
let acceptedConfiguration: EditorConfiguration | null = null
const comparisonDocumentVersions = new Map<string, number>()

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

const editDelivery = new EditDeliveryScheduler(
  (pending: PendingEditDelivery, editId: string) => {
    postMessage({
      type: 'edit', editId, target: pending.target,
      sessionGeneration: pending.sessionGeneration,
      baseDocumentVersion: pending.baseDocumentVersion,
      changes: changeSetToTextChanges(pending.changes),
    })
  },
  () => {
    editVersion++
    return `${webviewState.sessionIdentity}:${webviewState.sessionGeneration}:${editVersion}`
  },
)

function cancelPendingEdit(): void {
  editDelivery.cancel('display session changed')
}

function scheduleEdit(
  target: EditDeliveryTarget,
  baseDocumentVersion: number,
  baseContent: string,
  changes: import('@codemirror/state').ChangeSet,
): void {
  editDelivery.schedule(target, webviewState.sessionGeneration, baseDocumentVersion, baseContent, changes)
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

function acceptHostDocumentObservation(observation: HostDocumentObservation): boolean {
  if (observation.sessionGeneration !== webviewState.sessionGeneration || observation.contentHash !== contentHash(observation.content)) return false
  if (observation.target.kind === 'comparison') {
    if (!comparisonState || comparisonState.documentIdForSide(observation.target.side) !== observation.target.documentId) return false
    const acceptedVersion = comparisonDocumentVersions.get(observation.target.documentId)
    if (acceptedVersion === undefined || observation.documentVersion <= acceptedVersion) return false
    isExternalUpdate = true
    comparisonState.updateContent(observation.target.side, observation.content)
    isExternalUpdate = false
    comparisonDocumentVersions.set(observation.target.documentId, observation.documentVersion)
    setWebviewState(transitionWebviewState(webviewState, { type: 'apply-snapshot', content: observation.content, selection: [] }).state)
    document.body.dataset.externalUpdateDocumentLength = String(comparisonState.viewForDocumentId(observation.target.documentId)?.state.doc.length ?? 0)
    return true
  }
  if (comparisonState || activeDocumentId !== observation.target.documentId || observation.documentVersion <= activeDocumentVersion) return false
  const view = configurationState.kind === 'active' ? configurationState.view : null
  if (view) {
    isExternalUpdate = true
    setEditorContent(view, observation.content)
    isExternalUpdate = false
    document.body.dataset.externalUpdateDocumentLength = String(view.state.doc.length)
  } else {
    configurationState = updateInitialInvalidContent(configurationState, observation.content)
  }
  activeDocumentVersion = observation.documentVersion
  setWebviewState(transitionWebviewState(webviewState, { type: 'apply-snapshot', content: observation.content, selection: [] }).state)
  return true
}

function applyRecoveredContent(target: EditDeliveryTarget, content: string): void {
  isExternalUpdate = true
  if (target.kind === 'comparison' && comparisonState) comparisonState.updateContent(target.side, content)
  else {
    const view = currentView()
    if (view && activeDocumentId === target.documentId) setEditorContent(view, content)
  }
  isExternalUpdate = false
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

function requestComparison(original: GitRevision, modified: GitRevision): void {
  cancelPendingEdit()
  comparisonState?.destroy()
  comparisonState = null
  comparisonConfiguration = null
  pendingComparison = null
  readonlyView?.destroy()
  readonlyView = null
  pendingReadonly = null
  document.body.classList.remove('comparing')
  delete document.body.dataset.comparisonIdentity
  delete document.body.dataset.editorKind
  const root = document.getElementById('editor')
  if (root) {
    root.className = ''
    root.replaceChildren()
  }
  const requestId = webviewState.nextComparisonRequest + 1
  const transition = beginComparison(webviewState, requestId, original, modified)
  setWebviewState(transition.state)
  showComparisonPresentation()
  for (const effect of transition.effects) if (effect.type === 'request-comparison') {
    postMessage({ type: 'comparison-request', requestId: effect.requestId, original: effect.original, modified: effect.modified })
  }
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
    onChanges: (changes, _view, beforeContent) => {
      if (isExternalUpdate) return
      scheduleEdit(
        { kind: 'editing', documentId: init.documentId },
        activeDocumentVersion,
        beforeContent,
        changes,
      )
    },
    onLinkClick: url => postMessage({ type: 'open-link', url }),
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
    beginFontResourcePreparation,
    invalidateWidgets() {
      refreshMermaidPresentations()
      if (comparisonState) comparisonState.invalidateAppearance()
      else {
        const view = currentView()
        if (view) invalidateEditorAppearance(view)
      }
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
  cancelPendingEdit()
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
      onEdit(side, documentId, changes, _view, beforeContent, _afterContent) {
        scheduleEdit(
          { kind: 'comparison', documentId, side },
          comparisonDocumentVersions.get(documentId) ?? 0,
          beforeContent,
          changes,
        )
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
  cancelPendingEdit()
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

async function handleHostMessage(msg: HostMessage): Promise<void> {
  if (msg.type === 'edit-result') {
    if (msg.result.ok) {
      const observation = msg.result.value
      const result = editDelivery.recordObservation(observation)
      if (result.ok) {
        handleHostResult(msg, showEditFailure)
        document.body.dataset.lastEditId = observation.request.editId
        document.body.dataset.lastEditBaseDocumentVersion = String(observation.request.baseDocumentVersion)
        document.body.dataset.lastEditAppliedDocumentVersion = String(observation.after.documentVersion)
        if (observation.after.target.kind === 'editing') activeDocumentVersion = observation.after.documentVersion
        comparisonDocumentVersions.set(observation.after.target.documentId, observation.after.documentVersion)
      }
    } else {
      const result = editDelivery.recordFailure(msg.result.error)
      if (result.kind === 'stale-result') return
      handleHostResult(msg, showEditFailure)
      if (msg.result.error.snapshot) acceptHostDocumentObservation(msg.result.error.snapshot)
      if (result.kind === 'recovery-required' && editDelivery.state.kind === 'recovery') {
        showEditFailure({
          title: 'Queued edit recovery required', detail: result.reason,
          actions: [
            { label: '再試行', run: () => {
              const retry = editDelivery.retryRecovery()
              if (!retry.ok) showEditFailure({ title: 'Queued edit recovery required', detail: retry.reason })
              else if (editDelivery.state.kind === 'inFlight') {
                applyRecoveredContent(editDelivery.state.inFlight.target, editDelivery.state.inFlight.afterContent)
                showEditFailure(null)
              }
            } },
            { label: '待機中の編集を破棄', run: () => {
              editDelivery.discardRecovery('Queued edit discarded by user')
              showEditFailure({ title: 'Queued edit discarded', detail: result.reason })
            } },
          ],
        })
      }
    }
  }

  switch (msg.type) {
    case 'init': {
      try {
        cancelPendingEdit()
        activeDocumentId = msg.documentId
        activeDocumentVersion = msg.documentVersion ?? 0
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
      for (const side of ['original', 'modified'] as const) comparisonDocumentVersions.set(msg.result.value[side].documentId, msg.result.value[side].snapshot.provenance.documentVersion)
      reportReadyEditors([msg.result.value.original.documentId, msg.result.value.modified.documentId])
      document.body.dataset.comparisonOrigin = 'custom-editor-diff'
      pendingComparison = null
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
      showConfigurationFailure(msg.configuration.value.configurationFailure)
      createReadonlyDocument(msg.document, msg.configuration.value)
      acceptedConfiguration = msg.configuration.value
      activeDocumentId = msg.document.documentId
      setWebviewState(initializeWebviewSession(webviewState, msg.document.documentId, 'readonly'))
      showComparisonPresentation()
      reportReadyEditors([msg.document.documentId])
      pendingReadonly = null
      refreshToggleLabel()
      break
    }

    case 'reveal-target': {
      if (comparisonState?.reveal(msg.documentId, msg.from, msg.to, msg.source)) break
      const view = readonlyView ?? (configurationState.kind === 'active' ? configurationState.view : null)
      if (view) revealTarget(view, msg.from, msg.to, msg.source)
      break
    }

    case 'host-document-observation': {
      if (acceptHostDocumentObservation(msg.observation)) {
        document.body.dataset.externalUpdateCount = String(Number(document.body.dataset.externalUpdateCount ?? '0') + 1)
        document.body.dataset.externalUpdateBytes = String(new TextEncoder().encode(msg.observation.content).byteLength)
      }
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
      if (pendingComparison) {
        const comparison = pendingComparison
        createComparison(comparison, msg.configuration.value)
        pendingComparison = null
        showConfigurationFailure(msg.configuration.value.configurationFailure)
        reportReadyEditors([comparison.original.documentId, comparison.modified.documentId])
        refreshToggleLabel()
        break
      }
      if (pendingReadonly) {
        const documentValue = pendingReadonly
        createReadonlyDocument(documentValue, msg.configuration.value)
        pendingReadonly = null
        showConfigurationFailure(msg.configuration.value.configurationFailure)
        reportReadyEditors([documentValue.documentId])
        refreshToggleLabel()
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
      const settled = settleComparison(webviewState, msg.requestId, msg.result)
      if (settled.effects.some(effect => effect.type === 'drop-invalid-event')) break
      setWebviewState(settled.state)
      showComparisonPresentation()
      if (msg.result.ok) {
        showDiffFailure(null)
        setBaseResourceUri(msg.result.value.modified.baseResourceUri)
        for (const side of ['original', 'modified'] as const) comparisonDocumentVersions.set(msg.result.value[side].documentId, msg.result.value[side].snapshot.provenance.documentVersion)
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

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    postMessage({ type: 'save' })
  }
})
