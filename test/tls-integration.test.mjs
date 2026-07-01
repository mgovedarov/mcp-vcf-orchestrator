// Integration test for VCFA_IGNORE_TLS: drives the real client against a local
// self-signed HTTPS server so a real dispatcher/fetch interop regression fails
// CI instead of passing silently behind the stubbed fetch used by unit tests.
// The ignoreTls path pairs the per-client undici Agent with undici's own
// fetch(); the strict path uses Node's built-in fetch. Both are exercised here,
// including multipart uploads whose body must not degrade to "[object FormData]":
// the ignoreTls upload runs end-to-end through the client, and the strict path
// posts createUploadForm's body through the built-in fetch directly (over plain
// HTTP, since the strict client rejects the self-signed cert and Node's global
// fetch takes no per-request CA). The built-in fetch is backed by the undici
// bundled in the runtime, a different major than the npm undici that built the
// FormData (Node 22 bundles undici 6, Node 24 undici 7), so its serialization
// is not covered by the ignoreTls path.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createUploadForm } from "../dist/client/core.js";
import { VroClient } from "../dist/vro-client.js";

const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
const skip = hasOpenssl ? false : "openssl is not available to generate a test certificate";

const config = (host, overrides = {}) => ({
  host,
  username: "admin",
  organization: "org",
  password: "secret",
  // Pin the Cloud API version so authentication skips the GET /api/versions
  // discovery probe; version negotiation is covered in vro-client.test.mjs.
  targetPlatform: "vcfa9.0",
  ...overrides,
});

async function startSelfSignedVcfaStub() {
  const certDir = await mkdtemp(join(tmpdir(), "vcfa-tls-"));
  const keyPath = join(certDir, "key.pem");
  const certPath = join(certDir, "cert.pem");
  const generated = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath,
    "-days", "2", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  assert.equal(generated.status, 0, `openssl failed: ${generated.stderr}`);

  // Captures the last multipart upload so a test can assert the body was
  // serialized as real multipart/form-data rather than a stringified FormData.
  const captured = { contentType: null, body: null };

  const server = https.createServer(
    { key: await readFile(keyPath), cert: await readFile(certPath) },
    (req, res) => {
      if (req.method === "POST" && req.url === "/cloudapi/1.0.0/sessions") {
        res.writeHead(200, { "x-vmware-vcloud-access-token": "integration-token" });
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/vco/api/resources") {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          captured.contentType = req.headers["content-type"] ?? "";
          captured.body = Buffer.concat(chunks).toString("utf8");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "res-1" }));
        });
        return;
      }
      if (req.url?.startsWith("/vco/api/workflows")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ link: [], total: 0 }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "not found" }));
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    // Connect via 127.0.0.1, not localhost, to bind the client to the IPv4
    // address the stub listens on and avoid any localhost -> ::1 resolution.
    host: `127.0.0.1:${server.address().port}`,
    captured,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await rm(certDir, { recursive: true, force: true });
    },
  };
}

test("ignoreTls client completes a real TLS handshake with a self-signed host", { skip }, async () => {
  const previous = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
  delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
  const stub = await startSelfSignedVcfaStub();
  const client = new VroClient(config(stub.host, { ignoreTls: true }));

  try {
    const workflows = await client.listWorkflows();

    assert.equal(workflows.total, 0);
    assert.equal(
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"],
      undefined,
      "TLS relaxation must not leak into the process-wide env var",
    );
  } finally {
    await client.close();
    await stub.close();
    if (previous !== undefined) {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = previous;
    }
  }
});

test("ignoreTls client uploads a real multipart body over undici's fetch", { skip }, async () => {
  const stub = await startSelfSignedVcfaStub();
  const resourceDir = await mkdtemp(join(tmpdir(), "vcfa-res-"));
  const fileName = "payload.bin";
  await writeFile(join(resourceDir, fileName), Buffer.from([1, 2, 3, 4, 5]));
  const client = new VroClient(config(stub.host, { ignoreTls: true, resourceDir }));

  try {
    // The dispatcher routes this POST through undici's own fetch; the body must
    // be built with undici's FormData or undici stringifies it to "[object
    // FormData]" and sends text/plain instead of multipart.
    await client.importResource("cat-1", fileName);

    assert.match(
      stub.captured.contentType ?? "",
      /^multipart\/form-data; boundary=/,
      `expected a multipart upload, got content-type: ${stub.captured.contentType}`,
    );
    assert.match(
      stub.captured.body ?? "",
      /filename="payload\.bin"/,
      "multipart body is missing the file part",
    );
    assert.doesNotMatch(
      stub.captured.body ?? "",
      /\[object FormData\]/,
      "FormData was stringified instead of serialized as multipart",
    );
  } finally {
    await client.close();
    await stub.close();
    await rm(resourceDir, { recursive: true, force: true });
  }
});

test("createUploadForm serializes as real multipart through Node's built-in fetch", async () => {
  // The strict (non-ignoreTls) path carries no dispatcher, so requestFetch
  // routes uploads through Node's built-in fetch — the same call the client
  // makes. This asserts the runtime-bundled undici still serializes the npm
  // undici FormData as multipart instead of degrading it to "[object
  // FormData]". Plain HTTP isolates FormData serialization from TLS; no openssl
  // dependency, so it runs even where the self-signed-cert tests are skipped.
  const captured = { contentType: null, body: null };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      captured.contentType = req.headers["content-type"] ?? "";
      captured.body = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "res-1" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const form = createUploadForm(Buffer.from([1, 2, 3, 4, 5]), "payload.bin");
    form.append("categoryId", "cat-1");
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      method: "POST",
      body: form,
    });
    assert.equal(res.status, 200);

    assert.match(
      captured.contentType ?? "",
      /^multipart\/form-data; boundary=/,
      `expected a multipart upload, got content-type: ${captured.contentType}`,
    );
    assert.match(
      captured.body ?? "",
      /filename="payload\.bin"/,
      "multipart body is missing the file part",
    );
    assert.doesNotMatch(
      captured.body ?? "",
      /\[object FormData\]/,
      "FormData was stringified instead of serialized as multipart",
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("strict client rejects the self-signed certificate", { skip }, async () => {
  const stub = await startSelfSignedVcfaStub();
  const client = new VroClient(config(stub.host));

  try {
    await assert.rejects(
      () => client.listWorkflows(),
      (err) => {
        const cause = err.cause ?? err;
        assert.match(
          String(cause.code ?? cause.message),
          /SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|fetch failed/,
          `expected a certificate verification failure, got: ${err}`,
        );
        return true;
      },
    );
  } finally {
    await client.close();
    await stub.close();
  }
});
