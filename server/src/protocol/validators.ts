import {
  MAX_WS_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type ClientProtocolMessage,
  type ProtocolErrorCode,
} from '../../../src/shared/protocol.ts';
import { isBoolean, isRecord, isSafeInt, validateCosmetic } from '../lib/validation.ts';
import { ProtocolError } from './errors.ts';

export function getMessageByteLength(raw: string | ArrayBuffer | ArrayBufferView): number {
  if (typeof raw === 'string') {
    return new TextEncoder().encode(raw).byteLength;
  }
  return raw.byteLength;
}

export function decodeRawMessageToString(raw: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(raw));
  }
  return new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
}

function fail(
  code: ProtocolErrorCode,
  message?: string,
  requestId?: string,
  command?: string,
): { ok: false; error: ProtocolError; requestId?: string } {
  return { ok: false, error: new ProtocolError(code, message, 400, command), requestId };
}

export function parseAndValidateClientEnvelope(
  raw: string | ArrayBuffer | ArrayBufferView,
):
  | { ok: true; message: ClientProtocolMessage }
  | { ok: false; error: ProtocolError; requestId?: string } {
  if (getMessageByteLength(raw) > MAX_WS_MESSAGE_BYTES) {
    return fail('PAYLOAD_TOO_LARGE');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeRawMessageToString(raw));
  } catch {
    return fail('INVALID_MESSAGE', 'تعذر قراءة JSON.');
  }

  if (!isRecord(parsed)) {
    return fail('INVALID_MESSAGE');
  }

  let requestId: string | undefined;
  if (parsed.requestId !== undefined) {
    if (typeof parsed.requestId !== 'string' || parsed.requestId.length === 0 || parsed.requestId.length > 64) {
      return fail('INVALID_MESSAGE', 'معرف الطلب requestId غير صالح.');
    }
    requestId = parsed.requestId;
  }

  if (parsed.version !== PROTOCOL_VERSION) {
    return fail('UNSUPPORTED_PROTOCOL_VERSION', undefined, requestId);
  }

  if (typeof parsed.type !== 'string' || parsed.type.length === 0) {
    return fail('INVALID_MESSAGE', 'حقل type مفقود.', requestId);
  }

  const type = parsed.type;
  const payload = parsed.payload;

  switch (type) {
    case 'session:authenticate': {
      if (!isRecord(payload)) return fail('INVALID_MESSAGE', undefined, requestId, type);
      const { playerId, resumeToken } = payload;
      if (
        typeof playerId !== 'string' ||
        playerId.length < 8 ||
        playerId.length > 128 ||
        typeof resumeToken !== 'string' ||
        resumeToken.length < 16 ||
        resumeToken.length > 256
      ) {
        return fail('INVALID_MESSAGE', 'بيانات المصادقة غير مكتملة.', requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'session:authenticate',
          payload: { playerId, resumeToken },
        },
      };
    }

    case 'room:leave':
    case 'room:start':
    case 'room:restart': {
      if (payload !== undefined && !isRecord(payload)) {
        return fail('INVALID_MESSAGE', undefined, requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type,
          payload: {},
        },
      };
    }

    case 'game:resync': {
      if (payload !== undefined && !isRecord(payload)) {
        return fail('INVALID_MESSAGE', undefined, requestId, type);
      }
      let lastEventId: number | undefined;
      let lastSnapshotSeq: number | undefined;
      if (isRecord(payload)) {
        if (payload.lastEventId !== undefined) {
          if (!isSafeInt(payload.lastEventId) || payload.lastEventId < 0) {
            return fail('INVALID_MESSAGE', 'قيمة lastEventId غير صالحة.', requestId, type);
          }
          lastEventId = payload.lastEventId;
        }
        if (payload.lastSnapshotSeq !== undefined) {
          if (!isSafeInt(payload.lastSnapshotSeq) || payload.lastSnapshotSeq < 0) {
            return fail('INVALID_MESSAGE', 'قيمة lastSnapshotSeq غير صالحة.', requestId, type);
          }
          lastSnapshotSeq = payload.lastSnapshotSeq;
        }
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'game:resync',
          payload: {
            ...(lastEventId !== undefined ? { lastEventId } : {}),
            ...(lastSnapshotSeq !== undefined ? { lastSnapshotSeq } : {}),
          },
        },
      };
    }

    case 'room:ready': {
      if (!isRecord(payload) || !isBoolean(payload.ready)) {
        return fail('INVALID_MESSAGE', 'قيمة الجاهزية يجب أن تكون منطقية.', requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'room:ready',
          payload: { ready: payload.ready },
        },
      };
    }

    case 'room:toggleBots': {
      if (!isRecord(payload) || !isBoolean(payload.fillBots)) {
        return fail('INVALID_MESSAGE', 'قيمة المساعدين الآليين غير صالحة.', requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'room:toggleBots',
          payload: { fillBots: payload.fillBots },
        },
      };
    }

    case 'room:cosmetic': {
      if (!isRecord(payload)) return fail('INVALID_MESSAGE', undefined, requestId, type);
      const cosmetic = validateCosmetic(payload.cosmetic);
      if (!cosmetic) {
        return fail('INVALID_MESSAGE', 'بيانات المظهر غير صالحة.', requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'room:cosmetic',
          payload: { cosmetic },
        },
      };
    }

    case 'input:state': {
      if (!isRecord(payload)) return fail('INVALID_MESSAGE', undefined, requestId, type);
      // Reject attempts to impersonate another player's slot or playerId
      if ('slot' in payload || 'playerId' in payload) {
        return fail('INVALID_MESSAGE', 'لا يمكن تحديد مقعد أو معرف لاعب آخر في الإدخال.', requestId, type);
      }
      const { moveDir, farting, seq } = payload;
      if (moveDir !== -1 && moveDir !== 0 && moveDir !== 1) {
        return fail('INVALID_MESSAGE', 'قيمة moveDir يجب أن تكون -1 أو 0 أو 1.', requestId, type);
      }
      if (!isBoolean(farting)) {
        return fail('INVALID_MESSAGE', 'قيمة farting يجب أن تكون Boolean.', requestId, type);
      }
      if (!isSafeInt(seq) || seq < 0) {
        return fail('INVALID_MESSAGE', 'قيمة seq غير صالحة.', requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'input:state',
          payload: { moveDir, farting, seq },
        },
      };
    }

    case 'ping': {
      if (payload !== undefined && !isRecord(payload)) {
        return fail('INVALID_MESSAGE', undefined, requestId, type);
      }
      const clientTime =
        isRecord(payload) && typeof payload.clientTime === 'number' && Number.isFinite(payload.clientTime)
          ? payload.clientTime
          : undefined;
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'ping',
          payload: clientTime !== undefined ? { clientTime } : {},
        },
      };
    }

    default:
      return fail('UNKNOWN_MESSAGE_TYPE', undefined, requestId, type);
  }
}
