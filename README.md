# Share

Drop a file to share or receive files from others

<a href='https://flathub.org/apps/io.github.sigmasd.share'>
  <img width='240' alt='Download on Flathub' src='https://dl.flathub.org/assets/badges/flathub-badge-i-en.png'/>
</a>

## How it works

Share supports **bidirectional file transfer** - you can both send and receive
files:

### 📤 **Sharing Mode** (Send files to others)

1. Drop a file or paste content into the app
2. A QR code is generated containing your local server's URL
3. Others scan the QR code to download your files through their web browser
4. For files, they get a direct download link
5. For directories, they see a browsable directory listing
6. For text content, they see the text directly in their browser

### 📥 **Receive Mode** (Receive files from others)

1. Click "Receive Mode" or press `Ctrl+R`
2. Share the QR code with others
3. They scan it and get an upload interface in their web browser
4. They can drag & drop files/folders or click to browse and select
5. Files are automatically saved to your Downloads folder

**Key Features:**

- **No additional software needed** - just a QR code scanner and web browser
- **Directory support** - Upload/download entire folder structures
- **Multiple file uploads** - Batch upload many files at once (receive mode)
- **Local network only** - All transfers happen locally, no internet required

## GUI Usage

```bash
deno run --reload --allow-all --unstable-ffi https://raw.githubusercontent.com/sigmaSd/qr-share/master/src/main.ts
```

## CLI Mode (Terminal)

Run without a graphical interface — useful over SSH, on servers, or in any
terminal:

```bash
deno run --reload --allow-all --unstable-ffi https://raw.githubusercontent.com/sigmaSd/qr-share/master/src/main.ts --cli
```

Options:

- **\`--cli\`** — Run in terminal mode (no GUI required)
- **\`--port <port>\`** — Port to listen on, `0` for random (default: the port
  set in Preferences, `53318` unless changed)
- **\`--receive\`** — Start in receive mode (only with \`--cli\`)
- **\`--help\`** — Show help message

Arguments:

- **\`path\`** — Path to share (file or directory) (optional)

CLI keyboard shortcuts:

| Key | Action                    |
| --- | ------------------------- |
| `s` | Toggle sharing on/off     |
| `r` | Toggle receive mode       |
| `f` | Share a file (enter path) |
| `t` | Share text (enter text)   |
| `v` | Paste clipboard content   |
| `p` | Re-print QR code          |
| `q` | Quit                      |

## Keyboard Shortcuts (GUI)

- **`Ctrl+O`** - Open file to share
- **`Ctrl+Shift+O`** - Open directory to share
- **`Ctrl+V`** - Paste content (text, images, or file paths)
- **`Ctrl+T`** - Toggle sharing on/off
- **`Ctrl+R`** - Toggle receive mode
- **`Ctrl+,`** - Preferences
- **`Ctrl+Q/Ctrl+W`** - Quit application

## Firewall

Share listens on port `53318` by default, so it only needs to be allowed once.
The port can be changed (or set to random) in Preferences. On Fedora and other
systems using firewalld:

```bash
sudo firewall-cmd --permanent --add-port=53318/tcp
sudo firewall-cmd --reload
```

If the port is already taken by another app, Share falls back to a random port
and tells you.

<img width="522" height="692" alt="image" src="https://github.com/user-attachments/assets/93e66598-38df-4b0d-890c-1a519d42163d" />
