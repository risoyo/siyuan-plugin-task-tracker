import { getBlockById } from "../api";
import type { TaskService } from "../document";
import { escapeHtml } from "../dialogs/TaskDialog";
import { getStatusBadgeConfig } from "../statusConfig";
import { buildDescendantTree, layoutTaskTree, TREE_CARD_HEIGHT, TREE_CARD_WIDTH, type PositionedTaskNode, type TaskTreeLayout } from "../taskTree";
import type { TaskItem } from "../types";

interface TaskTreeActions {
  editTask: (task: TaskItem) => void;
  returnToEditor: () => void;
  hasParkedEditor: () => boolean;
  updateTitle: (title: string) => void;
  closeTab: () => void;
}

const MIN_SCALE = 0.85;
const MAX_SCALE = 2.5;
const icon = (path: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  refresh: icon('<path d="M20 11a8 8 0 1 0-2.4 6M20 4v7h-7"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  fit: icon('<path d="M8 3H4v4M16 3h4v4M4 17v4h4M20 17v4h-4"/>'),
  target: icon('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>'),
  back: icon('<path d="M15 18l-6-6 6-6"/>'),
  chevron: icon('<path d="M9 6l6 6-6 6"/>')
};

export class TaskTreeTab {
  private collapsedIds = new Set<string>();
  private layout?: TaskTreeLayout;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private hasInitialFit = false;
  private destroyed = false;
  private busy = false;
  private error = "";
  private rootMissing = false;
  private pan?: { pointerId: number; x: number; y: number; offsetX: number; offsetY: number };
  private unsubscribe: () => void;

  constructor(
    private container: HTMLElement,
    private service: TaskService,
    readonly rootTaskId: string,
    private actions: TaskTreeActions
  ) {
    this.unsubscribe = service.onChange(() => this.render());
    this.container.addEventListener("click", this.onClick);
    this.container.addEventListener("wheel", this.onWheel, { passive: false });
    this.container.addEventListener("pointerdown", this.onPointerDown);
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerup", this.onPointerUp);
    this.container.addEventListener("pointercancel", this.onPointerUp);
  }

  async initialize(): Promise<void> {
    this.render();
    await this.checkRootDocument();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.container.removeEventListener("click", this.onClick);
    this.container.removeEventListener("wheel", this.onWheel);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerup", this.onPointerUp);
    this.container.removeEventListener("pointercancel", this.onPointerUp);
    this.pan = undefined;
    this.container.replaceChildren();
  }

  resize(): void {
    if (!this.hasInitialFit && this.layout) this.fit();
  }

  render(): void {
    if (this.destroyed) return;
    const result = buildDescendantTree(this.service.store.all(), this.rootTaskId);
    const root = this.rootMissing ? undefined : result.root;
    const title = root?.task.title || "任务树";
    this.actions.updateTitle(`任务树 · ${title}`);
    this.layout = root ? layoutTaskTree(root, this.collapsedIds) : undefined;
    const positions = this.layout?.nodes || [];
    const byId = new Map(positions.map((position) => [position.node.task.id, position]));
    const paths = positions.flatMap((position) => position.collapsed ? [] : position.node.children.flatMap((child) => {
      const target = byId.get(child.task.id);
      if (!target) return [];
      const sx = position.x + TREE_CARD_WIDTH;
      const sy = position.y + TREE_CARD_HEIGHT / 2;
      const tx = target.x;
      const ty = target.y + TREE_CARD_HEIGHT / 2;
      const bend = (tx - sx) / 2;
      return [`<path d="M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}"/>`];
    }));

    this.container.innerHTML = `<section class="task-tree">
  <header class="task-tree__header">
    <div class="task-tree__heading"><strong>任务树</strong><span class="task-tree__root-title" title="${escapeAttr(title)}">${escapeHtml(title)}</span><span class="task-tree__count">${root?.descendantCount || 0} 个后代任务</span></div>
    <div class="task-tree__actions">
      ${this.actions.hasParkedEditor() ? `<button type="button" data-tree-action="return" title="返回编辑弹窗">${ICONS.back}返回编辑</button>` : ""}
      <button type="button" data-tree-action="refresh" ${this.busy ? "disabled" : ""} title="重新读取任务关系">${ICONS.refresh}${this.busy ? "刷新中" : "刷新"}</button>
    </div>
  </header>
  <div class="task-tree__toolbar" role="toolbar" aria-label="任务树画布工具">
    <button type="button" data-tree-action="zoom-in" title="放大">${ICONS.plus}放大</button>
    <button type="button" data-tree-action="zoom-out" title="缩小">${ICONS.minus}缩小</button>
    <button type="button" data-tree-action="fit" title="适应画布">${ICONS.fit}适应画布</button>
    <button type="button" data-tree-action="reset" title="恢复 100%">100%</button>
    <button type="button" data-tree-action="root" title="定位根节点">${ICONS.target}根节点</button>
    <button type="button" data-tree-action="expand" title="展开全部节点">全部展开</button>
    <button type="button" data-tree-action="collapse" title="收起一级节点以下的任务">全部收起</button>
    <span class="task-tree__zoom" data-tree-zoom>${Math.round(this.scale * 100)}%</span>
  </div>
  ${result.skippedLinks && root ? `<div class="task-tree__notice">已跳过 ${result.skippedLinks} 条无效或循环关联。</div>` : ""}
  <div class="task-tree__viewport" data-tree-viewport>
    ${this.error ? `<div class="task-tree__empty task-tree__empty--error">读取任务失败：${escapeHtml(this.error)}<button type="button" data-tree-action="refresh">重试</button></div>`
      : !root ? `<div class="task-tree__empty">任务不存在或已删除。<button type="button" data-tree-action="close">关闭标签页</button></div>`
      : `<div class="task-tree__stage" data-tree-stage style="width:${this.layout?.width}px;height:${this.layout?.height}px;">
        <svg class="task-tree__links" width="${this.layout?.width}" height="${this.layout?.height}" aria-hidden="true">${paths.join("")}</svg>
        ${positions.map((position) => this.renderNode(position)).join("")}
      </div>${root.children.length ? "" : `<div class="task-tree__hint">暂无子任务</div>`}`}
  </div>
</section>`;
    this.applyTransform();
    if (this.layout && !this.hasInitialFit) requestAnimationFrame(() => {
      if (!this.destroyed && this.layout && !this.hasInitialFit) this.fit();
    });
  }

  private renderNode(position: PositionedTaskNode): string {
    const { task, children, descendantCount } = position.node;
    const status = getStatusBadgeConfig(task.status, this.service.store.getSettings());
    const hasChildren = children.length > 0;
    return `<div class="task-tree__node ${position.depth === 0 ? "task-tree__node--root" : ""}" data-tree-node="${escapeAttr(task.id)}" style="left:${position.x}px;top:${position.y}px;">
  <button class="task-tree__card" type="button" data-tree-action="edit" data-task-id="${escapeAttr(task.id)}" title="${escapeAttr(task.title)} · 点击编辑任务">
    <span class="task-tree__node-title">${escapeHtml(task.title)}</span>
    <span class="task-tree__node-meta"><span class="task-tree__status" style="--tree-dot:${status.dotColor};--tree-status-bg:${status.bgColor};--tree-status-text:${status.textColor};">${escapeHtml(status.label)}</span>${hasChildren ? `<span class="task-tree__child-count">${children.length} 个子任务</span>` : ""}</span>
  </button>
  ${hasChildren ? `<button class="task-tree__toggle" type="button" data-tree-action="toggle" data-task-id="${escapeAttr(task.id)}" title="${position.collapsed ? `展开子任务（隐藏 ${descendantCount} 个）` : "收起子任务"}" aria-label="${position.collapsed ? "展开子任务" : "收起子任务"}">${position.collapsed ? ICONS.plus : ICONS.minus}</button>` : ""}
  ${position.collapsed ? `<span class="task-tree__hidden-count">隐藏 ${descendantCount} 个</span>` : ""}
</div>`;
  }

  private async checkRootDocument(): Promise<void> {
    const task = this.service.store.get(this.rootTaskId);
    if (!task) return;
    try {
      this.rootMissing = !(await getBlockById(task.docId));
      this.error = "";
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.render();
  }

  private async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.render();
    try {
      await this.service.startupSync({ skipDeletedCleanup: false });
      this.rootMissing = false;
      await this.checkRootDocument();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private onClick = (event: MouseEvent): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-tree-action]");
    if (!button || !this.container.contains(button)) return;
    const action = button.dataset.treeAction;
    if (action === "edit") {
      const task = this.service.store.get(button.dataset.taskId || "");
      if (task) this.actions.editTask(task);
    } else if (action === "toggle") {
      const id = button.dataset.taskId || "";
      if (this.collapsedIds.has(id)) this.collapsedIds.delete(id);
      else this.collapsedIds.add(id);
      this.render();
    } else if (action === "refresh") void this.refresh();
    else if (action === "zoom-in") this.zoomAt(this.scale * 1.2);
    else if (action === "zoom-out") this.zoomAt(this.scale / 1.2);
    else if (action === "fit") this.fit();
    else if (action === "reset") this.zoomAt(1);
    else if (action === "root") this.centerRoot();
    else if (action === "expand") { this.collapsedIds.clear(); this.render(); }
    else if (action === "collapse") {
      this.collapsedIds.clear();
      const result = buildDescendantTree(this.service.store.all(), this.rootTaskId);
      result.root?.children.forEach((child) => { if (child.children.length) this.collapsedIds.add(child.task.id); });
      this.render();
    } else if (action === "return") this.actions.returnToEditor();
    else if (action === "close") this.actions.closeTab();
  };

  private onWheel = (event: WheelEvent): void => {
    const viewport = (event.target as Element).closest<HTMLElement>("[data-tree-viewport]");
    if (!viewport || !this.layout) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.zoomAt(this.scale * factor, event.clientX, event.clientY);
  };

  private onPointerDown = (event: PointerEvent): void => {
    const viewport = (event.target as Element).closest<HTMLElement>("[data-tree-viewport]");
    if (!viewport || !this.layout || event.button !== 0 || (event.target as Element).closest(".task-tree__node, button")) return;
    this.pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: this.offsetX, offsetY: this.offsetY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pan || this.pan.pointerId !== event.pointerId) return;
    this.offsetX = this.pan.offsetX + event.clientX - this.pan.x;
    this.offsetY = this.pan.offsetY + event.clientY - this.pan.y;
    this.applyTransform();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pan || this.pan.pointerId !== event.pointerId) return;
    this.pan = undefined;
    this.container.querySelector("[data-tree-viewport]")?.classList.remove("is-panning");
  };

  private zoomAt(next: number, clientX?: number, clientY?: number): void {
    const viewport = this.container.querySelector<HTMLElement>("[data-tree-viewport]");
    if (!viewport || !this.layout) return;
    const rect = viewport.getBoundingClientRect();
    const x = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const y = (clientY ?? rect.top + rect.height / 2) - rect.top;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    const ratio = scale / this.scale;
    this.offsetX = x - (x - this.offsetX) * ratio;
    this.offsetY = y - (y - this.offsetY) * ratio;
    this.scale = scale;
    this.applyTransform();
  }

  private fit(): void {
    const viewport = this.container.querySelector<HTMLElement>("[data-tree-viewport]");
    if (!viewport || !this.layout || !viewport.clientWidth || !viewport.clientHeight) return;
    this.scale = Math.max(MIN_SCALE, Math.min(1.25, Math.min((viewport.clientWidth - 32) / this.layout.width, (viewport.clientHeight - 32) / this.layout.height)));
    this.offsetX = Math.max(16, (viewport.clientWidth - this.layout.width * this.scale) / 2);
    if (this.layout.height * this.scale > viewport.clientHeight) {
      const root = this.layout.nodes.find((node) => node.depth === 0);
      this.offsetY = root
        ? viewport.clientHeight / 2 - (root.y + TREE_CARD_HEIGHT / 2) * this.scale
        : 16;
    } else {
      this.offsetY = Math.max(16, (viewport.clientHeight - this.layout.height * this.scale) / 2);
    }
    this.hasInitialFit = true;
    this.applyTransform();
  }

  private centerRoot(): void {
    const viewport = this.container.querySelector<HTMLElement>("[data-tree-viewport]");
    const root = this.layout?.nodes.find((node) => node.depth === 0);
    if (!viewport || !root) return;
    this.offsetX = 32 - root.x * this.scale;
    this.offsetY = viewport.clientHeight / 2 - (root.y + TREE_CARD_HEIGHT / 2) * this.scale;
    this.applyTransform();
  }

  private applyTransform(): void {
    const stage = this.container.querySelector<HTMLElement>("[data-tree-stage]");
    if (stage) stage.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
    const zoom = this.container.querySelector<HTMLElement>("[data-tree-zoom]");
    if (zoom) zoom.textContent = `${Math.round(this.scale * 100)}%`;
  }
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#039;");
}
