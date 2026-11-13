import * as THREE from 'three';

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

export class ParticlePoolSystem {
  public readonly fartMesh: THREE.InstancedMesh;
  public readonly splashMesh: THREE.InstancedMesh;

  private fartPool: PoolParticle[] = [];
  private splashPool: PoolParticle[] = [];
  private fartCursor = 0;
  private splashCursor = 0;

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

    // Water splash & foam pool
    const splashGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const splashMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
    });
    const splashCount = 120;
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
  }

  public spawnFartPuff(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    power: number,
  ): void {
    const p = this.fartPool[this.fartCursor];
    this.fartCursor = (this.fartCursor + 1) % this.fartPool.length;

    const speed = 4.5 + power * 9.5;
    const spread = 0.6 + power * 1.4;
    p.active = true;
    p.life = 0;
    p.maxLife = 0.45 + power * 0.45;
    p.x = x + (Math.random() - 0.5) * 0.25;
    p.y = y + (Math.random() - 0.5) * 0.2;
    p.z = z + (Math.random() - 0.5) * 0.25;
    p.vx = dirX * speed + (Math.random() - 0.5) * spread;
    p.vy = 0.65 + Math.random() * 1.3 + power * 0.8;
    p.vz = dirZ * speed + (Math.random() - 0.5) * spread;
    p.baseScale = 0.45 + power * 1.05;
    p.growRate = 1.1 + power * 1.4;

    // Color shifts from soft lime puff -> bright chartreuse -> fiery turbo green-gold
    p.r = 0.48 + power * 0.45;
    p.g = 0.88 - power * 0.08;
    p.b = 0.24 - power * 0.14;
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

      // Pop in fast then shrink smoothly to zero
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
    }
    if (splashDirty) {
      this.splashMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.fartMesh.geometry.dispose();
    (this.fartMesh.material as THREE.Material).dispose();
    this.splashMesh.geometry.dispose();
    (this.splashMesh.material as THREE.Material).dispose();
  }
}
