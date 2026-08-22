import { Facet } from '@codemirror/state'

export type LinkActivation = (destination: string) => void

export const linkActivation = Facet.define<LinkActivation | null, LinkActivation | null>({
  combine: values => values.at(-1) ?? null,
})
