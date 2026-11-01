import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AppError from './utils/AppError.js';

describe('API Gateway Smoke Tests', () => {
  it('creates AppError with correct status code and message', () => {
    const err = new AppError('Unauthorized access', 401);
    assert.equal(err.message, 'Unauthorized access');
    assert.equal(err.statusCode, 401);
  });
});
