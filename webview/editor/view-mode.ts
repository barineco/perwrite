import { StateField, StateEffect, Facet, type EditorState } from '@codemirror/state'

export type ViewMode = 'raw' | 'rich' | 'render'

export type Presentation = ViewMode

export interface ViewModeProfile {
  readonly mode: ViewMode
  readonly presentation: Presentation
  readonly editable: boolean
}

export const viewModeProfiles: readonly ViewModeProfile[] = [
  { mode: 'raw', presentation: 'raw', editable: true },
  { mode: 'rich', presentation: 'rich', editable: true },
  { mode: 'render', presentation: 'render', editable: true },
]

const profileByMode: ReadonlyMap<ViewMode, ViewModeProfile> = new Map(
  viewModeProfiles.map(profile => [profile.mode, profile]),
)

export function profileFor(mode: ViewMode): ViewModeProfile {
  const profile = profileByMode.get(mode)
  if (!profile) throw new Error(`Unknown view mode: ${mode}`)
  return profile
}

const cycleOrder: readonly ViewMode[] = ['raw', 'rich', 'render']

export function cycleViewMode(mode: ViewMode): ViewMode {
  const index = cycleOrder.indexOf(mode)
  return cycleOrder[(index + 1) % cycleOrder.length]
}

export const initialViewMode = Facet.define<ViewMode, ViewMode>({
  combine: values => values.length > 0 ? values[values.length - 1] : 'render',
})

export const setViewModeEffect = StateEffect.define<ViewMode>()

export const viewModeField = StateField.define<ViewMode>({
  create(state) { return state.facet(initialViewMode) },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setViewModeEffect)) return e.value
    }
    return value
  },
})

export function currentProfile(state: EditorState): ViewModeProfile {
  return profileFor(state.field(viewModeField))
}
