#!/usr/bin/env -S deno run --allow-all --unstable-ffi
import {
  Application,
  Box,
  Button,
  Clipboard,
  CssProvider,
  Cursor,
  Display,
  DropTarget,
  EventControllerKey,
  FileDialog,
  FileFilter,
  GestureClick,
  Label,
  MenuButton,
  Picture,
  PopoverMenu,
  StyleContext,
  typeFromName,
  unixSignalAdd,
} from "@sigmasd/gtk/gtk";
import {
  AboutDialog,
  AdwApplicationWindow,
  Clamp,
  HeaderBar,
  ToolbarView,
} from "@sigmasd/gtk/adw";
import { File as GFile, ListStore, Menu, SimpleAction } from "@sigmasd/gtk/gio";
import {
  Align,
  DragAction,
  Key,
  ModifierType,
  Orientation,
} from "@sigmasd/gtk/enums";
import { timeout } from "@sigmasd/gtk/glib";
import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path/resolve";
import meta from "../deno.json" with { type: "json" };

const worker = new Worker(new URL("./main.worker.ts", import.meta.url).href, {
  type: "module",
});
const qrPath = Deno.makeTempFileSync();

class MainWindow extends AdwApplicationWindow {
  #app: Application;
  #url: string;
  #label: Label;
  #picture: Picture;
  #dropTarget: DropTarget;
  #contentBox: Box;
  #clipboard: Clipboard;
  #urlBox!: Box;
  #urlLabel!: Label;
  #copyButton!: Button;
  #shareButton!: Button;
  #statusIndicator!: Label;
  #isSharing: boolean = true;
  #receiveButton!: Button;
  #isReceiveMode: boolean = false;
  #downloadDir: string = "";

  constructor(app: Application, url: string, initialPath?: string) {
    super(app);
    this.#app = app;
    this.#url = url;
    this.setTitle("Share");
    this.setDefaultSize(400, 400);
    this.setResizable(false);
    this.onCloseRequest(() => this.#onCloseRequest());

    this.#createShortcuts();

    // Initialize clipboard
    this.#clipboard = Display.getDefault()!.getClipboard();

    // Apply CSS to the window
    const cssProvider = new CssProvider();
    cssProvider.loadFromData(`
.instruction-label {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}
.content-box {
  padding: 2rem;
}
.qr-card {
  background-color: white;
  padding: 1rem;
  border-radius: 1rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  margin-bottom: 1.5rem;
}
.url-box {
  background-color: alpha(@window_fg_color, 0.05);
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid alpha(@window_fg_color, 0.1);
  margin-bottom: 1.5rem;
}
.url-label {
  font-family: monospace;
  font-size: 1rem;
}
.controls-box {
  margin-top: 1rem;
}
.status-indicator {
  margin-top: 1.5rem;
  padding: 0.5rem 1rem;
  border-radius: 2rem;
  font-weight: 600;
}
.status-active {
  background-color: alpha(@success_bg_color, 0.2);
  color: @success_color;
}
.status-inactive {
  background-color: alpha(@error_bg_color, 0.2);
  color: @error_color;
}
.success-color {
  color: @success_color;
}
`);
    StyleContext.addProviderForDisplay(
      Display.getDefault()!,
      cssProvider,
      600, // STYLE_PROVIDER_PRIORITY_APPLICATION
    );

    // Add CSS class to the window
    this.getStyleContext().addClass("main-window");

    this.#label = new Label("Drop file or Ctrl+V to paste");
    this.#label.getStyleContext().addClass("instruction-label");

    this.#picture = new Picture();
    this.#picture.setFilename(qrPath);
    this.#picture.setSizeRequest(240, 240);
    this.#picture.setKeepAspectRatio(true);

    const qrCard = new Box(Orientation.VERTICAL, 0);
    qrCard.getStyleContext().addClass("qr-card");
    qrCard.setHalign(Align.CENTER);
    qrCard.append(this.#picture);

    this.#createUrlBox();
    this.#createShareControls();

    const controlsBox = new Box(Orientation.VERTICAL, 0);
    controlsBox.getStyleContext().addClass("controls-box");
    controlsBox.setSpacing(10);
    controlsBox.append(this.#shareButton);
    controlsBox.append(this.#receiveButton);

    this.#contentBox = new Box(Orientation.VERTICAL, 0);
    this.#contentBox.getStyleContext().addClass("content-box");
    this.#contentBox.setValign(Align.CENTER);
    this.#contentBox.append(this.#label);
    this.#contentBox.append(qrCard);
    this.#contentBox.append(this.#urlBox);
    this.#contentBox.append(controlsBox);
    this.#contentBox.append(this.#statusIndicator);

    const clamp = new Clamp();
    clamp.setMaximumSize(450);
    clamp.setChild(this.#contentBox);

    // Set up the ToolbarView with header and content
    const header = this.#createHeaderBar();
    const toolbarView = new ToolbarView();
    toolbarView.addTopBar(header);
    toolbarView.setContent(clamp);
    this.setContent(toolbarView);

    // Use GFile type for drop target
    // Note: We need GType for GFile. "GFile" name should work.
    // If not, we might need to resolve it properly.
    // Assuming typeFromName works or we fallback to 0 (invalid) which might accept anything?
    // Using 0 usually means G_TYPE_INVALID.
    const fileType = typeFromName("GFile") || 0n;
    this.#dropTarget = new DropTarget(
      fileType,
      DragAction.COPY,
    );
    this.#dropTarget.onDrop((val, x, y) => this.#onDrop(val, x, y));
    this.addController(this.#dropTarget);

    // Add key event controller for Ctrl+V
    const keyController = new EventControllerKey();
    keyController.onKeyPressed((k, c, s) => this.#onKeyPressed(k, c, s));
    this.addController(keyController);

    if (initialPath) {
      const fileName = initialPath.split("/").pop();
      try {
        const isDir = Deno.statSync(initialPath).isDirectory;
        this.#label.setText(
          isDir ? `directory: ${fileName}` : `file: ${fileName}`,
        );
        this.#isReceiveMode = false;
        this.#updateSharingUI();
      } catch (e) {
        console.error("Failed to stat initial path:", e);
      }
    }
  }

  #showCopyFeedback = () => {
    const originalText: string = this.#urlLabel.getText();
    this.#urlLabel.setText("Copied to clipboard!");
    this.#urlLabel.getStyleContext().addClass("success-color");

    // Use timeout from glib.ts
    timeout(500, () => {
      this.#urlLabel.setText(originalText);
      this.#urlLabel.getStyleContext().removeClass("success-color");
      return false;
    });
  };

  #createUrlBox = () => {
    this.#urlBox = new Box(Orientation.HORIZONTAL, 10);
    this.#urlBox.setHalign(Align.CENTER);

    this.#urlLabel = new Label(this.#url);
    this.#urlLabel.getStyleContext().addClass("url-label");
    this.#urlLabel.setCursor(Cursor.newFromName("default", null));

    const labelClick = new GestureClick();
    labelClick.onReleased(() => {
      this.#clipboard.set(this.#url);
      this.#showCopyFeedback();
    });
    this.#urlLabel.addController(labelClick);

    this.#copyButton = new Button("");
    this.#copyButton.setIconName("edit-copy-symbolic");
    this.#copyButton.setTooltipText("Copy URL");
    this.#copyButton.getStyleContext().addClass("flat");
    this.#copyButton.onClick(() => {
      this.#clipboard.set(this.#url);
      this.#showCopyFeedback();
    });

    this.#urlBox.append(this.#urlLabel);
    this.#urlBox.append(this.#copyButton);

    this.#urlBox.setVisible(true);
    this.#urlBox.getStyleContext().addClass("url-box");
  };

  #createShareControls = () => {
    this.#shareButton = new Button("Stop Sharing");
    this.#shareButton.getStyleContext().addClass("pill");
    this.#shareButton.setTooltipText("Toggle sharing on/off (Ctrl+T)");
    this.#shareButton.onClick(() => {
      this.#toggleSharing();
    });

    this.#receiveButton = new Button("Receive Mode");
    this.#receiveButton.getStyleContext().addClass("pill");
    this.#receiveButton.setTooltipText("Toggle receive mode (Ctrl+R)");
    this.#receiveButton.onClick(() => {
      this.#toggleReceiveMode();
    });

    this.#statusIndicator = new Label("● Sharing Active");
    this.#statusIndicator.getStyleContext().addClass("status-indicator");
    this.#statusIndicator.setHalign(Align.CENTER);

    // Initialize download directory
    this.#downloadDir = getDownloadDir();

    // Update initial UI state
    this.#updateSharingUI();
  };

  #updateSharingUI = () => {
    if (this.#isSharing) {
      this.#shareButton.setLabel("Stop Sharing");
      this.#shareButton.getStyleContext().removeClass("suggested-action");
      this.#shareButton.getStyleContext().addClass("destructive-action");
      this.#statusIndicator.getStyleContext().removeClass("status-inactive");
      this.#statusIndicator.getStyleContext().addClass("status-active");
    } else {
      this.#shareButton.setLabel("Start Sharing");
      this.#shareButton.getStyleContext().removeClass("destructive-action");
      this.#shareButton.getStyleContext().addClass("suggested-action");
      this.#statusIndicator.getStyleContext().removeClass("status-active");
      this.#statusIndicator.getStyleContext().addClass("status-inactive");
    }

    this.#shareButton.setVisible(true);

    if (this.#isReceiveMode) {
      this.#receiveButton.setLabel("Exit Receive Mode");
      this.#receiveButton.getStyleContext().addClass("destructive-action");
      this.#statusIndicator.setText(
        this.#isSharing
          ? "📥 Receiving Files (Sharing Active)"
          : "📥 Receiving Files (Sharing Stopped)",
      );
      this.#label.setText(
        `Saving to: ${this.#downloadDir.split("/").pop()}`,
      );
    } else {
      this.#receiveButton.setLabel("Receive Mode");
      this.#receiveButton.getStyleContext().removeClass(
        "destructive-action",
      );
      this.#statusIndicator.setText(
        this.#isSharing ? "● Sharing Active" : "● Sharing Stopped",
      );
    }
  };

  #toggleSharing = () => {
    this.#isSharing = !this.#isSharing;
    this.#updateSharingUI();

    if (this.#isSharing) {
      worker.postMessage({ type: "start-sharing" });
    } else {
      worker.postMessage({ type: "stop-sharing" });
    }
  };

  #toggleReceiveMode = () => {
    this.#isReceiveMode = !this.#isReceiveMode;

    if (this.#isReceiveMode) {
      // Enable receive mode
      worker.postMessage({
        type: "set-receive-mode",
        enabled: true,
      });
      worker.postMessage({
        type: "set-download-dir",
        path: this.#downloadDir,
      });
    } else {
      // Disable receive mode
      worker.postMessage({
        type: "set-receive-mode",
        enabled: false,
      });
      this.#label.setText("Drop file or Ctrl+V to paste");
    }

    this.#updateSharingUI();
  };

  #createHeaderBar = () => {
    const header = new HeaderBar();
    // menu
    const menu = new Menu();
    const popover = new PopoverMenu();
    popover.setMenuModel(menu);
    const hamburger = new MenuButton();
    hamburger.setPrimary(true);
    hamburger.setPopover(popover);
    hamburger.setIconName("open-menu-symbolic");
    hamburger.setTooltipText("Main Menu");
    header.packStart(hamburger);

    menu.append("Open File (Ctrl+O)", "app.open-file");
    menu.append("Open Directory (Ctrl+Shift+O)", "app.open-directory");
    menu.append("Toggle Sharing (Ctrl+T)", "app.toggle-sharing");
    menu.append("Toggle Receive Mode (Ctrl+R)", "app.toggle-receive");
    menu.append("About Share", "app.about");

    return header;
  };

  #createShortcuts = () => {
    this.#createAction(
      "quit",
      () => {
        this.#onCloseRequest();
        this.#app.quit();
      },
      ["<primary>q"],
    );
    this.#createAction(
      "close",
      () => {
        this.#onCloseRequest();
        this.#app.quit();
      },
      ["<primary>w"],
    );
    this.#createAction(
      "open-file",
      () => {
        this.#openFileDialog();
      },
      ["<primary>o"],
    );
    this.#createAction(
      "open-directory",
      () => {
        this.#openDirectoryDialog();
      },
      ["<primary><shift>o"],
    );
    this.#createAction(
      "toggle-sharing",
      () => {
        this.#toggleSharing();
      },
      ["<primary>t"],
    );
    this.#createAction(
      "toggle-receive",
      () => {
        this.#toggleReceiveMode();
      },
      ["<primary>r"],
    );

    this.#createAction("about", () => this.#showAbout());
  };

  #createAction = (
    name: string,
    callback: () => void,
    shortcuts?: string[],
  ) => {
    const action = new SimpleAction(name);
    // @ts-ignore: Assuming GObject has connect
    action.connect("activate", () => callback());

    this.#app.addAction(action);
    if (shortcuts) this.#app.setAccelsForAction(`app.${name}`, shortcuts);
  };

  #openFileDialog = () => {
    const dialog = new FileDialog();
    dialog.setTitle("Select a file to share");

    const filters = new ListStore(typeFromName("GtkFileFilter") || 0n);

    const allFilesFilter = new FileFilter();
    allFilesFilter.setName("All Files");
    allFilesFilter.addPattern("*");
    filters.append(allFilesFilter);

    const imageFilter = new FileFilter();
    imageFilter.setName("Images");
    imageFilter.addMimeType("image/*");
    filters.append(imageFilter);

    const textFilter = new FileFilter();
    textFilter.setName("Text Files");
    textFilter.addMimeType("text/*");
    filters.append(textFilter);

    dialog.setFilters(filters);
    dialog.setDefaultFilter(allFilesFilter);

    dialog.open(
      this,
      null,
      (source, result) => {
        try {
          // source is FileDialog, result is AsyncResult
          // openFinish returns GObject (GFile)
          const fileObj = source.openFinish(result);
          // wrap in GFile
          const file = new GFile(fileObj.ptr);
          const filePath = file.getPath();
          const fileName = filePath?.split("/").pop();

          if (fileName && filePath) {
            this.#label.setText(`file: ${fileName}`);
            this.#isReceiveMode = false;
            this.#updateSharingUI();
            worker.postMessage({ type: "file", path: filePath });
          }
        } catch (error) {
          console.log("File dialog cancelled or error:", error);
        }
      },
    );
  };

  #openDirectoryDialog = () => {
    const dialog = new FileDialog();
    dialog.setTitle("Select a directory to share");

    dialog.selectFolder(
      this,
      null,
      (source, result) => {
        try {
          const fileObj = source.selectFolderFinish(result);
          const file = new GFile(fileObj.ptr);
          const dirPath = file.getPath();
          const dirName = dirPath?.split("/").pop();

          if (dirName && dirPath) {
            this.#label.setText(`directory: ${dirName}`);
            this.#isReceiveMode = false;
            this.#updateSharingUI();
            worker.postMessage({ type: "file", path: dirPath });
          }
        } catch (error) {
          console.log("Directory dialog cancelled or error:", error);
        }
      },
    );
  };

  #showAbout = () => {
    const dialog = new AboutDialog();

    dialog.setApplicationName("Share");
    dialog.setVersion(meta.version);
    dialog.setDeveloperName("Bedis Nbiba");
    dialog.setDevelopers(["Bedis Nbiba <bedisnbiba@gmail.com>"]);
    dialog.setLicenseType(7); // MIT_X11 = 7 usually? Need to check enum or use number.
    // GTK_LICENSE_MIT_X11 is 7.
    dialog.setWebsite("https://github.com/sigmaSd/Share");
    dialog.setIssueUrl(
      "https://github.com/sigmaSd/Share/issues",
    );
    dialog.setApplicationIcon("io.github.sigmasd.share");

    dialog.present(this);
  };

  #onDrop = (value: Deno.PointerValue, _x: number, _y: number) => {
    // value is GObject pointer (GFile)
    if (!value) return false;
    const file = new GFile(value);

    let filePath;
    let fileName;

    const path = file.getPath();
    if (path) {
      filePath = path;
      fileName = filePath.split("/").pop() ?? null;
    } else {
      // Handle file without a path
      const [success, contents] = file.loadContents();
      if (success) {
        fileName = "Dropped File";
        filePath = Deno.makeTempFileSync();
        Deno.writeFile(
          filePath,
          contents,
        );
      } else {
        console.warn("Failed to read contents of the dropped file");
        return false;
      }
    }

    if (!fileName || !filePath) {
      console.warn("Could not detect filename from this file");
      return false;
    }

    this.#label.setText(`file: ${fileName}`);
    this.#isReceiveMode = false;
    this.#updateSharingUI();
    worker.postMessage({ type: "file", path: filePath });
    return true;
  };

  #onKeyPressed = (
    keyval: number,
    _keycode: number,
    state: number,
  ) => {
    const ctrl =
      (state & ModifierType.CONTROL_MASK) === ModifierType.CONTROL_MASK;
    const shift = (state & ModifierType.SHIFT_MASK) === ModifierType.SHIFT_MASK;

    if (keyval === Key.v && ctrl) {
      this.#handlePaste();
      return true;
    }
    if (keyval === Key.o && ctrl) {
      if (shift) {
        this.#openDirectoryDialog();
      } else {
        this.#openFileDialog();
      }
      return true;
    }
    if (keyval === Key.t && ctrl) {
      this.#toggleSharing();
      return true;
    }
    if (keyval === Key.r && ctrl) {
      this.#toggleReceiveMode();
      return true;
    }
    return false;
  };

  #handlePaste = () => {
    this.#clipboard.readAsync(
      [
        "text/uri-list",
        "text/plain",
        "text/plain;charset=utf-8",
        "image/png",
      ],
      0, // PRIORITY_DEFAULT
      null,
      (source, result) => this.#onClipboardRead(source, result),
    );
  };

  #onClipboardRead = (
    clipboard: Clipboard,
    result: Deno.PointerValue,
  ) => {
    const [_inputStream, mimeType] = clipboard.readFinish(result);
    // mimeType is string
    if (mimeType.startsWith("text/")) {
      clipboard.readTextAsync(
        null,
        (source, res) => this.#onTextReceived(source, res, mimeType),
      );
    } else if (mimeType.startsWith("image/")) {
      clipboard.readTextureAsync(
        null,
        (source, res) => this.#onImageReceived(source, res),
      );
    } else {
      console.warn("Unsupported clipboard content type:", mimeType);
    }
  };

  #onTextReceived = (
    clipboard: Clipboard,
    result: Deno.PointerValue,
    mimeType: string,
  ) => {
    const text = clipboard.readTextFinish(result);
    if (text) {
      this.#isReceiveMode = false;
      this.#updateSharingUI();
      if (mimeType.startsWith("text/uri-list") || text.startsWith("file://")) {
        const filePath = text.replace("file://", "").trim();
        const fileName = filePath.split("/").pop();
        if (canAccessFile(filePath)) {
          this.#label.setText(`file: ${fileName || "Pasted file"}`);
          worker.postMessage({ type: "file", path: filePath });
        } else {
          this.#label.setText(`text: ${fileName || "Pasted file"}`);
          worker.postMessage({ type: "text", content: text });
        }
      } else if (mimeType.startsWith("text/plain")) {
        this.#label.setText(
          `text: ${text.length > 30 ? (`${text.slice(0, 30)} ...`) : text}`,
        );
        worker.postMessage({ type: "text", content: text });
      }
    } else {
      console.warn("No text found in clipboard");
    }
  };

  // deno-lint-ignore no-explicit-any
  #onImageReceived = (clipboard: Clipboard, result: any) => {
    const texture = clipboard.readTextureFinish(result);
    if (texture) {
      this.#label.setText("image: Pasted image");
      this.#isReceiveMode = false;
      this.#updateSharingUI();
      const tempFilePath = Deno.makeTempFileSync({ suffix: ".png" });
      texture.saveToPng(tempFilePath);
      worker.postMessage({ type: "file", path: tempFilePath });
    } else {
      console.warn("No image found in clipboard");
    }
  };

  #onCloseRequest = () => {
    worker.postMessage({ type: "stop-sharing" });
    worker.terminate();
    try {
      Deno.removeSync(qrPath);
    } catch { /* Ignore error if file not found */ }
    return false;
  };
}

class App extends Application {
  #win: MainWindow | undefined;
  #url: string;
  #initialPath: string | undefined;

  constructor(appId: string, url: string, initialPath?: string) {
    super(appId, 0); // flags=0
    this.#url = url;
    this.#initialPath = initialPath;
    this.onActivate(() => this.onActivateCallback());
  }

  onActivateCallback = () => {
    this.#win = new MainWindow(
      this,
      this.#url,
      this.#initialPath,
    );
    this.#win.present();
  };
}

// Helper for timeout

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["help"],
    string: ["port", "path"],
    default: { port: "0" },
  });

  if (args.help) {
    console.log(`Share ${meta.version}
Share files and text locally via QR code.

Usage:
  share [options]

Options:
  --help        Show this help message
  --port <port> Port to listen on (default: random)
  --path <path> Path to share (file or directory)
`);
    Deno.exit(0);
  }

  const port = parseInt(args.port, 10);
  const path = args.path ? resolve(args.path) : undefined;

  worker.postMessage({ type: "init", qrPath, port, path });
  worker.onmessage = (event) => {
    console.log("[main] received msg:", event.data);
    switch (event.data.type) {
      case "start": {
        const app = new App(
          "io.github.sigmasd.share",
          event.data.url,
          path,
        );
        unixSignalAdd(
          2, // SIGINT
          () => {
            worker.terminate();
            try {
              Deno.removeSync(qrPath);
            } catch { /* Ignore error if file not found */ }
            app.quit();
            return false;
          },
        );
        app.run([]);
        break;
      }
    }
  };
}

function canAccessFile(path: string) {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
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
