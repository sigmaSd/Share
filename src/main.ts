#!/usr/bin/env -S deno run --allow-all --unstable-ffi
import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path/resolve";
import meta from "../deno.json" with { type: "json" };

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["help", "cli", "receive"],
    string: ["port"],
    default: { port: "0" },
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
  --port <port>  Port to listen on (default: random)
  --cli          Run in terminal mode (no GUI required)
  --receive      Start in receive mode (only with --cli)
`);
    Deno.exit(0);
  }

  const port = parseInt(args.port, 10);
  const path = args._[0] ? resolve(String(args._[0])) : undefined;

  if (args.cli) {
    const { runCli } = await import("./cli.ts");
    await runCli({ port, path, receive: args.receive ?? false });
  } else {
    const { runGui } = await import("./gui.ts");
    runGui({ port, path });
  }
}
