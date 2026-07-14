import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { BlobReader, TextWriter, ZipReader } from "@zip-js/zip-js";
import { createSharedArchive } from "./archive.ts";

Deno.test("returns null for empty paths", async () => {
  const result = await createSharedArchive([]);
  assertEquals(result, null);
});

Deno.test("returns single path unchanged when file exists", async () => {
  const tmp = Deno.makeTempFileSync();
  Deno.writeTextFileSync(tmp, "hello");
  try {
    const result = await createSharedArchive([tmp]);
    assertEquals(result, tmp);
  } finally {
    Deno.removeSync(tmp);
  }
});

Deno.test("returns null for single non-existent path", async () => {
  const result = await createSharedArchive(["/nonexistent/path/test.txt"]);
  assertEquals(result, null);
});

Deno.test("creates valid zip with multiple files", async () => {
  const dir = Deno.makeTempDirSync();
  const file1 = `${dir}/a.txt`;
  const file2 = `${dir}/b.txt`;
  Deno.writeTextFileSync(file1, "content a");
  Deno.writeTextFileSync(file2, "content b");

  try {
    const zipPath = await createSharedArchive([file1, file2]);
    assertExists(zipPath);

    const zipFile = Deno.readFileSync(zipPath);
    const zipReader = new ZipReader(new BlobReader(new Blob([zipFile])));
    const entries = await zipReader.getEntries();
    assertEquals(entries.length, 2);

    const entryNames = entries.map((e) => e.filename).sort();
    assertEquals(entryNames, ["a.txt", "b.txt"]);

    const texts = await Promise.all(entries.map(async (e) => {
      if (e.directory) throw new Error("unexpected directory");
      return await e.getData(new TextWriter()) as string;
    }));
    assertEquals(texts.sort(), ["content a", "content b"]);

    await zipReader.close();
    Deno.removeSync(zipPath);
  } finally {
    Deno.removeSync(file1);
    Deno.removeSync(file2);
    Deno.removeSync(dir);
  }
});

Deno.test("throws for missing file in multi-file", async () => {
  const dir = Deno.makeTempDirSync();
  const existing = `${dir}/exists.txt`;
  Deno.writeTextFileSync(existing, "hello");

  await assertRejects(
    () => createSharedArchive([existing, "/nonexistent/path.txt"]),
  );

  Deno.removeSync(existing);
  Deno.removeSync(dir);
});

Deno.test("returns path unchanged for single large file (no zip needed)", async () => {
  const filePath = Deno.makeTempFileSync();
  const size = 10 * 1024 * 1024;
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = i & 0xff;
  Deno.writeFileSync(filePath, buf);

  try {
    const result = await createSharedArchive([filePath]);
    assertEquals(result, filePath);
    const stat = Deno.statSync(result!);
    assertEquals(stat.size, size);
  } finally {
    Deno.removeSync(filePath);
  }
});

Deno.test("creates zip with multiple large files via streaming", async () => {
  const dir = Deno.makeTempDirSync();
  const files: string[] = [];
  for (let i = 0; i < 3; i++) {
    const f = `${dir}/big${i}.dat`;
    const size = 5 * 1024 * 1024;
    const buf = new Uint8Array(size);
    for (let j = 0; j < size; j++) buf[j] = (i + j) & 0xff;
    Deno.writeFileSync(f, buf);
    files.push(f);
  }

  try {
    const zipPath = await createSharedArchive(files);
    assertExists(zipPath);

    const zipData = Deno.readFileSync(zipPath);
    const zipReader = new ZipReader(new BlobReader(new Blob([zipData])));
    const entries = await zipReader.getEntries();
    assertEquals(entries.length, 3);

    const names = entries.map((e) => e.filename).sort();
    assertEquals(names, ["big0.dat", "big1.dat", "big2.dat"]);

    await zipReader.close();
    Deno.removeSync(zipPath);
  } finally {
    for (const f of files) Deno.removeSync(f);
    Deno.removeSync(dir);
  }
});
