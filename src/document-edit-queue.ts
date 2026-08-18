export class DocumentEditQueue {
  private readonly tails = new Map<string, Promise<void>>()

  run(documentId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(documentId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.tails.set(documentId, current)
    const cleanup = () => {
      if (this.tails.get(documentId) === current) this.tails.delete(documentId)
    }
    void current.then(cleanup, cleanup)
    return current
  }
}
