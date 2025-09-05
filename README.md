# Share

Drop a file in this application to share (and more)

<a href='https://flathub.org/apps/io.github.sigmasd.share'>
  <img width='240' alt='Download on Flathub' src='https://dl.flathub.org/assets/badges/flathub-badge-i-en.png'/>
</a>

## How it works

The application creates a local HTTP server when you share a file or text:

1. When you drop a file or paste content, the app starts a local HTTP server
2. A QR code is generated containing the server's URL (including your local IP
   address)
3. Anyone scanning the QR code can access the shared content through their web
   browser
4. For files, the receiver gets a direct download link
5. For directories, the receiver sees a browsable directory listing
6. For text content, the receiver sees the text directly in their browser

No additional software is needed on the receiving end - just a QR code scanner
and web browser.

## Usage

```
deno run --reload --allow-all https://raw.githubusercontent.com/sigmaSd/qr-share/master/src/main.ts
```

<img width="522" height="620" alt="image" src="https://github.com/user-attachments/assets/38a9717a-7afa-4a23-bb47-b9461a798aef" />
