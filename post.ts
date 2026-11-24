import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

export interface PostParams {
  exposure: number;
  tint: THREE.Color;
  sat: number;
  contrast: number;
  vignette: number;
  grain: number;
  time: number;
  blurDir: THREE.Vector2;
  zoom: number;
  sun: THREE.Vector3; // uv.x, uv.y, visibility
  god: number;
  focus: number;
  dof: number;
  ssao: number;
  damage: number;
  flash: number;
  aber: number;
  fade: number;
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  near: number;
  far: number;
}

const frag = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tDepth;
uniform vec2 uRes; uniform float uNear, uFar;
uniform float uExposure, uSat, uContrast, uVignette, uGrain, uTime;
uniform vec3 uTint;
uniform vec2 uBlurDir; uniform float uZoom;
uniform vec3 uSun; uniform float uGod;
uniform float uFocus, uDof, uSSAO, uDamage, uFlash, uAber, uFade;
varying vec2 vUv;

float lin(float d){ float z = d*2.0-1.0; return 2.0*uNear*uFar/(uFar+uNear - z*(uFar-uNear)); }
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }

void main(){
  vec2 uv = vUv;
  vec2 px = 1.0/uRes;
  float aspect = uRes.x/uRes.y;
  float d0 = texture2D(tDepth, uv).x;
  float z = lin(d0);
  vec2 cdir = (uv-0.5);
  float coc = 0.0;
  if (uDof > 0.0 && z > 1.2) coc = clamp(abs(1.0/uFocus - 1.0/z) * uDof, 0.0, 1.0);
  float R = coc * 12.0;
  vec2 mb = uBlurDir + cdir * uZoom;
  vec3 col;
  float ab = uAber * dot(cdir,cdir) * 2.0;
  if (R < 0.6 && dot(mb,mb) < 1e-8) {
    col = vec3(texture2D(tScene, uv + cdir*ab).r, texture2D(tScene, uv).g, texture2D(tScene, uv - cdir*ab).b);
  } else {
    vec3 acc = vec3(0.0);
    for (int i=0;i<12;i++){
      float fi = float(i)+0.5;
      float a = fi * 2.399963; float r = sqrt(fi/12.0);
      vec2 o = vec2(cos(a), sin(a)) * r * R * px;
      vec2 suv = uv + o + mb * (fi/12.0 - 0.5);
      acc += vec3(texture2D(tScene, suv + cdir*ab).r, texture2D(tScene, suv).g, texture2D(tScene, suv - cdir*ab).b);
    }
    col = acc/12.0;
  }
  if (uGod > 0.0 && uSun.z > 0.0) {
    vec2 dir = uSun.xy - uv;
    vec2 stp = dir / 18.0 * 0.9;
    vec2 p = uv + stp * rnd(uv + uTime);
    float w = 1.0; vec3 g = vec3(0.0);
    for (int i=0;i<18;i++){
      p += stp;
      vec3 s = texture2D(tScene, p).rgb;
      float l = dot(s, vec3(0.3,0.59,0.11));
      g += s * smoothstep(2.5, 8.0, l) * w;
      w *= 0.94;
    }
    col += g * uGod * 0.03 * uSun.z * (1.0 - clamp(length(dir)*0.7, 0.0, 1.0));
  }
  if (uSSAO > 0.0 && z < 90.0) {
    float occ = 0.0;
    float rad = clamp(0.9/z, 0.004, 0.035);
    for (int i=0;i<10;i++){
      float fi = float(i)+0.5;
      float a = fi * 2.399963 + rnd(uv)*6.28; float r = 0.25 + 0.75*sqrt(fi/10.0);
      vec2 o = vec2(cos(a)/aspect, sin(a)) * r * rad;
      float zs = lin(texture2D(tDepth, uv + o).x);
      float dz = z - zs;
      occ += step(0.12, dz) * smoothstep(3.0, 0.3, dz);
    }
    col *= 1.0 - clamp(occ/10.0 * uSSAO * 1.4, 0.0, 0.75);
  }
  col *= uExposure * uTint;
  col = aces(col);
  col = pow(col, vec3(1.0/2.2));
  float lum = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(lum), col, uSat);
  col = (col - 0.5) * uContrast + 0.5;
  float v = smoothstep(0.95, 0.18, length(cdir * vec2(aspect*0.75, 1.0)));
  col *= mix(1.0, v, uVignette);
  float edge = smoothstep(0.25, 0.75, length(cdir*vec2(aspect*0.6,1.0)));
  col = mix(col, vec3(0.55,0.02,0.02), edge * uDamage * 0.75);
  col += (rnd(uv * uRes + uTime) - 0.5) * uGrain;
  col = mix(col, vec3(1.0), uFlash);
  col *= uFade;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export class Post {
  rt: THREE.WebGLRenderTarget;
  bloom: UnrealBloomPass;
  mat: THREE.ShaderMaterial;
  quad: FullScreenQuad;
  w = 1;
  h = 1;
  constructor(public renderer: THREE.WebGLRenderer, w: number, h: number, public samples: number) {
    this.rt = this.makeRT(w, h);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.6, 0.85);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture },
        uRes: { value: new THREE.Vector2(w, h) }, uNear: { value: 0.1 }, uFar: { value: 1200 },
        uExposure: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0.3 }, uGrain: { value: 0.02 }, uTime: { value: 0 },
        uTint: { value: new THREE.Color(1, 1, 1) }, uBlurDir: { value: new THREE.Vector2() }, uZoom: { value: 0 },
        uSun: { value: new THREE.Vector3() }, uGod: { value: 0 }, uFocus: { value: 50 }, uDof: { value: 0 }, uSSAO: { value: 0 },
        uDamage: { value: 0 }, uFlash: { value: 0 }, uAber: { value: 0.002 }, uFade: { value: 1 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.w = w;
    this.h = h;
  }
  private makeRT(w: number, h: number) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: this.samples, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.depthTexture.type = THREE.UnsignedIntType;
    return rt;
  }
  setSize(w: number, h: number) {
    w = Math.max(2, Math.floor(w));
    h = Math.max(2, Math.floor(h));
    this.w = w;
    this.h = h;
    this.rt.setSize(w, h);
    this.bloom.setSize(w, h);
    this.mat.uniforms.uRes.value.set(w, h);
  }
  setSamples(s: number) {
    if (s === this.samples) return;
    this.samples = s;
    this.rt.dispose();
    this.rt = this.makeRT(this.w, this.h);
    this.mat.uniforms.tScene.value = this.rt.texture;
    this.mat.uniforms.tDepth.value = this.rt.depthTexture;
  }
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, p: PostParams, dt: number) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    if (p.bloom) {
      this.bloom.strength = p.bloomStrength;
      this.bloom.threshold = p.bloomThreshold;
      this.bloom.radius = p.bloomRadius;
      this.bloom.render(r, this.rt, this.rt, dt, false);
    }
    const u = this.mat.uniforms;
    u.uExposure.value = p.exposure;
    u.uTint.value.copy(p.tint);
    u.uSat.value = p.sat;
    u.uContrast.value = p.contrast;
    u.uVignette.value = p.vignette;
    u.uGrain.value = p.grain;
    u.uTime.value = p.time % 100;
    u.uBlurDir.value.copy(p.blurDir);
    u.uZoom.value = p.zoom;
    u.uSun.value.copy(p.sun);
    u.uGod.value = p.god;
    u.uFocus.value = p.focus;
    u.uDof.value = p.dof;
    u.uSSAO.value = p.ssao;
    u.uDamage.value = p.damage;
    u.uFlash.value = p.flash;
    u.uAber.value = p.aber;
    u.uFade.value = p.fade;
    u.uNear.value = p.near;
    u.uFar.value = p.far;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
  dispose() {
    this.rt.dispose();
    this.bloom.dispose();
    this.mat.dispose();
  }
}
