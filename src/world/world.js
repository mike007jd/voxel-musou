// Battlefield, as in the concept: a low golden-hour sun in frame between the castle's corner tower and the watchtowers
// on the open flank (the gameplay camera's frame top is only ≈ 5° above level), sun-aware aerial haze (warm
// toward the sun, mauve away), voxel cobbled plaza + road to the gate, stone curtain wall with bastions, gatehouse and
// watchtowers, 魏/蜀 banners with cloth motion, fires with smoke columns and embers, the Wei camp ring, and layered
// mountains. Render-only: never touches sim state; all animation is a pure function of render time.
import * as THREE from 'three';
import { SUN_DIR, HAZE, installHaze, createSky } from './sky.js';
import { buildTerrain } from './terrain.js';
import { buildCastle } from './castle.js';
import { buildDressing } from './dressing.js';

export const ARENA_RADIUS = 46;          // sim clamps hero/crowd inside this
// castle wall face (sim clamps, minimap and the castle set): far enough back that its skyline (wall top, towers, sun
// gap) fits under the gameplay frame's top edge
export const WALL_Z = 100;
export const GATE_X = -10;
// burning barricades/carts at the arena rim: [x, y, z, scale] (ground scorch + fire + wreck)
const FIELD_FIRES = [[-40, 0, 24, 1.3], [38, 0, -24, 1.2], [-22, 0, -44, 1.4], [30, 0, 36, 1.1], [-47, 0, -8, 1.0], [50, 0, 10, 1.3]];
// key light: from behind-left of the wall-facing view, higher than the visible sun so the ground reads (hard shadows
// fall toward the camera, soldiers get a warm rim)
const LIGHT_DIR = new THREE.Vector3(0.5, 0.58, 0.64).normalize();

installHaze();

export function createWorld(scene) {
  scene.background = HAZE.clone();
  scene.fog = new THREE.Fog(HAZE.clone(), 28, 240);   // clear fight disc; ≈ 6 % at the wall, 15 % at the towers, 70 % at 250 m (sky.js)
  const sky = createSky();
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xaeaac6, 0x8e7a6e, 2.0);  // cool mauve sky fill (neutral enough that shaded brown stone stays brown, not rose), dust bounce
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdcc0, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0xffb07a, 1.2);            // warm back/rim light from the visible sun
  rim.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(rim);

  buildTerrain(scene, GATE_X, FIELD_FIRES);
  const castle = buildCastle(scene, { wallZ: WALL_Z, gateX: GATE_X });
  const dressing = buildDressing(scene, { wallZ: WALL_Z, gateX: GATE_X, castle, fieldFires: FIELD_FIRES });

  // fire glow on the gate and on the two nearest field fires
  const fireLights = [[GATE_X - 6.5, 2.2, WALL_Z - 3.5], [GATE_X + 7, 2.2, WALL_Z - 3.5], [-40, 2, 24]].map(([x, y, z]) => {
    const l = new THREE.PointLight(0xff8a3a, 30, 11, 2); l.position.set(x, y, z); scene.add(l); return l;
  });

  const tmp = new THREE.Vector3();
  let t = 0;
  return {
    fires: dressing.fires,
    update(dt, focus) {
      t += dt;
      // shadow frustum follows the focus (snapped to texels to avoid shimmer)
      const step = 56 / 2048;
      tmp.set(Math.round(focus.x / step) * step, 0, Math.round(focus.z / step) * step);
      sun.target.position.copy(tmp);
      sun.position.copy(LIGHT_DIR).multiplyScalar(70).add(tmp);
      sky.material.uniforms.uTime.value = t;
      dressing.update(t);
      castle.update(t);
      fireLights.forEach((l, i) => { l.intensity = 28 + Math.sin(t * (13 + i * 3.1) + i) * 5 + Math.sin(t * 7.3 + i * 2) * 4; });
    },
  };
}
