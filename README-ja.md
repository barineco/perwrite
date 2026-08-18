# Perwrite

[English](README.md)

Perwrite は、VS Code と互換エディタ向けの Markdown エディタ拡張です。同じ編集面で Markdown を編集しながら、リッチな描画を確認できます。

次の内容を描画します。

- Mermaid の図と KaTeX の数式
- Shiki によるコードの強調表示
- GFM の表、タスクリスト、内部リンク

## 表示例

![Perwrite の描画例](https://raw.githubusercontent.com/barineco/perwrite/publish/docs/perwrite-rendering.png)

## 利用方法

1. VS Code または互換エディタへの Perwrite のインストール
2. Markdown ファイルの表示
3. 右上のボタンによる表示モードの切り替え
4. [`docs/perwrite-showcase.md`](./docs/perwrite-showcase.md) による対応構造の確認

```text
raw
rich
render
```

## 対応環境

- VS Code 1.120.0 以上
- VS Code 拡張機能 API に対応する互換エディタ

KaTeX が数式として解釈できない入力は置換せず、Markdown の通常テキストとして表示します。

## Mermaid 図

描画した Mermaid 図の右上にある半透明のアイコンから拡大表示を開けます。拡大表示ではアイコン操作、キーボード移動、ポインターによるドラッグ、ホイール移動、Ctrl / Meta とホイールによる拡大縮小を利用できます。

- `perwrite.mermaidLayout`: 配置方式。既定値は `elk`
- `perwrite.mermaidMaxEdges`: edge 数の上限。既定値は `1024`
- `perwrite.mermaidPanStep`: 矢印キーによる移動量 ( px )。既定値は `80`
- `perwrite.mermaidZoomStep`: ボタン、キー、ホイール 1 段の倍率。既定値は `1.5`

## コードブロックの折り返し

この設定は fenced code block の行を表示上で折り返します。

- 設定: `perwrite.codeBlockWrap`
- 既定値: `true` で文書幅に合わせて折り返し
- 無効時: `false` で論理行を保持し、コードブロック内を横スクロール

次の表示は既存の動作を維持します。

- inline code
- Mermaid
- KaTeX
- 表

## 開発

ビルド、検査、梱包の手順は [CONTRIBUTING.md](./CONTRIBUTING.md) にあります。

## ライセンス

Perwrite は [MIT ライセンス](./LICENSE) で配布します。
