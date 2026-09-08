# Work Scheduler interaction design

English | [中文](interaction.zh.md)

This reference defines the interaction redesign over the [execution design](design.md). Open the [interactive prototype](interaction-prototype.html) to explore task creation, execution, review, rework, failure, and card movement. All execution results and configuration changes in the prototype are simulated; they do not access a model or modify a repository.

## Navigation and actions

The board occupies the full content area. Selecting a task replaces the board with a readable task page; returning restores the board selection and filters. The task editor is a separate page. Escape closes the editor before task details, then the scheduler. Closing the scheduler never cancels execution.

Each stage has one emphasized next action: save a draft, start execution, handle a pending interaction, or approve reviewed evidence. Stop, rework, editing, and thread management remain accessible secondary actions. Import/export and Git revision controls stay under labeled expandable sections. A missing Workspace points to the existing Workspace picker; missing model credentials lead to model settings and return to the task without losing its input.

## Dragging rules

The prototype supports unrestricted simulated cross-column movement, within-column ordering, highlighted destinations, insertion markers, and undo. Alt plus arrow keys provides an alternative. These presentation examples do not authorize arbitrary changes to execution states in the product.

| Product gesture | Required behavior |
|---|---|
| Reorder an unattempted task | Save the planning order with the current revision; reject stale writes. |
| Move a pending task into execution | Validate prerequisites and submit an execution command. Missing configuration opens the relevant setup flow. |
| Move an executing task back | Offer to stop execution; keep the running state until the Host confirms release. |
| Move into review | Only Host completion can create review evidence; dragging cannot manufacture it. |
| Move reviewed evidence into approved | Open evidence review and require the explicit approval action. |
| Move reviewed work back for changes | Collect feedback and submit a new execution attempt. |
| Reorder or move approved results | Preserve historical decisions; any new work uses a separate task or attempt. |

Undo applies to reversible planning moves. Execution and review commands are not rolled back by a generic undo control. Queued attempts, ordered threads, conflicts, and disconnected clients retain the Host's authority over admission and placement.

## Implementation sequence

1. Navigation and readability: full board, separate task editor/details, primary actions, collapsed advanced operations, and keyboard return paths. Verify task saving, retained errors, and return focus.
2. Execution: prerequisite navigation, live activities, pending interactions, stopping, failure retry, and planning drag/drop. Verify real commands and stale/disconnected writes.
3. Review: fixed evidence, acceptance checks, approval, rework, and command-aware cross-column gestures. Verify that gestures cannot bypass evidence checks or rewrite completed history.

Each increment needs focused component checks and an assembled application snapshot. The prototype is design evidence only; native model execution requires separate verification through the real provider.
