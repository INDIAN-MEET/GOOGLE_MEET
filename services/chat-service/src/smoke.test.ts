import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AppError from './utils/AppError.js';

describe('Chat Service Smoke Tests', () => {
  it('instantiates operational AppError for chat errors', () => {
    const err = new AppError('Message is required', 400);
    assert.equal(err.message, 'Message is required');
    assert.equal(err.statusCode, 400);
  });
});
