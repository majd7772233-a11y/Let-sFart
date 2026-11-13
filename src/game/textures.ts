import * as THREE from 'three';

export interface ProceduralTextures {
  woodMap: THREE.CanvasTexture;
  woodBump: THREE.CanvasTexture;
  hazardStripeMap: THREE.CanvasTexture;
  finishCheckerMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextures {
  // 1. Warm Cartoon Wood Grain Texture
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 256;
  woodCanvas.height = 256;
  const wctx = woodCanvas.getContext('2d')!;
  wctx.fillStyle = '#c88242';
  wctx.fillRect(0, 0, 256, 256);

  // Plank seams & wood grain streaks
  for (let i = 0; i < 48; i++) {
    const y = (i / 48) * 256;
    wctx.fillStyle = i % 2 === 0 ? 'rgba(130, 68, 22, 0.22)' : 'rgba(255, 214, 153, 0.16)';
    wctx.fillRect(0, y, 256, 3);
  }
  for (let p = 0; p < 4; p++) {
    const px = p * 64;
    wctx.fillStyle = 'rgba(72, 34, 10, 0.48)';
    wctx.fillRect(px, 0, 4, 256);
    // Knot circles
    wctx.beginPath();
    wctx.ellipse(px + 32, 60 + p * 44, 10, 18, 0.1, 0, Math.PI * 2);
    wctx.strokeStyle = 'rgba(92, 46, 16, 0.35)';
    wctx.lineWidth = 3;
    wctx.stroke();
  }
  const woodMap = new THREE.CanvasTexture(woodCanvas);
  woodMap.colorSpace = THREE.SRGBColorSpace;
  woodMap.wrapS = THREE.RepeatWrapping;
  woodMap.wrapT = THREE.RepeatWrapping;
  woodMap.anisotropy = maxAnisotropy;

  // 2. Wood Bump Map (Linear space)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 64; i++) {
    bctx.fillStyle = i % 2 === 0 ? '#a0a0a0' : '#646464';
    bctx.fillRect(0, i * 4, 256, 2);
  }
  for (let p = 0; p < 4; p++) {
    bctx.fillStyle = '#202020';
    bctx.fillRect(p * 64, 0, 4, 256);
  }
  const woodBump = new THREE.CanvasTexture(bumpCanvas);
  woodBump.wrapS = THREE.RepeatWrapping;
  woodBump.wrapT = THREE.RepeatWrapping;
  woodBump.anisotropy = maxAnisotropy;

  // 3. Warning Hazard Stripes (Yellow/Orange & Dark Navy)
  const stripeCanvas = document.createElement('canvas');
  stripeCanvas.width = 256;
  stripeCanvas.height = 128;
  const sctx = stripeCanvas.getContext('2d')!;
  sctx.fillStyle = '#ffb703';
  sctx.fillRect(0, 0, 256, 128);
  sctx.fillStyle = '#1b263b';
  for (let x = -128; x < 384; x += 48) {
    sctx.beginPath();
    sctx.moveTo(x, 0);
    sctx.lineTo(x + 24, 0);
    sctx.lineTo(x + 88, 128);
    sctx.lineTo(x + 64, 128);
    sctx.closePath();
    sctx.fill();
  }
  const hazardStripeMap = new THREE.CanvasTexture(stripeCanvas);
  hazardStripeMap.colorSpace = THREE.SRGBColorSpace;
  hazardStripeMap.wrapS = THREE.RepeatWrapping;
  hazardStripeMap.wrapT = THREE.RepeatWrapping;
  hazardStripeMap.anisotropy = maxAnisotropy;

  // 4. Checkered Finish Banner
  const chkCanvas = document.createElement('canvas');
  chkCanvas.width = 256;
  chkCanvas.height = 128;
  const cctx = chkCanvas.getContext('2d')!;
  const size = 32;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      cctx.fillStyle = (x + y) % 2 === 0 ? '#fffdf5' : '#14213d';
      cctx.fillRect(x * size, y * size, size, size);
    }
  }
  const finishCheckerMap = new THREE.CanvasTexture(chkCanvas);
  finishCheckerMap.colorSpace = THREE.SRGBColorSpace;
  finishCheckerMap.wrapS = THREE.RepeatWrapping;
  finishCheckerMap.wrapT = THREE.RepeatWrapping;
  finishCheckerMap.anisotropy = maxAnisotropy;

  // 5. Soft Radial Contact Shadow Disc
  const shadCanvas = document.createElement('canvas');
  shadCanvas.width = 128;
  shadCanvas.height = 128;
  const shctx = shadCanvas.getContext('2d')!;
  const grad = shctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(8, 22, 38, 0.72)');
  grad.addColorStop(0.6, 'rgba(8, 22, 38, 0.3)');
  grad.addColorStop(1, 'rgba(8, 22, 38, 0)');
  shctx.fillStyle = grad;
  shctx.fillRect(0, 0, 128, 128);
  const contactShadowMap = new THREE.CanvasTexture(shadCanvas);
  contactShadowMap.colorSpace = THREE.SRGBColorSpace;

  return {
    woodMap,
    woodBump,
    hazardStripeMap,
    finishCheckerMap,
    contactShadowMap,
    dispose: () => {
      woodMap.dispose();
      woodBump.dispose();
      hazardStripeMap.dispose();
      finishCheckerMap.dispose();
      contactShadowMap.dispose();
    },
  };
}
