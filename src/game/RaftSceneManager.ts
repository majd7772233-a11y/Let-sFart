import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  COURSE_MAIN,
  PLAYER_ZONES,
  getMovingGateCenterX,
} from '../shared/course.ts';
import {
  createInitialSimState,
  stepSimulation,
} from '../shared/physics.ts';
import type {
  GameScreenState,
  PlayMode,
  PlayerCosmetic,
  RoomSnapshot,
  SimEvent,
  WorldSimulationState,
} from '../shared/types.ts';
import type { SoundEngine } from '../audio/soundEngine.ts';
import {
  animateCharacterRig,
  createCharacterRig,
  createCourseScene,
  createRaftModel,
  type CharacterRig,
  type CourseSceneHandles,
} from './models.ts';
import { ParticlePoolSystem } from './particles.ts';
import { createProceduralTextures, type ProceduralTextures } from './textures.ts';

// Pre-allocated scratch math helpers (zero GC inside animation loop)
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _camLookSmooth = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _backDir = new THREE.Vector3();
const _raftQuat = new THREE.Quaternion();
const _raftEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export interface HudSnapshot {
  screen: GameScreenState;
  mode: PlayMode;
  elapsedTime: number;
  falls: number;
  checkpointIndex: number;
  totalCheckpoints: number;
  progress: number;
  connectedPlayers: number;
  mySlot: 0 | 1 | 2 | 3;
  toastText: string | null;
  sim: WorldSimulationState;
}

export interface RaftSceneOptions {
  container: HTMLElement;
  sound: SoundEngine;
  onHudUpdate: (hud: HudSnapshot) => void;
  onPowerBarUpdate: (power: number, farting: boolean) => void;
  onInputSend?: (moveDir: -1 | 0 | 1, farting: boolean) => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class RaftSceneManager {
  private container: HTMLElement;
  private sound: SoundEngine;
  private onHudUpdate: (hud: HudSnapshot) => void;
  private onPowerBarUpdate: (power: number, farting: boolean) => void;
  private onInputSend?: (moveDir: -1 | 0 | 1, farting: boolean) => void;

  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private keyLight: THREE.DirectionalLight;
  private textures: ProceduralTextures;
  private courseHandles: CourseSceneHandles;
  private particles: ParticlePoolSystem;

  private raftGroup: THREE.Group;
  private flagMesh: THREE.Mesh;
  private characterRigs: [CharacterRig, CharacterRig, CharacterRig, CharacterRig];

  private screenState: GameScreenState = 'title';
  private sim: WorldSimulationState;
  private serverTargetSim: WorldSimulationState | null = null;
  private mySlot: 0 | 1 | 2 | 3 = 0;
  private reduceShake = false;
  private trauma = 0;

  // Input state
  private keysHeld = new Set<string>();
  private touchLeft = false;
  private touchRight = false;
  private touchFart = false;

  // Loop & timers
  private frameId = 0;
  private lastTimeMs = performance.now();
  private lastHudPushMs = 0;
  private toastText: string | null = null;
  private toastTimer = 0;
  private fartEmitAccum = [0, 0, 0, 0];
  private wakeEmitAccum = 0;
  private disposed = false;

  private resizeObserver: ResizeObserver;

  constructor(opts: RaftSceneOptions) {
    this.container = opts.container;
    this.sound = opts.sound;
    this.onHudUpdate = opts.onHudUpdate;
    this.onPowerBarUpdate = opts.onPowerBarUpdate;
    this.onInputSend = opts.onInputSend;

    this.isSoftwareGl = detectSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height);
    this.container.appendChild(this.renderer.domElement);

    // Scene & Tropical Sky/Horizon Fog
    this.scene = new THREE.Scene();
    const skyColor = 0x8be2ff;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, 55, 195);

    this.camera = new THREE.PerspectiveCamera(56, width / height, 0.2, 260);
    this.camera.position.set(6.5, 4.8, 10.5);
    _camLookSmooth.set(0, 1.3, 0);
    this.camera.lookAt(_camLookSmooth);

    // Mandatory procedural RoomEnvironment for PBR realism
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Warm/Cool 3-point outdoor lighting rig
    const hemi = new THREE.HemisphereLight(0xbbeeff, 0x1b4965, 0.85);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff1d0, 1.85);
    this.keyLight.position.set(16, 28, 18);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 90;
    const d = 24;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    const rimLight = new THREE.DirectionalLight(0x64dfdf, 0.45);
    rimLight.position.set(-14, 12, -20);
    this.scene.add(rimLight);

    // Build textures, course, raft, characters, and pooled particles
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    this.courseHandles = createCourseScene(this.scene, this.textures, COURSE_MAIN);
    this.particles = new ParticlePoolSystem(this.scene);

    const raftModels = createRaftModel(this.textures);
    this.raftGroup = raftModels.raftGroup;
    this.flagMesh = raftModels.flagMesh;
    this.scene.add(this.raftGroup);

    this.sim = createInitialSimState('solo');
    this.sim.phase = 'waiting';

    this.characterRigs = [
      createCharacterRig(0, this.sim.players[0].cosmetic, this.textures),
      createCharacterRig(1, this.sim.players[1].cosmetic, this.textures),
      createCharacterRig(2, this.sim.players[2].cosmetic, this.textures),
      createCharacterRig(3, this.sim.players[3].cosmetic, this.textures),
    ];
    for (const rig of this.characterRigs) {
      this.raftGroup.add(rig.root);
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Bind listeners
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.clearAllInputs);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.startLoop();
  }

  public setScreenState(next: GameScreenState): void {
    this.screenState = next;
    document.body.dataset.state = next;
    if (next === 'paused' || next === 'title' || next === 'gameover') {
      this.clearAllInputs();
      this.sound.stopAllFarts();
    }
    if (next === 'playing' && this.sim.mode === 'solo') {
      this.sim.phase = 'playing';
    } else if (next === 'paused' && this.sim.mode === 'solo') {
      this.sim.phase = 'paused';
    }
    this.pushHud(true);
  }

  public startSoloGame(playerName: string, cosmetic: PlayerCosmetic, fromUserGesture = true): void {
    if (fromUserGesture) {
      this.sound.unlock();
      this.sound.startMusic();
    }
    this.serverTargetSim = null;
    this.mySlot = 0;
    this.sim = createInitialSimState('solo', playerName, cosmetic);
    this.sim.phase = 'playing';
    this.toastText = 'انطلق نحو خط النهاية!';
    this.toastTimer = 1.8;
    this.setScreenState('playing');
  }

  public syncLocalCosmetic(cosmetic: PlayerCosmetic): void {
    this.sim.players[this.mySlot].cosmetic = { ...cosmetic };
  }

  public setOnlineRoomState(snapshot: RoomSnapshot, mySlot: 0 | 1 | 2 | 3): void {
    this.mySlot = mySlot;
    this.serverTargetSim = snapshot.sim;
    this.sim.mode = 'online';

    const prevCheckpoint = this.sim.checkpointIndex;
    const prevFalls = this.sim.falls;
    const prevPhase = this.sim.phase;

    // Copy player states & meta directly
    for (let i = 0; i < 4; i++) {
      const sp = snapshot.sim.players[i];
      const lp = this.sim.players[i];
      lp.id = sp.id;
      lp.name = sp.name;
      lp.connected = sp.connected;
      lp.isBot = sp.isBot;
      lp.ready = sp.ready;
      lp.cosmetic = sp.cosmetic;
      lp.moveDir = sp.moveDir;
      lp.farting = sp.farting;
      lp.fartHoldTime = sp.fartHoldTime;
      lp.fartPower = sp.fartPower;
      lp.releaseBounce = sp.releaseBounce;
      lp.stats = sp.stats;
    }

    this.sim.elapsedTime = snapshot.sim.elapsedTime;
    this.sim.checkpointIndex = snapshot.sim.checkpointIndex;
    this.sim.falls = snapshot.sim.falls;
    this.sim.progress = snapshot.sim.progress;
    this.sim.invulnTimer = snapshot.sim.invulnTimer;
    this.sim.phase = snapshot.sim.phase;

    // Snap immediately on respawn or start
    if (
      snapshot.sim.falls > prevFalls ||
      (prevPhase === 'waiting' && snapshot.sim.phase === 'playing')
    ) {
      this.sim.raft = { ...snapshot.sim.raft };
    }

    if (snapshot.sim.checkpointIndex > prevCheckpoint) {
      this.sound.playCheckpoint();
      this.toastText = `تم حفظ النقطة ${snapshot.sim.checkpointIndex}!`;
      this.toastTimer = 2.2;
    }

    if (snapshot.sim.events.length > 0) {
      this.processSimEvents(snapshot.sim.events);
    }

    if (snapshot.sim.phase === 'finished' && prevPhase !== 'finished') {
      this.setScreenState('gameover');
    } else if (snapshot.sim.phase === 'playing' && this.screenState === 'lobby') {
      this.sound.unlock();
      this.sound.startMusic();
      this.setScreenState('playing');
    }
  }

  public setReduceShake(reduce: boolean): void {
    this.reduceShake = reduce;
  }

  public setTouchInput(control: 'left' | 'right' | 'fart', pressed: boolean): void {
    this.sound.unlock();
    if (control === 'left') this.touchLeft = pressed;
    if (control === 'right') this.touchRight = pressed;
    if (control === 'fart') this.touchFart = pressed;
    this.applyLocalPlayerInput();
  }

  public clearAllInputs = (): void => {
    this.keysHeld.clear();
    this.touchLeft = false;
    this.touchRight = false;
    this.touchFart = false;
    this.applyLocalPlayerInput();
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.clearAllInputs();
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.screenState !== 'playing') return;

    // Prevent Space / Arrow keys from scrolling the page during gameplay
    if (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
    }

    if (!this.keysHeld.has(e.code)) {
      this.keysHeld.add(e.code);
      this.sound.unlock();
      this.applyLocalPlayerInput();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (this.keysHeld.has(e.code)) {
      this.keysHeld.delete(e.code);
      this.applyLocalPlayerInput();
    }
  };

  private applyLocalPlayerInput(): void {
    if (this.screenState !== 'playing') {
      const p = this.sim.players[this.mySlot];
      if (p) {
        p.moveDir = 0;
        p.farting = false;
      }
      if (this.sim.mode === 'online' && this.onInputSend) {
        this.onInputSend(0, false);
      }
      return;
    }

    const left = this.keysHeld.has('ArrowLeft') || this.keysHeld.has('KeyA') || this.touchLeft;
    const right = this.keysHeld.has('ArrowRight') || this.keysHeld.has('KeyD') || this.touchRight;
    const farting = this.keysHeld.has('Space') || this.touchFart;
    const moveDir: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;

    if (this.sim.mode === 'solo') {
      const p = this.sim.players[0];
      p.moveDir = moveDir;
      p.farting = farting;
    } else if (this.onInputSend) {
      this.onInputSend(moveDir, farting);
    }
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const rawDt = (now - this.lastTimeMs) / 1000;
      this.lastTimeMs = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      this.update(dt, now);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(tick, 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private processSimEvents(events: SimEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'collision') {
        this.sound.playCollision(ev.intensity);
        this.trauma = Math.min(1, this.trauma + ev.intensity * 0.5);
        this.particles.spawnSplash(ev.x, 0.3, ev.z, 10, 0.85);
      } else if (ev.type === 'bumper') {
        this.sound.playBumper();
        this.trauma = Math.min(1, this.trauma + 0.65);
        this.particles.spawnSplash(ev.x, 0.4, ev.z, 16, 1.2);
      } else if (ev.type === 'checkpoint') {
        this.sound.playCheckpoint();
        this.toastText = `✓ تم حفظ النقطة ${this.sim.checkpointIndex}!`;
        this.toastTimer = 2.2;
      } else if (ev.type === 'fall') {
        this.sound.playFall();
        this.sound.stopAllFarts();
        this.trauma = 0.85;
        this.particles.spawnSplash(ev.x, 0.2, ev.z, 26, 1.45);
        this.toastText = '💦 سقط الطوف! عودة لنقطة الحفظ...';
        this.toastTimer = 2.0;
      } else if (ev.type === 'finish') {
        this.sound.stopAllFarts();
        this.sound.playVictory();
      }
    }
  }

  private update(dt: number, nowMs: number): void {
    // 1. Advance simulation or interpolate server snapshot
    if (this.screenState === 'playing') {
      if (this.sim.mode === 'solo') {
        const events = stepSimulation(this.sim, dt, COURSE_MAIN);
        if (events.length > 0) this.processSimEvents(events);
        if (this.sim.phase === 'finished') {
          this.setScreenState('gameover');
        }
      } else if (this.serverTargetSim) {
        // Exponential interpolation toward authoritative server raft & character X
        const k = 1 - Math.exp(-16 * dt);
        const sr = this.serverTargetSim.raft;
        const lr = this.sim.raft;
        lr.x += (sr.x - lr.x) * k;
        lr.y += (sr.y - lr.y) * k;
        lr.z += (sr.z - lr.z) * k;
        lr.vx = sr.vx;
        lr.vz = sr.vz;
        // Shortest-angle yaw lerp
        let dyaw = sr.yaw - lr.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        lr.yaw += dyaw * k;
        lr.pitch += (sr.pitch - lr.pitch) * k;
        lr.roll += (sr.roll - lr.roll) * k;

        for (let i = 0; i < 4; i++) {
          this.sim.players[i].localX +=
            (this.serverTargetSim.players[i].localX - this.sim.players[i].localX) * k;
          this.sim.players[i].lateralVel = this.serverTargetSim.players[i].lateralVel;
        }
        this.sim.simTime += dt;
      }
    } else if (this.screenState === 'title' || this.screenState === 'lobby') {
      // Gentle idle animation on title & lobby screen
      this.sim.simTime += dt;
      this.sim.raft.y = Math.sin(this.sim.simTime * 1.9) * 0.11;
      this.sim.raft.roll = Math.sin(this.sim.simTime * 1.3) * 0.035;
      this.sim.raft.pitch = Math.cos(this.sim.simTime * 1.5) * 0.025;
    }

    const t = this.sim.simTime;
    this.courseHandles.waterUniforms.uTime.value = t;

    // 2. Animate moving gates, bumpers, boost pads, and checkpoint flags
    for (const gate of COURSE_MAIN.movingGates) {
      const mesh = this.courseHandles.movingGateMeshes.get(gate.id);
      if (mesh) {
        mesh.position.x = getMovingGateCenterX(gate, t);
        mesh.position.y = Math.sin(t * 2.5 + gate.phaseOffset) * 0.1;
      }
    }
    for (const b of this.courseHandles.bumperMeshes) {
      b.rotation.y += dt * 1.4;
      b.position.y = Math.sin(t * 3 + b.position.z) * 0.12;
    }
    for (const pad of this.courseHandles.boostMeshes) {
      pad.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
    }
    for (const [idx, flag] of this.courseHandles.checkpointFlags.entries()) {
      const captured = this.sim.checkpointIndex >= idx;
      const targetY = captured ? 5.3 : 2.2;
      flag.position.y += (targetY - flag.position.y) * Math.min(1, 6 * dt);
      const mat = flag.material as THREE.MeshStandardMaterial;
      mat.color.setHex(captured ? 0x06d6a0 : 0xff595e);
    }

    // 3. Apply Raft transform & spawn protection blink
    const raft = this.sim.raft;
    const waveBob = this.screenState === 'playing' && this.sim.phase !== 'falling'
      ? Math.sin(t * 3.1) * 0.07
      : 0;
    this.raftGroup.position.set(raft.x, raft.y + waveBob, raft.z);
    _raftEuler.set(raft.pitch, raft.yaw, raft.roll, 'YXZ');
    _raftQuat.setFromEuler(_raftEuler);
    this.raftGroup.quaternion.copy(_raftQuat);

    this.flagMesh.rotation.y = -Math.PI * 0.5 + Math.sin(t * 9) * 0.18;
    if (this.sim.invulnTimer > 0) {
      this.raftGroup.visible = Math.floor(this.sim.invulnTimer * 14) % 2 === 0;
    } else {
      this.raftGroup.visible = true;
    }

    // Move keyLight shadow frustum with raft so shadows stay sharp along the entire 320m course!
    this.keyLight.position.set(raft.x + 16, 28, raft.z + 18);
    this.keyLight.target.position.set(raft.x, 0, raft.z - 8);
    this.keyLight.target.updateMatrixWorld();

    // 4. Animate all 4 characters + emit pooled fart puffs + update continuous Web Audio fart synths
    const isFalling = this.sim.phase === 'falling';
    for (let i = 0; i < 4; i++) {
      const player = this.sim.players[i];
      const rig = this.characterRigs[i];
      animateCharacterRig(rig, player, t, isFalling, dt);

      if (this.screenState === 'playing') {
        this.sound.updateFartVoice(i, player.connected && player.farting && !isFalling, player.fartPower);
      }

      // Emit fart cloud particles from behind the character's butt!
      if (player.connected && player.fartPower > 0.05 && !isFalling) {
        const rate = 0.095 - player.fartPower * 0.068; // faster puffs at higher power
        this.fartEmitAccum[i] += dt;
        if (this.fartEmitAccum[i] >= rate) {
          this.fartEmitAccum[i] = 0;
          const zone = PLAYER_ZONES[player.slot];
          _worldPos.set(player.localX, 1.15, zone.zoneZ + 0.65);
          this.raftGroup.localToWorld(_worldPos);
          _backDir.set(Math.sin(raft.yaw), 0, Math.cos(raft.yaw));
          this.particles.spawnFartPuff(
            _worldPos.x,
            _worldPos.y,
            _worldPos.z,
            _backDir.x,
            _backDir.z,
            player.fartPower,
          );
        }
      }
    }

    // Wake foam behind moving raft
    const raftSpeed = Math.hypot(raft.vx, raft.vz);
    if (this.screenState === 'playing' && raftSpeed > 2.2 && !isFalling) {
      this.wakeEmitAccum += dt;
      if (this.wakeEmitAccum >= 0.09) {
        this.wakeEmitAccum = 0;
        _worldPos.set((Math.random() - 0.5) * 3.6, 0.15, 3.3);
        this.raftGroup.localToWorld(_worldPos);
        this.particles.spawnSplash(_worldPos.x, 0.1, _worldPos.z, 2, 0.45);
      }
    }

    this.particles.update(dt);

    // 5. Update 60fps direct power meter DOM callback (zero React re-render overhead!)
    const me = this.sim.players[this.mySlot];
    if (me) {
      this.onPowerBarUpdate(me.fartPower, me.farting);
    }

    // 6. Camera framing & exponential damping
    const dampK = 1 - Math.exp(-6.5 * dt);
    const lookDampK = 1 - Math.exp(-9.0 * dt);

    if (this.screenState === 'title' || this.screenState === 'lobby') {
      // Hero showcase orbit around the bobbing raft
      const orbitA = t * 0.28 + 0.45;
      _camTargetPos.set(
        raft.x + Math.sin(orbitA) * 9.5,
        4.6 + Math.sin(t * 0.6) * 0.35,
        raft.z + Math.cos(orbitA) * 9.5,
      );
      _camTargetLook.set(raft.x, 1.5, raft.z);
    } else {
      // Rear Chase Camera: elevated behind raft so upcoming obstacles + character faces/butts are visible
      const camYaw = raft.yaw * 0.45; // smooth follow without nauseating full-spin camera
      const distBack = 10.6 + Math.min(2.2, raftSpeed * 0.12);
      const heightUp = 6.9;
      _camTargetPos.set(
        raft.x + Math.sin(camYaw) * distBack,
        Math.max(2.5, raft.y + heightUp),
        raft.z + Math.cos(camYaw) * distBack,
      );
      _camTargetLook.set(
        raft.x - Math.sin(camYaw) * 6.5,
        Math.max(0.2, raft.y + 1.3),
        raft.z - Math.cos(camYaw) * 6.5,
      );
    }

    this.camera.position.lerp(_camTargetPos, dampK);
    _camLookSmooth.lerp(_camTargetLook, lookDampK);
    this.camera.lookAt(_camLookSmooth);

    // Decaying trauma camera shake
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
      if (!this.reduceShake) {
        const shake = this.trauma * this.trauma * 0.42;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
      }
    }

    // 7. Toast timer & throttled HUD snapshot (<= 10Hz)
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toastText = null;
        this.pushHud(true);
      }
    }

    if (nowMs - this.lastHudPushMs >= 100) {
      this.pushHud(false, nowMs);
    }
  }

  private pushHud(force: boolean, nowMs = performance.now()): void {
    if (!force && nowMs - this.lastHudPushMs < 100) return;
    this.lastHudPushMs = nowMs;
    const connectedPlayers = this.sim.players.filter((p) => p.connected).length;
    this.onHudUpdate({
      screen: this.screenState,
      mode: this.sim.mode,
      elapsedTime: this.sim.elapsedTime,
      falls: this.sim.falls,
      checkpointIndex: this.sim.checkpointIndex,
      totalCheckpoints: COURSE_MAIN.checkpoints.length - 1,
      progress: this.sim.progress,
      connectedPlayers,
      mySlot: this.mySlot,
      toastText: this.toastText,
      sim: this.sim,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.clearAllInputs);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    this.particles.dispose();
    this.courseHandles.dispose();
    this.textures.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
