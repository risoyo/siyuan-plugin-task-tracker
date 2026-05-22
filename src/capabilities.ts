import type { CollaborationMode } from "./types";

export interface TaskFeatureCapabilities {
  canView: boolean;
  canSingleDocEdit: boolean;
  canStructureEdit: boolean;
  canArchive: boolean;
  canDeleteTree: boolean;
  canBatchMaintenance: boolean;
  canTemplateMigration: boolean;
}

export type FrontendKind = "desktop" | "mobile" | "browser";

export function frontendKind(frontend: string): FrontendKind {
  if (frontend === "mobile") {
    return "mobile";
  }
  if (frontend === "browser-desktop" || frontend === "browser-mobile") {
    return "browser";
  }
  return "desktop";
}

export function resolveCapabilities(frontend: string, mode: CollaborationMode): TaskFeatureCapabilities {
  const kind = frontendKind(frontend);
  if (kind === "desktop") {
    return fullCapabilities();
  }
  if (kind === "mobile") {
    return lightCapabilities();
  }
  if (mode === "single-workspace") {
    return {
      ...lightCapabilities(),
      canStructureEdit: true,
      canArchive: true,
      canDeleteTree: true
    };
  }
  return lightCapabilities();
}

function fullCapabilities(): TaskFeatureCapabilities {
  return {
    canView: true,
    canSingleDocEdit: true,
    canStructureEdit: true,
    canArchive: true,
    canDeleteTree: true,
    canBatchMaintenance: true,
    canTemplateMigration: true
  };
}

function lightCapabilities(): TaskFeatureCapabilities {
  return {
    canView: true,
    canSingleDocEdit: true,
    canStructureEdit: false,
    canArchive: false,
    canDeleteTree: false,
    canBatchMaintenance: false,
    canTemplateMigration: false
  };
}
