export function supportsLocalFolderOpen(): boolean {
  const runtimeRequire = getRuntimeRequire();
  if (!runtimeRequire) {
    return false;
  }
  try {
    const electron = runtimeRequire("electron");
    return Boolean(electron?.shell?.openPath);
  } catch {
    return false;
  }
}

export async function openLocalFolderPath(folderPath: string): Promise<void> {
  const runtimeRequire = getRuntimeRequire();
  if (!runtimeRequire) {
    throw new Error("unsupported");
  }
  const fs = runtimeRequire("fs") as { existsSync?: (path: string) => boolean; statSync?: (path: string) => { isDirectory?: () => boolean } };
  const electron = runtimeRequire("electron") as { shell?: { openPath?: (path: string) => Promise<string> } };
  if (!fs?.existsSync?.(folderPath) || !fs?.statSync?.(folderPath)?.isDirectory?.()) {
    throw new Error("missing");
  }
  const result = await electron?.shell?.openPath?.(folderPath);
  if (typeof result === "string" && result.trim()) {
    throw new Error(result);
  }
}

function getRuntimeRequire(): ((moduleName: string) => any) | undefined {
  const globalWindow = window as Window & { require?: (moduleName: string) => any };
  return typeof globalWindow.require === "function" ? globalWindow.require : undefined;
}
