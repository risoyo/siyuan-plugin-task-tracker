import type { TaskItem } from "./types";

export interface TaskTreeNode {
  task: TaskItem;
  children: TaskTreeNode[];
  descendantCount: number;
}

export interface TaskTreeResult {
  root?: TaskTreeNode;
  skippedLinks: number;
}

/** Build from the complete task index, never from a filtered view or note text. */
export function buildDescendantTree(tasks: TaskItem[], rootId: string): TaskTreeResult {
  const byId = new Map<string, TaskItem>();
  const byDocId = new Map<string, TaskItem>();
  let skippedLinks = 0;
  for (const task of tasks) {
    if (!task?.id || byId.has(task.id)) {
      skippedLinks += 1;
      continue;
    }
    byId.set(task.id, task);
    if (task.docId && !byDocId.has(task.docId)) byDocId.set(task.docId, task);
  }

  const rootTask = byId.get(rootId);
  if (!rootTask) return { skippedLinks };

  const childrenByParent = new Map<string, TaskItem[]>();
  for (const task of byId.values()) {
    if (!task.parentId) continue;
    const parent = byId.get(task.parentId) || byDocId.get(task.parentId);
    if (!parent) {
      skippedLinks += 1;
      continue;
    }
    const siblings = childrenByParent.get(parent.id) || [];
    siblings.push(task);
    childrenByParent.set(parent.id, siblings);
  }

  const visited = new Set<string>();
  const build = (task: TaskItem): TaskTreeNode | undefined => {
    if (visited.has(task.id)) {
      skippedLinks += 1;
      return undefined;
    }
    visited.add(task.id);
    const children = (childrenByParent.get(task.id) || [])
      .map(build)
      .filter((child): child is TaskTreeNode => Boolean(child));
    return {
      task,
      children,
      descendantCount: children.reduce((count, child) => count + 1 + child.descendantCount, 0)
    };
  };

  return { root: build(rootTask), skippedLinks };
}

export interface PositionedTaskNode {
  node: TaskTreeNode;
  x: number;
  y: number;
  depth: number;
  collapsed: boolean;
}

export interface TaskTreeLayout {
  nodes: PositionedTaskNode[];
  width: number;
  height: number;
}

export const TREE_CARD_WIDTH = 244;
export const TREE_CARD_HEIGHT = 80;
export const TREE_COLUMN_GAP = 96;
export const TREE_ROW_GAP = 22;
export const TREE_PADDING = 48;

/** Leaf rows establish spacing; each parent is centered over its visible children. */
export function layoutTaskTree(root: TaskTreeNode, collapsedIds: ReadonlySet<string>): TaskTreeLayout {
  const nodes: PositionedTaskNode[] = [];
  let leafIndex = 0;
  let maxDepth = 0;
  const place = (node: TaskTreeNode, depth: number): number => {
    const collapsed = collapsedIds.has(node.task.id) && node.children.length > 0;
    const childCenters = collapsed ? [] : node.children.map((child) => place(child, depth + 1));
    const centerY = childCenters.length
      ? (childCenters[0] + childCenters[childCenters.length - 1]) / 2
      : TREE_PADDING + leafIndex++ * (TREE_CARD_HEIGHT + TREE_ROW_GAP) + TREE_CARD_HEIGHT / 2;
    maxDepth = Math.max(maxDepth, depth);
    nodes.push({
      node,
      x: TREE_PADDING + depth * (TREE_CARD_WIDTH + TREE_COLUMN_GAP),
      y: centerY - TREE_CARD_HEIGHT / 2,
      depth,
      collapsed
    });
    return centerY;
  };
  place(root, 0);
  return {
    nodes,
    width: TREE_PADDING * 2 + TREE_CARD_WIDTH + maxDepth * (TREE_CARD_WIDTH + TREE_COLUMN_GAP),
    height: TREE_PADDING * 2 + Math.max(1, leafIndex) * TREE_CARD_HEIGHT + Math.max(0, leafIndex - 1) * TREE_ROW_GAP
  };
}
