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
5. Files are automatically saved to your Downloads folder (configurable)

**Key Features:**

- **No additional software needed** - just a QR code scanner and web browser
- **Directory support** - Upload/download entire folder structures
- **Multiple file uploads** - Batch upload many files at once (receive mode)
- **Local network only** - All transfers happen locally, no internet required

## Usage

```bash
deno run --reload --allow-all https://raw.githubusercontent.com/sigmaSd/qr-share/master/src/main.ts
```

## Keyboard Shortcuts

- **`Ctrl+O`** - Open file to share
- **`Ctrl+Shift+O`** - Open directory to share
- **`Ctrl+V`** - Paste content (text, images, or file paths)
- **`Ctrl+T`** - Toggle sharing on/off
- **`Ctrl+R`** - Toggle receive mode
- **`Ctrl+Q/Ctrl+W`** - Quit application

<img width="522" height="620" alt="image" src="https://github.com/user-attachments/assets/38a9717a-7afa-4a23-bb47-b9461a798aef" />
