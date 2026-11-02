import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ItemDef } from '../data/items';
import { buildToolModel } from '../game/weapons/ViewModel';
import { buildNpcModel } from './npcModels';
import { buildVisual } from './props';

const SIZE = 128;

/**
 * Renders item icons on demand with a small dedicated context, then releases it when the queue empties.
 * If WebGL is unavailable the menu simply shows names without icons.
 */
export class Thumbnails {
  private cache = new Map<string, string>();
  private queue: { def: ItemDef; done: (url: string) => void }[] = [];
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
  private env: THREE.WebGLRenderTarget | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;

  get(def: ItemDef, done: (url: string) => void): string | null {
    const hit = this.cache.get(def.id);
    if (hit) return hit;
    if (this.failed) return null;
    this.queue.push({ def, done });
    this.schedule();
    return null;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.next();
    }, 0);
  }

  private ensure(): boolean {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setSize(SIZE, SIZE, false);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.env = pmrem.fromScene(new RoomEnvironment(), 0.04);
      pmrem.dispose();
      this.scene.environment = this.env.texture;
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(2, 4, 3);
      this.scene.add(key);
      return true;
    } catch (e) {
      console.warn('[CHAOS LAB] thumbnails unavailable', e);
      this.failed = true;
      this.queue.length = 0;
      return false;
    }
  }

  private next(): void {
    const job = this.queue.shift();
    if (!job) {
      this.release();
      return;
    }
    if (!this.ensure()) return;
    const hit = this.cache.get(job.def.id);
    if (hit) {
      job.done(hit);
    } else {
      const url = this.render(job.def);
      this.cache.set(job.def.id, url);
      job.done(url);
    }
    this.schedule();
  }

  private render(def: ItemDef): string {
    const model = def.kind === 'npc' ? buildNpcModel(String(def.params?.archetype)).root : def.kind === 'tool' ? buildToolModel(def.toolId ?? '') : buildVisual(def);
    const scene = this.scene!;
    scene.add(model);
    if (def.kind !== 'tool' && def.kind !== 'npc') model.rotation.y = -0.6;
    if (def.kind === 'tool') model.rotation.y = -2.2;
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
    const dist = radius / Math.sin((30 * Math.PI) / 360);
    this.camera.position.set(center.x + dist * 0.42, center.y + dist * 0.36, center.z + dist * 0.83);
    this.camera.near = dist / 50;
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.renderer!.render(scene, this.camera);
    const url = this.renderer!.domElement.toDataURL('image/png');
    scene.remove(model);
    return url;
  }

  private release(): void {
    this.env?.dispose();
    this.env = null;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.scene = null;
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
    this.release();
    this.cache.clear();
  }
}
