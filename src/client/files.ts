import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, resolve, sep } from "node:path";

export async function resolveFileInDirectory(
  rootDir: string,
  fileName: string,
  label: string,
  envName: string
): Promise<string> {
  if (isAbsolute(fileName)) {
    throw new Error(`${label} file name must be relative to ${envName}, not absolute`);
  }
  if (fileName !== basename(fileName)) {
    throw new Error(`${label} file name must not contain path separators`);
  }

  await mkdir(rootDir, { recursive: true });
  const root = await realpath(rootDir);
  const target = resolve(root, fileName);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`${label} file path escapes ${envName}`);
  }
  return target;
}

export async function rejectSymlink(
  path: string,
  message: string
): Promise<void> {
  const file = await lstat(path);
  if (file.isSymbolicLink()) {
    throw new Error(message);
  }
}

export async function getExistingFile(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
}

export async function assertRealPathInside(
  rootDir: string,
  filePath: string,
  message: string
): Promise<void> {
  const root = await realpath(rootDir);
  const realFilePath = await realpath(filePath);
  if (realFilePath !== root && !realFilePath.startsWith(`${root}${sep}`)) {
    throw new Error(message);
  }
}
