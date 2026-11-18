import * as THREE from 'three';
import {
  COURSE_MAIN,
  PLAYER_ZONES,
  RAFT_LENGTH,
  RAFT_WIDTH,
} from '../shared/course.ts';
import { COSMETIC_COLOR_DEFS, RAFT_SKIN_PALETTES } from '../shared/cosmetics.ts';
import { getEmoteDefinition } from '../shared/social.ts';
import type {
  CourseDefinition,
  EmoteId,
  PickupKind,
  PlayerCosmetic,
  PlayerSimState,
  RaftSkinId,
} from '../shared/types.ts';
import type { ProceduralTextures } from './textures.ts';
import { buildCourseWorld, type CourseSceneHandles } from './worldBuilder.ts';

export type { CourseSceneHandles };

export const COSMETIC_COLORS = COSMETIC_COLOR_DEFS.map((c) => ({
  body: c.bodyNum,
  shorts: c.shortsNum,
  cheek: c.cheekNum,
}));

export interface CharacterRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  torso: THREE.Mesh;
  buttGroup: THREE.Group;
  leftCheek: THREE.Mesh;
  rightCheek: THREE.Mesh;
  headGroup: THREE.Group;
  leftEye: THREE.Group;
  rightEye: THREE.Group;
  leftPupil: THREE.Mesh;
  rightPupil: THREE.Mesh;
  mouth: THREE.Mesh;
  leftCheekFlush: THREE.Mesh;
  rightCheekFlush: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  hatAnchor: THREE.Group;
  propellerBlade: THREE.Group | null;
  glassesAnchor: THREE.Group;
  outfitAnchor: THREE.Group;
  contactShadow: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  shortsMat: THREE.MeshStandardMaterial;
  currentCosmeticKey: string;
  emoteBadgeMesh: THREE.Mesh;
  emoteBadgeMat: THREE.MeshBasicMaterial;
  emoteBadgeCanvas: HTMLCanvasElement | null;
  emoteBadgeCtx: CanvasRenderingContext2D | null;
  emoteBadgeTex: THREE.CanvasTexture | null;
  lastEmoteBadgeKey: string;
  headBaseY: number;
}

export interface RaftModelHandles {
  raftGroup: THREE.Group;
  flagMesh: THREE.Mesh;
  deckPlanks: THREE.Mesh[];
  deckMat: THREE.MeshStandardMaterial;
  logMat: THREE.MeshStandardMaterial;
  dividerMat: THREE.MeshStandardMaterial;
  flagMat: THREE.MeshStandardMaterial;
  lanternMat: THREE.MeshStandardMaterial;
  foamMat: THREE.MeshBasicMaterial;
  baseDeckColor: THREE.Color;
  currentRaftSkin: RaftSkinId;
  shieldDome: THREE.Mesh;
  magnetRing: THREE.Mesh;
  anchorWinchGroup: THREE.Group;
  anchorChain: THREE.Mesh;
  anchorIronGroup: THREE.Group;
}

export function createRaftModel(textures: ProceduralTextures): RaftModelHandles {
  const raftGroup = new THREE.Group();

  const logMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.woodMap,
    bumpMap: textures.woodBump,
    bumpScale: 0.08,
    roughness: 0.82,
    metalness: 0.04,
  });
  const endGrainMat = new THREE.MeshStandardMaterial({
    color: 0xe6b88a,
    roughness: 0.9,
    metalness: 0.0,
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0xf0c99d,
    map: textures.woodMap,
    bumpMap: textures.woodBump,
    bumpScale: 0.05,
    roughness: 0.72,
    metalness: 0.05,
  });
  const ropeMat = new THREE.MeshStandardMaterial({
    color: 0xe9d8a6,
    roughness: 0.92,
    metalness: 0.0,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xffb703,
    roughness: 0.28,
    metalness: 0.82,
  });

  // 1. Six buoyant side-by-side timber logs
  const logGeo = new THREE.CylinderGeometry(0.42, 0.42, RAFT_LENGTH, 14);
  logGeo.rotateX(Math.PI / 2);
  const logCount = 6;
  const logSpacing = (RAFT_WIDTH - 0.85) / (logCount - 1);

  for (let i = 0; i < logCount; i++) {
    const x = -((logCount - 1) * logSpacing) / 2 + i * logSpacing;
    const logMesh = new THREE.Mesh(logGeo, [logMat, endGrainMat, endGrainMat]);
    logMesh.position.set(x, 0.12, 0);
    logMesh.castShadow = true;
    logMesh.receiveShadow = true;
    raftGroup.add(logMesh);
  }

  // 2. Four cross-plank deck beams (tracked for hull damage visuals)
  const deckPlanks: THREE.Mesh[] = [];
  const plankGeo = new THREE.BoxGeometry(RAFT_WIDTH + 0.1, 0.18, 1.25);
  const plankZs = [-2.15, -0.72, 0.72, 2.15];
  for (const pz of plankZs) {
    const plank = new THREE.Mesh(plankGeo, deckMat);
    plank.position.set(0, 0.54, pz);
    plank.castShadow = true;
    plank.receiveShadow = true;
    raftGroup.add(plank);
    deckPlanks.push(plank);
  }

  // 3. Subtle quarter-zone inlay strips
  const dividerMat = new THREE.MeshStandardMaterial({
    color: 0x7f4f24,
    roughness: 0.85,
    metalness: 0.05,
  });
  const centerDivZ = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, RAFT_LENGTH - 0.6), dividerMat);
  centerDivZ.position.set(0, 0.65, 0);
  raftGroup.add(centerDivZ);

  const centerDivX = new THREE.Mesh(new THREE.BoxGeometry(RAFT_WIDTH - 0.3, 0.06, 0.14), dividerMat);
  centerDivX.position.set(0, 0.65, 0.2);
  raftGroup.add(centerDivX);

  // 4. Corner rope lashings
  const ropeGeo = new THREE.TorusGeometry(0.28, 0.08, 8, 16);
  const corners: [number, number][] = [
    [-RAFT_WIDTH * 0.44, -RAFT_LENGTH * 0.4],
    [RAFT_WIDTH * 0.44, -RAFT_LENGTH * 0.4],
    [-RAFT_WIDTH * 0.44, RAFT_LENGTH * 0.4],
    [RAFT_WIDTH * 0.44, RAFT_LENGTH * 0.4],
  ];
  for (const [cx, cz] of corners) {
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    rope.position.set(cx, 0.48, cz);
    rope.rotation.y = Math.PI / 4;
    raftGroup.add(rope);
  }

  // 5. Bow Mast + Warm Lantern + Fluttering Pennant Flag
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.3, 10), dividerMat);
  mast.position.set(0, 1.72, -RAFT_LENGTH * 0.46);
  mast.castShadow = true;
  raftGroup.add(mast);

  const lanternCap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 8), brassMat);
  lanternCap.position.set(0, 2.55, -RAFT_LENGTH * 0.43);
  raftGroup.add(lanternCap);

  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffe066,
    emissive: 0xffaa00,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  const lanternBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8),
    lanternMat,
  );
  lanternBulb.position.set(0, 2.35, -RAFT_LENGTH * 0.43);
  raftGroup.add(lanternBulb);

  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(1.1, 0.22);
  flagShape.lineTo(0, 0.48);
  flagShape.closePath();
  const flagGeo = new THREE.ExtrudeGeometry(flagShape, { depth: 0.04, bevelEnabled: false });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff595e, roughness: 0.6 });
  const flagMesh = new THREE.Mesh(flagGeo, flagMat);
  flagMesh.position.set(0.06, 2.42, -RAFT_LENGTH * 0.46);
  flagMesh.rotation.y = -Math.PI * 0.5;
  raftGroup.add(flagMesh);

  // 6. Soft water foam wake ring underneath the raft
  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xe0fbfc,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const foamRing = new THREE.Mesh(
    new THREE.RingGeometry(2.7, 3.25, 28),
    foamMat,
  );
  foamRing.rotation.x = -Math.PI / 2;
  foamRing.position.y = 0.03;
  raftGroup.add(foamRing);

  // 7. Realistic Cast-Iron Bow Anchor Winch + Chain + Ship Anchor (GAME-03)
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x26323f,
    metalness: 0.84,
    roughness: 0.34,
  });
  const chainMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    metalness: 0.88,
    roughness: 0.28,
  });

  const anchorWinchGroup = new THREE.Group();
  anchorWinchGroup.position.set(-RAFT_WIDTH * 0.45, 0.72, -RAFT_LENGTH * 0.34);

  const winchDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.48, 12), ironMat);
  winchDrum.rotation.z = Math.PI / 2;
  const winchBracket = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.24), dividerMat);
  winchBracket.position.y = -0.1;
  const winchCrank = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 8, 14), brassMat);
  winchCrank.rotation.y = Math.PI / 2;
  winchCrank.position.x = 0.32;
  anchorWinchGroup.add(winchDrum, winchBracket, winchCrank);

  const anchorChain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), chainMat);
  anchorChain.position.set(-0.38, -0.5, 0);
  anchorWinchGroup.add(anchorChain);

  const anchorIronGroup = new THREE.Group();
  anchorIronGroup.position.set(-0.38, -0.35, 0);
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.9, 10), ironMat);
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 14), brassMat);
  crownRing.position.y = 0.48;
  const stockBar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8), ironMat);
  stockBar.rotation.z = Math.PI / 2;
  stockBar.position.y = 0.28;
  const flukeCurve = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.06, 8, 16, Math.PI * 0.95),
    ironMat,
  );
  flukeCurve.rotation.z = Math.PI * 1.025;
  flukeCurve.position.y = -0.22;
  const leftTip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 4), ironMat);
  leftTip.position.set(-0.34, -0.05, 0);
  leftTip.rotation.z = -0.45;
  const rightTip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 4), ironMat);
  rightTip.position.set(0.34, -0.05, 0);
  rightTip.rotation.z = 0.45;
  anchorIronGroup.add(shank, crownRing, stockBar, flukeCurve, leftTip, rightTip);
  anchorWinchGroup.add(anchorIronGroup);
  raftGroup.add(anchorWinchGroup);

  // 8. Protective Energy Shield Hex Dome (GAME-02)
  const shieldDome = new THREE.Mesh(
    new THREE.SphereGeometry(3.85, 24, 18),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      map: textures.shieldHexMap,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  shieldDome.scale.set(1.0, 0.72, 1.05);
  shieldDome.position.y = 1.0;
  shieldDome.visible = false;
  raftGroup.add(shieldDome);

  // 9. Magnet Aura Pulse Ring (GAME-01)
  const magnetRing = new THREE.Mesh(
    new THREE.TorusGeometry(3.6, 0.1, 10, 32),
    new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.65,
    }),
  );
  magnetRing.rotation.x = Math.PI / 2;
  magnetRing.position.y = 0.32;
  magnetRing.visible = false;
  raftGroup.add(magnetRing);

  return {
    raftGroup,
    flagMesh,
    deckPlanks,
    deckMat,
    logMat,
    dividerMat,
    flagMat,
    lanternMat,
    foamMat,
    baseDeckColor: new THREE.Color(RAFT_SKIN_PALETTES.classic_oak.deckHex),
    currentRaftSkin: 'classic_oak',
    shieldDome,
    magnetRing,
    anchorWinchGroup,
    anchorChain,
    anchorIronGroup,
  };
}

export function applyRaftSkin(handles: RaftModelHandles, skinId: RaftSkinId | undefined): void {
  const target: RaftSkinId = skinId && skinId in RAFT_SKIN_PALETTES ? skinId : 'classic_oak';
  if (handles.currentRaftSkin === target) return;
  handles.currentRaftSkin = target;
  const pal = RAFT_SKIN_PALETTES[target];
  handles.logMat.color.setHex(pal.logHex);
  handles.baseDeckColor.setHex(pal.deckHex);
  handles.deckMat.color.setHex(pal.deckHex);
  handles.dividerMat.color.setHex(pal.dividerHex);
  handles.flagMat.color.setHex(pal.flagHex);
  handles.lanternMat.color.setHex(pal.lanternHex);
  handles.lanternMat.emissive.setHex(pal.lanternHex);
  handles.foamMat.color.setHex(pal.foamHex);
}

/**
 * Ultra-detailed, multi-part realistic 3D pickup models (GAME-01).
 * Cans look like authentic ribbed metallic tin cans with rolled rims, recessed lids, pull-tabs,
 * and crisp Arabic wrap labels; tools look like realistic workshop/maritime hardware.
 */
export function createPickupModel(kind: PickupKind, textures: ProceduralTextures): THREE.Group {
  const root = new THREE.Group();

  // Shared floating water halo & sparkle aura underneath so pickups read cleanly at speed
  const haloColorMap: Record<PickupKind, number> = {
    lentil_can: 0xf59e0b,
    fava_can: 0x10b981,
    bean_can: 0xef4444,
    shield: 0x38bdf8,
    magnet: 0xf43f5e,
    shockwave: 0xfacc15,
    repair_kit: 0x22c55e,
    mystery_crate: 0xc084fc,
  };
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.28, 24),
    new THREE.MeshBasicMaterial({
      color: haloColorMap[kind],
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.08;
  root.add(halo);

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.92,
    roughness: 0.16,
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.85,
    roughness: 0.28,
  });

  if (kind === 'lentil_can' || kind === 'fava_can' || kind === 'bean_can') {
    // Realistic Tilted Tin Can with Double-Seam Rims, Embossed Ribs, Recessed Lid & Pull-Tab!
    const canGroup = new THREE.Group();
    canGroup.position.y = 1.15;
    canGroup.rotation.z = 0.16;

    const r = 0.56;
    const h = 1.24;

    // Tin body with high-res wrap-around Arabic label texture
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.canLabels[kind],
      roughness: 0.28,
      metalness: 0.25,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28, 1, true), bodyMat);
    body.castShadow = true;
    canGroup.add(body);

    // Rolled metallic top & bottom double-seam rims
    const rimGeo = new THREE.TorusGeometry(r, 0.042, 10, 28);
    const topRim = new THREE.Mesh(rimGeo, chromeMat);
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = h * 0.5;
    const botRim = new THREE.Mesh(rimGeo, chromeMat);
    botRim.rotation.x = Math.PI / 2;
    botRim.position.y = -h * 0.5;
    canGroup.add(topRim, botRim);

    // Recessed stamped metallic lid + concentric ring + bottom plate
    const lidPlate = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.02, r - 0.02, 0.04, 24), chromeMat);
    lidPlate.position.y = h * 0.5 - 0.025;
    const lidGroove = new THREE.Mesh(new THREE.TorusGeometry(r * 0.68, 0.018, 8, 24), darkMetalMat);
    lidGroove.rotation.x = Math.PI / 2;
    lidGroove.position.y = h * 0.5 + 0.005;
    const bottomPlate = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.02, r - 0.02, 0.04, 24), chromeMat);
    bottomPlate.position.y = -h * 0.5 + 0.02;
    canGroup.add(lidPlate, lidGroove, bottomPlate);

    // Authentic silver pull-tab opener on lid!
    const pullRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 8, 14), chromeMat);
    pullRing.rotation.x = Math.PI / 2;
    pullRing.position.set(0.12, h * 0.5 + 0.03, 0);
    const pullRivet = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8), darkMetalMat);
    pullRivet.position.set(-0.04, h * 0.5 + 0.02, 0);
    const pullLever = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.1), chromeMat);
    pullLever.position.set(0.04, h * 0.5 + 0.025, 0);
    canGroup.add(pullRing, pullRivet, pullLever);

    // Subtle embossed metallic rib bands near top & bottom
    for (const ry of [h * 0.36, -h * 0.36]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(r + 0.008, 0.014, 6, 28), chromeMat);
      rib.rotation.x = Math.PI / 2;
      rib.position.y = ry;
      canGroup.add(rib);
    }

    root.add(canGroup);
    return root;
  }

  if (kind === 'shield') {
    // Realistic Maritime Hexagonal Forcefield Emitter & Energy Shield Crest
    const grp = new THREE.Group();
    grp.position.y = 1.15;

    const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.66, 0.2, 8), darkMetalMat);
    basePlate.position.y = -0.35;
    const brassCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.52, 0.16, 8),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.85, roughness: 0.25 }),
    );
    brassCollar.position.y = -0.2;

    const coreCrystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32, 0),
      new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x0284c7,
        emissiveIntensity: 1.3,
        roughness: 0.12,
        metalness: 0.2,
      }),
    );
    coreCrystal.position.y = 0.2;

    const crestShape = new THREE.Shape();
    crestShape.moveTo(0, -0.55);
    crestShape.lineTo(0.48, -0.18);
    crestShape.lineTo(0.42, 0.45);
    crestShape.lineTo(0, 0.58);
    crestShape.lineTo(-0.42, 0.45);
    crestShape.lineTo(-0.48, -0.18);
    crestShape.closePath();

    const shieldCrest = new THREE.Mesh(
      new THREE.ExtrudeGeometry(crestShape, {
        depth: 0.09,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.03,
        bevelSegments: 2,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.78,
        roughness: 0.15,
        metalness: 0.35,
      }),
    );
    shieldCrest.position.set(0, 0.26, -0.045);

    const frameRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.045, 8, 24), chromeMat);
    frameRing.position.y = 0.22;

    grp.add(basePlate, brassCollar, coreCrystal, shieldCrest, frameRing);
    root.add(grp);
    return root;
  }

  if (kind === 'magnet') {
    // Realistic U-Shaped Red Horseshoe Magnet with Brushed Chrome Pole Caps & Copper Coils
    const grp = new THREE.Group();
    grp.position.y = 1.18;
    grp.rotation.z = 0.2;

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.42, 0.36, 0),
      new THREE.Vector3(-0.42, -0.18, 0),
      new THREE.Vector3(-0.26, -0.48, 0),
      new THREE.Vector3(0, -0.58, 0),
      new THREE.Vector3(0.26, -0.48, 0),
      new THREE.Vector3(0.42, -0.18, 0),
      new THREE.Vector3(0.42, 0.36, 0),
    ]);
    const body = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, 0.17, 12, false),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.32, metalness: 0.45 }),
    );
    body.castShadow = true;

    const tipGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.26, 14);
    const leftTip = new THREE.Mesh(tipGeo, chromeMat);
    leftTip.position.set(-0.42, 0.48, 0);
    const rightTip = new THREE.Mesh(tipGeo, chromeMat);
    rightTip.position.set(0.42, 0.48, 0);

    const coilMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.85, roughness: 0.25 });
    const coilGeo = new THREE.CylinderGeometry(0.195, 0.195, 0.08, 14);
    const leftCoil = new THREE.Mesh(coilGeo, coilMat);
    leftCoil.position.set(-0.42, 0.28, 0);
    const rightCoil = new THREE.Mesh(coilGeo, coilMat);
    rightCoil.position.set(0.42, 0.28, 0);

    const sparkArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.025, 6, 16, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc }),
    );
    sparkArc.position.set(0, 0.56, 0);

    grp.add(body, leftTip, rightTip, leftCoil, rightCoil, sparkArc);
    root.add(grp);
    return root;
  }

  if (kind === 'shockwave') {
    // Naval Sonic Pressure Sphere with Brass Collar & Radial Acoustic Horns
    const grp = new THREE.Group();
    grp.position.y = 1.15;

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 18, 14),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        metalness: 0.85,
        roughness: 0.24,
      }),
    );
    core.castShadow = true;
    grp.add(core);

    const hazardBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.48, 0.22, 18),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.hazardStripeMap, roughness: 0.35 }),
    );
    grp.add(hazardBand);

    const hornMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.82, roughness: 0.22 });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.38, 12), hornMat);
      horn.position.set(Math.cos(a) * 0.54, 0, Math.sin(a) * 0.54);
      horn.rotation.z = -Math.cos(a) * (Math.PI / 2);
      horn.rotation.x = Math.sin(a) * (Math.PI / 2);
      grp.add(horn);
    }

    const pulseRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.76, 0.035, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xfef08a }),
    );
    pulseRing.rotation.x = Math.PI / 2;
    grp.add(pulseRing);

    root.add(grp);
    return root;
  }

  if (kind === 'repair_kit') {
    // Detailed Red Steel Mechanic's Toolbox + Chrome Open-End Wrench + Spare Timber Plank!
    const grp = new THREE.Group();
    grp.position.y = 1.05;
    grp.rotation.y = 0.35;

    const redSteelMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c,
      metalness: 0.55,
      roughness: 0.32,
    });
    const whiteCrossMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const emeraldCrossMat = new THREE.MeshStandardMaterial({
      color: 0x16a34a,
      emissive: 0x15803d,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    });

    const boxBase = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.52, 0.64), redSteelMat);
    boxBase.castShadow = true;
    const boxLid = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.68), redSteelMat);
    boxLid.position.y = 0.32;

    // Chrome clasp latches
    const latchGeo = new THREE.BoxGeometry(0.11, 0.14, 0.05);
    const latchL = new THREE.Mesh(latchGeo, chromeMat);
    latchL.position.set(-0.3, 0.24, 0.35);
    const latchR = new THREE.Mesh(latchGeo, chromeMat);
    latchR.position.set(0.3, 0.24, 0.35);

    // Top steel carry handle
    const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.44, 8), chromeMat);
    handleBar.rotation.z = Math.PI / 2;
    handleBar.position.y = 0.52;
    const handlePostL = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), darkMetalMat);
    handlePostL.position.set(-0.2, 0.45, 0);
    const handlePostR = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), darkMetalMat);
    handlePostR.position.set(0.2, 0.45, 0);

    // Front emblem badge + emerald repair cross
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16), whiteCrossMat);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, 0, 0.33);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.05), emeraldCrossMat);
    crossH.position.set(0, 0, 0.34);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.05), emeraldCrossMat);
    crossV.position.set(0, 0, 0.34);

    // Gleaming Chrome Open-End Mechanic's Wrench resting diagonally atop the lid
    const wrenchGroup = new THREE.Group();
    wrenchGroup.position.set(0.04, 0.44, 0.16);
    wrenchGroup.rotation.set(0.1, 0.35, -0.15);
    const wrenchShaft = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.055, 0.11), chromeMat);
    const headL = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 8, 12, Math.PI * 1.45), chromeMat);
    headL.rotation.x = Math.PI / 2;
    headL.rotation.z = 0.7;
    headL.position.x = -0.4;
    const headR = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.038, 8, 12, Math.PI * 1.45), chromeMat);
    headR.rotation.x = Math.PI / 2;
    headR.rotation.z = -2.4;
    headR.position.x = 0.4;
    wrenchGroup.add(wrenchShaft, headL, headR);

    // Spare wooden hull plank strapped under box
    const sparePlank = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.1, 0.42),
      new THREE.MeshStandardMaterial({ color: 0xf0c99d, map: textures.woodMap, roughness: 0.75 }),
    );
    sparePlank.position.set(0, -0.32, 0);

    grp.add(
      boxBase,
      boxLid,
      latchL,
      latchR,
      handleBar,
      handlePostL,
      handlePostR,
      badge,
      crossH,
      crossV,
      wrenchGroup,
      sparePlank,
    );
    root.add(grp);
    return root;
  }

  // Mystery Crate ('mystery_crate'): Wooden supply crate with dark corner trim + iron studs
  const crateGroup = new THREE.Group();
  crateGroup.position.y = 1.12;
  const crateBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.98, 0.98, 0.98),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.crateMap,
      roughness: 0.65,
      metalness: 0.1,
    }),
  );
  crateBox.castShadow = true;
  const crateFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.04, 1.04, 1.04),
    new THREE.MeshStandardMaterial({ color: 0x7c2d12, wireframe: true }),
  );
  crateGroup.add(crateBox, crateFrame);
  root.add(crateGroup);
  return root;
}

function buildCosmeticsForRig(rig: CharacterRig, cosmetic: PlayerCosmetic): void {
  const outfit = cosmetic.outfit ?? 'classic';
  const key = `${cosmetic.hat}:${cosmetic.glasses}:${cosmetic.colorIndex}:${outfit}`;
  if (rig.currentCosmeticKey === key) return;
  rig.currentCosmeticKey = key;

  const palette = COSMETIC_COLORS[cosmetic.colorIndex % COSMETIC_COLORS.length];
  rig.bodyMat.color.setHex(palette.body);
  rig.shortsMat.color.setHex(palette.shorts);

  // Clear old hats, glasses & outfit accessories cleanly
  while (rig.hatAnchor.children.length > 0) {
    rig.hatAnchor.remove(rig.hatAnchor.children[0]);
  }
  while (rig.glassesAnchor.children.length > 0) {
    rig.glassesAnchor.remove(rig.glassesAnchor.children[0]);
  }
  while (rig.outfitAnchor.children.length > 0) {
    rig.outfitAnchor.remove(rig.outfitAnchor.children[0]);
  }
  rig.propellerBlade = null;

  // Build Hat
  if (cosmetic.hat === 'captain') {
    const capCrown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.36, 0.24, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }),
    );
    capCrown.position.y = 0.14;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.06, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.3 }),
    );
    visor.position.set(0, 0.03, -0.26);
    const goldBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.37, 0.37, 0.07, 14),
      new THREE.MeshStandardMaterial({ color: 0xffb703, metalness: 0.75, roughness: 0.25 }),
    );
    goldBand.position.y = 0.06;
    rig.hatAnchor.add(capCrown, visor, goldBand);
  } else if (cosmetic.hat === 'crown') {
    const crownMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      metalness: 0.85,
      roughness: 0.2,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.32, 0.2, 8), crownMat);
    base.position.y = 0.1;
    rig.hatAnchor.add(base);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), crownMat);
      spike.position.set(Math.cos(a) * 0.28, 0.26, Math.sin(a) * 0.28);
      rig.hatAnchor.add(spike);
    }
  } else if (cosmetic.hat === 'propeller') {
    const beanie = new THREE.Mesh(
      new THREE.SphereGeometry(0.39, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0xff595e, roughness: 0.55 }),
    );
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0xffca3a, metalness: 0.6, roughness: 0.3 }),
    );
    stem.position.y = 0.42;
    const bladeGroup = new THREE.Group();
    bladeGroup.position.y = 0.52;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.03, 0.11),
      new THREE.MeshStandardMaterial({ color: 0x00bbf9, roughness: 0.3 }),
    );
    bladeGroup.add(blade);
    rig.propellerBlade = bladeGroup;
    rig.hatAnchor.add(beanie, stem, bladeGroup);
  } else if (cosmetic.hat === 'pirate') {
    const feltMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.72 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.75, roughness: 0.25 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.06, 3), feltMat);
    brim.position.y = 0.04;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), feltMat);
    dome.position.y = 0.04;
    const emblem = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), trimMat);
    emblem.position.set(0, 0.18, -0.34);
    rig.hatAnchor.add(brim, dome, emblem);
  } else if (cosmetic.hat === 'viking') {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.78, roughness: 0.3 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.4 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.41, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), steelMat);
    const leftHorn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.36, 8), hornMat);
    leftHorn.position.set(-0.42, 0.18, 0);
    leftHorn.rotation.z = 0.75;
    const rightHorn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.36, 8), hornMat);
    rightHorn.position.set(0.42, 0.18, 0);
    rightHorn.rotation.z = -0.75;
    rig.hatAnchor.add(dome, leftHorn, rightHorn);
  } else if (cosmetic.hat === 'snorkel') {
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x06d6a0, roughness: 0.45 });
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.35 });
    const headband = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 14), bandMat);
    headband.position.y = 0.05;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.58, 10), tubeMat);
    tube.position.set(0.42, 0.18, -0.05);
    rig.hatAnchor.add(headband, tube);
  } else if (cosmetic.hat === 'storm_hood') {
    const hoodMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.25,
      roughness: 0.5,
    });
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.44, 14), hoodMat);
    hood.position.y = 0.18;
    const lightningGem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09, 0),
      new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x38bdf8, emissiveIntensity: 0.9 }),
    );
    lightningGem.position.set(0, 0.12, -0.36);
    rig.hatAnchor.add(hood, lightningGem);
  }

  // Build Glasses (mounted on face front -Z)
  if (cosmetic.glasses === 'shades') {
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.12,
      metalness: 0.7,
    });
    const leftLens = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.06), darkMat);
    leftLens.position.set(-0.18, 0, -0.02);
    const rightLens = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.06), darkMat);
    rightLens.position.set(0.18, 0, -0.02);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), darkMat);
    rig.glassesAnchor.add(leftLens, rightLens, bridge);
  } else if (cosmetic.glasses === 'nerd') {
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35 });
    const leftRim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.028, 8, 16), rimMat);
    leftRim.position.set(-0.17, 0, -0.02);
    const rightRim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.028, 8, 16), rimMat);
    rightRim.position.set(0.17, 0, -0.02);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), rimMat);
    rig.glassesAnchor.add(leftRim, rightRim, bridge);
  } else if (cosmetic.glasses === 'monocle') {
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.85, roughness: 0.2 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.028, 8, 16), goldMat);
    rim.position.set(0.17, 0, -0.02);
    const pane = new THREE.Mesh(new THREE.CircleGeometry(0.13, 14), glassMat);
    pane.position.set(0.17, 0, -0.02);
    rig.glassesAnchor.add(rim, pane);
  } else if (cosmetic.glasses === 'cyber_visor') {
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.75,
      roughness: 0.12,
      metalness: 0.65,
    });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.17, 0.08), visorMat);
    visor.position.set(0, 0, -0.02);
    rig.glassesAnchor.add(visor);
  } else if (cosmetic.glasses === 'heart_shades') {
    const pinkMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.25, metalness: 0.3 });
    const leftHeart = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), pinkMat);
    leftHeart.scale.set(1.1, 0.9, 0.45);
    leftHeart.position.set(-0.17, 0, -0.02);
    const rightHeart = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), pinkMat);
    rightHeart.scale.set(1.1, 0.9, 0.45);
    rightHeart.position.set(0.17, 0, -0.02);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.04), pinkMat);
    rig.glassesAnchor.add(leftHeart, rightHeart, bridge);
  }

  // Build Outfit Accessories on Torso
  if (outfit === 'captain_coat') {
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd13b, metalness: 0.8, roughness: 0.25 });
    const leftEpaulet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.22), goldMat);
    leftEpaulet.position.set(-0.48, 0.96, 0);
    const rightEpaulet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.22), goldMat);
    rightEpaulet.position.set(0.48, 0.96, 0);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.08), goldMat);
    buckle.position.set(0, 0.56, -0.52);
    rig.outfitAnchor.add(leftEpaulet, rightEpaulet, buckle);
  } else if (outfit === 'diver_suit') {
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x06d6a0, metalness: 0.5, roughness: 0.35 });
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.48, 12), tankMat);
    tank.position.set(0, 0.8, 0.48);
    const harness = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.04, 8, 18), strapMat);
    harness.rotation.x = Math.PI / 2;
    harness.position.y = 0.72;
    rig.outfitAnchor.add(tank, harness);
  } else if (outfit === 'volcanic_armor') {
    const obsidianMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.7, roughness: 0.35 });
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 0.9,
    });
    const leftPauldron = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), obsidianMat);
    leftPauldron.position.set(-0.5, 0.95, 0);
    const rightPauldron = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), obsidianMat);
    rightPauldron.position.set(0.5, 0.95, 0);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), emberMat);
    core.position.set(0, 0.74, -0.52);
    rig.outfitAnchor.add(leftPauldron, rightPauldron, core);
  } else if (outfit === 'royal_robe') {
    const robeMat = new THREE.MeshStandardMaterial({ color: 0x7e22ce, roughness: 0.65 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.85, roughness: 0.2 });
    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.7, 0.1), robeMat);
    cape.position.set(0, 0.66, 0.46);
    cape.rotation.x = 0.16;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.06, 8, 16), goldMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.02;
    rig.outfitAnchor.add(cape, collar);
  }
}

export function createCharacterRig(
  slot: 0 | 1 | 2 | 3,
  cosmetic: PlayerCosmetic,
  textures: ProceduralTextures,
): CharacterRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const palette = COSMETIC_COLORS[cosmetic.colorIndex % COSMETIC_COLORS.length];
  const bodyMat = new THREE.MeshStandardMaterial({
    color: palette.body,
    roughness: 0.58,
    metalness: 0.05,
  });
  const shortsMat = new THREE.MeshStandardMaterial({
    color: palette.shorts,
    roughness: 0.75,
    metalness: 0.05,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xffd6ba,
    roughness: 0.5,
    metalness: 0.02,
  });
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.15,
    metalness: 0.0,
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.1,
    metalness: 0.1,
  });
  const flushMat = new THREE.MeshStandardMaterial({
    color: 0xff4d6d,
    roughness: 0.6,
    transparent: true,
    opacity: 0.65,
  });

  // Distinct cartoon proportions per character slot
  const proportions = [
    { torsoScale: [1.08, 0.92, 1.05], headY: 1.24, headScale: 1.05 }, // Farfoosh (chubby)
    { torsoScale: [0.85, 1.18, 0.9], headY: 1.42, headScale: 0.96 },  // Zabout (tall)
    { torsoScale: [1.18, 0.86, 1.1], headY: 1.18, headScale: 1.08 },  // Batboot (stout)
    { torsoScale: [0.92, 1.04, 0.94], headY: 1.32, headScale: 1.0 },  // Lulita (peppy)
  ][slot];

  // 1. Contact shadow disc on raft deck
  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 18),
    new THREE.MeshBasicMaterial({
      map: textures.contactShadowMap,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.02;
  root.add(contactShadow);

  // 2. Legs
  const legGeo = new THREE.CapsuleGeometry(0.13, 0.24, 4, 8);
  const leftLeg = new THREE.Mesh(legGeo, bodyMat);
  leftLeg.position.set(-0.22, 0.25, 0);
  leftLeg.castShadow = true;
  const rightLeg = new THREE.Mesh(legGeo, bodyMat);
  rightLeg.position.set(0.22, 0.25, 0);
  rightLeg.castShadow = true;
  bodyPivot.add(leftLeg, rightLeg);

  // 3. Torso + Cartoon Shorts Belt
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 14), bodyMat);
  torso.scale.set(
    proportions.torsoScale[0],
    proportions.torsoScale[1],
    proportions.torsoScale[2],
  );
  torso.position.y = 0.72;
  torso.castShadow = true;
  bodyPivot.add(torso);

  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.49 * proportions.torsoScale[0], 0.51 * proportions.torsoScale[0], 0.26, 16),
    shortsMat,
  );
  belt.position.y = 0.54;
  bodyPivot.add(belt);

  // 4. Hilarious Jiggling Comic Butt (+Z faces toward the rear chase camera!)
  const buttGroup = new THREE.Group();
  buttGroup.position.set(0, 0.55, 0.46 * proportions.torsoScale[2]);
  const cheekGeo = new THREE.SphereGeometry(0.25, 14, 12);
  const leftCheek = new THREE.Mesh(cheekGeo, shortsMat);
  leftCheek.position.set(-0.18, 0, 0);
  leftCheek.scale.set(1.0, 1.0, 1.18);
  leftCheek.castShadow = true;
  const rightCheek = new THREE.Mesh(cheekGeo, shortsMat);
  rightCheek.position.set(0.18, 0, 0);
  rightCheek.scale.set(1.0, 1.0, 1.18);
  rightCheek.castShadow = true;
  buttGroup.add(leftCheek, rightCheek);
  bodyPivot.add(buttGroup);

  // 5. Arms
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.34, 4, 8);
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.52 * proportions.torsoScale[0], 0.88, 0);
  const leftArmMesh = new THREE.Mesh(armGeo, skinMat);
  leftArmMesh.position.y = -0.18;
  leftArmMesh.rotation.z = 0.35;
  leftArm.add(leftArmMesh);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.52 * proportions.torsoScale[0], 0.88, 0);
  const rightArmMesh = new THREE.Mesh(armGeo, skinMat);
  rightArmMesh.position.y = -0.18;
  rightArmMesh.rotation.z = -0.35;
  rightArm.add(rightArmMesh);
  bodyPivot.add(leftArm, rightArm);

  // 6. Expressive Head with Bulging Googly Eyes
  // Notice: Head faces forward (-Z) by default, and turns back/over-shoulder when farting
  // so players see BOTH the face expressions AND the wiggling butt from the chase camera!
  const headGroup = new THREE.Group();
  headGroup.position.set(0, proportions.headY, 0);
  headGroup.scale.setScalar(proportions.headScale);

  const headSphere = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 16), skinMat);
  headSphere.castShadow = true;
  headGroup.add(headSphere);

  // Bulging Googly Eyes (placed on -Z face front, protruding strongly)
  const eyeGeo = new THREE.SphereGeometry(0.145, 14, 12);
  const pupilGeo = new THREE.SphereGeometry(0.065, 10, 8);

  const leftEye = new THREE.Group();
  leftEye.position.set(-0.16, 0.08, -0.34);
  const leftEyeball = new THREE.Mesh(eyeGeo, whiteMat);
  const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
  leftPupil.position.z = -0.11;
  leftEye.add(leftEyeball, leftPupil);

  const rightEye = new THREE.Group();
  rightEye.position.set(0.16, 0.08, -0.34);
  const rightEyeball = new THREE.Mesh(eyeGeo, whiteMat);
  const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
  rightPupil.position.z = -0.11;
  rightEye.add(rightEyeball, rightPupil);

  // Expressive Mouth & Cheek Flush
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.075, 0.025, 8, 14),
    pupilMat,
  );
  mouth.position.set(0, -0.15, -0.38);

  const flushGeo = new THREE.SphereGeometry(0.085, 10, 8);
  const leftCheekFlush = new THREE.Mesh(flushGeo, flushMat);
  leftCheekFlush.position.set(-0.27, -0.06, -0.29);
  leftCheekFlush.scale.set(1.1, 0.75, 0.5);
  const rightCheekFlush = new THREE.Mesh(flushGeo, flushMat);
  rightCheekFlush.position.set(0.27, -0.06, -0.29);
  rightCheekFlush.scale.set(1.1, 0.75, 0.5);

  const hatAnchor = new THREE.Group();
  hatAnchor.position.set(0, 0.34, 0);

  const glassesAnchor = new THREE.Group();
  glassesAnchor.position.set(0, 0.08, -0.44);

  headGroup.add(
    leftEye,
    rightEye,
    mouth,
    leftCheekFlush,
    rightCheekFlush,
    hatAnchor,
    glassesAnchor,
  );
  bodyPivot.add(headGroup);

  // 7. Floating CanvasTexture Emote Badge above head (zero per-frame allocations)
  const emoteBadgeCanvas =
    typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let emoteBadgeCtx: CanvasRenderingContext2D | null = null;
  let emoteBadgeTex: THREE.CanvasTexture | null = null;
  if (emoteBadgeCanvas) {
    emoteBadgeCanvas.width = 192;
    emoteBadgeCanvas.height = 192;
    emoteBadgeCtx = emoteBadgeCanvas.getContext('2d');
    emoteBadgeTex = new THREE.CanvasTexture(emoteBadgeCanvas);
    emoteBadgeTex.colorSpace = THREE.SRGBColorSpace;
  }
  const emoteBadgeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: emoteBadgeTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const emoteBadgeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), emoteBadgeMat);
  emoteBadgeMesh.position.set(0, proportions.headY + 1.08, 0);
  emoteBadgeMesh.visible = false;
  bodyPivot.add(emoteBadgeMesh);

  const outfitAnchor = new THREE.Group();
  bodyPivot.add(outfitAnchor);

  const rig: CharacterRig = {
    root,
    bodyPivot,
    torso,
    buttGroup,
    leftCheek,
    rightCheek,
    headGroup,
    leftEye,
    rightEye,
    leftPupil,
    rightPupil,
    mouth,
    leftCheekFlush,
    rightCheekFlush,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    hatAnchor,
    propellerBlade: null,
    glassesAnchor,
    outfitAnchor,
    contactShadow,
    bodyMat,
    shortsMat,
    currentCosmeticKey: '',
    emoteBadgeMesh,
    emoteBadgeMat,
    emoteBadgeCanvas,
    emoteBadgeCtx,
    emoteBadgeTex,
    lastEmoteBadgeKey: '',
    headBaseY: proportions.headY,
  };

  buildCosmeticsForRig(rig, cosmetic);
  return rig;
}

function updateEmoteBadge(rig: CharacterRig, emoteId: EmoteId): void {
  if (rig.lastEmoteBadgeKey === emoteId) return;
  rig.lastEmoteBadgeKey = emoteId;
  const ctx = rig.emoteBadgeCtx;
  const canvas = rig.emoteBadgeCanvas;
  const tex = rig.emoteBadgeTex;
  if (!ctx || !canvas || !tex) return;

  const def = getEmoteDefinition(emoteId);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Comic speech bubble circle + pointer tail
  ctx.fillStyle = '#fff8e7';
  ctx.strokeStyle = '#14222f';
  ctx.lineWidth = 8;

  ctx.beginPath();
  ctx.arc(w / 2, h / 2 - 12, 74, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Golden inner halo
  ctx.strokeStyle = '#ffd13b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2 - 12, 65, 0, Math.PI * 2);
  ctx.stroke();

  // Little downward speech pointer
  ctx.fillStyle = '#fff8e7';
  ctx.strokeStyle = '#14222f';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 14, h / 2 + 54);
  ctx.lineTo(w / 2, h / 2 + 78);
  ctx.lineTo(w / 2 + 14, h / 2 + 54);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Emoji icon
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '68px sans-serif';
  ctx.fillStyle = '#14222f';
  ctx.fillText(def.icon, w / 2, h / 2 - 22);

  // Arabic label pill inside bubble bottom
  ctx.font = 'bold 24px Cairo, Tajawal, sans-serif';
  ctx.fillStyle = '#0f2740';
  ctx.fillText(def.labelAr, w / 2, h / 2 + 34);

  tex.needsUpdate = true;
}

export function animateCharacterRig(
  rig: CharacterRig,
  player: PlayerSimState,
  simTime: number,
  isFalling: boolean,
  dt: number,
): void {
  buildCosmeticsForRig(rig, player.cosmetic);

  rig.root.visible = player.connected;
  if (!player.connected) return;

  const zone = PLAYER_ZONES[player.slot];
  rig.root.position.set(player.localX, 0.64, zone.zoneZ);

  const power = player.fartPower;
  const bounce = player.releaseBounce;

  // Propeller spin if equipped
  if (rig.propellerBlade) {
    rig.propellerBlade.rotation.y += dt * (4 + power * 24);
  }

  if (isFalling) {
    // Comical flailing fall pose
    rig.emoteBadgeMesh.visible = false;
    rig.bodyPivot.position.x = 0;
    rig.bodyPivot.rotation.set(Math.sin(simTime * 16) * 0.4, simTime * 6, Math.cos(simTime * 14) * 0.4);
    rig.leftArm.rotation.x = -2.4 + Math.sin(simTime * 22) * 0.6;
    rig.rightArm.rotation.x = -2.4 - Math.sin(simTime * 22) * 0.6;
    rig.leftEye.scale.setScalar(1.45);
    rig.rightEye.scale.setScalar(1.45);
    rig.mouth.scale.set(1.5, 1.8, 1);
    return;
  }

  // Idle breathing + lateral walk lean & gait
  const idleBob = Math.sin(simTime * 3.1 + player.slot * 1.4) * 0.035;
  const isMoving = Math.abs(player.lateralVel) > 0.15;
  const walkCycle = isMoving ? Math.sin(simTime * 18) : 0;

  // Squash & stretch when farting or rebounding on release
  const strainSquash = power * 0.14;
  const releaseStretch = bounce * 0.22;
  rig.bodyPivot.scale.set(
    1 + strainSquash * 0.8 - releaseStretch * 0.5,
    1 - strainSquash + releaseStretch,
    1 + strainSquash * 0.8 - releaseStretch * 0.5,
  );
  rig.bodyPivot.position.x = 0;
  rig.bodyPivot.position.y = idleBob + Math.abs(walkCycle) * 0.07;

  // Lean into lateral movement + forward strain pitch when farting
  const targetLeanZ = -player.lateralVel * 0.09;
  const targetLeanX = -power * 0.22;
  rig.bodyPivot.rotation.z += (targetLeanZ - rig.bodyPivot.rotation.z) * Math.min(1, 14 * dt);
  rig.bodyPivot.rotation.x += (targetLeanX - rig.bodyPivot.rotation.x) * Math.min(1, 12 * dt);

  // Legs & arms
  rig.leftLeg.rotation.x = walkCycle * 0.55;
  rig.rightLeg.rotation.x = -walkCycle * 0.55;
  rig.leftArm.rotation.z = 0.2 + power * 0.85 + Math.sin(simTime * 24) * power * 0.22;
  rig.rightArm.rotation.z = -0.2 - power * 0.85 - Math.sin(simTime * 24) * power * 0.22;
  rig.leftArm.rotation.x = -walkCycle * 0.45;
  rig.rightArm.rotation.x = walkCycle * 0.45;

  // 1. Wiggling Cartoon Butt (speed & amplitude scale with fartPower!)
  if (power > 0.01) {
    const wiggleSpeed = 16 + power * 36;
    const wiggleAmp = 0.05 + power * 0.14;
    const swell = 1 + power * 0.34;
    rig.buttGroup.rotation.z = Math.sin(simTime * wiggleSpeed) * wiggleAmp * 2.2;
    rig.buttGroup.position.z = 0.48 + power * 0.14;
    rig.leftCheek.position.x = -0.18 - power * 0.06;
    rig.rightCheek.position.x = 0.18 + power * 0.06;
    rig.leftCheek.scale.setScalar(swell + Math.sin(simTime * wiggleSpeed) * 0.08 * power);
    rig.rightCheek.scale.setScalar(swell - Math.sin(simTime * wiggleSpeed) * 0.08 * power);
  } else {
    rig.buttGroup.rotation.z *= 0.85;
    rig.buttGroup.position.z += (0.46 - rig.buttGroup.position.z) * 0.2;
    const rebound = 1 + bounce * 0.16;
    rig.leftCheek.position.x = -0.18;
    rig.rightCheek.position.x = 0.18;
    rig.leftCheek.scale.set(rebound, rebound, 1.18 * rebound);
    rig.rightCheek.scale.set(rebound, rebound, 1.18 * rebound);
  }

  // 2. Expressive Head Turning Back Over Shoulder + Bulging Googly Eyes
  // Turning head sideways/backward (+Y ~ 1.75 rad on fart) lets the rear camera clearly see the bulging eyes!
  const lookBackAngle = player.slot % 2 === 0 ? -1.85 : 1.85;
  const idleLookAngle = (player.slot % 2 === 0 ? -0.45 : 0.45) + Math.sin(simTime * 1.4 + player.slot) * 0.22;
  const targetHeadY = idleLookAngle + (lookBackAngle - idleLookAngle) * Math.min(1, power * 1.8);
  rig.headGroup.rotation.y += (targetHeadY - rig.headGroup.rotation.y) * Math.min(1, 10 * dt);
  rig.headGroup.rotation.x = power * 0.28 + Math.sin(simTime * 34) * power * 0.06;

  // Bulging eyes pop out & tremble as fartPower climbs!
  const eyeBulgeScale = 1 + power * 0.58 + bounce * 0.15;
  const eyePopZ = -0.34 - power * 0.14;
  const eyeJitter = power > 0.2 ? Math.sin(simTime * 48) * 0.025 * power : 0;
  rig.leftEye.scale.setScalar(eyeBulgeScale);
  rig.rightEye.scale.setScalar(eyeBulgeScale * (1 + Math.sin(simTime * 22) * power * 0.08));
  rig.leftEye.position.set(-0.16 + eyeJitter, 0.08 + eyeJitter, eyePopZ);
  rig.rightEye.position.set(0.16 - eyeJitter, 0.08 - eyeJitter, eyePopZ);

  // Pupils shrink slightly at peak strain for classic cartoon shock
  const pupilScale = 1 - power * 0.25;
  rig.leftPupil.scale.setScalar(pupilScale);
  rig.rightPupil.scale.setScalar(pupilScale);

  // Cheeks flush bright pink-red & mouth widens
  const flushScale = 0.8 + power * 0.85;
  rig.leftCheekFlush.scale.set(flushScale * 1.1, flushScale * 0.75, 0.5);
  rig.rightCheekFlush.scale.set(flushScale * 1.1, flushScale * 0.75, 0.5);
  rig.mouth.scale.set(0.75 + power * 0.7, 0.65 + power * 1.1, 1);

  // 3. Expressive 3D Character Emote Overlay (ONLINE-11)
  const emote = player.activeEmote ?? null;
  if (emote) {
    updateEmoteBadge(rig, emote.id);
    rig.emoteBadgeMesh.visible = true;
    rig.emoteBadgeMesh.position.y = rig.headBaseY + 1.08 + Math.sin(simTime * 7.5) * 0.08;
    const badgePop = 0.96 + Math.sin(simTime * 11) * 0.06;
    rig.emoteBadgeMesh.scale.setScalar(badgePop);

    if (emote.id === 'laugh') {
      rig.bodyPivot.position.y += Math.abs(Math.sin(simTime * 15)) * 0.15;
      rig.bodyPivot.rotation.x = -0.18 + Math.sin(simTime * 15) * 0.1;
      rig.headGroup.rotation.x = 0.42 + Math.sin(simTime * 18) * 0.12;
      rig.leftArm.rotation.z = 0.5 + Math.sin(simTime * 16) * 0.22;
      rig.rightArm.rotation.z = -0.5 - Math.sin(simTime * 16) * 0.22;
      rig.mouth.scale.set(1.45, 1.55, 1);
    } else if (emote.id === 'fear') {
      rig.bodyPivot.position.x = Math.sin(simTime * 55) * 0.055;
      rig.bodyPivot.scale.set(1.06, 0.88, 1.06);
      rig.leftArm.rotation.x = -2.2 + Math.sin(simTime * 30) * 0.15;
      rig.rightArm.rotation.x = -2.2 - Math.sin(simTime * 30) * 0.15;
      rig.leftEye.scale.setScalar(1.55);
      rig.rightEye.scale.setScalar(1.55);
      rig.leftPupil.scale.setScalar(0.55);
      rig.rightPupil.scale.setScalar(0.55);
      rig.mouth.scale.set(1.3, 1.85, 1);
    } else if (emote.id === 'celebrate') {
      rig.bodyPivot.position.y += Math.abs(Math.sin(simTime * 10)) * 0.26;
      rig.leftArm.rotation.z = 2.45 + Math.sin(simTime * 14) * 0.28;
      rig.rightArm.rotation.z = -2.45 - Math.sin(simTime * 14) * 0.28;
      rig.headGroup.rotation.y = Math.sin(simTime * 8) * 0.4;
      rig.mouth.scale.set(1.35, 1.35, 1);
    } else if (emote.id === 'dance') {
      rig.bodyPivot.rotation.z = Math.sin(simTime * 9) * 0.22;
      rig.bodyPivot.position.y += Math.abs(Math.sin(simTime * 12)) * 0.14;
      rig.leftArm.rotation.z = 1.55 + Math.sin(simTime * 10) * 0.75;
      rig.rightArm.rotation.z = -1.55 + Math.sin(simTime * 10) * 0.75;
      rig.buttGroup.rotation.z = Math.sin(simTime * 12) * 0.34;
    } else if (emote.id === 'point_left') {
      rig.headGroup.rotation.y = -1.25;
      rig.leftArm.rotation.z = 1.45 + Math.sin(simTime * 14) * 0.12;
      rig.leftArm.rotation.x = -0.3;
      rig.rightArm.rotation.z = -0.15;
    } else if (emote.id === 'point_right') {
      rig.headGroup.rotation.y = 1.25;
      rig.rightArm.rotation.z = -1.45 - Math.sin(simTime * 14) * 0.12;
      rig.rightArm.rotation.x = -0.3;
      rig.leftArm.rotation.z = 0.15;
    }
  } else {
    rig.emoteBadgeMesh.visible = false;
  }
}

export function createGhostRaftModel(): THREE.Group {
  const ghostGroup = new THREE.Group();
  const holoMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.34,
    wireframe: false,
    depthWrite: false,
  });
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xbae6fd,
    transparent: true,
    opacity: 0.65,
    wireframe: true,
    depthWrite: false,
  });

  const hullGeo = new THREE.BoxGeometry(RAFT_WIDTH, 0.72, RAFT_LENGTH);
  const hull = new THREE.Mesh(hullGeo, holoMat);
  hull.position.y = 0.38;
  const hullWire = new THREE.Mesh(hullGeo, wireMat);
  hullWire.position.y = 0.38;

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 2.4, 8), wireMat);
  mast.position.set(0, 1.8, -RAFT_LENGTH * 0.42);

  const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), holoMat);
  pennant.rotation.z = Math.PI / 2;
  pennant.position.set(0.45, 2.7, -RAFT_LENGTH * 0.42);

  ghostGroup.add(hull, hullWire, mast, pennant);
  return ghostGroup;
}

export function createTreasureModel(kind: 'coin' | 'chest'): THREE.Group {
  const root = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0xb45309,
    emissiveIntensity: 0.38,
    metalness: 0.88,
    roughness: 0.18,
  });

  if (kind === 'coin') {
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.92, 20),
      new THREE.MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.08;

    const coinDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 20), goldMat);
    coinDisc.rotation.x = Math.PI / 2;
    coinDisc.position.y = 1.08;
    coinDisc.castShadow = true;

    const innerRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.05, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xfef08a, metalness: 0.9, roughness: 0.14 }),
    );
    innerRim.position.set(0, 1.08, 0.07);

    const innerRimBack = innerRim.clone();
    innerRimBack.position.z = -0.07;

    root.add(halo, coinDisc, innerRim, innerRimBack);
    return root;
  }

  // Jeweled Pirate Treasure Chest
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.05, 1.42, 24),
    new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.08;

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x78350f,
    roughness: 0.72,
    metalness: 0.08,
  });

  const grp = new THREE.Group();
  grp.position.y = 0.9;

  const chestBody = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.74, 0.88), woodMat);
  chestBody.castShadow = true;
  const chestLid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.44, 1.32, 12, 1, false, 0, Math.PI),
    woodMat,
  );
  chestLid.rotation.z = Math.PI / 2;
  chestLid.position.y = 0.37;

  const bandGeo = new THREE.BoxGeometry(0.14, 0.82, 0.94);
  const bandL = new THREE.Mesh(bandGeo, goldMat);
  bandL.position.x = -0.44;
  const bandR = new THREE.Mesh(bandGeo, goldMat);
  bandR.position.x = 0.44;

  const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.08), goldMat);
  lockPlate.position.set(0, 0.28, 0.46);

  const rubyGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22, 0),
    new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xe11d48,
      emissiveIntensity: 0.9,
      roughness: 0.12,
    }),
  );
  rubyGem.position.set(0, 0.75, 0);

  grp.add(chestBody, chestLid, bandL, bandR, lockPlate, rubyGem);
  root.add(halo, grp);
  return root;
}

export function createCourseScene(
  scene: THREE.Scene,
  textures: ProceduralTextures,
  course: CourseDefinition = COURSE_MAIN,
): CourseSceneHandles {
  return buildCourseWorld(scene, textures, course);
}
