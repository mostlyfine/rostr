# multi-agent

複数の Claude Code セッションをブラウザから起動・監視・終了するツール。左サイドバーにエージェントを状態ごとにまとめて表示し、投入したプロンプトと今実行中の内容を並べる。クリックすると右側に xterm.js のターミナルが出る。

## 必要なもの

- Node.js 22 以上
- `claude` CLI（PATH 上にあること。`CLAUDE_BIN` で差し替え可能）
- `tmux`（任意。あるとサーバを再起動してもエージェントが生き残る。無ければ従来どおり直接起動する）

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
| `MA_TMUX` | （自動判定） | `0` にすると tmux を使わず直接起動する |

## 仕組み

- 各エージェントは `node-pty` の擬似端末で `claude --session-id <uuid> --settings <一時ファイル>` として起動する。対話 TUI をそのままブラウザへ流すため、Agent SDK やヘッドレスモードは使わない。
- tmux があるときは、その擬似端末が繋ぐ先を tmux セッション（`tmux -L multi-agent`、セッション名 `ma-<uuid>`）にする。エージェント本体を持つのは tmux サーバなので、Node のサーバは一時的に attach しているクライアントでしかない。
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
- ブラウザを閉じても PTY は生き続け、再接続時に直近 200KB のスクロールバックを復元する。

### 過去のやり取りを遡る

ターミナル上でホイールを上に回すと、それより前の出力へ遡れる。

- tmux があるときは tmux の履歴（10 万行）を読む。ホイールを上に回した時点で copy-mode に入り、最下部まで戻ると自動で抜けて通常の入力に戻る。途中でやめたいときは `q` を押す。copy-mode 中は矢印キーと PageUp / PageDown でも動かせる。
- 遡る操作は tmux の既定のキーバインドがそのまま担当する。こちらで足しているのは `mouse on` だけで、キーバインドは一つも触っていない。
- マウス操作を tmux 側で受けるようになるので、ドラッグは tmux の選択（copy-mode）になる。ブラウザ側で文字を選択してコピーしたいときは Option（Mac）または Shift を押しながらドラッグする。
- tmux が無い環境、または `MA_TMUX=0` のときは xterm.js 側のスクロールバック（1 万行）を遡る。

### tmux によるプロセスの永続化

tmux があると、サーバを止めても・落ちてもエージェントは動き続ける。次の起動時に `tmux list-sessions` から `ma-` で始まるセッションを拾い直し、attach し直して一覧に戻す。

- ユーザー個人の tmux サーバや `~/.tmux.conf` には触らない。専用ソケット `-L multi-agent` と専用の最小設定ファイルだけを使う。その設定では prefix を無効化してあるので、`C-b` などのキーは tmux に吸われず Claude の TUI にそのまま届く。キーボードのキーは一つも奪っていない。
- 設定ファイルは tmux サーバの起動時にしか読まれないため、セッションを作るときと復元するときに `source-file` で読み直させる。既にエージェントを抱えたまま動いているサーバにも、エージェントを落とさずに新しい設定が届く。
- 復元できるのは作業ディレクトリと作成時刻まで。状態・プロンプト・実行中の内容は hook 由来なので復元時は「待機中」に戻り、次の hook イベントで追いつく。
- セッションが終わるのは、一覧の `x` で閉じたときと、`claude` 自身が終了したとき。
- tmux が無い環境、または `MA_TMUX=0` のときは直接起動にフォールバックする。この場合はサーバを止めると全セッションが終了する。

```bash
tmux -L multi-agent ls        # 生きているエージェントを直接確認する
```

## テスト

```bash
npm test        # vitest
npm run typecheck
```
