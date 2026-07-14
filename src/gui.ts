import {
  Align,
  Application,
  ApplicationFlags,
  Box,
  Button,
  Clipboard,
  CssProvider,
  Cursor,
  Display,
  DragAction,
  DropTarget,
  EventControllerKey,
  FileDialog,
  FileFilter,
  G_TYPE_STRING,
  GestureClick,
  Key,
  Label,
  License,
  MenuButton,
  ModifierType,
  Orientation,
  Picture,
  PopoverMenu,
  StyleContext,
  StyleProviderPriority,
} from "@sigmasd/gtk/gtk4";
import {
  AboutDialog,
  AdwApplicationWindow,
  Clamp,
  HeaderBar,
  ToolbarView,
} from "@sigmasd/gtk/adw";
import { ListStore, Menu, SimpleAction } from "@sigmasd/gtk/gio";
import {
  Priority,
  timeout,
  UnixSignal,
  unixSignalAdd,
} from "@sigmasd/gtk/glib";
import { EventLoop } from "@sigmasd/gtk/eventloop";
import { createSharedArchive } from "./archive.ts";
import meta from "../deno.json" with { type: "json" };

export interface GuiOptions {
  port: number;
  path?: string;
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

export function runGui(options: GuiOptions) {
  const worker = new Worker(
    new URL("./main.worker.ts", import.meta.url).href,
    { type: "module" },
  );
  const qrPath = Deno.makeTempFileSync();
  let eventLoop: EventLoop | null = null;

  class MainWindow extends AdwApplicationWindow {
    #app: Application;
    #url: string;
    #label: Label;
    #picture: Picture;
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
    // verify !
    #notificationLabel!: Label;
    #receivedCount: number = 0;

    constructor(app: Application, url: string, initialPath?: string) {
      super(app);
      this.#app = app;
      this.#url = url;
      this.setTitle("Share");
      this.setDefaultSize(400, 400);
      this.setResizable(false);
      this.onCloseRequest(() => this.#onCloseRequest());

      this.#createShortcuts();

      this.#clipboard = Display.getDefault()!.getClipboard();

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
        StyleProviderPriority.APPLICATION,
      );

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
      this.#contentBox.append(this.#notificationLabel);

      const clamp = new Clamp();
      clamp.setMaximumSize(450);
      clamp.setChild(this.#contentBox);

      const header = this.#createHeaderBar();
      const toolbarView = new ToolbarView();
      toolbarView.addTopBar(header);
      toolbarView.setContent(clamp);
      this.setContent(toolbarView);

      const strDrop = new DropTarget(G_TYPE_STRING, DragAction.COPY);
      strDrop.onTextDrop((text, _x, _y) => {
        if (!text) return false;
        this.#onUriDrop(text);
        return true;
      });
      this.addController(strDrop);

      const uriDrop = DropTarget.newForMimeTypes(
        ["text/uri-list"],
        DragAction.COPY,
      );
      uriDrop.onTextDrop((text, _x, _y) => {
        if (!text) return false;
        this.#onUriDrop(text);
        return true;
      });
      this.addController(uriDrop);

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

      timeout(500, () => {
        this.#urlLabel.setText(originalText);
        this.#urlLabel.getStyleContext().removeClass("success-color");
        return false;
      });
    };

    showNotification = (message: string) => {
      this.#notificationLabel.setText(message);
      this.#notificationLabel.getStyleContext().addClass("success-color");
      this.#notificationLabel.setVisible(true);

      timeout(3000, () => {
        this.#notificationLabel.setVisible(false);
        return false;
      });
    };

    notifyFileReceived = (name: string) => {
      this.#receivedCount++;
      this.showNotification(`✓ Received: ${name}`);
      if (this.#isReceiveMode) {
        this.#statusIndicator.setText(
          `📥 Received ${this.#receivedCount} file${
            this.#receivedCount > 1 ? "s" : ""
          }`,
        );
      }
    };

    notifyTransferComplete = (count: number, size: number) => {
      const sizeStr = size >= 1048576
        ? `${(size / 1048576).toFixed(1)} MB`
        : size >= 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${size} B`;
      this.showNotification(
        `✓ Received ${count} file${count > 1 ? "s" : ""} (${sizeStr})`,
      );
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

      this.#notificationLabel = new Label("");
      this.#notificationLabel.setHalign(Align.CENTER);
      this.#notificationLabel.setVisible(false);

      this.#downloadDir = getDownloadDir();

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
        this.#receivedCount = 0;
        worker.postMessage({
          type: "set-receive-mode",
          enabled: true,
        });
        worker.postMessage({
          type: "set-download-dir",
          path: this.#downloadDir,
        });
      } else {
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
      action.connect("activate", () => callback());

      this.#app.addAction(action);
      if (shortcuts) this.#app.setAccelsForAction(`app.${name}`, shortcuts);
    };

    #openFileDialog = () => {
      const dialog = new FileDialog();
      dialog.setTitle("Select a file to share");

      const filters = new ListStore(FileFilter.getType());

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
            const file = source.openFinish(result);
            if (!file) return;
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
            const file = source.selectFolderFinish(result);
            if (!file) return;
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
      dialog.setLicenseType(License.MIT_X11);
      dialog.setWebsite("https://github.com/sigmaSd/Share");
      dialog.setIssueUrl(
        "https://github.com/sigmaSd/Share/issues",
      );
      dialog.setApplicationIcon("io.github.sigmasd.share");

      dialog.present(this);
    };

    #onUriDrop = async (text: string): Promise<boolean> => {
      const paths = text.split(/\r?\n/).filter(Boolean).map((line) =>
        line.startsWith("file://") ? decodeURIComponent(line.slice(7)) : line
      );
      if (paths.length === 0) return false;

      const sharedPath = await this.#sharePaths(paths);
      if (!sharedPath) return false;

      const name = sharedPath.split("/").pop() ?? "";
      this.#label.setText(
        paths.length > 1
          ? `archive: ${name} (${paths.length} files)`
          : `file: ${name}`,
      );
      this.#isReceiveMode = false;
      this.#updateSharingUI();
      worker.postMessage({ type: "file", path: sharedPath });
      if (paths.length > 1) {
        this.showNotification(`✓ Sharing ${paths.length} files`);
      }
      return true;
    };

    #sharePaths = async (paths: string[]): Promise<string | null> => {
      try {
        return await createSharedArchive(paths);
      } catch (e) {
        console.warn("archive failed:", e);
        return null;
      }
    };

    #onKeyPressed = (
      keyval: number,
      _keycode: number,
      state: number,
    ) => {
      const ctrl =
        (state & ModifierType.CONTROL_MASK) === ModifierType.CONTROL_MASK;
      const shift =
        (state & ModifierType.SHIFT_MASK) === ModifierType.SHIFT_MASK;

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
        Priority.DEFAULT,
        null,
        (source, result) => this.#onClipboardRead(source, result),
      );
    };

    #onClipboardRead = (
      clipboard: Clipboard,
      result: Deno.PointerValue,
    ) => {
      const [_inputStream, mimeType] = clipboard.readFinish(result);
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

    #onTextReceived = async (
      clipboard: Clipboard,
      result: Deno.PointerValue,
      mimeType: string,
    ) => {
      const text = clipboard.readTextFinish(result);
      if (!text) {
        console.warn("No text found in clipboard");
        return;
      }

      this.#isReceiveMode = false;
      this.#updateSharingUI();

      let paths: string[] | null = null;

      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

      if (mimeType.startsWith("text/uri-list")) {
        paths = lines.filter((line) => line.startsWith("file://"))
          .map((uri) => decodeURIComponent(uri.slice(7)))
          .filter(canAccessFile);
      }

      if (!paths || paths.length === 0) {
        const accessible = lines.filter((l) =>
          l.startsWith("/") && canAccessFile(l)
        );
        if (accessible.length > 0 && accessible.length === lines.length) {
          paths = accessible;
        }
      }

      if (paths && paths.length > 0) {
        const sharedPath = await this.#sharePaths(paths);
        if (sharedPath) {
          const name = sharedPath.split("/").pop() ?? "file";
          this.#label.setText(
            paths.length > 1
              ? `archive: ${name} (${paths.length} files)`
              : `file: ${name}`,
          );
          worker.postMessage({ type: "file", path: sharedPath });
          if (paths.length > 1) {
            this.showNotification(`✓ Sharing ${paths.length} files`);
          }
          return;
        }
      }

      this.#label.setText(
        `text: ${text.length > 30 ? `${text.slice(0, 30)} ...` : text}`,
      );
      worker.postMessage({ type: "text", content: text });
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
      eventLoop?.stop();
      worker.terminate();
      try {
        Deno.removeSync(qrPath);
      } catch { /* Ignore error if file not found */ }
      return false;
    };
  }

  let currentWindow: MainWindow | undefined;

  class App extends Application {
    #url: string;
    #initialPath: string | undefined;

    constructor(appId: string, url: string, initialPath?: string) {
      super(appId, ApplicationFlags.NONE);
      this.#url = url;
      this.#initialPath = initialPath;
      this.onActivate(() => this.onActivateCallback());
    }

    onActivateCallback = () => {
      const win = new MainWindow(
        this,
        this.#url,
        this.#initialPath,
      );
      currentWindow = win;
      win.present();
    };
  }

  worker.postMessage({
    type: "init",
    qrPath,
    port: options.port,
    path: options.path,
    verbose: true,
  });

  worker.addEventListener("message", async (event) => {
    const data = event.data as { type: string; [key: string]: unknown };
    switch (data.type) {
      case "start": {
        const app = new App(
          "io.github.sigmasd.share",
          data.url as string,
          options.path,
        );
        eventLoop = new EventLoop();
        unixSignalAdd(
          UnixSignal.SIGINT,
          () => {
            worker.terminate();
            try {
              Deno.removeSync(qrPath);
            } catch { /* Ignore error if file not found */ }
            eventLoop?.stop();
            return false;
          },
        );
        await eventLoop.start(app);
        break;
      }
      case "file-received": {
        const filePath = data.path as string;
        const name = filePath.split("/").pop() ?? "";
        if (currentWindow) {
          currentWindow.notifyFileReceived(name);
        }
        break;
      }
      case "transfer-complete": {
        if (currentWindow) {
          currentWindow.notifyTransferComplete(
            (data.count as number) || 0,
            (data.size as number) || 0,
          );
        }
        break;
      }
    }
  });
}
