import type { ChangeSet } from '@codemirror/state'
import type { TextChange } from '../../src/protocol'

export function changeSetToTextChanges(changes: ChangeSet): readonly TextChange[] {
  const result: TextChange[] = []
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    result.push({ from, to, insert: inserted.toString() })
  })
  return result
}
