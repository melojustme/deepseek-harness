# `@deepseek-ai/dsh-work-scheduler`

English | [中文](README.zh.md)

Installable profile bundle for the dsh Web work scheduler. Its [`cordis.patch.yml`](cordis.patch.yml) routes the `work_scheduler` storage domain to SQLite and inserts the [`dsh-work-scheduler-store`](../../work-scheduler/work-scheduler-store/README.md) Host plugin plus the [`dsh-client-ui-work-scheduler`](../../client/ui-work-scheduler/README.md) browser plugin. The package has no runtime API; the profile composer resolves its patch through the `dsh.bundle.patch` manifest field.

The bundle requires `@deepseek-ai/dsh-web-app` earlier in the profile. That surface owns the storage providers, API gateway, Client runtime, sidebar, and layout slots extended by this layer. The shipped `web` profile composes base, Web app, then this bundle. A profile without it can enable the scheduler with:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-work-scheduler
```

The profile's own `cordis.patch.yml` remains above this layer and may disable either inserted row or replace the `storage-domain` route.

## Model Experience

None, as the bundle inserts browser and Host persistence plugins that keep scheduler documents outside model requests and Session logs.

#### KV Cache effect

None; the inserted plugins do not change model requests.

## Known Limitations and Deferred Work

- The bundle targets the Web app's `storage-domain` row and requires its storage, gateway, runtime, and slot owners; it is not a runnable surface by itself.
- Its storage override restates the complete `storage-domain` config because profile patches do not deep-merge row configs.
