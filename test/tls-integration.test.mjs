// Integration test for VCFA_IGNORE_TLS: drives the real client through
// Node's built-in fetch against a local self-signed HTTPS server, so a
// Node/undici dispatcher interop regression fails CI instead of passing
// silently behind the stubbed fetch used by the unit tests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VroClient } from "../dist/vro-client.js";

const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
const skip = hasOpenssl ? false : "openssl is not available to generate a test certificate";

const config = (host, overrides = {}) => ({
  host,
  username: "admin",
  organization: "org",
  password: "secret",
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

  const server = https.createServer(
    { key: await readFile(keyPath), cert: await readFile(certPath) },
    (req, res) => {
      if (req.method === "POST" && req.url === "/cloudapi/1.0.0/sessions") {
        res.writeHead(200, { "x-vmware-vcloud-access-token": "integration-token" });
        res.end();
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
    host: `localhost:${server.address().port}`,
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
