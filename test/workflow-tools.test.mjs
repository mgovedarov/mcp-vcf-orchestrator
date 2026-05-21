import assert from "node:assert/strict";
import test from "node:test";
import {
  getExecutionOutputParameters,
  getWorkflowInputParameters,
  getWorkflowOutputParameters,
  registerWorkflowTools,
} from "../dist/tools/workflow-tools.js";

function registeredWorkflowTools(client) {
  const handlers = new Map();
  const server = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
  };
  registerWorkflowTools(server, client);
  return handlers;
}

test("workflow parameter helpers accept camelCase response fields", () => {
  const workflow = {
    id: "workflow-1",
    name: "Workflow",
    inputParameters: [{ name: "vm", type: "VC:VirtualMachine" }],
    outputParameters: [{ name: "result", type: "string" }],
  };

  assert.deepEqual(
    getWorkflowInputParameters(workflow),
    workflow.inputParameters,
  );
  assert.deepEqual(
    getWorkflowOutputParameters(workflow),
    workflow.outputParameters,
  );
});

test("workflow parameter helpers fall back to kebab-case response fields", () => {
  const workflow = {
    id: "workflow-1",
    name: "Workflow",
    "input-parameters": [{ name: "vm", type: "VC:VirtualMachine" }],
    "output-parameters": [{ name: "result", type: "string" }],
  };
  const execution = {
    id: "execution-1",
    state: "completed",
    "output-parameters": [{ name: "result", type: "string" }],
  };

  assert.deepEqual(
    getWorkflowInputParameters(workflow),
    workflow["input-parameters"],
  );
  assert.deepEqual(
    getWorkflowOutputParameters(workflow),
    workflow["output-parameters"],
  );
  assert.deepEqual(
    getExecutionOutputParameters(execution),
    execution["output-parameters"],
  );
});

test("list-workflows-by-category is read-only and formats grouped workflows", async () => {
  let paramsSeen;
  const handlers = new Map();
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  registerWorkflowTools(server, {
    listWorkflowsByCategory: async (params) => {
      paramsSeen = params;
      return {
        rootCategory: { id: "test-root", name: "test", path: "/test" },
        workflowCount: 2,
        categories: [
          {
            category: { id: "minko", name: "minko", path: "/test/minko" },
            workflows: [{ id: "wf-simple", name: "simple test" }],
          },
          {
            category: { id: "sql", name: "sql", path: "/test/minko/sql" },
            workflows: [
              {
                id: "wf-read",
                name: "Read active record for 'entity'",
                description: "Reads records",
              },
            ],
          },
        ],
      };
    },
  });

  const result = await handlers.get("list-workflows-by-category")({
    categoryName: "test",
  });

  assert.equal(
    configs.get("list-workflows-by-category").annotations.readOnlyHint,
    true,
  );
  assert.deepEqual(paramsSeen, { categoryName: "test" });
  assert.match(result.content[0].text, /Found 2 workflow\(s\) under \/test/);
  assert.match(result.content[0].text, /Category: \/test\/minko/);
  assert.match(result.content[0].text, /simple test \(id: wf-simple\)/);
  assert.match(result.content[0].text, /Read active record for 'entity'/);
});

test("list-workflows-by-category reports empty and error responses", async () => {
  const emptyHandlers = registeredWorkflowTools({
    listWorkflowsByCategory: async () => ({
      rootCategory: { id: "test-root", name: "test", path: "/test" },
      workflowCount: 0,
      categories: [],
    }),
  });
  const empty = await emptyHandlers.get("list-workflows-by-category")({
    categoryId: "test-root",
  });
  assert.match(empty.content[0].text, /No workflows found/);

  const errorHandlers = registeredWorkflowTools({
    listWorkflowsByCategory: async () => {
      throw new Error("Multiple WorkflowCategory entries match name 'test'");
    },
  });
  const error = await errorHandlers.get("list-workflows-by-category")({
    categoryName: "test",
  });
  assert.equal(error.isError, true);
  assert.match(error.content[0].text, /Multiple WorkflowCategory/);
});

test("list-workflows-by-category shows truncation warning", async () => {
  const handlers = registeredWorkflowTools({
    listWorkflowsByCategory: async () => ({
      rootCategory: { id: "root", name: "Library", path: "/Library" },
      workflowCount: 3,
      truncated: true,
      categories: [
        {
          category: { id: "a", name: "a", path: "/Library/a" },
          workflows: [{ id: "wf-1", name: "wf1" }],
        },
      ],
    }),
  });
  const result = await handlers.get("list-workflows-by-category")({
    categoryName: "Library",
    maxCategories: 2,
  });
  assert.match(result.content[0].text, /Traversal was truncated/);
  assert.match(result.content[0].text, /maxCategories/);
});

test("run-workflow-and-wait rejects strict validation errors before running", async () => {
  let runCalls = 0;
  const handlers = registeredWorkflowTools({
    getWorkflow: async () => ({
      id: "workflow-1",
      name: "Workflow",
      inputParameters: [
        { name: "projectName", type: "string" },
        { name: "count", type: "number" },
      ],
    }),
    runWorkflow: async () => {
      runCalls += 1;
      return { id: "execution-1", state: "running" };
    },
  });

  const result = await handlers.get("run-workflow-and-wait")({
    id: "workflow-1",
    confirm: true,
    inputs: [
      { name: "projectName", type: "string", value: 123 },
      { name: "projectName", type: "string", value: "duplicate" },
      { name: "extra", type: "string", value: "unused" },
    ],
  });

  assert.equal(result.isError, true);
  assert.equal(runCalls, 0);
  assert.match(result.content[0].text, /Input projectName must be a string/);
  assert.match(result.content[0].text, /Duplicate input: projectName/);
  assert.match(result.content[0].text, /Unknown input: extra/);
  assert.match(result.content[0].text, /Missing required input: count/);
});

test("run-workflow-and-wait requires confirmation before discovery or execution", async () => {
  let getCalls = 0;
  let runCalls = 0;
  const handlers = registeredWorkflowTools({
    getWorkflow: async () => {
      getCalls += 1;
      return { id: "workflow-1", name: "Workflow", inputParameters: [] };
    },
    runWorkflow: async () => {
      runCalls += 1;
      return { id: "execution-1", state: "running" };
    },
  });

  const result = await handlers.get("run-workflow-and-wait")({
    id: "workflow-1",
    confirm: false,
  });

  assert.equal(getCalls, 0);
  assert.equal(runCalls, 0);
  assert.match(result.content[0].text, /setting confirm to true/);
});

test("run-workflow-and-wait fills omitted input types and returns outputs", async () => {
  let runInputs;
  let polls = 0;
  const handlers = registeredWorkflowTools({
    getWorkflow: async () => ({
      id: "workflow-1",
      name: "Workflow",
      inputParameters: [{ name: "name", type: "string" }],
    }),
    runWorkflow: async (_id, inputs) => {
      runInputs = inputs;
      return { id: "execution-1", state: "running" };
    },
    getWorkflowExecution: async () => {
      polls += 1;
      if (polls === 1) {
        return { id: "execution-1", state: "running" };
      }
      return {
        id: "execution-1",
        state: "COMPLETED",
        outputParameters: [
          {
            name: "result",
            type: "string",
            value: { string: { value: "ok" } },
          },
        ],
      };
    },
  });

  const result = await handlers.get("run-workflow-and-wait")({
    id: "workflow-1",
    inputs: [{ name: "name", value: "web-server-01" }],
    timeoutSeconds: 1,
    pollIntervalSeconds: 0,
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(runInputs, [
    { name: "name", type: "string", value: "web-server-01" },
  ]);
  assert.match(result.content[0].text, /Workflow execution completed/);
  assert.match(result.content[0].text, /result \(string\): "ok"/);
});

test("run-workflow expected guards stop before execution on mismatch", async () => {
  let runCalls = 0;
  const handlers = registeredWorkflowTools({
    getWorkflow: async () => ({
      id: "workflow-1",
      name: "Provision VM",
      inputParameters: [{ name: "vmName", type: "string" }],
    }),
    runWorkflow: async () => {
      runCalls += 1;
      return { id: "execution-1", state: "running" };
    },
  });

  const result = await handlers.get("run-workflow")({
    id: "workflow-1",
    expectedWorkflowName: "Delete VM",
    confirm: true,
  });

  assert.equal(result.isError, true);
  assert.equal(runCalls, 0);
  assert.match(result.content[0].text, /Target confirmation failed/);
  assert.match(result.content[0].text, /workflow name/);
});

test("run-workflow-and-wait verifies expected input names before running", async () => {
  let runCalls = 0;
  const handlers = registeredWorkflowTools({
    getWorkflow: async () => ({
      id: "workflow-1",
      name: "Provision VM",
      inputParameters: [{ name: "vmName", type: "string" }],
    }),
    runWorkflow: async () => {
      runCalls += 1;
      return { id: "execution-1", state: "running" };
    },
  });

  const result = await handlers.get("run-workflow-and-wait")({
    id: "workflow-1",
    expectedWorkflowName: "Provision VM",
    expectedInputNames: ["projectName"],
    inputs: [{ name: "vmName", value: "web-01" }],
    confirm: true,
  });

  assert.equal(result.isError, true);
  assert.equal(runCalls, 0);
  assert.match(result.content[0].text, /input names/);
});

test("delete-workflow verifies expected name when provided", async () => {
  let deletedId;
  const handlers = registeredWorkflowTools({
    getWorkflow: async (id) => ({ id, name: "Cleanup VM" }),
    deleteWorkflow: async (id) => {
      deletedId = id;
    },
  });

  const mismatch = await handlers.get("delete-workflow")({
    id: "workflow-1",
    expectedName: "Provision VM",
    confirm: true,
  });
  assert.equal(mismatch.isError, true);
  assert.equal(deletedId, undefined);

  const success = await handlers.get("delete-workflow")({
    id: "workflow-1",
    expectedName: "Cleanup VM",
    confirm: true,
  });
  assert.equal(success.isError, undefined);
  assert.equal(deletedId, "workflow-1");
});

test("run-workflow-and-wait reports failure diagnostics and log excerpts", async () => {
  const handlers = registeredWorkflowTools({
    getWorkflow: async () => ({
      id: "workflow-1",
      name: "Workflow",
      inputParameters: [],
    }),
    runWorkflow: async () => ({ id: "execution-1", state: "running" }),
    getWorkflowExecution: async (_workflowId, _executionId, options) => {
      if (options?.showDetails) {
        return {
          id: "execution-1",
          state: "FAILED",
          "content-exception": "boom",
          "current-item-display-name": "Scriptable task",
          "execution-stack": [{ name: "item1", displayName: "Validate input" }],
        };
      }
      return { id: "execution-1", state: "FAILED" };
    },
    getWorkflowExecutionLogs: async () => ({
      logs: [
        {
          severity: "ERROR",
          "short-description": "Script failed",
          "long-description": "Line 3: boom",
        },
      ],
    }),
  });

  const result = await handlers.get("run-workflow-and-wait")({
    id: "workflow-1",
    timeoutSeconds: 1,
    pollIntervalSeconds: 0,
    confirm: true,
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Workflow execution failed/);
  assert.match(result.content[0].text, /Error: boom/);
  assert.match(result.content[0].text, /Current item: Scriptable task/);
  assert.match(result.content[0].text, /Validate input/);
  assert.match(result.content[0].text, /Script failed/);
});

test("run-workflow-and-wait times out without canceling the workflow", async () => {
  const handlers = registeredWorkflowTools({
    getWorkflow: async () => ({
      id: "workflow-1",
      name: "Workflow",
      inputParameters: [],
    }),
    runWorkflow: async () => ({ id: "execution-1", state: "running" }),
    getWorkflowExecution: async (_workflowId, _executionId, options) => ({
      id: "execution-1",
      state: "running",
      ...(options?.showDetails
        ? { "current-item-for-display": "Waiting for task" }
        : {}),
    }),
    getWorkflowExecutionLogs: async () => ({ logs: [] }),
  });

  const result = await handlers.get("run-workflow-and-wait")({
    id: "workflow-1",
    timeoutSeconds: 0,
    pollIntervalSeconds: 0,
    confirm: true,
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Workflow execution timed out/);
  assert.match(result.content[0].text, /State: running/);
  assert.match(result.content[0].text, /The remote workflow was not canceled/);
  assert.match(result.content[0].text, /Current item: Waiting for task/);
});

test("run-workflow-and-wait reports log fetch warnings", async () => {
  const handlers = registeredWorkflowTools({
    getWorkflow: async () => ({
      id: "workflow-1",
      name: "Workflow",
      inputParameters: [],
    }),
    runWorkflow: async () => ({ id: "execution-1", state: "running" }),
    getWorkflowExecution: async (_workflowId, _executionId, options) => ({
      id: "execution-1",
      state: "FAILED",
      ...(options?.showDetails ? { "content-exception": "boom" } : {}),
    }),
    getWorkflowExecutionLogs: async () => {
      throw new Error("logs unavailable");
    },
  });

  const result = await handlers.get("run-workflow-and-wait")({
    id: "workflow-1",
    timeoutSeconds: 1,
    pollIntervalSeconds: 0,
    confirm: true,
  });

  assert.equal(result.isError, true);
  assert.match(
    result.content[0].text,
    /Unable to fetch execution logs: logs unavailable/,
  );
});

test("get-workflow-execution-logs formats execution log entries", async () => {
  let logRequest;
  const handlers = registeredWorkflowTools({
    getWorkflowExecutionLogs: async (workflowId, executionId, options) => {
      logRequest = { workflowId, executionId, options };
      return {
        logs: [
          {
            severity: "INFO",
            origin: "item1",
            "time-stamp": "2026-05-12T10:00:00Z",
            "short-description": "Started",
          },
        ],
      };
    },
  });

  const result = await handlers.get("get-workflow-execution-logs")({
    workflowId: "workflow-1",
    executionId: "execution-1",
    maxResult: 5,
  });

  assert.deepEqual(logRequest, {
    workflowId: "workflow-1",
    executionId: "execution-1",
    options: { maxResult: 5 },
  });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Found 1 execution log/);
  assert.match(result.content[0].text, /2026-05-12T10:00:00Z \[INFO\] item1 Started/);
});

test("get-workflow-execution-logs formats attribute-shaped log entries", async () => {
  const handlers = registeredWorkflowTools({
    getWorkflowExecutionLogs: async () => ({
      logs: [
        {
          attributes: [
            { name: "severity", value: "INFO" },
            { name: "timeStamp", value: "2026-05-13T07:15:45Z" },
            { name: "message", value: "hello from attributes" },
          ],
        },
      ],
    }),
  });

  const result = await handlers.get("get-workflow-execution-logs")({
    workflowId: "workflow-1",
    executionId: "execution-1",
  });

  assert.match(
    result.content[0].text,
    /2026-05-13T07:15:45Z \[INFO\] hello from attributes/,
  );
});

test("get-workflow-execution-logs filters inline logs by minimum level", async () => {
  const handlers = registeredWorkflowTools({
    getWorkflowExecutionLogs: async () => ({
      logs: [
        {
          severity: "INFO",
          "short-description": "Started",
        },
        {
          severity: "ERROR",
          "short-description": "Failed",
        },
      ],
    }),
  });

  const result = await handlers.get("get-workflow-execution-logs")({
    workflowId: "workflow-1",
    executionId: "execution-1",
    level: "error",
  });

  assert.match(result.content[0].text, /Found 1 execution log/);
  assert.doesNotMatch(result.content[0].text, /Started/);
  assert.match(result.content[0].text, /Failed/);
});

test("get-workflow-execution-logs reports empty inline level matches", async () => {
  const handlers = registeredWorkflowTools({
    getWorkflowExecutionLogs: async () => ({
      logs: [
        {
          severity: "INFO",
          "short-description": "Started",
        },
      ],
    }),
  });

  const result = await handlers.get("get-workflow-execution-logs")({
    workflowId: "workflow-1",
    executionId: "execution-1",
    level: "error",
  });

  assert.equal(result.content[0].text, "No execution logs found.");
});

test("get-workflow-execution-logs reports empty logs", async () => {
  const handlers = registeredWorkflowTools({
    getWorkflowExecutionLogs: async () => ({ logs: [] }),
  });

  const result = await handlers.get("get-workflow-execution-logs")({
    workflowId: "workflow-1",
    executionId: "execution-1",
  });

  assert.equal(result.content[0].text, "No execution logs found.");
});

test("get-workflow-execution-logs exports when fileName is provided", async () => {
  let exportParams;
  const handlers = new Map();
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  registerWorkflowTools(server, {
    exportWorkflowExecutionLogs: async (params) => {
      exportParams = params;
      return {
        path: "/tmp/execution-logs/execution-1.json",
        level: params.level,
        format: "json",
        fetchedCount: 3,
        exportedCount: 2,
      };
    },
  });

  const result = await handlers.get("get-workflow-execution-logs")({
    workflowId: "workflow-1",
    executionId: "execution-1",
    fileName: "execution-1.json",
    maxResult: 3,
  });

  // readOnlyHint stays true: file write is conditional on the optional fileName
  // param; the primary function is read-only log retrieval. See VCFO-040.
  assert.equal(
    configs.get("get-workflow-execution-logs").annotations.readOnlyHint,
    true,
  );
  assert.deepEqual(exportParams, {
    workflowId: "workflow-1",
    executionId: "execution-1",
    fileName: "execution-1.json",
    maxResult: 3,
    level: "info",
    format: undefined,
    overwrite: false,
  });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /execution-1\.json/);
  assert.match(result.content[0].text, /Level: info/);
  assert.match(result.content[0].text, /Format: json/);
  assert.match(result.content[0].text, /Exported log count: 2/);
});

test("get-workflow-execution-logs surfaces export errors", async () => {
  const handlers = registeredWorkflowTools({
    exportWorkflowExecutionLogs: async () => {
      throw new Error("Execution log export file already exists");
    },
  });

  const result = await handlers.get("get-workflow-execution-logs")({
    workflowId: "workflow-1",
    executionId: "execution-1",
    fileName: "execution-1.json",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /already exists/);
});

test("scaffold-workflow-file returns saved path", async () => {
  let scaffoldParams;
  const handlers = registeredWorkflowTools({
    scaffoldWorkflowFile: async (params) => {
      scaffoldParams = params;
      return "/tmp/workflows/generated.workflow";
    },
  });

  const result = await handlers.get("scaffold-workflow-file")({
    fileName: "generated.workflow",
    workflow: {
      name: "Generated Workflow",
      inputs: [{ name: "message", type: "string" }],
      outputs: [{ name: "result", type: "string" }],
      tasks: [
        {
          script: "result = message;",
          inBindings: [{ name: "message", type: "string", source: "message" }],
          outBindings: [{ name: "result", type: "string", target: "result" }],
        },
      ],
    },
  });

  assert.deepEqual(scaffoldParams, {
    fileName: "generated.workflow",
    overwrite: false,
    workflow: {
      name: "Generated Workflow",
      inputs: [{ name: "message", type: "string" }],
      outputs: [{ name: "result", type: "string" }],
      tasks: [
        {
          script: "result = message;",
          inBindings: [{ name: "message", type: "string", source: "message" }],
          outBindings: [{ name: "result", type: "string", target: "result" }],
        },
      ],
    },
  });
  assert.match(result.content[0].text, /generated.workflow/);
  assert.match(result.content[0].text, /import-workflow-file/);
});

test("scaffold-workflow-file surfaces validation errors", async () => {
  const handlers = registeredWorkflowTools({
    scaffoldWorkflowFile: async () => {
      throw new Error("Invalid workflow artifact spec: missing binding");
    },
  });

  const result = await handlers.get("scaffold-workflow-file")({
    fileName: "generated.workflow",
    workflow: {
      name: "Generated Workflow",
      tasks: [{ script: "System.log('hello');" }],
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /missing binding/);
});

test("preflight-workflow-file formats reports and is read-only", async () => {
  const handlers = new Map();
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  registerWorkflowTools(server, {
    preflightWorkflowFile: async (fileName) => ({
      kind: "workflow",
      fileName,
      valid: false,
      errors: ["Missing required workflow-content entry"],
      warnings: [],
      metadata: { id: "workflow-1" },
      entries: [{ name: "workflow-info", size: 42 }],
      parameters: [],
      actionReferences: [],
    }),
  });

  assert.equal(
    configs.get("preflight-workflow-file").annotations.readOnlyHint,
    true,
  );

  const result = await handlers.get("preflight-workflow-file")({
    fileName: "bad.workflow",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /preflight failed/);
  assert.match(result.content[0].text, /Missing required workflow-content/);
});

test("diff-workflow-file is read-only and delegates to client", async () => {
  const handlers = new Map();
  const configs = new Map();
  let diffParams;
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  registerWorkflowTools(server, {
    diffWorkflowFile: async (params) => {
      diffParams = params;
      return "No meaningful workflow changes found";
    },
  });

  assert.equal(
    configs.get("diff-workflow-file").annotations.readOnlyHint,
    true,
  );

  const input = {
    base: { source: "live", workflowId: "workflow-1" },
    compare: { source: "file", fileName: "local.workflow" },
  };
  const result = await handlers.get("diff-workflow-file")(input);

  assert.deepEqual(diffParams, input);
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /No meaningful workflow changes/);
});

test("export-workflow-file is not read-only", () => {
  const configs = new Map();
  const server = {
    registerTool(name, config, _handler) {
      configs.set(name, config);
    },
  };
  registerWorkflowTools(server, {});

  assert.equal(configs.get("export-workflow-file").annotations.readOnlyHint, false);
});
