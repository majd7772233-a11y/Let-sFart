import { useCallback, useEffect, useRef, useState } from 'react';
import { SoundEngine } from './audio/soundEngine.ts';
import { AccountAuthModal, type AccountAuthMode } from './components/AccountAuthModal.tsx';
import { GameHud } from './components/GameHud.tsx';
import { LeaderboardModal } from './components/LeaderboardModal.tsx';
import { LobbyModal, type LobbyTab } from './components/LobbyModal.tsx';
import { OpsDashboardModal } from './components/OpsDashboardModal.tsx';
import { PauseSettingsModal } from './components/PauseSettingsModal.tsx';
import { ProfileModal } from './components/ProfileModal.tsx';
import { QuestsSeasonModal } from './components/QuestsSeasonModal.tsx';
import { ReplayModal } from './components/ReplayModal.tsx';
import { ShopModal } from './components/ShopModal.tsx';
import { TitleScreen } from './components/TitleScreen.tsx';
import { TouchLayoutEditorModal } from './components/TouchLayoutEditorModal.tsx';
import { VictoryModal } from './components/VictoryModal.tsx';
import { RaftSceneManager, type HudSnapshot } from './game/RaftSceneManager.ts';
import { MultiplayerClient } from './net/multiplayerClient.ts';
import { PartyClient } from './net/partyClient.ts';
import {
  addFriendByUsername,
  buyCosmeticItem,
  claimQuestReward,
  claimSeasonTierReward,
  createGuestSession,
  ensureActiveAccountSession,
  equipCosmeticLook,
  extractProfileSnapshot,
  getStoredAccountToken,
  linkGuestToPermanentAccount,
  loginPermanentAccount,
  logoutAccount,
  recordAccountMatch,
  registerPermanentAccount,
  removeFriendById,
  saveRoundReplay,
  updateMyProfile,
} from './net/progressionClient.ts';
import { getCourseById, isValidCourseId } from './shared/course.ts';
import { isValidBotDifficulty } from './shared/bots.ts';
import {
  DEFAULT_ROOM_SETTINGS,
  createDefaultCosmetic,
  createInitialSimState,
  isValidDifficulty,
  isValidGameMode,
} from './shared/physics.ts';
import { buildMatchSummaryFromSim } from './shared/progression.ts';
import {
  DEFAULT_CAMERA_PREFS,
  DEFAULT_TOUCH_CONTROLS_CONFIG,
  createInitialTutorialProgress,
  normalizeCameraPrefs,
  normalizeTouchControlsConfig,
} from './shared/ux.ts';
import type {
  NextRoundAction,
  ProfileSnapshotPayload,
  PublicRoomListingItem,
  RecordMatchHttpResponse,
  RoomPublicInfoResponse,
  SeatSlotOrSpectator,
} from './shared/protocol.ts';
import type {
  BotDifficulty,
  CameraPrefs,
  ChatMessage,
  ConnectionStatus,
  CourseId,
  CourseSelectionMode,
  EmoteId,
  GameDifficulty,
  GameMode,
  GameScreenState,
  PartyState,
  PlayerCosmetic,
  PlaylistItem,
  RoomSettings,
  RoomSnapshot,
  RoundReplayRecord,
  TouchControlsConfig,
  WorldSimulationState,
} from './shared/types.ts';

function getInitialCourseId(): CourseId {
  if (typeof window === 'undefined') return 'tropical';
  const param = new URLSearchParams(window.location.search).get('course');
  return isValidCourseId(param) ? param : 'tropical';
}

function getInitialGameMode(): GameMode {
  if (typeof window === 'undefined') return 'standard';
  const param = new URLSearchParams(window.location.search).get('mode');
  return isValidGameMode(param) ? param : 'standard';
}

function getInitialDifficulty(): GameDifficulty {
  if (typeof window === 'undefined') return 'normal';
  const param = new URLSearchParams(window.location.search).get('difficulty');
  return isValidDifficulty(param) ? param : 'normal';
}

function getInitialBotDifficulty(): BotDifficulty {
  if (typeof window === 'undefined') return 'normal';
  const param = new URLSearchParams(window.location.search).get('botDifficulty');
  return isValidBotDifficulty(param) ? param : 'normal';
}

function getInitialInviteRoomCode(): string {
  if (typeof window === 'undefined') return '';
  const param = (new URLSearchParams(window.location.search).get('room') ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{6,10}$/.test(param) ? param : '';
}

function appendUniqueChat(prev: ChatMessage[], incoming: ChatMessage, cap = 50): ChatMessage[] {
  if (prev.some((m) => m.id === incoming.id)) return prev;
  const next = [...prev, incoming];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

const CAMERA_PREFS_KEY = 'letsfart_camera_prefs_v1';
const TOUCH_LAYOUT_KEY = 'letsfart_touch_layout_v1';
const AUDIO_PREFS_KEY = 'letsfart_audio_prefs_v1';

interface StoredAudioPrefs {
  sfxVolume: number;
  voiceVolume: number;
  musicVolume: number;
  sfxMuted: boolean;
  voiceMuted: boolean;
  musicMuted: boolean;
}

function loadCameraPrefs(): CameraPrefs {
  if (typeof window === 'undefined') return DEFAULT_CAMERA_PREFS;
  try {
    const raw = window.localStorage.getItem(CAMERA_PREFS_KEY);
    if (!raw) return DEFAULT_CAMERA_PREFS;
    return normalizeCameraPrefs(JSON.parse(raw) as Partial<CameraPrefs>);
  } catch {
    return DEFAULT_CAMERA_PREFS;
  }
}

function saveCameraPrefs(prefs: CameraPrefs): void {
  try {
    window.localStorage.setItem(CAMERA_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

function loadTouchControlsConfig(): TouchControlsConfig {
  if (typeof window === 'undefined') return DEFAULT_TOUCH_CONTROLS_CONFIG;
  try {
    const raw = window.localStorage.getItem(TOUCH_LAYOUT_KEY);
    if (!raw) return DEFAULT_TOUCH_CONTROLS_CONFIG;
    return normalizeTouchControlsConfig(JSON.parse(raw) as Partial<TouchControlsConfig>);
  } catch {
    return DEFAULT_TOUCH_CONTROLS_CONFIG;
  }
}

function saveTouchControlsConfig(config: TouchControlsConfig): void {
  try {
    window.localStorage.setItem(TOUCH_LAYOUT_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

function loadAudioPrefs(): StoredAudioPrefs {
  const defaults: StoredAudioPrefs = {
    sfxVolume: 0.8,
    voiceVolume: 0.85,
    musicVolume: 0.35,
    sfxMuted: false,
    voiceMuted: false,
    musicMuted: false,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFS_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<StoredAudioPrefs>;
    return {
      sfxVolume: typeof p.sfxVolume === 'number' ? Math.max(0, Math.min(1, p.sfxVolume)) : defaults.sfxVolume,
      voiceVolume:
        typeof p.voiceVolume === 'number' ? Math.max(0, Math.min(1, p.voiceVolume)) : defaults.voiceVolume,
      musicVolume:
        typeof p.musicVolume === 'number' ? Math.max(0, Math.min(1, p.musicVolume)) : defaults.musicVolume,
      sfxMuted: Boolean(p.sfxMuted),
      voiceMuted: Boolean(p.voiceMuted),
      musicMuted: Boolean(p.musicMuted),
    };
  } catch {
    return defaults;
  }
}

function saveAudioPrefs(prefs: StoredAudioPrefs): void {
  try {
    window.localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<RaftSceneManager | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const netRef = useRef<MultiplayerClient | null>(null);
  const partyClientRef = useRef<PartyClient | null>(null);

  const powerFillRef = useRef<HTMLDivElement | null>(null);
  const powerLabelRef = useRef<HTMLSpanElement | null>(null);

  const [screen, setScreen] = useState<GameScreenState>('title');
  const [settingsOpenOnTitle, setSettingsOpenOnTitle] = useState(false);

  const [playerName, setPlayerName] = useState('قبطان فرفوش');
  const [cosmetic, setCosmetic] = useState<PlayerCosmetic>(() => createDefaultCosmetic(0));

  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [mySlot, setMySlot] = useState<SeatSlotOrSpectator>(0);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const lobbyBusyRef = useRef(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [roomChatMessages, setRoomChatMessages] = useState<ChatMessage[]>([]);
  const lastRoomPasswordRef = useRef<string | undefined>(undefined);

  // Public rooms, spectatable rooms, quick match & invite preview state
  const [initialInviteCode] = useState<string>(() => getInitialInviteRoomCode());
  const [lobbyInitialTab, setLobbyInitialTab] = useState<LobbyTab>(() =>
    getInitialInviteRoomCode() ? 'join' : 'public',
  );
  const [publicRooms, setPublicRooms] = useState<PublicRoomListingItem[]>([]);
  const [spectatableRooms, setSpectatableRooms] = useState<PublicRoomListingItem[]>([]);
  const [publicRoomsLoading, setPublicRoomsLoading] = useState(false);
  const [publicRoomsError, setPublicRoomsError] = useState<string | null>(null);
  const [roomPreview, setRoomPreview] = useState<RoomPublicInfoResponse | null>(null);
  const [roomPreviewLoading, setRoomPreviewLoading] = useState(false);

  // Persistent Party state (ONLINE-09)
  const [partyState, setPartyState] = useState<PartyState | null>(null);
  const [partyMemberId, setPartyMemberId] = useState<string | null>(null);
  const [partyStatus, setPartyStatus] = useState<ConnectionStatus>('disconnected');
  const [partyError, setPartyError] = useState<string | null>(null);
  const [partyBusy, setPartyBusy] = useState(false);
  const [partyMessages, setPartyMessages] = useState<ChatMessage[]>([]);

  // PROG-01..10: Account, Progression, Shop, Quests, Season & Auth Modals
  const [profileSnapshot, setProfileSnapshot] = useState<ProfileSnapshotPayload | null>(null);
  const [progressionBusy, setProgressionBusy] = useState(false);
  const [progressionError, setProgressionError] = useState<string | null>(null);
  const [lastMatchReward, setLastMatchReward] = useState<RecordMatchHttpResponse | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [leaderboardModalOpen, setLeaderboardModalOpen] = useState(false);
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [questsModalOpen, setQuestsModalOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const [replayTargetMatchId, setReplayTargetMatchId] = useState<string | null>(null);
  const [lastSoloReplay, setLastSoloReplay] = useState<RoundReplayRecord | null>(null);
  const [opsModalOpen, setOpsModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AccountAuthMode | null>(null);
  const profileSnapshotRef = useRef<ProfileSnapshotPayload | null>(null);
  profileSnapshotRef.current = profileSnapshot;
  const submittedMatchKeysRef = useRef<Set<string>>(new Set());

  const [initialAudioPrefs] = useState<StoredAudioPrefs>(() => loadAudioPrefs());
  const [sfxVolume, setSfxVolume] = useState(initialAudioPrefs.sfxVolume);
  const [voiceVolume, setVoiceVolume] = useState(initialAudioPrefs.voiceVolume);
  const [musicVolume, setMusicVolume] = useState(initialAudioPrefs.musicVolume);
  const [sfxMuted, setSfxMuted] = useState(initialAudioPrefs.sfxMuted);
  const [voiceMuted, setVoiceMuted] = useState(initialAudioPrefs.voiceMuted);
  const [musicMuted, setMusicMuted] = useState(initialAudioPrefs.musicMuted);
  const [reduceShake, setReduceShake] = useState(false);
  const [showTouchControls, setShowTouchControls] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth <= 900;
  });
  const [cameraPrefs, setCameraPrefs] = useState<CameraPrefs>(() => loadCameraPrefs());
  const cameraPrefsRef = useRef<CameraPrefs>(cameraPrefs);
  cameraPrefsRef.current = cameraPrefs;
  const [touchConfig, setTouchConfig] = useState<TouchControlsConfig>(() => loadTouchControlsConfig());
  const [touchEditorOpen, setTouchEditorOpen] = useState(false);

  const [selectedCourseId, setSelectedCourseId] = useState<CourseId>(() => getInitialCourseId());
  const selectedCourseRef = useRef<CourseId>(selectedCourseId);
  selectedCourseRef.current = selectedCourseId;

  const [selectedGameMode, setSelectedGameMode] = useState<GameMode>(() => getInitialGameMode());
  const selectedGameModeRef = useRef<GameMode>(selectedGameMode);
  selectedGameModeRef.current = selectedGameMode;

  const [selectedDifficulty, setSelectedDifficulty] = useState<GameDifficulty>(() => getInitialDifficulty());
  const selectedDifficultyRef = useRef<GameDifficulty>(selectedDifficulty);
  selectedDifficultyRef.current = selectedDifficulty;

  const [selectedBotDifficulty, setSelectedBotDifficulty] = useState<BotDifficulty>(() =>
    getInitialBotDifficulty(),
  );
  const selectedBotDifficultyRef = useRef<BotDifficulty>(selectedBotDifficulty);
  selectedBotDifficultyRef.current = selectedBotDifficulty;

  const [createSettings, setCreateSettings] = useState<RoomSettings>(() => ({
    ...DEFAULT_ROOM_SETTINGS,
    gameMode: getInitialGameMode(),
    difficulty: getInitialDifficulty(),
    botDifficulty: getInitialBotDifficulty(),
  }));

  const [hud, setHud] = useState<HudSnapshot>(() => {
    const initialCourse = getInitialCourseId();
    const initialMode = getInitialGameMode();
    const initialDiff = getInitialDifficulty();
    const courseDef = getCourseById(initialCourse);
    return {
      screen: 'title',
      mode: 'solo',
      courseId: initialCourse,
      activeHazardTag: null,
      elapsedTime: 0,
      falls: 0,
      checkpointIndex: 0,
      totalCheckpoints: Math.max(1, courseDef.checkpoints.length - 1),
      progress: 0,
      connectedPlayers: 4,
      mySlot: 0,
      isSpectator: false,
      spectatorTarget: 'raft',
      toastText: null,
      bestTimeTrialSec: null,
      ghostDeltaSec: null,
      bestSurvivalDistance: null,
      soloSessionKind: 'normal',
      tutorialProgress: createInitialTutorialProgress(false),
      practiceBotsEnabled: true,
      cameraMode: cameraPrefs.mode,
      sim: createInitialSimState('solo', 'قبطان فرفوش', createDefaultCosmetic(0), initialCourse, {
        gameMode: initialMode,
        difficulty: initialDiff,
      }),
    };
  });
  const hudRef = useRef<HudSnapshot>(hud);
  hudRef.current = hud;

  const screenRef = useRef<GameScreenState>(screen);
  screenRef.current = screen;
  const mySlotRef = useRef<SeatSlotOrSpectator>(mySlot);
  mySlotRef.current = mySlot;
  const roomSnapshotRef = useRef<RoomSnapshot | null>(roomSnapshot);
  roomSnapshotRef.current = roomSnapshot;
  const playerNameRef = useRef(playerName);
  playerNameRef.current = playerName;
  const cosmeticRef = useRef(cosmetic);
  cosmeticRef.current = cosmetic;
  const partyStateRef = useRef<PartyState | null>(partyState);
  partyStateRef.current = partyState;
  const partyMemberIdRef = useRef<string | null>(partyMemberId);
  partyMemberIdRef.current = partyMemberId;

  const refreshPublicRooms = useCallback(() => {
    if (!netRef.current) return;
    setPublicRoomsLoading(true);
    setPublicRoomsError(null);
    netRef.current
      .fetchPublicRooms()
      .then((res) => {
        setPublicRooms(res.rooms);
        setSpectatableRooms(res.spectatableRooms ?? []);
      })
      .catch((err) => {
        setPublicRoomsError(err.message || 'تعذر جلب قائمة الغرف العامة');
      })
      .finally(() => {
        setPublicRoomsLoading(false);
      });
  }, []);

  const fetchRoomPreview = useCallback((code: string) => {
    if (!netRef.current) return;
    setRoomPreviewLoading(true);
    setLobbyError(null);
    netRef.current
      .fetchRoomInfo(code)
      .then((info) => {
        setRoomPreview(info);
      })
      .catch((err) => {
        setRoomPreview(null);
        setLobbyError(err.message || 'تعذر العثور على الغرفة');
      })
      .finally(() => {
        setRoomPreviewLoading(false);
      });
  }, []);

  const handleSelectCourse = useCallback((courseId: CourseId, mode?: CourseSelectionMode) => {
    const valid = isValidCourseId(courseId) ? courseId : 'tropical';
    setSelectedCourseId(valid);
    sceneRef.current?.setPreviewCourse(valid);
    if (roomSnapshotRef.current) {
      netRef.current?.selectCourse(valid, mode);
    }
  }, []);

  const handleVoteCourse = useCallback((courseId: CourseId) => {
    const valid = isValidCourseId(courseId) ? courseId : 'tropical';
    if (roomSnapshotRef.current) {
      netRef.current?.voteCourse(valid);
    }
  }, []);

  const applyAuthSnapshot = useCallback(
    (snap: ProfileSnapshotPayload, token?: string | null) => {
      setProfileSnapshot(snap);
      setPlayerName(snap.profile.displayName);
      setCosmetic(snap.profile.cosmetic);
      sceneRef.current?.syncLocalCosmetic(snap.profile.cosmetic);
      if (token !== undefined) {
        netRef.current?.setAccountToken(token);
      }
    },
    [],
  );

  const ensureAccountReady = useCallback(async (): Promise<ProfileSnapshotPayload | null> => {
    if (profileSnapshotRef.current) return profileSnapshotRef.current;
    try {
      const { token, snapshot } = await ensureActiveAccountSession({
        displayName: playerNameRef.current,
        cosmetic: cosmeticRef.current,
      });
      applyAuthSnapshot(snapshot, token);
      return snapshot;
    } catch {
      return null;
    }
  }, [applyAuthSnapshot]);

  const submitMatchProgression = useCallback(
    async (simSnapshot: WorldSimulationState, slot: 0 | 1 | 2 | 3, submissionKey: string) => {
      if (submittedMatchKeysRef.current.has(submissionKey)) return;
      submittedMatchKeysRef.current.add(submissionKey);
      try {
        await ensureAccountReady();
        const summary = buildMatchSummaryFromSim(simSnapshot, slot, submissionKey);
        const reward = await recordAccountMatch(summary);
        setLastMatchReward(reward);
        setProfileSnapshot(extractProfileSnapshot(reward));
        if (reward.rareEventTriggered && reward.rareEvent.titleAr) {
          sceneRef.current?.showToast(`⚡ حدث نادر مفاجئ: ${reward.rareEvent.titleAr}!`, 3.2);
        } else if (reward.newlyUnlocked.length > 0) {
          sceneRef.current?.showToast(`🏆 إنجاز جديد: ${reward.newlyUnlocked[0].titleAr}!`, 2.8);
        } else if (reward.completedQuests.length > 0) {
          sceneRef.current?.showToast(`✅ اكتملت مهمة: ${reward.completedQuests[0].titleAr}!`, 2.6);
        }
      } catch {
        submittedMatchKeysRef.current.delete(submissionKey);
      }
    },
    [ensureAccountReady],
  );

  const handleStartSolo = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    setSettingsOpenOnTitle(false);
    setRoomSnapshot(null);
    setRoomChatMessages([]);
    setLastMatchReward(null);
    setLastSoloReplay(null);
    setScreen('playing');
    const prof = profileSnapshotRef.current?.profile;
    sceneRef.current?.startSoloGame(
      playerName,
      cosmetic,
      true,
      selectedCourseRef.current,
      {
        gameMode: selectedGameModeRef.current,
        difficulty: selectedDifficultyRef.current,
        botDifficulty: selectedBotDifficultyRef.current,
      },
      prof ? { accountId: prof.accountId, playerLevel: prof.level } : undefined,
    );
  }, [playerName, cosmetic]);

  const handleStartTutorial = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    setSettingsOpenOnTitle(false);
    setRoomSnapshot(null);
    setRoomChatMessages([]);
    setLastMatchReward(null);
    setScreen('playing');
    sceneRef.current?.startTutorialGame(playerNameRef.current, cosmeticRef.current, true);
  }, []);

  const handleStartPractice = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    setSettingsOpenOnTitle(false);
    setRoomSnapshot(null);
    setRoomChatMessages([]);
    setLastMatchReward(null);
    setScreen('playing');
    sceneRef.current?.startPracticeArena(playerNameRef.current, cosmeticRef.current, true, true);
  }, []);

  const handlePauseToggle = useCallback(() => {
    const cur = screenRef.current;
    if (cur === 'playing') {
      setScreen('paused');
      sceneRef.current?.setScreenState('paused');
    } else if (cur === 'paused') {
      setScreen('playing');
      sceneRef.current?.setScreenState('playing');
    }
  }, []);

  const handleRestart = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    setLastMatchReward(null);
    if (roomSnapshotRef.current) {
      netRef.current?.restartGame();
    } else if (hudRef.current.soloSessionKind === 'tutorial') {
      setScreen('playing');
      sceneRef.current?.startTutorialGame(playerName, cosmetic, true);
    } else if (hudRef.current.soloSessionKind === 'practice') {
      setScreen('playing');
      sceneRef.current?.startPracticeArena(
        playerName,
        cosmetic,
        true,
        hudRef.current.practiceBotsEnabled,
      );
    } else {
      setScreen('playing');
      setLastSoloReplay(null);
      const prof = profileSnapshotRef.current?.profile;
      sceneRef.current?.startSoloGame(
        playerName,
        cosmetic,
        true,
        selectedCourseRef.current,
        {
          gameMode: selectedGameModeRef.current,
          difficulty: selectedDifficultyRef.current,
          botDifficulty: selectedBotDifficultyRef.current,
        },
        prof ? { accountId: prof.accountId, playerLevel: prof.level } : undefined,
      );
    }
  }, [playerName, cosmetic]);

  const handleLeaveRoom = useCallback(() => {
    if (roomSnapshotRef.current) {
      netRef.current?.leaveRoom();
      setRoomSnapshot(null);
      setMyPlayerId(null);
      setMySlot(0);
      setRoomChatMessages([]);
      lastRoomPasswordRef.current = undefined;
      sceneRef.current?.setSpectatorMode(false);
      const ps = partyStateRef.current;
      if (ps && ps.leaderId === partyMemberIdRef.current && ps.activeRoomCode) {
        partyClientRef.current?.setRoom(null);
      }
    }
    setScreen('lobby');
    sceneRef.current?.setScreenState('lobby');
    refreshPublicRooms();
  }, [refreshPublicRooms]);

  const handleBackToTitle = useCallback(() => {
    if (roomSnapshotRef.current) {
      netRef.current?.leaveRoom();
      setRoomSnapshot(null);
      setMyPlayerId(null);
      setMySlot(0);
      setRoomChatMessages([]);
      lastRoomPasswordRef.current = undefined;
      sceneRef.current?.setSpectatorMode(false);
      const ps = partyStateRef.current;
      if (ps && ps.leaderId === partyMemberIdRef.current && ps.activeRoomCode) {
        partyClientRef.current?.setRoom(null);
      }
    }
    setSettingsOpenOnTitle(false);
    setScreen('title');
    sceneRef.current?.setScreenState('title');
    sceneRef.current?.setPreviewCourse(selectedCourseRef.current);
  }, []);

  const handleToggleMuteAll = useCallback(() => {
    setSfxMuted((prev) => {
      const next = !prev;
      setVoiceMuted(next);
      setMusicMuted(next);
      soundRef.current?.setSettings({ sfxMuted: next, voiceMuted: next, musicMuted: next });
      saveAudioPrefs({
        sfxVolume,
        voiceVolume,
        musicVolume,
        sfxMuted: next,
        voiceMuted: next,
        musicMuted: next,
      });
      return next;
    });
  }, [sfxVolume, voiceVolume, musicVolume]);

  const handleSendRoomChat = useCallback((payload: { text?: string; presetId?: string }) => {
    if (roomSnapshotRef.current) {
      netRef.current?.sendChat(payload);
    }
  }, []);

  const handleTriggerEmote = useCallback((emoteId: EmoteId) => {
    if (roomSnapshotRef.current) {
      netRef.current?.triggerEmote(emoteId);
    } else {
      sceneRef.current?.triggerLocalEmote(emoteId);
    }
  }, []);

  const handleSetPlaylist = useCallback((playlist: PlaylistItem[]) => {
    if (roomSnapshotRef.current) {
      netRef.current?.setPlaylist(playlist);
    }
  }, []);

  const handleNextRound = useCallback((payload: { action: NextRoundAction; courseId?: CourseId }) => {
    setLastMatchReward(null);
    if (roomSnapshotRef.current) {
      netRef.current?.nextRound({
        action: payload.action,
        ...(payload.courseId ? { courseId: payload.courseId } : {}),
        immediate: payload.action !== 'lobby',
      });
    }
  }, []);

  const handleSpectateRoom = useCallback(
    (code: string, password?: string) => {
      if (lobbyBusyRef.current) return;
      lobbyBusyRef.current = true;
      setLobbyBusy(true);
      setLobbyError(null);
      lastRoomPasswordRef.current = password;
      netRef.current
        ?.joinRoom(code, playerName, cosmetic, { password, spectate: 'only' })
        .catch((err) => {
          setLobbyError(err.message || 'تعذر دخول الغرفة كمشاهد');
        })
        .finally(() => {
          lobbyBusyRef.current = false;
          setLobbyBusy(false);
        });
    },
    [playerName, cosmetic],
  );

  // Party Handlers (ONLINE-09)
  const handleCreateParty = useCallback(() => {
    if (!partyClientRef.current || partyBusy) return;
    setPartyBusy(true);
    setPartyError(null);
    setPartyMessages([]);
    partyClientRef.current
      .createParty(playerName, cosmetic)
      .catch((err) => {
        setPartyError(err.message || 'تعذر إنشاء المجموعة');
      })
      .finally(() => setPartyBusy(false));
  }, [playerName, cosmetic, partyBusy]);

  const handleJoinParty = useCallback(
    (code: string) => {
      if (!partyClientRef.current || partyBusy) return;
      setPartyBusy(true);
      setPartyError(null);
      setPartyMessages([]);
      partyClientRef.current
        .joinParty(code, playerName, cosmetic)
        .catch((err) => {
          setPartyError(err.message || 'تعذر الانضمام للمجموعة');
        })
        .finally(() => setPartyBusy(false));
    },
    [playerName, cosmetic, partyBusy],
  );

  const handleLeaveParty = useCallback(() => {
    partyClientRef.current?.leaveParty();
    setPartyState(null);
    setPartyMemberId(null);
    setPartyMessages([]);
    setPartyError(null);
  }, []);

  const handleKickPartyMember = useCallback((targetMemberId: string) => {
    partyClientRef.current?.kickMember(targetMemberId);
  }, []);

  const handleSendPartyChat = useCallback((payload: { text?: string; presetId?: string }) => {
    partyClientRef.current?.sendChat(payload);
  }, []);

  // Initialize SoundEngine, MultiplayerClient, PartyClient, and Three.js Scene ONCE
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const sound = new SoundEngine();
    sound.setSettings(initialAudioPrefs);
    soundRef.current = sound;

    const net = new MultiplayerClient({
      onJoined: ({ roomCode, playerId, slot, snapshot }) => {
        setLobbyError(null);
        setMyPlayerId(playerId);
        setMySlot(slot);
        setRoomSnapshot(snapshot);
        setRoomChatMessages((snapshot.recentChat ?? []).slice(-50));
        sceneRef.current?.setOnlineRoomState(snapshot, slot, true);
        if (slot === -1) {
          sceneRef.current?.showToast('👁️ دخلت الغرفة كمشاهد — يمكنك تغيير الكاميرا وإرسال الإشارات!', 3.0);
        }
        const ps = partyStateRef.current;
        if (ps && ps.leaderId === partyMemberIdRef.current && ps.activeRoomCode !== roomCode) {
          partyClientRef.current?.setRoom(roomCode, lastRoomPasswordRef.current);
        }
      },
      onPromoted: ({ slot, snapshot }) => {
        setMySlot(slot);
        setRoomSnapshot(snapshot);
        sceneRef.current?.setSpectatorMode(false);
        sceneRef.current?.setOnlineRoomState(snapshot, slot, false);
        sceneRef.current?.showToast(`🎉 توفر مقعد شاغر! انضممت للمقعد #${slot + 1}`, 3.0);
      },
      onState: (snapshot) => {
        setRoomSnapshot(snapshot);
        setRoomChatMessages((prev) => {
          if (prev.length === 0 && snapshot.recentChat && snapshot.recentChat.length > 0) {
            return snapshot.recentChat.slice(-50);
          }
          return prev;
        });
        sceneRef.current?.setOnlineRoomState(snapshot, mySlotRef.current, false);
      },
      onEvents: (events) => {
        sceneRef.current?.processDiscreteEvents(events);
      },
      onChatMessage: (message) => {
        setRoomChatMessages((prev) => appendUniqueChat(prev, message));
        soundRef.current?.playChatPop();
      },
      onEmote: (ev) => {
        sceneRef.current?.handleRemoteEmote(ev);
      },
      onError: (msg, code) => {
        setLobbyError(msg);
        if (
          code === 'SESSION_REPLACED' ||
          code === 'SESSION_EXPIRED' ||
          code === 'UNAUTHORIZED' ||
          code === 'ROOM_NOT_FOUND' ||
          code === 'ROOM_CLOSED' ||
          code === 'FORBIDDEN_ORIGIN'
        ) {
          setRoomSnapshot(null);
          setMyPlayerId(null);
          setMySlot(0);
          setRoomChatMessages([]);
          sceneRef.current?.setSpectatorMode(false);
          if (screenRef.current === 'playing' || screenRef.current === 'paused') {
            setScreen('lobby');
            sceneRef.current?.setScreenState('lobby');
          }
        }
      },
      onConnectionChange: (status) => {
        setConnectionStatus(status);
      },
    });
    netRef.current = net;

    const partyClient = new PartyClient({
      onState: (party, memberId) => {
        setPartyState(party);
        setPartyMemberId(memberId);
        setPartyMessages((prev) => {
          if (prev.length === 0 && party.recentChat && party.recentChat.length > 0) {
            return party.recentChat.slice(-50);
          }
          return prev;
        });
      },
      onChat: (msg) => {
        setPartyMessages((prev) => appendUniqueChat(prev, msg));
        soundRef.current?.playChatPop();
      },
      onFollowRoom: ({ roomCode, password }) => {
        if (!roomCode) {
          if (roomSnapshotRef.current) {
            netRef.current?.leaveRoom();
            setRoomSnapshot(null);
            setMyPlayerId(null);
            setMySlot(0);
            setRoomChatMessages([]);
            lastRoomPasswordRef.current = undefined;
            sceneRef.current?.setSpectatorMode(false);
            setScreen('lobby');
            sceneRef.current?.setScreenState('lobby');
            sceneRef.current?.showToast('👥 غادر قائد المجموعة الغرفة', 2.4);
          }
          return;
        }
        if (roomSnapshotRef.current?.roomCode === roomCode) return;
        lastRoomPasswordRef.current = password;
        sceneRef.current?.showToast(`👥 جارٍ مرافقة قائد المجموعة إلى الغرفة ${roomCode}...`, 2.5);
        netRef.current
          ?.joinRoom(roomCode, playerNameRef.current, cosmeticRef.current, {
            password,
            spectate: 'auto',
          })
          .catch((err) => {
            setLobbyError(err.message || 'تعذر مرافقة قائد المجموعة');
          });
      },
      onError: (msg, code) => {
        setPartyError(msg);
        if (code === 'SESSION_EXPIRED' || code === 'UNAUTHORIZED' || code === 'PARTY_NOT_FOUND') {
          setPartyState(null);
          setPartyMemberId(null);
          setPartyMessages([]);
        }
      },
      onConnectionChange: (status) => {
        setPartyStatus(status);
      },
    });
    partyClientRef.current = partyClient;

    const initialCourse = getInitialCourseId();
    const initialMode = getInitialGameMode();
    const initialDiff = getInitialDifficulty();
    const manager = new RaftSceneManager({
      container: mount,
      sound,
      initialCourseId: initialCourse,
      initialCameraPrefs: cameraPrefsRef.current,
      onHudUpdate: (nextHud) => {
        setHud(nextHud);
        if (nextHud.screen !== screenRef.current) {
          setScreen(nextHud.screen);
        }
      },
      onPowerBarUpdate: (power, farting) => {
        if (powerFillRef.current) {
          powerFillRef.current.style.transform = `scaleX(${Math.max(0, Math.min(1, power))})`;
          powerFillRef.current.style.backgroundColor =
            power > 0.82 ? '#ffbe0b' : power > 0.45 ? '#9ef01a' : '#70e000';
        }
        if (powerLabelRef.current) {
          if (!farting && power < 0.05) {
            powerLabelRef.current.textContent = 'جاهز';
          } else if (power < 0.4) {
            powerLabelRef.current.textContent = 'نفخة خفيفة';
          } else if (power < 0.82) {
            powerLabelRef.current.textContent = 'دفع متصاعد!';
          } else {
            powerLabelRef.current.textContent = 'أقصى طاقة!!';
          }
        }
      },
      onInputSend: (moveDir, farting, anchor, useItem) => {
        net.sendInput(moveDir, farting, false, anchor, useItem);
      },
      onQuickEmote: (emoteId) => {
        if (roomSnapshotRef.current) {
          net.triggerEmote(emoteId);
        } else {
          sceneRef.current?.triggerLocalEmote(emoteId);
        }
      },
      onCameraPrefsChange: (nextPrefs) => {
        setCameraPrefs(nextPrefs);
        saveCameraPrefs(nextPrefs);
      },
      onRunFinished: (simSnapshot, _courseId, soloSessionKind, replay) => {
        if (soloSessionKind !== 'normal') return;
        const key = `solo:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
        void submitMatchProgression(simSnapshot, 0, key);
        if (replay) {
          setLastSoloReplay(replay);
          void saveRoundReplay(replay).catch(() => {
            // non-fatal if offline or storage unavailable
          });
        }
      },
    });
    sceneRef.current = manager;

    // Bootstrap persistent/guest account identity on app load
    void ensureActiveAccountSession({
      displayName: playerNameRef.current,
      cosmetic: cosmeticRef.current,
    })
      .then(({ token, snapshot }) => {
        applyAuthSnapshot(snapshot, token);
      })
      .catch(() => {
        // Offline / isolated fallback: will retry lazily on first match/open
      });

    // Support ?autostart=1, ?tutorial=1, ?practice=1, ?course=<id>, ?mode=<mode>, and ?room=<CODE>
    const params = new URLSearchParams(window.location.search);
    const inviteRoom = getInitialInviteRoomCode();
    if (params.get('tutorial') === '1') {
      manager.startTutorialGame('قبطان فرفوش', createDefaultCosmetic(0), false);
      setScreen('playing');
    } else if (params.get('practice') === '1') {
      manager.startPracticeArena('قبطان فرفوش', createDefaultCosmetic(0), false, true);
      setScreen('playing');
    } else if (params.get('autostart') === '1') {
      manager.startSoloGame('قبطان فرفوش', createDefaultCosmetic(0), false, initialCourse, {
        gameMode: initialMode,
        difficulty: initialDiff,
      });
      setScreen('playing');
    } else if (inviteRoom) {
      setLobbyInitialTab('join');
      setScreen('lobby');
      manager.setScreenState('lobby');
      setRoomPreviewLoading(true);
      net.fetchRoomInfo(inviteRoom)
        .then((info) => setRoomPreview(info))
        .catch((err) => setLobbyError(err.message || 'تعذر العثور على الغرفة'))
        .finally(() => setRoomPreviewLoading(false));
    } else {
      manager.setScreenState('title');
    }

    const onResize = () => {
      if (window.innerWidth <= 900 || window.matchMedia?.('(pointer: coarse)').matches) {
        setShowTouchControls(true);
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      manager.dispose();
      partyClient.dispose();
      net.dispose();
      sound.dispose();
    };
  }, []);

  // Submit online match reward deterministically when server lifecycle reaches FINISHED
  useEffect(() => {
    if (
      screen === 'gameover' &&
      roomSnapshot &&
      roomSnapshot.lifecycleState === 'FINISHED' &&
      mySlot >= 0
    ) {
      const roundKey = `online:${roomSnapshot.roomCode}:r${roomSnapshot.roundSeq ?? 1}`;
      void submitMatchProgression(hud.sim, mySlot as 0 | 1 | 2 | 3, roundKey);
    }
  }, [screen, roomSnapshot, mySlot, hud.sim, submitMatchProgression]);

  // Clear match reward banner if server starts a new round while modal was open
  useEffect(() => {
    if (screen === 'playing') {
      setLastMatchReward(null);
    }
  }, [screen]);

  // Global keyboard shortcuts (Title Start, Esc/P Pause, M Mute, R Restart)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (
        screenRef.current === 'title' &&
        !settingsOpenOnTitle &&
        !touchEditorOpen &&
        !profileModalOpen &&
        !leaderboardModalOpen &&
        !shopModalOpen &&
        !questsModalOpen &&
        !replayModalOpen &&
        !opsModalOpen &&
        !authModalMode
      ) {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartSolo();
          return;
        }
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (touchEditorOpen) {
          e.preventDefault();
          setTouchEditorOpen(false);
          return;
        }
        if (screenRef.current === 'playing' || screenRef.current === 'paused') {
          e.preventDefault();
          handlePauseToggle();
          return;
        }
      }

      if (e.code === 'KeyM' && screenRef.current === 'playing') {
        e.preventDefault();
        handleToggleMuteAll();
      } else if (e.code === 'KeyR' && screenRef.current === 'playing' && !hud.isSpectator) {
        e.preventDefault();
        handleRestart();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    settingsOpenOnTitle,
    touchEditorOpen,
    profileModalOpen,
    leaderboardModalOpen,
    shopModalOpen,
    questsModalOpen,
    replayModalOpen,
    opsModalOpen,
    authModalMode,
    hud.isSpectator,
    handleStartSolo,
    handlePauseToggle,
    handleToggleMuteAll,
    handleRestart,
  ]);

  // Sync audio, camera, touch & cosmetic changes
  const handleChangeCosmetic = (next: PlayerCosmetic) => {
    setCosmetic(next);
    sceneRef.current?.syncLocalCosmetic(next);
    if (roomSnapshot) {
      netRef.current?.updateCosmetic(next);
    }
    if (partyState) {
      partyClientRef.current?.updateCosmetic(playerNameRef.current, next);
    }
  };

  const handleChangeSfxVol = (v: number) => {
    setSfxVolume(v);
    const mutedNext = v === 0;
    setSfxMuted(mutedNext);
    soundRef.current?.setSettings({ sfxVolume: v, sfxMuted: mutedNext });
    saveAudioPrefs({ sfxVolume: v, voiceVolume, musicVolume, sfxMuted: mutedNext, voiceMuted, musicMuted });
  };

  const handleChangeVoiceVol = (v: number) => {
    setVoiceVolume(v);
    const mutedNext = v === 0;
    setVoiceMuted(mutedNext);
    soundRef.current?.setSettings({ voiceVolume: v, voiceMuted: mutedNext });
    saveAudioPrefs({ sfxVolume, voiceVolume: v, musicVolume, sfxMuted, voiceMuted: mutedNext, musicMuted });
  };

  const handleChangeMusicVol = (v: number) => {
    setMusicVolume(v);
    const mutedNext = v === 0;
    setMusicMuted(mutedNext);
    soundRef.current?.setSettings({ musicVolume: v, musicMuted: mutedNext });
    saveAudioPrefs({ sfxVolume, voiceVolume, musicVolume: v, sfxMuted, voiceMuted, musicMuted: mutedNext });
  };

  const handleTestCharacterVoice = useCallback(() => {
    soundRef.current?.unlock();
    soundRef.current?.playCharacterReaction('powerup', 0);
  }, []);

  const handleChangeCameraPrefs = useCallback((next: CameraPrefs) => {
    const normalized = normalizeCameraPrefs(next);
    setCameraPrefs(normalized);
    saveCameraPrefs(normalized);
    sceneRef.current?.setCameraPrefs(normalized);
  }, []);

  const handleCycleCameraMode = useCallback(() => {
    sceneRef.current?.cycleCameraMode();
  }, []);

  const handleChangeTouchConfig = useCallback((next: TouchControlsConfig) => {
    const normalized = normalizeTouchControlsConfig(next);
    setTouchConfig(normalized);
    saveTouchControlsConfig(normalized);
  }, []);

  const handleToggleReduceShake = () => {
    setReduceShake((prev) => {
      const next = !prev;
      sceneRef.current?.setReduceShake(next);
      return next;
    });
  };

  const openProfileSafe = useCallback(() => {
    setProgressionError(null);
    setProfileModalOpen(true);
    void ensureAccountReady();
  }, [ensureAccountReady]);

  const openLeaderboardSafe = useCallback(() => {
    setLeaderboardModalOpen(true);
  }, []);

  const openShopSafe = useCallback(() => {
    setProgressionError(null);
    setShopModalOpen(true);
    void ensureAccountReady();
  }, [ensureAccountReady]);

  const openQuestsSeasonSafe = useCallback(() => {
    setProgressionError(null);
    setQuestsModalOpen(true);
    void ensureAccountReady();
  }, [ensureAccountReady]);

  const openAuthSafe = useCallback((explicitMode?: AccountAuthMode) => {
    setProgressionError(null);
    if (explicitMode) {
      setAuthModalMode(explicitMode);
      return;
    }
    const isGuest = profileSnapshotRef.current?.profile.isGuest ?? true;
    setAuthModalMode(isGuest ? 'link' : 'login');
  }, []);

  const handleAuthLogin = async (username: string, password: string) => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      const res = await loginPermanentAccount({ username, password });
      applyAuthSnapshot(extractProfileSnapshot(res), res.token);
      setAuthModalMode(null);
    } catch (err) {
      setProgressionError((err as Error).message || 'تعذر تسجيل الدخول');
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleAuthRegister = async (username: string, password: string, displayName: string) => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      const res = await registerPermanentAccount({
        username,
        password,
        displayName,
        cosmetic: cosmeticRef.current,
      });
      applyAuthSnapshot(extractProfileSnapshot(res), res.token);
      setAuthModalMode(null);
    } catch (err) {
      setProgressionError((err as Error).message || 'تعذر إنشاء الحساب');
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleAuthLink = async (username: string, password: string, displayName: string) => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      if (!getStoredAccountToken()) {
        await ensureAccountReady();
      }
      const res = await linkGuestToPermanentAccount({ username, password, displayName });
      applyAuthSnapshot(extractProfileSnapshot(res), res.token);
      setAuthModalMode(null);
    } catch (err) {
      setProgressionError((err as Error).message || 'تعذر ربط الحساب');
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleLogout = async () => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      await logoutAccount();
      const guest = await createGuestSession({
        displayName: 'قبطان فرفوش',
        cosmetic: createDefaultCosmetic(0),
      });
      applyAuthSnapshot(extractProfileSnapshot(guest), guest.token);
    } catch (err) {
      setProgressionError((err as Error).message || 'تعذر تسجيل الخروج');
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleSaveAccountProfile = async (displayName: string, nextCosmetic: PlayerCosmetic) => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      await ensureAccountReady();
      const updated = await updateMyProfile({ displayName, cosmetic: nextCosmetic });
      applyAuthSnapshot(extractProfileSnapshot(updated));
      if (roomSnapshotRef.current) {
        netRef.current?.updateCosmetic(nextCosmetic);
      }
      if (partyStateRef.current) {
        partyClientRef.current?.updateCosmetic(displayName, nextCosmetic);
      }
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleBuyCosmetic = async (itemId: string) => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      await ensureAccountReady();
      const res = await buyCosmeticItem({ itemId, equip: true });
      const snap = extractProfileSnapshot(res);
      applyAuthSnapshot(snap);
      if (roomSnapshotRef.current) {
        netRef.current?.updateCosmetic(snap.profile.cosmetic);
      }
      if (partyStateRef.current) {
        partyClientRef.current?.updateCosmetic(snap.profile.displayName, snap.profile.cosmetic);
      }
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleEquipCosmetic = async (nextCosmetic: PlayerCosmetic) => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      await ensureAccountReady();
      const updated = await equipCosmeticLook({ cosmetic: nextCosmetic });
      const snap = extractProfileSnapshot(updated);
      applyAuthSnapshot(snap);
      if (roomSnapshotRef.current) {
        netRef.current?.updateCosmetic(snap.profile.cosmetic);
      }
      if (partyStateRef.current) {
        partyClientRef.current?.updateCosmetic(snap.profile.displayName, snap.profile.cosmetic);
      }
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleClaimQuest = async (questId: string) => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      await ensureAccountReady();
      const claimed = await claimQuestReward(questId);
      applyAuthSnapshot(extractProfileSnapshot(claimed));
      if (claimed.leveledUp) {
        sceneRef.current?.showToast(`⭐ ترقية مستوى جديدة: المستوى ${claimed.profile.level}!`, 2.8);
      }
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleClaimSeasonTier = async (tier: number) => {
    setProgressionBusy(true);
    setProgressionError(null);
    try {
      await ensureAccountReady();
      const claimed = await claimSeasonTierReward(tier);
      applyAuthSnapshot(extractProfileSnapshot(claimed));
      if (claimed.leveledUp) {
        sceneRef.current?.showToast(`⭐ ترقية مستوى جديدة: المستوى ${claimed.profile.level}!`, 2.8);
      }
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleLaunchRareEvent = useCallback(
    (courseId: CourseId, gameMode: GameMode) => {
      setQuestsModalOpen(false);
      setShopModalOpen(false);
      setSettingsOpenOnTitle(false);
      setSelectedCourseId(courseId);
      selectedCourseRef.current = courseId;
      setSelectedGameMode(gameMode);
      selectedGameModeRef.current = gameMode;
      setCreateSettings((prev) => ({ ...prev, gameMode }));
      setRoomSnapshot(null);
      setRoomChatMessages([]);
      setLastMatchReward(null);
      setLastSoloReplay(null);
      setScreen('playing');
      const prof = profileSnapshotRef.current?.profile;
      sceneRef.current?.startSoloGame(
        playerNameRef.current,
        cosmeticRef.current,
        true,
        courseId,
        {
          gameMode,
          difficulty: selectedDifficultyRef.current,
          botDifficulty: selectedBotDifficultyRef.current,
        },
        prof ? { accountId: prof.accountId, playerLevel: prof.level } : undefined,
      );
    },
    [],
  );

  const handleAddFriend = async (username: string) => {
    setProgressionBusy(true);
    try {
      const { friends } = await addFriendByUsername(username);
      setProfileSnapshot((prev) => (prev ? { ...prev, friends } : prev));
    } finally {
      setProgressionBusy(false);
    }
  };

  const handleRemoveFriend = async (accountId: string) => {
    setProgressionBusy(true);
    try {
      const { friends } = await removeFriendById(accountId);
      setProfileSnapshot((prev) => (prev ? { ...prev, friends } : prev));
    } finally {
      setProgressionBusy(false);
    }
  };

  const claimableRewardsCount = profileSnapshot
    ? profileSnapshot.quests.filter((q) => q.completedAt !== null && q.claimedAt === null).length +
      profileSnapshot.season.tiers.filter((t) => t.unlocked && !t.claimed).length
    : 0;

  const isOnline = Boolean(roomSnapshot);
  const isHost = roomSnapshot ? roomSnapshot.hostId === myPlayerId : true;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0e3b5c]">
      {/* Isolated WebGL Canvas Mount */}
      <div
        ref={canvasMountRef}
        data-testid="game-canvas-container"
        className="fixed inset-0 w-full h-full"
      />

      {/* Title Screen */}
      {screen === 'title' && !settingsOpenOnTitle && (
        <TitleScreen
          selectedCourseId={selectedCourseId}
          selectedGameMode={selectedGameMode}
          selectedDifficulty={selectedDifficulty}
          selectedBotDifficulty={selectedBotDifficulty}
          accountProfile={profileSnapshot?.profile ?? null}
          claimableRewardsCount={claimableRewardsCount}
          rareEvent={profileSnapshot?.rareEvent ?? null}
          onSelectCourse={(courseId) => handleSelectCourse(courseId)}
          onSelectGameMode={(mode) => {
            setSelectedGameMode(mode);
            setCreateSettings((prev) => ({ ...prev, gameMode: mode }));
          }}
          onSelectDifficulty={(difficulty) => {
            setSelectedDifficulty(difficulty);
            setCreateSettings((prev) => ({ ...prev, difficulty }));
          }}
          onSelectBotDifficulty={(botDiff) => {
            setSelectedBotDifficulty(botDiff);
            setCreateSettings((prev) => ({ ...prev, botDifficulty: botDiff }));
          }}
          onStartSolo={handleStartSolo}
          onStartTutorial={handleStartTutorial}
          onStartPractice={handleStartPractice}
          onOpenLobby={() => {
            setLobbyError(null);
            setLobbyInitialTab('public');
            setScreen('lobby');
            sceneRef.current?.setScreenState('lobby');
            refreshPublicRooms();
          }}
          onOpenSettings={() => setSettingsOpenOnTitle(true)}
          onOpenProfile={openProfileSafe}
          onOpenLeaderboard={openLeaderboardSafe}
          onOpenShop={openShopSafe}
          onOpenQuestsSeason={openQuestsSeasonSafe}
          onOpenReplays={() => {
            setReplayTargetMatchId(null);
            setReplayModalOpen(true);
          }}
          onOpenOps={() => setOpsModalOpen(true)}
          onLaunchRareEvent={handleLaunchRareEvent}
          onOpenAuth={() => openAuthSafe()}
        />
      )}

      {/* Online Multiplayer Lobby */}
      {screen === 'lobby' && (
        <LobbyModal
          playerName={playerName}
          onChangeName={setPlayerName}
          cosmetic={cosmetic}
          ownedItemIds={profileSnapshot?.ownedItemIds}
          onChangeCosmetic={handleChangeCosmetic}
          selectedCourseId={selectedCourseId}
          onSelectCourse={handleSelectCourse}
          onVoteCourse={handleVoteCourse}
          createSettings={createSettings}
          onChangeCreateSettings={setCreateSettings}
          roomSnapshot={roomSnapshot}
          myPlayerId={myPlayerId}
          mySlot={mySlot}
          connectionStatus={connectionStatus}
          isSubmitting={lobbyBusy}
          errorMsg={lobbyError}
          initialTab={lobbyInitialTab}
          initialJoinCode={initialInviteCode}
          publicRooms={publicRooms}
          spectatableRooms={spectatableRooms}
          publicRoomsLoading={publicRoomsLoading}
          publicRoomsError={publicRoomsError}
          onRefreshPublicRooms={refreshPublicRooms}
          onQuickMatch={(preferredGameMode) => {
            if (lobbyBusyRef.current) return;
            lobbyBusyRef.current = true;
            setLobbyBusy(true);
            setLobbyError(null);
            lastRoomPasswordRef.current = undefined;
            netRef.current
              ?.quickMatch({
                name: playerName,
                cosmetic,
                ...(preferredGameMode ? { preferredGameMode } : {}),
                preferredCourseId: selectedCourseRef.current,
              })
              .catch((err) => {
                setLobbyError(err.message || 'لا توجد غرف عامة متاحة حالياً');
              })
              .finally(() => {
                lobbyBusyRef.current = false;
                setLobbyBusy(false);
              });
          }}
          roomPreview={roomPreview}
          roomPreviewLoading={roomPreviewLoading}
          onPreviewRoom={fetchRoomPreview}
          onCreateRoom={({ isPrivate, password, settings }) => {
            if (lobbyBusyRef.current) return;
            lobbyBusyRef.current = true;
            setLobbyBusy(true);
            setLobbyError(null);
            lastRoomPasswordRef.current = password;
            netRef.current
              ?.createRoom(playerName, cosmetic, {
                courseId: selectedCourseRef.current,
                isPrivate,
                password,
                settings,
              })
              .catch((err) => {
                setLobbyError(err.message || 'تعذر إنشاء الغرفة');
              })
              .finally(() => {
                lobbyBusyRef.current = false;
                setLobbyBusy(false);
              });
          }}
          onJoinRoom={(code, password) => {
            if (lobbyBusyRef.current) return;
            lobbyBusyRef.current = true;
            setLobbyBusy(true);
            setLobbyError(null);
            lastRoomPasswordRef.current = password;
            netRef.current
              ?.joinRoom(code, playerName, cosmetic, { password, spectate: 'auto' })
              .catch((err) => {
                setLobbyError(err.message || 'تعذر الانضمام للغرفة');
              })
              .finally(() => {
                lobbyBusyRef.current = false;
                setLobbyBusy(false);
              });
          }}
          onSpectateRoom={handleSpectateRoom}
          onUpdateRoomSettings={(partial) => netRef.current?.updateRoomSettings(partial)}
          onSetPlaylist={handleSetPlaylist}
          onToggleReady={(r) => netRef.current?.setReady(r)}
          onToggleBots={(b) => netRef.current?.toggleBots(b)}
          onStartOnlineGame={() => netRef.current?.startGame()}
          onLeaveRoom={handleLeaveRoom}
          onClose={() => {
            setScreen('title');
            sceneRef.current?.setScreenState('title');
          }}
          roomChatMessages={roomChatMessages}
          onSendRoomChat={handleSendRoomChat}
          onTriggerEmote={handleTriggerEmote}
          partyState={partyState}
          partyMemberId={partyMemberId}
          partyStatus={partyStatus}
          partyError={partyError}
          partyBusy={partyBusy}
          partyMessages={partyMessages}
          onCreateParty={handleCreateParty}
          onJoinParty={handleJoinParty}
          onLeaveParty={handleLeaveParty}
          onKickPartyMember={handleKickPartyMember}
          onSendPartyChat={handleSendPartyChat}
          accountProfile={profileSnapshot?.profile ?? null}
          onOpenProfile={openProfileSafe}
          onOpenLeaderboard={openLeaderboardSafe}
        />
      )}

      {/* Active Gameplay HUD */}
      {(screen === 'playing' || screen === 'paused') && (
        <GameHud
          hud={hud}
          connectionStatus={connectionStatus}
          muted={sfxMuted && voiceMuted && musicMuted}
          showTouchControls={showTouchControls}
          touchConfig={touchConfig}
          powerFillRef={powerFillRef}
          powerLabelRef={powerLabelRef}
          roomChatMessages={roomChatMessages}
          onToggleMute={handleToggleMuteAll}
          onPause={handlePauseToggle}
          onRestart={handleRestart}
          onToggleTouchControls={() => setShowTouchControls((s) => !s)}
          onCycleCameraMode={handleCycleCameraMode}
          onTouchInput={(ctrl, pressed) => sceneRef.current?.setTouchInput(ctrl, pressed)}
          onTriggerEmote={handleTriggerEmote}
          onSendChat={isOnline ? handleSendRoomChat : undefined}
          onSelectSpectatorTarget={(target) => sceneRef.current?.setSpectatorTarget(target)}
          onLeaveRoom={isOnline ? handleLeaveRoom : handleBackToTitle}
          onSkipTutorial={handleBackToTitle}
          onResetPracticeRaft={() => sceneRef.current?.resetPracticeRaft()}
          onRespawnPracticePickups={() => sceneRef.current?.respawnPracticePickups()}
          onTogglePracticeBots={() => sceneRef.current?.togglePracticeBots()}
          onFinishPractice={handleBackToTitle}
        />
      )}

      {/* Pause or Title Settings Modal */}
      {(screen === 'paused' || (screen === 'title' && settingsOpenOnTitle)) && (
        <PauseSettingsModal
          isPlayingContext={screen === 'paused'}
          isOnline={isOnline}
          isHost={isHost}
          sfxVolume={sfxVolume}
          voiceVolume={voiceVolume}
          musicVolume={musicVolume}
          sfxMuted={sfxMuted}
          voiceMuted={voiceMuted}
          musicMuted={musicMuted}
          reduceShake={reduceShake}
          showTouchControls={showTouchControls}
          cameraPrefs={cameraPrefs}
          cosmetic={cosmetic}
          ownedItemIds={profileSnapshot?.ownedItemIds}
          onOpenShop={openShopSafe}
          onChangeSfxVolume={handleChangeSfxVol}
          onChangeVoiceVolume={handleChangeVoiceVol}
          onChangeMusicVolume={handleChangeMusicVol}
          onToggleSfxMute={() => {
            setSfxMuted((m) => {
              const next = !m;
              soundRef.current?.setSettings({ sfxMuted: next });
              saveAudioPrefs({ sfxVolume, voiceVolume, musicVolume, sfxMuted: next, voiceMuted, musicMuted });
              return next;
            });
          }}
          onToggleVoiceMute={() => {
            setVoiceMuted((m) => {
              const next = !m;
              soundRef.current?.setSettings({ voiceMuted: next });
              saveAudioPrefs({ sfxVolume, voiceVolume, musicVolume, sfxMuted, voiceMuted: next, musicMuted });
              return next;
            });
          }}
          onToggleMusicMute={() => {
            setMusicMuted((m) => {
              const next = !m;
              soundRef.current?.setSettings({ musicMuted: next });
              saveAudioPrefs({ sfxVolume, voiceVolume, musicVolume, sfxMuted, voiceMuted, musicMuted: next });
              return next;
            });
          }}
          onTestVoice={handleTestCharacterVoice}
          onToggleReduceShake={handleToggleReduceShake}
          onToggleTouchControls={() => setShowTouchControls((s) => !s)}
          onOpenTouchEditor={() => setTouchEditorOpen(true)}
          onChangeCameraPrefs={handleChangeCameraPrefs}
          onChangeCosmetic={handleChangeCosmetic}
          onResume={() => {
            if (screen === 'paused') {
              setScreen('playing');
              sceneRef.current?.setScreenState('playing');
            } else {
              setSettingsOpenOnTitle(false);
            }
          }}
          onRestart={handleRestart}
          onBackToTitle={handleBackToTitle}
        />
      )}

      {/* UX-03: Customizable Touch Controls Editor Modal */}
      {touchEditorOpen && (
        <TouchLayoutEditorModal
          config={touchConfig}
          onChange={handleChangeTouchConfig}
          onClose={() => setTouchEditorOpen(false)}
        />
      )}

      {/* Victory / Finish Line Modal */}
      {screen === 'gameover' && (
        <VictoryModal
          sim={hud.sim}
          soloSessionKind={hud.soloSessionKind}
          bestTimeTrialSec={hud.bestTimeTrialSec}
          bestSurvivalDistance={hud.bestSurvivalDistance}
          isOnline={isOnline}
          isHost={isHost}
          isSpectator={hud.isSpectator}
          playlistQueue={roomSnapshot?.playlistQueue ?? []}
          roomChatMessages={roomChatMessages}
          matchReward={lastMatchReward}
          onPlayAgain={handleRestart}
          onStartPractice={handleStartPractice}
          onNextRound={isOnline ? handleNextRound : undefined}
          onSendChat={isOnline ? handleSendRoomChat : undefined}
          onTriggerEmote={handleTriggerEmote}
          onOpenProfile={openProfileSafe}
          onOpenLeaderboard={openLeaderboardSafe}
          onOpenShop={openShopSafe}
          onOpenQuestsSeason={openQuestsSeasonSafe}
          onOpenReplay={
            hud.soloSessionKind === 'normal'
              ? () => {
                  const targetId =
                    isOnline && roomSnapshot
                      ? `online:${roomSnapshot.roomCode}:r${roomSnapshot.roundSeq ?? 1}`
                      : lastSoloReplay?.matchId ?? null;
                  setReplayTargetMatchId(targetId);
                  setReplayModalOpen(true);
                }
              : undefined
          }
          onBackToTitle={handleBackToTitle}
        />
      )}

      {/* PROG-02 & PROG-03 & PROG-05: Profile Modal */}
      {profileModalOpen && profileSnapshot && (
        <ProfileModal
          snapshot={profileSnapshot}
          isBusy={progressionBusy}
          errorMsg={progressionError}
          onUpdateProfile={handleSaveAccountProfile}
          onOpenAuth={(mode) => openAuthSafe(mode)}
          onOpenShop={() => {
            setProfileModalOpen(false);
            openShopSafe();
          }}
          onLogout={() => void handleLogout()}
          onAddFriend={handleAddFriend}
          onRemoveFriend={handleRemoveFriend}
          onClose={() => setProfileModalOpen(false)}
        />
      )}

      {/* PROG-08 & PROG-09: Cosmetic Shop Modal */}
      {shopModalOpen && profileSnapshot && (
        <ShopModal
          snapshot={profileSnapshot}
          isBusy={progressionBusy}
          errorMsg={progressionError}
          onBuyItem={handleBuyCosmetic}
          onEquipCosmetic={handleEquipCosmetic}
          onOpenQuestsSeason={() => {
            setShopModalOpen(false);
            openQuestsSeasonSafe();
          }}
          onClose={() => setShopModalOpen(false)}
        />
      )}

      {/* PROG-06, PROG-07 & PROG-10: Daily/Weekly Quests, Season Track & Rare Events Modal */}
      {questsModalOpen && profileSnapshot && (
        <QuestsSeasonModal
          snapshot={profileSnapshot}
          isBusy={progressionBusy}
          errorMsg={progressionError}
          onClaimQuest={handleClaimQuest}
          onClaimSeasonTier={handleClaimSeasonTier}
          onLaunchRareEvent={handleLaunchRareEvent}
          onOpenShop={() => {
            setQuestsModalOpen(false);
            openShopSafe();
          }}
          onClose={() => setQuestsModalOpen(false)}
        />
      )}

      {/* PROG-04: Leaderboard Modal */}
      {leaderboardModalOpen && (
        <LeaderboardModal
          partyAccountIds={
            roomSnapshot
              ? roomSnapshot.sim.players
                  .map((p) => p.accountId)
                  .filter((id): id is string => typeof id === 'string' && id.length > 0)
              : []
          }
          onClose={() => setLeaderboardModalOpen(false)}
        />
      )}

      {/* PROG-01: Permanent Account Login / Register / Guest Link Modal */}
      {authModalMode && (
        <AccountAuthModal
          mode={authModalMode}
          currentDisplayName={profileSnapshot?.profile.displayName ?? playerName}
          isBusy={progressionBusy}
          errorMsg={progressionError}
          onChangeMode={(m) => {
            setProgressionError(null);
            setAuthModalMode(m);
          }}
          onSubmitLogin={(u, p) => void handleAuthLogin(u, p)}
          onSubmitRegister={(u, p, d) => void handleAuthRegister(u, p, d)}
          onSubmitLink={(u, p, d) => void handleAuthLink(u, p, d)}
          onClose={() => {
            setProgressionError(null);
            setAuthModalMode(null);
          }}
        />
      )}

      {/* TECH-04: Round Replay Archive & Viewer Modal */}
      {replayModalOpen && (
        <ReplayModal
          initialMatchId={replayTargetMatchId}
          initialReplay={
            replayTargetMatchId && lastSoloReplay?.matchId === replayTargetMatchId
              ? lastSoloReplay
              : !replayTargetMatchId
                ? lastSoloReplay
                : null
          }
          onClose={() => setReplayModalOpen(false)}
        />
      )}

      {/* TECH-05..07: Server Health, Compatibility & Course Balance Analytics Modal */}
      {opsModalOpen && (
        <OpsDashboardModal onClose={() => setOpsModalOpen(false)} />
      )}
    </main>
  );
}
