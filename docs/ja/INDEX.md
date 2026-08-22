# Perwrite の文書

Perwrite は、一つのエディタで Markdown の入力と描画を扱う VS Code 拡張です。この索引から、ドラフトを保持する文書編集の仕組みと、対応する Markdown の表示例を確認できます。

## 仕組み

仕組みの説明では、ドラフトの保持、保存操作、外部ファイル変更の観測、Backup からの復元を扱います。

- [ドラフトを保持する文書編集](architecture/overview.md)

## 表示例

表示例では、対応する Markdown 構造を表示モードごとに確認できます。

- [Markdown の表示例](../perwrite-showcase.md)

表示モードは次の三つです。

```text
raw
rich
render
```

日本語版と英語版は同じ実装を説明します。記載する事実はソースコードの型、状態遷移、検査によって確定します。
