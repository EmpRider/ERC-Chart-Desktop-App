import assert from "node:assert/strict";
import test from "node:test";
import {
  API_ROOT,
  reconcileRepository,
  repositorySettings,
  workflowPermissions,
} from "../src/github-admin.mjs";

function response(status, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return body === null ? "" : JSON.stringify(body);
    },
  };
}

test("dry-run never sends a request or exposes a token", async () => {
  let calls = 0;
  const logs = [];
  const token = "sensitive-admin-token";
  const result = await reconcileRepository({
    apply: false,
    token,
    fetchImpl: async () => {
      calls += 1;
      return response(500);
    },
    logger: { log: (value) => logs.push(value) },
  });
  assert.equal(calls, 0);
  assert.equal(result.applied, false);
  assert.equal(logs.join("\n").includes(token), false);
});

test("apply patches settings and creates or updates rulesets", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === `${API_ROOT}/rulesets` && options.method === "GET") {
      return response(200, [{ id: 9, name: "ERC main" }]);
    }
    return response(options.method === "POST" ? 201 : 200, {});
  };
  await reconcileRepository({
    apply: true,
    token: "token-value",
    fetchImpl,
    logger: { log: () => undefined },
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), repositorySettings);
  assert.deepEqual(JSON.parse(calls[1].options.body), workflowPermissions);
  assert.ok(
    calls.some(
      ({ url, options }) =>
        url.endsWith("/rulesets/9") && options.method === "PUT",
    ),
  );
  assert.ok(
    calls.some(
      ({ url, options }) =>
        url.endsWith("/rulesets") && options.method === "POST",
    ),
  );
});

test("missing apply token exits before any request", async () => {
  let calls = 0;
  await assert.rejects(
    reconcileRepository({
      apply: true,
      fetchImpl: async () => {
        calls += 1;
      },
    }),
    /ERC_CHART_GITHUB_ADMIN_TOKEN/,
  );
  assert.equal(calls, 0);
});

test("a failed request stops later writes", async () => {
  let calls = 0;
  await assert.rejects(
    reconcileRepository({
      apply: true,
      token: "token-value",
      fetchImpl: async () => {
        calls += 1;
        return response(403, { message: "forbidden" });
      },
      logger: { log: () => undefined },
    }),
    /failed with 403/,
  );
  assert.equal(calls, 1);
});
