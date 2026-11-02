import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Settings } from '../game/core/settings';

export interface SkyColors { top: number; horizon: number; bottom: number }

const QUALITY = {
  low: { shadow: 1024, pixelCap: 1, lights: 2 },
  medium: { shadow: 2048, pixelCap: 1.5, lights: 5 },
  high: { shadow: 4096, pixelCap: 2, lights: 8 },
} as const;

export function qualityLights(q: Settings['quality']): number {
  return QUALITY[q].lights;
}

/** Owns the WebGL context, post-processing chain and viewport. Knows nothing about gameplay. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private settings: Settings;
  private ro: ResizeObserver | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator;
  contextLost = false;
  sun: THREE.DirectionalLight | null = null;
  width = 1;
  height = 1;

  constructor(readonly canvas: HTMLCanvasElement, settings: Settings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    console.warn('[CHAOS LAB] WebGL context lost; waiting for restore.');
  };
  private onRestored = () => {
    this.contextLost = false;
    this.rebuildChain();
    this.resize();
  };

  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, QUALITY[this.settings.quality].pixelCap) * this.settings.renderScale;
  }

  applySettings(settings: Settings): void {
    const prev = this.settings;
    this.settings = settings;
    this.renderer.shadowMap.enabled = settings.shadows;
    if (prev.shadows !== settings.shadows || prev.quality !== settings.quality) {
      this.renderer.shadowMap.needsUpdate = true;
      this.configureSun();
    }
    if (prev.bloom !== settings.bloom) this.rebuildChain();
    this.resize();
  }

  private rebuildChain(): void {
    this.composer?.dispose();
    this.bloom?.dispose();
    this.composer = null;
    this.bloom = null;
    this.renderPass = null;
  }

  private ensureComposer(scene: THREE.Scene, camera: THREE.Camera): EffectComposer {
    if (this.composer && this.renderPass) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      return this.composer;
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.settings.antialias ? 4 : 0,
    });
    const composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.5, 1.0);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    return composer;
  }

  resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    const pr = this.pixelRatio();
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
  }

  get pointScale(): number {
    return (this.height * this.pixelRatio()) / 1.2;
  }

  setSun(sun: THREE.DirectionalLight | null): void {
    this.sun = sun;
    this.configureSun();
  }

  private configureSun(): void {
    if (!this.sun) return;
    const res = QUALITY[this.settings.quality].shadow;
    const s = this.sun.shadow;
    this.sun.castShadow = this.settings.shadows;
    if (s.mapSize.x !== res) {
      s.mapSize.set(res, res);
      s.map?.dispose();
      s.map = null;
    }
  }

  /** Builds an image-based light from a small gradient scene so metals have something to reflect. */
  setEnvironment(scene: THREE.Scene, sky: SkyColors, panels: number): void {
    const env = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), makeSkyMaterial(sky, 1));
    env.add(mesh);
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.8, 4.4) });
    const geom = new THREE.BoxGeometry(5, 0.2, 2);
    for (let i = 0; i < panels; i++) {
      const m = new THREE.Mesh(geom, glow);
      const a = (i / panels) * Math.PI * 2;
      m.position.set(Math.cos(a) * 5, 6, Math.sin(a) * 5);
      m.lookAt(0, 0, 0);
      env.add(m);
    }
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(env, 0.04);
    scene.environment = this.envRT.texture;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    glow.dispose();
    geom.dispose();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.contextLost) return;
    if (this.settings.bloom) {
      this.ensureComposer(scene, camera).render();
    } else {
      this.renderer.render(scene, camera);
    }
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.ro?.disconnect();
    this.rebuildChain();
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}

export function makeSkyMaterial(sky: SkyColors, intensity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(sky.top).multiplyScalar(intensity) },
      horizon: { value: new THREE.Color(sky.horizon).multiplyScalar(intensity) },
      bottom: { value: new THREE.Color(sky.bottom).multiplyScalar(intensity) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main(){ float h = normalize(vDir).y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.45));
      gl_FragColor = vec4(c, 1.0); }`,
  });
}
