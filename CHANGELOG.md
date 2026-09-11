# Changelog

## Unreleased

### Added

- **`VCFA_TARGET_PLATFORM=vra8` now supports the full vRO `/vco/api` surface and the Automation-service read paths.** Both were verified against a vRA 8.18 lab (vRO 8.18.1): creating, updating, and deleting workflows, actions, and configuration elements; the multipart artifact imports; package build, export, and import; and the list and get paths of the catalog, deployment, blueprint, project, and event-broker services, which return the same page envelope and object shapes the VCFA 9.x clients already parse. The flat guard that rejected every non-`/vco/api` base URL and every vRO write other than `POST /workflows/{id}/executions` is now a per-service, per-method one. No `apiVersion` pin turned out to be needed: none of the Automation-service clients sends one, and every endpoint answered without it — closing that open question from VCFO-063's scope. `shouldReauthenticate` and the `403` hint added in VCFO-067 were confirmed correct rather than changed: an invalid or expired token answers `401` with a `WWW-Authenticate: Bearer` challenge, on `/vco/api` and on the Automation services alike, while a genuine authorization denial answers `403` with no challenge (VCFO-068).

- `VCFA_TARGET_PLATFORM=vra8` now authenticates against vRA 8 (embedded vRO) with the platform's bearer-token flow instead of HTTP Basic: the client posts the configured credentials to `POST /csp/gateway/am/api/login?access_token`, sending `VCFA_ORGANIZATION` as the vIDM `domain` (for example `System Domain`), exchanges the returned `refresh_token` at `POST /iaas/api/login`, and sends the resulting token as `Authorization: Bearer` on every `/vco/api` request. Real vRA 8.18 appliances reject Basic auth on `/vco/api` with `401` and `WWW-Authenticate: Bearer`, so the previous mode could not log in at all. Login failures carry a hint that `VCFA_USERNAME`/`VCFA_PASSWORD` are vIDM credentials and `VCFA_ORGANIZATION` is the vIDM domain; tokens, refresh tokens, and passwords are never logged or surfaced, and 2xx login bodies are never echoed into errors (VCFO-067).

### Dependencies

- Applied Dependabot security updates to the lockfile, clearing 25 of the 27 open alerts. Transitive under `@modelcontextprotocol/sdk`: `qs` 6.15.2 → 6.16.0, `@hono/node-server` 1.19.14 → 2.1.1, `hono` 4.12.26 → 4.13.7, `fast-uri` 3.1.2 → 3.1.7, `ip-address` 10.2.0 → 10.7.0, `body-parser` 2.2.2 → 2.3.0. Transitive under `vitepress`: `postcss` 8.5.13 → 8.5.28. `package-lock.json` is not part of the published package, so installs already resolved fixed versions; these bumps cover clones, CI, and the release workflow's `npm ci`. The server uses only the stdio transport, so the `hono`, `express`, and `ip-address` advisories were unreachable code paths here (VCFO-066).
- Raised the `vite` override to `^6.4.3`, clearing GHSA-fx2h-pf6j-xcff (high, `server.fs.deny` bypass on Windows alternate paths) and GHSA-v6wh-96g9-6wx3 (medium, launch-editor NTLMv2 hash disclosure via UNC paths). Both advisories cover `vite <= 6.4.2`, which includes the 5.x line `vitepress` itself declares, so the override had to move rather than be dropped. It is deliberately a caret range and not an exact pin: Dependabot never edits an `overrides` block, so the previous exact `6.4.2` pin blocked it from fixing these alerts at all, whereas a range lets it patch any future 6.x advisory with a lockfile-only bump (VCFO-066).
- Removed the `esbuild` override. It was added as a security floor when esbuild `<= 0.24.2` was vulnerable (GHSA-67mh-4wv8-2f99, patched in 0.25.0) but had become a ceiling: `vite` asks for `^0.25.0` and resolves to 0.25.12 with or without it, while `tsx` asks for `~0.28.0` and was being held three minors back at 0.25.12. Both consumers now reach non-vulnerable versions unaided — `tsx` on esbuild 0.28.2 and `vite` on 0.25.12 — and esbuild is no longer pinned out of Dependabot's reach (VCFO-066).

### Changed

- `get-project` renders the whole project-service object instead of only name, ID, and description: organization ID, shared-resources flag, operation timeout, machine naming template and placement policy (lifted from the `__namingTemplate` and `__projectPlacementPolicy` properties), custom properties with credential-looking keys shown as `[redacted]`, the administrators, members, viewers, and supervisors, and a per-kind count of placement constraints; sections the response does not carry are omitted. The field set was read off a vRA 8.18 lab, which also confirmed the `GET /project-service/api/projects` path, the Spring page envelope (`content`, `totalElements`, `totalPages`, `last`, default `size` 500), that `page`/`size` are honored (`page=1&size=2` answers `number: 1, first: false`), that an unknown ID surfaces as `404 Not Found` in `Failed to get project:`, and that the returned `id` is the `projectId` the blueprint and deployment services accept. Cloud zones are not part of this view. `list-projects` and `get-project` needed no path or pager change; the VCFA 9.x and tenant-session checks from the issue remain open (VCFO-065).
- `update-configuration` now runs its two-phase flow in the intended order. The live element is read once, before the `confirm` gate, and serves the `expectedName` guard, the safety check, and the update itself, so a guarded update costs one `GET` instead of two and a call that cannot succeed is refused before confirmation is spent. The `confirm: false` response names the element and the fields that will change. The refusal for an omitted attribute set now says which of the attributes are secure and that their values must be supplied fresh, because `get-configuration` prints them as `[redacted]`; and a secure-typed attribute supplied without a value is refused rather than stored as an empty secret (VCFO-071).
- The vra8 `403` authorization hint has one owner. `VroHttpClient.apiError(res, label)` builds every `vRO API error` message — status and reason, operation label, sanitized body, platform hint — for the JSON path and for the eleven binary-export and multipart-import sites in the artifact clients that used to assemble the same template by hand, and the hint's predicate is now the negation of `shouldReauthenticate` instead of a second copy of the same three clauses. `apiErrorHint` is private (VCFO-071).
- Error messages fall back to the standard reason phrase when a response carries none. Responses over HTTP/2 have no reason phrase, so `Response.statusText` is empty there and a message used to read `vRO API error: 400  — POST /configurations`; it now reads `400 Bad Request` (VCFO-071).
- The vra8 operation gate is private to the JSON request path and keys on method and base URL only. After VCFO-068 lifted every vRO restriction, the thirteen explicit `assertOperationSupported` calls in the artifact clients could no longer throw, its `path` parameter was unused, and the unknown-service branch was unreachable because every Automation client passes one of the five public base URLs verbatim; all three are gone (VCFO-071).
- Every client-side list filter (`list-projects`, `list-actions`, `list-configurations`, `list-workflows`, and `list-plugins` in `vra8` mode) shares one normalization: the filter is trimmed and lower-cased, and a blank filter is treated as absent. Previously two of the five trimmed and three did not, so `" Library"` matched plugins and projects but no actions (VCFO-071).
- Enabled Dependabot security updates on the repository, so transitive advisories now get their own pull requests instead of waiting for the monthly grouped version updates (VCFO-066).
- `vra8` mode now participates in the invalidate-token, re-authenticate, retry-once handling on `401`, because the CSP/IaaS bearer token expires. Previously `vra8` treated a `401` as terminal because Basic credentials cannot expire. The refresh token from the CSP login is kept, so a renewal replays only the `/iaas/api/login` exchange — one round trip, and the password does not go over the wire again — and the full CSP login runs only when that refresh token is rejected (VCFO-067).
- A `401`/`403` retry now invalidates only the token the failed request actually used. Previously the cached token was cleared unconditionally, so when several requests were in flight as a token expired, each stale `401` threw away a token a concurrent request had just obtained and forced another full login; in `vra8` mode that cost two round trips and a password resend per request (VCFO-067).
- In `vra8` mode a `403` from `/vco/api` is retried only when it carries a `WWW-Authenticate` challenge. An expired vRA 8 token answers with `401`, whereas a `403` there means the vIDM user lacks the vRO permission, so the previous behavior spent a full re-login and a retry that was certain to fail the same way. Such a `403` is now surfaced immediately with a hint that the login succeeded and the problem is authorization; the hint is appended on the JSON path and on the binary-export and multipart-import paths, which build their own error messages. The `vcfa` platform still retries both statuses. The vRA 8 status semantics behind this were subsequently confirmed in the lab under VCFO-068 (VCFO-067).
- The two `vra8` login POSTs no longer follow redirects. Their body carries the cleartext password and a `307`/`308` preserves the body across origins (the Fetch standard strips an `Authorization` header on a cross-origin redirect, but nothing strips a body), while a `302`/`303` would quietly turn the POST into a GET of an SSO page answering `200` with HTML. A redirect is now reported as a login failure naming the host it points at, with no credential material and no redirect query echoed (VCFO-067).
- `VCFA_ORGANIZATION` is trimmed before it is sent as the vIDM `domain`, matching the trim the provider-login check has always applied. A trailing space or `CR` — easy to acquire in a value that legitimately contains a space, such as `System Domain` — previously reached the CSP login and came back as an opaque `400` on a domain that looked correct (VCFO-067).
- `VroHttpClient` builds credential material for the active platform only. The `vcfa` session Basic header and the `vra8` CSP login body were both constructed for every client, so the default platform retained a cleartext copy of the password it never previously held, and `vra8` mode carried a dead Basic header plus a provider-session URL derived from the vIDM domain. `ensureAuthenticated()` is now private; `authorizationHeader()` is the only auth entry point, and it is what changed meaning for `vra8` in this release — it returns `Bearer <token>` where the method behind it used to return a complete `Basic …` header (VCFO-067).
- The `vra8` unsupported-operation message no longer describes the mode as "Basic-auth mode" (VCFO-067).
- Automation-service **writes** are what `vra8` mode now withholds, and the message says so: catalog item requests, deployment deletion and day-2 actions, blueprint create/delete, and subscription create/update/delete each provision or destroy real infrastructure, so they were left unexercised in the lab and still throw, while the reads alongside them go through. `export-configuration-file` is refused separately and for a settled reason rather than a pending one: vRA 8 serves a configuration element as JSON only and answers an artifact request with `406`, where the same request for a workflow or an action returns the artifact. That message points at `get-configuration` and the project-package route, both of which work (VCFO-068).

### Fixed

- `update-configuration` no longer clears the description of an element it was not asked to change. `PUT /configurations/{id}` replaces the element, and the body carried the description only when the caller supplied one, so a name-only or attributes-only update wiped it on both platforms. The description is now carried forward from the live element like the name (VCFO-071).
- `prepare-artifact-promotion` for a configuration artifact with `backup.enabled` no longer fails outright in `vra8` mode. The backup export hit the `.vsoconf` refusal (vRA 8 serves a configuration element as JSON only) and the throw discarded the preflight report, the diff, and the import recommendation that had already been computed. The backup is now reported as skipped with a note pointing at `get-configuration` and the project package, the way the missing-target-ID cases already were (VCFO-071).
- A vra8 login failure whose body is neither JSON nor a gateway HTML page no longer echoes an excerpt of that body. Both login POSTs carry a secret in the request body — the password, then the refresh token — so a gateway that reflects a rejected payload would have put a credential prefix into the error and, on the renewal path, into the log. Such a body is now reported by size and declared content type only; JSON diagnostic fields and gateway HTML summaries still come through. The same applies to the `vcfa` session login (VCFO-071).
- `VCFA_ORGANIZATION` is trimmed once, in the `VroHttpClient` constructor, for every consumer. VCFO-067 trimmed it for the provider-login check and the vra8 vIDM domain, but the `vcfa` Basic header still carried the raw value, so a trailing space or CR in the tenant organization produced a `401` with a hint that the slug was wrong (VCFO-071).
- Configuration writes now send the attribute key the target platform accepts. vRA 8 requires the plural `attributes` on `POST /configurations` and `PUT /configurations/{id}` and answers `400` for a body carrying the singular `attribute` — including one carrying both keys, so no single body satisfies both platforms. `create-configuration` and `update-configuration` with attributes therefore failed outright in `vra8` mode. The `vcfa` path still sends the singular key it has always sent; whether VCFA 9.x also accepts the plural form is unverified, so unifying on one key waits for a 9.x lab check rather than being inferred from the response shape, which is plural on both (VCFO-068).
- `update-configuration` now carries the element name in the `PUT` body when the caller is not renaming. `PUT /configurations/{id}` replaces the element, and vRA 8 rejects a nameless body with `The configuration element name contains invalid characters (\, /).Name: null`, so any update that changed only the description or the attributes failed in `vra8` mode. The live name is read first, the way `update-action` already re-reads the current action before its `PUT`; a call that does pass a name is unaffected and issues no extra request (VCFO-068).
- `update-configuration` no longer deletes the attributes it was not asked to touch. The underlying `PUT /configurations/{id}` replaces the element, so an update that changed only the name or the description dropped every attribute — contradicting the tool's own contract that only the supplied fields change. Such a call is now refused before the write, naming the attributes that would have been lost by name and type; values are never echoed. They are not carried forward automatically because a `SecureString` attribute reads back as ciphertext with `isPlainText: false`, and replaying that value risks storing the ciphertext as the new secret. Pass the attributes to keep, or an empty array to clear them deliberately. The behavior was reachable on both platforms, but only surfaced now: in `vra8` mode the same call previously failed at the nameless-body `400` above (VCFO-068).
- A gateway HTML error body is now summarized instead of truncated. The vRA 8 gateway answers a rejected `/vco/api` request with a styled HTML page whose only diagnostic content is the status code and reason, several hundred bytes past a stylesheet, so the 200-character non-JSON excerpt was pure CSS: a real `400` read as `vRO API error: 400  — POST /configurations` with nothing usable after it. The reason phrase matters more than it looks here, because these responses arrive over HTTP/2, which carries none, leaving `Response.statusText` empty and the page the only place it survives. Such a body now renders as `[HTML body: 400 Bad Request — no further detail]`, lifting out only the two short status fields and never echoing the surrounding markup; a page without them is reported as carrying no detail rather than quoted (VCFO-068).

- A `vra8` login that answered `2xx` without the expected field no longer misreports the cause. A body-read failure (a truncated connection) was swallowed and, like an HTML `200` from an SSO or proxy page, surfaced as "response did not include a refresh_token string. The login URL must keep the ?access_token query" — advice about an internal literal the user cannot change, with the real status and reason discarded. The message now names the status, the declared content type, and whether the body was unreadable, empty, non-JSON, or JSON without the field, and still never echoes a `2xx` body (VCFO-067).

- `list-plugins` no longer reports "No plugins found." against the vRO embedded in vRA 8 (`VCFA_TARGET_PLATFORM=vra8`). That server answers `GET /vco/api/plugins` with a flat `{ plugins: [...], total }` envelope instead of the `link`/`attributes` listing the other vRO list endpoints use, so the shared paginator saw zero items. The paginator now accepts endpoint-specific item keys and the plugin client reads both shapes, mapping the flat descriptor's `moduleName` (falling back to `id`), `version`, `description`, and `enabled` onto the existing plugin summary; a plugin the server reports as disabled is rendered with a `[disabled]` marker. `buildNumber`, `fileName`, and `logLevel` are not surfaced. Because that endpoint also ignores the `conditions` query (every name filter returned the full inventory), the `filter` argument is applied client-side to flat descriptors as a case-insensitive substring match on the module name, and the reported total then counts the matches; attribute listings keep the server-side filter (VCFO-069).

### Docs

- Documented the `update-configuration` carry-forward and refusal rules, the vra8 backup skip in `prepare-artifact-promotion`, and the shared list-filter normalization in the tools reference, `AGENTS.md`, the configuration guide, troubleshooting, the live smoke tests, and the `vcfa-operations` skill (VCFO-071).
- Replaced the Basic-auth description of `vra8` mode in the README, `AGENTS.md`, `CLAUDE.md`, `.env.example`, the configuration guide, troubleshooting (vra8 login guidance covering the domain string, `403` responses, and redirects), safety (retry and redirect statements), live smoke tests, and the `vcfa-operations` skill (VCFO-067).
- Documented the verified `vra8` surface per service in the README, `AGENTS.md`, `CLAUDE.md`, `.env.example`, the configuration guide (as a support table), troubleshooting, the tools reference (`export-configuration-file`), `examples/README.md`, and the `vcfa-operations` skill, replacing the "read operations plus workflow execution" claim those files carried. The live smoke tests now separate the read-only checks from the vRO write checks, which need a disposable category, and list the calls that should return an unsupported-mode message. Two caveats are stated rather than implied: `list-catalog-items` and `list-deployments` were both empty in the verification environment, so those endpoints and their page envelopes are verified but their item shapes are not; and `import-configuration-file` is unverified, because vRA 8 cannot export a `.vsoconf` for a round trip — its endpoint is reachable and the multipart transport is proven by the workflow, resource, and package imports, so it is documented, not guarded (VCFO-068).
- Corrected the `VCFA_ORGANIZATION` quoting guidance in `.env.example` and troubleshooting. It described this file as "usually sourced by a shell", a loading path this project does not implement or document — there is no dotenv dependency and no `--env-file` — and the advice it derived from that would have put literal quote characters into the value when pasted into an MCP client's JSON `env` block. Both now describe the two paths the project actually documents (VCFO-067).

### Tests

- Added coverage for the description carry-forward, the one-read guarded update, the empty-secret refusal at the client and tool layers, the pre-confirmation refusal, the vra8 configuration backup skip, the reason-phrase fallback, the shape-only rendering of reflected plain-text login bodies (password and refresh token), the trimmed `vcfa` Basic header, the `403` hint on a multipart import, and the shared filter helper (VCFO-071).
- Rewrote the vra8 client tests for the token flow (call sequence, request bodies, no `Authorization` on the login calls, no `GET /api/versions` probe) and added coverage for CSP 400/401 hints and secret non-leakage, missing `refresh_token`, non-JSON login bodies, IaaS exchange failure, 401 renewal with a single retry, second-401 surfacing, shared concurrent login, the binary export path, and re-login failure after a rejected refresh token (VCFO-067).
- Replaced the three vra8 guard tests with ones matching the verified surface: Automation-service reads now assert the requests reach their own service base URLs and parse the vRA 8 page envelope, the eight Automation-service writes assert the new refusal, vRO writes assert the `POST`/`DELETE` reach `/vco/api`, and the artifact imports assert they now run past the guard into their local preflight. `export-configuration-file` keeps the "refused before any local file work" shape the import tests used to hold. Added regression coverage for the platform-conditional attribute key on both configuration writes, for `update-configuration` reading the live name only when the caller is not renaming, and for the HTML-body summary — status fields present, absent, behind leading whitespace, over-length, and a JSON body whose value merely starts with markup. The two existing tests that used an HTML body as a generic non-JSON fixture now use a plain-text one, so the truncation path stays covered (VCFO-068).
- Added vra8 coverage for the refresh-token renewal and its fallback to a full CSP login, a stale `401` reusing a concurrently refreshed token instead of logging in again, `403` with and without a `WWW-Authenticate` challenge on both the JSON and binary-export paths, unreadable, empty, and redirected login responses, the trimmed vIDM domain, and the `ignoreTls` dispatcher reaching both login calls and the vRO call (VCFO-067).


## 3.0.0 - 2026-09-10

This release drops end-of-life Node.js 18 and 20, routes all HTTP through the npm `undici` 8 client (fixing multipart artifact imports), adds project discovery (`list-projects`, `get-project`) and `update-action`, hardens the action tool surface and input-form authoring, and is the first version published since 2.2.1: the 2.2.2 and 2.2.3 sections below were recorded in this changelog but never tagged or published to npm, so their changes ship here as well.

### Added

- **New read-only project discovery tools `list-projects` and `get-project`** backed by `GET /project-service/api/projects`, so agents can resolve the `projectId` consumed by `create-deployment`, `create-template`, `create-subscription`, and the project-scoped list tools instead of asking for it out-of-band. `list-projects` paginates the full project list and applies an optional client-side, case-insensitive name/description filter; when pagination hits the request cap, the result (even an empty match list) warns how much of the inventory was scanned and that the client-side search cannot recover the rest. Both tools are rejected in `vra8` mode like the other Automation-service APIs. Project-scoped tool descriptions, prompts, and patterns now point at them for ID discovery (VCFO-062).
- **New `update-action` tool** that updates an existing action in place by ID: it fetches the live action, merges the supplied `script`, `inputParameters`, and/or `returnType` (unspecified fields are preserved), issues the `PUT`, and re-fetches the authoritative result because the endpoint returns only a validation envelope. It carries the `confirm: true` gate and destructive annotation like the other `update-*` tools, accepts optional `expectedName`/`expectedModule` guards verified against the live action before the write, and rejects a confirmed no-op (none of the three fields supplied). Create and update share one request-body builder so the two payloads cannot drift (VCFO-062).
- `preflight-workflow-file` and `preflight-package` now **cross-check `input_form_` against the inputs declared in `workflow-content`**: a form field with no matching declared input is an error, a declared input without a form field is a warning, and a `dataType` that disagrees with the input's verified mapping is a warning. Because `import-workflow-file` requires a passing preflight, a stale form is blocked at import before it reaches the server (VCFO-002).

### Changed

- The `vra8` unsupported-Automation-services message now lists projects alongside catalog, deployments, templates, subscriptions, and event topics (VCFO-062).
- **BREAKING: the minimum supported Node.js version is now 22.19.** `undici` 8 requires Node `>=22.19.0`, so support for Node 18 and 20 (both end-of-life) is dropped; `engines.node` and the CI matrix are updated accordingly.
- **BREAKING: `import-action-file` no longer accepts `expectedCategoryId`.** vRO does not expose action modules as queryable categories (`list-categories` with `type=ActionCategory` returns nothing), so the guard could never be satisfied; the tool now points module discovery at `list-actions`, and `categoryName` names the target module, which is created on import if it does not exist (VCFO-062).
- `create-action` now **refuses to create a duplicate** of an existing `module`/`name` and points the caller at `update-action` with the existing ID (VCFO-062).
- `scaffold-workflow-file` now **rejects an input whose type has no verified input-form mapping** with an explicit `unsupported input-form type` error instead of silently falling back to a `string`/`textField` form field. The verified mapping set (read back from vRO 9.1-authored forms, not guessed) covers `string`, `boolean`, `number`, `SecureString`, `Date`, `Properties`, `Any`, plugin reference types such as `VC:VirtualMachine`, and `Array/<supported>`; the table lives in `docs/vro-artifact-authoring.md` (VCFO-002).
- Grouped the `github/codeql-action` `init`, `autobuild` and `analyze` bumps into a single Dependabot PR (`codeql-action` group). The CodeQL workflow requires all three steps to run the same action version, so the one-PR-per-step updates Dependabot started opening each failed CI on their own.
- All GitHub Actions across the six workflows are pinned to full commit SHAs, every `actions/checkout` step runs with `persist-credentials: false`, and CI cancels superseded in-flight runs on the same ref; added `.nvmrc` (Node 24) and `.editorconfig`.
- The Claude Code plugin manifests under `.claude-plugin/` now carry the server release version (3.0.0) so plugin installs pick up the updated `vcfa-operations` skill.

### Dependencies

- Bumped `undici` from 6 to 8 and `fast-xml-parser` from 5.8 to 5.9.3 (npm-production group).

### Fixed

- Multipart artifact uploads (package/action/workflow/configuration/resource import) now build the request body with `undici`'s `FormData`. undici's `fetch` only serializes a `FormData` created by the same undici; a foreign `FormData` fails its brand check and is silently stringified to `"[object FormData]"` and sent as `text/plain`, breaking every import.
- All requests now go through the npm `undici`'s own `fetch`, not Node's global `fetch`, so `fetch`, the multipart `FormData`, and the `VCFA_IGNORE_TLS` dispatcher `Agent` always come from the same undici. The `undici` bundled in the Node runtime is a different major (Node 22 → undici 6, Node 24 → undici 7) that neither honors an npm-`undici` `Agent` nor serializes an npm-`undici` `FormData` — the latter broke strict-TLS imports on Node 24 specifically, since undici 7 (unlike undici 6) rejects the foreign `FormData`.
- `list-actions` **name filtering now works.** The vRO `/actions` endpoint ignores `conditions` and `maxResult` (verified live; every variant returned the full inventory), so the tool now retrieves the full set and filters by name client-side (VCFO-062).
- `list-actions` **no longer truncates multi-segment module names.** The list endpoint returns no `module` attribute, only a slash-separated `fqn` (`<module>/<name>`); the old code split on `.` and dropped the last segment, so `com.vmware.library.snmp` was reported as `com.vmware.library`. The module is now derived by stripping the name and splitting on `/` (legacy dotted fqns are tolerated), which also repairs the `create-action` duplicate guard that compares against the derived module (VCFO-062).

## 2.2.3 - 2026-06-24

This release applies follow-up polish from the VCFO-063 review. No public tool, prompt, or resource names changed.

### Fixed

- `list-workflows-by-category` now **surfaces category-list truncation for the `categoryName` selector** too: when no category matches the requested name and the live category list was truncated at the page-request cap, the error explains the category may exist beyond the returned page instead of asserting it does not exist — matching the existing `categoryId`/`categoryPath` behavior (VCFO-063).
- Server shutdown now wraps transport/HTTP-dispatcher teardown in `try/finally` so the process still exits if `server.close()` or `client.close()` throws, preventing a hung close from keeping the server alive under a process-manager `SIGTERM` (VCFO-063).
- The `SIGINT`/`SIGTERM` handlers are now registered **before** the stdio transport connects, so a signal arriving during or immediately after startup is caught by the graceful-shutdown handler instead of the default terminate disposition (VCFO-063).

### Docs

- Clarified the `import-action-file` `expectedCategoryName` documentation: omitting the argument skips the live `list-actions` check, so a genuinely new module is created without the "new module" note (VCFO-063).

### Tests

- Added `resolveWorkflowCategoryFromList` coverage for the truncation-aware and plain not-found `categoryName` paths (VCFO-063).
- Added an automated graceful-shutdown test for the entry point: it starts the built server, sends `SIGTERM`, and asserts a clean `exit 0`, proving the signal-agnostic `try/finally` teardown handler ran (a signal's default disposition would exit non-zero). This path previously had only manual verification (VCFO-063).
- Added dedicated unit tests for `parseAttrs`/`getLinkAttrs` (malformed-entry guard, name precedence, field fallback) and `CategoryClient.listCategories` (well-formed mapping, empty-string id/name fallback for malformed entries, absent-parent-field omission, `@`-prefixed aliases) (VCFO-063).

## 2.2.2 - 2026-06-24

This release resolves correctness, safety, and robustness findings from a full code review (VCFO-063). No public tool, prompt, or resource names changed.

### Fixed

- `import-action-file` now verifies `expectedCategoryName` against **live state**. Previously it compared the expected module name only against the caller-supplied `categoryName` (a tautology). It now also checks the live module set from `list-actions`, and when the target module does not yet exist the import proceeds and the result reports that a new module was created. Action modules are still discovered from the `module` column of `list-actions` (vRO does not expose them through `list-categories`) (VCFO-063).
- `run-workflow`/parameter marshaling now **rejects non-object `Properties` and `Composite` values** with a clear error instead of silently emitting a malformed `{ properties: { value } }` payload that the execution API would reject (VCFO-063).
- `get-workflow-execution` now renders output parameter values **unwrapped** (matching `run-workflow-and-wait`) instead of dumping the raw vRO type wrapper (for example `{"string":{"value":"x"}}`) (VCFO-063).
- `get-resource-element`/`getResourceElement` now **surfaces list truncation** instead of reporting a misleading "not found" when the live resource list was truncated at the page-request cap (VCFO-063).
- `list-workflows-by-category` now **surfaces category-list truncation** the same way: when the requested `categoryId`/`categoryPath` is absent and the live category list was truncated at the page-request cap, the error explains the category may exist beyond the returned page rather than asserting it does not exist (VCFO-063).
- `update-configuration` now rejects a confirmed **no-op** (none of `name`, `description`, or `attributes` supplied) before issuing a live update, matching `update-action` (VCFO-063).
- `getAllAutomationPages` now detects **non-advancing pagination** (a repeated page) and throws, matching the vRO pagination path, instead of silently looping to the page-request cap (VCFO-063). The repeat-detection signature was widened from a 32-bit to a ~53-bit hash so a false-positive "did not advance" at the page-request cap is negligible (VCFO-063).
- Category listings no longer assign `undefined` to the required `id`/`name` fields; they fall back to `""` consistent with the plugin client (VCFO-063).
- `parseAttrs` now skips attribute entries with a missing or non-string `name` so a malformed entry cannot pollute the parsed map (VCFO-063).
- The server now handles **`SIGTERM`** (in addition to `SIGINT`) so the transport and the HTTP dispatcher are torn down under process-manager termination; removed an unused import (VCFO-063).
- The `vcfa://context/snapshots/{fileName}` resource no longer advertises a misleading static `text/plain` mime type; the read handler reports the correct per-file `application/json` or `text/markdown` type (VCFO-063).

### Tests

- Added coverage for the action-import live module guard (existing/new/truncated module), non-object `Properties`/`Composite` rejection, `getResourceElement` truncation, `get-workflow-execution` output unwrapping, the `update-configuration` no-op guard, automation pagination non-advancement, the subscription OData single-quote escaping, the `resolveWorkflowCategoryFromList` truncation-aware not-found, and entry-point startup failures (missing env var and invalid `VCFA_TARGET_PLATFORM`) (VCFO-063).

## 2.2.1 - 2026-06-14

This release completes and hardens scaffolded-workflow support so generated `.workflow` artifacts import, open in the editor, and run in live vRO 9.1, and lets the scaffolder emit native vRO action workflow items.

### Added

- `scaffold-workflow-file` can emit **native vRO action workflow items** via an optional `kind: "action"` task discriminator (`module`, `actionName`, ordered `inputs`, `resultBinding`), generating the `actionResult = System.getModule("<module>").<actionName>(...)` script and a `type="task" script-module="<module>/<actionName>"` item; void actions omit `resultBinding` and emit a bare call. Tasks without `kind` behave exactly as before. `preflight-workflow-file` validates the `<module>/<actionName>` form and `diff-workflow-file` surfaces native-action item changes (VCFO-046, VCFO-059).

### Fixed

- Scaffolded `.workflow` artifacts now **import, open in the VCF 9.x Orchestrate editor, and run** in live vRO 9.1. The builder emits `workflow-info` as a Java properties file (not XML), encodes `workflow-content` as UTF-16BE with a `UTF-8` XML declaration (the BOM drives decoding; the v2 editor returns 500 on a declaration saying `UTF-16`), chains an explicit terminal `<workflow-item type="end">` (replacing `end-mode="1"` on the last task), writes `input_form_` only when the workflow has inputs, drops the read-only `allowed-operations` marker that made the editor refuse to open the workflow, and gives every item a distinct `<position>` with bare `<param>` elements (VCFO-060).
- `preflight-workflow-file` and `diff-workflow-file` now parse vRO's native repeated `<attrib name type read-only>` attribute shape (not just the scaffold's wrapped form), so scaffolds and real exports round-trip identically; binding type-match tolerates vRO's generic `Any`; and preflight parses `workflow-info` as properties, requires UTF-16BE content, and rejects the legacy `end-mode="1"` pattern (VCFO-061).

## 2.2.0 - 2026-06-12

This release adds VCF Automation 9.1 support with automatic API version negotiation, provider/system administrator logins, and fixes workflow and configuration parameter payloads to use the canonical vRO type keys the REST API expects.

### Added

- VCF Automation 9.1 support: the default `vcfa` platform now auto-negotiates the VCF Cloud API version before authenticating, probing the unauthenticated `GET /api/versions` discovery document and preferring `9.1.0` over `9.0.0`. A probe that fails outright falls back to `9.0.0` for that attempt only and discovery is retried on the next authentication; a probe that succeeds but advertises no known version caches the `9.0.0` fallback. Authentication is single-flighted, so concurrent requests share one probe and one session login. New `VCFA_TARGET_PLATFORM` values `vcfa9.1` and `vcfa9.0` pin the version explicitly and skip the probe (VCFO-057).
- Provider/system administrator logins: `VCFA_ORGANIZATION=system` (case-insensitive) now routes authentication to `/cloudapi/1.0.0/sessions/provider`; the tenant `/sessions` endpoint rejects provider accounts with 401. Login 401 errors now include a hint distinguishing organization names from display names and pointing provider accounts at `VCFA_ORGANIZATION=system` (VCFO-057).

### Fixed

- Workflow execution and configuration attribute payloads now key parameter values by the canonical lowercase/hyphenated vRO type literal (`secure-string`, `date`, `mime-attachment`, …) instead of the display type from the definition (`SecureString`), which the vRO REST API rejects with a 400. `Array/<type>` inputs are serialized as `{"array": {"elements": [...]}}`, SDK object types (e.g. `VC:VirtualMachine`) as `{"sdk-object": {"id", "type"}}`, and plain-object `Properties` values as `{"properties": {"property": [...]}}` (VCFO-058).
- `run-workflow` and `run-workflow-and-wait` input validation now rejects non-string values for `SecureString` and `EncryptedString` inputs instead of forwarding them to the vRO API (VCFO-058).

## 2.1.0 - 2026-06-12

This release scopes TLS relaxation to the client's own requests, hardens response parsing and artifact preflight, gates bulky tool output behind opt-in flags, adds two-phase confirmation fields for live mutations, and ships a Claude Code plugin with authoring and operations skills.

### Security

- `VCFA_IGNORE_TLS=true` no longer disables TLS certificate verification process-wide via `NODE_TLS_REJECT_UNAUTHORIZED`. TLS relaxation is now scoped to the client's own requests to the configured VCFA host through a dedicated HTTPS agent, so other HTTPS traffic in the same Node process keeps full certificate verification. The minimum supported Node.js version is now 18.17.
- `get-configuration` now redacts `SecureString` attribute values instead of returning them in plain text (VCFO-048).

### Added

- Added a Claude Code plugin (`vcfa-orchestrator`) and marketplace manifest under `.claude-plugin/`, bundling two skills in `skills/`: `vcfa-authoring` (discovery-first artifact lifecycle and package-first publishing) and `vcfa-operations` (running workflows and guided troubleshooting). The skills delegate to the server's existing `vcfa-*` prompts, resources, and tools rather than duplicating them, and `npm run validate:docs` now drift-checks the tool/prompt/resource names they reference.
- Added `VroClient.close()` to release the client's network resources (the TLS-relaxed dispatcher); the server now calls it during graceful shutdown.
- Added a local TLS integration test that runs the client against a self-signed HTTPS server, verifying `ignoreTls` completes a real handshake (and that strict mode still rejects) without touching `NODE_TLS_REJECT_UNAUTHORIZED`.
- Added optional two-phase confirmation fields to high-risk live mutation tools: when expected target fields such as `expectedName`, `expectedCategoryId`/`expectedCategoryName`, `expectedPackageName`, `expectedWorkflowName`/`expectedInputNames`, or `expectedDeploymentName`/`expectedActionName` are supplied, the handler performs read-only discovery first and refuses to mutate if the live target does not match. Omitted fields keep existing `confirm: true` behavior unchanged.
- Workflow tools now return `structuredContent` (structured workflow, execution, and execution-log shapes) alongside their text output.

### Changed

- `get-template`, `get-action`, and `get-subscription` now summarize bulky content (blueprint YAML, action script, constraints JSON) as a sha256 + length line by default, consistent with context-snapshot redaction; the new `includeContent`, `includeScript`, and `includeConstraints` flags restore the full output (VCFO-055).
- Tools that overwrite or delete live state — import, update, run, and delete tools, plus `rebuild-project-package` — now advertise `destructiveHint: true` in their MCP annotations so hosts can require heightened approval; additive creates and `add-*-to-project-package` tools do not (VCFO-051).

### Fixed

- `run-workflow` now validates and type-normalizes caller-supplied inputs through the same shared preamble as `run-workflow-and-wait` instead of POSTing them to the live workflow unvalidated; the two handlers' drifted input schemas (`inputs[].type` required in one, optional in the other) are reconciled (VCFO-047).
- Query parameter values containing `$` or `~` are no longer un-encoded by the pagination query serializer; the literal-`$` exemption now applies only to OData system query keys such as `$filter` and `$search` (VCFO-050).
- Empty-body 2xx responses with a `Location` header no longer masquerade as a running workflow execution for non-execution endpoints; the synthetic `{ id, state: "running" }` shape is now scoped to the explicit workflow-execution start path (`startExecution`), and generic empty 2xx responses return `{}` (VCFO-052).
- A 2xx response with a non-JSON body (for example an HTML error page from a load balancer or SSO interstitial) now throws a sanitized, contextualized error naming the method, path, and correlation ID instead of a bare `SyntaxError: Unexpected token` (VCFO-053).
- List results that stop at the pagination request cap now carry a `truncated` flag instead of silently returning partial data with the server's full total; list tools append a visible truncation warning and context snapshots record a per-domain warning (VCFO-054).
- Artifact preflight now rejects `input_form_` entries that are not UTF-16BE (the documented contract) instead of silently accepting UTF-16LE, decodes UTF-16 entries fatally so corrupt bytes fail instead of passing as U+FFFD mojibake, and reports XML-looking `.action`/`.vsoconf` archive entries with invalid byte sequences instead of skipping them (VCFO-056).

## 2.0.0 - 2026-05-18

This release tightens live-operation safety, improves authentication and error handling, refreshes dependencies and documentation, and adopts Apache License 2.0 with NOTICE attribution.

### Breaking Changes

- Existing live mutation and workflow execution tool calls now require `confirm: true`.
  - Affected tools include workflow creation/execution, action creation, configuration creation/update, deployment creation, template creation, subscription creation/update, and other live import/delete operations that mutate VCFA/vRO state.
  - Calls without `confirm: true` now return a confirmation message instead of changing live state.

### Added

- Added automatic VCFA bearer-token refresh on 401/403 responses so expired sessions can recover without restarting the MCP server.
- Added redaction and truncation for surfaced VCFA/vRO error response bodies, while preserving safe diagnostic fields and correlation IDs.
- Added package validation coverage for published `LICENSE` and `NOTICE` files.

### Changed

- Adopted Apache License 2.0 for future releases, added NOTICE attribution, and clarified official package and repository branding.
- Changed local artifact export/snapshot/scaffold tools to advertise write-capable MCP annotations instead of read-only annotations.
- Synced the advertised MCP server version with the package version.
- Updated npm and GitHub Actions Dependabot checks to run monthly.
- Added npm package references to the README and installation guide.
- Refreshed production and development dependencies through Dependabot.

### Fixed

- Fixed action lookup fallback behavior so non-404 API failures are not silently ignored.
- Fixed duplicate vRA8 compatibility guard calls in artifact import/export paths.
- Fixed OData filter escaping in subscription lookups.

## 1.1.0 - 2026-05-13

This release expands the MCP server from a VCFA-only operations helper into a broader vRO automation toolkit, including vRA/vRO 8 read/run compatibility, package-first publishing workflows, richer artifact validation, and more discovery-oriented prompts and resources.

### Added

- Added `VCFA_TARGET_PLATFORM=vra8` mode for vRA/vRO 8.12+ environments that use Basic authentication against `/vco/api`.
  - Supports read operations for vRO resources plus workflow execution and execution log retrieval.
  - Rejects unsupported vRO writes in vRA8 mode with explicit compatibility errors.
  - Rejects Automation-service APIs in vRA8 mode, including catalog, deployments, templates, subscriptions, and event topics.
- Added workflow execution log support.
  - New `get-workflow-execution-logs` tool retrieves workflow execution logs.
  - Supports inline log formatting plus JSON and text export under the configured execution log artifact directory.
  - Supports minimum log levels and normalizes multiple vRO log response shapes.
- Added recursive workflow category discovery.
  - New `list-workflows-by-category` tool lists workflows under a workflow category tree.
  - Supports category selection by exact `categoryId`, `categoryName`, or `categoryPath`.
  - Supports empty category inclusion and category traversal limits.
- Added category-scoped configuration discovery.
  - `list-configurations` now accepts an optional `categoryId`.
  - Category-scoped listing reads category relations, returns only `ConfigurationElement` entries, and preserves name filtering.
- Added package-first vRO publishing support.
  - New project package workflow supports ensuring the configured project package, adding workflows, actions, configurations, and resources, rebuilding, exporting, inspecting import details, and importing the project package.
  - Package import details and package preflight flows make promotion reviewable before live import.
  - Package operations consistently reuse `VCFA_PROJECT_PACKAGE_NAME` instead of creating ad hoc packages.
- Added package and artifact validation tooling.
  - New package validation script checks package contents.
  - Documentation validation now checks reference drift, local Markdown links, documented tool names, prompt names, and top-level example arguments.
  - CI now includes package validation and documentation build coverage.
- Added richer MCP prompts for discovery-first implementation and troubleshooting workflows.
  - New and expanded prompts cover capability discovery, context snapshots, workflow authoring, workflow-from-action wrappers, workflow refactors, artifact import review, template review/creation, template/subscription integration, deployment troubleshooting, and workflow execution troubleshooting.
- Added MCP resources and reusable patterns.
  - Added workflow scaffold schema and workflow/template/subscription pattern resources.
  - Added persisted context snapshot resources, including `vcfa://context/latest` and named snapshot access.
  - Added dynamic resources for actions, configurations, deployments, packages, resource elements, subscriptions, and workflows.
- Added checked examples for artifact promotion, workflow artifacts, project package publishing, template/catalog/subscription workflows, and workflow execution log exports.
- Added or expanded documentation for artifact lifecycle, workflow authoring, configuration/resources, troubleshooting, safety, installation/configuration, and MCP client setup.

### Changed

- Improved workflow artifact generation and preflight validation.
  - Workflow artifacts now include stronger parameter, binding, input form, action reference, and archive safety validation.
  - Workflow authoring guidance now emphasizes importable `.workflow` artifacts, horizontal layout, safe input forms, and native action item caveats.
- Improved action, configuration, resource, package, and workflow clients to parse additional vRO attribute shapes and preserve more useful metadata.
- Improved context snapshots with safer redaction, deterministic Markdown/JSON output, optional domain coverage, and VMware built-in profiling.
- Improved README, AGENTS, CLAUDE, reference docs, examples, and how-tos to reflect the current tool surface and release workflows.
- Improved CI to test across supported Node.js versions and run the full validation gate on Node 24.
- Updated package dependencies and development dependencies through Dependabot.

### Fixed

- Fixed stale tool/documentation drift around configuration listing and category-scoped configuration discovery.
- Fixed several artifact path-safety and symlink handling cases in workflow, action, configuration, resource, package, and context operations.
- Fixed documentation/example drift detection so stale tool names and arguments fail validation before release.

### Compatibility Notes

- Existing VCFA behavior remains the default. Deployments without `VCFA_TARGET_PLATFORM` continue to use VCFA Cloud API session authentication.
- `VCFA_TARGET_PLATFORM=vra8` is intentionally limited to vRO `/vco/api` read operations plus workflow execution and execution logs. Automation-service APIs remain unsupported in this mode until token-auth support is added.
- Live create, update, import, delete, deployment, day-2, package, template, and subscription operations still require explicit confirmation in their tool inputs and should be preceded by read-only discovery.

## 1.0.1 - 2026-05-04

This patch release focused on improving reusable discovery context, tightening documentation accuracy, and making local artifact defaults clearer after the initial `1.0.0` release.

### Added

- Added richer context snapshot handling for reusable environment discovery.
  - Added persisted context snapshot resources, including latest snapshot lookup and named snapshot access.
  - Added safer context directory resolution so snapshots default to the MCP client's workspace when available.
  - Added tests covering default context locations, persisted snapshot reads, missing snapshot behavior, and unsafe snapshot file names.
- Added the `vcfaBuiltIns` context snapshot profile.
  - Filters VMware built-in workflows and actions for baseline discovery.
  - Helps agents distinguish reusable platform content from project-specific custom content.
  - Expanded prompt guidance to use the profile when VMware built-in context is useful.
- Added prompt examples for reusable workflow discovery and context persistence.
- Added more detailed tool and prompt parameter documentation in the reference pages.

### Changed

- Clarified default artifact directory behavior across README, configuration docs, and reference docs.
  - `VCFA_ARTIFACT_DIR` defaults are described as `artifacts/` under the MCP server process working directory.
  - Context snapshots document their preference for the MCP client's current workspace root.
- Improved action discovery metadata parsing by accepting additional action ID attribute shapes.
- Collapsed and clarified long tool and prompt parameter sections in the documentation.
- Removed obsolete standalone prompt files now covered by registered MCP prompts.
- Added package overrides for `esbuild` and `vite`.

### Fixed

- Fixed context snapshot redaction and resource handling edge cases.
- Fixed documentation drift around `collect-context-snapshot` parameters and usage.
- Fixed stale artifact directory references that still pointed at older default paths.
