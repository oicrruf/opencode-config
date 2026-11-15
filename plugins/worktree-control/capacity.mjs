// The capacity measurement.
//
// Capacity is a measurement, never a policy. The control measures the
// bytes available on the filesystem that holds the worktrees and reports
// the measurement together with the number of worktrees. It announces
// no maximum, no remaining budget, and no threshold.
//
// Only a measurement of exactly zero available bytes blocks a
// creation. A measurement that cannot be taken is reported as
// unavailable and does not block anything.

import { statfsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Measure the bytes available on the filesystem that holds a path.
 *
 * The measurement is of the filesystem, not of the directory: the
 * constraint is the space of the volume, and a directory's own size is
 * irrelevant to it.
 */
export function measureAvailableBytes(path) {
  try {
    const stats = statfsSync(path);
    // `bavail` is the blocks available to an unprivileged user, which
    // is the number an operator can actually use.
    return { ok: true, availableBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
  } catch (err) {
    return {
      ok: false,
      reason: `the available space could not be measured: ${err.message}`,
    };
  }
}

/**
 * The capacity report of the project.
 *
 * The report never announces a maximum or a remaining budget: it
 * reports what was measured and the number of worktrees present.
 */
export function reportCapacity(worktreeRoot, worktreeCount = 0) {
  const measurement = measureAvailableBytes(worktreeRoot ?? dirname(worktreeRoot ?? "."));

  if (!measurement.ok) {
    return {
      ok: true,
      available: false,
      reason: measurement.reason,
      worktrees: worktreeCount,
      maximum: null,
      remaining: null,
    };
  }

  return {
    ok: true,
    available: true,
    availableBytes: measurement.availableBytes,
    totalBytes: measurement.totalBytes,
    worktrees: worktreeCount,
    // A maximum and a remaining budget are deliberately absent: the
    // control does not invent a policy it did not measure.
    maximum: null,
    remaining: null,
  };
}

/**
 * Decide whether a creation is blocked by the capacity.
 *
 * Only exactly zero available bytes blocks. A measurement that could not
 * be taken does not block, and a measurement of a few bytes does not
 * block either: the control does not guess a threshold.
 */
export function evaluateCapacityForCreation(capacity) {
  if (!capacity?.available) {
    return {
      blocked: false,
      reason: capacity?.reason ?? "the available space could not be measured",
    };
  }
  if (capacity.availableBytes === 0) {
    return {
      blocked: true,
      reason: "the filesystem that holds the worktrees has no available space",
    };
  }
  return { blocked: false, reason: null };
}
