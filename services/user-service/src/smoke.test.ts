import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AppError from './utils/AppError.js';

describe('User Service Smoke Tests', () => {
  it('instantiates operational AppError correctly', () => {
    const err = new AppError('User not found', 404);
    assert.equal(err.message, 'User not found');
    assert.equal(err.statusCode, 404);
  });
});
