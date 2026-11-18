import * as THREE from 'three';
import type { BoostCanKind, CourseId } from '../shared/types.ts';

export interface ProceduralTextures {
  woodMap: THREE.CanvasTexture;
  woodBump: THREE.CanvasTexture;
  hazardStripeMap: THREE.CanvasTexture;
  finishCheckerMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  stoneMap: THREE.CanvasTexture;
  metalPlateMap: THREE.CanvasTexture;
  iceMap: THREE.CanvasTexture;
  lavaMap: THREE.CanvasTexture;
  conveyorMap: THREE.CanvasTexture;
  canLabels: Record<BoostCanKind, THREE.CanvasTexture>;
  crateMap: THREE.CanvasTexture;
  shieldHexMap: THREE.CanvasTexture;
  skyMaps: Record<CourseId, THREE.CanvasTexture>;
  dispose: () => void;
}

function makeSkyTexture(
  topHex: string,
  midHex: string,
  horizonHex: string,
  drawOverlay: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, topHex);
  grad.addColorStop(0.45, midHex);
  grad.addColorStop(0.68, horizonHex);
  grad.addColorStop(1.0, horizonHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  drawOverlay(ctx, 512, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextures {
  // 1. Warm Cartoon Wood Grain Texture
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 256;
  woodCanvas.height = 256;
  const wctx = woodCanvas.getContext('2d')!;
  wctx.fillStyle = '#c88242';
  wctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 48; i++) {
    const y = (i / 48) * 256;
    wctx.fillStyle = i % 2 === 0 ? 'rgba(130, 68, 22, 0.22)' : 'rgba(255, 214, 153, 0.16)';
    wctx.fillRect(0, y, 256, 3);
  }
  for (let p = 0; p < 4; p++) {
    const px = p * 64;
    wctx.fillStyle = 'rgba(72, 34, 10, 0.48)';
    wctx.fillRect(px, 0, 4, 256);
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

  // 6. Layered Stone / Cliff Texture
  const stoneCanvas = document.createElement('canvas');
  stoneCanvas.width = 256;
  stoneCanvas.height = 256;
  const stctx = stoneCanvas.getContext('2d')!;
  stctx.fillStyle = '#7b7470';
  stctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 18; i++) {
    stctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(20,16,14,0.14)';
    stctx.fillRect(0, i * 14, 256, 6);
  }
  stctx.strokeStyle = 'rgba(15, 12, 12, 0.32)';
  stctx.lineWidth = 2;
  for (let c = 0; c < 14; c++) {
    const cx = (c * 43) % 256;
    const cy = (c * 71) % 256;
    stctx.beginPath();
    stctx.moveTo(cx, cy);
    stctx.lineTo(cx + 26, cy + 19);
    stctx.lineTo(cx + 12, cy + 41);
    stctx.stroke();
  }
  const stoneMap = new THREE.CanvasTexture(stoneCanvas);
  stoneMap.colorSpace = THREE.SRGBColorSpace;
  stoneMap.wrapS = THREE.RepeatWrapping;
  stoneMap.wrapT = THREE.RepeatWrapping;
  stoneMap.anisotropy = maxAnisotropy;

  // 7. Industrial Brushed Steel & Rivets Texture (Factory)
  const metalCanvas = document.createElement('canvas');
  metalCanvas.width = 256;
  metalCanvas.height = 256;
  const mctx = metalCanvas.getContext('2d')!;
  mctx.fillStyle = '#4a5568';
  mctx.fillRect(0, 0, 256, 256);
  mctx.strokeStyle = '#2d3748';
  mctx.lineWidth = 4;
  mctx.strokeRect(2, 2, 124, 124);
  mctx.strokeRect(130, 2, 124, 124);
  mctx.strokeRect(2, 130, 124, 124);
  mctx.strokeRect(130, 130, 124, 124);
  mctx.fillStyle = '#718096';
  for (const px of [14, 114, 142, 242]) {
    for (const py of [14, 114, 142, 242]) {
      mctx.beginPath();
      mctx.arc(px, py, 4, 0, Math.PI * 2);
      mctx.fill();
    }
  }
  const metalPlateMap = new THREE.CanvasTexture(metalCanvas);
  metalPlateMap.colorSpace = THREE.SRGBColorSpace;
  metalPlateMap.wrapS = THREE.RepeatWrapping;
  metalPlateMap.wrapT = THREE.RepeatWrapping;
  metalPlateMap.anisotropy = maxAnisotropy;

  // 8. Crystalline Cracked Ice Texture (Glacial)
  const iceCanvas = document.createElement('canvas');
  iceCanvas.width = 256;
  iceCanvas.height = 256;
  const ictx = iceCanvas.getContext('2d')!;
  const iceGrad = ictx.createLinearGradient(0, 0, 256, 256);
  iceGrad.addColorStop(0, '#c8f6ff');
  iceGrad.addColorStop(0.5, '#90e0ef');
  iceGrad.addColorStop(1, '#caf0f8');
  ictx.fillStyle = iceGrad;
  ictx.fillRect(0, 0, 256, 256);
  ictx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ictx.lineWidth = 2.5;
  for (let i = 0; i < 16; i++) {
    const sx = (i * 53) % 256;
    const sy = (i * 37) % 256;
    ictx.beginPath();
    ictx.moveTo(sx, sy);
    ictx.lineTo(sx + 48, sy + 24);
    ictx.lineTo(sx + 20, sy + 64);
    ictx.stroke();
  }
  const iceMap = new THREE.CanvasTexture(iceCanvas);
  iceMap.colorSpace = THREE.SRGBColorSpace;
  iceMap.wrapS = THREE.RepeatWrapping;
  iceMap.wrapT = THREE.RepeatWrapping;
  iceMap.anisotropy = maxAnisotropy;

  // 9. Cracked Volcanic Magma Texture (Volcanic)
  const lavaCanvas = document.createElement('canvas');
  lavaCanvas.width = 256;
  lavaCanvas.height = 256;
  const lctx = lavaCanvas.getContext('2d')!;
  lctx.fillStyle = '#241417';
  lctx.fillRect(0, 0, 256, 256);
  lctx.strokeStyle = '#ff6d00';
  lctx.lineWidth = 5;
  for (let i = 0; i < 12; i++) {
    const lx = (i * 61) % 256;
    const ly = (i * 41) % 256;
    lctx.beginPath();
    lctx.moveTo(lx, ly);
    lctx.lineTo(lx + 42, ly + 28);
    lctx.lineTo(lx + 18, ly + 72);
    lctx.stroke();
  }
  lctx.strokeStyle = '#ffd166';
  lctx.lineWidth = 1.8;
  for (let i = 0; i < 12; i++) {
    const lx = (i * 61) % 256;
    const ly = (i * 41) % 256;
    lctx.beginPath();
    lctx.moveTo(lx, ly);
    lctx.lineTo(lx + 42, ly + 28);
    lctx.stroke();
  }
  const lavaMap = new THREE.CanvasTexture(lavaCanvas);
  lavaMap.colorSpace = THREE.SRGBColorSpace;
  lavaMap.wrapS = THREE.RepeatWrapping;
  lavaMap.wrapT = THREE.RepeatWrapping;
  lavaMap.anisotropy = maxAnisotropy;

  // 10. Directional Conveyor / Current Chevron Arrows
  const convCanvas = document.createElement('canvas');
  convCanvas.width = 128;
  convCanvas.height = 128;
  const vctx = convCanvas.getContext('2d')!;
  vctx.fillStyle = '#073b4c';
  vctx.fillRect(0, 0, 128, 128);
  vctx.strokeStyle = '#00f5d4';
  vctx.lineWidth = 14;
  vctx.lineCap = 'round';
  vctx.lineJoin = 'round';
  for (const cy of [42, 96]) {
    vctx.beginPath();
    vctx.moveTo(24, cy + 20);
    vctx.lineTo(64, cy - 16);
    vctx.lineTo(104, cy + 20);
    vctx.stroke();
  }
  const conveyorMap = new THREE.CanvasTexture(convCanvas);
  conveyorMap.colorSpace = THREE.SRGBColorSpace;
  conveyorMap.wrapS = THREE.RepeatWrapping;
  conveyorMap.wrapT = THREE.RepeatWrapping;
  conveyorMap.anisotropy = maxAnisotropy;

  // 11. Custom Equirectangular Sky Dome Maps per World
  const skyMaps: Record<CourseId, THREE.CanvasTexture> = {
    tropical: makeSkyTexture('#1597e5', '#69d2ff', '#d9f9ff', (ctx) => {
      // Sun halo + crisp stylized clouds
      const sun = ctx.createRadialGradient(380, 92, 6, 380, 92, 72);
      sun.addColorStop(0, 'rgba(255, 250, 210, 0.95)');
      sun.addColorStop(0.35, 'rgba(255, 232, 150, 0.45)');
      sun.addColorStop(1, 'rgba(255, 232, 150, 0)');
      ctx.fillStyle = sun;
      ctx.fillRect(300, 15, 160, 160);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      for (const [cx, cy, r] of [
        [85, 118, 22],
        [110, 112, 26],
        [136, 120, 19],
        [240, 128, 20],
        [266, 122, 25],
        [435, 116, 22],
        [462, 122, 18],
      ]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
    volcanic: makeSkyTexture('#1a0a16', '#5c191b', '#d94e1f', (ctx) => {
      // Fiery caldera glow & smoke bands
      const ember = ctx.createRadialGradient(256, 155, 12, 256, 155, 150);
      ember.addColorStop(0, 'rgba(255, 145, 36, 0.68)');
      ember.addColorStop(0.5, 'rgba(217, 56, 30, 0.32)');
      ember.addColorStop(1, 'rgba(92, 25, 27, 0)');
      ctx.fillStyle = ember;
      ctx.fillRect(90, 20, 340, 210);

      ctx.fillStyle = 'rgba(22, 10, 14, 0.48)';
      for (const [cx, cy, rx, ry] of [
        [110, 88, 72, 14],
        [320, 74, 86, 16],
        [430, 104, 65, 12],
      ]) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
    glacial: makeSkyTexture('#07132b', '#124670', '#8be4f8', (ctx) => {
      // Flowing Polar Aurora Borealis ribbons + crisp arctic stars
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      for (let i = 0; i < 42; i++) {
        ctx.fillRect((i * 89) % 512, (i * 37) % 108, 2, 2);
      }
      const aurora = ctx.createLinearGradient(0, 48, 512, 125);
      aurora.addColorStop(0, 'rgba(86, 245, 198, 0)');
      aurora.addColorStop(0.28, 'rgba(64, 249, 176, 0.58)');
      aurora.addColorStop(0.58, 'rgba(114, 239, 221, 0.62)');
      aurora.addColorStop(0.84, 'rgba(181, 124, 255, 0.42)');
      aurora.addColorStop(1, 'rgba(86, 245, 198, 0)');
      ctx.strokeStyle = aurora;
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(20, 96);
      ctx.bezierCurveTo(150, 44, 340, 128, 492, 68);
      ctx.stroke();
    }),
    factory: makeSkyTexture('#10151f', '#242c3b', '#4d586b', (ctx) => {
      // Industrial roof skylight glow + steel cross-frame pattern
      for (let x = 0; x < 512; x += 64) {
        const glow = ctx.createRadialGradient(x + 32, 64, 4, x + 32, 64, 36);
        glow.addColorStop(0, 'rgba(255, 196, 82, 0.46)');
        glow.addColorStop(1, 'rgba(255, 196, 82, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x, 28, 64, 72);
      }
      ctx.strokeStyle = 'rgba(12, 16, 24, 0.65)';
      ctx.lineWidth = 5;
      for (let x = 0; x <= 512; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 256);
        ctx.stroke();
      }
    }),
    storm: makeSkyTexture('#050a14', '#162436', '#283c52', (ctx) => {
      // Heavy storm cloud layers & subtle electric lightning rim glow
      for (const [cx, cy, rx, ry, alpha] of [
        [95, 92, 90, 26, 0.55],
        [240, 78, 110, 32, 0.62],
        [400, 96, 95, 28, 0.52],
        [165, 128, 125, 22, 0.4],
        [350, 124, 120, 24, 0.44],
      ] as const) {
        ctx.fillStyle = `rgba(10, 18, 30, ${alpha})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const arcGlow = ctx.createRadialGradient(340, 118, 4, 340, 118, 92);
      arcGlow.addColorStop(0, 'rgba(186, 230, 253, 0.45)');
      arcGlow.addColorStop(0.4, 'rgba(56, 189, 248, 0.16)');
      arcGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = arcGlow;
      ctx.fillRect(240, 26, 200, 190);
    }),
  };

  // 12. Ultra-Detailed Tin Can Wrap Labels (Lentil > Fava > Kidney Bean)
  const makeCanLabel = (opts: {
    bgTop: string;
    bgBot: string;
    bandColor: string;
    goldTrim: string;
    titleAr: string;
    badgeText: string;
    drawBeans: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void;
  }): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 512, 256);
    grad.addColorStop(0, opts.bgTop);
    grad.addColorStop(0.5, opts.bgBot);
    grad.addColorStop(1, opts.bgTop);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Subtle paper print ridges & seam
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 18; y < 238; y += 8) {
      ctx.fillRect(0, y, 512, 2);
    }

    // Gold top and bottom printed foil borders
    ctx.fillStyle = opts.goldTrim;
    ctx.fillRect(0, 0, 512, 18);
    ctx.fillRect(0, 238, 512, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 18, 512, 4);
    ctx.fillRect(0, 234, 512, 4);

    // Cream central heritage emblem band
    ctx.fillStyle = opts.bandColor;
    ctx.fillRect(0, 44, 512, 168);
    ctx.strokeStyle = opts.goldTrim;
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 50, 492, 156);

    // Draw illustration on both front (x=256) and back (x=64 / x=448) so label looks real from 360 deg
    opts.drawBeans(ctx, 256, 148);

    // Crisp Arabic Brand Title + Boost Badge
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 40px "Cairo", "Segoe UI", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#141e28';
    ctx.strokeText(opts.titleAr, 256, 86);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(opts.titleAr, 256, 86);

    // Side metallic nutrition / barcode strip (authentic canned food touch)
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(26, 74, 86, 108);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.strokeRect(26, 74, 86, 108);
    ctx.fillStyle = '#0f172a';
    for (let bx = 34; bx < 104; bx += 5) {
      ctx.fillRect(bx, 134, (bx % 3 === 0 ? 3 : 1.5), 38);
    }
    ctx.font = '800 13px "Cairo", sans-serif';
    ctx.fillText('طاقة بحرية', 69, 92);
    ctx.fillStyle = '#b91c1c';
    ctx.font = '900 18px sans-serif';
    ctx.fillText(opts.badgeText, 69, 114);

    // Opposite side stamp
    ctx.fillStyle = opts.goldTrim;
    ctx.beginPath();
    ctx.arc(432, 128, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#141e28';
    ctx.font = '900 19px sans-serif';
    ctx.fillText(opts.badgeText, 432, 129);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = maxAnisotropy;
    return tex;
  };

  const canLabels: Record<BoostCanKind, THREE.CanvasTexture> = {
    lentil_can: makeCanLabel({
      bgTop: '#b45309',
      bgBot: '#ea580c',
      bandColor: '#7c2d12',
      goldTrim: '#fbbf24',
      titleAr: 'عدس فاخر',
      badgeText: '+65%',
      drawBeans: (ctx, cx, cy) => {
        // Golden terracotta bowl + mound of bright orange-gold lentils
        ctx.fillStyle = '#fffbeb';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 12, 62, 22, 0, 0, Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.stroke();

        const lentilColors = ['#f97316', '#fb923c', '#f59e0b', '#fbbf24'];
        for (let i = 0; i < 36; i++) {
          const lx = cx - 44 + ((i * 19) % 88);
          const ly = cy + 6 - Math.abs(Math.sin(i * 1.3)) * 18;
          ctx.fillStyle = lentilColors[i % lentilColors.length];
          ctx.beginPath();
          ctx.ellipse(lx, ly, 6.5, 4.2, (i * 0.4) % Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    }),
    fava_can: makeCanLabel({
      bgTop: '#065f46',
      bgBot: '#059669',
      bandColor: '#064e3b',
      goldTrim: '#fcd34d',
      titleAr: 'فول مدمس',
      badgeText: '+38%',
      drawBeans: (ctx, cx, cy) => {
        // Copper pot silhouette + rich fava beans & olive oil sheen
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 14, 58, 20, 0, 0, Math.PI);
        ctx.fill();
        const favaColors = ['#78350f', '#92400e', '#a16207', '#65a30d'];
        for (let i = 0; i < 22; i++) {
          const fx = cx - 42 + ((i * 23) % 84);
          const fy = cy + 8 - Math.abs(Math.cos(i * 0.9)) * 16;
          ctx.fillStyle = favaColors[i % favaColors.length];
          ctx.beginPath();
          ctx.ellipse(fx, fy, 9, 5.5, (i * 0.5) % Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    }),
    bean_can: makeCanLabel({
      bgTop: '#991b1b',
      bgBot: '#dc2626',
      bandColor: '#7f1d1d',
      goldTrim: '#fde68a',
      titleAr: 'فاصولياء',
      badgeText: '+20%',
      drawBeans: (ctx, cx, cy) => {
        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 14, 56, 20, 0, 0, Math.PI);
        ctx.fill();
        const beanColors = ['#7f1d1d', '#b91c1c', '#dc2626', '#9a3412'];
        for (let i = 0; i < 20; i++) {
          const bx = cx - 40 + ((i * 21) % 80);
          const by = cy + 7 - Math.abs(Math.sin(i * 1.1)) * 15;
          ctx.fillStyle = beanColors[i % beanColors.length];
          ctx.beginPath();
          ctx.ellipse(bx, by, 8.5, 4.8, (i * 0.7) % Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    }),
  };

  // 13. Slatted Supply Crate Texture
  const crateCanvas = document.createElement('canvas');
  crateCanvas.width = 256;
  crateCanvas.height = 256;
  const crCtx = crateCanvas.getContext('2d')!;
  crCtx.fillStyle = '#c88d48';
  crCtx.fillRect(0, 0, 256, 256);
  crCtx.fillStyle = '#a86f30';
  for (let y = 0; y < 256; y += 42) {
    crCtx.fillRect(0, y, 256, 5);
  }
  crCtx.strokeStyle = '#6b4218';
  crCtx.lineWidth = 22;
  crCtx.strokeRect(11, 11, 234, 234);
  crCtx.beginPath();
  crCtx.moveTo(22, 22);
  crCtx.lineTo(234, 234);
  crCtx.stroke();
  crCtx.fillStyle = '#ffe066';
  crCtx.strokeStyle = '#14222f';
  crCtx.lineWidth = 8;
  crCtx.font = '900 112px sans-serif';
  crCtx.textAlign = 'center';
  crCtx.textBaseline = 'middle';
  crCtx.strokeText('؟', 128, 134);
  crCtx.fillText('؟', 128, 134);
  const crateMap = new THREE.CanvasTexture(crateCanvas);
  crateMap.colorSpace = THREE.SRGBColorSpace;
  crateMap.anisotropy = maxAnisotropy;

  // 14. Glowing Cyan Hexagonal Shield Grid Texture
  const hexCanvas = document.createElement('canvas');
  hexCanvas.width = 256;
  hexCanvas.height = 256;
  const hctx = hexCanvas.getContext('2d')!;
  hctx.clearRect(0, 0, 256, 256);
  hctx.strokeStyle = 'rgba(125, 249, 255, 0.88)';
  hctx.lineWidth = 3;
  const r = 26;
  const dx = r * 1.5;
  const dy = r * Math.sqrt(3);
  for (let row = -1; row < 8; row++) {
    for (let col = -1; col < 9; col++) {
      const cx = col * dx;
      const cy = row * dy + (col % 2 === 0 ? 0 : dy * 0.5);
      hctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const px = cx + Math.cos(a) * (r - 2);
        const py = cy + Math.sin(a) * (r - 2);
        if (k === 0) hctx.moveTo(px, py);
        else hctx.lineTo(px, py);
      }
      hctx.closePath();
      hctx.stroke();
    }
  }
  const shieldHexMap = new THREE.CanvasTexture(hexCanvas);
  shieldHexMap.colorSpace = THREE.SRGBColorSpace;
  shieldHexMap.wrapS = THREE.RepeatWrapping;
  shieldHexMap.wrapT = THREE.RepeatWrapping;
  shieldHexMap.repeat.set(3, 2);

  return {
    woodMap,
    woodBump,
    hazardStripeMap,
    finishCheckerMap,
    contactShadowMap,
    stoneMap,
    metalPlateMap,
    iceMap,
    lavaMap,
    conveyorMap,
    canLabels,
    crateMap,
    shieldHexMap,
    skyMaps,
    dispose: () => {
      woodMap.dispose();
      woodBump.dispose();
      hazardStripeMap.dispose();
      finishCheckerMap.dispose();
      contactShadowMap.dispose();
      stoneMap.dispose();
      metalPlateMap.dispose();
      iceMap.dispose();
      lavaMap.dispose();
      conveyorMap.dispose();
      crateMap.dispose();
      shieldHexMap.dispose();
      Object.values(canLabels).forEach((t) => t.dispose());
      Object.values(skyMaps).forEach((t) => t.dispose());
    },
  };
}
