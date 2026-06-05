import {
  ACTIVE_TASK_STATUSES,
  CANCELLED_TASK_STATUS,
  COMPLETED_TASK_STATUS,
  STATUS_FILTER_OPTIONS,
  SYSTEM_TASK_STATUS_IDS,
  TASK_STATUS_LABELS,
  TODO_TASK_STATUS,
  type StatusBadgeConfig,
  type StatusColorPreset,
  type StatusFilterOption,
  type SystemTaskStatus,
  type TaskSettings,
  type TaskStatus,
  type TaskStatusOption
} from "./types";

const STATUS_COLOR_PRESETS: Record<StatusColorPreset, Omit<StatusBadgeConfig, "label">> = {
  orange: { textColor: "#C2410C", bgColor: "#FFF7ED", borderColor: "#FED7AA", dotColor: "#F97316" },
  blue: { textColor: "#1D4ED8", bgColor: "#EFF6FF", borderColor: "#BFDBFE", dotColor: "#2563EB" },
  purple: { textColor: "#6D28D9", bgColor: "#F5F3FF", borderColor: "#DDD6FE", dotColor: "#8B5CF6" },
  green: { textColor: "#15803D", bgColor: "#F0FDF4", borderColor: "#BBF7D0", dotColor: "#16A34A" },
  slate: { textColor: "#475569", bgColor: "#F8FAFC", borderColor: "#CBD5E1", dotColor: "#94A3B8" },
  red: { textColor: "#B91C1C", bgColor: "#FEF2F2", borderColor: "#FECACA", dotColor: "#EF4444" }
};

const SYSTEM_STATUS_COLOR_PRESETS: Record<SystemTaskStatus, StatusColorPreset> = {
  todo: "orange",
  doing: "blue",
  waiting: "purple",
  completed: "green",
  cancelled: "slate"
};

const FALLBACK_BADGE_CONFIG: StatusBadgeConfig = {
  label: "未知状态",
  textColor: "#475569",
  bgColor: "#F8FAFC",
  borderColor: "#CBD5E1",
  dotColor: "#94A3B8"
};

export const STATUS_COLOR_PRESET_OPTIONS: Array<{ value: StatusColorPreset; label: string }> = [
  { value: "orange", label: "橙色" },
  { value: "blue", label: "蓝色" },
  { value: "purple", label: "紫色" },
  { value: "green", label: "绿色" },
  { value: "slate", label: "灰色" },
  { value: "red", label: "红色" }
];

export function defaultStatusOptions(): TaskStatusOption[] {
  return SYSTEM_TASK_STATUS_IDS.map((id, index) => ({
    id,
    label: TASK_STATUS_LABELS[id],
    color: SYSTEM_STATUS_COLOR_PRESETS[id],
    order: index,
    isSystemSemantic: id === COMPLETED_TASK_STATUS || id === CANCELLED_TASK_STATUS
  }));
}

export function normalizeStatusOptions(settings?: TaskSettings | null): TaskStatusOption[] {
  const configured = Array.isArray(settings?.statusOptions) ? settings?.statusOptions : [];
  const normalized: TaskStatusOption[] = [];
  const seen = new Set<string>();

  configured.forEach((option, index) => {
    if (!option || typeof option !== "object") {
      return;
    }
    const id = normalizeStatusId(option.id);
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    normalized.push({
      id,
      label: normalizeStatusLabel(option.label, id),
      color: normalizeStatusColor(option.color),
      order: typeof option.order === "number" ? option.order : index,
      isSystemSemantic: id === COMPLETED_TASK_STATUS || id === CANCELLED_TASK_STATUS
    });
  });

  SYSTEM_TASK_STATUS_IDS.forEach((id) => {
    if (seen.has(id)) {
      return;
    }
    normalized.push({
      id,
      label: TASK_STATUS_LABELS[id],
      color: SYSTEM_STATUS_COLOR_PRESETS[id],
      order: normalized.length,
      isSystemSemantic: id === COMPLETED_TASK_STATUS || id === CANCELLED_TASK_STATUS
    });
  });

  return normalized
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "zh-Hans-CN"))
    .map((option, index) => ({ ...option, order: index }));
}

export function statusOptionsMap(settings?: TaskSettings | null): Map<string, TaskStatusOption> {
  return new Map(normalizeStatusOptions(settings).map((option) => [option.id, option]));
}

export function getStatusOption(status: TaskStatus, settings?: TaskSettings | null): TaskStatusOption {
  const configured = statusOptionsMap(settings).get(status);
  if (configured) {
    return configured;
  }
  const systemId = asSystemStatus(status);
  if (systemId) {
    return {
      id: systemId,
      label: TASK_STATUS_LABELS[systemId],
      color: SYSTEM_STATUS_COLOR_PRESETS[systemId],
      order: SYSTEM_TASK_STATUS_IDS.indexOf(systemId),
      isSystemSemantic: systemId === COMPLETED_TASK_STATUS || systemId === CANCELLED_TASK_STATUS
    };
  }
  return {
    id: status,
    label: status?.trim() || FALLBACK_BADGE_CONFIG.label,
    color: "slate",
    order: Number.MAX_SAFE_INTEGER
  };
}

export function getStatusLabel(status: TaskStatus, settings?: TaskSettings | null): string {
  return getStatusOption(status, settings).label;
}

export function getStatusBadgeConfig(status: TaskStatus, settings?: TaskSettings | null): StatusBadgeConfig {
  const option = getStatusOption(status, settings);
  const preset = STATUS_COLOR_PRESETS[option.color] || STATUS_COLOR_PRESETS.slate;
  return {
    label: option.label,
    textColor: preset.textColor,
    bgColor: preset.bgColor,
    borderColor: preset.borderColor,
    dotColor: preset.dotColor
  };
}

export function getStatusFilterOptions(settings?: TaskSettings | null): StatusFilterOption[] {
  const options = normalizeStatusOptions(settings);
  const systemFallback = new Map(STATUS_FILTER_OPTIONS.map((item) => [item.key, item]));
  const filterOptions: StatusFilterOption[] = [{ key: "all", label: "全部任务" }];
  options
    .filter((option) => option.id !== COMPLETED_TASK_STATUS)
    .forEach((option) => {
      const fallback = systemFallback.get(option.id);
      filterOptions.push({
        key: option.id,
        label: fallback?.label || option.label,
        statusFilter: option.id
      });
    });
  return filterOptions;
}

export function getAllOrderedStatuses(settings?: TaskSettings | null): TaskStatus[] {
  return normalizeStatusOptions(settings).map((option) => option.id);
}

export function getKanbanStatuses(settings?: TaskSettings | null): TaskStatus[] {
  return normalizeStatusOptions(settings)
    .map((option) => option.id)
    .filter((status) => status !== COMPLETED_TASK_STATUS);
}

export function getActiveTaskStatuses(settings?: TaskSettings | null): TaskStatus[] {
  const options = normalizeStatusOptions(settings).map((option) => option.id);
  const active = options.filter((status) => status !== COMPLETED_TASK_STATUS && status !== CANCELLED_TASK_STATUS);
  return active.length ? active : [...ACTIVE_TASK_STATUSES];
}

export function isCompletedTaskStatus(status: TaskStatus): boolean {
  return status === COMPLETED_TASK_STATUS;
}

export function isCancelledTaskStatus(status: TaskStatus): boolean {
  return status === CANCELLED_TASK_STATUS;
}

export function isProtectedStatus(status: TaskStatus): boolean {
  return isCompletedTaskStatus(status) || isCancelledTaskStatus(status);
}

export function defaultTaskStatus(settings?: TaskSettings | null): TaskStatus {
  const options = normalizeStatusOptions(settings);
  return options.find((option) => option.id === TODO_TASK_STATUS)?.id || options[0]?.id || TODO_TASK_STATUS;
}

export function normalizeStoredTaskStatus(status: unknown, settings?: TaskSettings | null): TaskStatus {
  if (typeof status !== "string") {
    return defaultTaskStatus(settings);
  }
  const normalized = status.trim();
  return normalized || defaultTaskStatus(settings);
}

function normalizeStatusId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeStatusLabel(value: unknown, id: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const systemId = asSystemStatus(id);
  return systemId ? TASK_STATUS_LABELS[systemId] : id;
}

function normalizeStatusColor(value: unknown): StatusColorPreset {
  return typeof value === "string" && value in STATUS_COLOR_PRESETS
    ? (value as StatusColorPreset)
    : "blue";
}

function asSystemStatus(status: TaskStatus): SystemTaskStatus | undefined {
  return (SYSTEM_TASK_STATUS_IDS as readonly string[]).includes(status)
    ? (status as SystemTaskStatus)
    : undefined;
}
