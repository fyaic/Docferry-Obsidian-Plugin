import assert from "node:assert/strict";
import test from "node:test";

import { commitAtomicImport, type ImportFileSystem } from "../src/import-transaction.ts";

class MemoryFileSystem implements ImportFileSystem {
  readonly text = new Map<string, string>();
  readonly binary = new Map<string, ArrayBuffer>();
  readonly directories = new Set<string>();
  failWritePath = "";

  async exists(path: string): Promise<boolean> {
    return this.text.has(path) || this.binary.has(path);
  }

  async readText(path: string): Promise<string> {
    const value = this.text.get(path);
    if (value === undefined) throw new Error(`Missing text: ${path}`);
    return value;
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.binary.get(path);
    if (!value) throw new Error(`Missing binary: ${path}`);
    return value.slice(0);
  }

  async writeText(path: string, body: string): Promise<void> {
    if (path === this.failWritePath) {
      this.failWritePath = "";
      throw new Error("write failed");
    }
    this.text.set(path, body);
  }

  async writeBinary(path: string, body: ArrayBuffer): Promise<void> {
    if (path === this.failWritePath) {
      this.failWritePath = "";
      throw new Error("write failed");
    }
    this.binary.set(path, body.slice(0));
  }

  async remove(path: string): Promise<void> {
    this.text.delete(path);
    this.binary.delete(path);
  }

  async directoryExists(path: string): Promise<boolean> {
    return this.directories.has(path);
  }

  async createDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }

  async removeDirectoryIfEmpty(path: string): Promise<void> {
    const prefix = `${path}/`;
    const occupied =
      [...this.text.keys(), ...this.binary.keys()].some((entry) => entry.startsWith(prefix)) ||
      [...this.directories].some((entry) => entry !== path && entry.startsWith(prefix));
    if (!occupied) this.directories.delete(path);
  }
}

const bytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;
const text = (value: ArrayBuffer | undefined): string => new TextDecoder().decode(value);

test("downloads every attachment before writing to the vault", async () => {
  const fs = new MemoryFileSystem();
  await assert.rejects(
    commitAtomicImport(fs, {
      notePath: "Imports/note.md",
      markdown: "new note",
      assets: [
        { path: "Imports/a.png", url: "https://example.com/a" },
        { path: "Imports/b.png", url: "https://example.com/b" }
      ],
      overwrite: false,
      download: async (url) => {
        if (url.endsWith("/b")) throw new Error("download failed");
        return bytes("a");
      }
    }),
    /download failed/
  );
  assert.equal(fs.text.size, 0);
  assert.equal(fs.binary.size, 0);
  assert.equal(fs.directories.size, 0);
});

test("downloads attachments sequentially before committing them", async () => {
  const fs = new MemoryFileSystem();
  let activeDownloads = 0;
  let maxActiveDownloads = 0;

  await commitAtomicImport(fs, {
    notePath: "Imports/note.md",
    markdown: "new note",
    assets: [
      { path: "Imports/a.png", url: "https://example.com/a" },
      { path: "Imports/b.png", url: "https://example.com/b" },
      { path: "Imports/c.png", url: "https://example.com/c" }
    ],
    overwrite: false,
    download: async (url) => {
      activeDownloads += 1;
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeDownloads -= 1;
      return bytes(url);
    }
  });

  assert.equal(maxActiveDownloads, 1);
  assert.equal(fs.text.get("Imports/note.md"), "new note");
  assert.equal(fs.binary.size, 3);
});

test("restores overwritten files when a later vault write fails", async () => {
  const fs = new MemoryFileSystem();
  fs.directories.add("Imports");
  fs.text.set("Imports/note.md", "old note");
  fs.binary.set("Imports/a.png", bytes("old asset"));
  fs.failWritePath = "Imports/note.md";

  await assert.rejects(
    commitAtomicImport(fs, {
      notePath: "Imports/note.md",
      markdown: "new note",
      assets: [{ path: "Imports/a.png", url: "https://example.com/a" }],
      overwrite: true,
      download: async () => bytes("new asset")
    }),
    /write failed/
  );

  assert.equal(fs.text.get("Imports/note.md"), "old note");
  assert.equal(text(fs.binary.get("Imports/a.png")), "old asset");
  assert.deepEqual([...fs.directories], ["Imports"]);
});

test("removes transaction-created empty directories after a write failure", async () => {
  const fs = new MemoryFileSystem();
  fs.failWritePath = "Imports/attachments/a.png";

  await assert.rejects(
    commitAtomicImport(fs, {
      notePath: "Imports/note.md",
      markdown: "new note",
      assets: [{ path: "Imports/attachments/a.png", url: "https://example.com/a" }],
      overwrite: false,
      download: async () => bytes("asset")
    }),
    /write failed/
  );

  assert.deepEqual([...fs.directories], []);
  assert.equal(fs.text.size, 0);
  assert.equal(fs.binary.size, 0);
});

test("rejects collisions before downloading", async () => {
  const fs = new MemoryFileSystem();
  fs.text.set("Imports/note.md", "existing");
  let downloads = 0;

  await assert.rejects(
    commitAtomicImport(fs, {
      notePath: "Imports/note.md",
      markdown: "new note",
      assets: [],
      overwrite: false,
      download: async () => {
        downloads += 1;
        return bytes("asset");
      }
    }),
    /File already exists/
  );
  assert.equal(downloads, 0);
  assert.equal(fs.text.get("Imports/note.md"), "existing");
});
