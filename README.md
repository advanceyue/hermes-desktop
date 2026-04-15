# Hermes Desktop

One-click desktop installer for [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research.

**Download DMG → Drag to Applications → Open → Start chatting.**

No Python, Node.js, or terminal setup required.

## Features

- Bundled Python 3.11 + Node.js 22 + ripgrep — zero system dependencies
- [hermes-webui](https://github.com/nesquena/hermes-webui) as the chat interface
- Setup wizard for first-time API key configuration
- System tray with background running
- Auto-updater support
- CLI wrapper (`hermes` command) for terminal access

## Supported Providers

- Anthropic (Claude)
- OpenAI
- Google Gemini
- OpenRouter
- DeepSeek

## Architecture

```
Hermes Desktop (Electron)
├── Electron Main Process
│   ├── WebUI Server subprocess (Python → hermes-webui on :8787)
│   └── BrowserWindow (loads http://localhost:8787)
├── Bundled Resources
│   ├── python/      (standalone Python 3.11)
│   ├── venv/        (hermes-agent + dependencies)
│   ├── runtime/     (Node.js 22 for browser tools)
│   ├── tools/       (ripgrep binary)
│   └── webui/       (hermes-webui source)
└── User Data → ~/.hermes/
```

## Building from Source

### Prerequisites

- Node.js >= 22
- [hermes-agent](https://github.com/NousResearch/hermes-agent) cloned at `~/.hermes/hermes-agent`
- [hermes-webui](https://github.com/nesquena/hermes-webui) cloned at `~/code/hermes-webui`

### Build

```bash
# Install dependencies
npm install

# Package resources (downloads Python, Node.js, ripgrep, installs hermes-agent)
npm run package:resources -- --platform darwin --arch arm64

# Compile TypeScript
npm run build

# Build macOS DMG
npm run dist:mac:arm64
```

Output: `out/darwin-arm64/HermesDesktop-{version}-arm64.dmg`

### Custom Source Paths

```bash
HERMES_AGENT_DIR=/path/to/hermes-agent \
HERMES_WEBUI_DIR=/path/to/hermes-webui \
npm run package:resources
```

### Windows (experimental)

```bash
npm run dist:win:x64
```

> Note: `package:resources` must run on Windows (or in a Windows Docker container) to download platform-specific binaries.

## Configuration

All user configuration is stored in `~/.hermes/`:

- `config.yaml` — Model and agent settings
- `.env` — API keys
- `auth.json` — OAuth credentials (Codex, etc.)

These files are shared with the CLI version of Hermes Agent.

## Credits

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research
- [hermes-webui](https://github.com/nesquena/hermes-webui) by nesquena
- Built with [Electron](https://www.electronjs.org/) and [electron-builder](https://www.electron.build/)

## License

MIT
