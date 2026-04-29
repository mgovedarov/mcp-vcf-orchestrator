import assert from "node:assert/strict";
import test from "node:test";
import {
  getExecutionOutputParameters,
  getWorkflowInputParameters,
  getWorkflowOutputParameters,
} from "../dist/tools/workflow-tools.js";

test("workflow parameter helpers accept camelCase response fields", () => {
  const workflow = {
    id: "workflow-1",
    name: "Workflow",
    inputParameters: [{ name: "vm", type: "VC:VirtualMachine" }],
    outputParameters: [{ name: "result", type: "string" }],
  };

  assert.deepEqual(getWorkflowInputParameters(workflow), workflow.inputParameters);
  assert.deepEqual(getWorkflowOutputParameters(workflow), workflow.outputParameters);
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

  assert.deepEqual(getWorkflowInputParameters(workflow), workflow["input-parameters"]);
  assert.deepEqual(getWorkflowOutputParameters(workflow), workflow["output-parameters"]);
  assert.deepEqual(getExecutionOutputParameters(execution), execution["output-parameters"]);
});
