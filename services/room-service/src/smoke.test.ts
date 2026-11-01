import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomCode } from './utils/roomCode.js';

describe('Room Service Smoke Tests', () => {
  it('generates standard Google Meet room code format', () => {
    const code = generateRoomCode();
    assert.match(code, /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/);
  });
});
