// Atmosphere: golden-hour sky dome (sun, glow, blocky dusty-rose clouds) and a sun-aware aerial haze that replaces
// three's fog chunk, so every fogged material (ground, castle, crowd, hero, debris) washes out toward the same
// colour the sky has at the horizon in that direction: warm peach toward the low sun, cool mauve away from it.
// The haze colour exists twice — GLSL (fog + sky) and JS (hazeColor, used to pre-bake the unfogged mountains) —
// keep them in sync.
import * as THREE from 'three';

// visible sun: 18° left of the wall-facing view, in the gap between the castle's corner tower and the watchtowers;
// 2.9° up so the disc sits inside the gameplay frame (its top edge is ≈ 5° above level) instead of above it
const SUN_ELEV = 0.05;
export const SUN_AZ = 0.314;
export const SUN_DIR = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_ELEV), Math.sin(SUN_ELEV), Math.cos(SUN_AZ) * Math.cos(SUN_ELEV));

const lin = (hex) => new THREE.Color(hex);                          // sRGB hex → linear working colour
const v3 = (c, k = 1) => `vec3(${(c.r * k).toFixed(4)}, ${(c.g * k).toFixed(4)}, ${(c.b * k).toFixed(4)})`;

export const HAZE = lin(0x9e8c98);        // mauve haze away from the sun (fogColor)
const HAZE_WARM = lin(0xbc9379);          // peach haze toward the sun (the post grade lifts it to the concept's #f3cdae glow)
const GLOW = lin(0xf6d2a8);               // forward-scatter glow around the sun
const SKY_MID = lin(0xa98f9c), SKY_TOP = lin(0x5d5a78);
// golden horizon band (sky only, not the fog): the gameplay frame shows just the lowest ≈ 2-5° of sky, so the sunset
// lives there — saturated gold toward the sun, amber-rose away from it — and distant silhouettes, fogged toward the
// darker HAZE colours, read against it
const HZN_SUN = lin(0xffc070), HZN_AWAY = lin(0xd89a80);
const CLOUD_ROSE = lin(0xc6a3a2), CLOUD_SHADE = lin(0x7e6e80), CLOUD_LIT = lin(0xffe2c0);
// ground dust: a pale layer hugging the plain (scale height DUST[2] m) that thickens from DUST[0] m out over DUST[1] m up
// to DUST[3] — the backlit dust the concept's fight stands in: dark cobbles at the hero's feet, a glowing mid-ground,
// soldiers' legs fading into it with distance. Walls and towers rise out of it (it is gone by ≈ 3 m up).
const DUST = [12.0, 40.0, 1.0, 0.16], DUST_LIT = lin(0xd8b08a), DUST_SHADE = lin(0x6f6a82);
// aerial perspective in chroma: from AP[0] m to AP[1] m colours lose up to AP[2] of their saturation toward the haze hue
// (cool mauve away from the sun, peach toward it) before they lose value — distant troops, the camp and mountains
// recede into the concept's mauve while their silhouettes stay. AP_COOL is bluer than the mauve it should land on:
// post.js's split tone warms every highlight (B × 0.75), so the scene colour has to carry the cool
const AP = [15.0, 110.0, 0.75], AP_COOL = lin(0x8a8cb0);
// geometry fades toward the haze at FOG_K of the sky's own horizon brightness: distant walls, towers and troops stay
// darker than the sunset behind them (the concept's backlit silhouettes) instead of dissolving into it
const FOG_K = 0.62;

const HAZE_GLSL = /* glsl */`
  vec3 dwHaze(vec3 d, vec3 base) {
    float s = max(dot(d, vec3(${SUN_DIR.x.toFixed(4)}, ${SUN_DIR.y.toFixed(4)}, ${SUN_DIR.z.toFixed(4)})), 0.0);
    // warm lobe ≈ ±15° around the sun (a wider lobe floods the watchtowers' patch of sky and they lose their silhouette)
    vec3 c = mix(base, ${v3(HAZE_WARM)}, 0.75 * pow(s, 24.0));
    return c + ${v3(GLOW, 0.3)} * pow(s, 160.0);
  }`;

/** CPU twin of dwHaze (for baked colours). */
export function hazeColor(d, out = new THREE.Color()) {
  const s = Math.max(0, d.dot(SUN_DIR));
  out.copy(HAZE).lerp(HAZE_WARM, 0.75 * Math.pow(s, 24));
  const g = Math.pow(s, 160) * 0.3;
  out.r += GLOW.r * g; out.g += GLOW.g * g; out.b += GLOW.b * g;
  return out;
}

/**
 * Replace three's fog chunks (must run before any material compiles). THREE.Fog(color, near, far) now means:
 * haze starts at `near` metres and reaches 63 % after a further `far` metres, thinning with height. The curve is
 * exp(-x^1.6), not exp(-x): the castle band (50-100 m) stays legible as silhouettes while the horizon still washes out.
 */
export function installHaze() {
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying vec3 vFogDir;\n#endif';
  THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDir = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n#endif';
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor; varying vec3 vFogDir;
    uniform float fogNear; uniform float fogFar;
    ${HAZE_GLSL}
  #endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
    float fogDist = length( vFogDir );
    vec3 fogD = vFogDir / max( fogDist, 1e-3 );
    float fogFactor = 1.0 - exp( - pow( max( fogDist - fogNear, 0.0 ) / fogFar, 1.6 ) );
    float fogY = cameraPosition.y + vFogDir.y;
    fogFactor *= 1.0 - 0.4 * smoothstep( 6.0, 45.0, fogY );
    vec3 fogC = dwHaze( fogD, fogColor ) * ${FOG_K.toFixed(2)};
    float fogSun = smoothstep( 0.0, 0.92, dot( fogD, vec3(${SUN_DIR.x.toFixed(4)}, ${SUN_DIR.y.toFixed(4)}, ${SUN_DIR.z.toFixed(4)}) ) );
    // chroma first: keep each pixel's luminance, move its hue toward the haze
    float apL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 apC = mix( ${v3(AP_COOL)}, ${v3(HAZE_WARM)}, fogSun * fogSun );
    vec3 apTint = apC / dot( apC, vec3( 0.2126, 0.7152, 0.0722 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, apL * apTint, ${AP[2].toFixed(2)} * smoothstep( ${AP[0].toFixed(1)}, ${AP[1].toFixed(1)}, fogDist ) );
    // then the ground dust: glowing peach toward the low sun (backlit), a thin mauve veil away from it
    float dustF = ${DUST[3].toFixed(2)} * ( 1.0 - exp( - max( fogDist - ${DUST[0].toFixed(1)}, 0.0 ) / ${DUST[1].toFixed(1)} ) ) * exp( - max( fogY, 0.0 ) / ${DUST[2].toFixed(1)} );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( ${v3(DUST_SHADE)}, ${v3(DUST_LIT)}, fogSun ), dustF * ( 0.6 + 0.4 * fogSun ) * ( 1.0 - fogFactor ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogFactor );
  #endif`;
}

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vDir;
      ${HAZE_GLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(17.1, 9.2); a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sun = vec3(${SUN_DIR.x.toFixed(4)}, ${SUN_DIR.y.toFixed(4)}, ${SUN_DIR.z.toFixed(4)});
        float s = max(dot(d, sun), 0.0);
        vec3 hz = dwHaze(normalize(vec3(d.x, 0.0, d.z) + vec3(0.0, sun.y, 0.0)), ${v3(HAZE)});
        vec3 up = mix(${v3(SKY_MID)}, ${v3(SKY_TOP)}, smoothstep(0.18, 0.8, h));
        vec3 c = mix(hz, up, smoothstep(0.0, 0.32, h) * (1.0 - 0.75 * s * s * s * s));
        float az = max(dot(normalize(d.xz + vec2(1e-4)), normalize(sun.xz)), 0.0);
        c = mix(c, mix(${v3(HZN_AWAY)}, ${v3(HZN_SUN, 1.5)}, az * az), (1.0 - smoothstep(-0.02, 0.16, h)) * (0.55 + 0.45 * az));
        // blocky voxel clouds on a plane, dusty rose with a gold lining toward the sun
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.1);
          uv = floor(uv * 9.0) / 9.0 + vec2(uTime * 0.004, 0.0);
          float n = fbm(uv * 0.55 + vec2(3.0, 7.0));
          float band = smoothstep(0.015, 0.09, h) * (1.0 - smoothstep(0.32, 0.62, h));
          float cov = smoothstep(0.40, 0.6, n) * band;
          float lit = smoothstep(0.5, 0.78, fbm(uv * 0.55 + vec2(3.0, 7.0) + normalize(sun.xz) * 0.12));   // lit where the cloud thins toward the sun
          vec3 cl = mix(${v3(CLOUD_SHADE)}, ${v3(CLOUD_ROSE)}, 1.0 - lit);
          cl = mix(cl, ${v3(CLOUD_LIT, 0.8)}, pow(s, 10.0) * (0.25 + 0.5 * (1.0 - lit)));   // gold-lit toward the sun (narrow: the
          // sun is in frame now, and a wide lit lobe greys out the watchtowers' patch of sky)
          c = mix(c, cl, cov * 0.92);
        }
        // sun: wide warm scatter, a tight halo and a small hot core (in frame now: a big HDR disc blooms and the DoF
        // smears it over the watchtowers, which must stay silhouettes)
        c += ${v3(GLOW)} * (pow(s, 60.0) * 0.1 + pow(s, 1400.0) * 0.8);
        c = mix(c, vec3(4.2, 3.8, 3.0), smoothstep(0.99968, 0.99976, s));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}
