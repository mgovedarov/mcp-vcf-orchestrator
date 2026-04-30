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
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(runInputs, [
    { name: "name", type: "string", value: "web-server-01" },
  ]);
  assert.match(result.content[0].text, /Workflow execution completed/);
  assert.match(result.content[0].text, /result \(string\): "ok"/);
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
  });

  assert.equal(result.isError, true);
  assert.match(
    result.content[0].text,
    /Unable to fetch execution logs: logs unavailable/,
  );
});
