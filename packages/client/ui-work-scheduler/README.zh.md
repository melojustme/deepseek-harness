# @deepseek-ai/dsh-client-ui-work-scheduler

[English](README.md) | 中文

dsh Web 的线程式个人工作调度插件。它通过现有 slot 系统在侧栏底部注册入口，并在全屏浮层中呈现调度板。每条线程按顺序推进任务：同步阻塞会暂停该线程后方任务，异步阻塞会把任务移入独立等待列表，并保留唤醒后的返回位置。

## 持久化与迁移

打开面板时，插件依次解析当前 Session 所属的 Workspace、最近使用的 Workspace 或首个 Workspace，并通过 `workScheduler.load` 加载对应的带版本 JSON 文档。文档变化经过 400 ms 防抖后保存到 Host。初次加载完成前编辑功能保持禁用，避免浏览器中的旧文档覆盖 Workspace 副本。加载或保存失败后，面板进入只读错误状态；重新打开面板并重新加载持久副本后才恢复编辑。Web bundle 通过 SQLite 上的 [`dsh-work-scheduler-store`](../../work-scheduler/work-scheduler-store/README.md) 持久化文档。

没有 Workspace 时，面板从空文档开始并只保留在内存中，不调用 Host。调度文档不是 Session 数据，也不会进入模型上下文。

导入时会规范化任务状态、位置和异步唤醒来源，移除未知或重复引用，并把其余未放置任务分配到对应的待分配、异步阻塞或归档列表。导出会下载规范化后的 JSON 文档。

## Session 关联与任务移动

新任务可以保存其 Workspace 中一个 Session 的 ID。任务卡从 Session 注册表解析当前显示标题，并通过 dsh 原生导航打开该 Session。文档不会复制标题。如果 Session 不存在或属于其他 Workspace，任务卡保留关联并显示`会话不可用`，且不会执行导航。

可编辑任务卡使用浏览器原生拖动。拖到另一张卡片会相对该卡排序，拖到泳道会追加到对应线程。同线程和跨线程移动都使用调度器的位置转换，因此状态和持久顺序会一起更新。

## 组合

侧栏入口和全屏浮层共享同一个插件自有 store。面板从客户端 runtime 读取 Session 与 Workspace 注册表，并通过 connection 插件进行持久化加载和保存。移除客户端条目会同时撤销两个 slot 贡献。可安装的 [`dsh-work-scheduler`](../../bundle/work-scheduler/README.md) bundle 在 Web 表层所有者之后挂载本插件及其 Host 存储。

## 模型体验

### Workspace 调度状态

#### 模型看到什么

模型看不到通过 `workScheduler.load` 加载的调度文档。本插件不增加提示词、工具 schema、请求字段、Session 事件或模型可见结果。

#### Token 影响

本插件不会向模型请求添加 token。

#### KV Cache 影响

本插件不改变模型请求，因此不会使原本可复用的前缀失效。

## 已知限制与延期工作

- 同一 Workspace 的并发编辑采用后写胜出，不进行合并或冲突检测。
- 没有 Workspace 的看板只保存在内存中。
- 任务关联只会定位到已有 Session；它不会启动、停止或监控 Session、工作流、后台作业或子 agent。
- 导入会在规范化后替换当前文档；插件不会合并两份调度文档。
