import { isValidBotDifficulty, isValidBotPersonality } from '../../../src/shared/bots.ts';
import { isValidCourseId } from '../../../src/shared/course.ts';
import { isValidDifficulty, isValidGameMode } from '../../../src/shared/physics.ts';
import {
  MAX_WS_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type ClientProtocolMessage,
  type NextRoundAction,
  type ProtocolErrorCode,
} from '../../../src/shared/protocol.ts';
import {
  getQuickChatPreset,
  isValidEmoteId,
  sanitizeChatText,
  sanitizePlaylist,
} from '../../../src/shared/social.ts';
import type { BotPersonalitiesMap, CourseSelectionMode, RoomSettings } from '../../../src/shared/types.ts';
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
      const protocolVersion =
        typeof payload.protocolVersion === 'number' && Number.isFinite(payload.protocolVersion)
          ? payload.protocolVersion
          : undefined;
      const clientVersion =
        typeof payload.clientVersion === 'string' && payload.clientVersion.length <= 32
          ? payload.clientVersion
          : undefined;
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'session:authenticate',
          payload: {
            playerId,
            resumeToken,
            ...(protocolVersion !== undefined ? { protocolVersion } : {}),
            ...(clientVersion !== undefined ? { clientVersion } : {}),
          },
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

    case 'room:selectCourse': {
      if (!isRecord(payload) || !isValidCourseId(payload.courseId)) {
        return fail('INVALID_MESSAGE', 'المسار المختار غير صالح.', requestId, type);
      }
      let courseSelectionMode: CourseSelectionMode | undefined;
      if (payload.courseSelectionMode !== undefined) {
        if (payload.courseSelectionMode !== 'host' && payload.courseSelectionMode !== 'vote') {
          return fail('INVALID_MESSAGE', 'نمط اختيار المسار غير صالح.', requestId, type);
        }
        courseSelectionMode = payload.courseSelectionMode;
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'room:selectCourse',
          payload: {
            courseId: payload.courseId,
            ...(courseSelectionMode !== undefined ? { courseSelectionMode } : {}),
          },
        },
      };
    }

    case 'room:voteCourse': {
      if (!isRecord(payload) || !isValidCourseId(payload.courseId)) {
        return fail('INVALID_MESSAGE', 'التصويت يجب أن يشير إلى مسار صالح.', requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'room:voteCourse',
          payload: { courseId: payload.courseId },
        },
      };
    }

    case 'room:updateSettings': {
      if (!isRecord(payload) || !isRecord(payload.settings)) {
        return fail('INVALID_MESSAGE', 'إعدادات الغرفة غير صالحة.', requestId, type);
      }
      const rawSettings = payload.settings;
      const settings: Partial<RoomSettings> = {};
      if (rawSettings.gameMode !== undefined) {
        if (!isValidGameMode(rawSettings.gameMode)) {
          return fail('INVALID_MESSAGE', 'نمط اللعب المختار غير صالح.', requestId, type);
        }
        settings.gameMode = rawSettings.gameMode;
      }
      if (rawSettings.difficulty !== undefined) {
        if (!isValidDifficulty(rawSettings.difficulty)) {
          return fail('INVALID_MESSAGE', 'مستوى الصعوبة المختار غير صالح.', requestId, type);
        }
        settings.difficulty = rawSettings.difficulty;
      }
      if (rawSettings.enableItems !== undefined) {
        if (!isBoolean(rawSettings.enableItems)) {
          return fail('INVALID_MESSAGE', 'قيمة تفعيل العناصر غير صالحة.', requestId, type);
        }
        settings.enableItems = rawSettings.enableItems;
      }
      if (rawSettings.roundTimeLimitSec !== undefined) {
        if (!isSafeInt(rawSettings.roundTimeLimitSec) || rawSettings.roundTimeLimitSec < 0 || rawSettings.roundTimeLimitSec > 600) {
          return fail('INVALID_MESSAGE', 'مهلة الجولة يجب أن تكون بين 0 و600 ثانية.', requestId, type);
        }
        settings.roundTimeLimitSec = rawSettings.roundTimeLimitSec;
      }
      if (rawSettings.maxPlayers !== undefined) {
        if (rawSettings.maxPlayers !== 2 && rawSettings.maxPlayers !== 3 && rawSettings.maxPlayers !== 4) {
          return fail('INVALID_MESSAGE', 'الحد الأقصى للاعبين يجب أن يكون 2 أو 3 أو 4.', requestId, type);
        }
        settings.maxPlayers = rawSettings.maxPlayers;
      }
      if (rawSettings.botDifficulty !== undefined) {
        if (!isValidBotDifficulty(rawSettings.botDifficulty)) {
          return fail('INVALID_MESSAGE', 'مستوى ذكاء المساعدين المختار غير صالح.', requestId, type);
        }
        settings.botDifficulty = rawSettings.botDifficulty;
      }
      if (rawSettings.botPersonalities !== undefined) {
        if (!isRecord(rawSettings.botPersonalities)) {
          return fail('INVALID_MESSAGE', 'شخصيات المساعدين غير صالحة.', requestId, type);
        }
        const map: BotPersonalitiesMap = {};
        for (const slotKey of ['0', '1', '2', '3'] as const) {
          const val = rawSettings.botPersonalities[slotKey];
          if (val !== undefined) {
            if (!isValidBotPersonality(val)) {
              return fail('INVALID_MESSAGE', 'شخصية المساعد المختارة غير صالحة.', requestId, type);
            }
            map[Number(slotKey) as 0 | 1 | 2 | 3] = val;
          }
        }
        settings.botPersonalities = map;
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'room:updateSettings',
          payload: { settings },
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

    case 'room:setPlaylist': {
      if (!isRecord(payload) || !Array.isArray(payload.playlist)) {
        return fail('INVALID_MESSAGE', 'قائمة التشغيل غير صالحة.', requestId, type);
      }
      const playlist = sanitizePlaylist(payload.playlist);
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'room:setPlaylist',
          payload: { playlist },
        },
      };
    }

    case 'room:nextRound': {
      if (!isRecord(payload)) return fail('INVALID_MESSAGE', undefined, requestId, type);
      const action = payload.action;
      if (action !== 'replay' && action !== 'next' && action !== 'lobby' && action !== 'course') {
        return fail('INVALID_MESSAGE', 'إجراء الجولة التالية غير صالح.', requestId, type);
      }
      let courseId = undefined;
      if (payload.courseId !== undefined) {
        if (!isValidCourseId(payload.courseId)) {
          return fail('INVALID_MESSAGE', 'المسار المختار للجولة التالية غير صالح.', requestId, type);
        }
        courseId = payload.courseId;
      }
      if (action === 'course' && !courseId) {
        return fail('INVALID_MESSAGE', 'يجب تحديد المسار عند اختيار الانتقال لمسار محدد.', requestId, type);
      }
      let settings: Partial<RoomSettings> | undefined;
      if (payload.settings !== undefined) {
        if (!isRecord(payload.settings)) {
          return fail('INVALID_MESSAGE', 'إعدادات الجولة التالية غير صالحة.', requestId, type);
        }
        settings = {};
        if (payload.settings.gameMode !== undefined) {
          if (!isValidGameMode(payload.settings.gameMode)) {
            return fail('INVALID_MESSAGE', 'نمط اللعب غير صالح.', requestId, type);
          }
          settings.gameMode = payload.settings.gameMode;
        }
        if (payload.settings.difficulty !== undefined) {
          if (!isValidDifficulty(payload.settings.difficulty)) {
            return fail('INVALID_MESSAGE', 'مستوى الصعوبة غير صالح.', requestId, type);
          }
          settings.difficulty = payload.settings.difficulty;
        }
        if (payload.settings.enableItems !== undefined) {
          if (!isBoolean(payload.settings.enableItems)) {
            return fail('INVALID_MESSAGE', 'قيمة العناصر غير صالحة.', requestId, type);
          }
          settings.enableItems = payload.settings.enableItems;
        }
      }
      let immediate: boolean | undefined;
      if (payload.immediate !== undefined) {
        if (!isBoolean(payload.immediate)) {
          return fail('INVALID_MESSAGE', 'قيمة البدء الفوري غير صالحة.', requestId, type);
        }
        immediate = payload.immediate;
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'room:nextRound',
          payload: {
            action: action as NextRoundAction,
            ...(courseId !== undefined ? { courseId } : {}),
            ...(settings !== undefined ? { settings } : {}),
            ...(immediate !== undefined ? { immediate } : {}),
          },
        },
      };
    }

    case 'chat:send': {
      if (!isRecord(payload)) return fail('INVALID_MESSAGE', undefined, requestId, type);
      if (payload.presetId !== undefined) {
        const preset = getQuickChatPreset(payload.presetId);
        if (!preset) {
          return fail('INVALID_MESSAGE', 'عبارة الدردشة السريعة غير صالحة.', requestId, type);
        }
        return {
          ok: true,
          message: {
            version: PROTOCOL_VERSION,
            ...(requestId ? { requestId } : {}),
            type: 'chat:send',
            payload: { presetId: preset.id, text: preset.text },
          },
        };
      }
      const cleaned = sanitizeChatText(payload.text);
      if (!cleaned) {
        return fail('INVALID_MESSAGE', 'نص الرسالة فارغ أو غير صالح.', requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'chat:send',
          payload: { text: cleaned },
        },
      };
    }

    case 'emote:trigger': {
      if (!isRecord(payload) || !isValidEmoteId(payload.emoteId)) {
        return fail('INVALID_MESSAGE', 'الحركة التعبيرية المطلوبة غير صالحة.', requestId, type);
      }
      return {
        ok: true,
        message: {
          version: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: 'emote:trigger',
          payload: { emoteId: payload.emoteId },
        },
      };
    }

    case 'input:state': {
      if (!isRecord(payload)) return fail('INVALID_MESSAGE', undefined, requestId, type);
      // Reject attempts to impersonate another player's slot or playerId
      if ('slot' in payload || 'playerId' in payload) {
        return fail('INVALID_MESSAGE', 'لا يمكن تحديد مقعد أو معرف لاعب آخر في الإدخال.', requestId, type);
      }
      const { moveDir, farting, anchor, useItem, seq } = payload;
      if (moveDir !== -1 && moveDir !== 0 && moveDir !== 1) {
        return fail('INVALID_MESSAGE', 'قيمة moveDir يجب أن تكون -1 أو 0 أو 1.', requestId, type);
      }
      if (!isBoolean(farting)) {
        return fail('INVALID_MESSAGE', 'قيمة farting يجب أن تكون Boolean.', requestId, type);
      }
      if (anchor !== undefined && !isBoolean(anchor)) {
        return fail('INVALID_MESSAGE', 'قيمة anchor يجب أن تكون Boolean.', requestId, type);
      }
      if (useItem !== undefined && !isBoolean(useItem)) {
        return fail('INVALID_MESSAGE', 'قيمة useItem يجب أن تكون Boolean.', requestId, type);
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
          payload: {
            moveDir,
            farting,
            ...(anchor !== undefined ? { anchor } : {}),
            ...(useItem !== undefined ? { useItem } : {}),
            seq,
          },
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
