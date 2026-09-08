# @deepseek-ai/dsh-work-scheduler-execution

[English](README.md) | 中文

`ctx.workSchedulerExecution` 的服务定义。提供者实现持久化任务准入、取消、线程让出、证据刷新及人工审查。网关是消费者；[本地提供者](../work-scheduler-execution-local/README.md)使用原生 Session 和 Git worktree。

## 服务

`command(workspaceId, command)` 返回持久化调度文档。执行与审查提交携带调用方生成的重试标识；条件修改携带预期文档修订号。提供者校验工作区归属，保留执行轮次快照，拒绝过期审查证据。可在浏览器使用的命令和文档类型位于[网关 API](../../host/apiproxy/README.md)。

## 模型体验

没有直接影响。所选提供者管理全部已记录的模型输入和执行效果。

#### KV Cache 影响

没有直接影响；提供者与预设组合决定模型请求。

## 已知限制与延期工作

- 抽象服务不执行任务。Host 组合必须加载具体提供者与调度存储。
