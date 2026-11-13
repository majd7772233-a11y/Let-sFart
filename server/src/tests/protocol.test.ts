import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WS_MESSAGE_BYTES, PROTOCOL_VERSION } from '../../../src/shared/protocol.ts';
import { parseAndValidateClientEnvelope } from '../protocol/validators.ts';

test('protocol validator accepts valid versioned envelopes and rejects malformed or oversized packets', () => {
  const validInput = JSON.stringify({
    version: PROTOCOL_VERSION,
    requestId: 'req-1',
    type: 'input:state',
    payload: { moveDir: -1, farting: true, seq: 1 },
  });
  const okRes = parseAndValidateClientEnvelope(validInput);
  assert.equal(okRes.ok, true);

  // Reject wrong protocol version
  const badVer = parseAndValidateClientEnvelope(
    JSON.stringify({ version: 2, type: 'ping', payload: {} }),
  );
  assert.equal(badVer.ok, false);
  if (!badVer.ok) assert.equal(badVer.error.code, 'UNSUPPORTED_PROTOCOL_VERSION');

  // Reject unknown message type
  const unknownType = parseAndValidateClientEnvelope(
    JSON.stringify({ version: PROTOCOL_VERSION, type: 'room:hack', payload: {} }),
  );
  assert.equal(unknownType.ok, false);
  if (!unknownType.ok) assert.equal(unknownType.error.code, 'UNKNOWN_MESSAGE_TYPE');

  // Reject oversized message
  const huge = JSON.stringify({
    version: PROTOCOL_VERSION,
    type: 'ping',
    payload: { junk: 'x'.repeat(MAX_WS_MESSAGE_BYTES + 100) },
  });
  const tooBig = parseAndValidateClientEnvelope(huge);
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.equal(tooBig.error.code, 'PAYLOAD_TOO_LARGE');

  // Reject input spoofing slot or playerId or invalid moveDir
  const spoofSlot = parseAndValidateClientEnvelope(
    JSON.stringify({
      version: PROTOCOL_VERSION,
      type: 'input:state',
      payload: { moveDir: 1, farting: true, seq: 2, slot: 2 },
    }),
  );
  assert.equal(spoofSlot.ok, false);
  if (!spoofSlot.ok) assert.equal(spoofSlot.error.code, 'INVALID_MESSAGE');

  const badMoveDir = parseAndValidateClientEnvelope(
    JSON.stringify({
      version: PROTOCOL_VERSION,
      type: 'input:state',
      payload: { moveDir: 5, farting: true, seq: 2 },
    }),
  );
  assert.equal(badMoveDir.ok, false);
});
