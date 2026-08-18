import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import {
  ImagePreparationCoordinator,
  ImageStatusWidget,
  ImageWidget,
  imageDocumentGeneration,
} from '../webview/editor/image-widget'

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function decoded(source: string, resolvedSrc: string, documentGeneration: number) {
  return {
    source,
    resolvedSrc,
    documentGeneration,
    naturalWidth: 32,
    naturalHeight: 24,
  }
}

describe('画像準備の状態遷移', () => {
  it('load 完了後に decode と intrinsic geometry を含む ready を公開する', async () => {
    const loading = deferred<ReturnType<typeof decoded>>()
    const listener = vi.fn()
    const coordinator = new ImagePreparationCoordinator(async (source, resolvedSrc, generation) => {
      await loading.promise
      return decoded(source, resolvedSrc, generation)
    })

    expect(coordinator.prepare('image.png', 4)).toEqual({
      kind: 'pending', source: 'image.png', documentGeneration: 4,
    })
    coordinator.subscribe(listener)
    loading.resolve(decoded('image.png', 'image.png', 4))
    await loading.promise
    await Promise.resolve()

    expect(coordinator.prepare('image.png', 4)).toEqual({
      kind: 'ready', value: decoded('image.png', 'image.png', 4),
    })
    expect(listener).toHaveBeenCalledWith({ documentGeneration: 4, resolvedSrc: 'image.png' })
  })

  it('load、decode、geometry の失敗を failed と理由へ変換する', async () => {
    const coordinator = new ImagePreparationCoordinator(async () => {
      throw new Error('decode failed')
    })

    coordinator.prepare('broken.png', 2)
    await Promise.resolve()
    await Promise.resolve()

    expect(coordinator.prepare('broken.png', 2)).toEqual({
      kind: 'failed', source: 'broken.png', documentGeneration: 2, failure: 'decode failed',
    })
  })

  it('異なる文書 generation の完了を別の準備結果へ混入させない', async () => {
    const first = deferred<ReturnType<typeof decoded>>()
    const second = deferred<ReturnType<typeof decoded>>()
    const coordinator = new ImagePreparationCoordinator((_source, resolvedSrc, generation) =>
      generation === 1 ? first.promise : second.promise)

    coordinator.prepare('same.png', 1)
    coordinator.prepare('same.png', 2)
    first.resolve(decoded('same.png', 'same.png', 1))
    await Promise.resolve()
    second.resolve(decoded('same.png', 'same.png', 2))
    await Promise.resolve()

    expect(coordinator.prepare('same.png', 1)).toEqual({
      kind: 'ready', value: decoded('same.png', 'same.png', 1),
    })
    expect(coordinator.prepare('same.png', 2)).toEqual({
      kind: 'ready', value: decoded('same.png', 'same.png', 2),
    })
  })

  it('準備結果の identity が入力と異なる場合を公開しない', async () => {
    const coordinator = new ImagePreparationCoordinator(async () => decoded('other.png', 'other.png', 8))

    coordinator.prepare('image.png', 7)
    await Promise.resolve()
    await Promise.resolve()

    expect(coordinator.prepare('image.png', 7)).toEqual({
      kind: 'pending', source: 'image.png', documentGeneration: 7,
    })
  })

  it('画像 Widget は decode 済み値と document generation を比較する', () => {
    const first = new ImageWidget(decoded('image.png', 'image.png', 1), 'alt', 0, 10)
    const same = new ImageWidget(decoded('image.png', 'image.png', 1), 'alt', 0, 10)
    const newer = new ImageWidget(decoded('image.png', 'image.png', 2), 'alt', 0, 10)
    const movedSource = new ImageWidget(decoded('image.png', 'image.png', 1), 'alt', 5, 15)
    expect(first.eq(same)).toBe(true)
    expect(first.eq(newer)).toBe(false)
    expect(first.eq(movedSource)).toBe(false)
    expect(new ImageStatusWidget('image.png', 'pending').eq(new ImageStatusWidget('image.png', 'failed'))).toBe(false)
  })

  it('文書 generation は文書変更だけで増加する', () => {
    const state = EditorState.create({ doc: 'before', extensions: [imageDocumentGeneration] })
    expect(state.field(imageDocumentGeneration)).toBe(0)
    const selection = state.update({ selection: { anchor: 1 } }).state
    expect(selection.field(imageDocumentGeneration)).toBe(0)
    const changed = selection.update({ changes: { from: 0, to: 1, insert: 'after' } }).state
    expect(changed.field(imageDocumentGeneration)).toBe(1)
  })
})
