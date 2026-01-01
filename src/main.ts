#!/usr/bin/env -S deno run --allow-all --unstable-ffi
import {
  type Adw1_ as Adw_,
  Callback,
  type Gdk4_ as Gdk_,
  type Gio2_ as Gio_,
  type GLib2_ as GLib_,
  type Gtk4_ as Gtk_,
  kw,
  NamedArgument,
  python,
  // deno-lint-ignore no-import-prefix
} from "jsr:@sigma/gtk-py@0.11.0";
import meta from "../deno.json" with { type: "json" };

const gi = python.import("gi");
gi.require_version("Gtk", "4.0");
gi.require_version("Adw", "1");
const Gtk: Gtk_.Gtk = python.import("gi.repository.Gtk");
const Adw: Adw_.Adw = python.import("gi.repository.Adw");
const Gdk: Gdk_.Gdk = python.import("gi.repository.Gdk");
const GLib: GLib_.GLib = python.import("gi.repository.GLib");
const Gio: Gio_.Gio = python.import("gi.repository.Gio");

const worker = new Worker(new URL("./main.worker.ts", import.meta.url).href, {
  type: "module",
});
const qrPath = Deno.makeTempFileSync();

class MainWindow extends Adw.ApplicationWindow {
  #app: Adw_.Application;
  #url: string;
  #label: Gtk_.Label;
  #picture: Gtk_.Picture;
  #dropTarget: Gtk_.DropTarget;
  #contentBox: Gtk_.Box;
  #clipboard: Gdk_.Clipboard;
  #urlBox!: Gtk_.Box;
  #urlLabel!: Gtk_.Label;
  #copyButton!: Gtk_.Button;
  #shareButton!: Gtk_.Button;
  #statusIndicator!: Gtk_.Label;
  #isSharing: boolean = true;
  #receiveButton!: Gtk_.Button;
  #isReceiveMode: boolean = false;
  #downloadDir: string = "";

  constructor(kwArg: NamedArgument, url: string) {
    super(kwArg);
    this.#url = url;
    this.set_title("Share");
    this.set_default_size(400, 400);
    this.connect("close-request", this.#onCloseRequest);

    this.#app = kwArg.value.valueOf() as Adw_.Application;

    this.#createShortcuts();

    // Initialize clipboard
    this.#clipboard = Gdk.Display.get_default().get_clipboard();

    // Apply CSS to the window
    const cssProvider = Gtk.CssProvider();
    cssProvider.load_from_data(`\
.main-window {
  background-color: #f0f0f0;
}
.instruction-label {
  font-size: 18px;
  font-weight: bold;
  color: #333333;
  margin: 20px;
}
.content-box {
  background-color: #ffffff;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: 20px;
}
.url-box {
  font-size: 18px;
  font-weight: bold;
  color: #333333;
  margin-top: 10px;
  padding: 5px;
  background-color: #f5f5f5;
  border-radius: 5px;
}
.share-button {
  margin: 5px;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: bold;
  transition: all 0.2s ease;
  min-height: 40px;
}
.share-button.active {
  background-color: #28a745;
  color: white;
}
.share-button.inactive {
  background-color: #dc3545;
  color: white;
}
.receive-button {
  margin: 5px;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: bold;
  transition: all 0.2s ease;
  min-height: 40px;
}
.receive-button.active {
  background-color: #007bff;
  color: white;
}
.receive-button.inactive {
  background-color: #6c757d;
  color: white;
}
.status-indicator {
  font-size: 14px;
  font-weight: bold;
  margin: 5px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
}
.status-active {
  color: #28a745;
  background-color: rgba(40, 167, 69, 0.1);
}
.status-inactive {
  color: #dc3545;
  background-color: rgba(220, 53, 69, 0.1);
}
/* Ensure header bar is visible in light mode */
headerbar {
  background: @headerbar_bg_color;
  border-bottom: 1px solid @borders;
  box-shadow: inset 0 1px @headerbar_backdrop_color;
}`);
    Gtk.StyleContext.add_provider_for_display(
      Gdk.Display.get_default(),
      cssProvider,
      Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    // Add CSS class to the window
    this.get_style_context().add_class("main-window");

    this.#label = Gtk.Label(
      kw`label=${"Drop file or Ctrl+V to paste"}`,
    );
    this.#label.get_style_context().add_class("instruction-label");

    this.#picture = Gtk.Picture();
    this.#picture.set_filename(qrPath);
    this.#picture.set_size_request(200, 200);
    this.#picture.set_keep_aspect_ratio(true);

    this.#createUrlBox();
    this.#createShareControls();

    this.#contentBox = Gtk.Box(kw`orientation=${Gtk.Orientation.VERTICAL}`);
    this.#contentBox.get_style_context().add_class("content-box");
    this.#contentBox.append(this.#label);
    this.#contentBox.append(this.#picture);
    this.#contentBox.append(this.#urlBox);
    this.#contentBox.append(this.#shareButton);
    this.#contentBox.append(this.#receiveButton);
    this.#contentBox.append(this.#statusIndicator);

    // Set up the ToolbarView with header and content
    const header = this.#createHeaderBar();
    const toolbarView = Adw.ToolbarView();
    toolbarView.add_top_bar(header);
    toolbarView.set_content(this.#contentBox);
    this.set_content(toolbarView);

    this.#dropTarget = Gtk.DropTarget.new(
      Gio.File,
      Gdk.DragAction.COPY,
    );
    this.#dropTarget.connect("drop", this.#onDrop);
    this.add_controller(this.#dropTarget);

    // Add key event controller for Ctrl+V
    const keyController = Gtk.EventControllerKey.new();
    keyController.connect("key-pressed", this.#onKeyPressed);
    this.add_controller(keyController);
  }

  #createUrlBox = () => {
    this.#urlBox = Gtk.Box(kw`orientation=${Gtk.Orientation.HORIZONTAL}`);
    this.#urlBox.set_spacing(10);
    this.#urlBox.set_halign(Gtk.Align.CENTER);

    this.#urlLabel = Gtk.Label(kw`label=${this.#url}`);

    this.#copyButton = Gtk.Button(kw`label=""`);
    this.#copyButton.set_icon_name("edit-copy-symbolic");
    this.#copyButton.set_tooltip_text("Copy URL");
    this.#copyButton.connect(
      "clicked",
      () => {
        this.#clipboard.set(this.#url);
      },
    );

    this.#urlBox.append(this.#urlLabel);
    this.#urlBox.append(this.#copyButton);

    this.#urlBox.set_visible(true);
    this.#urlBox.get_style_context().add_class("url-box");
  };

  #createShareControls = () => {
    this.#shareButton = Gtk.Button(kw`label="Stop Sharing"`);
    this.#shareButton.get_style_context().add_class("share-button");
    this.#shareButton.get_style_context().add_class("inactive");
    this.#shareButton.set_tooltip_text("Toggle sharing on/off (Ctrl+T)");
    this.#shareButton.connect(
      "clicked",
      () => {
        this.#toggleSharing();
      },
    );

    this.#receiveButton = Gtk.Button(kw`label="Receive Mode"`);
    this.#receiveButton.get_style_context().add_class("receive-button");
    this.#receiveButton.get_style_context().add_class("active");
    this.#receiveButton.set_tooltip_text("Toggle receive mode (Ctrl+R)");
    this.#receiveButton.connect(
      "clicked",
      () => {
        this.#toggleReceiveMode();
      },
    );

    this.#statusIndicator = Gtk.Label(kw`label="● Sharing Active"`);
    this.#statusIndicator.get_style_context().add_class("status-indicator");
    this.#statusIndicator.get_style_context().add_class("status-active");
    this.#statusIndicator.set_halign(Gtk.Align.CENTER);

    // Initialize download directory
    this.#downloadDir = getDownloadDir();

    // Update initial UI state
    this.#updateSharingUI();
  };

  #updateSharingUI = () => {
    if (this.#isReceiveMode) {
      this.#shareButton.set_visible(false);
      this.#receiveButton.set_label("Exit Receive Mode");
      this.#receiveButton.get_style_context().remove_class("active");
      this.#receiveButton.get_style_context().add_class("inactive");
      this.#statusIndicator.set_text("📥 Receiving Files");
      this.#statusIndicator.get_style_context().remove_class("status-inactive");
      this.#statusIndicator.get_style_context().add_class("status-active");
      this.#label.set_text(
        `Files will be saved to: ${this.#downloadDir.split("/").pop()}`,
      );
    } else if (this.#isSharing) {
      this.#shareButton.set_visible(true);
      this.#shareButton.set_label("Stop Sharing");
      this.#shareButton.get_style_context().remove_class("active");
      this.#shareButton.get_style_context().add_class("inactive");
      this.#receiveButton.set_label("Receive Mode");
      this.#receiveButton.get_style_context().remove_class("inactive");
      this.#receiveButton.get_style_context().add_class("active");
      this.#statusIndicator.set_text("● Sharing Active");
      this.#statusIndicator.get_style_context().remove_class("status-inactive");
      this.#statusIndicator.get_style_context().add_class("status-active");
    } else {
      this.#shareButton.set_visible(true);
      this.#shareButton.set_label("Start Sharing");
      this.#shareButton.get_style_context().remove_class("inactive");
      this.#shareButton.get_style_context().add_class("active");
      this.#receiveButton.set_label("Receive Mode");
      this.#receiveButton.get_style_context().remove_class("inactive");
      this.#receiveButton.get_style_context().add_class("active");
      this.#statusIndicator.set_text("● Sharing Stopped");
      this.#statusIndicator.get_style_context().remove_class("status-active");
      this.#statusIndicator.get_style_context().add_class("status-inactive");
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
      this.#label.set_text("Drop file or Ctrl+V to paste");
    }

    this.#updateSharingUI();
  };

  #createHeaderBar = () => {
    const header = Adw.HeaderBar();
    // menu
    const menu = Gio.Menu.new();
    const popover = Gtk.PopoverMenu();
    popover.set_menu_model(menu);
    const hamburger = Gtk.MenuButton();
    hamburger.set_primary(true);
    hamburger.set_popover(popover);
    hamburger.set_icon_name("open-menu-symbolic");
    hamburger.set_tooltip_text("Main Menu");
    header.pack_start(hamburger);

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

    // Create actions after methods are defined
    this.#createAction("about", this.#showAbout);
    this.#createAction("open-file", this.#openFileDialog);
    this.#createAction(
      "open-directory",
      this.#openDirectoryDialog,
    );
    this.#createAction("toggle-sharing", this.#toggleSharing);
    this.#createAction(
      "toggle-receive",
      this.#toggleReceiveMode,
    );
  };

  #createAction = (
    name: string,
    callback: Callback | (() => void),
    shortcuts?: [string],
  ) => {
    const action = Gio.SimpleAction.new(name);
    action.connect("activate", callback);
    this.#app.add_action(action);
    if (shortcuts) this.#app.set_accels_for_action(`app.${name}`, shortcuts);
  };

  #openFileDialog = () => {
    const dialog = Gtk.FileDialog();
    dialog.set_title("Select a file to share");

    // Add file filters for common file types
    const filters = Gio.ListStore.new(Gtk.FileFilter);

    const allFilesFilter = Gtk.FileFilter();
    allFilesFilter.set_name("All Files");
    allFilesFilter.add_pattern("*");
    filters.append(allFilesFilter);

    const imageFilter = Gtk.FileFilter();
    imageFilter.set_name("Images");
    imageFilter.add_mime_type("image/*");
    filters.append(imageFilter);

    const textFilter = Gtk.FileFilter();
    textFilter.set_name("Text Files");
    textFilter.add_mime_type("text/*");
    filters.append(textFilter);

    dialog.set_filters(filters);
    dialog.set_default_filter(allFilesFilter);

    dialog.open(
      this,
      null,
      // deno-lint-ignore no-explicit-any
      (_: any, _dialog: Gtk_.FileDialog, result: Gio_.AsyncResult) => {
        try {
          const file = dialog.open_finish(result);
          const filePath = file.get_path().valueOf();
          const fileName = filePath.split("/").pop();

          if (fileName) {
            this.#label.set_text(`file: ${fileName}`);
            worker.postMessage({ type: "file", path: filePath });
          }
        } catch (error) {
          console.log("File dialog cancelled or error:", error);
        }
      },
    );
  };

  #openDirectoryDialog = () => {
    const dialog = Gtk.FileDialog();
    dialog.set_title("Select a directory to share");

    dialog.select_folder(
      this,
      null,
      // deno-lint-ignore no-explicit-any
      (_: any, _dialog: Gtk_.FileDialog, result: Gio_.AsyncResult) => {
        try {
          const file = dialog.select_folder_finish(result);
          const dirPath = file.get_path().valueOf();
          const dirName = dirPath.split("/").pop();

          if (dirName) {
            this.#label.set_text(`directory: ${dirName}`);
            worker.postMessage({ type: "file", path: dirPath });
          }
        } catch (error) {
          console.log("Directory dialog cancelled or error:", error);
        }
      },
    );
  };

  #showAbout = () => {
    const dialog = Adw.AboutWindow(
      new NamedArgument("transient_for", this.#app.get_active_window()),
    );
    dialog.set_application_name("Share");
    dialog.set_version(meta.version);
    dialog.set_developer_name("Bedis Nbiba");
    dialog.set_developers(["Bedis Nbiba <bedisnbiba@gmail.com>"]);
    dialog.set_license_type(Gtk.License.MIT_X11);
    dialog.set_website("https://github.com/sigmaSd/qr-share");
    dialog.set_issue_url(
      "https://github.com/sigmaSd/qr-share/issues",
    );
    dialog.set_application_icon("io.github.sigmasd.share");

    dialog.set_visible(true);
  };

  #onDrop = (_a1: object, _dropTarget: Gtk_.DropTarget, file: Gio_.File) => {
    let filePath;
    let fileName;

    if (typeof file.get_path().valueOf() === "string") {
      filePath = file.get_path().valueOf();
      fileName = filePath.split("/").pop() ?? null;
    } else {
      // Handle file without a path
      const [success, contents] = file.load_contents();
      if (success.valueOf()) {
        fileName = "Dropped File";
        filePath = Deno.makeTempFileSync();
        // keep writeFile async, so it dones't block the ui
        // somehow it works with gio event loop
        Deno.writeFile(
          filePath,
          new Uint8Array(python.list(contents).valueOf()),
        );
      } else {
        console.warn("Failed to read contents of the dropped file");
        return false;
      }
    }

    if (!fileName) {
      console.warn("Could not detect filename from this file");
      return false;
    }

    this.#label.set_text(`file: ${fileName}`);
    worker.postMessage({ type: "file", path: filePath });
    return true;
  };

  #onKeyPressed = (
    // deno-lint-ignore no-explicit-any
    _: any,
    _controller: Gtk_.EventControllerKey,
    keyval: number,
    _keycode: number,
    state: Gdk_.ModifierType,
  ) => {
    if (
      keyval === Gdk.KEY_v.valueOf() &&
      //@ts-ignore: exists in pyobject
      state.__and__(Gdk.ModifierType.CONTROL_MASK)
        .__eq__(Gdk.ModifierType.CONTROL_MASK)
        .valueOf()
    ) {
      this.#handlePaste();
      return true;
    }
    if (
      keyval === Gdk.KEY_o.valueOf() &&
      //@ts-ignore: exists in pyobject
      state.__and__(Gdk.ModifierType.CONTROL_MASK)
        .__eq__(Gdk.ModifierType.CONTROL_MASK)
        .valueOf()
    ) {
      // Check if Shift is also pressed
      if (
        //@ts-ignore: exists in pyobject
        state.__and__(Gdk.ModifierType.SHIFT_MASK)
          .__eq__(Gdk.ModifierType.SHIFT_MASK)
          .valueOf()
      ) {
        this.#openDirectoryDialog();
      } else {
        this.#openFileDialog();
      }
      return true;
    }
    if (
      keyval === Gdk.KEY_t.valueOf() &&
      //@ts-ignore: exists in pyobject
      state.__and__(Gdk.ModifierType.CONTROL_MASK)
        .__eq__(Gdk.ModifierType.CONTROL_MASK)
        .valueOf()
    ) {
      this.#toggleSharing();
      return true;
    }
    if (
      keyval === Gdk.KEY_r.valueOf() &&
      //@ts-ignore: exists in pyobject
      state.__and__(Gdk.ModifierType.CONTROL_MASK)
        .__eq__(Gdk.ModifierType.CONTROL_MASK)
        .valueOf()
    ) {
      this.#toggleReceiveMode();
      return true;
    }
    return false;
  };

  #handlePaste = () => {
    this.#clipboard.read_async(
      // NOTE: order matters!
      [
        "text/uri-list",
        "text/plain",
        "text/plain;charset=utf-8",
        "image/png",
      ],
      GLib.PRIORITY_HIGH,
      null,
      this.#onClipboardRead,
    );
  };

  #onClipboardRead =
    // deno-lint-ignore no-explicit-any
    (_: any, clipboard: Gdk_.Clipboard, result: Gio_.AsyncResult) => {
      const [_inputStream, value] = clipboard.read_finish(result);
      const mimeType = value.valueOf();
      if (mimeType.startsWith("text/")) {
        clipboard.read_text_async(
          null,
          // deno-lint-ignore no-explicit-any
          (_: any, _clipboard: Gdk_.Clipboard, result: Gio_.AsyncResult) =>
            this.#onTextReceived(result, mimeType),
        );
      } else if (mimeType.startsWith("image/")) {
        clipboard.read_texture_async(
          null,
          // deno-lint-ignore no-explicit-any
          (_: any, _clipboard: Gdk_.Clipboard, result: Gio_.AsyncResult) =>
            this.#onImageReceived(result),
        );
      } else {
        console.warn("Unsupported clipboard content type:", mimeType);
      }
    };

  // deno-lint-ignore no-explicit-any
  #onTextReceived = (result: any, mimeType: string) => {
    const text = this.#clipboard.read_text_finish(result).valueOf();
    if (text) {
      if (mimeType.startsWith("text/uri-list") || text.startsWith("file://")) {
        // This is a file URI
        const filePath = text.replace("file://", "").trim();
        const fileName = filePath.split("/").pop();
        if (canAccessFile(filePath)) {
          this.#label.set_text(`file: ${fileName || "Pasted file"}`);
          worker.postMessage({ type: "file", path: filePath });
        } else {
          // In flatpak the app might not have read permission
          // So if we can't access the file, we just send the filepath as text
          this.#label.set_text(`text: ${fileName || "Pasted file"}`);
          worker.postMessage({ type: "text", content: text });
        }
      } else if (mimeType.startsWith("text/plain")) {
        // This is plain text
        this.#label.set_text(
          `text: ${text.length > 30 ? (`${text.slice(0, 30)} ...`) : text}`,
        );
        worker.postMessage({ type: "text", content: text });
      }
    } else {
      console.warn("No text found in clipboard");
    }
  };

  #onImageReceived = (result: Gio_.AsyncResult) => {
    const texture = this.#clipboard.read_texture_finish(result);
    if (texture) {
      this.#label.set_text("image: Pasted image");
      // Save the texture as a temporary file
      const tempFilePath = Deno.makeTempFileSync({ suffix: ".png" });
      texture.save_to_png(tempFilePath);
      worker.postMessage({ type: "file", path: tempFilePath });
    } else {
      console.warn("No image found in clipboard");
    }
  };

  #onCloseRequest = () => {
    worker.postMessage({ type: "stop-sharing" });
    worker.terminate();
    Deno.removeSync(qrPath);
    return false;
  };
}

class App extends Adw.Application {
  #win: MainWindow | undefined;
  #url: string;

  constructor(kwArg: NamedArgument, url: string) {
    super(kwArg);
    this.#url = url;
    this.connect("activate", this.onActivate);
  }

  // deno-lint-ignore no-explicit-any
  onActivate = (_kwarg: any, app: Adw_.Application) => {
    this.#win = new MainWindow(
      new NamedArgument("application", app),
      this.#url,
    );
    this.#win.present();
  };
}

if (import.meta.main) {
  worker.postMessage({ type: "qrPath", path: qrPath });
  worker.onmessage = (event) => {
    console.log("[main] received msg:", event.data);
    switch (event.data.type) {
      case "start": {
        const app = new App(
          kw`application_id=${"io.github.sigmasd.share"}`,
          event.data.url,
        );
        const signal = python.import("signal");
        GLib.unix_signal_add(
          GLib.PRIORITY_HIGH,
          signal.SIGINT,
          () => {
            worker.terminate();
            Deno.removeSync(qrPath);
            app.quit();
          },
        );
        app.run(Deno.args);
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
  return new TextDecoder().decode(
    new Deno.Command("xdg-user-dir", { args: ["DOWNLOAD"] })
      .outputSync()
      .stdout,
  ).trim();
}
