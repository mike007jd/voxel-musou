/**
 * Lens clear (render-only): fragments closer than `near` m to the camera are cut away, so debris flying past the lens
 * (a C6 boulder, a KO burst) never blacks out the frame. Chains with an earlier onBeforeCompile (works instanced).
 */
export function lensClear(material, near = 2) {
  const prev = material.onBeforeCompile, key = material.customProgramCacheKey() + '|lens' + near;
  material.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying float vLensD;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vLensD = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `varying float vLensD;\nvoid main() {\n  if (vLensD < ${near.toFixed(2)}) discard;`);
  };
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}
