import type { EditorConfiguration } from '../src/protocol'

export type ConfigurationState<TView, TInit> =
  | { readonly kind: 'uninitialized' }
  | { readonly kind: 'initial-invalid'; readonly init: TInit; readonly failure: string }
  | {
    readonly kind: 'active'
    readonly init: TInit
    readonly view: TView
    readonly configuration: EditorConfiguration
    readonly configurationFailure: string | null
  }

export function rejectConfiguration<TView, TInit>(
  state: ConfigurationState<TView, TInit>,
  error: string,
): ConfigurationState<TView, TInit> {
  if (state.kind === 'initial-invalid') return { ...state, failure: error }
  if (state.kind === 'active') return { ...state, configurationFailure: error }
  return state
}

export function acceptConfiguration<TView, TInit>(
  state: ConfigurationState<TView, TInit>,
  configuration: EditorConfiguration,
  create: (init: TInit, configuration: EditorConfiguration) => TView,
  reconfigure: (view: TView, configuration: EditorConfiguration) => void,
): ConfigurationState<TView, TInit> {
  if (state.kind === 'initial-invalid') {
    return {
      kind: 'active', init: state.init,
      view: create(state.init, configuration),
      configuration, configurationFailure: null,
    }
  }
  if (state.kind === 'active') {
    reconfigure(state.view, configuration)
    return { ...state, configuration, configurationFailure: null }
  }
  return state
}

export function updateInitialInvalidContent<TView, TInit extends { readonly content: string }>(
  state: ConfigurationState<TView, TInit>,
  content: string,
): ConfigurationState<TView, TInit> {
  if (state.kind !== 'initial-invalid') return state
  return { ...state, init: { ...state.init, content } }
}
