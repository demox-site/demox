'use strict';

const DEFAULT_LIMITS = Object.freeze({
  timeoutMs: 1000,
  memoryLimitBytes: 16 * 1024 * 1024,
  maxBodyBytes: 64 * 1024,
  maxResponseBytes: 256 * 1024,
  maxCodeBytes: 256 * 1024,
  maxInvocationsPerMinute: 60
});

const ABSOLUTE_LIMITS = Object.freeze({
  timeoutMs: 10_000,
  memoryLimitBytes: 64 * 1024 * 1024,
  maxBodyBytes: 1024 * 1024,
  maxResponseBytes: 1024 * 1024,
  maxCodeBytes: 1024 * 1024,
  maxInvocationsPerMinute: 10_000
});

const NODE_DEFAULT_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  memoryLimitBytes: 128 * 1024 * 1024,
  maxBodyBytes: 6 * 1024 * 1024,
  maxResponseBytes: 6 * 1024 * 1024,
  maxCodeBytes: 1024 * 1024,
  maxInvocationsPerMinute: 60
});

const NODE_ABSOLUTE_LIMITS = Object.freeze({
  timeoutMs: 300_000,
  memoryLimitBytes: 512 * 1024 * 1024,
  maxBodyBytes: 6 * 1024 * 1024,
  maxResponseBytes: 6 * 1024 * 1024,
  maxCodeBytes: 2 * 1024 * 1024,
  maxInvocationsPerMinute: 10_000
});

function positiveInteger(value, fallback, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function limitsForRuntime(runtime) {
  const name = String(runtime || 'nodejs').toLowerCase();
  if (name === 'quickjs' || name === 'js') {
    return { defaults: DEFAULT_LIMITS, absolute: ABSOLUTE_LIMITS };
  }
  return { defaults: NODE_DEFAULT_LIMITS, absolute: NODE_ABSOLUTE_LIMITS };
}

function normalizeLimits(input = {}, runtime = 'nodejs') {
  const { defaults, absolute } = limitsForRuntime(runtime);
  return {
    timeoutMs: positiveInteger(input.timeoutMs, defaults.timeoutMs, absolute.timeoutMs),
    memoryLimitBytes: positiveInteger(input.memoryLimitBytes, defaults.memoryLimitBytes, absolute.memoryLimitBytes),
    maxBodyBytes: positiveInteger(input.maxBodyBytes, defaults.maxBodyBytes, absolute.maxBodyBytes),
    maxResponseBytes: positiveInteger(input.maxResponseBytes, defaults.maxResponseBytes, absolute.maxResponseBytes),
    maxCodeBytes: positiveInteger(input.maxCodeBytes, defaults.maxCodeBytes, absolute.maxCodeBytes),
    maxInvocationsPerMinute: positiveInteger(input.maxInvocationsPerMinute, defaults.maxInvocationsPerMinute, absolute.maxInvocationsPerMinute)
  };
}

module.exports = {
  DEFAULT_LIMITS,
  ABSOLUTE_LIMITS,
  NODE_DEFAULT_LIMITS,
  NODE_ABSOLUTE_LIMITS,
  normalizeLimits,
  limitsForRuntime
};
