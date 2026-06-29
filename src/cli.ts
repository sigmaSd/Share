import { qrcode } from "@libs/qrcode";
import meta from "../deno.json" with { type: "json" };

export interface CliOptions {
  port: number;
  path?: string;
  receive: boolean;
}

function getDownloadDir(): string {
  try {
    return new TextDecoder().decode(
      new Deno.Command("xdg-user-dir", { args: ["DOWNLOAD"] })
        .outputSync()
        .stdout,
    ).trim();
  } catch {
    return "/tmp";
  }
}

function formatShared(label: string, value: string): string {
  const maxLen = 50;
  const display = value.length > maxLen ? value.slice(0, maxLen) + "…" : value;
  return `${label}: ${display}`;
}

function statusSymbol(sharing: boolean, receiving: boolean): string {
  if (receiving) return sharing ? "●" : "○";
  return sharing ? "●" : "○";
}

function statusText(sharing: boolean, receiving: boolean): string {
  if (receiving) {
    return "Receive Mode" +
      (sharing ? " (Sharing Active)" : " (Sharing Stopped)");
  }
  return sharing ? "Sharing Active" : "Sharing Stopped";
}

export async function runCli(options: CliOptions) {
  const worker = new Worker(
    new URL("./main.worker.ts", import.meta.url).href,
    { type: "module" },
  );
  const qrPath = Deno.makeTempFileSync();

  let url = "";
  let isSharing = true;
  let isReceiveMode = options.receive;
  const downloadDir = getDownloadDir();
  const notifications: string[] = [];
  let sharedItem = "";

  worker.postMessage({
    type: "init",
    qrPath,
    port: options.port,
    path: options.path ?? null,
    verbose: false,
  });

  if (isReceiveMode) {
    sharedItem = "Waiting for files…";
    worker.postMessage({ type: "set-receive-mode", enabled: true });
    worker.postMessage({ type: "set-download-dir", path: downloadDir });
  } else if (options.path) {
    const name = options.path.split("/").pop() ?? "";
    try {
      const isDir = Deno.statSync(options.path).isDirectory;
      sharedItem = isDir ? `directory: ${name}` : `file: ${name}`;
    } catch {
      sharedItem = `file: ${name}`;
    }
  }

  function sendFile(path: string) {
    isReceiveMode = false;
    const name = path.split("/").pop() ?? "";
    sharedItem = `file: ${name}`;
    worker.postMessage({ type: "set-receive-mode", enabled: false });
    worker.postMessage({ type: "file", path });
  }

  function sendText(content: string) {
    isReceiveMode = false;
    sharedItem = formatShared("text", content);
    worker.postMessage({ type: "set-receive-mode", enabled: false });
    worker.postMessage({ type: "text", content });
  }

  function toggleSharing() {
    isSharing = !isSharing;
    worker.postMessage({ type: isSharing ? "start-sharing" : "stop-sharing" });
  }

  function toggleReceiveMode() {
    isReceiveMode = !isReceiveMode;
    worker.postMessage({
      type: "set-receive-mode",
      enabled: isReceiveMode,
    });
    if (isReceiveMode) {
      sharedItem = "Waiting for files…";
      worker.postMessage({ type: "set-download-dir", path: downloadDir });
    } else if (!sharedItem.startsWith("Waiting")) {
      sharedItem = "";
    }
  }

  function cleanup() {
    worker.postMessage({ type: "stop-sharing" });
    worker.terminate();
    try {
      Deno.removeSync(qrPath);
    } catch { /* ignore */ }
  }

  const startPromise = new Promise<string>((resolve) => {
    worker.addEventListener("message", (event) => {
      switch (event.data.type) {
        case "start":
          resolve(event.data.url);
          break;
        case "file-received": {
          const path = event.data.path;
          const name = path.split("/").pop();
          notifications.push(`✓ Received: ${name}`);
          if (notifications.length > 5) notifications.shift();
          if (typeof printScreen === "function") printScreen();
          break;
        }
      }
    });
  });

  url = await startPromise;

  function renderQr(url: string): string {
    try {
      const matrix = qrcode(url, { output: "array", ecl: "MEDIUM" });
      const size = matrix.length;
      const lines: string[] = [];
      for (let y = 0; y < size; y += 2) {
        let line = "\x1b[47m\x1b[30m";
        for (let x = 0; x < size; x++) {
          const top = matrix[y][x];
          const bottom = y + 1 < size ? matrix[y + 1][x] : false;
          if (top && bottom) line += "\u2588";
          else if (top && !bottom) line += "\u2580";
          else if (!top && bottom) line += "\u2584";
          else line += " ";
        }
        line += "\x1b[0m";
        lines.push(line);
      }
      return lines.join("\n");
    } catch {
      return "";
    }
  }

  const qrString = renderQr(url);

  let termWidth = 60;
  try {
    termWidth = Deno.consoleSize().columns;
  } catch { /* ignore */ }
  function printScreen() {
    const title = `Share v${meta.version} — Terminal Mode`;
    const bar = "─".repeat(Math.min(termWidth, 60));

    console.clear();
    console.log(`┌${bar}┐`);
    console.log(`│ ${title.padEnd(bar.length - 1)}│`);
    console.log(`│ URL: ${url.padEnd(bar.length - 6)}│`);
    console.log(`└${bar}┘`);

    if (qrString) {
      const qrLines = qrString.split("\n");
      for (const line of qrLines) {
        console.log(`  ${line}`);
      }
      console.log();
    }

    console.log(
      `  ${statusSymbol(isSharing, isReceiveMode)} ${
        statusText(isSharing, isReceiveMode)
      }`,
    );
    if (sharedItem) {
      console.log(`  ${sharedItem}`);
    }
    if (isReceiveMode) {
      console.log(`  Saving to: ~/${downloadDir.split("/").pop()}`);
    }
    if (notifications.length > 0) {
      console.log();
      for (const n of notifications) {
        console.log(`  ${n}`);
      }
    }
    console.log();
    console.log(`  ${dim("s")} toggle sharing    ${dim("f")} share file`);
    console.log(`  ${dim("t")} share text        ${dim("r")} toggle receive`);
    console.log(`  ${dim("q")} quit`);
    console.log();
  }

  function dim(text: string): string {
    return `\x1b[2m${text}\x1b[22m`;
  }

  printScreen();

  const isTty = Deno.stdin.isTerminal();

  const readChar = (): Promise<string> => {
    const buf = new Uint8Array(1);
    return Deno.stdin.read(buf).then(() => new TextDecoder().decode(buf));
  };

  const readLine = (prompt: string): Promise<string | null> => {
    if (isTty) Deno.stdin.setRaw(false);
    Deno.stdout.writeSync(new TextEncoder().encode(prompt));
    const buf = new Uint8Array(4096);
    return Deno.stdin.read(buf).then((n) => {
      if (isTty) Deno.stdin.setRaw(true);
      if (n === null) return null;
      return new TextDecoder().decode(buf.subarray(0, n)).trimEnd();
    });
  };

  if (isTty) Deno.stdin.setRaw(true);

  const shutdown = (msg?: string) => {
    if (isTty) Deno.stdin.setRaw(false);
    cleanup();
    if (msg) console.log(`\r\n${msg}`);
    Deno.exit(0);
  };

  try {
    while (true) {
      if (!isTty) {
        // Non-TTY mode: just print info and wait for worker to finish
        await new Promise(() => {});
      }

      const char = await readChar();

      switch (char) {
        case "s":
          toggleSharing();
          printScreen();
          break;

        case "r":
          toggleReceiveMode();
          printScreen();
          break;

        case "f": {
          const input = await readLine(
            "\r\nEnter file path (empty to cancel): ",
          );
          if (input && input.length > 0) {
            const trimmed = input.trim();
            try {
              Deno.statSync(trimmed);
              sendFile(trimmed);
            } catch {
              console.log(`\r\n  File not accessible: ${trimmed}`);
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
          printScreen();
          break;
        }

        case "t": {
          const input = await readLine(
            "\r\nEnter text to share (empty to cancel): ",
          );
          if (input && input.trim().length > 0) {
            sendText(input.trim());
          }
          printScreen();
          break;
        }

        case "q":
          shutdown("Bye!");
      }
    }
  } catch (error) {
    if (isTty) Deno.stdin.setRaw(false);
    cleanup();
    console.error("\r\nError:", error);
    Deno.exit(1);
  }
}
