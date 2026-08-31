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

function positiveInteger(value, fallback, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function normalizeLimits(input = {}) {
  return {
    timeoutMs: positiveInteger(input.timeoutMs, DEFAULT_LIMITS.timeoutMs, ABSOLUTE_LIMITS.timeoutMs),
    memoryLimitBytes: positiveInteger(input.memoryLimitBytes, DEFAULT_LIMITS.memoryLimitBytes, ABSOLUTE_LIMITS.memoryLimitBytes),
    maxBodyBytes: positiveInteger(input.maxBodyBytes, DEFAULT_LIMITS.maxBodyBytes, ABSOLUTE_LIMITS.maxBodyBytes),
    maxResponseBytes: positiveInteger(input.maxResponseBytes, DEFAULT_LIMITS.maxResponseBytes, ABSOLUTE_LIMITS.maxResponseBytes),
    maxCodeBytes: positiveInteger(input.maxCodeBytes, DEFAULT_LIMITS.maxCodeBytes, ABSOLUTE_LIMITS.maxCodeBytes),
    maxInvocationsPerMinute: positiveInteger(input.maxInvocationsPerMinute, DEFAULT_LIMITS.maxInvocationsPerMinute, ABSOLUTE_LIMITS.maxInvocationsPerMinute)
  };
}

module.exports = { DEFAULT_LIMITS, ABSOLUTE_LIMITS, normalizeLimits };
