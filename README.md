# multi-agent

複数の Claude Code セッションをブラウザから起動・監視・終了するツール。左サイドバーにエージェントを状態ごとにまとめて表示し、投入したプロンプトと今実行中の内容を並べる。クリックすると右側に xterm.js のターミナルが出る。

## 必要なもの

- Node.js 22 以上
- `claude` CLI（PATH 上にあること。`CLAUDE_BIN` で差し替え可能）

## 起動

```bash
npm install
npm run dev      # vite (5173) と server (8787) を同時に起動
```

http://localhost:5173 を開く。

本番向けにビルドしたものを単一ポートで動かす場合:

```bash
npm run build
npm run server   # http://localhost:8787
```

## 環境変数

| 変数 | 既定値 | 内容 |
| --- | --- | --- |
| `PORT` | `8787` | サーバのポート |
| `CLAUDE_BIN` | `claude` | 起動するエージェントのバイナリ |

## 仕組み

- 各エージェントは `node-pty` の擬似端末で `claude --session-id <uuid> --settings <一時ファイル>` として起動する。対話 TUI をそのままブラウザへ流すため、Agent SDK やヘッドレスモードは使わない。
- `--settings` で渡す一時ファイルには状態通知用の hook だけが入る。ユーザー自身の `~/.claude/settings.json` の設定は残る。
- hook は `server/hook-notify.mjs` を起動し、stdin の JSON を `POST /api/hook/:id` へ転送する。サーバはそれを `server/state.ts` の純関数で状態へ変換する。

| hook イベント | 状態 |
| --- | --- |
| `UserPromptSubmit` | 実行中（プロンプトを記録） |
| `PreToolUse` | 実行中（`Bash npm test` のようなサマリを表示） |
| `Notification` | 要対応（権限確認・入力待ち） |
| `Stop` | 完了 |
| `SessionEnd` | 終了 |

- 一覧の変化は SSE (`GET /api/events`)、ターミナルの入出力は WebSocket (`/ws?session=<id>`) で流す。
- セッションはサーバプロセスのメモリ上にだけ存在する。ブラウザを閉じても PTY は生き続け、再接続時に直近 200KB のスクロールバックを復元する。サーバを止めると全セッションが終了する。

## テスト

```bash
npm test        # vitest
npm run typecheck
```
