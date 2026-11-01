import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, comparePassword } from './utils/passwordUtils.js';

describe('Auth Service Smoke Tests', () => {
  it('hashes and compares passwords correctly', async () => {
    const plain = 'SecretPass123!';
    const hash = await hashPassword(plain);
    assert.ok(hash);
    assert.notEqual(hash, plain);
    const isValid = await comparePassword(plain, hash);
    assert.equal(isValid, true);
    const isInvalid = await comparePassword('wrongPass', hash);
    assert.equal(isInvalid, false);
  });
});
