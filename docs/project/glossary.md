# Glossary

**Purpose:** the platform and repository terms used across the code, issues, and these pages.

## Key Files

| Path | Role |
| --- | --- |
| `src/types.ts` | Type names behind many of these terms (`VroTargetPlatform`, `VroClientConfig`) |
| `docs/guide/configuration.md` | Environment variables named below |
| `docs/vro-artifact-authoring.md` | Artifact formats named below |

## How It Works

Terms, alphabetical:

| Term | Meaning here |
| --- | --- |
| Action | A reusable vRO script function in a module (`com.example.module/actionName`). It is exported and imported as an `.action` artifact by element ID |
| Artifact directory | A local directory, configured per kind, that holds exported or authored files. File arguments are plain names inside it; see [Configuration](../guide/configuration.md#artifact-directories) |
| Automation services | The VCF Automation REST services beside vRO: catalog, deployment, blueprint, project, and event broker. They are always addressed on `VCFA_HOST` |
| Blueprint / template | A Cloud Assembly YAML template, served by the blueprint service. The tools call it a template |
| Catalog item | A Service Broker entry that `create-deployment` requests in a project |
| Configuration element | A vRO named set of typed attributes. Secure attribute values are never printed |
| Context snapshot | The JSON and Markdown summary of an environment, written by `collect-context-snapshot` under `VCFA_CONTEXT_DIR` and served as `vcfa://context/latest` |
| Day-2 action | An action run on an existing deployment, such as power off, through `run-deployment-action` |
| Embedded / external vRO | vRO inside the VCF Automation appliance, or on its own appliance (set `VCFA_VRO_HOST`) |
| Expected-target guard | An optional `expected*` argument that a mutating tool checks against live metadata before writing |
| Input form | A workflow's `input_form_` presentation, UTF-16BE JSON with a BOM; see `docs/vro-artifact-authoring.md` |
| Native action item | A workflow item that calls one action directly. It exports as `type="task"` with a `script-module` |
| Package | A vRO bundle of workflows, actions, configurations, and resources, exported as a `.package` artifact |
| Preflight | Local validation of an artifact archive before import (`src/client/artifact-preflight.ts`) |
| Project package | The one stable package named by `VCFA_PROJECT_PACKAGE_NAME` that reusable content is published through |
| Provider session | A login with `VCFA_ORGANIZATION=system`. It reads vRO, but not the tenant-scoped Automation services |
| Resource element | A vRO file element stored in a category. It is imported from and exported to the resource artifact directory |
| Scriptable task | A workflow item holding inline JavaScript |
| Subscription / event topic | An event-broker rule that runs a workflow or ABX action when a topic such as `compute.allocation.pre` fires |
| Target platform | `VCFA_TARGET_PLATFORM`: `vcfa` (auto-negotiated), `vcfa9.0` and `vcfa9.1` (pinned), or `vra8` |
| Two-phase confirmation | Discover first, then call the mutation with `expected*` guards and `confirm: true` |
| VCF Automation (VCFA) | VMware Cloud Foundation Automation 9.x, the default target. It logs in through `/cloudapi` sessions |
| VCFO-### | This repository's sequential issue code, prefixed in issue and PR titles |
| vRA 8 | vRealize/Aria Automation 8.12+, targeted with `VCFA_TARGET_PLATFORM=vra8` and vIDM bearer-token login |
| vRO | VCF Automation Orchestrator. Its REST API is `/vco/api` |
| Workflow | A vRO process definition, exported and imported as a `.workflow` zip artifact |

## Extension Points

Add a term when a new platform concept or repository convention first appears in code or issues. Point to the page that owns the detail.

## Gotchas

- "Template" in tool names means a Cloud Assembly blueprint, not a vRO resource element or a workflow template.
- "Organization" is the URL slug on `vcfa`, but the vIDM domain on `vra8`, for example `System Domain`.
- "Project" is overloaded. A VCF Automation project (`list-projects`) is unrelated to the vRO project package.
