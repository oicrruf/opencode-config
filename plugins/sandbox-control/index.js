// The sandbox control plugin.
//
// The plugin exposes the tools an agent uses to verify a change that can
// only be verified at runtime. It is installed as a managed global
// resource, so it runs in every project on the host; it stays inert
// when the project does not declare a sandbox configuration.
//
// Every tool description states the property that matters: the sandbox
// produces evidence, it never approves a product, and it never changes
// the host's Git state.

import { startSandbox, sandboxStatus, finishSandbox, cancelSandbox, recoverSandbox } from "./lifecycle.mjs";
import {
  startLocalExecution,
  stopLocalExecution,
  closeRemainingDescendants,
  recoverReservation,
  armSupervisor,
  readSupervisor,
  disarmSupervisor,
} from "./execution.mjs";
import { readSandboxConfig } from "./sandbox-config.mjs";
import { checkEngineHost, checkEngineReachable } from "./docker-adapter.mjs";

const SANDBOX_DESCRIPTION =
  "Build and test an independent capture of the work under test in an isolated local Docker container. " +
  "The tool records evidence; it does not approve a product, it does not claim equivalence with production, " +
  "and it never modifies the host's branches, publishes code, or opens a pull request. " +
  "The result states are passed, failed, blocked, and not executed.";

const RESERVATION_DESCRIPTION =
  "Reserve the single local application slot of the project. The reservation records its owner and its " +
  "process group, and only the token that owns it may stop the application. " +
  "A reservation is released only when the identity and the absence of the resources are both verified.";

function currentWorktree() {
  return process.cwd();
}

/**
 * The tool surface of the sandbox control.
 */
export const SandboxControlPlugin = async () => {
  return {
    tool: {
      sandbox_start: {
        description: SANDBOX_DESCRIPTION,
        args: {
          workId: { type: "string", description: "the identifier of the work under test" },
          workName: { type: "string", description: "the name of the work, used for the resource names" },
          worktreePath: { type: "string", description: "the managed worktree that holds the work" },
          maxDurationSeconds: {
            type: "number",
            description: "the maximum duration of the execution; no timeout is applied when it is absent",
          },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          return startSandbox({
            workId: args?.workId,
            workName: args?.workName,
            worktreePath: args?.worktreePath,
            maxDurationSeconds: args?.maxDurationSeconds ?? null,
            cwd,
          });
        },
      },

      sandbox_status: {
        description:
          "Report the identity, the phase, and the visible conditions of a sandbox execution. " +
          "A ready environment is not an approved test.",
        args: {
          executionId: { type: "string", description: "the identity of the execution" },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          return sandboxStatus(cwd, args?.executionId);
        },
      },

      sandbox_finish: {
        description:
          "Conclude a sandbox execution with an explicit result of passed, failed, blocked, or not executed. " +
          "The report is written outside the environment before any resource is removed.",
        args: {
          executionId: { type: "string", description: "the identity of the execution" },
          result: {
            type: "string",
            description: "one of passed, failed, blocked, or not executed",
          },
          steps: { type: "array", description: "the steps that were performed" },
          differencesFromProduction: {
            type: "array",
            description: "the conditions under which the test differs from production",
          },
          token: { type: "string", description: "the token that owns the reservation" },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          return finishSandbox(cwd, args?.executionId, {
            result: args?.result,
            steps: args?.steps ?? [],
            differencesFromProduction: args?.differencesFromProduction ?? [],
            token: args?.token ?? null,
          });
        },
      },

      sandbox_cancel: {
        description:
          "Cancel a sandbox execution. The quota is kept until the resources of the execution are accounted for.",
        args: {
          executionId: { type: "string", description: "the identity of the execution" },
          reason: { type: "string", description: "why the execution was cancelled" },
          token: { type: "string", description: "the token that owns the reservation" },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          return cancelSandbox(cwd, args?.executionId, {
            reason: args?.reason ?? "cancelled",
            token: args?.token ?? null,
          });
        },
      },

      sandbox_recover: {
        description:
          "Resume the closure of an interrupted sandbox execution. The recovery never starts a second test " +
          "for the same execution and never acts on another execution.",
        args: {
          executionId: { type: "string", description: "the identity of the execution" },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          return recoverSandbox(cwd, args?.executionId);
        },
      },

      reservation_start: {
        description: RESERVATION_DESCRIPTION,
        args: {
          workId: { type: "string", description: "the identifier of the work" },
          workName: { type: "string", description: "the name of the work" },
          executable: { type: "string", description: "the program to run, without a shell" },
          args: { type: "array", description: "the arguments of the program" },
          cwd: { type: "string", description: "the directory the program runs in" },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          return startLocalExecution(cwd, {
            workId: args?.workId,
            workName: args?.workName,
            executable: args?.executable,
            args: args?.args ?? [],
            cwd: args?.cwd,
          });
        },
      },

      reservation_stop: {
        description:
          "Stop the local application through the token that owns the reservation. Only the managed process " +
          "group is signalled, and the reservation is released only when the group is confirmed to be empty.",
        args: {
          token: { type: "string", description: "the token that owns the reservation" },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          return stopLocalExecution(cwd, args?.token);
        },
      },

      reservation_recover: {
        description:
          "Recover an abandoned reservation. The recovery proceeds only when the exact owner is confirmed to " +
          "have ended and its process group is empty; it never proceeds on age alone.",
        args: {
          token: { type: "string", description: "the token of the reservation to recover" },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          return recoverReservation(cwd, {
            ownerEnded: true,
            groupHasProcesses: false,
            token: args?.token,
          });
        },
      },

      sandbox_preflight: {
        description:
          "Report whether this host and this project can run the sandbox, and what the declared configuration " +
          "is. The check installs nothing and changes nothing.",
        args: {},
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          const host = checkEngineHost();
          const engine = host.ok ? checkEngineReachable() : { ok: false, reason: host.reason };
          const config = readSandboxConfig(cwd);
          return {
            ok: true,
            host,
            engine,
            config: config.ok
              ? {
                  ok: true,
                  dockerfile: config.config.dockerfileRelative,
                  context: config.config.contextRelative,
                  stage: config.config.stage,
                  ports: config.config.ports,
                }
              : { ok: false, reason: config.reason, missing: config.missing },
            ready: host.ok && engine.ok && config.ok,
          };
        },
      },

      sandbox_supervisor: {
        description:
          "Inspect or disarm the independent deadline supervisor of an execution. The supervisor closes an " +
          "expired run without approving it.",
        args: {
          executionId: { type: "string", description: "the identity of the execution" },
          action: { type: "string", description: "either inspect or disarm" },
        },
        async execute(args, context) {
          const cwd = context?.directory ?? currentWorktree();
          if (args?.action === "disarm") return disarmSupervisor(cwd);
          return readSupervisor(cwd);
        },
      },
    },
  };
};

export { armSupervisor, closeRemainingDescendants };
