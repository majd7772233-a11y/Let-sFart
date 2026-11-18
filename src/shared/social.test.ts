import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMOTE_DEFINITIONS,
  MAX_CHAT_LENGTH,
  MAX_PLAYLIST_ITEMS,
  QUICK_CHAT_PRESETS,
  getEmoteDefinition,
  getQuickChatPreset,
  isValidEmoteId,
  popNextPlaylistItem,
  sanitizeChatText,
  sanitizePlaylist,
} from './social.ts';

test('sanitizeChatText strips control chars, collapses whitespace, and caps length safely', () => {
  assert.equal(sanitizeChatText(''), '');
  assert.equal(sanitizeChatText('   \n\t\u0007  '), '');
  assert.equal(sanitizeChatText('  هيا   بنا\u200B  لليمين! \r\n '), 'هيا بنا لليمين!');

  const longMsg = 'أ'.repeat(MAX_CHAT_LENGTH + 25);
  const cleaned = sanitizeChatText(longMsg);
  assert.equal(Array.from(cleaned).length, MAX_CHAT_LENGTH);
});

test('quick chat presets and emote registry lookup work reliably', () => {
  assert.ok(QUICK_CHAT_PRESETS.length >= 6);
  const preset = getQuickChatPreset('team_push');
  assert.ok(preset !== null);
  assert.equal(preset.text, 'دفعة جماعية!');
  assert.equal(getQuickChatPreset('unknown_preset'), null);

  assert.equal(EMOTE_DEFINITIONS.length, 6);
  assert.equal(isValidEmoteId('laugh'), true);
  assert.equal(isValidEmoteId('point_right'), true);
  assert.equal(isValidEmoteId('invalid_emote'), false);
  assert.equal(getEmoteDefinition('celebrate').icon, '🥳');
});

test('sanitizePlaylist filters invalid entries, bounds length, and popNextPlaylistItem pops FIFO', () => {
  const input = Array.from({ length: MAX_PLAYLIST_ITEMS + 3 }, (_, idx) => ({
    id: `item-${idx + 1}`,
    courseId: idx % 2 === 0 ? 'volcanic' : 'invalid-course',
    gameMode: idx === 0 ? 'treasure' : 'bad-mode',
    difficulty: idx === 0 ? 'hard' : 'impossible',
  }));

  const cleaned = sanitizePlaylist(['not-an-object', ...input]);
  assert.equal(cleaned.length, MAX_PLAYLIST_ITEMS);
  assert.equal(cleaned[0].courseId, 'volcanic');
  assert.equal(cleaned[0].gameMode, 'treasure');
  assert.equal(cleaned[0].difficulty, 'hard');
  assert.equal(cleaned[1].courseId, 'tropical');
  assert.equal(cleaned[1].gameMode, 'standard');
  assert.equal(cleaned[1].difficulty, 'normal');

  const popped = popNextPlaylistItem(cleaned);
  assert.equal(popped.next?.id, 'item-1');
  assert.equal(popped.remaining.length, MAX_PLAYLIST_ITEMS - 1);
  assert.equal(popped.remaining[0].id, 'item-2');

  const empty = popNextPlaylistItem([]);
  assert.equal(empty.next, null);
  assert.equal(empty.remaining.length, 0);
});
