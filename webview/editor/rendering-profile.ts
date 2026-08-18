import { Compartment, Facet, StateEffect, StateField, type Extension } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { RenderingProfile } from '../../src/protocol'
import { mathExtension } from './markdown-math-extension'
import { wikilinkExtension } from './markdown-wikilink-extension'
import { frontmatterExtension } from './markdown-frontmatter-extension'
import { codeBlockWrappingExtensions, reconfigureCodeBlockWrapping } from './code-block-wrapping'

const initialRenderingProfile = Facet.define<RenderingProfile, RenderingProfile>({
  combine: values => values[values.length - 1],
})

export const setRenderingProfileEffect = StateEffect.define<RenderingProfile>()

export const renderingProfileField = StateField.define<RenderingProfile>({
  create(state) { return state.facet(initialRenderingProfile) },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRenderingProfileEffect)) return effect.value
    }
    return value
  },
})

const markdownParserCompartment = new Compartment()

export function markdownParser(configuration: RenderingProfile): Extension {
  return markdown({
    base: markdownLanguage,
    addKeymap: false,
    extensions: [
      GFM,
      ...(configuration.texRendering ? mathExtension : []),
      ...wikilinkExtension,
      ...frontmatterExtension,
    ],
  })
}

export function renderingProfileExtensions(
  configuration: RenderingProfile,
  reportFailure: (reason: string) => void = () => undefined,
): Extension {
  return [
    initialRenderingProfile.of(configuration),
    renderingProfileField,
    codeBlockWrappingExtensions(configuration, reportFailure),
    markdownParserCompartment.of(markdownParser(configuration)),
  ]
}

export function reconfigureRendering(configuration: RenderingProfile): StateEffect<unknown>[] {
  return [
    setRenderingProfileEffect.of(configuration),
    reconfigureCodeBlockWrapping(configuration),
    markdownParserCompartment.reconfigure(markdownParser(configuration)),
  ]
}
