# `@deepseek-ai/dsh-work-scheduler`

English | [中文](README.zh.md)

Installable profile bundle for the dsh Web work scheduler. Its [`cordis.patch.yml`](cordis.patch.yml) routes the `work_scheduler` storage domain to SQLite and inserts the [`dsh-work-scheduler-store`](../../work-scheduler/work-scheduler-store/README.md) Host plugin, the Agent-scoped [`dsh-tool-work-scheduler`](../../work-scheduler/tool-work-scheduler/README.md), and the [`dsh-client-ui-work-scheduler`](../../client/ui-work-scheduler/README.md) browser plugin. The package itself is a static patch carrier; the profile composer resolves its patch through the `dsh.bundle.patch` manifest field.

The bundle requires `@deepseek-ai/dsh-web-app` earlier in the profile. That surface owns the storage providers, API gateway, Client runtime, sidebar, and layout slots extended by this layer. The shipped `web` profile composes base, Web app, then this bundle. A profile without it can enable the scheduler with:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-work-scheduler
```

The profile's own `cordis.patch.yml` remains above this layer and may disable either inserted row or replace the `storage-domain` route.

## Model Experience

None, as this package is a static patch carrier; the inserted `dsh-tool-work-scheduler` row owns the model-facing schema and result.

#### KV Cache effect

None from this package; inserted rows own their own request-prefix and history effects.

## Known Limitations and Deferred Work

- The bundle targets the Web app's `storage-domain` row and requires its storage, gateway, runtime, and slot owners; it is not a runnable surface by itself.
- Its storage override restates the complete `storage-domain` config because profile patches do not deep-merge row configs.
