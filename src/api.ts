import { fetchSyncPost } from "siyuan";
import type { BlockRow } from "./types";

interface SiyuanResponse<T> {
  code: number;
  msg?: string;
  data: T;
}

export async function request<T>(url: string, data: unknown = {}): Promise<T> {
  const response = await fetchSyncPost(url, data) as SiyuanResponse<T>;
  if (!response || response.code !== 0) {
    throw new Error(`${url} failed: ${response?.msg || response?.code || "unknown error"}`);
  }
  return response.data;
}

export function sqlText(value: string): string {
  return value.replace(/'/g, "''");
}

export async function sql<T = Record<string, unknown>>(stmt: string): Promise<T[]> {
  return request<T[]>("/api/query/sql", { stmt });
}

export async function getBlockById(id: string): Promise<BlockRow | undefined> {
  const rows = await sql<BlockRow>(`select * from blocks where id = '${sqlText(id)}' limit 1`);
  return rows[0];
}

export async function getDocById(id: string): Promise<BlockRow | undefined> {
  const block = await getBlockById(id);
  if (!block || block.type !== "d") {
    return undefined;
  }
  return block;
}

export async function getHPathById(id: string): Promise<string> {
  return request<string>("/api/filetree/getHPathByID", { id });
}

export async function getDocMarkdown(id: string): Promise<string> {
  const result = await request<string | { markdown?: string; content?: string }>("/api/export/exportMdContent", { id });
  if (typeof result === "string") {
    return result;
  }
  return result?.markdown || result?.content || "";
}

export async function createDocWithMd(notebook: string, path: string, markdown: string): Promise<string> {
  return request<string>("/api/filetree/createDocWithMd", { notebook, path, markdown });
}

export async function renameDocById(id: string, title: string): Promise<string> {
  return request<string>("/api/filetree/renameDocByID", { id, title });
}

export async function moveDocs(fromPaths: string[], toNotebook: string, toPath: string): Promise<void> {
  await request("/api/filetree/moveDocs", { fromPaths, toNotebook, toPath });
}

export async function removeDoc(notebook: string, path: string): Promise<void> {
  await request("/api/filetree/removeDoc", { notebook, path });
}

export async function updateBlock(id: string, markdown: string): Promise<void> {
  await request("/api/block/updateBlock", { id, dataType: "markdown", data: markdown });
}

export async function setBlockAttrs(id: string, attrs: Record<string, string>): Promise<void> {
  await request("/api/attr/setBlockAttrs", { id, attrs });
}

export async function getBlockAttrs(id: string): Promise<Record<string, string>> {
  return request<Record<string, string>>("/api/attr/getBlockAttrs", { id });
}

export interface SyncInfo {
  syncing?: boolean;
  stat?: string;
  kernel?: string;
  [key: string]: unknown;
}

export async function getSyncInfo(): Promise<SyncInfo | undefined> {
  try {
    return await request<SyncInfo>("/api/sync/getSyncInfo");
  } catch {
    return undefined;
  }
}
