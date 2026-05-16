export function nowIso(): string {
  return new Date().toISOString();
}

export function compactDateTime(date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

export function newSiyuanId(): string {
  const luteId = (window as any).Lute?.NewNodeID?.();
  if (typeof luteId === "string" && luteId.length > 0) {
    return luteId;
  }
  const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0").slice(0, 7);
  return `${compactDateTime()}-${random}`;
}

export function toDateKey(value?: string): string {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return formatDateKey(date);
}

export function formatDateKey(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDatetimeLocal(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 16);
  }
  const pad = (input: number) => input.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocal(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

export function fromDateInput(value?: string, hour = 9): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(`${value}T${hour.toString().padStart(2, "0")}:00:00`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

export function mergeDateInputWithExisting(value: string | undefined, existing?: string, defaultHour = 9): string | undefined {
  if (!value) {
    return undefined;
  }
  const existingDate = existing ? new Date(existing) : undefined;
  if (!existingDate || Number.isNaN(existingDate.getTime())) {
    return fromDateInput(value, defaultHour);
  }
  const nextDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(nextDate.getTime())) {
    return undefined;
  }
  nextDate.setHours(
    existingDate.getHours(),
    existingDate.getMinutes(),
    existingDate.getSeconds(),
    existingDate.getMilliseconds()
  );
  return nextDate.toISOString();
}

export function isActiveDateBeforeToday(value?: string): boolean {
  const key = toDateKey(value);
  if (!key) {
    return false;
  }
  return key < formatDateKey(new Date());
}

export function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function monthTitle(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

export function startOfWeek(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

export function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
}

export function weekKey(value?: string): string {
  const key = toDateKey(value);
  if (!key) {
    return "未分组";
  }
  return formatDateKey(startOfWeek(new Date(`${key}T00:00:00`)));
}

export function weekNumber(value: string | Date): number | undefined {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const weekStart = startOfWeek(date);
  const firstWeekStart = startOfWeek(new Date(weekStart.getFullYear(), 0, 1));
  const diffMs = weekStart.getTime() - firstWeekStart.getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

export function formatWeekRangeCompact(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return key;
  }
  const start = new Date(`${key}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return key;
  }
  const end = endOfWeek(start);
  const startLabel = `${(start.getMonth() + 1).toString().padStart(2, "0")}.${start.getDate().toString().padStart(2, "0")}`;
  const endLabel = `${(end.getMonth() + 1).toString().padStart(2, "0")}.${end.getDate().toString().padStart(2, "0")}`;
  return `${startLabel}~${endLabel}`;
}

export function formatWeekLabel(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return key;
  }
  const start = new Date(`${key}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return key;
  }
  return `${formatDateKey(start)} 至 ${formatDateKey(endOfWeek(start))}`;
}

export function formatCompletedWeekLabel(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return key;
  }
  const start = new Date(`${key}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return key;
  }
  const number = weekNumber(start);
  if (!number) {
    return key;
  }
  return `${start.getFullYear()}年Week${number}(${formatWeekRangeCompact(key)})`;
}

export function formatLocalDateOrEmpty(value?: string): string {
  return toDateKey(value);
}

export function formatLocalDate(value?: string): string {
  return formatLocalDateOrEmpty(value) || "未设置";
}

export function formatLocalDateTimeOrEmpty(value?: string): string {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (input: number) => input.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatLocalDateTime(value?: string): string {
  return formatLocalDateTimeOrEmpty(value) || "未设置";
}

export function formatHumanDate(value?: string): string {
  return formatLocalDate(value);
}

export function formatHumanDatetime(value?: string): string {
  return formatLocalDateTime(value);
}

export function formatHumanDatetimeOrEmpty(value?: string): string {
  return formatLocalDateTimeOrEmpty(value);
}

export function formatMonthDay(value?: string): string {
  const key = toDateKey(value);
  return key ? key.slice(5) : "未设置";
}

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Display-only format: "MM-DD 周X HH:MM" or "—" for empty/invalid values. */
export function formatHumanDatetimeWithWeekday(value?: string): string {
  if (!value) {
    return "—";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // date-only string → just return short date, no time component
    const parts = value.split("-");
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${WEEKDAY_NAMES[date.getDay()]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${WEEKDAY_NAMES[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
