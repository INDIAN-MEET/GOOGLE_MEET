import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSource, isValidKind } from './mediasoup/producerManager.js';

describe('SFU Producer Manager Smoke Tests', () => {
  it('validates supported producer sources', () => {
    assert.equal(isValidSource('camera'), true);
    assert.equal(isValidSource('mic'), true);
    assert.equal(isValidSource('screen'), true);
    assert.equal(isValidSource('unknown'), false);
  });

  it('validates media kinds', () => {
    assert.equal(isValidKind('audio'), true);
    assert.equal(isValidKind('video'), true);
    assert.equal(isValidKind('data'), false);
  });
});
