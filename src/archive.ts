import { configure, ZipWriter } from "@zip-js/zip-js";

configure({ useWebWorkers: false, useCompressionStream: true });

export async function createSharedArchive(
  paths: string[],
): Promise<string | null> {
  if (paths.length === 0) return null;
  if (paths.length === 1) {
    try {
      Deno.statSync(paths[0]);
      return paths[0];
    } catch {
      return null;
    }
  }

  const tmp = Deno.makeTempFileSync({ suffix: ".zip" });
  const outputFile = Deno.openSync(tmp, { write: true, create: true });

  try {
    const zipWriter = new ZipWriter(outputFile.writable);

    for (const p of paths) {
      const name = p.split("/").pop() ?? "file";
      const inputFile = Deno.openSync(p, { read: true });
      await zipWriter.add(name, inputFile.readable);
    }

    await zipWriter.close();
  } catch (e) {
    try {
      Deno.removeSync(tmp);
      // deno-lint-ignore no-empty
    } catch {}
    throw e;
  }

  return tmp;
}
