import * as THREE from 'three';
import { sampleMotionTrailRgb } from '../shared/cosmetics.ts';
import type { MotionTrailId } from '../shared/types.ts';

interface PoolParticle {
  active: boolean;
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  baseScale: number;
  growRate: number;
  r: number;
  g: number;
  b: number;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export type AmbientWeatherTheme = 'mist' | 'embers' | 'snow' | 'sparks' | 'rain';

export class ParticlePoolSystem {
  public readonly fartMesh: THREE.InstancedMesh;
  public readonly splashMesh: THREE.InstancedMesh;
  public readonly ambientMesh: THREE.InstancedMesh;

  private fartPool: PoolParticle[] = [];
  private splashPool: PoolParticle[] = [];
  private ambientPool: PoolParticle[] = [];
  private fartCursor = 0;
  private splashCursor = 0;
  private ambientCursor = 0;
  private ambientSpawnAccum = 0;

  constructor(scene: THREE.Scene) {
    const fartGeo = new THREE.IcosahedronGeometry(0.32, 1);
    const fartMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.75,
      metalness: 0.0,
      transparent: true,
      opacity: 0.88,
    });
    const fartCount = 160;
    this.fartMesh = new THREE.InstancedMesh(fartGeo, fartMat, fartCount);
    this.fartMesh.frustumCulled = false;
    this.fartMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < fartCount; i++) {
      this.fartPool.push({
        active: false,
        life: 0,
        maxLife: 1,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        baseScale: 0,
        growRate: 1,
        r: 0.55,
        g: 0.9,
        b: 0.2,
      });
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      this.fartMesh.setMatrixAt(i, _dummy.matrix);
      this.fartMesh.setColorAt(i, _color.setRGB(0.55, 0.9, 0.2));
    }
    this.fartMesh.instanceMatrix.needsUpdate = true;
    if (this.fartMesh.instanceColor) this.fartMesh.instanceColor.needsUpdate = true;
    scene.add(this.fartMesh);

    // Water splash & impact burst pool (per-instance RGB colored)
    const splashGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const splashMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
    });
    const splashCount = 140;
    this.splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, splashCount);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < splashCount; i++) {
      this.splashPool.push({
        active: false,
        life: 0,
        maxLife: 1,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        baseScale: 0,
        growRate: 0,
        r: 0.85,
        g: 0.97,
        b: 1.0,
      });
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      this.splashMesh.setMatrixAt(i, _dummy.matrix);
      this.splashMesh.setColorAt(i, _color.setRGB(0.85, 0.97, 1.0));
    }
    this.splashMesh.instanceMatrix.needsUpdate = true;
    if (this.splashMesh.instanceColor) this.splashMesh.instanceColor.needsUpdate = true;
    scene.add(this.splashMesh);

    // World ambient weather particles (snow / embers / sparks / mist)
    const ambientGeo = new THREE.OctahedronGeometry(0.16, 0);
    const ambientMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
    });
    const ambientCount = 90;
    this.ambientMesh = new THREE.InstancedMesh(ambientGeo, ambientMat, ambientCount);
    this.ambientMesh.frustumCulled = false;
    this.ambientMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < ambientCount; i++) {
      this.ambientPool.push({
        active: false,
        life: 0,
        maxLife: 1,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        baseScale: 0,
        growRate: 0,
        r: 1,
        g: 1,
        b: 1,
      });
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      this.ambientMesh.setMatrixAt(i, _dummy.matrix);
      this.ambientMesh.setColorAt(i, _color.setRGB(1, 1, 1));
    }
    this.ambientMesh.instanceMatrix.needsUpdate = true;
    if (this.ambientMesh.instanceColor) this.ambientMesh.instanceColor.needsUpdate = true;
    scene.add(this.ambientMesh);
  }

  public spawnFartPuff(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    power: number,
    superFart = false,
    trail?: MotionTrailId,
  ): void {
    const p = this.fartPool[this.fartCursor];
    this.fartCursor = (this.fartCursor + 1) % this.fartPool.length;

    const speed = (superFart ? 7.2 : 4.5) + power * 9.5;
    const spread = 0.6 + power * 1.4;
    p.active = true;
    p.life = 0;
    p.maxLife = (superFart ? 0.65 : 0.45) + power * 0.45;
    p.x = x + (Math.random() - 0.5) * 0.25;
    p.y = y + (Math.random() - 0.5) * 0.2;
    p.z = z + (Math.random() - 0.5) * 0.25;
    p.vx = dirX * speed + (Math.random() - 0.5) * spread;
    p.vy = 0.65 + Math.random() * 1.3 + power * 0.8;
    p.vz = dirZ * speed + (Math.random() - 0.5) * spread;
    p.baseScale = (superFart ? 0.72 : 0.45) + power * 1.05;
    p.growRate = 1.1 + power * 1.4;

    const [r, g, b] = sampleMotionTrailRgb(trail, power, superFart, Math.random());
    p.r = r;
    p.g = g;
    p.b = b;
  }

  public spawnSplash(x: number, y: number, z: number, count: number, speedScale = 1): void {
    for (let i = 0; i < count; i++) {
      const p = this.splashPool[this.splashCursor];
      this.splashCursor = (this.splashCursor + 1) % this.splashPool.length;

      const angle = Math.random() * Math.PI * 2;
      const horiz = (1.5 + Math.random() * 4.2) * speedScale;
      p.active = true;
      p.life = 0;
      p.maxLife = 0.45 + Math.random() * 0.35;
      p.x = x + (Math.random() - 0.5) * 0.8;
      p.y = y;
      p.z = z + (Math.random() - 0.5) * 0.8;
      p.vx = Math.cos(angle) * horiz;
      p.vy = (3.2 + Math.random() * 4.5) * speedScale;
      p.vz = Math.sin(angle) * horiz;
      p.baseScale = 0.55 + Math.random() * 0.75;
      p.growRate = -0.3;
      p.r = 0.86;
      p.g = 0.97;
      p.b = 1.0;
    }
  }

  public spawnImpactBurst(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count = 16,
    speedScale = 1.25,
  ): void {
    _color.setHex(colorHex);
    for (let i = 0; i < count; i++) {
      const p = this.splashPool[this.splashCursor];
      this.splashCursor = (this.splashCursor + 1) % this.splashPool.length;

      const angle = Math.random() * Math.PI * 2;
      const horiz = (2.0 + Math.random() * 5.2) * speedScale;
      p.active = true;
      p.life = 0;
      p.maxLife = 0.45 + Math.random() * 0.4;
      p.x = x + (Math.random() - 0.5) * 1.1;
      p.y = y;
      p.z = z + (Math.random() - 0.5) * 1.1;
      p.vx = Math.cos(angle) * horiz;
      p.vy = (3.5 + Math.random() * 5.5) * speedScale;
      p.vz = Math.sin(angle) * horiz;
      p.baseScale = 0.65 + Math.random() * 0.85;
      p.growRate = -0.25;
      p.r = _color.r;
      p.g = _color.g;
      p.b = _color.b;
    }
  }

  public clearAmbient(): void {
    for (let i = 0; i < this.ambientPool.length; i++) {
      this.ambientPool[i].active = false;
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      this.ambientMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.ambientMesh.instanceMatrix.needsUpdate = true;
  }

  public updateAmbientWeather(
    theme: AmbientWeatherTheme,
    centerX: number,
    centerZ: number,
    dt: number,
    windX = 0,
    windZ = 0,
  ): void {
    const rate = theme === 'rain' ? 0.015 : theme === 'mist' ? 0.09 : theme === 'sparks' ? 0.055 : 0.032;
    this.ambientSpawnAccum += dt;
    while (this.ambientSpawnAccum >= rate) {
      this.ambientSpawnAccum -= rate;
      const p = this.ambientPool[this.ambientCursor];
      this.ambientCursor = (this.ambientCursor + 1) % this.ambientPool.length;

      p.active = true;
      p.life = 0;
      p.x = centerX + (Math.random() - 0.5) * 34;
      p.z = centerZ - 20 + Math.random() * 34;

      if (theme === 'rain') {
        p.maxLife = 0.72 + Math.random() * 0.35;
        p.y = 14 + Math.random() * 4;
        p.vx = windX * 0.85 + (Math.random() - 0.5) * 1.8;
        p.vy = -(22 + Math.random() * 7);
        p.vz = windZ * 0.85 + (Math.random() - 0.5) * 1.8;
        p.baseScale = 0.35 + Math.random() * 0.22;
        p.r = 0.72;
        p.g = 0.89;
        p.b = 1.0;
      } else if (theme === 'embers') {
        p.maxLife = 1.6 + Math.random() * 1.2;
        p.y = 0.2 + Math.random() * 1.5;
        p.vx = (Math.random() - 0.5) * 2.2;
        p.vy = 2.6 + Math.random() * 3.4;
        p.vz = (Math.random() - 0.5) * 2.2;
        p.baseScale = 0.55 + Math.random() * 0.65;
        p.r = 1.0;
        p.g = 0.4 + Math.random() * 0.45;
        p.b = 0.08;
      } else if (theme === 'snow') {
        p.maxLife = 2.4 + Math.random() * 1.4;
        p.y = 9.5 + Math.random() * 4.5;
        p.vx = (Math.random() - 0.5) * 1.6;
        p.vy = -(2.4 + Math.random() * 1.8);
        p.vz = (Math.random() - 0.5) * 1.4;
        p.baseScale = 0.55 + Math.random() * 0.55;
        p.r = 0.88;
        p.g = 0.97;
        p.b = 1.0;
      } else if (theme === 'sparks') {
        p.maxLife = 0.85 + Math.random() * 0.7;
        p.y = 4.5 + Math.random() * 5.5;
        p.vx = (Math.random() - 0.5) * 5.0;
        p.vy = -(3.2 + Math.random() * 3.5);
        p.vz = (Math.random() - 0.5) * 4.0;
        p.baseScale = 0.42 + Math.random() * 0.48;
        p.r = 1.0;
        p.g = 0.76 + Math.random() * 0.24;
        p.b = 0.22;
      } else {
        // mist
        p.maxLife = 1.5 + Math.random() * 1.0;
        p.y = 0.35 + Math.random() * 1.8;
        p.vx = (Math.random() - 0.5) * 1.5;
        p.vy = 0.75 + Math.random() * 0.9;
        p.vz = (Math.random() - 0.5) * 1.5;
        p.baseScale = 0.6 + Math.random() * 0.65;
        p.r = 0.85;
        p.g = 0.98;
        p.b = 1.0;
      }
    }

    let ambDirty = false;
    for (let i = 0; i < this.ambientPool.length; i++) {
      const p = this.ambientPool[i];
      if (!p.active) continue;
      ambDirty = true;
      p.life += dt;
      if (p.life >= p.maxLife || p.y < -0.5) {
        p.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.ambientMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const t = p.life / p.maxLife;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const fade = t < 0.15 ? t / 0.15 : Math.max(0.001, 1 - (t - 0.15) / 0.85);
      _dummy.position.set(p.x, p.y, p.z);
      if (theme === 'rain') {
        _dummy.rotation.set(0, 0, Math.atan2(p.vx, -p.vy));
        _dummy.scale.set(p.baseScale * 0.42 * fade, p.baseScale * 3.8 * fade, p.baseScale * 0.42 * fade);
      } else {
        _dummy.rotation.set(t * 3.2, t * 2.1, 0);
        _dummy.scale.setScalar(p.baseScale * fade);
      }
      _dummy.updateMatrix();
      this.ambientMesh.setMatrixAt(i, _dummy.matrix);
      this.ambientMesh.setColorAt(i, _color.setRGB(p.r, p.g, p.b));
    }
    if (ambDirty) {
      this.ambientMesh.instanceMatrix.needsUpdate = true;
      if (this.ambientMesh.instanceColor) this.ambientMesh.instanceColor.needsUpdate = true;
    }
  }

  public update(dt: number): void {
    let fartDirty = false;
    for (let i = 0; i < this.fartPool.length; i++) {
      const p = this.fartPool[i];
      if (!p.active) continue;
      fartDirty = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.fartMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const t = p.life / p.maxLife;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.96;
      p.vz *= 0.96;

      const envelope = t < 0.2 ? t / 0.2 : Math.max(0.001, 1 - (t - 0.2) / 0.8);
      const scale = p.baseScale * (1 + t * p.growRate) * envelope;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(t * 2.5, t * 1.8, 0);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      this.fartMesh.setMatrixAt(i, _dummy.matrix);
      this.fartMesh.setColorAt(i, _color.setRGB(p.r, p.g, p.b));
    }
    if (fartDirty) {
      this.fartMesh.instanceMatrix.needsUpdate = true;
      if (this.fartMesh.instanceColor) this.fartMesh.instanceColor.needsUpdate = true;
    }

    let splashDirty = false;
    for (let i = 0; i < this.splashPool.length; i++) {
      const p = this.splashPool[i];
      if (!p.active) continue;
      splashDirty = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.splashMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const t = p.life / p.maxLife;
      p.vy -= 14.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const scale = Math.max(0.001, p.baseScale * (1 - t));
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      this.splashMesh.setMatrixAt(i, _dummy.matrix);
      this.splashMesh.setColorAt(i, _color.setRGB(p.r, p.g, p.b));
    }
    if (splashDirty) {
      this.splashMesh.instanceMatrix.needsUpdate = true;
      if (this.splashMesh.instanceColor) this.splashMesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.fartMesh.geometry.dispose();
    (this.fartMesh.material as THREE.Material).dispose();
    this.splashMesh.geometry.dispose();
    (this.splashMesh.material as THREE.Material).dispose();
    this.ambientMesh.geometry.dispose();
    (this.ambientMesh.material as THREE.Material).dispose();
  }
}
