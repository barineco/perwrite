import type { HostMessage } from '../src/protocol'

export interface HostFailureDisplay {
  readonly title: string
  readonly detail: string
  readonly actions?: readonly { readonly label: string; readonly run: () => void }[]
}

export function deriveHostFailureDisplay(message: HostMessage): HostFailureDisplay | null {
  if (message.type !== 'edit-result' || message.result.ok) return null
  const error = message.result.error
  return {
    title: `Edit ${error.editId} failed`,
    detail: `${error.kind}: ${error.reason}`,
  }
}

export function handleHostResult(
  message: HostMessage,
  sink: (display: HostFailureDisplay | null) => void,
): void {
  if (message.type === 'edit-result') sink(deriveHostFailureDisplay(message))
}
