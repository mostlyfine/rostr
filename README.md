# rostr

A tool for launching, monitoring, and ending multiple Claude Code sessions from the browser. The left sidebar groups agents by state and shows a one-line summary of what the conversation is about, the prompt you submitted, and what the agent is currently running. Clicking an agent opens an xterm.js terminal on the right.

## Requirements

- Node.js 22 or later
- The `claude` CLI (must be on `PATH`; override it with `CLAUDE_BIN`)
- `tmux` (optional. With it, agents survive a server restart. Without it, agents are spawned directly as before.)

## Quick start (no clone)

Run rostr directly from GitHub without cloning it into a project:

```bash
npx github:mostlyfine/rostr
```

The first run clones the repository, installs dependencies, builds the
frontend, and starts the server on http://127.0.0.1:8787 (override with
`PORT`). npm caches the resolved package under `~/.npm/_npx`, so subsequent
runs with the same ref skip the rebuild and start immediately.

To pin a specific branch, tag, or commit:

```bash
npx github:mostlyfine/rostr
npx github:mostlyfine/rostr#v0.2.0
```

The requirements above still apply, and the environment variables below
(`PORT`, `CLAUDE_BIN`, `ROSTR_TMUX`) work the same way. This project is not
published to the npm registry on purpose; the GitHub reference above is the
only supported install method.

## Getting started

```bash
npm install
npm run dev      # runs vite (5173) and the server (8787) together
```

Open http://localhost:5173.

To run a production build on a single port:

```bash
npm run build
npm run server   # http://localhost:8787
```

`npm run server` only serves the `dist/` snapshot produced by the last
`npm run build`; it does not rebuild on its own. Re-run `npm run build` after
any client-side change, or use `npm run dev` (http://localhost:5173) instead,
which picks up changes via Vite's HMR.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Server port |
| `CLAUDE_BIN` | `claude` | Binary launched for each agent |
| `ROSTR_TMUX` | (auto-detected) | Set to `0` to skip tmux and spawn directly |
| `ROSTR_SUMMARY` | `1` | Set to `0` to stop generating sidebar summaries |
| `ROSTR_SUMMARY_MODEL` | `haiku` | Model used for the sidebar summary |

## How it works

- Each agent runs in a `node-pty` pseudo terminal as `claude --session-id <uuid> --settings <temp file>`. The interactive TUI is streamed to the browser as-is, so neither the Agent SDK nor headless mode is used.
- When tmux is available, that pseudo terminal attaches to a tmux session instead (socket `rostr`, session name `rostr-<uuid>`). The tmux server owns the agent process, so the Node server is only a client that happens to be attached.
- The temp file passed to `--settings` contains nothing but the hooks used for state notifications. Your own `~/.claude/settings.json` stays in effect.
- Each hook runs `server/hook-notify.mjs`, which forwards the JSON on stdin to `POST /api/hook/:id`. The server turns that into a state via the pure functions in `server/state.ts`.

| Hook event | State |
| --- | --- |
| `SessionStart` | Idle (clears the prompt and activity of the previous conversation) |
| `UserPromptSubmit` | Running (records the prompt) |
| `PreToolUse` | Running (shows a summary such as `Bash npm test`) |
| `Notification` | Needs attention (permission prompt or waiting for input) |
| `Stop` | Done |
| `SessionEnd` | Ended |

- No state is final; any later event overwrites it. That includes "Ended". Moving to a worktree or running `/clear` ends only the conversation while the agent stays alive, and it fires `SessionEnd` — pinning that state would leave a still-running row frozen forever. When an agent really does exit, the PTY closing removes its row from the list.

- List changes are streamed over SSE (`GET /api/events`), and terminal I/O over WebSocket (`/ws?session=<id>`).
- Closing the browser leaves the PTY running; reconnecting restores the most recent 200KB of scrollback.

### Sidebar summaries

Each time an agent finishes a turn (`Stop`), the conversation JSONL that Claude Code reports through `transcript_path` is read and the last few turns are piped into `claude -p --model haiku`. The model answers with a short phrase describing what the user is trying to accomplish, and that phrase becomes the summary line in the sidebar.

- Only the last 5 user turns (600 chars each) and the most recent assistant turn (160 chars) are sent, so the input stays small no matter how long the conversation grows.
- One generation runs per agent at a time. A `Stop` that arrives while one is still running is dropped rather than queued, and a generation that takes longer than 30 seconds is killed.
- `SessionStart` (which `/clear` and moving to a worktree both fire) clears the summary and invalidates any generation still in flight, so a summary from the previous conversation never reappears.
- Failures are silent. The previous summary stays on screen and the next `Stop` tries again.
- Set `ROSTR_SUMMARY=0` to turn this off entirely; nothing else in the sidebar changes.

### Scrolling back through past output

Scrolling the wheel up in the terminal moves back through earlier output.

- With tmux, you are reading tmux's own history (100,000 lines). Scrolling up enters copy-mode, and scrolling back to the bottom leaves it automatically and returns to normal input. Press `q` to leave early. While in copy-mode, the arrow keys and PageUp / PageDown work too.
- Scrolling is handled entirely by tmux's default key bindings. The only thing added here is `mouse on`; not a single key binding is touched.
- Dragging still selects text in the browser: just drag and press `Cmd+C` (`Ctrl+Shift+C` elsewhere). xterm.js turns its selection off whenever an application asks for mouse reporting, so the browser swallows tmux's request and synthesizes the wheel events itself instead. The cost is that programs inside the session (vim, less, …) never see the mouse.
- Without tmux, or with `ROSTR_TMUX=0`, you scroll through xterm.js's own scrollback (10,000 lines).

### Inserting a newline in the prompt

Press `Shift+Enter` to insert a newline instead of submitting the prompt. In a browser the key would otherwise reach the agent as a plain Enter, so the terminal sends the `ESC` + `CR` sequence that `claude`'s own `/terminal-setup` configures for iTerm2 and VS Code. Plain `Enter` still submits.

### Changing the font size

Press `Cmd+Shift+ +` / `Cmd+Shift+ -` (`Ctrl` elsewhere) to scale every font — the sidebar, the dialogs, and the terminals — between 80% and 160% in steps of 10. `Cmd+Shift+0` goes back to 100%. The new size is shown briefly at the bottom of the screen and remembered in `localStorage`.

- `Shift` is part of every binding on purpose: the browser's own zoom is `Cmd` and `+` / `-` without it, and that keeps working as usual.
- The keys are caught before xterm.js sees them, so nothing reaches the agent or the shell.
- Terminals are resized to match, so the agent is told the new number of columns and rows.

### Process persistence with tmux

With tmux, agents keep running whether you stop the server or it crashes. On the next start, sessions whose names begin with `rostr-` are picked up from `tmux list-sessions`, re-attached, and put back in the list.

- Your personal tmux server and `~/.tmux.conf` are left alone. Only a dedicated socket (`-L rostr`) and a dedicated minimal config file are used. That config disables the prefix, so keys such as `C-b` are not swallowed by tmux and reach Claude's TUI directly. No keyboard key is taken away.
- Because a tmux server reads its config only at startup, the config is re-read with `source-file` when a session is created and when one is restored. That way a server already holding agents receives the new config without any of them being killed.
- Only the working directory and creation time can be restored. State, prompt, and current activity all come from hooks, so a restored agent starts as "Idle" and catches up on the next hook event.
- A session ends only when it is closed with `x` in the list, or when `claude` itself exits.
- Without tmux, or with `ROSTR_TMUX=0`, it falls back to spawning directly. In that case stopping the server ends every session.

```bash
tmux -L rostr ls        # inspect the live agents directly
```

### Migrating from the old name

This project used to be called `multi-agent`, and its tmux socket, session prefix, and environment variable were named accordingly. Agents started before the rename live on the old socket and are not picked up any more, although their processes keep running. Inspect them and shut the old server down once you no longer need them:

```bash
tmux -L multi-agent ls          # what is still running under the old name
tmux -L multi-agent kill-server # ends every one of them
```

`MA_TMUX` is now `ROSTR_TMUX`, so update any environment that still sets the old variable.

## Tests

```bash
npm test        # vitest
npm run typecheck
```
