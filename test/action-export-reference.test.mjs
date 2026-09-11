import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { ActionClient } from "../dist/client/action-client.js";

// vRO serves GET /actions/<module>/<name> as JSON but answers the same path with
// `Accept: application/zip` with an opaque 400 (verified on vRO 8.18.1,
// VCFO-076). list-actions renders the fully qualified name as an action's
// primary label, so the FQN is what callers naturally pass on to export or diff.

function utf16BeWithBom(text) {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code >> 8;
    bytes[3 + i * 2] = code & 0xff;
  }
  return bytes;
}

// Mirrors a real .action export: an action-info properties file plus a
// UTF-16BE action-content XML payload.
function actionArchive(name, id) {
  const xml = [
    "<?xml version='1.0' encoding='UTF-8'?>",
    `<dunes-script-module name="${name}" result-type="string" api-version="6.0.0" id="${id}" version="0.0.0">`,
    "<script encoded=\"false\"><![CDATA[return 'ok';]]></script>",
    "</dunes-script-module>",
  ].join("\n");
  return zipSync({
    "action-info": new TextEncoder().encode(
      "#\ncharset=UTF-16\ncreator=www.dunes.ch\nunicode=true\n",
    ),
    "action-content": utf16BeWithBom(xml),
  });
}

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

test("exportActionBuffer resolves a dot-separated reference too", async () => {
  const requested = [];
  const client = actionClient(async (url) => {
    requested.push(url);
    return zipResponse();
  });
  client.getAction = async (id) => {
    assert.equal(id, "com.example.probe.zzProbe");
    return { id: "action-uuid", name: "zzProbe", module: "com.example.probe" };
  };

  // get-action accepts this form through parseActionReference's dot fallback,
  // so export must not dead-end on it either.
  await client.exportActionBuffer("com.example.probe.zzProbe");

  assert.deepEqual(requested, [
    "https://vro.example/vco/api/actions/action-uuid",
  ]);
});

test("exportActionBuffer refuses a reference that resolves without an element id", async () => {
  const requested = [];
  const client = actionClient(async (url) => {
    requested.push(url);
    return zipResponse();
  });
  client.getAction = async () => ({ name: "zzProbe", module: "com.example.probe" });

  await assert.rejects(
    client.exportActionBuffer("com.example.probe/zzProbe"),
    /resolved to a definition carrying no element id/,
  );
  // The request must never be attempted with an interpolated "undefined".
  assert.deepEqual(requested, []);
});

test("exportActionFile writes the artifact resolved from a reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vcfo-action-"));
  const requested = [];
  const client = new ActionClient({
    baseUrl: "https://vro.example/vco/api",
    actionDir: dir,
    authenticatedFetch: async (url) => {
      requested.push(url);
      return zipResponse();
    },
  });
  client.getAction = async () => ({ id: "action-uuid", name: "zzProbe" });

  const saved = await client.exportActionFile(
    "com.example.probe/zzProbe",
    "probe.action",
  );

  // macOS resolves the temp dir through a symlink, so compare real paths.
  assert.equal(saved, join(await realpath(dir), "probe.action"));
  assert.deepEqual(requested, [
    "https://vro.example/vco/api/actions/action-uuid",
  ]);
  assert.equal(await readFile(saved, "utf8"), "PK-zip-bytes");
  await rm(dir, { recursive: true, force: true });
});

test("diffActionFile resolves both live action references", async () => {
  const resolved = [];
  const requested = [];
  // Real archive bytes, so the base source inspects cleanly and the compare
  // source is actually reached — a stub payload throws at the base and would
  // hide a regression that resolves only the first source.
  const client = actionClient(async (url) => {
    requested.push(url);
    return {
      ok: true,
      arrayBuffer: async () =>
        actionArchive("zzProbe", "id-for-" + (requested.length)).buffer,
    };
  });
  client.getAction = async (id) => {
    resolved.push(id);
    return { id: `id-for-${resolved.length}`, name: "zzProbe", module: "com.example.probe" };
  };

  await client.diffActionFile({
    base: { source: "live", actionId: "com.example.probe/zzProbe" },
    compare: { source: "live", actionId: "com.example.other/zzOther" },
  });

  assert.deepEqual(resolved, [
    "com.example.probe/zzProbe",
    "com.example.other/zzOther",
  ]);
  assert.deepEqual(requested, [
    "https://vro.example/vco/api/actions/id-for-1",
    "https://vro.example/vco/api/actions/id-for-2",
  ]);
});
