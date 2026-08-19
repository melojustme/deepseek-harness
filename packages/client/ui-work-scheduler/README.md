# @deepseek-ai/dsh-client-ui-work-scheduler

English | [中文](README.zh.md)

The browser plugin for a thread-oriented personal work scheduler in dsh Web. It registers a footer action in the sidebar and a full-frame overlay through the existing slot system. Each thread advances tasks in order: a synchronous block stops later work in that thread, while an asynchronous block moves the task to a separate waiting list and preserves its return position.

## Persistence and portability

The plugin stores one versioned JSON document under `dsh.work-scheduler.v1` in browser localStorage. Invalid stored JSON starts an empty scheduler. Import normalizes task status and placement, removes unknown or duplicate references, and assigns otherwise unplaced tasks to the appropriate backlog, blocked, or archive list. Export downloads the normalized document as JSON.

The document belongs to the current browser profile. It is not Session data, does not follow a dsh Workspace, and is not synchronized through the Host.

## Composition

The sidebar trigger and frame overlay share one plugin-owned store. Removing the client entry retracts both slot contributions. The shipped Web bundle includes the plugin after the sidebar and layout owners that declare its slots.

## Model Experience

### Browser-local scheduler state

#### What the model sees

The model sees no scheduler state stored under `dsh.work-scheduler.v1`. The plugin adds no prompt content, tool schema, request field, Session event, or model-visible result.

#### Token effect

The plugin adds no tokens to model requests.

#### KV Cache effect

The plugin does not change model requests and therefore does not invalidate an otherwise reusable prefix.

## Known Limitations and Deferred Work

- State is local to one browser profile and does not synchronize across devices or dsh Web origins.
- Tasks do not start, stop, or monitor dsh Sessions, workflows, jobs, or subagents.
- Import replaces the current document after normalization; the plugin does not merge two scheduler documents.
