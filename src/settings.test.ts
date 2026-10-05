import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import {
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  loadSettings,
  parsePort,
  saveSettings,
  serverPort,
} from "./settings.ts";

Deno.test("defaults to a fixed port when no settings file exists", () => {
  const dir = Deno.makeTempDirSync();
  const settings = loadSettings(join(dir, "missing.json"));
  assertEquals(settings, DEFAULT_SETTINGS);
  assertEquals(serverPort(settings), DEFAULT_PORT);
  Deno.removeSync(dir, { recursive: true });
});

Deno.test("saves and loads settings", () => {
  const dir = Deno.makeTempDirSync();
  const path = join(dir, "nested", "settings.json");
  saveSettings({ fixedPort: true, port: 8080 }, path);
  assertEquals(loadSettings(path), { fixedPort: true, port: 8080 });
  Deno.removeSync(dir, { recursive: true });
});

Deno.test("random port mode asks the OS for a port", () => {
  assertEquals(serverPort({ fixedPort: false, port: 8080 }), 0);
});

Deno.test("falls back to defaults for corrupt or invalid values", () => {
  const dir = Deno.makeTempDirSync();
  const path = join(dir, "settings.json");
  Deno.writeTextFileSync(path, "{not json");
  assertEquals(loadSettings(path), DEFAULT_SETTINGS);
  Deno.writeTextFileSync(path, JSON.stringify({ fixedPort: "yes", port: 80 }));
  assertEquals(loadSettings(path), DEFAULT_SETTINGS);
  Deno.removeSync(dir, { recursive: true });
});

Deno.test("parses only valid unprivileged ports", () => {
  assertEquals(parsePort("53318"), 53318);
  assertEquals(parsePort(" 8080 "), 8080);
  assertEquals(parsePort("80"), null);
  assertEquals(parsePort("70000"), null);
  assertEquals(parsePort("80a"), null);
  assertEquals(parsePort(""), null);
});
