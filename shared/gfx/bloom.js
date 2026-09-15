// ============================================================================
// Bloom composer (shared by every game client).
//
// three's UnrealBloomPass lives in examples/jsm, which we don't vendor, so
// this is a small purpose-built version: bright-pass into a half-res target,
// separable Gaussian blur at two mip levels, then additively composite over
// the scene. Engine flares, weapon fire, shield flashes and Vessari
// bioluminescence are the things that should glow, and they are already the
// only genuinely bright pixels in the frame.
//
// Everything degrades gracefully: `enabled = false` renders straight to the
// screen with no targets allocated.
// ============================================================================

import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = `
uniform sampler2D tDiffuse;
uniform float threshold;
uniform float softKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  // soft knee so things don't pop in as they cross the threshold
  float k = clamp((l - threshold + softKnee) / (2.0 * softKnee), 0.0, 1.0);
  float w = max(l - threshold, k * k * softKnee) / max(l, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tDiffuse;
uniform vec2 direction;      // texel-sized step
varying vec2 vUv;
void main() {
  // 9-tap Gaussian
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  s += texture2D(tDiffuse, vUv + direction * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv - direction * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv + direction * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tDiffuse, vUv - direction * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE_FRAG = `
uniform sampler2D tScene;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float strength;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(tScene, vUv).rgb;
  vec3 glow = texture2D(tBloomA, vUv).rgb * 0.65 + texture2D(tBloomB, vUv).rgb * 0.35;
  gl_FragColor = vec4(base + glow * strength, 1.0);
}`;

function target(w, h, { depth = false, samples = 0 } = {}) {
  return new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: depth,
    stencilBuffer: false,
    samples
  });
}

export class BloomComposer {
  constructor(renderer, { strength = 0.9, threshold = 0.62, enabled = true, samples = 4 } = {}) {
    this.renderer = renderer;
    this.enabled = enabled;
    this.strength = strength;
    this.samples = samples;      // MSAA on the scene target (WebGL2)

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geo = new THREE.PlaneGeometry(2, 2);

    this.matBright = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BRIGHT_FRAG,
      uniforms: { tDiffuse: { value: null }, threshold: { value: threshold }, softKnee: { value: 0.28 } },
      depthTest: false, depthWrite: false
    });
    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLUR_FRAG,
      uniforms: { tDiffuse: { value: null }, direction: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false
    });
    this.matComposite = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: null }, tBloomA: { value: null },
        tBloomB: { value: null }, strength: { value: strength }
      },
      depthTest: false, depthWrite: false
    });

    this.quad = new THREE.Mesh(this.geo, this.matBright);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.targets = null;
    this._size = new THREE.Vector2();
  }

  /**
   * Allocate at the renderer's DRAWING BUFFER size, not the CSS size: the
   * scene target is what the whole frame is rendered into, so sizing it in CSS
   * pixels renders everything at 1/devicePixelRatio and upscales it onto the
   * canvas — the entire viewport goes soft and blocky on any retina display.
   * Takes no dimensions precisely so no caller can pass the wrong ones.
   */
  setSize() {
    this.dispose();
    if (!this.enabled) return;
    this.renderer.getDrawingBufferSize(this._size);
    const w = this._size.x, h = this._size.y;
    const rt = (d) => ({ a: target(Math.round(w / d), Math.round(h / d)),
                         b: target(Math.round(w / d), Math.round(h / d)) });
    this.targets = {
      // The scene target needs its own depth buffer. Without one the whole 3D
      // pass runs with depth testing dead and resolves in draw order, so far
      // geometry paints over near — hulls show their interiors and lights shine
      // through the ship. It also carries the multisampling, since the default
      // framebuffer's antialias only ever sees the composite quad.
      scene: target(w, h, { depth: true, samples: this.samples }),
      half: rt(2),      // first bloom mip
      quarter: rt(4)    // second, wider mip
    };
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) this.setSize(); else this.dispose();
  }

  _blit(material, dest) {
    this.quad.material = material;
    this.renderer.setRenderTarget(dest || null);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  _blurInto(pair, w, h) {
    // horizontal then vertical, ping-ponging between the pair
    this.matBlur.uniforms.tDiffuse.value = pair.a.texture;
    this.matBlur.uniforms.direction.value.set(1 / w, 0);
    this._blit(this.matBlur, pair.b);
    this.matBlur.uniforms.tDiffuse.value = pair.b.texture;
    this.matBlur.uniforms.direction.value.set(0, 1 / h);
    this._blit(this.matBlur, pair.a);
  }

  render(scene, camera) {
    if (!this.enabled || !this.targets) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    const t = this.targets;
    const w = this._size.x, h = this._size.y;

    // 1. scene, into a depth-backed target
    this.renderer.setRenderTarget(t.scene);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, camera);

    // 2. bright pass into the half-res mip
    this.matBright.uniforms.tDiffuse.value = t.scene.texture;
    this._blit(this.matBright, t.half.a);
    this._blurInto(t.half, w / 2, h / 2);

    // 3. downsample the blurred half into the quarter mip and blur wider
    this.matBlur.uniforms.tDiffuse.value = t.half.a.texture;
    this.matBlur.uniforms.direction.value.set(1 / (w / 4), 0);
    this._blit(this.matBlur, t.quarter.a);
    this._blurInto(t.quarter, w / 4, h / 4);

    // 4. composite
    this.matComposite.uniforms.tScene.value = t.scene.texture;
    this.matComposite.uniforms.tBloomA.value = t.half.a.texture;
    this.matComposite.uniforms.tBloomB.value = t.quarter.a.texture;
    this.matComposite.uniforms.strength.value = this.strength;
    this._blit(this.matComposite, null);
  }

  dispose() {
    if (!this.targets) return;
    const all = [this.targets.scene, this.targets.half.a, this.targets.half.b,
                 this.targets.quarter.a, this.targets.quarter.b];
    for (const t of all) t.dispose();
    this.targets = null;
  }
}
