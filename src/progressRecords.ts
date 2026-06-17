import { newSiyuanId, nowIso, toDateKey, weekKey } from "./date";
import type { ProgressRecord, TaskItem } from "./types";

export const TASK_PROGRESS_HEADING = "推进记录";
export const EMPTY_PROGRESS_RECORDS_TEXT = "暂无推进记录";

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export interface WeeklyProgressEntry {
  task: TaskItem;
  record: ProgressRecord;
}

export interface WeeklyProgressGroup {
  groupTask: TaskItem;
  entries: WeeklyProgressEntry[];
}

export function normalizeProgressRecordDate(value?: string): string | undefined {
  const key = toDateKey(value);
  return key || undefined;
}

export function normalizeProgressRecordTime(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return undefined;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function resolveProgressRecordTime(record: { time?: string; createdAt?: string }): string | undefined {
  const explicit = normalizeProgressRecordTime(record.time);
  if (explicit) {
    return explicit;
  }
  const createdAt = record.createdAt?.trim();
  if (!createdAt) {
    return undefined;
  }
  const parsed = new Date(createdAt);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getHours().toString().padStart(2, "0")}:${parsed.getMinutes().toString().padStart(2, "0")}`;
  }
  const timeMatch = createdAt.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!timeMatch) {
    return undefined;
  }
  return normalizeProgressRecordTime(`${timeMatch[1]}:${timeMatch[2]}`);
}

export function compareProgressRecordsDesc(a: ProgressRecord, b: ProgressRecord): number {
  return b.date.localeCompare(a.date)
    || (resolveProgressRecordTime(b) || "").localeCompare(resolveProgressRecordTime(a) || "")
    || (b.createdAt || "").localeCompare(a.createdAt || "")
    || (b.updatedAt || "").localeCompare(a.updatedAt || "")
    || b.id.localeCompare(a.id);
}

export function compareProgressRecordsAsc(a: ProgressRecord, b: ProgressRecord): number {
  return a.date.localeCompare(b.date)
    || (resolveProgressRecordTime(a) || "").localeCompare(resolveProgressRecordTime(b) || "")
    || (a.createdAt || "").localeCompare(b.createdAt || "")
    || (a.updatedAt || "").localeCompare(b.updatedAt || "")
    || a.id.localeCompare(b.id);
}

export function normalizeProgressRecords(records: unknown, fallbackTimestamp?: string): ProgressRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  const normalized = records
    .map((record) => normalizeProgressRecord(record, fallbackTimestamp))
    .filter((record): record is ProgressRecord => Boolean(record));

  return normalized.sort(compareProgressRecordsDesc);
}

export function createProgressRecord(input: Partial<ProgressRecord>): ProgressRecord {
  const timestamp = nowIso();
  const date = normalizeProgressRecordDate(input.date);
  const time = normalizeProgressRecordTime(input.time);
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!date) {
    throw new Error("请选择记录日期。");
  }
  if (!content) {
    throw new Error("请填写推进内容。");
  }

  return {
    id: input.id?.trim() || newSiyuanId(),
    date,
    time,
    content,
    createdAt: input.createdAt?.trim() || timestamp,
    updatedAt: input.updatedAt?.trim() || timestamp
  };
}

export function parseProgressRecords(value?: string, fallbackTimestamp?: string): ProgressRecord[] {
  if (!value?.trim()) {
    return [];
  }

  try {
    return normalizeProgressRecords(JSON.parse(value), fallbackTimestamp);
  } catch {
    return [];
  }
}

export function serializeProgressRecords(records?: ProgressRecord[]): string {
  const normalized = normalizeProgressRecords(records);
  return normalized.length ? JSON.stringify(normalized) : "";
}

export function renderProgressRecordsMarkdown(records?: ProgressRecord[]): string {
  const normalized = normalizeProgressRecords(records);
  if (!normalized.length) {
    return EMPTY_PROGRESS_RECORDS_TEXT;
  }

  return [
    "| 日期 | 推进内容 |",
    "| --- | --- |",
    ...normalized.map((record) => `| ${record.date} | ${escapeProgressRecordMarkdownCell(record.content)} |`)
  ].join("\n");
}

export function formatProgressRecordWeekday(date: string): string {
  const normalized = normalizeProgressRecordDate(date);
  if (!normalized) {
    return "";
  }
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return WEEKDAY_NAMES[parsed.getDay()] || "";
}

export function latestProgressRecordSummary(records?: ProgressRecord[]): string {
  const latest = normalizeProgressRecords(records)[0];
  if (!latest) {
    return "";
  }
  return `${latest.date.slice(5, 7)}${latest.date.slice(8, 10)}:${latest.content.replace(/\r?\n+/g, " ").trim()}`;
}

export function groupWeeklyProgressRecords(tasks: TaskItem[], week: string): WeeklyProgressGroup[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const groups = new Map<string, WeeklyProgressGroup>();

  for (const task of tasks) {
    const weeklyRecords = normalizeProgressRecords(task.progressRecords)
      .filter((record) => weekKey(record.date) === week);
    if (!weeklyRecords.length) {
      continue;
    }

    const groupTask = task.parentId ? taskById.get(task.parentId) || task : task;
    const current = groups.get(groupTask.id) || {
      groupTask,
      entries: []
    };

    for (const record of weeklyRecords) {
      current.entries.push({ task, record });
    }
    groups.set(groupTask.id, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) => compareProgressRecordsAsc(left.record, right.record))
    }))
    .sort((left, right) => {
      const leftFirst = left.entries[0]?.record.date || "";
      const rightFirst = right.entries[0]?.record.date || "";
      return leftFirst.localeCompare(rightFirst)
        || left.groupTask.title.localeCompare(right.groupTask.title, "zh-Hans-CN");
    });
}

function normalizeProgressRecord(record: unknown, fallbackTimestamp?: string): ProgressRecord | undefined {
  if (!record || typeof record !== "object") {
    return undefined;
  }

  const candidate = record as Partial<ProgressRecord>;
  const date = normalizeProgressRecordDate(candidate.date);
  const time = normalizeProgressRecordTime(candidate.time);
  const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
  if (!date || !content) {
    return undefined;
  }

  const baseTimestamp = fallbackTimestamp?.trim() || "";
  const createdAt = candidate.createdAt?.trim() || baseTimestamp;
  const updatedAt = candidate.updatedAt?.trim() || createdAt || baseTimestamp;

  return {
    id: candidate.id?.trim() || newSiyuanId(),
    date,
    time,
    content,
    createdAt: createdAt || nowIso(),
    updatedAt: updatedAt || createdAt || nowIso()
  };
}

function escapeProgressRecordMarkdownCell(value: string): string {
  return value
    .replace(/\r?\n+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}
