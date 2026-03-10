# Warren

An [Obsidian](https://obsidian.md) plugin for exploring your vault by following note connections. Search your notes, dive into their links and backlinks, and navigate the trail of where you've been — with a graph view and a collection system for gathering and exporting what you find.

## Features

**Exploration**
- Search your vault and drill into any note to explore its connections
- Browse backlinks, outgoing links, or both simultaneously
- Yazi-style keyboard navigation (`h/j/k/l` or arrow keys) through notes and connections

**Trail bar**
- A persistent breadcrumb trail tracks every note you've visited in a session
- Navigate back and forward through your trail, or jump to any point
- Open the current note in a new Obsidian tab with one click

**Views**
- **Columns view** — parent context on the left, active connections in the middle, note preview on the right
- **Graph view** — scatter-plot graph of your notes, configurable by date, backlink count, word count, or total connections; node size is also configurable

**Collection**
- Collect notes as you explore with `C` or the collect button
- View all collected notes in a persistent sidebar
- Export collected notes as a tag batch, a Map of Content (MOC), or a plain list

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `↓` | Move selection down |
| `k` / `↑` | Move selection up |
| `l` / `→` | Drill into selected note |
| `h` / `←` | Go back in trail |
| `C` | Toggle collect on current note |
| `+` / `-` | Zoom in/out (graph view) |
| `0` | Reset zoom (graph view) |

## Commands

- **Open Warren** — open the Warren panel
- **Warren: Collect active note** — collect the currently open note from anywhere in Obsidian
- **Warren: Back in trail** — navigate back one step
- **Warren: Forward in trail** — navigate forward one step
- **Warren: Dive into search results** — import Obsidian's current search results into Warren

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Default link mode | Backlinks | Which links to show when drilling into a note |
| Default graph X axis | Created date | Initial X axis metric |
| Default graph Y axis | Backlink count | Initial Y axis metric |
| Default graph size by | Word count | Variable encoded in node size |
| Export tag prefix | `warren/` | Prefix applied when bulk-tagging collected notes |
| MOC folder | *(vault root)* | Where generated MOC files are saved |
| Persist exploration tree | On | Save and restore your trail between sessions |

## Installation

Warren is not yet listed in the Obsidian community plugin directory. To install manually:

1. Download the latest release
2. Copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/obsidian-warren/` in your vault
3. Enable the plugin in Obsidian's settings under **Community plugins**

## Development

```bash
npm install
npm run dev       # watch mode
npm run build     # production build
```

Requires Node.js. Built with TypeScript and the Obsidian API.

## License

GPL-3.0
