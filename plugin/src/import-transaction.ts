export interface ImportFileSystem {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeText(path: string, body: string): Promise<void>;
  writeBinary(path: string, body: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  directoryExists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  removeDirectoryIfEmpty(path: string): Promise<void>;
}

export interface ImportAssetRequest {
  path: string;
  url: string;
}

export interface AtomicImportRequest {
  notePath: string;
  markdown: string;
  assets: ImportAssetRequest[];
  overwrite: boolean;
  download(url: string): Promise<ArrayBuffer>;
}

interface DestinationBackup {
  path: string;
  kind: "text" | "binary";
  existed: boolean;
  text?: string;
  binary?: ArrayBuffer;
}

export async function commitAtomicImport(
  fileSystem: ImportFileSystem,
  request: AtomicImportRequest
): Promise<number> {
  const destinations = new Set<string>([request.notePath]);
  for (const asset of request.assets) {
    if (destinations.has(asset.path)) {
      throw new Error(`Import contains more than one file for: ${asset.path}`);
    }
    destinations.add(asset.path);
  }

  for (const path of destinations) {
    if ((await fileSystem.exists(path)) && !request.overwrite) {
      throw new Error(`${path === request.notePath ? "File" : "Asset"} already exists: ${path}`);
    }
  }

  // Resolve every remote body before touching the vault.
  const downloadedAssets: Array<{ path: string; body: ArrayBuffer }> = [];
  for (const asset of request.assets) {
    downloadedAssets.push({
      path: asset.path,
      body: await request.download(asset.url)
    });
  }

  const backups: DestinationBackup[] = [];
  backups.push(await backupDestination(fileSystem, request.notePath, "text", request.overwrite));
  for (const asset of downloadedAssets) {
    backups.push(await backupDestination(fileSystem, asset.path, "binary", request.overwrite));
  }

  const written: DestinationBackup[] = [];
  const createdDirectories: string[] = [];
  try {
    for (const directory of destinationDirectories(destinations)) {
      if (await fileSystem.directoryExists(directory)) continue;
      await fileSystem.createDirectory(directory);
      createdDirectories.push(directory);
    }
    for (let index = 0; index < downloadedAssets.length; index += 1) {
      const asset = downloadedAssets[index];
      const backup = backups[index + 1];
      written.push(backup);
      await fileSystem.writeBinary(asset.path, asset.body);
    }
    written.push(backups[0]);
    await fileSystem.writeText(request.notePath, request.markdown);
    return downloadedAssets.length;
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    for (const backup of written.reverse()) {
      try {
        await restoreDestination(fileSystem, backup);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    for (const directory of createdDirectories.reverse()) {
      try {
        await fileSystem.removeDirectoryIfEmpty(directory);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (rollbackFailures.length) {
      const message = error instanceof Error ? error.message : "Unknown import error";
      throw new Error(`Import failed and vault rollback was incomplete: ${message}`);
    }
    throw error;
  }
}

function destinationDirectories(destinations: Set<string>): string[] {
  const directories = new Set<string>();
  for (const destination of destinations) {
    const parts = destination.split("/").filter(Boolean);
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      directories.add(current);
    }
  }
  return [...directories].sort((left, right) => left.split("/").length - right.split("/").length);
}

async function backupDestination(
  fileSystem: ImportFileSystem,
  path: string,
  kind: DestinationBackup["kind"],
  overwrite: boolean
): Promise<DestinationBackup> {
  const existed = await fileSystem.exists(path);
  if (existed && !overwrite) {
    throw new Error(`${kind === "text" ? "File" : "Asset"} already exists: ${path}`);
  }
  if (!existed) return { path, kind, existed: false };
  if (kind === "text") {
    return { path, kind, existed: true, text: await fileSystem.readText(path) };
  }
  return { path, kind, existed: true, binary: await fileSystem.readBinary(path) };
}

async function restoreDestination(fileSystem: ImportFileSystem, backup: DestinationBackup): Promise<void> {
  if (!backup.existed) {
    if (await fileSystem.exists(backup.path)) await fileSystem.remove(backup.path);
    return;
  }
  if (backup.kind === "text") {
    await fileSystem.writeText(backup.path, backup.text ?? "");
  } else {
    await fileSystem.writeBinary(backup.path, backup.binary ?? new ArrayBuffer(0));
  }
}
