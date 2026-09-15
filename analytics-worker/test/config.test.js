import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const endpoint = "https://alwaysmemo-analytics.ugomemo.workers.dev/v1/events";
const origin = new URL(endpoint).origin;

test("production analytics uses the exact Worker endpoint and CSP origin", () => {
  const developmentEnv = readFileSync(new URL("../../.env.development", import.meta.url), "utf8");
  const productionEnv = readFileSync(new URL("../../.env.production", import.meta.url), "utf8");
  const tauriConfig = JSON.parse(
    readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const workerConfig = JSON.parse(
    readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  const csp = tauriConfig.app.security.csp;
  const devCsp = tauriConfig.app.security.devCsp;
  const envLines = new Set(productionEnv.trim().split(/\r?\n/));
  const developmentEnvLines = new Set(developmentEnv.trim().split(/\r?\n/));
  const developmentEndpoint = "http://127.0.0.1:8787/v1/events";
  const connectSrc = csp.split(";").find((directive) =>
    directive.trim().startsWith("connect-src ")
  );

  assert.equal(envLines.has(`VITE_ANALYTICS_ENDPOINT=${endpoint}`), true);
  assert.equal(envLines.has("VITE_ANALYTICS_ENV=production"), true);
  assert.equal(new URL(endpoint).protocol, "https:");
  assert.equal(new URL(endpoint).pathname, "/v1/events");
  assert.ok(connectSrc);
  assert.equal(connectSrc.trim().split(/\s+/).filter((value) => value === origin).length, 1);
  assert.equal(csp.includes("*.workers.dev"), false);
  assert.equal(devCsp.includes(origin), false);
  assert.equal(developmentEnvLines.has(`VITE_ANALYTICS_ENDPOINT=${developmentEndpoint}`), true);
  assert.equal(developmentEnvLines.has("VITE_ANALYTICS_ENV=test"), true);
  assert.equal(new URL(developmentEndpoint).hostname, "127.0.0.1");
  assert.equal(devCsp.includes(new URL(developmentEndpoint).origin), true);
  assert.equal(csp.includes(new URL(developmentEndpoint).origin), false);
  assert.deepEqual(workerConfig.ratelimits, [{
    name: "EVENTS_RATE_LIMITER",
    namespace_id: "731842019",
    simple: { limit: 60, period: 60 },
  }]);
});
