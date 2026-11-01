import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from './utils/AppError.js';

describe('Notification Service Smoke Tests', () => {
  it('instantiates operational AppError for notification failures', () => {
    const err = new AppError('Email delivery failed', 500);
    assert.equal(err.message, 'Email delivery failed');
    assert.equal(err.statusCode, 500);
  });
});
