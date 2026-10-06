import { dirname } from "@std/path/dirname";
import { join } from "@std/path/join";

/** Port used when the user hasn't chosen one (next to LocalSend's 53317). */
export const DEFAULT_PORT = 53318;
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

export interface Settings {
  /** Listen on `port` instead of a random port picked by the OS. */
  fixedPort: boolean;
  port: number;
}

export const DEFAULT_SETTINGS: Settings = {
  fixedPort: true,
  port: DEFAULT_PORT,
};

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/** Parses user input into a port, or returns null if it isn't a valid one. */
export function parsePort(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const port = Number(text.trim());
  return isValidPort(port) ? port : null;
}

/** The port to pass to the server: 0 means "let the OS pick". */
export function serverPort(settings: Settings): number {
  return settings.fixedPort ? settings.port : 0;
}

export function settingsPath(): string {
  const configHome = Deno.env.get("XDG_CONFIG_HOME") ||
    join(Deno.env.get("HOME") ?? "/tmp", ".config");
  return join(configHome, "share", "settings.json");
}

export function loadSettings(path = settingsPath()): Settings {
  let raw: unknown;
  try {
    raw = JSON.parse(Deno.readTextFileSync(path));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    fixedPort: typeof data.fixedPort === "boolean"
      ? data.fixedPort
      : DEFAULT_SETTINGS.fixedPort,
    port: typeof data.port === "number" && isValidPort(data.port)
      ? data.port
      : DEFAULT_SETTINGS.port,
  };
}

export function saveSettings(settings: Settings, path = settingsPath()) {
  try {
    Deno.mkdirSync(dirname(path), { recursive: true });
    Deno.writeTextFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  } catch (e) {
    console.warn("Failed to save settings:", e);
  }
}
