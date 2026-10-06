#!/usr/bin/env -S deno run --allow-all --unstable-ffi
import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path/resolve";
import meta from "../deno.json" with { type: "json" };
import { DEFAULT_PORT, loadSettings, serverPort } from "./settings.ts";

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["help", "cli", "receive"],
    string: ["port"],
  });

  if (args.help) {
    console.log(`Share ${meta.version}
Share files and text locally via QR code.

Usage:
  share [options] [path]

Arguments:
  path           Path to share (file or directory)

Options:
  --help         Show this help message
  --port <port>  Port to listen on, 0 for random (default: the port saved in
                 Preferences, ${DEFAULT_PORT} unless changed)
  --cli          Run in terminal mode (no GUI required)
  --receive      Start in receive mode (only with --cli)
`);
    Deno.exit(0);
  }

  let port = serverPort(loadSettings());
  if (args.port !== undefined) {
    port = Number(args.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error(`Invalid port: ${args.port}`);
      Deno.exit(1);
    }
  }
  const path = args._[0] ? resolve(String(args._[0])) : undefined;

  if (args.cli) {
    const { runCli } = await import("./cli.ts");
    await runCli({ port, path, receive: args.receive ?? false });
  } else {
    const { runGui } = await import("./gui.ts");
    runGui({ port, path });
  }
}
