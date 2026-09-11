import assert from "node:assert/strict";
import test from "node:test";
import { ActionClient } from "../dist/client/action-client.js";

// vRO serves GET /actions/<module>/<name> as JSON but answers the same path with
// `Accept: application/zip` with an opaque 400 (verified on vRO 8.18.1,
// VCFO-076). list-actions renders the fully qualified name as an action's
// primary label, so the FQN is what callers naturally pass on to export or diff.

function actionClient(fetchImpl) {
  return new ActionClient({
    baseUrl: "https://vro.example/vco/api",
    authenticatedFetch: fetchImpl,
  });
}

function zipResponse() {
  return {
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode("PK-zip-bytes").buffer,
  };
}

test("exportActionBuffer resolves a fully qualified name to the element id", async () => {
  const requested = [];
  const client = actionClient(async (url) => {
    requested.push(url);
    return zipResponse();
  });
  client.getAction = async (id) => {
    assert.equal(id, "com.example.probe/zzProbe");
    return { id: "53eb3387-d1c5-409a-be91-e295c1353442", name: "zzProbe", module: "com.example.probe" };
  };

  const buffer = await client.exportActionBuffer("com.example.probe/zzProbe");

  assert.equal(buffer.toString(), "PK-zip-bytes");
  assert.deepEqual(requested, [
    "https://vro.example/vco/api/actions/53eb3387-d1c5-409a-be91-e295c1353442",
  ]);
});

test("exportActionBuffer leaves a plain element id untouched", async () => {
  const requested = [];
  const client = actionClient(async (url) => {
    requested.push(url);
    return zipResponse();
  });
  client.getAction = async () => {
    throw new Error("getAction must not be called for a plain element id");
  };

  // A long hex id carries no slash and must not be treated as a reference.
  await client.exportActionBuffer("F58580808080808080808080808080800F8080800126658240472157fdafc0fce");

  assert.deepEqual(requested, [
    "https://vro.example/vco/api/actions/F58580808080808080808080808080800F8080800126658240472157fdafc0fce",
  ]);
});

test("diffActionFile resolves a fully qualified live action reference", async () => {
  let resolved = 0;
  const client = actionClient(async () => zipResponse());
  client.getAction = async () => {
    resolved += 1;
    return { id: "action-uuid", name: "zzProbe", module: "com.example.probe" };
  };
  // inspectActionArtifactBuffer rejects the stub bytes; the assertion here is
  // only that the FQN was resolved before the artifact request was attempted.
  await client
    .diffActionFile({
      base: { source: "live", actionId: "com.example.probe/zzProbe" },
      compare: { source: "live", actionId: "com.example.probe/zzProbe" },
    })
    .catch(() => {});

  assert.ok(resolved >= 1, "expected the FQN to be resolved to an element id");
});
