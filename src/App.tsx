import { useCallback, useEffect, useRef, useState } from 'react';
import { SoundEngine } from './audio/soundEngine.ts';
import { GameHud } from './components/GameHud.tsx';
import { LobbyModal } from './components/LobbyModal.tsx';
import { PauseSettingsModal } from './components/PauseSettingsModal.tsx';
import { TitleScreen } from './components/TitleScreen.tsx';
import { VictoryModal } from './components/VictoryModal.tsx';
import { RaftSceneManager, type HudSnapshot } from './game/RaftSceneManager.ts';
import { MultiplayerClient } from './net/multiplayerClient.ts';
import { createDefaultCosmetic, createInitialSimState } from './shared/physics.ts';
import type { ConnectionStatus, GameScreenState, PlayerCosmetic, RoomSnapshot } from './shared/types.ts';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<RaftSceneManager | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const netRef = useRef<MultiplayerClient | null>(null);

  const powerFillRef = useRef<HTMLDivElement | null>(null);
  const powerLabelRef = useRef<HTMLSpanElement | null>(null);

  const [screen, setScreen] = useState<GameScreenState>('title');
  const [settingsOpenOnTitle, setSettingsOpenOnTitle] = useState(false);

  const [playerName, setPlayerName] = useState('قبطان فرفوش');
  const [cosmetic, setCosmetic] = useState<PlayerCosmetic>(() => createDefaultCosmetic(0));

  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [mySlot, setMySlot] = useState<0 | 1 | 2 | 3>(0);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  const [sfxVolume, setSfxVolume] = useState(0.8);
  const [musicVolume, setMusicVolume] = useState(0.35);
  const [sfxMuted, setSfxMuted] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);
  const [reduceShake, setReduceShake] = useState(false);
  const [showTouchControls, setShowTouchControls] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth <= 900;
  });

  const [hud, setHud] = useState<HudSnapshot>(() => ({
    screen: 'title',
    mode: 'solo',
    elapsedTime: 0,
    falls: 0,
    checkpointIndex: 0,
    totalCheckpoints: 2,
    progress: 0,
    connectedPlayers: 4,
    mySlot: 0,
    toastText: null,
    sim: createInitialSimState('solo'),
  }));

  const screenRef = useRef<GameScreenState>(screen);
  screenRef.current = screen;
  const mySlotRef = useRef<0 | 1 | 2 | 3>(mySlot);
  mySlotRef.current = mySlot;
  const roomSnapshotRef = useRef<RoomSnapshot | null>(roomSnapshot);
  roomSnapshotRef.current = roomSnapshot;

  const handleStartSolo = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    setSettingsOpenOnTitle(false);
    setRoomSnapshot(null);
    setScreen('playing');
    sceneRef.current?.startSoloGame(playerName, cosmetic);
  }, [playerName, cosmetic]);

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
    if (roomSnapshotRef.current) {
      netRef.current?.restartGame();
      setScreen('playing');
      sceneRef.current?.setScreenState('playing');
    } else {
      setScreen('playing');
      sceneRef.current?.startSoloGame(playerName, cosmetic);
    }
  }, [playerName, cosmetic]);

  const handleBackToTitle = useCallback(() => {
    if (roomSnapshotRef.current) {
      netRef.current?.leaveRoom();
      setRoomSnapshot(null);
      setMyPlayerId(null);
    }
    setSettingsOpenOnTitle(false);
    setScreen('title');
    sceneRef.current?.setScreenState('title');
  }, []);

  const handleToggleMuteAll = useCallback(() => {
    setSfxMuted((prev) => {
      const next = !prev;
      setMusicMuted(next);
      soundRef.current?.setSettings({ sfxMuted: next, musicMuted: next });
      return next;
    });
  }, []);

  // Initialize SoundEngine, MultiplayerClient, and Three.js Scene ONCE
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const sound = new SoundEngine();
    soundRef.current = sound;

    const net = new MultiplayerClient({
      onJoined: ({ playerId, slot, snapshot }) => {
        setLobbyError(null);
        setMyPlayerId(playerId);
        setMySlot(slot);
        setRoomSnapshot(snapshot);
        sceneRef.current?.setOnlineRoomState(snapshot, slot, true);
      },
      onState: (snapshot) => {
        setRoomSnapshot(snapshot);
        sceneRef.current?.setOnlineRoomState(snapshot, mySlotRef.current, false);
      },
      onError: (msg) => {
        setLobbyError(msg);
      },
      onConnectionChange: (status) => {
        setConnectionStatus(status);
      },
    });
    netRef.current = net;

    const manager = new RaftSceneManager({
      container: mount,
      sound,
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
      onInputSend: (moveDir, farting) => {
        net.sendInput(moveDir, farting);
      },
    });
    sceneRef.current = manager;

    // Support ?autostart=1 for instant gameplay boot & automated testing
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      manager.startSoloGame('قبطان فرفوش', createDefaultCosmetic(0), false);
      setScreen('playing');
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
      net.dispose();
      sound.dispose();
    };
  }, []);

  // Global keyboard shortcuts (Title Start, Esc/P Pause, M Mute, R Restart)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (screenRef.current === 'title' && !settingsOpenOnTitle) {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartSolo();
          return;
        }
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (screenRef.current === 'playing' || screenRef.current === 'paused') {
          e.preventDefault();
          handlePauseToggle();
          return;
        }
      }

      if (e.code === 'KeyM' && screenRef.current === 'playing') {
        e.preventDefault();
        handleToggleMuteAll();
      } else if (e.code === 'KeyR' && screenRef.current === 'playing') {
        e.preventDefault();
        handleRestart();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpenOnTitle, handleStartSolo, handlePauseToggle, handleToggleMuteAll, handleRestart]);

  // Sync audio & cosmetic changes
  const handleChangeCosmetic = (next: PlayerCosmetic) => {
    setCosmetic(next);
    sceneRef.current?.syncLocalCosmetic(next);
    if (roomSnapshot) {
      netRef.current?.updateCosmetic(next);
    }
  };

  const handleChangeSfxVol = (v: number) => {
    setSfxVolume(v);
    setSfxMuted(v === 0);
    soundRef.current?.setSettings({ sfxVolume: v, sfxMuted: v === 0 });
  };

  const handleChangeMusicVol = (v: number) => {
    setMusicVolume(v);
    setMusicMuted(v === 0);
    soundRef.current?.setSettings({ musicVolume: v, musicMuted: v === 0 });
  };

  const handleToggleReduceShake = () => {
    setReduceShake((prev) => {
      const next = !prev;
      sceneRef.current?.setReduceShake(next);
      return next;
    });
  };

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
          onStartSolo={handleStartSolo}
          onOpenLobby={() => {
            setLobbyError(null);
            setScreen('lobby');
            sceneRef.current?.setScreenState('lobby');
          }}
          onOpenSettings={() => setSettingsOpenOnTitle(true)}
        />
      )}

      {/* Online Multiplayer Lobby */}
      {screen === 'lobby' && (
        <LobbyModal
          playerName={playerName}
          onChangeName={setPlayerName}
          cosmetic={cosmetic}
          onChangeCosmetic={handleChangeCosmetic}
          roomSnapshot={roomSnapshot}
          myPlayerId={myPlayerId}
          connectionStatus={connectionStatus}
          errorMsg={lobbyError}
          onCreateRoom={() => {
            setLobbyError(null);
            netRef.current?.createRoom(playerName, cosmetic).catch((err) => {
              setLobbyError(err.message || 'تعذر إنشاء الغرفة');
            });
          }}
          onJoinRoom={(code) => {
            setLobbyError(null);
            netRef.current?.joinRoom(code, playerName, cosmetic).catch((err) => {
              setLobbyError(err.message || 'تعذر الانضمام للغرفة');
            });
          }}
          onToggleReady={(r) => netRef.current?.setReady(r)}
          onToggleBots={(b) => netRef.current?.toggleBots(b)}
          onStartOnlineGame={() => netRef.current?.startGame()}
          onLeaveRoom={() => {
            netRef.current?.leaveRoom();
            setRoomSnapshot(null);
            setMyPlayerId(null);
          }}
          onClose={() => {
            setScreen('title');
            sceneRef.current?.setScreenState('title');
          }}
        />
      )}

      {/* Active Gameplay HUD */}
      {(screen === 'playing' || screen === 'paused') && (
        <GameHud
          hud={hud}
          connectionStatus={connectionStatus}
          muted={sfxMuted && musicMuted}
          showTouchControls={showTouchControls}
          powerFillRef={powerFillRef}
          powerLabelRef={powerLabelRef}
          onToggleMute={handleToggleMuteAll}
          onPause={handlePauseToggle}
          onRestart={handleRestart}
          onToggleTouchControls={() => setShowTouchControls((s) => !s)}
          onTouchInput={(ctrl, pressed) => sceneRef.current?.setTouchInput(ctrl, pressed)}
        />
      )}

      {/* Pause or Title Settings Modal */}
      {(screen === 'paused' || (screen === 'title' && settingsOpenOnTitle)) && (
        <PauseSettingsModal
          isPlayingContext={screen === 'paused'}
          isOnline={isOnline}
          isHost={isHost}
          sfxVolume={sfxVolume}
          musicVolume={musicVolume}
          sfxMuted={sfxMuted}
          musicMuted={musicMuted}
          reduceShake={reduceShake}
          showTouchControls={showTouchControls}
          cosmetic={cosmetic}
          onChangeSfxVolume={handleChangeSfxVol}
          onChangeMusicVolume={handleChangeMusicVol}
          onToggleSfxMute={() => {
            setSfxMuted((m) => {
              soundRef.current?.setSettings({ sfxMuted: !m });
              return !m;
            });
          }}
          onToggleMusicMute={() => {
            setMusicMuted((m) => {
              soundRef.current?.setSettings({ musicMuted: !m });
              return !m;
            });
          }}
          onToggleReduceShake={handleToggleReduceShake}
          onToggleTouchControls={() => setShowTouchControls((s) => !s)}
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

      {/* Victory / Finish Line Modal */}
      {screen === 'gameover' && (
        <VictoryModal
          sim={hud.sim}
          isOnline={isOnline}
          isHost={isHost}
          onPlayAgain={handleRestart}
          onBackToTitle={handleBackToTitle}
        />
      )}
    </main>
  );
}
