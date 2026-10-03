# Mind Map

A mind-mapping app in plain HTML, CSS, and JavaScript — simple to run, but feature-rich. No libraries, no build step, no localStorage — your data lives in memory and is saved by exporting to JSON.

## Run

Open `index.html` in a browser, or serve it:

```bash
python3 -m http.server
```

## Features

- Unlimited canvas with pan and zoom-to-cursor
- Branches grow in all directions; drag to move, drop on another node to re-parent
- Add / delete / collapse branches
- Rich text nodes: formatting, lists, inline code, images (paste, drop, or file picker), editable tables
- Export / import maps as JSON

## Shortcuts

| Key | Action |
| --- | --- |
| `Tab` | Add child |
| `Enter` | Add sibling |
| `Del` | Delete node |
| `C` | Collapse / expand branch |
| `F2` | Rename node |
| Double-click | Edit rich text body |
| Wheel | Zoom |
| `?` | All shortcuts |
