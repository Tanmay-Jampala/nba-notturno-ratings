/**
 * Original WebGL scene in an ink-engraving style: screen-space hatching + inverted-hull outlines,
 * paper/ink colours that invert to white-on-night for dark beats. All geometry is procedural.
 */
import * as THREE from 'three';

const PAPER = new THREE.Color('#f2f1ee');
const INK = new THREE.Color('#121212');
const NIGHT = new THREE.Color('#1d1d1d');
const WHITE = new THREE.Color('#f4f3f0');
const RED = new THREE.Color('#c82924');

const shared = {
  uPaper: { value: PAPER.clone() },
  uInk: { value: INK.clone() },
  uRed: { value: RED.clone() },
  uLight: { value: new THREE.Vector3(-0.45, 0.8, 0.5).normalize() },
  uTime: { value: 0 },
  uPx: { value: 1 },
};

const HATCH = /* glsl */ `
  float hline(vec2 p, float ang, float spacing, float width) {
    float c = cos(ang), s = sin(ang);
    float y = (s * p.x + c * p.y) / spacing;
    y += 0.18 * sin(p.x * 0.013 + p.y * 0.007);             // hand-cut wobble
    float d = abs(fract(y) - 0.5) * 2.0;                       // 0 at line centre
    float aa = fwidth(y) * 2.0;
    return 1.0 - smoothstep(width - aa, width + aa, d);
  }
  // darkness 0..1 → ink coverage 0..1 using up to three hatch layers
  float engrave(vec2 frag, float dark, float px) {
    float sp = 5.0 * px;
    float ink = hline(frag, 0.0, sp, clamp(dark * 0.9, 0.0, 0.9));
    ink = max(ink, step(0.45, dark) * hline(frag, 0.785, sp * 1.1, clamp((dark - 0.45) * 1.2, 0.0, 0.6)));
    ink = max(ink, step(0.72, dark) * hline(frag, -0.785, sp * 1.25, clamp((dark - 0.72) * 1.6, 0.0, 0.5)));
    return ink;
  }
`;

/** Hatched solid: tone from Lambert light; mode 0 = paper/ink, 1 = red fill hatched in ink, 2 = solid ink silhouette. */
function engraveMaterial(mode: 0 | 1 | 2, bias = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uMode: { value: mode }, uBias: { value: bias } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vO;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz; vO = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPaper, uInk, uRed, uLight; uniform float uMode, uBias, uPx;
      varying vec3 vN; varying vec3 vP; varying vec3 vO;
      ${HATCH}
      void main() {
        if (uMode > 1.5) { gl_FragColor = vec4(uInk, 1.0); return; }
        float l = max(dot(normalize(vN), uLight), 0.0);
        float dark = clamp(1.0 - l * 1.05 + uBias, 0.0, 1.0);
        float ink = engrave(gl_FragCoord.xy, dark, uPx);
        vec3 base = uMode > 0.5 ? uRed : uPaper;
        gl_FragColor = vec4(mix(base, uInk, ink), 1.0);
      }`,
  });
}

/** Ball: red, hatched, with seams (equator, meridian, two rings around the x axis). */
function ballMaterial() {
  const m = engraveMaterial(1, -0.05);
  m.fragmentShader = m.fragmentShader.replace(
    'gl_FragColor = vec4(mix(base, uInk, ink), 1.0);',
    `vec3 o = normalize(vO);
     float w = 0.022;
     float seam = 1.0 - smoothstep(w * 0.6, w, min(min(abs(o.y), abs(o.z)), abs(abs(o.x) - 0.62)));
     gl_FragColor = vec4(mix(base, uInk, max(ink, seam)), 1.0);`,
  );
  return m;
}

/** Inverted-hull outline for the comic ink line. */
function outlineOf(mesh: THREE.Mesh, width = 0.035) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uInk: shared.uInk, uW: { value: width } },
    side: THREE.BackSide,
    vertexShader: `uniform float uW; void main(){ vec3 p = position + normal * uW; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
    fragmentShader: `uniform vec3 uInk; void main(){ gl_FragColor = vec4(uInk,1.0); }`,
  });
  const o = new THREE.Mesh(mesh.geometry, mat);
  o.raycast = () => {};
  mesh.add(o);
  return o;
}

/** Floor: horizontal engraving that thickens with distance + a full NBA court drawn in ink. */
function floorMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: `varying vec3 vP; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vP = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPaper, uInk, uRed; uniform float uPx;
      varying vec3 vP;
      ${HATCH}
      float lineMask(float d, float w) { float aa = fwidth(d); return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
      float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
      void main() {
        // court centred at z = -8, long axis along z (28.65 x 15.24 m)
        vec2 p = vec2(vP.x, vP.z + 8.0);
        float w = 0.05;
        float court = lineMask(box(p, vec2(7.62, 14.325)), w);
        court = max(court, lineMask(p.y, w) * step(abs(p.x), 7.62));
        court = max(court, lineMask(length(p) - 1.83, w));
        for (int s = -1; s <= 1; s += 2) {
          float yb = 14.325 - p.y * float(s);                             // distance in from this baseline
          court = max(court, lineMask(box(vec2(p.x, yb - 2.9), vec2(2.44, 2.9)), w));   // the key
          court = max(court, lineMask(length(vec2(p.x, yb - 5.8)) - 1.83, w));         // free-throw circle
          float arc = lineMask(length(vec2(p.x, yb - 1.575)) - 7.24, w) * step(4.295, yb);
          float corner = lineMask(abs(p.x) - 6.71, w) * step(yb, 4.295) * step(0.0, yb);
          court = max(court, max(arc, corner));
          court = max(court, lineMask(length(vec2(p.x, yb - 1.575)) - 1.22, w) * step(1.575, yb)); // restricted area
        }
        float dist = length(vP.xz - cameraPosition.xz);
        float dark = clamp(0.12 + dist * 0.012, 0.0, 0.55);
        float ink = hline(gl_FragCoord.xy, 0.0, 6.0 * uPx, dark);
        // grid floor beyond the court
        vec2 g = abs(fract(vP.xz / 2.0) - 0.5);
        float grid = (1.0 - smoothstep(0.0, fwidth(vP.x) * 1.2, min(g.x, g.y) - 0.002)) * 0.6;
        float outside = step(0.0, box(p, vec2(7.62, 14.325)));
        float m = max(ink, max(court, grid * outside));
        float fade = smoothstep(80.0, 30.0, dist);
        gl_FragColor = vec4(mix(uPaper, uInk, m * fade), 1.0);
      }`,
  });
}

function sunMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRed, uInk; uniform float uOpacity, uPx; varying vec2 vUv;
      ${HATCH}
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float aa = fwidth(r);
        float disc = 1.0 - smoothstep(0.86 - aa, 0.86 + aa, r);
        float ring = 1.0 - smoothstep(0.012 - aa, 0.012 + aa, abs(r - 0.93));
        float rings = hline(vec2(r * 900.0, 0.0), 1.5708, 22.0, 0.08) * step(0.55, r) * disc * 0.9;
        vec3 col = mix(uRed, uInk, max(ring, rings));
        float a = max(disc, ring) * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uOpacity; varying vec2 vUv;
      void main(){ float a = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x) * smoothstep(0.0, 1.0, vUv.y) * 0.22 * uOpacity;
      gl_FragColor = vec4(vec3(1.0), a); }`,
  });
}

// ---------------------------------------------------------------------------------- figure

function buildFigure() {
  const g = new THREE.Group();
  const ink = engraveMaterial(2);
  const cap = (r: number, h: number) => new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 4, 10), ink);
  const torso = cap(0.26, 0.62); torso.position.y = 1.42; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), ink); head.position.y = 2.0; g.add(head);
  const mkLimb = (r: number, h: number, x: number, y: number) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    const m = cap(r, h); m.position.y = -h / 2 - r; pivot.add(m); g.add(pivot); return pivot;
  };
  const legL = mkLimb(0.11, 0.78, -0.13, 1.02), legR = mkLimb(0.11, 0.78, 0.13, 1.02);
  const armL = mkLimb(0.07, 0.62, -0.36, 1.78), armR = mkLimb(0.07, 0.62, 0.36, 1.78);
  return { g, walk(phase: number, amt: number) {
    const s = Math.sin(phase) * 0.55 * amt;
    legL.rotation.x = s; legR.rotation.x = -s; armL.rotation.x = -s * 0.8; armR.rotation.x = s * 0.8;
    g.position.y = Math.abs(Math.cos(phase)) * 0.04 * amt;
  } };
}

// ---------------------------------------------------------------------------------- scene

export interface Pose { pos: THREE.Vector3; look: THREE.Vector3; night: number; sun: number; beams: number; walk: number; figZ: number; fov: number }

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);
  shared.uPx.value = dpr;
  const scene = new THREE.Scene();
  scene.background = PAPER.clone();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMaterial());
  floor.rotation.x = -Math.PI / 2; scene.add(floor);

  const sunMat = sunMaterial();
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), sunMat);
  sun.position.set(0, 10, -60); scene.add(sun);

  // columns along both sides (the nave)
  const colGeo = new THREE.CylinderGeometry(0.55, 0.65, 30, 20, 1, true);
  const capGeo = new THREE.BoxGeometry(1.7, 0.5, 1.7);
  const colMat = engraveMaterial(0, 0.1);
  for (let i = 0; i < 9; i++) {
    for (const x of [-9.5, 9.5]) {
      const c = new THREE.Mesh(colGeo, colMat); c.position.set(x, 15, -4 - i * 7); scene.add(c); outlineOf(c, 0.05);
      const b = new THREE.Mesh(capGeo, colMat); b.position.set(x, 0.25, -4 - i * 7); scene.add(b); outlineOf(b, 0.04);
    }
  }
  // light beams through the nave
  const beamMat = beamMaterial();
  for (let i = 0; i < 6; i++) {
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 46), beamMat);
    bm.position.set(i % 2 ? 4 : -4, 18, -10 - i * 8); bm.rotation.z = (i % 2 ? -1 : 1) * 0.42; bm.rotation.y = 0.2;
    scene.add(bm);
  }

  // hoop at the far end of the court (basket centre z = -8 - 14.325 + 1.575)
  const hoop = new THREE.Group();
  const paperMat = engraveMaterial(0, -0.1);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.83, 1.07, 0.06), paperMat); board.position.set(0, 3.4, -0.15); hoop.add(board); outlineOf(board, 0.025);
  const square = new THREE.Mesh(new THREE.BoxGeometry(0.59, 0.45, 0.07), engraveMaterial(1, 0)); square.position.set(0, 3.24, -0.12); hoop.add(square);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 8, 40), engraveMaterial(2)); rim.rotation.x = Math.PI / 2; rim.position.set(0, 3.05, 0.25); hoop.add(rim);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.6, 12), paperMat); pole.position.set(0, 1.8, -1.4); hoop.add(pole); outlineOf(pole, 0.03);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.3), paperMat); arm.position.set(0, 3.4, -0.8); hoop.add(arm); outlineOf(arm, 0.03);
  // net: thin ink lines
  const netPts: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, b = ((i + 1.5) / 12) * Math.PI * 2;
    netPts.push(new THREE.Vector3(Math.cos(a) * 0.23, 0, Math.sin(a) * 0.23), new THREE.Vector3(Math.cos(b) * 0.13, -0.42, Math.sin(b) * 0.13));
  }
  const net = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(netPts), new THREE.LineBasicMaterial({ color: INK }));
  net.position.set(0, 3.05, 0.25); hoop.add(net);
  hoop.position.set(0, 0, -8 - 14.325 + 1.575 - 0.25);
  scene.add(hoop);

  // the ball
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 32), ballMaterial());
  ball.position.set(0, 2.3, -6); scene.add(ball); outlineOf(ball, 0.03);

  // the walker
  const fig = buildFigure(); scene.add(fig.g); fig.g.rotation.y = Math.PI;
  const figMeshes: THREE.Mesh[] = [];
  fig.g.traverse(o => { if ((o as THREE.Mesh).isMesh) figMeshes.push(o as THREE.Mesh); });
  figMeshes.forEach(m => outlineOf(m, 0.02));

  const clock = new THREE.Clock();
  let w = 0, h = 0;
  const resize = () => {
    w = canvas.clientWidth; h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();

  const tmpBg = new THREE.Color();
  function apply(p: Pose, ballFloat: number, ballSpin: number) {
    camera.position.copy(p.pos); camera.fov = p.fov; camera.updateProjectionMatrix(); camera.lookAt(p.look);
    shared.uPaper.value.copy(PAPER).lerp(NIGHT, p.night);
    shared.uInk.value.copy(INK).lerp(WHITE, p.night);
    (net.material as THREE.LineBasicMaterial).color.copy(shared.uInk.value);
    tmpBg.copy(PAPER).lerp(NIGHT, p.night); (scene.background as THREE.Color).copy(tmpBg);
    sunMat.uniforms.uOpacity.value = p.sun;
    beamMat.uniforms.uOpacity.value = p.beams;
    fig.g.position.z = p.figZ;
    fig.walk(p.figZ * 3.2, p.walk);
    ball.position.y = 2.3 + ballFloat;
    ball.rotation.set(ballSpin * 0.6, ballSpin, 0.3);
  }

  return {
    renderer, camera, scene, resize,
    render(p: Pose) {
      const t = clock.getElapsedTime();
      shared.uTime.value = t;
      apply(p, Math.sin(t * 0.9) * 0.12, t * 0.35);
      renderer.render(scene, camera);
    },
    dispose() { renderer.dispose(); },
  };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}
