# TODO

1. [x] List catalog items, get catalog item
2. [x] Add support for deployments - list, delete, create from catalog item
3. [x] Add support for templates - list, create, delete
4. [x] Add delete operations for workflows, actions, and configuration elements
5. [x] Add package import/export support
6. [x] Add inventory browsing/search (plugin inventory tree)
7. [x] Add update tool for configuration elements (update-configuration)
8. [x] Add list-workflow-executions tool to list past/running executions for a workflow
9. [x] Add deployment day-2 actions support (list-deployment-actions, run-deployment-action)
10. [x] Refactor vro-client.ts into separate modules
11. [x] Add support for resource elements
12. [x] Implement import/export for actions, config elements and resource elements
13. [x] Add workflow artifact authoring/scaffolding tools that generate valid `.workflow` files from structured metadata, inputs/outputs, scriptable task definitions, scripts, and bindings so automation developers do not have to hand-build UTF-16 workflow XML archives
14. [x] Add local artifact validation/preflight tools for `.workflow`, `.action`, `.vsoconf`, and package files that verify archive structure, encoding, parameter bindings, action references, supported vRO types, and import safety before uploading to VCFA
15. [x] Improve workflow execution tooling with a `run-workflow-and-wait` development loop that validates inputs against `get-workflow`, polls until completion or timeout, and returns outputs plus useful failure details/log excerpts for rapid iteration
16. [ ] Add `diff-workflow-file` to compare two local `.workflow` artifacts, or a live workflow export against a local artifact, and summarize meaningful changes to parameters, attributes, scripts, bindings, task flow, and action references
17. [ ] Add `diff-action-file` to compare `.action` artifacts, or a live exported action against a local artifact, and highlight script, parameter, return type, module, and name changes
18. [ ] Add `prepare-artifact-promotion` to run preflight for a workflow, action, configuration, or package artifact; optionally export the current live target as a backup; summarize risks and changes; then recommend the exact import tool call
19. [ ] Expand MCP resources and prompts for faster workflow/template implementation: add resources for workflow scaffold schema, template metadata/content, workflow patterns (`basic-scriptable-task`, `action-wrapper`), and template patterns (`small-vm`, `catalog-ready`); add prompts for building workflows from actions, refactoring workflows, creating templates, reviewing templates, integrating workflows with templates/subscriptions, and producing discovery-first implementation plans
20. [ ] Add a prompt or a tool (whichever is better) to collect the entire vro/vcfa orchestrator context - existing workflows, actions, config and reaource elements, so the agent can reuse them when implementing new workflows and actions. Think how to optimize this. The produced context should somehow be persisted so it can be used by the agents. 
