# Durable document editing

Perwrite keeps the editable draft in one custom document shared by every view of the same Markdown file. Typing, undo, and redo update that draft. Saving is the operation that writes the draft to the file system.

## Document state

The custom document keeps four related values:

- saved snapshot: the last file content confirmed by Perwrite
- draft snapshot: the content and selection currently being edited
- external change: newer file content observed while the draft has changes
- generation: the sequence number used to order view messages

The dirty state is calculated by comparing the saved and draft content hashes. A separate mutable dirty flag is unnecessary.

## Editing

A view sends each edit with its document identity, generation, previous content hash, text changes, and selection. The custom document validates those values before replacing the draft snapshot.

Every accepted edit becomes a VS Code custom-document edit event. The event retains the snapshots before and after the edit. VS Code undo and redo restore those snapshots and publish the result to every open view.

The editor view supplies text input and selection. The custom document supplies the shared draft and edit history.

## Saving

Saving follows one file-system path:

1. Read the physical file.
2. Compare it with the saved snapshot.
3. Write the draft when the comparison succeeds.
4. Read the file again.
5. Accept the save when the observed content matches the draft.

A successful save updates the saved snapshot and clears the external-change value. A failed save preserves the draft, selection, and edit history.

## External file changes

An external file observation has two outcomes.

- clean document: adopt the observed file as both saved and draft content, then update every view
- changed draft: retain the draft and store the observed file as an external change

This separation lets file watchers refresh an unchanged editor immediately while preserving active writing during a conflict.

## Backup and restoration

VS Code backup data contains:

- document URI
- saved content and hash
- draft content
- selection
- generation

Opening from a backup validates the stored structure and hash. When the physical file still matches the saved snapshot, Perwrite restores the draft directly. When the file has changed, Perwrite restores the draft and records the physical file as an external change.

## Multiple views

Every view of the same Markdown file refers to one custom document. An edit from any view updates the shared draft and is published to all views with the same generation. Closing or recreating a panel leaves the custom document unchanged.

Git comparison uses read-only snapshots for commits and the index. A working-tree side reads the shared draft, so comparison and ordinary editing present the same unsaved content.

## File-system access

File reads, guarded writes, post-write observations, and backup storage are implemented in one persistence module. The document state receives Perwrite snapshots and failure values rather than file-system exceptions.

The save failures distinguish these cases:

- external modification conflict
- permission denial
- missing file
- write failure
- written content mismatch
- observation failure

## Preserved properties

The design preserves the following properties:

- typing, undo, and redo leave the physical file unchanged
- a successful save writes the current draft
- a failed save retains the draft and edit history
- a clean external change updates every view
- an external change during editing retains the draft
- panel recreation retains the draft and selection
- backup restoration retains unsaved work across restart
- multiple views share draft, undo, and redo

The implementation entry points are listed below.

```text
src/perwrite-document-state.ts
src/document-persistence.ts
src/perwrite-document.ts
src/editor-provider.ts
webview/index.ts
```
