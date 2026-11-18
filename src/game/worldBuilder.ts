import * as THREE from 'three';
import {
  COURSE_MAIN,
  getChannelBoundsAtZ,
} from '../shared/course.ts';
import type { CourseDefinition } from '../shared/types.ts';
import { createPickupModel } from './models.ts';
import type { ProceduralTextures } from './textures.ts';

export interface DynamicZoneVisual {
  group: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  baseX: number;
  baseY: number;
  baseZ: number;
}

export interface CourseSceneHandles {
  rootGroup: THREE.Group;
  worldChunksGroup: THREE.Group;
  skyDome: THREE.Mesh;
  waterMesh: THREE.Mesh;
  waterMat: THREE.MeshStandardMaterial;
  waterUniforms: {
    uTime: { value: number };
    uLavaMode: { value: number };
    uWaveAmp: { value: number };
    uFoamColor: { value: THREE.Color };
  };
  finishGroup: THREE.Group;
  staticObstacleGroups: THREE.Group[];
  movingGateMeshes: Map<string, THREE.Group>;
  pistonGlowMats: Map<string, THREE.MeshStandardMaterial>;
  spinningGearParts: { mesh: THREE.Object3D; speed: number }[];
  bumperMeshes: THREE.Group[];
  checkpointFlags: Map<number, THREE.Mesh>;
  checkpointRings: Map<number, THREE.Mesh>;
  boostMeshes: THREE.Mesh[];
  fallingRockMeshes: Map<string, THREE.Group>;
  fallingRingMeshes: Map<string, THREE.Mesh>;
  dynamicZoneMeshes: Map<string, DynamicZoneVisual>;
  windFanBlades: Map<string, THREE.Object3D>;
  windStreamMeshes: Map<string, THREE.Mesh>;
  heatRingMeshes: THREE.Mesh[];
  waterfallRibbons: THREE.Mesh[];
  pickupMeshes: Map<string, THREE.Group>;
  lighthouseBeacons: THREE.Object3D[];
  lightningLight: THREE.PointLight | null;
  dispose: () => void;
}

function isDangerZ(z: number, course: CourseDefinition): boolean {
  for (const dz of course.dangerZones) {
    if (z <= dz.zStart && z >= dz.zEnd) {
      return true;
    }
  }
  return false;
}

function createCogwheelGeometry(outerR: number, innerR: number, teeth: number, thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const a1 = a0 + step * 0.22;
    const a2 = a0 + step * 0.34;
    const a3 = a0 + step * 0.66;
    const a4 = a0 + step * 0.78;
    const x0 = Math.cos(a0) * innerR;
    const y0 = Math.sin(a0) * innerR;
    if (i === 0) shape.moveTo(x0, y0);
    else shape.lineTo(x0, y0);
    shape.lineTo(Math.cos(a1) * innerR, Math.sin(a1) * innerR);
    shape.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
    shape.lineTo(Math.cos(a3) * outerR, Math.sin(a3) * outerR);
    shape.lineTo(Math.cos(a4) * innerR, Math.sin(a4) * innerR);
  }
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR * 0.32, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 1,
  });
  geo.center();
  return geo;
}

export function buildCourseWorld(
  scene: THREE.Scene,
  textures: ProceduralTextures,
  course: CourseDefinition = COURSE_MAIN,
): CourseSceneHandles {
  const rootGroup = new THREE.Group();
  scene.add(rootGroup);

  const trackedGeos = new Set<THREE.BufferGeometry>();
  const trackedMats = new Set<THREE.Material>();
  const regGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    trackedGeos.add(g);
    return g;
  };
  const regMat = <T extends THREE.Material>(m: T): T => {
    trackedMats.add(m);
    return m;
  };

  // 1. Monumental Sky Dome matching course atmosphere
  const skyGeo = regGeo(new THREE.SphereGeometry(205, 24, 16));
  const skyMat = regMat(
    new THREE.MeshBasicMaterial({
      map: textures.skyMaps[course.id],
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.frustumCulled = false;
  rootGroup.add(skyDome);

  // 2. Animated River / Molten Magma / Stormy Ocean Surface
  const isVolcanic = course.id === 'volcanic';
  const isGlacial = course.id === 'glacial';
  const isFactory = course.id === 'factory';
  const isTropical = course.id === 'tropical';
  const isStorm = course.id === 'storm';

  const waterUniforms = {
    uTime: { value: 0 },
    uLavaMode: { value: isVolcanic ? 1.0 : 0.0 },
    uWaveAmp: { value: course.meta.waveAmplitude ?? 1.0 },
    uFoamColor: { value: new THREE.Color(course.meta.waterFoamHex) },
  };

  const courseSpanZ = Math.abs(course.finishZ - course.startZ) + 160;
  const waterGeo = regGeo(new THREE.PlaneGeometry(360, courseSpanZ, 64, 96));
  waterGeo.rotateX(-Math.PI / 2);

  const waterMat = regMat(
    new THREE.MeshStandardMaterial({
      color: course.meta.waterColorHex,
      ...(isVolcanic ? { map: textures.lavaMap } : {}),
      roughness: isVolcanic ? 0.55 : isGlacial ? 0.16 : isStorm ? 0.18 : 0.24,
      metalness: isVolcanic ? 0.05 : isFactory ? 0.25 : isStorm ? 0.22 : 0.14,
      emissive: isVolcanic ? new THREE.Color(0x8c2200) : new THREE.Color(0x000000),
      emissiveIntensity: isVolcanic ? 0.55 : 0,
    }),
  );

  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uLavaMode = waterUniforms.uLavaMode;
    shader.uniforms.uWaveAmp = waterUniforms.uWaveAmp;
    shader.uniforms.uFoamColor = waterUniforms.uFoamColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uLavaMode;
         uniform float uWaveAmp;
         varying vec3 vWorldPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float wAmp = mix(1.0, 0.55, uLavaMode) * uWaveAmp;
         float w1 = sin(position.x * 0.22 + uTime * 2.1) * cos(position.z * 0.18 + uTime * 1.6);
         float w2 = sin((position.x + position.z) * 0.35 - uTime * 2.7);
         transformed.y += (w1 * 0.14 + w2 * 0.08) * wAmp;`,
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
         uniform float uLavaMode;
         uniform vec3 uFoamColor;
         varying vec3 vWorldPos;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float band = sin(vWorldPos.x * 0.42 + vWorldPos.z * 0.28 + uTime * 2.3)
                    * cos(vWorldPos.z * 0.5 - uTime * 1.8);
         float crest = smoothstep(0.58, 0.94, band);
         diffuseColor.rgb = mix(diffuseColor.rgb, uFoamColor, crest * mix(0.4, 0.65, uLavaMode));`,
      );
  };

  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set(0, -0.1, course.finishZ * 0.5 - 10);
  waterMesh.receiveShadow = true;
  rootGroup.add(waterMesh);

  const worldChunksGroup = new THREE.Group();
  rootGroup.add(worldChunksGroup);

  // Shared materials reused across course props
  const dangerBuoyMat = regMat(
    new THREE.MeshStandardMaterial({
      color: isVolcanic ? 0xff4d00 : isGlacial ? 0x00bbf9 : isFactory ? 0xffb703 : 0xff595e,
      emissive: isVolcanic ? 0x801a00 : isFactory ? 0x553800 : 0x220000,
      emissiveIntensity: isVolcanic ? 0.7 : 0.25,
      roughness: 0.35,
    }),
  );
  const whiteMat = regMat(new THREE.MeshStandardMaterial({ color: 0xfff8f0, roughness: 0.4 }));
  const stripeMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.hazardStripeMap,
      roughness: 0.45,
      metalness: 0.15,
    }),
  );

  // 3. Canyon Banks, Landmarks & Architectural Mega-Structures
  const bankInstances: {
    x: number;
    y: number;
    z: number;
    sx: number;
    sy: number;
    sz: number;
    ry: number;
    color: number;
  }[] = [];

  const palmPositions: { x: number; y: number; z: number; scale: number; rotY: number }[] = [];
  const snowPinePositions: { x: number; y: number; z: number; scale: number; rotY: number }[] = [];
  const crystalPositions: { x: number; y: number; z: number; scale: number; rotZ: number }[] = [];
  const spinningGearParts: { mesh: THREE.Object3D; speed: number }[] = [];
  const waterfallRibbons: THREE.Mesh[] = [];

  const dummy = new THREE.Object3D();
  const c = new THREE.Color();

  const zMin = course.finishZ - 28;
  for (let z = 14; z >= zMin; z -= 6.5) {
    const bounds = getChannelBoundsAtZ(z, course.waypoints);
    const openDanger = isDangerZ(z, course);

    if (openDanger) {
      bankInstances.push(
        {
          x: bounds.centerX - bounds.halfWidth - 1.1,
          y: 0.2,
          z,
          sx: 0.6,
          sy: 0.9,
          sz: 0.6,
          ry: z * 0.2,
          color: isVolcanic ? 0xff5500 : isGlacial ? 0x38bdf8 : isFactory ? 0xffb703 : 0xff595e,
        },
        {
          x: bounds.centerX + bounds.halfWidth + 1.1,
          y: 0.2,
          z,
          sx: 0.6,
          sy: 0.9,
          sz: 0.6,
          ry: z * 0.2,
          color: isVolcanic ? 0xff5500 : isGlacial ? 0x38bdf8 : isFactory ? 0xffb703 : 0xff595e,
        },
      );
      continue;
    }

    for (const side of [-1, 1]) {
      const rx = bounds.centerX + side * (bounds.halfWidth + 2.8 + Math.abs(Math.sin(z * 0.4)) * 1.2);
      const cliffH = isFactory
        ? 6.2
        : (isVolcanic ? 3.8 : 2.7) + Math.abs(Math.sin(z * 0.5)) * (isVolcanic ? 3.2 : 2.4);

      let nearColor = 0xd4a373;
      let outerColor = 0x588157;
      if (isVolcanic) {
        nearColor = side === -1 ? 0x3b2c30 : 0x2c2023;
        outerColor = 0x4d2522;
      } else if (isGlacial) {
        nearColor = side === -1 ? 0x9ee7ff : 0xcbf6ff;
        outerColor = 0x5c9ead;
      } else if (isFactory) {
        nearColor = side === -1 ? 0x3f4a5a : 0x35404f;
        outerColor = 0x262f3d;
      } else if (isStorm) {
        nearColor = side === -1 ? 0x2b3b4e : 0x213040;
        outerColor = 0x162230;
      } else {
        nearColor = side === -1 ? 0xe9c46a : 0xddb870;
        outerColor = 0x40916c;
      }

      bankInstances.push({
        x: rx,
        y: cliffH * 0.44,
        z,
        sx: (isFactory ? 2.6 : 3.1) + Math.abs(Math.cos(z * 0.3)) * 1.0,
        sy: cliffH,
        sz: 3.7,
        ry: isFactory ? 0 : z * 0.37 + side,
        color: nearColor,
      });

      const ridgeH = isFactory ? 12.0 : 5.8 + Math.abs(Math.sin(z * 0.17)) * 5.2;
      bankInstances.push({
        x: rx + side * 8.6,
        y: ridgeH * 0.45,
        z: z + 2,
        sx: 6.4,
        sy: ridgeH,
        sz: 5.8,
        ry: isFactory ? 0 : z * 0.21,
        color: outerColor,
      });

      if (isTropical && Math.abs(Math.round(z)) % 19 === (side > 0 ? 3 : 11)) {
        palmPositions.push({
          x: rx + side * 1.1,
          y: cliffH * 0.85,
          z,
          scale: 0.9 + Math.abs(Math.sin(z)) * 0.4,
          rotY: z * 0.7 + side,
        });
      }

      if (isGlacial) {
        if (Math.abs(Math.round(z)) % 18 === (side > 0 ? 5 : 12)) {
          snowPinePositions.push({
            x: rx + side * 1.5,
            y: cliffH * 0.86,
            z,
            scale: 0.95 + Math.abs(Math.cos(z)) * 0.35,
            rotY: z * 0.5,
          });
        }
        if (Math.abs(Math.round(z)) % 24 === (side > 0 ? 6 : 16)) {
          crystalPositions.push({
            x: rx - side * 0.6,
            y: cliffH * 0.85,
            z,
            scale: 0.85 + Math.abs(Math.sin(z * 0.3)) * 0.6,
            rotZ: -side * 0.25,
          });
        }
      }
    }
  }

  const bankGeo = regGeo(
    isFactory
      ? new THREE.BoxGeometry(1.5, 1.0, 1.5)
      : new THREE.CylinderGeometry(0.68, 1.05, 1.0, isVolcanic ? 6 : 7),
  );
  const bankMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: isFactory ? textures.metalPlateMap : isGlacial ? textures.iceMap : textures.stoneMap,
      roughness: isGlacial ? 0.38 : isFactory ? 0.5 : 0.88,
      metalness: isFactory ? 0.45 : 0.05,
      flatShading: !isFactory,
    }),
  );
  const bankMesh = new THREE.InstancedMesh(bankGeo, bankMat, bankInstances.length);
  bankMesh.castShadow = true;
  bankMesh.receiveShadow = true;
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
  worldChunksGroup.add(bankMesh);

  // Tropical World Landmarks: Multi-part Palm Trees, Coastal Waterfalls, Horizon Islands & Clouds
  if (isTropical) {
    if (palmPositions.length > 0) {
      const trunkGeo = regGeo(new THREE.CylinderGeometry(0.15, 0.28, 3.8, 7));
      const trunkMat = regMat(new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.9, flatShading: true }));
      const frondGeo = regGeo(new THREE.ConeGeometry(1.9, 1.15, 7));
      const frondMat = regMat(new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.72, flatShading: true }));
      const coconutGeo = regGeo(new THREE.SphereGeometry(0.22, 8, 6));
      const coconutMat = regMat(new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.8 }));

      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPositions.length);
      const canopyLow = new THREE.InstancedMesh(frondGeo, frondMat, palmPositions.length);
      const canopyTop = new THREE.InstancedMesh(frondGeo, frondMat, palmPositions.length);
      const coconuts = new THREE.InstancedMesh(coconutGeo, coconutMat, palmPositions.length * 2);
      trunks.castShadow = true;
      canopyLow.castShadow = true;
      canopyTop.castShadow = true;

      palmPositions.forEach((p, idx) => {
        dummy.position.set(p.x, p.y + 1.75 * p.scale, p.z);
        dummy.rotation.set(0.08, p.rotY, 0.12);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(p.x + 0.22 * p.scale, p.y + 3.45 * p.scale, p.z);
        dummy.rotation.set(0, p.rotY, 0.08);
        dummy.scale.set(p.scale * 1.12, p.scale * 0.9, p.scale * 1.12);
        dummy.updateMatrix();
        canopyLow.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(p.x + 0.25 * p.scale, p.y + 4.15 * p.scale, p.z);
        dummy.rotation.set(0, p.rotY + 0.5, 0.08);
        dummy.scale.set(p.scale * 0.78, p.scale * 0.85, p.scale * 0.78);
        dummy.updateMatrix();
        canopyTop.setMatrixAt(idx, dummy.matrix);

        for (let k = 0; k < 2; k++) {
          dummy.position.set(p.x + (k === 0 ? -0.15 : 0.35) * p.scale, p.y + 3.05 * p.scale, p.z + 0.2);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(p.scale);
          dummy.updateMatrix();
          coconuts.setMatrixAt(idx * 2 + k, dummy.matrix);
        }
      });
      trunks.instanceMatrix.needsUpdate = true;
      canopyLow.instanceMatrix.needsUpdate = true;
      canopyTop.instanceMatrix.needsUpdate = true;
      coconuts.instanceMatrix.needsUpdate = true;
      worldChunksGroup.add(trunks, canopyLow, canopyTop, coconuts);
    }

    // Coastal Waterfalls aligned with Tropical waterfall_gust windZones
    const cliffFaceMat = regMat(new THREE.MeshStandardMaterial({ color: 0xb08968, map: textures.stoneMap, roughness: 0.88 }));
    const waterRibbonMat = regMat(
      new THREE.MeshStandardMaterial({
        color: 0xbaf2ff,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.45,
        transparent: true,
        opacity: 0.84,
        roughness: 0.15,
      }),
    );
    const foamPoolMat = regMat(
      new THREE.MeshBasicMaterial({
        color: 0xeafcff,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );

    course.windZones.forEach((wz, idx) => {
      const side = wz.forceX < 0 ? 1 : -1; // waterfall falls from opposite cliff pushing across channel
      const bounds = getChannelBoundsAtZ(wz.z, course.waypoints);
      const cliffX = bounds.centerX + side * (bounds.halfWidth + 5.5);

      const cliff = new THREE.Mesh(regGeo(new THREE.BoxGeometry(6.5, 14, 11)), cliffFaceMat);
      cliff.position.set(cliffX + side * 2.5, 6.2, wz.z);
      cliff.castShadow = true;

      const stream = new THREE.Mesh(regGeo(new THREE.BoxGeometry(2.8, 12.8, 6.2)), waterRibbonMat);
      stream.position.set(cliffX - side * 0.4, 6.0, wz.z);
      waterfallRibbons.push(stream);

      const pool = new THREE.Mesh(regGeo(new THREE.RingGeometry(1.4, 4.5, 22)), foamPoolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(cliffX - side * 1.4, 0.06, wz.z);

      worldChunksGroup.add(cliff, stream, pool);
      void idx;
    });

    // Distant tropical horizon silhouettes & soft stylized clouds
    const islandMat = regMat(new THREE.MeshStandardMaterial({ color: 0x40916c, roughness: 0.85, flatShading: true }));
    const cloudMat = regMat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
    for (const [ix, iz, ir, ih] of [
      [-68, -70, 22, 14],
      [74, -145, 26, 17],
      [-65, -245, 24, 15],
      [68, -330, 28, 18],
    ]) {
      const isl = new THREE.Mesh(regGeo(new THREE.ConeGeometry(ir, ih, 8)), islandMat);
      isl.position.set(ix, ih * 0.4 - 0.5, iz);
      worldChunksGroup.add(isl);
    }
    for (let i = 0; i < 6; i++) {
      const cl = new THREE.Mesh(regGeo(new THREE.SphereGeometry(4.5, 10, 8)), cloudMat);
      cl.scale.set(2.2, 0.8, 1.3);
      cl.position.set((i % 2 === 0 ? -1 : 1) * (35 + i * 8), 28 + (i % 3) * 4, -40 - i * 52);
      worldChunksGroup.add(cl);
    }
  }

  // Volcanic World Landmarks: Giant Erupting Horizon Volcanoes, Lava Falls & Glowing Fissures
  if (isVolcanic) {
    const volcanoMat = regMat(
      new THREE.MeshStandardMaterial({
        color: 0x2b1b1e,
        map: textures.stoneMap,
        roughness: 0.9,
        flatShading: true,
      }),
    );
    const craterGlowMat = regMat(
      new THREE.MeshStandardMaterial({
        color: 0xff6b00,
        emissive: 0xff4d00,
        emissiveIntensity: 1.5,
        roughness: 0.3,
      }),
    );
    for (const [vx, vz, r, h] of [
      [-68, -95, 28, 38],
      [72, -195, 32, 44],
      [-10, -395, 42, 54],
    ]) {
      const cone = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(r * 0.24, r, h, 10)), volcanoMat);
      cone.position.set(vx, h * 0.45 - 1, vz);
      const rim = new THREE.Mesh(regGeo(new THREE.TorusGeometry(r * 0.23, 1.4, 8, 16)), craterGlowMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(vx, h * 0.9 - 1, vz);
      const lavaFlow = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(1.1, 3.2, h * 0.9, 6)), craterGlowMat);
      lavaFlow.position.set(vx + (vx < 0 ? r * 0.38 : -r * 0.38), h * 0.42, vz + 4);
      lavaFlow.rotation.z = vx < 0 ? -0.45 : 0.45;
      worldChunksGroup.add(cone, rim, lavaFlow);
    }
  }

  // Glacial World Landmarks: Snow-Capped Pines, Ice Crystal Spires & Polar Mountains
  if (isGlacial) {
    if (snowPinePositions.length > 0) {
      const pineTrunkGeo = regGeo(new THREE.CylinderGeometry(0.18, 0.26, 2.2, 6));
      const pineTrunkMat = regMat(new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.9 }));
      const pineLeafGeo = regGeo(new THREE.ConeGeometry(1.55, 2.8, 7));
      const pineLeafMat = regMat(new THREE.MeshStandardMaterial({ color: 0x2d6a6e, roughness: 0.78, flatShading: true }));
      const snowCapGeo = regGeo(new THREE.ConeGeometry(1.1, 1.4, 7));

      const pTrunks = new THREE.InstancedMesh(pineTrunkGeo, pineTrunkMat, snowPinePositions.length);
      const pLeaves = new THREE.InstancedMesh(pineLeafGeo, pineLeafMat, snowPinePositions.length);
      const pSnow = new THREE.InstancedMesh(snowCapGeo, whiteMat, snowPinePositions.length);

      snowPinePositions.forEach((p, idx) => {
        dummy.position.set(p.x, p.y + 1.0 * p.scale, p.z);
        dummy.rotation.set(0, p.rotY, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        pTrunks.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(p.x, p.y + 2.7 * p.scale, p.z);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        pLeaves.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(p.x, p.y + 3.55 * p.scale, p.z);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        pSnow.setMatrixAt(idx, dummy.matrix);
      });
      pTrunks.instanceMatrix.needsUpdate = true;
      pLeaves.instanceMatrix.needsUpdate = true;
      pSnow.instanceMatrix.needsUpdate = true;
      worldChunksGroup.add(pTrunks, pLeaves, pSnow);
    }

    if (crystalPositions.length > 0) {
      const crystalGeo = regGeo(new THREE.ConeGeometry(0.75, 3.8, 5));
      const crystalMat = regMat(
        new THREE.MeshStandardMaterial({
          color: 0x9bf6ff,
          emissive: 0x1565c0,
          emissiveIntensity: 0.42,
          roughness: 0.16,
          metalness: 0.25,
          transparent: true,
          opacity: 0.88,
        }),
      );
      const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, crystalPositions.length);
      crystalPositions.forEach((cr, idx) => {
        dummy.position.set(cr.x, cr.y + 1.5 * cr.scale, cr.z);
        dummy.rotation.set(0.1, idx * 0.7, cr.rotZ);
        dummy.scale.setScalar(cr.scale);
        dummy.updateMatrix();
        crystals.setMatrixAt(idx, dummy.matrix);
      });
      crystals.instanceMatrix.needsUpdate = true;
      worldChunksGroup.add(crystals);
    }

    // Towering Snow-Capped Polar Peaks
    const peakMat = regMat(new THREE.MeshStandardMaterial({ color: 0x457b9d, roughness: 0.8, flatShading: true }));
    for (const [mx, mz, mr, mh] of [
      [-64, -75, 24, 34],
      [66, -155, 28, 38],
      [-62, -255, 26, 36],
      [64, -345, 30, 42],
    ]) {
      const mtn = new THREE.Mesh(regGeo(new THREE.ConeGeometry(mr, mh, 6)), peakMat);
      mtn.position.set(mx, mh * 0.45, mz);
      const cap = new THREE.Mesh(regGeo(new THREE.ConeGeometry(mr * 0.48, mh * 0.48, 6)), whiteMat);
      cap.position.set(mx, mh * 0.72, mz);
      worldChunksGroup.add(mtn, cap);
    }
  }

  // Factory World Landmarks: Enclosed Overhead Steel Trusses, Sodium Lamps & Giant Wall Cogwheels
  if (isFactory) {
    const steelMat = regMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        map: textures.metalPlateMap,
        roughness: 0.42,
        metalness: 0.65,
      }),
    );
    const girderYellowMat = regMat(
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.35 }),
    );
    const lampMat = regMat(
      new THREE.MeshStandardMaterial({
        color: 0xffefc2,
        emissive: 0xffaa00,
        emissiveIntensity: 1.5,
      }),
    );
    const furnaceGlowMat = regMat(
      new THREE.MeshStandardMaterial({
        color: 0xff5400,
        emissive: 0xff3c00,
        emissiveIntensity: 1.4,
      }),
    );
    const wallGearGeo = regGeo(createCogwheelGeometry(4.6, 3.6, 12, 0.7));

    for (let z = 0; z >= course.finishZ - 10; z -= 26) {
      const bounds = getChannelBoundsAtZ(z, course.waypoints);
      const span = bounds.halfWidth * 2 + 12;

      const leftCol = new THREE.Mesh(regGeo(new THREE.BoxGeometry(1.4, 15, 1.4)), steelMat);
      leftCol.position.set(bounds.centerX - span * 0.5, 7.2, z);
      const rightCol = new THREE.Mesh(regGeo(new THREE.BoxGeometry(1.4, 15, 1.4)), steelMat);
      rightCol.position.set(bounds.centerX + span * 0.5, 7.2, z);

      const roofBeam = new THREE.Mesh(regGeo(new THREE.BoxGeometry(span + 2, 1.3, 1.6)), girderYellowMat);
      roofBeam.position.set(bounds.centerX, 14.5, z);

      const lamp = new THREE.Mesh(regGeo(new THREE.BoxGeometry(4.8, 0.35, 0.75)), lampMat);
      lamp.position.set(bounds.centerX, 13.7, z);

      worldChunksGroup.add(leftCol, rightCol, roofBeam, lamp);

      // Giant decorative rotating cogwheels mounted along the mega-hall walls
      if (Math.abs(Math.round(z)) % 52 === 0) {
        for (const side of [-1, 1]) {
          const gear = new THREE.Mesh(wallGearGeo, steelMat);
          gear.position.set(bounds.centerX + side * (span * 0.5 + 1.5), 7.8, z - 12);
          gear.rotation.y = Math.PI / 2;
          worldChunksGroup.add(gear);
          spinningGearParts.push({ mesh: gear, speed: side * 0.75 });
        }
      } else {
        // Glowing blast-furnace observation windows on outer hall walls
        const win = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.5, 3.2, 5.4)), furnaceGlowMat);
        win.position.set(bounds.centerX + (z % 2 === 0 ? 1 : -1) * (span * 0.5 + 0.5), 5.6, z - 12);
        worldChunksGroup.add(win);
      }
    }
  }

  // Storm World Landmarks: Coastal Lighthouses, Dark Thunderheads & Lightning PointLight
  const lighthouseBeacons: THREE.Object3D[] = [];
  let lightningLight: THREE.PointLight | null = null;
  if (isStorm) {
    lightningLight = new THREE.PointLight(0xdbeafe, 0, 260, 1.2);
    lightningLight.position.set(0, 38, -80);
    rootGroup.add(lightningLight);

    const towerMat = regMat(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.75 }));
    const redBandMat = regMat(new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 }));
    const beaconGlowMat = regMat(
      new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xfacc15,
        emissiveIntensity: 2.0,
      }),
    );
    const stormCloudMat = regMat(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95, flatShading: true }),
    );

    for (const lz of [-92, -184, -272]) {
      const side = lz === -184 ? -1 : 1;
      const bounds = getChannelBoundsAtZ(lz, course.waypoints);
      const lx = bounds.centerX + side * (bounds.halfWidth + 7.5);
      const lh = new THREE.Group();
      lh.position.set(lx, 0, lz);

      const baseRock = new THREE.Mesh(
        regGeo(new THREE.CylinderGeometry(3.8, 5.2, 3.2, 8)),
        regMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, map: textures.stoneMap, roughness: 0.9 })),
      );
      baseRock.position.y = 1.4;

      const lowerTower = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(1.7, 2.2, 6.5, 12)), towerMat);
      lowerTower.position.y = 5.8;
      const redBand = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(1.5, 1.7, 2.6, 12)), redBandMat);
      redBand.position.y = 10.2;
      const lanternRoom = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(1.4, 1.4, 1.8, 10)), beaconGlowMat);
      lanternRoom.position.y = 12.4;
      const roof = new THREE.Mesh(regGeo(new THREE.ConeGeometry(1.85, 1.8, 10)), redBandMat);
      roof.position.y = 14.2;

      const beamPivot = new THREE.Group();
      beamPivot.position.y = 12.4;
      const beamCone = new THREE.Mesh(
        regGeo(new THREE.ConeGeometry(4.2, 26, 12, 1, true)),
        regMat(
          new THREE.MeshBasicMaterial({
            color: 0xfef08a,
            transparent: true,
            opacity: 0.16,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      );
      beamCone.rotation.z = Math.PI / 2;
      beamCone.position.x = 13;
      beamPivot.add(beamCone);
      lighthouseBeacons.push(beamPivot);

      lh.add(baseRock, lowerTower, redBand, lanternRoom, roof, beamPivot);
      worldChunksGroup.add(lh);
    }

    // Brooding low-hanging storm clouds overhead
    for (let i = 0; i < 10; i++) {
      const cl = new THREE.Mesh(regGeo(new THREE.DodecahedronGeometry(6.5, 1)), stormCloudMat);
      cl.scale.set(2.4, 0.55, 1.6);
      cl.position.set((i % 2 === 0 ? -1 : 1) * (18 + (i % 3) * 14), 26 + (i % 2) * 3, -18 - i * 34);
      worldChunksGroup.add(cl);
    }
  }

  // 4. Static Obstacles (Rocks, Pillars, Buoys, Bouncy Bumpers)
  const staticObstacleGroups: THREE.Group[] = [];
  const bumperMeshes: THREE.Group[] = [];
  const rockMat = regMat(
    new THREE.MeshStandardMaterial({
      color: isVolcanic ? 0x3b2628 : isGlacial ? 0xa9e4ff : isFactory ? 0x475569 : 0x6c757d,
      map: isGlacial ? textures.iceMap : isFactory ? textures.metalPlateMap : textures.stoneMap,
      roughness: isGlacial ? 0.3 : 0.85,
      metalness: isFactory ? 0.45 : 0.05,
    }),
  );
  const pillarMat = regMat(
    new THREE.MeshStandardMaterial({
      color: isVolcanic ? 0x2a1f24 : isGlacial ? 0xc2f5ff : isFactory ? 0xf59e0b : 0xffffff,
      map: isFactory ? textures.hazardStripeMap : isGlacial ? textures.iceMap : textures.woodMap,
      roughness: isFactory ? 0.45 : 0.72,
    }),
  );
  const bumperBodyMat = regMat(
    new THREE.MeshStandardMaterial({
      color: isVolcanic ? 0xff4d00 : isGlacial ? 0x00bbf9 : isFactory ? 0xffb703 : 0xf72585,
      roughness: 0.3,
      metalness: 0.18,
      emissive: isVolcanic ? 0x701500 : isFactory ? 0x553000 : 0x440022,
      emissiveIntensity: 0.4,
    }),
  );
  const bumperRingMat = regMat(
    new THREE.MeshStandardMaterial({ color: 0xffbe0b, roughness: 0.25, metalness: 0.5 }),
  );

  for (const obs of course.staticObstacles) {
    const grp = new THREE.Group();
    grp.position.set(obs.x, 0, obs.z);

    if (obs.kind === 'rock') {
      const base = new THREE.Mesh(regGeo(new THREE.DodecahedronGeometry(obs.radius, 1)), rockMat);
      base.scale.set(1, 0.85, 1);
      base.position.y = obs.radius * 0.45;
      base.castShadow = true;
      base.receiveShadow = true;
      const capColor = isVolcanic ? 0xff5500 : isGlacial ? 0xffffff : 0x52b788;
      const cap = new THREE.Mesh(
        regGeo(new THREE.DodecahedronGeometry(obs.radius * 0.52, 0)),
        regMat(new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.7 })),
      );
      cap.position.set(0.2, obs.radius * 0.95, 0.1);
      grp.add(base, cap);
    } else if (obs.kind === 'pillar') {
      const post = new THREE.Mesh(
        regGeo(new THREE.CylinderGeometry(obs.radius * 0.82, obs.radius, obs.height, 12)),
        pillarMat,
      );
      post.position.y = obs.height * 0.42;
      post.castShadow = true;
      const band = new THREE.Mesh(
        regGeo(new THREE.CylinderGeometry(obs.radius * 0.88, obs.radius * 0.88, 0.55, 12)),
        dangerBuoyMat,
      );
      band.position.y = obs.height * 0.65;
      const cap = new THREE.Mesh(regGeo(new THREE.ConeGeometry(obs.radius * 0.9, 0.8, 12)), whiteMat);
      cap.position.y = obs.height * 0.9;
      grp.add(post, band, cap);
    } else if (obs.kind === 'buoy') {
      const floatRing = new THREE.Mesh(
        regGeo(new THREE.TorusGeometry(obs.radius * 0.72, 0.35, 10, 18)),
        dangerBuoyMat,
      );
      floatRing.rotation.x = Math.PI / 2;
      floatRing.position.y = 0.25;
      const mast = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.16, 0.22, obs.height, 10)), whiteMat);
      mast.position.y = obs.height * 0.5;
      const beacon = new THREE.Mesh(
        regGeo(new THREE.SphereGeometry(0.32, 10, 8)),
        regMat(
          new THREE.MeshStandardMaterial({
            color: 0xffd166,
            emissive: 0xffaa00,
            emissiveIntensity: 0.9,
          }),
        ),
      );
      beacon.position.y = obs.height;
      grp.add(floatRing, mast, beacon);
    } else if (obs.kind === 'bumper') {
      const sphere = new THREE.Mesh(regGeo(new THREE.SphereGeometry(obs.radius * 0.85, 16, 12)), bumperBodyMat);
      sphere.position.y = 0.65;
      sphere.castShadow = true;
      const ring = new THREE.Mesh(regGeo(new THREE.TorusGeometry(obs.radius * 0.92, 0.22, 10, 20)), bumperRingMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.65;
      const topCap = new THREE.Mesh(regGeo(new THREE.ConeGeometry(0.45, 0.7, 10)), bumperRingMat);
      topCap.position.y = 1.65;
      grp.add(sphere, ring, topCap);
      bumperMeshes.push(grp);
    }

    worldChunksGroup.add(grp);
    staticObstacleGroups.push(grp);
  }

  // 5. Moving Gates, Icebergs, Lava Surges, Giant Sliding Gears, Cranes & Vertical Pistons
  const movingGateMeshes = new Map<string, THREE.Group>();
  const pistonGlowMats = new Map<string, THREE.MeshStandardMaterial>();
  const darkSteelMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      map: textures.metalPlateMap,
      roughness: 0.4,
      metalness: 0.65,
    }),
  );
  const lavaGateMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0x381515,
      map: textures.lavaMap,
      emissive: 0xff4500,
      emissiveIntensity: 0.75,
      roughness: 0.45,
    }),
  );
  const icebergMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xc2f6ff,
      map: textures.iceMap,
      roughness: 0.22,
      metalness: 0.08,
      flatShading: true,
    }),
  );

  for (const gate of course.movingGates) {
    const grp = new THREE.Group();
    grp.position.set(gate.baseX, 0, gate.z);

    if (gate.style === 'piston') {
      // Static gantry frame mounted into canal + moving hydraulic ram group!
      const frame = new THREE.Group();
      frame.position.set(gate.baseX, 0, gate.z);
      const pillarL = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.95, 11.5, 1.3)), darkSteelMat);
      pillarL.position.set(-gate.halfWidth - 0.6, 5.5, 0);
      const pillarR = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.95, 11.5, 1.3)), darkSteelMat);
      pillarR.position.set(gate.halfWidth + 0.6, 5.5, 0);
      const topCross = new THREE.Mesh(
        regGeo(new THREE.BoxGeometry(gate.halfWidth * 2 + 2.4, 1.2, 1.6)),
        stripeMat,
      );
      topCross.position.set(0, 11.0, 0);
      frame.add(pillarL, pillarR, topCross);
      worldChunksGroup.add(frame);

      // Moving Piston Head + Hydraulic Rod + Strobe Warning Lights
      const pressHead = new THREE.Mesh(
        regGeo(new THREE.BoxGeometry(gate.halfWidth * 2, 1.9, gate.depth)),
        stripeMat,
      );
      pressHead.position.y = 0.95;
      pressHead.castShadow = true;

      const rod = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.55, 0.55, 7.5, 12)), darkSteelMat);
      rod.position.y = 5.4;

      const warnMat = regMat(
        new THREE.MeshStandardMaterial({
          color: 0xff595e,
          emissive: 0xff2a00,
          emissiveIntensity: 0.4,
        }),
      );
      pistonGlowMats.set(gate.id, warnMat);
      const beaconL = new THREE.Mesh(regGeo(new THREE.SphereGeometry(0.45, 10, 8)), warnMat);
      beaconL.position.set(-gate.halfWidth + 0.6, 2.05, 0);
      const beaconR = new THREE.Mesh(regGeo(new THREE.SphereGeometry(0.45, 10, 8)), warnMat);
      beaconR.position.set(gate.halfWidth - 0.6, 2.05, 0);

      grp.add(pressHead, rod, beaconL, beaconR);
    } else if (gate.style === 'gear') {
      const cogGeo = regGeo(createCogwheelGeometry(gate.halfWidth * 0.92, gate.halfWidth * 0.72, 12, 0.9));
      const cog = new THREE.Mesh(cogGeo, darkSteelMat);
      cog.rotation.x = Math.PI / 2;
      cog.position.y = 0.95;
      cog.castShadow = true;
      const hub = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.75, 0.85, 2.1, 12)), dangerBuoyMat);
      hub.position.y = 1.1;
      grp.add(cog, hub);
      spinningGearParts.push({ mesh: cog, speed: 2.2 });
    } else if (gate.style === 'crane') {
      const container = new THREE.Mesh(
        regGeo(new THREE.BoxGeometry(gate.halfWidth * 2, 1.85, gate.depth)),
        stripeMat,
      );
      container.position.y = 1.1;
      container.castShadow = true;
      const cableL = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.1, 0.1, 9.5, 8)), darkSteelMat);
      cableL.position.set(-gate.halfWidth * 0.7, 6.2, 0);
      const cableR = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.1, 0.1, 9.5, 8)), darkSteelMat);
      cableR.position.set(gate.halfWidth * 0.7, 6.2, 0);
      grp.add(container, cableL, cableR);
    } else if (gate.style === 'lava_surge') {
      const rockWall = new THREE.Mesh(
        regGeo(new THREE.BoxGeometry(gate.halfWidth * 2, 1.65, gate.depth)),
        lavaGateMat,
      );
      rockWall.position.y = 0.85;
      rockWall.castShadow = true;
      for (const sx of [-gate.halfWidth * 0.65, 0, gate.halfWidth * 0.65]) {
        const spike = new THREE.Mesh(regGeo(new THREE.ConeGeometry(0.65, 2.2, 6)), lavaGateMat);
        spike.position.set(sx, 2.0, 0);
        grp.add(spike);
      }
      grp.add(rockWall);
    } else if (gate.style === 'iceberg') {
      const mainBerg = new THREE.Mesh(
        regGeo(new THREE.DodecahedronGeometry(gate.halfWidth * 0.72, 0)),
        icebergMat,
      );
      mainBerg.scale.set(1.35, 0.85, 0.75);
      mainBerg.position.y = 0.9;
      mainBerg.castShadow = true;
      const spire = new THREE.Mesh(regGeo(new THREE.ConeGeometry(1.3, 2.9, 6)), whiteMat);
      spire.position.set(0.4, 2.2, 0);
      grp.add(mainBerg, spire);
    } else {
      // Tropical wooden gate
      const beam = new THREE.Mesh(
        regGeo(new THREE.BoxGeometry(gate.halfWidth * 2, 1.35, gate.depth)),
        stripeMat,
      );
      beam.position.y = 0.72;
      beam.castShadow = true;
      beam.receiveShadow = true;
      const endPostL = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.55, 0.65, 2.2, 12)), dangerBuoyMat);
      endPostL.position.set(-gate.halfWidth, 0.95, 0);
      const endPostR = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.55, 0.65, 2.2, 12)), dangerBuoyMat);
      endPostR.position.set(gate.halfWidth, 0.95, 0);
      grp.add(beam, endPostL, endPostR);
    }

    worldChunksGroup.add(grp);
    movingGateMeshes.set(gate.id, grp);
  }

  // 6. Boost Pads / Factory Turbine Conveyor Belts
  const boostMeshes: THREE.Mesh[] = [];
  const boostMat = regMat(
    new THREE.MeshStandardMaterial({
      color: isFactory ? 0xffffff : 0x00f5d4,
      ...(isFactory ? { map: textures.conveyorMap } : {}),
      emissive: isFactory ? 0x00b4d8 : 0x00bbf9,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.76,
      roughness: 0.2,
    }),
  );
  for (const pad of course.boostPads) {
    const mesh = isFactory
      ? new THREE.Mesh(regGeo(new THREE.PlaneGeometry(pad.radius * 1.9, pad.radius * 2.2)), boostMat)
      : new THREE.Mesh(regGeo(new THREE.RingGeometry(pad.radius * 0.45, pad.radius, 24)), boostMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pad.x, 0.05, pad.z);
    worldChunksGroup.add(mesh);
    boostMeshes.push(mesh);
  }

  // 7. Friction Zones (Glacial Ice Sheets & Factory Oil Slicks)
  const iceSheetMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xb8f5ff,
      map: textures.iceMap,
      emissive: 0x0077b6,
      emissiveIntensity: 0.18,
      roughness: 0.08,
      metalness: 0.2,
      transparent: true,
      opacity: 0.78,
    }),
  );
  const oilMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0x161224,
      emissive: 0x3c096c,
      emissiveIntensity: 0.22,
      roughness: 0.06,
      metalness: 0.75,
      transparent: true,
      opacity: 0.85,
    }),
  );
  for (const fz of course.frictionZones) {
    const slab = new THREE.Mesh(
      regGeo(new THREE.BoxGeometry(fz.halfWidth * 2, 0.08, fz.halfLength * 2)),
      fz.kind === 'oil_slick' ? oilMat : iceSheetMat,
    );
    slab.position.set(fz.x, 0.03, fz.z);
    slab.receiveShadow = true;
    worldChunksGroup.add(slab);
  }

  // 8. Heat Zones (Volcanic Magma Vents & Factory Furnace Blasts)
  const heatRingMeshes: THREE.Mesh[] = [];
  const heatMat = regMat(
    new THREE.MeshBasicMaterial({
      color: 0xff6d00,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  for (const hz of course.heatZones) {
    const ring = new THREE.Mesh(regGeo(new THREE.RingGeometry(hz.radius * 0.45, hz.radius, 28)), heatMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(hz.x, 0.08, hz.z);
    worldChunksGroup.add(ring);
    heatRingMeshes.push(ring);
  }

  // 9. Pulsed Wind Zones (Factory Fans & Wind Streams)
  const windFanBlades = new Map<string, THREE.Object3D>();
  const windStreamMeshes = new Map<string, THREE.Mesh>();
  const streamMat = regMat(
    new THREE.MeshBasicMaterial({
      color: 0xa5f3fc,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  for (const wz of course.windZones) {
    if (wz.kind === 'factory_fan') {
      const dirSign = wz.forceX >= 0 ? -1 : 1; // fan sits on blowing-from side
      const fanX = wz.x + dirSign * (wz.halfWidth + 0.5);

      const housing = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(2.6, 2.6, 1.4, 16, 1, true)), darkSteelMat);
      housing.rotation.z = Math.PI / 2;
      housing.position.set(fanX, 2.6, wz.z);

      const bladesGroup = new THREE.Group();
      bladesGroup.position.set(fanX, 2.6, wz.z);
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.18, 4.2, 0.65)), stripeMat);
        blade.rotation.x = (b * Math.PI) / 3;
        bladesGroup.add(blade);
      }
      worldChunksGroup.add(housing, bladesGroup);
      windFanBlades.set(wz.id, bladesGroup);

      const stream = new THREE.Mesh(
        regGeo(new THREE.PlaneGeometry(wz.halfWidth * 2, wz.halfLength * 1.4)),
        streamMat,
      );
      stream.rotation.x = -Math.PI / 2;
      stream.position.set(wz.x, 0.28, wz.z);
      worldChunksGroup.add(stream);
      windStreamMeshes.set(wz.id, stream);
    }
  }

  // 10. Falling Hazards (Volcanic Meteors & Glacial Icicles + Warning Target Rings)
  const fallingRockMeshes = new Map<string, THREE.Group>();
  const fallingRingMeshes = new Map<string, THREE.Mesh>();
  const meteorMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b1815,
      map: textures.lavaMap,
      emissive: 0xff4d00,
      emissiveIntensity: 1.0,
      roughness: 0.45,
    }),
  );
  const icicleMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xd8f8ff,
      emissive: 0x00b4d8,
      emissiveIntensity: 0.35,
      roughness: 0.15,
    }),
  );
  for (const fh of course.fallingHazards) {
    const rockGrp = new THREE.Group();
    rockGrp.position.set(fh.x, 34, fh.z);
    if (fh.kind === 'icicle') {
      const spear = new THREE.Mesh(regGeo(new THREE.ConeGeometry(fh.radius * 0.42, fh.radius * 2.2, 7)), icicleMat);
      spear.rotation.x = Math.PI;
      spear.castShadow = true;
      rockGrp.add(spear);
    } else {
      const meteor = new THREE.Mesh(regGeo(new THREE.DodecahedronGeometry(fh.radius * 0.65, 1)), meteorMat);
      meteor.castShadow = true;
      rockGrp.add(meteor);
    }
    worldChunksGroup.add(rockGrp);
    fallingRockMeshes.set(fh.id, rockGrp);

    const ringMat = regMat(
      new THREE.MeshBasicMaterial({
        color: fh.kind === 'icicle' ? 0x38bdf8 : 0xff3b00,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const ring = new THREE.Mesh(regGeo(new THREE.RingGeometry(fh.radius * 0.68, fh.radius, 24)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(fh.x, 0.08, fh.z);
    worldChunksGroup.add(ring);
    fallingRingMeshes.set(fh.id, ring);
  }

  // 11. Dynamic Breakable Bridges / Crumbling Basalt Ledges
  const dynamicZoneMeshes = new Map<string, DynamicZoneVisual>();
  for (const dz of course.dynamicZones) {
    const grp = new THREE.Group();
    const baseY = dz.kind === 'thin_ice' ? 0.06 : 0.15;
    grp.position.set(dz.x, baseY, dz.z);

    const mat = regMat(
      new THREE.MeshStandardMaterial({
        color: dz.kind === 'thin_ice' ? 0xbef5ff : 0x543c3b,
        map: dz.kind === 'thin_ice' ? textures.iceMap : textures.lavaMap,
        emissive: new THREE.Color(dz.kind === 'thin_ice' ? 0x006699 : 0x551800),
        emissiveIntensity: 0.18,
        roughness: dz.kind === 'thin_ice' ? 0.18 : 0.8,
        transparent: dz.kind === 'thin_ice',
        opacity: dz.kind === 'thin_ice' ? 0.88 : 1,
      }),
    );
    const slab = new THREE.Mesh(
      regGeo(new THREE.BoxGeometry(dz.halfWidth * 2, dz.kind === 'thin_ice' ? 0.22 : 0.45, dz.halfLength * 2)),
      mat,
    );
    slab.receiveShadow = true;
    grp.add(slab);

    worldChunksGroup.add(grp);
    dynamicZoneMeshes.set(dz.id, { group: grp, mat, baseX: dz.x, baseY, baseZ: dz.z });
  }

  // 12. Checkpoints (Themed Tower + Flag + Glowing Water Ring)
  const checkpointFlags = new Map<number, THREE.Mesh>();
  const checkpointRings = new Map<number, THREE.Mesh>();

  for (const cp of course.checkpoints) {
    if (cp.index === 0) continue;

    const cpGroup = new THREE.Group();
    cpGroup.position.set(cp.x, 0, cp.z);

    const ringMat = regMat(
      new THREE.MeshStandardMaterial({
        color: 0xffd166,
        emissive: 0xffaa00,
        emissiveIntensity: 0.65,
        transparent: true,
        opacity: 0.72,
      }),
    );
    const ring = new THREE.Mesh(regGeo(new THREE.RingGeometry(cp.radius * 0.85, cp.radius, 32)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    cpGroup.add(ring);
    checkpointRings.set(cp.index, ring);

    const island = new THREE.Mesh(
      regGeo(new THREE.CylinderGeometry(2.2, 2.7, 1.2, 12)),
      regMat(
        new THREE.MeshStandardMaterial({
          color: isVolcanic ? 0x3b2a2c : isGlacial ? 0xa5e6ff : isFactory ? 0x475569 : 0xe9c46a,
          roughness: 0.85,
        }),
      ),
    );
    island.position.set(8.2, 0.3, 0);
    const pole = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.14, 0.18, 6.2, 10)), whiteMat);
    pole.position.set(8.2, 3.2, 0);
    const flag = new THREE.Mesh(
      regGeo(new THREE.BoxGeometry(2.4, 1.2, 0.12)),
      regMat(new THREE.MeshStandardMaterial({ color: 0xff595e, roughness: 0.4 })),
    );
    flag.position.set(9.4, 2.2, 0);
    cpGroup.add(island, pole, flag);
    checkpointFlags.set(cp.index, flag);

    worldChunksGroup.add(cpGroup);
  }

  // 13. Grand Finish Line Arch
  const finishGroup = new THREE.Group();
  finishGroup.position.set(course.finishX, 0, course.finishZ);

  const archSpan = course.finishHalfWidth * 1.9;
  const pillarL = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.65, 0.85, 9.5, 14)), dangerBuoyMat);
  pillarL.position.set(-archSpan * 0.5, 4.5, 0);
  pillarL.castShadow = true;
  const pillarR = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.65, 0.85, 9.5, 14)), dangerBuoyMat);
  pillarR.position.set(archSpan * 0.5, 4.5, 0);
  pillarR.castShadow = true;

  const bannerMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.finishCheckerMap,
      roughness: 0.4,
    }),
  );
  const banner = new THREE.Mesh(regGeo(new THREE.BoxGeometry(archSpan + 1.2, 2.4, 0.7)), bannerMat);
  banner.position.set(0, 8.2, 0);
  banner.castShadow = true;

  const finishGlow = new THREE.Mesh(
    regGeo(new THREE.PlaneGeometry(archSpan, 2.2)),
    regMat(
      new THREE.MeshBasicMaterial({
        color: 0x06d6a0,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  finishGlow.rotation.x = -Math.PI / 2;
  finishGlow.position.y = 0.06;

  finishGroup.add(pillarL, pillarR, banner, finishGlow);
  worldChunksGroup.add(finishGroup);

  // 14. Realistic Pickups & Cans (GAME-01)
  const pickupMeshes = new Map<string, THREE.Group>();
  for (const pk of course.pickups ?? []) {
    const model = createPickupModel(pk.kind, textures);
    model.position.set(pk.x, 0, pk.z);
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.geometry) trackedGeos.add(obj.geometry);
        if (Array.isArray(obj.material)) obj.material.forEach((m) => trackedMats.add(m));
        else if (obj.material) trackedMats.add(obj.material);
      }
    });
    worldChunksGroup.add(model);
    pickupMeshes.set(pk.id, model);
  }

  return {
    rootGroup,
    worldChunksGroup,
    skyDome,
    waterMesh,
    waterMat,
    waterUniforms,
    finishGroup,
    staticObstacleGroups,
    movingGateMeshes,
    pistonGlowMats,
    spinningGearParts,
    bumperMeshes,
    checkpointFlags,
    checkpointRings,
    boostMeshes,
    fallingRockMeshes,
    fallingRingMeshes,
    dynamicZoneMeshes,
    windFanBlades,
    windStreamMeshes,
    heatRingMeshes,
    waterfallRibbons,
    pickupMeshes,
    lighthouseBeacons,
    lightningLight,
    dispose: () => {
      scene.remove(rootGroup);
      for (const g of trackedGeos) g.dispose();
      for (const m of trackedMats) m.dispose();
    },
  };
}
