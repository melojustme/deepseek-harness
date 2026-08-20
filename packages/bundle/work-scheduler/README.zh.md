# `@deepseek-ai/dsh-work-scheduler`

[English](README.md) | 中文

dsh Web 工作调度器的可安装 profile bundle。它的 [`cordis.patch.yml`](cordis.patch.yml) 把 `work_scheduler` 存储领域路由到 SQLite，并插入 [`dsh-work-scheduler-store`](../../work-scheduler/work-scheduler-store/README.md) Host 插件与 [`dsh-client-ui-work-scheduler`](../../client/ui-work-scheduler/README.md) 浏览器插件。本包没有运行时 API；profile 组合器通过 `dsh.bundle.patch` manifest 字段解析其 patch。

该 bundle 要求 profile 中先加载 `@deepseek-ai/dsh-web-app`。Web 表层拥有本层扩展的存储 provider、API gateway、Client runtime、侧栏和布局 slot。随附 `web` profile 依次组合 base、Web app 与本 bundle。没有组合它的 profile 可用以下命令启用调度器：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-work-scheduler
```

profile 自有的 `cordis.patch.yml` 位于本层之上，可以禁用任一插入行或替换 `storage-domain` 路由。

## 模型体验

无，因为该 bundle 插入浏览器和 Host 持久化插件，调度文档不会进入模型请求或 Session 日志。

#### KV Cache 影响

无；插入的插件不会改变模型请求。

## 已知限制与延期工作

- 该 bundle 定位 Web app 的 `storage-domain` 行，并依赖其存储、网关、runtime 与 slot 所有者；本 bundle 不能单独作为可运行表层。
- profile patch 不会深度合并行配置，因此存储覆盖必须完整重述 `storage-domain` 配置。
