import type { GlassesStyle, HatStyle, PlayerCosmetic } from '../../../src/shared/types.ts';

const VALID_HATS = new Set<HatStyle>(['none', 'captain', 'crown', 'propeller']);
const VALID_GLASSES = new Set<GlassesStyle>(['none', 'shades', 'nerd']);

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

export function validateCosmetic(raw: unknown, fallbackSlot = 0): PlayerCosmetic | null {
  if (!isRecord(raw)) return null;
  const hat = raw.hat;
  const glasses = raw.glasses;
  const colorIndex = raw.colorIndex;
  if (
    typeof hat !== 'string' ||
    !VALID_HATS.has(hat as HatStyle) ||
    typeof glasses !== 'string' ||
    !VALID_GLASSES.has(glasses as GlassesStyle) ||
    !isSafeInt(colorIndex) ||
    colorIndex < 0 ||
    colorIndex > 3
  ) {
    return null;
  }
  return {
    hat: hat as HatStyle,
    glasses: glasses as GlassesStyle,
    colorIndex,
  };
}

export function sanitizeCosmeticOrDefault(raw: unknown, fallbackSlot = 0): PlayerCosmetic {
  const valid = validateCosmetic(raw, fallbackSlot);
  if (valid) return valid;
  const hats: HatStyle[] = ['captain', 'propeller', 'none', 'crown'];
  const glasses: GlassesStyle[] = ['none', 'nerd', 'shades', 'none'];
  return {
    hat: hats[fallbackSlot % hats.length],
    glasses: glasses[fallbackSlot % glasses.length],
    colorIndex: fallbackSlot % 4,
  };
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
