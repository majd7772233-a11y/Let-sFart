import * as THREE from 'three';
import {
  COURSE_MAIN,
  PLAYER_ZONES,
  RAFT_LENGTH,
  RAFT_WIDTH,
  getChannelBoundsAtZ,
} from '../shared/course.ts';
import type { CourseDefinition, PlayerCosmetic, PlayerSimState } from '../shared/types.ts';
import type { ProceduralTextures } from './textures.ts';

export const COSMETIC_COLORS = [
  { body: 0xff595e, shorts: 0x1d3557, cheek: 0xff8fa3 }, // 0: Coral Red
  { body: 0x1982c4, shorts: 0xffca3a, cheek: 0x64dfdf }, // 1: Teal Blue
  { body: 0xffca3a, shorts: 0x6a4c93, cheek: 0xff9f1c }, // 2: Sunny Amber
  { body: 0x9b5de5, shorts: 0x00bbf9, cheek: 0xf15bb5 }, // 3: Berry Violet
];

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
  contactShadow: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  shortsMat: THREE.MeshStandardMaterial;
  currentCosmeticKey: string;
}

export interface CourseSceneHandles {
  waterMat: THREE.MeshStandardMaterial;
  waterUniforms: { uTime: { value: number } };
  movingGateMeshes: Map<string, THREE.Group>;
  bumperMeshes: THREE.Group[];
  checkpointFlags: Map<number, THREE.Mesh>;
  checkpointRings: Map<number, THREE.Mesh>;
  boostMeshes: THREE.Mesh[];
  dispose: () => void;
}

export function createRaftModel(textures: ProceduralTextures): {
  raftGroup: THREE.Group;
  flagMesh: THREE.Mesh;
} {
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

  // 2. Four cross-plank deck beams (slight Y offset >= 0.02 so no Z-fighting)
  const plankGeo = new THREE.BoxGeometry(RAFT_WIDTH + 0.1, 0.18, 1.25);
  const plankZs = [-2.15, -0.72, 0.72, 2.15];
  for (const pz of plankZs) {
    const plank = new THREE.Mesh(plankGeo, deckMat);
    plank.position.set(0, 0.54, pz);
    plank.castShadow = true;
    plank.receiveShadow = true;
    raftGroup.add(plank);
  }

  // 3. Subtle quarter-zone inlay strips (clean wooden dividers without ugly lines)
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

  const lanternBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffaa00,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    }),
  );
  lanternBulb.position.set(0, 2.35, -RAFT_LENGTH * 0.43);
  raftGroup.add(lanternBulb);

  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(1.1, 0.22);
  flagShape.lineTo(0, 0.48);
  flagShape.closePath();
  const flagGeo = new THREE.ExtrudeGeometry(flagShape, { depth: 0.04, bevelEnabled: false });
  const flagMesh = new THREE.Mesh(
    flagGeo,
    new THREE.MeshStandardMaterial({ color: 0xff595e, roughness: 0.6 }),
  );
  flagMesh.position.set(0.06, 2.42, -RAFT_LENGTH * 0.46);
  flagMesh.rotation.y = -Math.PI * 0.5;
  raftGroup.add(flagMesh);

  // 6. Soft water foam wake ring underneath the raft
  const foamRing = new THREE.Mesh(
    new THREE.RingGeometry(2.7, 3.25, 28),
    new THREE.MeshBasicMaterial({
      color: 0xe0fbfc,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  foamRing.rotation.x = -Math.PI / 2;
  foamRing.position.y = 0.03;
  raftGroup.add(foamRing);

  return { raftGroup, flagMesh };
}

function buildCosmeticsForRig(rig: CharacterRig, cosmetic: PlayerCosmetic): void {
  const key = `${cosmetic.hat}:${cosmetic.glasses}:${cosmetic.colorIndex}`;
  if (rig.currentCosmeticKey === key) return;
  rig.currentCosmeticKey = key;

  const palette = COSMETIC_COLORS[cosmetic.colorIndex % COSMETIC_COLORS.length];
  rig.bodyMat.color.setHex(palette.body);
  rig.shortsMat.color.setHex(palette.shorts);

  // Clear old hats & glasses cleanly
  while (rig.hatAnchor.children.length > 0) {
    rig.hatAnchor.remove(rig.hatAnchor.children[0]);
  }
  while (rig.glassesAnchor.children.length > 0) {
    rig.glassesAnchor.remove(rig.glassesAnchor.children[0]);
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
    contactShadow,
    bodyMat,
    shortsMat,
    currentCosmeticKey: '',
  };

  buildCosmeticsForRig(rig, cosmetic);
  return rig;
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
}

export function createCourseScene(
  scene: THREE.Scene,
  textures: ProceduralTextures,
  course: CourseDefinition = COURSE_MAIN,
): CourseSceneHandles {
  const disposables: { dispose: () => void }[] = [];

  // 1. Dynamic Sunlit Tropical Ocean Water with custom wave & foam shader extension
  const waterUniforms = { uTime: { value: 0 } };
  const waterGeo = new THREE.PlaneGeometry(340, 460, 64, 96);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1694c8,
    roughness: 0.22,
    metalness: 0.15,
  });
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         varying vec3 vWorldPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float w1 = sin(position.x * 0.22 + uTime * 2.1) * cos(position.z * 0.18 + uTime * 1.6);
         float w2 = sin((position.x + position.z) * 0.35 - uTime * 2.7);
         transformed.y += w1 * 0.14 + w2 * 0.08;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         varying vec3 vWorldPos;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float band = sin(vWorldPos.x * 0.45 + vWorldPos.z * 0.3 + uTime * 2.4)
                    * cos(vWorldPos.z * 0.55 - uTime * 1.9);
         float foam = smoothstep(0.68, 0.96, band);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.76, 0.96, 1.0), foam * 0.38);`,
      );
  };
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set(0, -0.1, -165);
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);
  disposables.push(waterGeo, waterMat);

  // 2. Canyon Banks / Faceted Tropical Cliffs + Instanced Palm Trees
  const bankRockGeo = new THREE.CylinderGeometry(0.68, 1.05, 1.0, 7);
  const bankRockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.02,
    flatShading: true,
  });
  const bankInstances: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; color: number }[] = [];
  const palmPositions: { x: number; y: number; z: number; scale: number; rotY: number }[] = [];

  for (let z = 14; z >= -340; z -= 6.5) {
    const bounds = getChannelBoundsAtZ(z, course.waypoints);
    const isOpenDanger =
      (z <= -102 && z >= -142) ||
      (z <= -206 && z >= -252) ||
      (z <= -280 && z >= -312);

    if (isOpenDanger) {
      // Open waterfall edge: place warning foam buoys instead of cliff walls
      bankInstances.push({
        x: bounds.centerX - bounds.halfWidth - 1.1,
        y: 0.15,
        z,
        sx: 0.55,
        sy: 0.85,
        sz: 0.55,
        ry: z * 0.2,
        color: 0xff595e,
      });
      bankInstances.push({
        x: bounds.centerX + bounds.halfWidth + 1.1,
        y: 0.15,
        z,
        sx: 0.55,
        sy: 0.85,
        sz: 0.55,
        ry: z * 0.2,
        color: 0xff595e,
      });
      continue;
    }

    // Walled rocky cliff ledges on left and right + scenic lush terraces
    for (const side of [-1, 1]) {
      const rx = bounds.centerX + side * (bounds.halfWidth + 2.8 + (Math.abs(Math.sin(z * 0.4)) * 1.4));
      const cliffH = 2.6 + Math.abs(Math.sin(z * 0.5)) * 2.2;
      bankInstances.push({
        x: rx,
        y: cliffH * 0.45,
        z,
        sx: 3.0 + (Math.abs(Math.cos(z * 0.3)) * 1.2),
        sy: cliffH,
        sz: 3.7,
        ry: z * 0.37 + side,
        color: side === -1 ? 0xd4a373 : 0xcfa06e,
      });

      const ridgeH = 5.5 + Math.abs(Math.sin(z * 0.17)) * 4.5;
      bankInstances.push({
        x: rx + side * 8.5,
        y: ridgeH * 0.45,
        z: z + 2,
        sx: 6.2,
        sy: ridgeH,
        sz: 5.8,
        ry: z * 0.21,
        color: 0x588157,
      });

      // Add tropical palm trees atop cliffs periodically
      if (Math.abs(Math.round(z)) % 19 === (side > 0 ? 3 : 11)) {
        palmPositions.push({
          x: rx + side * 1.2,
          y: cliffH * 0.85,
          z,
          scale: 0.85 + Math.abs(Math.sin(z)) * 0.4,
          rotY: z * 0.7 + side,
        });
      }
    }
  }

  const bankMesh = new THREE.InstancedMesh(bankRockGeo, bankRockMat, bankInstances.length);
  bankMesh.castShadow = true;
  bankMesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  bankInstances.forEach((b, idx) => {
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, b.ry, 0);
    dummy.scale.set(b.sx, b.sy, b.sz);
    dummy.updateMatrix();
    bankMesh.setMatrixAt(idx, dummy.matrix);
    bankMesh.setColorAt(idx, c.setHex(b.color));
  });
  bankMesh.instanceMatrix.needsUpdate = true;
  if (bankMesh.instanceColor) bankMesh.instanceColor.needsUpdate = true;
  bankMesh.computeBoundingSphere();
  scene.add(bankMesh);
  disposables.push(bankRockGeo, bankRockMat);

  // Instanced Tropical Palm Trunks & Frond Canopies
  if (palmPositions.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 3.6, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.9, flatShading: true });
    const canopyGeo = new THREE.ConeGeometry(2.1, 1.4, 7);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x40916c, roughness: 0.72, flatShading: true });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPositions.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, palmPositions.length);
    trunks.castShadow = true;
    canopies.castShadow = true;

    palmPositions.forEach((p, idx) => {
      dummy.position.set(p.x, p.y + 1.6 * p.scale, p.z);
      dummy.rotation.set(0.08, p.rotY, 0.1);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(p.x + 0.15 * p.scale, p.y + 3.4 * p.scale, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      canopies.setMatrixAt(idx, dummy.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingSphere();
    canopies.computeBoundingSphere();
    scene.add(trunks, canopies);
    disposables.push(trunkGeo, trunkMat, canopyGeo, canopyMat);
  }

  // 3. Static Obstacles (Rocks, Pillars, Buoys, Bouncy Bumpers)
  const bumperMeshes: THREE.Group[] = [];
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6c757d, roughness: 0.85, metalness: 0.05 });
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.woodMap,
    bumpMap: textures.woodBump,
    bumpScale: 0.06,
    roughness: 0.72,
  });
  const buoyRedMat = new THREE.MeshStandardMaterial({ color: 0xff595e, roughness: 0.35, metalness: 0.1 });
  const buoyWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfff8e7, roughness: 0.4 });
  const bumperBodyMat = new THREE.MeshStandardMaterial({
    color: 0xf72585,
    roughness: 0.3,
    metalness: 0.15,
    emissive: 0x550028,
    emissiveIntensity: 0.35,
  });
  const bumperRingMat = new THREE.MeshStandardMaterial({
    color: 0xffbe0b,
    roughness: 0.25,
    metalness: 0.5,
  });
  disposables.push(rockMat, pillarMat, buoyRedMat, buoyWhiteMat, bumperBodyMat, bumperRingMat);

  for (const obs of course.staticObstacles) {
    const grp = new THREE.Group();
    grp.position.set(obs.x, 0, obs.z);

    if (obs.kind === 'rock') {
      const base = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.radius, 1), rockMat);
      base.scale.set(1, 0.85, 1);
      base.position.y = obs.radius * 0.45;
      base.castShadow = true;
      base.receiveShadow = true;
      const cap = new THREE.Mesh(
        new THREE.DodecahedronGeometry(obs.radius * 0.55, 0),
        new THREE.MeshStandardMaterial({ color: 0x52b788, roughness: 0.8 }),
      );
      cap.position.set(0.2, obs.radius * 0.95, 0.1);
      grp.add(base, cap);
    } else if (obs.kind === 'pillar') {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(obs.radius * 0.82, obs.radius, obs.height, 12),
        pillarMat,
      );
      post.position.y = obs.height * 0.42;
      post.castShadow = true;
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(obs.radius * 0.88, obs.radius * 0.88, 0.55, 12),
        buoyRedMat,
      );
      band.position.y = obs.height * 0.65;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(obs.radius * 0.9, 0.8, 12), buoyWhiteMat);
      cap.position.y = obs.height * 0.9;
      grp.add(post, band, cap);
    } else if (obs.kind === 'buoy') {
      const floatRing = new THREE.Mesh(new THREE.TorusGeometry(obs.radius * 0.72, 0.35, 10, 18), buoyRedMat);
      floatRing.rotation.x = Math.PI / 2;
      floatRing.position.y = 0.25;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, obs.height, 10), buoyWhiteMat);
      mast.position.y = obs.height * 0.5;
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffaa00, emissiveIntensity: 0.9 }),
      );
      beacon.position.y = obs.height;
      grp.add(floatRing, mast, beacon);
    } else if (obs.kind === 'bumper') {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(obs.radius * 0.85, 16, 12), bumperBodyMat);
      sphere.position.y = 0.65;
      sphere.castShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(obs.radius * 0.92, 0.22, 10, 20), bumperRingMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.65;
      const topCap = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 10), bumperRingMat);
      topCap.position.y = 1.65;
      grp.add(sphere, ring, topCap);
      bumperMeshes.push(grp);
    }

    scene.add(grp);
  }

  // 4. Moving Gates (Composite striped log barrier + support buoys)
  const movingGateMeshes = new Map<string, THREE.Group>();
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.hazardStripeMap,
    roughness: 0.45,
    metalness: 0.1,
  });
  disposables.push(stripeMat);

  for (const gate of course.movingGates) {
    const grp = new THREE.Group();
    grp.position.set(gate.baseX, 0, gate.z);

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(gate.halfWidth * 2, 1.35, gate.depth),
      stripeMat,
    );
    beam.position.y = 0.72;
    beam.castShadow = true;
    beam.receiveShadow = true;

    const endPostL = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 2.2, 12), buoyRedMat);
    endPostL.position.set(-gate.halfWidth, 0.95, 0);
    const endPostR = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 2.2, 12), buoyRedMat);
    endPostR.position.set(gate.halfWidth, 0.95, 0);

    grp.add(beam, endPostL, endPostR);
    scene.add(grp);
    movingGateMeshes.set(gate.id, grp);
  }

  // 5. Boost Current Pads
  const boostMeshes: THREE.Mesh[] = [];
  const boostMat = new THREE.MeshStandardMaterial({
    color: 0x00f5d4,
    emissive: 0x00bbf9,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity: 0.65,
    roughness: 0.2,
  });
  disposables.push(boostMat);

  for (const pad of course.boostPads) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(pad.radius * 0.45, pad.radius, 24), boostMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pad.x, 0.04, pad.z);
    scene.add(ring);
    boostMeshes.push(ring);
  }

  // 6. Checkpoints (Arch + Flag + Glowing Water Ring)
  const checkpointFlags = new Map<number, THREE.Mesh>();
  const checkpointRings = new Map<number, THREE.Mesh>();

  for (const cp of course.checkpoints) {
    if (cp.index === 0) continue; // Start bay doesn't need a checkpoint gate

    const cpGroup = new THREE.Group();
    cpGroup.position.set(cp.x, 0, cp.z);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xffaa00,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.7,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(cp.radius * 0.85, cp.radius, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    cpGroup.add(ring);
    checkpointRings.set(cp.index, ring);

    // Side Checkpoint Island Tower with Flag
    const poleX = cp.x + 8.2;
    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.7, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: 0xe9c46a, roughness: 0.88 }),
    );
    island.position.set(8.2, 0.3, 0);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 6.2, 10),
      buoyWhiteMat,
    );
    pole.position.set(8.2, 3.2, 0);
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xff595e, roughness: 0.4 }),
    );
    flag.position.set(9.4, 2.2, 0);
    cpGroup.add(island, pole, flag);
    checkpointFlags.set(cp.index, flag);
    void poleX;

    scene.add(cpGroup);
  }

  // 7. Grand Finish Line Arch
  const finishGroup = new THREE.Group();
  finishGroup.position.set(course.finishX, 0, course.finishZ);

  const archSpan = course.finishHalfWidth * 1.9;
  const pillarL = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 9.5, 14), buoyRedMat);
  pillarL.position.set(-archSpan * 0.5, 4.5, 0);
  pillarL.castShadow = true;
  const pillarR = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 9.5, 14), buoyRedMat);
  pillarR.position.set(archSpan * 0.5, 4.5, 0);
  pillarR.castShadow = true;

  const bannerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.finishCheckerMap,
    roughness: 0.4,
  });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(archSpan + 1.2, 2.4, 0.7), bannerMat);
  banner.position.set(0, 8.2, 0);
  banner.castShadow = true;
  disposables.push(bannerMat);

  const finishGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(archSpan, 2.2),
    new THREE.MeshBasicMaterial({
      color: 0x06d6a0,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  finishGlow.rotation.x = -Math.PI / 2;
  finishGlow.position.y = 0.06;

  finishGroup.add(pillarL, pillarR, banner, finishGlow);
  scene.add(finishGroup);

  return {
    waterMat,
    waterUniforms,
    movingGateMeshes,
    bumperMeshes,
    checkpointFlags,
    checkpointRings,
    boostMeshes,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
