import * as THREE from 'three';

const hasDom = typeof document !== 'undefined';
const textures = new Map<string, THREE.Texture>();
const library = new Map<string, THREE.Material>();

type Painter = (ctx: CanvasRenderingContext2D, s: number) => void;

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(key: string, paint: Painter, size = 512, srgb = true): THREE.Texture | null {
  if (!hasDom) return null;
  const hit = textures.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, tex);
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, s: number, n: number, seed: number, alpha: number, light = true) {
  const r = mulberry(seed);
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    ctx.fillRect(r() * s, r() * s, 1 + r() * 2.5, 1 + r() * 2.5);
  }
}

function streaks(ctx: CanvasRenderingContext2D, s: number, n: number, seed: number) {
  const r = mulberry(seed);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.14})`;
    ctx.fillRect(r() * s, r() * s, 1 + r() * 6, 20 + r() * 110);
  }
}

const paint = {
  panel(base: string, seam: string, bolts = true, cols = 2): Painter {
    return (ctx, s) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 1500, 3, 0.05);
      streaks(ctx, s, 12, 8);
      const step = s / cols;
      ctx.strokeStyle = seam;
      ctx.lineWidth = 4;
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < cols; y++) {
          ctx.strokeRect(x * step + 2, y * step + 2, step - 4, step - 4);
          if (!bolts) continue;
          ctx.fillStyle = seam;
          for (const [bx, by] of [[16, 16], [step - 16, 16], [16, step - 16], [step - 16, step - 16]]) {
            ctx.beginPath();
            ctx.arc(x * step + bx!, y * step + by!, 4, 0, 7);
            ctx.fill();
          }
        }
      }
    };
  },
  tile(base: string, line: string, n: number): Painter {
    return (ctx, s) => {
      const r = mulberry(5);
      const step = s / n;
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          ctx.fillStyle = base;
          ctx.fillRect(x * step, y * step, step, step);
          ctx.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.07})`;
          ctx.fillRect(x * step, y * step, step, step);
        }
      }
      speckle(ctx, s, 2200, 11, 0.06);
      speckle(ctx, s, 900, 12, 0.1, false);
      ctx.strokeStyle = line;
      ctx.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(s, i * step); ctx.stroke();
      }
    };
  },
  concrete(base: string): Painter {
    return (ctx, s) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 6000, 21, 0.07);
      speckle(ctx, s, 5000, 22, 0.09, false);
      streaks(ctx, s, 30, 23);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, s - 2, s - 2);
    };
  },
  hazard: ((ctx, s) => {
    ctx.fillStyle = '#f2aa00';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#16191b';
    const w = s / 4;
    for (let i = -4; i < 8; i += 2) {
      ctx.beginPath();
      ctx.moveTo(i * w, s);
      ctx.lineTo((i + 1) * w, s);
      ctx.lineTo((i + 1) * w + s, 0);
      ctx.lineTo(i * w + s, 0);
      ctx.fill();
    }
    speckle(ctx, s, 1600, 31, 0.12, false);
  }) as Painter,
  crate(light: string, dark: string): Painter {
    return (ctx, s) => {
      const r = mulberry(41);
      const n = 6;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = light;
        ctx.fillRect(0, (i * s) / n, s, s / n);
        ctx.fillStyle = `rgba(0,0,0,${r() * 0.18})`;
        ctx.fillRect(0, (i * s) / n, s, s / n);
        ctx.fillStyle = 'rgba(30,15,5,0.55)';
        ctx.fillRect(0, (i * s) / n, s, 3);
        for (let g = 0; g < 16; g++) {
          ctx.fillStyle = `rgba(40,20,5,${r() * 0.2})`;
          ctx.fillRect(r() * s, (i * s) / n + r() * (s / n), 30 + r() * 170, 1.2);
        }
      }
      const b = s * 0.14;
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, s, b); ctx.fillRect(0, s - b, s, b); ctx.fillRect(0, 0, b, s); ctx.fillRect(s - b, 0, b, s);
      ctx.save();
      ctx.translate(s / 2, s / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-s, -b / 2, s * 2, b);
      ctx.restore();
      ctx.fillStyle = 'rgba(20,20,20,0.75)';
      for (const [x, y] of [[b / 2, b / 2], [s - b / 2, b / 2], [b / 2, s - b / 2], [s - b / 2, s - b / 2]]) {
        ctx.beginPath(); ctx.arc(x!, y!, 7, 0, 7); ctx.fill();
      }
    };
  },
  wood(base: string): Painter {
    return (ctx, s) => {
      const r = mulberry(51);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = `rgba(40,20,5,${r() * 0.18})`;
        ctx.fillRect(0, r() * s, s, 1 + r() * 2);
      }
    };
  },
  ribbed(base: string, shade: string): Painter {
    return (ctx, s) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * s;
        const g = ctx.createLinearGradient(x, 0, x + s / n, 0);
        g.addColorStop(0, shade);
        g.addColorStop(0.5, 'rgba(255,255,255,0.1)');
        g.addColorStop(1, shade);
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, s / n, s);
      }
      speckle(ctx, s, 1500, 61, 0.08, false);
      streaks(ctx, s, 26, 62);
    };
  },
  asphalt: ((ctx, s) => {
    ctx.fillStyle = '#2d2f31';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 9000, 71, 0.1);
    speckle(ctx, s, 7000, 72, 0.25, false);
  }) as Painter,
  buildGrid: ((ctx, s) => {
    ctx.fillStyle = '#1d2a2e';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 2000, 81, 0.04);
    ctx.strokeStyle = 'rgba(25,224,196,0.33)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      const p = (i / 8) * s;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(25,224,196,0.85)';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, s, s);
  }) as Painter,
};

const standard = (o: THREE.MeshStandardMaterialParameters) => {
  // Without a DOM there are no textures; omit those keys rather than passing undefined.
  const params = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return new THREE.MeshStandardMaterial(params);
};

function makeMaterial(id: string): THREE.Material {
  const tex = (key: string, p: Painter, size = 512) => canvasTexture(key, p, size) ?? undefined;
  switch (id) {
    // Architecture
    case 'wall_light': return standard({ map: tex('wall_light', paint.panel('#a8aca2', 'rgba(40,46,46,0.7)')), roughness: 0.72, metalness: 0.1 });
    case 'wall_dark': return standard({ map: tex('wall_dark', paint.panel('#2f3f47', 'rgba(5,10,12,0.8)')), roughness: 0.62, metalness: 0.35 });
    case 'wall_teal': return standard({ map: tex('wall_teal', paint.panel('#14565c', 'rgba(3,18,20,0.8)', true, 1)), roughness: 0.55, metalness: 0.25 });
    case 'floor_tile': return standard({ map: tex('floor_tile', paint.tile('#5b6268', 'rgba(16,20,22,0.85)', 4)), roughness: 0.55, metalness: 0.15 });
    case 'floor_dark': return standard({ map: tex('floor_dark', paint.tile('#333c41', 'rgba(8,12,14,0.9)', 2)), roughness: 0.45, metalness: 0.45 });
    case 'floor_build': return standard({ map: tex('floor_build', paint.buildGrid), roughness: 0.5, metalness: 0.3 });
    case 'concrete': return standard({ map: tex('concrete', paint.concrete('#85857e')), roughness: 0.92 });
    case 'concrete_dark': return standard({ map: tex('concrete_dark', paint.concrete('#4b4d4c')), roughness: 0.95 });
    case 'asphalt': return standard({ map: tex('asphalt', paint.asphalt), roughness: 0.96 });
    case 'hazard': return standard({ map: tex('hazard', paint.hazard, 256), roughness: 0.6, metalness: 0.1 });
    case 'corrugated': return standard({ map: tex('corr_grey', paint.ribbed('#6e7c80', 'rgba(0,0,0,0.25)')), roughness: 0.65, metalness: 0.5 });
    case 'corrugated_teal': return standard({ map: tex('corr_teal', paint.ribbed('#1e6a70', 'rgba(0,0,0,0.3)')), roughness: 0.6, metalness: 0.45 });
    case 'container_red': return standard({ map: tex('cont_red', paint.ribbed('#a33a2a', 'rgba(0,0,0,0.3)')), roughness: 0.65, metalness: 0.45 });
    case 'container_blue': return standard({ map: tex('cont_blue', paint.ribbed('#25527f', 'rgba(0,0,0,0.3)')), roughness: 0.65, metalness: 0.45 });
    case 'container_amber': return standard({ map: tex('cont_amber', paint.ribbed('#c98310', 'rgba(0,0,0,0.3)')), roughness: 0.65, metalness: 0.45 });
    case 'platform_candy': return standard({ map: tex('candy', paint.tile('#3a4a78', 'rgba(255,255,255,0.28)', 2)), roughness: 0.45, metalness: 0.2 });
    case 'platform_mint': return standard({ map: tex('mint', paint.tile('#1f8d84', 'rgba(255,255,255,0.3)', 2)), roughness: 0.45, metalness: 0.2 });
    case 'bounce': return standard({ color: 0xff4fa3, emissive: 0x7a1046, emissiveIntensity: 0.7, roughness: 0.3 });
    // Props
    case 'crate': return standard({ map: tex('crate', paint.crate('#c0935a', '#94683a')), roughness: 0.8 });
    case 'crate_metal': return standard({ map: tex('crate_metal', paint.panel('#7d8a90', 'rgba(15,20,22,0.85)', true, 1)), roughness: 0.42, metalness: 0.8 });
    case 'wood': return standard({ map: tex('wood', paint.wood('#b98a52')), roughness: 0.8 });
    case 'wood_dark': return standard({ map: tex('wood_dark', paint.wood('#7a5733')), roughness: 0.85 });
    case 'steel': return standard({ color: 0x9aa6ac, roughness: 0.38, metalness: 0.9 });
    case 'steel_dark': return standard({ color: 0x3b444a, roughness: 0.5, metalness: 0.8 });
    case 'blackened': return standard({ color: 0x15191c, roughness: 0.6, metalness: 0.5 });
    case 'rubber': return standard({ color: 0x212427, roughness: 0.95 });
    case 'paint_amber': return standard({ color: 0xffb000, roughness: 0.48, metalness: 0.15 });
    case 'paint_coral': return standard({ color: 0xe8432f, roughness: 0.48, metalness: 0.15 });
    case 'paint_teal': return standard({ color: 0x19a596, roughness: 0.45, metalness: 0.2 });
    case 'paint_white': return standard({ color: 0xe8e6dc, roughness: 0.6 });
    case 'plastic_orange': return standard({ color: 0xff6a1a, roughness: 0.55 });
    case 'leaf': return standard({ color: 0x3d8f4a, roughness: 0.8, side: THREE.DoubleSide });
    case 'gel': return standard({ color: 0xff4fa3, emissive: 0x5a0c32, roughness: 0.15, transparent: true, opacity: 0.82 });
    case 'ice': return standard({ color: 0xa8e4f7, emissive: 0x0d3442, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.72 });
    case 'glass': return standard({ color: 0xbfe8ee, roughness: 0.04, metalness: 0.35, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide });
    case 'screen': return standard({ color: 0x06211f, emissive: 0x19e0c4, emissiveIntensity: 1.1, roughness: 0.35 });
    // Emissive
    case 'glow_white': return new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.5, 2.25) });
    case 'glow_amber': return new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.75, 0.2) });
    case 'glow_teal': return new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 2.6, 2.2) });
    case 'glow_coral': return new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.55, 0.35) });
    case 'glow_violet': return new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.6, 3.0) });
    default: return standard({ color: 0xff00ff, roughness: 0.6 });
  }
}

/** Shared materials: never disposed per-entity, only on full shutdown. */
export function mat(id: string): THREE.Material {
  let m = library.get(id);
  if (!m) library.set(id, (m = makeMaterial(id)));
  return m;
}

export function solidMat(color: number, roughness = 0.55, metalness = 0.2): THREE.MeshStandardMaterial {
  const key = `solid:${color}:${roughness}:${metalness}`;
  let m = library.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) library.set(key, (m = standard({ color, roughness, metalness })));
  return m;
}

/** Tinted clone of a library material. Bounded by palette size so caching is safe. */
export function tinted(base: THREE.Material, color: number): THREE.Material {
  const key = `tint:${base.uuid}:${color}`;
  let m = library.get(key);
  if (!m) {
    m = base.clone();
    (m as THREE.MeshStandardMaterial).color?.set(color);
    library.set(key, m);
  }
  return m;
}

/** Stencilled sign texture. `lines` are drawn centred. */
export function signMat(key: string, lines: string[], bg: string, fg: string, accent?: string): THREE.Material {
  const id = `sign:${key}`;
  let m = library.get(id);
  if (m) return m;
  const painter: Painter = (ctx, s) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 800, 91, 0.06, false);
    if (accent) {
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, s, s * 0.09);
      ctx.fillRect(0, s * 0.91, s, s * 0.09);
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = s / (lines.length > 1 ? lines.length * 1.9 : 3.4);
    ctx.font = `800 ${size}px "Arial Narrow", "DejaVu Sans Condensed", Arial, sans-serif`;
    lines.forEach((l, i) => {
      const y = s / 2 + (i - (lines.length - 1) / 2) * size * 1.2;
      ctx.fillText(l, s / 2, y, s * 0.9);
    });
  };
  const map = canvasTexture(id, painter, 512);
  if (map) (map as THREE.Texture).wrapS = THREE.ClampToEdgeWrapping;
  m = standard({ map: map ?? undefined, roughness: 0.6, metalness: 0.1, emissiveMap: map ?? undefined, emissive: 0x333333 });
  library.set(id, m);
  return m;
}

export function disposeMaterialLibrary(): void {
  for (const m of library.values()) m.dispose();
  for (const t of textures.values()) t.dispose();
  library.clear();
  textures.clear();
}
