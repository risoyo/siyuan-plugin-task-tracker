import { Dialog, Setting, showMessage } from "siyuan";
import type { TaskService } from "./document";
import { DEFAULT_TASK_TEMPLATE } from "./types";

export function createTaskSettings(
  service: TaskService,
  actions: {
    setCurrentDocAsRoot: () => Promise<void>;
    setRootDocId: (docId: string) => Promise<void>;
    syncDeletedTasks: () => Promise<void>;
    rebuildTaskIndex: () => Promise<void>;
    refreshViews: () => void;
  },
  version: string
): Setting {
  const defaultProjectInput = document.createElement("input");
  defaultProjectInput.className = "b3-text-field fn__block";
  defaultProjectInput.placeholder = "例如：工作 / 产品 / 客户A";
  defaultProjectInput.value = service.store.getSettings().defaultProject || "";

  const rootDocIdInput = document.createElement("input");
  rootDocIdInput.className = "b3-text-field fn__block task-tracker-setting__doc-id";
  rootDocIdInput.placeholder = "粘贴文档 ID，例如：20260506092200-qynf33g";
  rootDocIdInput.value = service.store.getSettings().taskRootDocId || "";

  const templateInput = document.createElement("textarea");
  templateInput.className = "b3-text-field fn__block task-tracker-setting__template";
  templateInput.spellcheck = false;
  templateInput.value = service.store.getSettings().taskTemplate || DEFAULT_TASK_TEMPLATE;

  const setting = new Setting({
    confirmCallback: async () => {
      await service.store.setSettings({
        defaultProject: defaultProjectInput.value.trim() || undefined,
        taskTemplate: templateInput.value.trim() || undefined
      });
      actions.refreshViews();
      showMessage("任务追踪设置已保存");
    }
  });

  setting.addItem({
    title: "默认项目",
    description: "新建任务时自动填入，可在创建时修改。",
    createActionElement: () => defaultProjectInput
  });

  setting.addItem({
    title: "事项库",
    description: service.store.getSettings().taskRootTitle
      ? `当前：${service.store.getSettings().taskRootTitle}`
      : "尚未设置。请在文档菜单中复制 ID，粘贴到右侧后绑定。",
    createActionElement: () => {
      const wrapper = document.createElement("div");
      wrapper.className = "fn__flex task-tracker-setting__root";

      const bindButton = document.createElement("button");
      bindButton.className = "b3-button b3-button--outline fn__size160";
      bindButton.textContent = "绑定 ID";
      bindButton.addEventListener("click", () => {
        void actions.setRootDocId(rootDocIdInput.value);
      });

      const currentButton = document.createElement("button");
      currentButton.className = "b3-button b3-button--outline fn__size160";
      currentButton.textContent = "当前文档";
      currentButton.title = "快捷设置，若识别失败请使用文档 ID";
      currentButton.addEventListener("click", () => {
        void actions.setCurrentDocAsRoot();
      });

      wrapper.append(rootDocIdInput, bindButton, currentButton);
      return wrapper;
    }
  });

  setting.addItem({
    title: "任务维护",
    description: "清理失效索引，或在换设备/同步异常后从事项库文档重建任务索引。",
    createActionElement: () => {
      const wrapper = document.createElement("div");
      wrapper.className = "fn__flex task-tracker-setting__root";

      const cleanupButton = document.createElement("button");
      cleanupButton.className = "b3-button b3-button--outline fn__size200";
      cleanupButton.textContent = "清理已删除任务记录";
      cleanupButton.addEventListener("click", () => {
        void actions.syncDeletedTasks();
      });

      const rebuildButton = document.createElement("button");
      rebuildButton.className = "b3-button b3-button--outline fn__size200";
      rebuildButton.textContent = "从事项库重建任务索引";
      rebuildButton.title = "扫描事项库下的任务文档并重建 tasks.json";
      rebuildButton.addEventListener("click", () => {
        void actions.rebuildTaskIndex();
      });

      wrapper.append(cleanupButton, rebuildButton);
      return wrapper;
    }
  });

  setting.addItem({
    title: "任务模板",
    description: "新建任务文档时使用。保留元信息占位符后，任务追踪面板中的状态和日期会同步回笔记。",
    createActionElement: () => {
      const wrapper = document.createElement("div");
      wrapper.className = "task-tracker-setting__template-wrap";

      const actionsRow = document.createElement("div");
      actionsRow.className = "fn__flex task-tracker-setting__template-actions";

      const resetButton = document.createElement("button");
      resetButton.className = "b3-button b3-button--outline";
      resetButton.textContent = "恢复默认模板";
      resetButton.addEventListener("click", () => {
        templateInput.value = DEFAULT_TASK_TEMPLATE;
      });

      actionsRow.append(resetButton);
      wrapper.append(templateInput, actionsRow);
      return wrapper;
    }
  });

  setting.addItem({
    title: "使用帮助",
    description: "查看事项库设置、任务创建、任务控制面板、任务维护、模板占位符和版本规则。",
    createActionElement: () => {
      const button = document.createElement("button");
      button.className = "b3-button b3-button--outline fn__size200";
      button.textContent = "打开使用帮助";
      button.addEventListener("click", () => showHelpDialog());
      return button;
    }
  });

  setting.addItem({
    title: "插件版本",
    description: `当前版本：v${version}`,
    createActionElement: () => {
      const value = document.createElement("div");
      value.className = "task-tracker-setting__version";
      value.textContent = `v${version}`;
      return value;
    }
  });

  return setting;
}

function showHelpDialog(): void {
  new Dialog({
    title: "任务追踪使用帮助",
    content: `<div class="b3-dialog__content task-tracker-help">
  <h2>一、事项库</h2>
  <p>先在目标笔记本中新建一个文档，例如“事项库”，在思源中复制该文档 ID，然后在插件设置里绑定。后续新任务会作为事项库的子文档创建，子任务会作为父任务文档的子文档创建。</p>

  <h2>二、创建任务</h2>
  <p>可以从右上角插件菜单新建任务，也可以从当前文档或当前块创建任务。任务字段包括项目、状态、优先级、计划开始、计划结束、截止日期和父任务。</p>

  <h2>三、任务追踪侧栏</h2>
  <p>“全部”显示所有未完成任务；“焦点”显示进行中、今天及以前需要关注的任务；“未安排”显示没有计划开始时间的任务；“今日”“逾期”“完成”分别显示对应状态。子任务会折叠在父任务下方，点击箭头展开或收起。</p>

  <h2>四、任务控制面板</h2>
  <p>可以从右上角插件菜单或任务追踪侧栏打开任务控制面板。面板内提供表格、清单、时间轴、看板和日历五种视图；日历按计划开始时间展示任务，没有计划开始时间的任务会进入右侧“未安排”。月份标题两侧按钮可切换前后月份，月份选择框可快速跳转。</p>

  <h2>五、任务维护</h2>
  <p>删除思源任务文档后，插件会自动清理对应任务记录；如需手动处理，可在插件设置里的“任务维护”中点击“清理已删除任务记录”。任务卡片上的删除按钮只会从插件记录中移除任务，不会删除思源文档。</p>

  <h2>六、任务模板占位符</h2>
  <p>模板支持：<code>{{title}}</code>、<code>{{source}}</code>、<code>{{parent}}</code>、<code>{{project}}</code>、<code>{{status}}</code>、<code>{{priority}}</code>、<code>{{dueDate}}</code>、<code>{{planStart}}</code>、<code>{{planEnd}}</code>、<code>{{childTasks}}</code>、<code>{{childTaskList}}</code>、<code>{{createdAt}}</code>、<code>{{updatedAt}}</code>。</p>
  <p>建议保留默认模板中的引用信息区，插件会同步更新这一区域里的状态、优先级、日期和子任务链接。</p>

  <h2>七、版本规则</h2>
  <p>大版本用于明显不兼容或架构变化；小版本用于新增功能；错误修复用于不改变功能面的 bug 修复。每次构建后的插件压缩包会放入项目的 <code>release</code> 文件夹。</p>
</div>`,
    width: "760px",
    height: "620px"
  });
}
