#!/usr/bin/env node
// Explicit local operator entry point; does not impersonate an OpenCode session.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { releaseProjectReservation } from "../plugins/sandbox-control/release.mjs";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--project" || !args[1] || args[1].startsWith("--")) {
  console.error("Usage: node scripts/release-sandbox.mjs --project <checkout-directory>");
  process.exitCode = 2;
} else {
  const result = await releaseProjectReservation({ directory: resolve(args[1]),
    sessionID: `local-operator-${randomUUID()}`, projectID: "local-operator-git-project" });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
