# `@deepseek-ai/dsh-tool-work-scheduler`

[English](README.md) | 中文

这是一个 Agent 作用域的 `sync_work_scheduler` 工具，用于把开发 SOP 投影到工作调度。可通过 [`@deepseek-ai/dsh-work-scheduler`](../../bundle/work-scheduler/README.md) 安装，也可在 `agents`、`tools`、`workspaceRegistry` 和 `workSchedulerStore` 之后直接加载。插件会为当前及未来的每个 root Agent 挂载工具，并随所属 Agent scope 或插件 fiber 移除注册。

调用方提交完整且有序的工作流阶段列表，每个阶段包含稳定 key、显示名称以及 `pending`、`in_progress` 或 `completed` 状态。工具从执行上下文取得当前 Session，查找其经过校验的 Session 账户包含该 Session 的唯一 Workspace，加载对应 Workspace 的调度文档，并且只替换 `sop:<sessionId>:` 下的任务 id。人工任务和其他 Session 的 SOP 投影保持不变。待处理阶段映射为 ready 任务，唯一活动阶段映射为 running，已完成阶段进入归档。每个投影任务都保存当前 Session ID，因此浏览器可以通过原生导航打开该 Session。

阶段 key 只能使用小写字母、数字和内部连字符；名称与工作流名称不得为空，key 不得重复，活动阶段最多一个。输入无效、Session 没有所属 Workspace，或 Session 异常地属于多个 Workspace 时，工具不会保存并直接失败。重复提交相同快照会保留任务时间戳；重新打开已完成阶段时，任务会离开归档并返回其流程。

存储采用整份文档的 last-write-wins 替换。浏览器编辑与模型同步并发时可能互相覆盖；本包不提供 compare-and-set 或锁。

## 模型体验

### 工具 schema

#### 模型看到的内容

每个 root Agent 都会获得生成的 [`sync_work_scheduler` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-work-scheduler)，其中工作流名称和完整有序阶段快照是必填项。

#### Token 影响

工具可见时，每次请求都会承担固定的 schema token 开销。

#### KV Cache 影响

定义与可见性不变时前缀稳定；插件或 Agent 生命周期变化可能使该 schema 的缓存复用失效。

### 工具调用历史与结果

#### 模型看到的内容

每次 assistant 工具调用都会在参数中保留完整的阶段快照。成功结果包含解析出的 Workspace ID、Session ID、确定性 process ID 和各 SOP 状态计数，但不返回调度文档。校验、Workspace 解析与存储失败沿用普通工具错误路径。

#### Token 影响

调用 token 随工作流阶段数量及名称增长；紧凑结果的字段固定，体积较小。

#### KV Cache 影响

仅追加；工具参数与结果位于可复用请求前缀之后，不会使已有 KV-cache 条目失效。

## 已知限制与延期工作

- **并发整份文档写入采用 last-write-wins** — 浏览器编辑与模型同步重叠时可能互相覆盖，因为存储不提供 compare-and-set 或锁。
