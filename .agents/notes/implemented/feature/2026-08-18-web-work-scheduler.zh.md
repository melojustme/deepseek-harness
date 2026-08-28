# Agent Note: Workspace 持久化工作调度板

Status: implemented

[English](2026-08-18-web-work-scheduler.md) | 中文

## 问题

个人调度需要在 dsh Web 中获得持久位置，同时不能把人的规划状态变成模型上下文或 Session 历史。给定原型把独立工作流表示为有序线程，并区分两类阻塞：同步阻塞会暂停一条线程的后续工作，异步阻塞会释放该线程并保留任务返回位置。

## 决策

`@deepseek-ai/dsh-client-ui-work-scheduler` 向 `sidebar.footer.action` 贡献入口，向 `shell.overlay` 贡献全屏面板，两个条目通过同一个插件 store 共享打开状态和调度文档。打开任务所关联的 Session 时，插件通过客户端 runtime 选中该 Session 并关闭面板，以显示对应对话。该方案使用已声明的 UI 扩展点，不改变会话所有者或 agent loop。

调度转换是针对版本 2 JSON 文档的纯函数。每个任务只能位于一个线程、待分配列表、阻塞列表或归档中。任务转为异步阻塞时记录原线程或待分配索引；唤醒时，如果原线程仍存在，就恢复到该位置。原生卡片拖放把同线程排序和跨线程移动委托给同一个 `moveTask` 转换。导入规范化会先移除重复和悬空位置，再按状态安置尚未放置的任务。

`@deepseek-ai/dsh-work-scheduler-store` 通过 `work_scheduler` 存储领域为每个 Workspace 保存一份文档。独立的 `@deepseek-ai/dsh-work-scheduler` bundle 把该领域路由到 SQLite，并在 `@deepseek-ai/dsh-web-app` 之后挂载存储与浏览器插件；现有 API proxy 提供 `workScheduler.load` 与 `workScheduler.save`。浏览器依次解析当前 Session 所属的 Workspace、最近使用的 Workspace 或首个 Workspace，在启用编辑前完成加载，并对文档变化进行 400 ms 防抖保存。加载或保存失败后，面板保持只读，直到下一次重新加载持久副本。没有 Workspace 时，看板只保存在内存中且不调用 Host。

可选 Session ID 是任务关联唯一的持久化权威。浏览器从当前 Workspace 的 Session 注册表投影最新标题，并在关联有效时使用原生 Session 导航。Session 缺失或不属于该 Workspace 时，关联仍显示为`会话不可用`且不能导航；存储的 ID 会继续保留，后续注册表变化可以让关联重新有效。

`@deepseek-ai/dsh-tool-work-scheduler` 向当前及未来的每个 root Agent 提供 `sync_work_scheduler`。工具从执行上下文取得调用 Session，要求该 Session 只属于一个经过校验的 Workspace，并在确定性的 `sop:<sessionId>` process 与 task id 下投影完整且有序的 SOP 阶段快照。待处理、活动和已完成阶段分别成为 ready、running 和 archived 任务；每个投影任务都携带调用 Session ID。同步只替换当前 Session 的 `sop:` 命名空间，保留人工任务和其他 Session 的工作，在输入相同时保留时间戳，并允许已完成阶段重新变为活动状态。

完整调度文档不会进入模型请求或 Session 日志。模型看到同步 schema，通过普通的已记录工具调用提交 SOP 快照，并且只收到解析出的标识与状态计数。Host 持久化之外，导入导出还提供显式 JSON 迁移能力。

## 曾考虑的替代方案

**用 iframe 嵌入独立 HTML。** 这会重复 dsh 的主题、交互与持久化行为，并绕过客户端插件卸载。

**替换会话 slot。** 调度是独立的人用视图，不是 Session 渲染模式。

**继续以浏览器 localStorage 为权威数据。** 浏览器配置文件状态无法让多个浏览器客户端共享同一份按 Workspace 持久化的看板。Host 存储领域可以提供这种所有权，又不会把规划状态写入 Session 历史。

**在客户端包的 Node 半部实现存储。** 独立 Host 包让浏览器呈现与持久存储可以分别组合，并允许 Web bundle 通过现有 storage domain 选择后端。

**复用 `todo_write` 记录 SOP 进度。** `todo_write` 拥有当前 Session 的整表替换式实现计划。SOP 阶段和实现任务的粒度与更新频率不同，共用一份列表会让任一写入方清除另一方的状态。

## 后果

随附 Web profile 依次组合 base、Web app 与调度 bundle。它从侧栏提供调度入口，在 Host 重启后保留调度文档，并且在不增加全局工具的情况下向 root Agent 提供 SOP 同步工具。纯状态转换测试固定阻塞、唤醒、归档、拖放位置、导入规范化、异步返回位置、按 Session 隔离的 SOP 替换、幂等性和阶段回退；Loader 与随附组合测试固定 SQLite 持久化及 Agent 作用域注册。并发编辑采用后写胜出，删除 Workspace 后仍会留下调度文档，预发布版本 2 格式没有迁移路径。调度状态可以定位 Session，但对 Session、工作流、后台作业和子 agent 没有控制权。
