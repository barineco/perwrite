import { WidgetType } from '@codemirror/view'

export class ListBulletWidget extends WidgetType {
  constructor(readonly level: number) { super() }

  eq(other: ListBulletWidget): boolean {
    return this.level === other.level
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-list-bullet'
    span.textContent = this.level % 3 === 0 ? '•' : this.level % 3 === 1 ? '◦' : '▪'
    return span
  }
}

export class ListNumberWidget extends WidgetType {
  constructor(readonly marker: string) { super() }

  eq(other: ListNumberWidget): boolean {
    return this.marker === other.marker
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-list-number'
    span.textContent = this.marker
    return span
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super() }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked
  }

  ignoreEvent(): boolean { return false }

  toDOM(): HTMLElement {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.className = 'cm-task-checkbox'
    cb.setAttribute('aria-label', this.checked ? 'completed' : 'todo')
    return cb
  }
}
