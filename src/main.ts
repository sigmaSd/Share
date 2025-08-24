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
} from "jsr:@sigma/gtk-py@0.4.29";
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

  constructor(kwArg: NamedArgument, url: string) {
    super(kwArg);
    this.#url = url;
    this.set_title("Share");
    this.set_default_size(400, 400);
    this.connect("close-request", python.callback(this.#onCloseRequest));

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
/* Ensure header bar is visible in light mode */
headerbar {
  background: @headerbar_bg_color;
  border-bottom: 1px solid @borders;
  box-shadow: inset 0 1px @headerbar_backdrop_color;
}
/* Fallback for better contrast in light mode */
@media (prefers-color-scheme: light) {
  headerbar {
    background: linear-gradient(to bottom, #fafafa, #ededed);
    border-bottom: 1px solid #d0d0d0;
  }
}
@media (prefers-color-scheme: dark) {
  headerbar {
    background: @headerbar_bg_color;
    border-bottom: 1px solid @headerbar_border_color;
  }
}`);
    Gtk.StyleContext.add_provider_for_display(
      Gdk.Display.get_default(),
      cssProvider,
      Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    // Add CSS class to the window
    this.get_style_context().add_class("main-window");

    this.#label = Gtk.Label(
      kw`label=${"Drop a file here or press Ctrl+V to paste"}`,
    );
    this.#label.get_style_context().add_class("instruction-label");

    this.#picture = Gtk.Picture();
    this.#picture.set_filename(qrPath);
    this.#picture.set_size_request(200, 200);
    this.#picture.set_keep_aspect_ratio(true);

    this.#createUrlBox();

    this.#contentBox = Gtk.Box(kw`orientation=${Gtk.Orientation.VERTICAL}`);
    this.#contentBox.get_style_context().add_class("content-box");
    this.#contentBox.append(this.#label);
    this.#contentBox.append(this.#picture);
    this.#contentBox.append(this.#urlBox);

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
      python.callback(() => {
        this.#clipboard.set(this.#url);
      }),
    );

    this.#urlBox.append(this.#urlLabel);
    this.#urlBox.append(this.#copyButton);

    this.#urlBox.set_visible(true);
    this.#urlBox.get_style_context().add_class("url-box");
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

    this.#createAction("about", this.#showAbout);
    menu.append("About Share", "app.about");

    return header;
  };

  #createShortcuts = () => {
    this.#createAction(
      "quit",
      python.callback(() => {
        this.#onCloseRequest();
        this.#app.quit();
      }),
      ["<primary>q"],
    );
    this.#createAction(
      "close",
      python.callback(() => {
        this.#onCloseRequest();
        this.#app.quit();
      }),
      ["<primary>w"],
    );
  };

  #createAction = (name: string, callback: Callback, shortcuts?: [string]) => {
    const action = Gio.SimpleAction.new(name);
    action.connect("activate", callback);
    this.#app.add_action(action);
    if (shortcuts) this.#app.set_accels_for_action(`app.${name}`, shortcuts);
  };

  #showAbout = python.callback(() => {
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
  });

  #onDrop = python.callback(
    (_a1: object, _dropTarget: Gtk_.DropTarget, file: Gio_.File) => {
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
    },
  );

  #onKeyPressed = python.callback(
    (
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
      return false;
    },
  );

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

  #onClipboardRead = python.callback(
    // deno-lint-ignore no-explicit-any
    (_: any, clipboard: Gdk_.Clipboard, result: Gio_.AsyncResult) => {
      const [_inputStream, value] = clipboard.read_finish(result);
      const mimeType = value.valueOf();
      if (mimeType.startsWith("text/")) {
        clipboard.read_text_async(
          null,
          python.callback(
            // deno-lint-ignore no-explicit-any
            (_: any, _clipboard: Gdk_.Clipboard, result: Gio_.AsyncResult) =>
              this.#onTextReceived(result, mimeType),
          ),
        );
      } else if (mimeType.startsWith("image/")) {
        clipboard.read_texture_async(
          null,
          python.callback(
            // deno-lint-ignore no-explicit-any
            (_: any, _clipboard: Gdk_.Clipboard, result: Gio_.AsyncResult) =>
              this.#onImageReceived(result),
          ),
        );
      } else {
        console.warn("Unsupported clipboard content type:", mimeType);
      }
    },
  );

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

  onActivate = python.callback((_kwarg, app: Adw_.Application) => {
    this.#win = new MainWindow(
      new NamedArgument("application", app),
      this.#url,
    );
    this.#win.present();
  });
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
          python.callback(() => {
            worker.terminate();
            Deno.removeSync(qrPath);
            app.quit();
          }),
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
