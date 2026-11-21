# ReadFlow

[简体中文](README.md)

ReadFlow is an open-source Chrome extension for saving articles and videos, keeping a reading queue, and organizing useful links, tags, and notes in your own library.

**Saving requires a connected, self-hosted ReadFlow service.** The project provides server source code, and your library is stored in your SQLite database.

## Feature checklist

- [x] **Read Later**: Save links and browse unread and read items.
- [x] **Reference**: Create folders and subfolders, then find items by type, tag, or star.
- [x] **Tags and notes**: Edit from the list. New or edited notes have a 140-character limit.
- [x] **CSV export**: Download saved items, tags, notes, and folder paths from Settings.
- [ ] **Agent reading reviews** (pending)

## Install the Chrome extension

Use Chrome 106 or later. Download the extension ZIP or repository source and extract it to a permanent folder. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`. To update, replace the files in the same folder and click **Reload**.

**Set up the service with your agent**: Give it the repository and the configuration steps below. Once you have an HTTPS service URL, pair the extension in Settings to start saving.

[Configuration steps for your agent](SETUP.en.md#instructions-for-the-configuring-agent) · [Full setup guide](SETUP.en.md)

## Repository structure

| File or directory | Purpose |
| --- | --- |
| `src/`, `icons/`, `manifest.json` | Chrome extension code, icons, and manifest. |
| `server/` | Self-hosted service, connection protocol, and admin commands. Start the service with `server/serve.mjs`. |
| `scripts/`, `package.json` | Commands for packaging, testing, and checks. |
| `test/`, `test-support/` | Automated tests and shared test fixtures. |
| [SETUP.en.md](SETUP.en.md) | Service configuration, pairing, backups, and upgrades. |
| [AGENTS.md](AGENTS.md) | Collaboration rules and product boundaries for coding agents. |
| [docs/](docs/) | Architecture and protocol reference. |
| [LICENSE](LICENSE) | The project's MIT license. It permits using, modifying, and distributing the code, provided copies retain the original copyright and license notices. |

## Version history

- **Unreleased · V0.4.3 local test**: Dark lists, folders, automatic refresh, and inline editing.
- **V0.4.3**: Updated the interface and installation instructions.
- **V0.4.2**: Simpler pairing and capture popup.
- **V0.4.1**: SQLite library and CSV export.

[Full changelog (Chinese)](CHANGELOG.md) · [Shrikhand font license](src/fonts/Shrikhand-OFL.txt) · [Bold Poster design reference](https://github.com/zarazhangrui/beautiful-html-templates/blob/main/templates/bold-poster/template.html)
