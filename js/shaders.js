import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shader patches: height-based fog, wet walls, rain ripples on puddles and a
// fresnel rim light for characters.  Everything is injected into three's
// built-in physical material so lighting/shadows/PBR keep working.
// ---------------------------------------------------------------------------

export const HASH_GLSL = `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
`;

// Fog that is thickest at street level and thins out with height, so tower tops
// pierce the haze while the canyons stay moody.  Replaces the stock EXP2 chunks.
export function installHeightFog() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
varying float vFogDepth;
varying float vFogY;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
vFogDepth = - mvPosition.z;
vFogY = cameraPosition.y + dot(viewMatrix[1].xyz, mvPosition.xyz);
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor;
varying float vFogDepth;
varying float vFogY;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
#ifdef FOG_EXP2
float fogH = 0.30 + 0.70 * exp( - max( vFogY - 3.0, 0.0 ) * 0.0105 );
float fogD = fogDensity * fogH;
float fogFactor = 1.0 - exp( - fogD * fogD * vFogDepth * vFogDepth );
vec3 fogTint = mix( fogColor * vec3( 1.25, 0.95, 1.05 ), fogColor * vec3( 0.75, 0.9, 1.3 ), smoothstep( 0.0, 140.0, vFogY ) );
#else
float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
vec3 fogTint = fogColor;
#endif
gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif`;
}

// Walls get darker and glossier near street level (rain-soaked), so the lower
// floors pick up neon reflections from the env map.
export function patchWall(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'varying vec3 vWPos;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
float wetH = 1.0 - smoothstep(0.0, 18.0, vWPos.y);
float groundAO = 1.0 - smoothstep(0.0, 2.2, vWPos.y);
diffuseColor.rgb *= (1.0 - 0.38 * wetH) * (1.0 - 0.35 * groundAO);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, wetH );`);
  };
  mat.customProgramCacheKey = () => 'wall-v1';
}

// Asphalt: rain ripples bloom on puddles (where the roughness map is low).
export function patchRoad(mat, timeUniform) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'varying vec3 vWPos;\nuniform float uTime;\n' + HASH_GLSL + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float puddle = 1.0 - smoothstep(0.05, 0.3, texelRoughness.g);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float rdist = length(cameraPosition - vWPos);
  float rk = puddle * (1.0 - smoothstep(14.0, 42.0, rdist));
  if (rk > 0.01) {
    vec2 g = vec2(0.0);
    for (int L = 0; L < 2; L++) {
      float cs = L == 0 ? 1.3 : 0.85;
      vec2 q = vWPos.xz / cs + float(L) * 7.31;
      vec2 cell = floor(q);
      vec2 f = fract(q) - 0.5;
      float h1 = hash21(cell), h2 = hash21(cell + 31.7);
      vec2 c = (vec2(h1, h2) - 0.5) * 0.35;
      float ph = fract(uTime * (0.5 + 0.45 * h1) + h2);
      float Rm = 0.46 * cs;
      float rr = ph * Rm;
      vec2 dm = (f - c) * cs;
      float dist = length(dm);
      float w = exp(-pow((dist - rr) / 0.045, 2.0)) * (1.0 - ph);
      g += dm / (dist + 1e-4) * w * sin((dist - rr) * 70.0);
    }
    normal = normalize(normal + (mat3(viewMatrix) * vec3(g.x, 0.0, g.y)) * 0.55 * rk);
  }
}`);
  };
  mat.customProgramCacheKey = () => 'road-v1';
}

// Fresnel rim: pops character silhouettes out of the dark street.
export function patchRim(mat, color = 0x6aa8ff, power = 2.6, intensity = 0.9) {
  const c = new THREE.Color(color);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: c };
    shader.uniforms.uRimPow = { value: power };
    shader.uniforms.uRimK = { value: intensity };
    shader.fragmentShader = 'uniform vec3 uRimColor; uniform float uRimPow; uniform float uRimK;\n' + shader.fragmentShader
      .replace('#include <opaque_fragment>', `
{
  float rim = pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), uRimPow );
  outgoingLight += uRimColor * rim * uRimK;
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'rim-v1';
  return mat;
}
