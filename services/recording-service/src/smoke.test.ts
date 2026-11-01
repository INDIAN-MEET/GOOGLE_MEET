import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startRecordingSchema } from './validation/recordingSchemas.js';

describe('Recording Service Smoke Tests', () => {
  it('validates start recording schema correctly', () => {
    const valid = startRecordingSchema.validate({ roomCode: 'abc-defg-hij' });
    assert.equal(valid.error, undefined);
    const invalid = startRecordingSchema.validate({});
    assert.ok(invalid.error);
  });
});
