import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthHttpResponse,
  FriendsHttpResponse,
  HttpErrorResponse,
  LeaderboardHttpResponse,
  ProfileSnapshotPayload,
  RecordMatchHttpResponse,
  RoomSessionCredentials,
} from '../../src/shared/protocol.ts';
import type { MatchSummaryInput } from '../../src/shared/types.ts';
import { routeWorkerRequest } from '../src/router.ts';
import { setupTestEnv } from './helpers.ts';

function makeOriginHeaders(token?: string, json = true): Record<string, string> {
  const headers: Record<string, string> = {
    origin: 'http://localhost:3000',
  };
  if (json) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

describe('PROG-01..05 Permanent Accounts, Profiles, Detailed Stats, Leaderboards & Achievements', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
  });

  it('PROG-01: guest creation, progression preservation across linking, duplicate username rejection & login security', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // 1. Create guest session
    const guestRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/guest', {
        method: 'POST',
        headers: makeOriginHeaders(),
        body: JSON.stringify({
          displayName: 'قبطان ضيف',
          cosmetic: { hat: 'captain', glasses: 'shades', colorIndex: 1 },
        }),
      }),
      env,
    );
    expect(guestRes.status).toBe(201);
    const guestAuth = (await guestRes.json()) as AuthHttpResponse;
    expect(guestAuth.profile.isGuest).toBe(true);
    expect(guestAuth.profile.displayName).toBe('قبطان ضيف');
    expect(guestAuth.token.length).toBeGreaterThan(20);

    // 2. Record a match while still a guest
    const tokRes1 = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/start-solo-run', {
        method: 'POST',
        headers: makeOriginHeaders(guestAuth.token),
        body: JSON.stringify({ courseId: 'tropical', gameMode: 'standard', difficulty: 'normal' }),
      }),
      env,
    );
    expect(tokRes1.status).toBe(201);
    const { soloRunToken: tok1 } = (await tokRes1.json()) as { soloRunToken: string };

    const match1: MatchSummaryInput = {
      submissionKey: 'solo:guest-test-1',
      courseId: 'tropical',
      gameMode: 'standard',
      difficulty: 'normal',
      outcome: 'victory',
      elapsedTimeSec: 42.5,
      falls: 0,
      itemsUsed: 4,
      pushContribution: 185,
      fartTimeSec: 18.4,
      survivalDistance: 0,
      treasureScore: 0,
      harmonyCombos: 1,
      hardGatesPassed: 3,
      minRaftHp: 90,
      isOnline: false,
      soloRunToken: tok1,
    };
    const nowSpy1 = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 50_000);
    const recRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: makeOriginHeaders(guestAuth.token),
        body: JSON.stringify(match1),
      }),
      env,
    );
    nowSpy1.mockRestore();
    expect(recRes.status).toBe(200);
    const recData = (await recRes.json()) as RecordMatchHttpResponse;
    expect(recData.alreadyRecorded).toBe(false);
    expect(recData.xpEarned).toBeGreaterThan(0);
    expect(recData.stats.wins).toBe(1);
    expect(recData.stats.itemsUsed).toBe(4);
    expect(recData.stats.totalPushContribution).toBe(185);
    expect(recData.newlyUnlocked.map((a) => a.id)).toContain('first_voyage');
    expect(recData.newlyUnlocked.map((a) => a.id)).toContain('speed_demon');
    expect(recData.newlyUnlocked.map((a) => a.id)).toContain('untouchable');

    // 3. Link guest account to permanent username & password
    const linkRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/link', {
        method: 'POST',
        headers: makeOriginHeaders(guestAuth.token),
        body: JSON.stringify({
          username: 'Captain_Tariq',
          password: 'StrongPassword99',
          displayName: 'القبطان طارق',
        }),
      }),
      env,
    );
    expect(linkRes.status).toBe(200);
    const linkedAuth = (await linkRes.json()) as AuthHttpResponse;
    expect(linkedAuth.profile.accountId).toBe(guestAuth.profile.accountId);
    expect(linkedAuth.profile.isGuest).toBe(false);
    expect(linkedAuth.profile.username).toBe('Captain_Tariq');
    expect(linkedAuth.profile.displayName).toBe('القبطان طارق');
    expect(linkedAuth.profile.xp).toBe(recData.profile.xp);
    expect(linkedAuth.stats.wins).toBe(1);
    expect(linkedAuth.achievements.length).toBe(recData.achievements.length);

    // 4. Duplicate username registration (case-insensitive) fails with 409 USERNAME_TAKEN
    const dupRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: makeOriginHeaders(),
        body: JSON.stringify({
          username: 'captain_tariq',
          password: 'AnotherPassword123',
        }),
      }),
      env,
    );
    expect(dupRes.status).toBe(409);
    const dupErr = (await dupRes.json()) as HttpErrorResponse;
    expect(dupErr.error.code).toBe('USERNAME_TAKEN');

    // 5. Wrong password fails with 401 INVALID_CREDENTIALS
    const badLoginRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: makeOriginHeaders(),
        body: JSON.stringify({
          username: 'Captain_Tariq',
          password: 'WrongPassword',
        }),
      }),
      env,
    );
    expect(badLoginRes.status).toBe(401);
    const badLoginErr = (await badLoginRes.json()) as HttpErrorResponse;
    expect(badLoginErr.error.code).toBe('INVALID_CREDENTIALS');

    // 6. Valid login restores exact account & stats
    const okLoginRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: makeOriginHeaders(),
        body: JSON.stringify({
          username: 'captain_tariq',
          password: 'StrongPassword99',
        }),
      }),
      env,
    );
    expect(okLoginRes.status).toBe(200);
    const loggedIn = (await okLoginRes.json()) as AuthHttpResponse;
    expect(loggedIn.profile.accountId).toBe(guestAuth.profile.accountId);
    expect(loggedIn.stats.bestTimeSec).toBe(42.5);

    // 7. Reject unowned cosmetic on PATCH /api/v1/profile, then allow owned cosmetic update
    const unownedPatchRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/profile', {
        method: 'PATCH',
        headers: makeOriginHeaders(loggedIn.token),
        body: JSON.stringify({
          cosmetic: { hat: 'crown', glasses: 'nerd', colorIndex: 2 },
        }),
      }),
      env,
    );
    expect(unownedPatchRes.status).toBe(403);
    const unownedErr = (await unownedPatchRes.json()) as HttpErrorResponse;
    expect(unownedErr.error.code).toBe('ITEM_NOT_OWNED');

    const patchRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/profile', {
        method: 'PATCH',
        headers: makeOriginHeaders(loggedIn.token),
        body: JSON.stringify({
          displayName: 'طارق المحترف',
          cosmetic: { hat: 'captain', glasses: 'none', colorIndex: 2 },
        }),
      }),
      env,
    );
    expect(patchRes.status).toBe(200);
    const updatedSnap = (await patchRes.json()) as ProfileSnapshotPayload;
    expect(updatedSnap.profile.displayName).toBe('طارق المحترف');
    expect(updatedSnap.profile.cosmetic.hat).toBe('captain');
    expect(updatedSnap.profile.cosmetic.colorIndex).toBe(2);

    // 8. Logout invalidates token
    const logoutRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        headers: makeOriginHeaders(loggedIn.token, false),
      }),
      env,
    );
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await routeWorkerRequest(
      new Request('http://localhost/api/v1/profile', {
        method: 'GET',
        headers: makeOriginHeaders(loggedIn.token, false),
      }),
      env,
    );
    expect(meAfterLogout.status).toBe(401);
  });

  it('PROG-03, PROG-04 & PROG-05: idempotent match submission, course bests, friends & leaderboards', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // Register two permanent players
    const p1Res = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: makeOriginHeaders(),
        body: JSON.stringify({
          username: 'alpha_racer',
          password: 'Password123',
          displayName: 'المتسابق ألفا',
        }),
      }),
      env,
    );
    expect(p1Res.status).toBe(201);
    const p1 = (await p1Res.json()) as AuthHttpResponse;

    const p2Res = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: makeOriginHeaders(),
        body: JSON.stringify({
          username: 'beta_racer',
          password: 'Password123',
          displayName: 'المتسابق بيتا',
        }),
      }),
      env,
    );
    expect(p2Res.status).toBe(201);
    const p2 = (await p2Res.json()) as AuthHttpResponse;

    const p1TokRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/start-solo-run', {
        method: 'POST',
        headers: makeOriginHeaders(p1.token),
        body: JSON.stringify({ courseId: 'volcanic', gameMode: 'standard', difficulty: 'hard' }),
      }),
      env,
    );
    expect(p1TokRes.status).toBe(201);
    const { soloRunToken: p1SoloTok } = (await p1TokRes.json()) as { soloRunToken: string };

    // P1 completes a volcanic run with 8 hard gates & fast time -> unlocks multiple achievements
    const p1Match: MatchSummaryInput = {
      submissionKey: 'solo:ROOM99:r1',
      courseId: 'volcanic',
      gameMode: 'standard',
      difficulty: 'hard',
      outcome: 'victory',
      elapsedTimeSec: 36.2,
      falls: 0,
      itemsUsed: 5,
      pushContribution: 260,
      fartTimeSec: 21.0,
      survivalDistance: 0,
      treasureScore: 0,
      harmonyCombos: 2,
      hardGatesPassed: 8,
      minRaftHp: 100,
      isOnline: false,
      soloRunToken: p1SoloTok,
    };

    const nowSpyP1 = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 50_000);
    const r1 = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: makeOriginHeaders(p1.token),
        body: JSON.stringify(p1Match),
      }),
      env,
    );
    nowSpyP1.mockRestore();
    expect(r1.status).toBe(200);
    const rec1 = (await r1.json()) as RecordMatchHttpResponse;
    expect(rec1.alreadyRecorded).toBe(false);
    expect(rec1.stats.courseBests.volcanic.bestTimeSec).toBe(36.2);
    expect(rec1.newlyUnlocked.map((a) => a.id)).toContain('hard_gate_master');

    // Replay exact same submissionKey -> idempotent, does NOT double-count!
    const replayRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: makeOriginHeaders(p1.token),
        body: JSON.stringify(p1Match),
      }),
      env,
    );
    expect(replayRes.status).toBe(200);
    const replayData = (await replayRes.json()) as RecordMatchHttpResponse;
    expect(replayData.alreadyRecorded).toBe(true);
    expect(replayData.xpEarned).toBe(rec1.xpEarned);
    expect(replayData.stats.roundsPlayed).toBe(1);
    expect(replayData.stats.wins).toBe(1);
    expect(replayData.profile.xp).toBe(rec1.profile.xp);

    // P2 finishes slower volcanic run + defeat survival run
    const p2TokRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/start-solo-run', {
        method: 'POST',
        headers: makeOriginHeaders(p2.token),
        body: JSON.stringify({ courseId: 'volcanic', gameMode: 'standard', difficulty: 'hard' }),
      }),
      env,
    );
    const { soloRunToken: p2SoloTok } = (await p2TokRes.json()) as { soloRunToken: string };
    const nowSpyP2 = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 65_000);
    await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: makeOriginHeaders(p2.token),
        body: JSON.stringify({
          ...p1Match,
          submissionKey: 'p2-volcanic-1',
          elapsedTimeSec: 54.0,
          falls: 1,
          hardGatesPassed: 2,
          soloRunToken: p2SoloTok,
        }),
      }),
      env,
    );
    nowSpyP2.mockRestore();

    // Global volcanic best_time leaderboard ranks P1 #1 ahead of P2 & pioneers
    const lbVolcanicRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/leaderboard?metric=best_time&scope=global&courseId=volcanic', {
        method: 'GET',
        headers: makeOriginHeaders(p1.token, false),
      }),
      env,
    );
    expect(lbVolcanicRes.status).toBe(200);
    const lbVolcanic = (await lbVolcanicRes.json()) as LeaderboardHttpResponse;
    expect(lbVolcanic.entries[0].accountId).toBe(p1.profile.accountId);
    expect(lbVolcanic.entries[0].bestTimeSec).toBe(36.2);
    expect(lbVolcanic.entries[0].isSelf).toBe(true);

    // Friends scope before adding friend -> only P1 (and optional partyIds)
    const lbFriendsBefore = await routeWorkerRequest(
      new Request('http://localhost/api/v1/leaderboard?metric=best_time&scope=friends&courseId=volcanic', {
        method: 'GET',
        headers: makeOriginHeaders(p1.token, false),
      }),
      env,
    );
    const friendsBeforeData = (await lbFriendsBefore.json()) as LeaderboardHttpResponse;
    expect(friendsBeforeData.entries.map((e) => e.accountId)).toEqual([p1.profile.accountId]);

    // Add beta_racer as friend -> appears in friends leaderboard
    const addFriendRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/friends', {
        method: 'POST',
        headers: makeOriginHeaders(p1.token),
        body: JSON.stringify({ username: 'beta_racer' }),
      }),
      env,
    );
    expect(addFriendRes.status).toBe(200);
    const friendsList = (await addFriendRes.json()) as FriendsHttpResponse;
    expect(friendsList.friends).toHaveLength(1);
    expect(friendsList.friends[0].accountId).toBe(p2.profile.accountId);

    const lbFriendsAfter = await routeWorkerRequest(
      new Request('http://localhost/api/v1/leaderboard?metric=best_time&scope=friends&courseId=volcanic', {
        method: 'GET',
        headers: makeOriginHeaders(p1.token, false),
      }),
      env,
    );
    const friendsAfterData = (await lbFriendsAfter.json()) as LeaderboardHttpResponse;
    expect(friendsAfterData.entries.map((e) => e.accountId)).toEqual([
      p1.profile.accountId,
      p2.profile.accountId,
    ]);

    // Remove friend cleans up
    const delFriendRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/friends/${encodeURIComponent(p2.profile.accountId)}`, {
        method: 'DELETE',
        headers: makeOriginHeaders(p1.token, false),
      }),
      env,
    );
    expect(delFriendRes.status).toBe(200);
    const delData = (await delFriendRes.json()) as FriendsHttpResponse;
    expect(delData.friends).toHaveLength(0);

    // Weekly challenge_points leaderboard has P1 with valid weekKey
    const lbWeeklyRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/leaderboard?metric=challenge_points&scope=weekly', {
        method: 'GET',
        headers: makeOriginHeaders(p1.token, false),
      }),
      env,
    );
    expect(lbWeeklyRes.status).toBe(200);
    const lbWeekly = (await lbWeeklyRes.json()) as LeaderboardHttpResponse;
    expect(lbWeekly.weekKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(lbWeekly.entries.some((e) => e.accountId === p1.profile.accountId)).toBe(true);
  });

  it('PROG-01 + RaftRoom integration: passing accountToken attaches accountId and playerLevel onto room simulation snapshot', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const regRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: makeOriginHeaders(),
        body: JSON.stringify({
          username: 'room_host_pro',
          password: 'Password123',
          displayName: 'قبطان الغرفة',
        }),
      }),
      env,
    );
    const auth = (await regRes.json()) as AuthHttpResponse;

    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: makeOriginHeaders(auth.token),
        body: JSON.stringify({
          name: auth.profile.displayName,
          courseId: 'tropical',
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const creds = (await createRes.json()) as RoomSessionCredentials;
    expect(creds.snapshot.sim.players[0].accountId).toBe(auth.profile.accountId);
    expect(creds.snapshot.sim.players[0].playerLevel).toBe(1);
    expect(creds.snapshot.roundSeq).toBe(1);
  });

  it('PROG-06..10: daily/weekly quests, coins, cosmetic shop purchase/equip, season free track & rare sudden events', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const regRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: makeOriginHeaders(),
        body: JSON.stringify({
          username: 'shop_explorer',
          password: 'Password123',
          displayName: 'مستكشف المتجر',
        }),
      }),
      env,
    );
    expect(regRes.status).toBe(201);
    const auth = (await regRes.json()) as AuthHttpResponse;
    expect(auth.profile.coins).toBe(95);
    expect(auth.quests).toHaveLength(6); // 3 daily + 3 weekly
    expect(auth.season.seasonPoints).toBe(0);
    expect(auth.rareEvent.active).toBe(false);
    expect(auth.ownedItemIds).toContain('hat:captain');
    expect(auth.ownedItemIds).not.toContain('raft_skin:bamboo_tropical');

    // Buying an item costing more than 95 coins fails with INSUFFICIENT_COINS
    const poorBuyRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/shop/buy', {
        method: 'POST',
        headers: makeOriginHeaders(auth.token),
        body: JSON.stringify({ itemId: 'raft_skin:bamboo_tropical' }), // 180 coins
      }),
      env,
    );
    expect(poorBuyRes.status).toBe(400);
    expect(((await poorBuyRes.json()) as HttpErrorResponse).error.code).toBe('INSUFFICIENT_COINS');

    // Record several rounds with high treasure, items, push & cleanCheckpoints -> earns coins, XP, quests, season & rare event pity
    let lastRec!: RecordMatchHttpResponse;
    let sawRareTrigger = false;
    for (let i = 1; i <= 7; i += 1) {
      const loopTokRes = await routeWorkerRequest(
        new Request('http://localhost/api/v1/progression/start-solo-run', {
          method: 'POST',
          headers: makeOriginHeaders(auth.token),
          body: JSON.stringify({ courseId: 'storm', gameMode: 'treasure', difficulty: 'hard' }),
        }),
        env,
      );
      const { soloRunToken: loopTok } = (await loopTokRes.json()) as { soloRunToken: string };
      const nowSpyLoop = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 65_000);
      const recRes = await routeWorkerRequest(
        new Request('http://localhost/api/v1/progression/record-match', {
          method: 'POST',
          headers: makeOriginHeaders(auth.token),
          body: JSON.stringify({
            submissionKey: `prog-6-10-round-${i}`,
            courseId: 'storm',
            gameMode: 'treasure',
            difficulty: 'hard',
            outcome: 'victory',
            elapsedTimeSec: 60,
            falls: 0,
            itemsUsed: 3,
            pushContribution: 500,
            fartTimeSec: 20,
            survivalDistance: 0,
            treasureScore: 130,
            harmonyCombos: 1,
            hardGatesPassed: 4,
            minRaftHp: 90,
            cleanCheckpoints: 3,
            collisionCount: 0,
            isOnline: false,
            soloRunToken: loopTok,
          }),
        }),
        env,
      );
      nowSpyLoop.mockRestore();
      expect(recRes.status).toBe(200);
      lastRec = (await recRes.json()) as RecordMatchHttpResponse;
      expect(lastRec.coinsEarned).toBeGreaterThan(0);
      if (lastRec.rareEventTriggered || lastRec.rareEvent.active) {
        sawRareTrigger = true;
      }
    }

    expect(sawRareTrigger).toBe(true);
    expect(lastRec.profile.coins).toBeGreaterThan(400);
    expect(lastRec.season.seasonPoints).toBeGreaterThanOrEqual(140);

    // Claim any completed daily/weekly quest
    const readyQuest = lastRec.quests.find((q) => q.progress >= q.goal && q.claimedAt === null);
    expect(readyQuest).toBeTruthy();
    const claimQuestRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/quests/${encodeURIComponent(readyQuest!.questId)}/claim`, {
        method: 'POST',
        headers: makeOriginHeaders(auth.token, false),
      }),
      env,
    );
    expect(claimQuestRes.status).toBe(200);
    const claimQuestData = (await claimQuestRes.json()) as ProfileSnapshotPayload;
    expect(claimQuestData.profile.coins).toBeGreaterThan(lastRec.profile.coins);

    // Re-claiming same quest fails with ALREADY_CLAIMED
    const dupClaimQuestRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/quests/${encodeURIComponent(readyQuest!.questId)}/claim`, {
        method: 'POST',
        headers: makeOriginHeaders(auth.token, false),
      }),
      env,
    );
    expect(dupClaimQuestRes.status).toBe(409);

    // Claim Season Tier 2 (requires 140 points -> unlocks hat:storm_hood)
    const claimTier2Res = await routeWorkerRequest(
      new Request('http://localhost/api/v1/season/tiers/2/claim', {
        method: 'POST',
        headers: makeOriginHeaders(auth.token, false),
      }),
      env,
    );
    expect(claimTier2Res.status).toBe(200);
    const tier2Data = (await claimTier2Res.json()) as ProfileSnapshotPayload;
    expect(tier2Data.ownedItemIds).toContain('hat:storm_hood');

    // Buy a Raft Skin and Motion Trail from shop and equip them
    const buyRaftRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/shop/buy', {
        method: 'POST',
        headers: makeOriginHeaders(auth.token),
        body: JSON.stringify({ itemId: 'raft_skin:bamboo_tropical', equip: true }),
      }),
      env,
    );
    expect(buyRaftRes.status).toBe(200);
    const buyRaftData = (await buyRaftRes.json()) as ProfileSnapshotPayload;
    expect(buyRaftData.ownedItemIds).toContain('raft_skin:bamboo_tropical');
    expect(buyRaftData.profile.cosmetic.raftSkin).toBe('bamboo_tropical');

    const buyTrailRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/shop/buy', {
        method: 'POST',
        headers: makeOriginHeaders(auth.token),
        body: JSON.stringify({ itemId: 'trail:rainbow_bubbles', equip: true }),
      }),
      env,
    );
    expect(buyTrailRes.status).toBe(200);
    const buyTrailData = (await buyTrailRes.json()) as ProfileSnapshotPayload;
    expect(buyTrailData.profile.cosmetic.trail).toBe('rainbow_bubbles');

    // Verify GET /api/v1/profile persists all owned items, coins & equipped raft/trail/seasonal hat
    const equipSeasonHatRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/shop/equip', {
        method: 'POST',
        headers: makeOriginHeaders(auth.token),
        body: JSON.stringify({
          cosmetic: {
            ...buyTrailData.profile.cosmetic,
            hat: 'storm_hood',
          },
        }),
      }),
      env,
    );
    expect(equipSeasonHatRes.status).toBe(200);
    const finalSnap = (await equipSeasonHatRes.json()) as ProfileSnapshotPayload;
    expect(finalSnap.profile.cosmetic.hat).toBe('storm_hood');
    expect(finalSnap.profile.cosmetic.raftSkin).toBe('bamboo_tropical');
    expect(finalSnap.profile.cosmetic.trail).toBe('rainbow_bubbles');
  });
});
