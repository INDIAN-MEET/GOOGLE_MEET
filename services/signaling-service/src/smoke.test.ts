import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AppError from './utils/AppError.js';

describe('Signaling Service Smoke Tests', () => {
  it('instantiates operational AppError for signaling failure', () => {
    const err = new AppError('Join a room first', 403);
    assert.equal(err.message, 'Join a room first');
    assert.equal(err.statusCode, 403);
  });
});
