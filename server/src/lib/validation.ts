import {
  COSMETIC_COLOR_DEFS,
  VALID_GLASSES_LIST,
  VALID_HATS_LIST,
  VALID_OUTFITS_LIST,
  VALID_RAFT_SKINS_LIST,
  VALID_TRAILS_LIST,
  normalizePlayerCosmetic,
} from '../../../src/shared/cosmetics.ts';
import type {
  GlassesStyle,
  HatStyle,
  MotionTrailId,
  OutfitStyle,
  PlayerCosmetic,
  RaftSkinId,
} from '../../../src/shared/types.ts';

const VALID_HATS = new Set<HatStyle>(VALID_HATS_LIST);
const VALID_GLASSES = new Set<GlassesStyle>(VALID_GLASSES_LIST);
const VALID_OUTFITS = new Set<OutfitStyle>(VALID_OUTFITS_LIST);
const VALID_RAFT_SKINS = new Set<RaftSkinId>(VALID_RAFT_SKINS_LIST);
const VALID_TRAILS = new Set<MotionTrailId>(VALID_TRAILS_LIST);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function sanitizePlayerName(raw: unknown, fallback = 'قبطان'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function validateCosmetic(raw: unknown, _fallbackSlot = 0): PlayerCosmetic | null {
  if (!isRecord(raw)) return null;
  const hat = raw.hat;
  const glasses = raw.glasses;
  const colorIndex = raw.colorIndex;
  const outfit = raw.outfit ?? 'classic';
  const raftSkin = raw.raftSkin ?? 'classic_oak';
  const trail = raw.trail ?? 'classic_green';
  if (
    typeof hat !== 'string' ||
    !VALID_HATS.has(hat as HatStyle) ||
    typeof glasses !== 'string' ||
    !VALID_GLASSES.has(glasses as GlassesStyle) ||
    !isSafeInt(colorIndex) ||
    colorIndex < 0 ||
    colorIndex >= COSMETIC_COLOR_DEFS.length ||
    typeof outfit !== 'string' ||
    !VALID_OUTFITS.has(outfit as OutfitStyle) ||
    typeof raftSkin !== 'string' ||
    !VALID_RAFT_SKINS.has(raftSkin as RaftSkinId) ||
    typeof trail !== 'string' ||
    !VALID_TRAILS.has(trail as MotionTrailId)
  ) {
    return null;
  }
  return {
    hat: hat as HatStyle,
    glasses: glasses as GlassesStyle,
    colorIndex,
    outfit: outfit as OutfitStyle,
    raftSkin: raftSkin as RaftSkinId,
    trail: trail as MotionTrailId,
  };
}

export function sanitizeCosmeticOrDefault(raw: unknown, fallbackSlot = 0): PlayerCosmetic {
  const valid = validateCosmetic(raw, fallbackSlot);
  if (valid) return valid;
  return normalizePlayerCosmetic(undefined, fallbackSlot);
}

export async function readBoundedJson(
  request: Request,
  maxBytes = 8192,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; code: 'PAYLOAD_TOO_LARGE' | 'INVALID_MESSAGE' }> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLen = Number(contentLength);
    if (Number.isFinite(parsedLen) && parsedLen > maxBytes) {
      return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' };
    }
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, code: 'INVALID_MESSAGE' };
  }

  const byteLen = new TextEncoder().encode(text).byteLength;
  if (byteLen > maxBytes) {
    return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' };
  }

  if (text.trim().length === 0) {
    return { ok: true, data: {} };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, code: 'INVALID_MESSAGE' };
  }
}
