import { describe, expect, it } from 'vitest'
import { DocumentEditQueue } from '../src/document-edit-queue'

describe('DocumentEditQueue', () => {
  it('serializes edits for one physical document while allowing another document to proceed', async () => {
    const queue = new DocumentEditQueue()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>(resolve => { releaseFirst = resolve })

    const first = queue.run('file:///same.md', async () => {
      events.push('first-start')
      await firstBlocked
      events.push('first-end')
    })
    const second = queue.run('file:///same.md', async () => { events.push('second') })
    const independent = queue.run('file:///other.md', async () => { events.push('independent') })

    await independent
    expect(events).toEqual(['first-start', 'independent'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first-start', 'independent', 'first-end', 'second'])
  })

  it('continues the document queue after a failed edit', async () => {
    const queue = new DocumentEditQueue()
    const failed = queue.run('file:///same.md', async () => { throw new Error('failed') })
    const next = queue.run('file:///same.md', async () => undefined)
    await expect(failed).rejects.toThrow('failed')
    await expect(next).resolves.toBeUndefined()
  })
})
