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

export function formatHumanDate(value?: string): string {
  const key = toDateKey(value);
  return key || "未设置";
}

export function formatHumanDatetime(value?: string): string {
  return formatHumanDatetimeOrEmpty(value) || "未设置";
}

export function formatHumanDatetimeOrEmpty(value?: string): string {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return value.slice(0, 16).replace("T", " ");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (input: number) => input.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatMonthDay(value?: string): string {
  const key = toDateKey(value);
  return key ? key.slice(5) : "未设置";
}
