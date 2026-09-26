// Hit readability on the soldiers (render-only): the victim flash, a per-instance "aHit" term patched into the crowd
// material. The contact frame pops white-hot silhouette edges over a lifted body for 1 sim frame (local: a band of 10
// struck soldiers must not merge into one white blob). Then a warm wash is blended into the lit albedo (≤ 0.22, so the
// soldiers stay dark), with a bright emissive rim on the faces that turn away from the camera (the silhouette edges).
// It decays quadratically over ≈ 10 sf: gold on a hit, deep amber on a heavy hit, red on the killing blow (the DW8
// yellow / red-pink wash). Weapons stay untinted (crowd/view.js zeroes the glow for them). Red tints also glow flat and
// KO'd bodies keep a red ember while airborne, so the blow-away fans read over a dark crowd. The hero stays the lightest
// large mass (hero luma ≈ 1.3-1.6× the tinted soldiers in combo-normal). The recoil pose lives in crowd/view.js.
// Driven by crowd.flash[i] (set by combat on the hit frame), crowd.hitHeavy[i], crowd.kod[i], crowd.st[i].
import { COMBAT } from './combat.js';
import { ST } from '../crowd/crowd.js';

/** Adds `aHit` (vec3 tint colour × strength; > 1 = white pop) to a MeshStandardMaterial via onBeforeCompile. */
export function patchHitMaterial(mat) {
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey() + '|hitfx3';   // chain other parts' patches
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = function (sh, renderer) {
    prev.call(this, sh, renderer);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aHit;\nvarying vec3 vHit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHit = aHit;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHit;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float hitA = max(vHit.r, max(vHit.g, vHit.b));
        float hitRim = 1.0 - abs(dot(normal, normalize(vViewPosition)));
        if (hitA > 1.01) {                                            // contact frame: white-hot edges, lifted body
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.15);
          totalEmissiveRadiance += (vHit - 1.0) * (0.1 + 1.3 * hitRim * hitRim);
        } else if (hitA > 0.0) {
          vec3 hitC = vHit / hitA;
          float hitL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          // lit wash: albedo toward the tint, brighter where the albedo is brighter (skin, plates), so shading stays
          diffuseColor.rgb = mix(diffuseColor.rgb, hitC * (0.33 + 1.3 * hitL), 0.22 * hitA);
          // red tints (killing blow, KO ember) also glow flat, so thrown bodies fly as embers over the crowd
          float hitFlat = 0.04 + 0.2 * clamp((0.45 - hitC.g) * 4.0, 0.0, 1.0);
          totalEmissiveRadiance += hitC * hitA * (hitFlat + 0.9 * hitRim * hitRim * hitRim);
        }`);
  };
}

const HOT = [1.55, 1.53, 1.5], GOLD = [1.0, 0.6, 0.12], AMBER = [1.0, 0.4, 0.07], KILL = [1.0, 0.25, 0.12];   // HOT: 1 + white emissive
const EMBER = 0.45;                                                // KO'd bodies keep a dim red rim until they land
/** Tint of soldier i this frame (colour × strength, or HOT on the contact frame), written into out[0..2]. */
export function hitGlow(crowd, i, out) {
  const fl = crowd.flash[i], ember = crowd.kod[i] && crowd.st[i] === ST.AIR ? EMBER : 0;
  if (fl <= 0 && !ember) { out[0] = out[1] = out[2] = 0; return; }
  const heavy = crowd.hitHeavy[i];
  const D = COMBAT.tintFrames - 1 + (heavy ? 3 : 0);               // flash value on the frame a fresh hit shows
  if (fl >= D) { out[0] = HOT[0]; out[1] = HOT[1]; out[2] = HOT[2]; return; }
  const u = Math.min(1, fl / (D - 1)), k = Math.max(ember, u * u);   // decays from the first frame: brief, not a held wash
  const C = crowd.kod[i] ? KILL : heavy ? AMBER : GOLD;
  out[0] = C[0] * k; out[1] = C[1] * k; out[2] = C[2] * k;
}
