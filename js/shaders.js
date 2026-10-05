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

// Window layouts of the facade sheets (js/facades.js), in texture pixels, so lit windows can be rendered as real 3-D rooms.
// Each snippet defines: cell (grid index), cp (position inside the cell, y down), cs (cell size), g0/gs (glass rectangle inside the cell).
// A room is the whole floor-to-ceiling cell, so sill height, ceiling and side walls come out physically right.
const WIN_LAYOUT = [
  `const vec2 cs = vec2(512.0 / 6.0, 128.0); vec2 cell = floor(pxy / cs); vec2 cp = pxy - cell * cs;
   vec2 g0 = vec2((cs.x - 52.0) * 0.5 + 5.0, 29.0), gs = vec2(42.0, 60.0);`,
  `const vec2 cs = vec2(64.0, 128.0); vec2 cell = floor(pxy / cs); vec2 cp = pxy - cell * cs;
   vec2 g0 = vec2(2.0, 6.0), gs = vec2(60.0, 86.0);`,
  `const vec2 cs = vec2(51.2, 512.0 / 6.0); vec2 cell = floor(pxy / cs); vec2 cp = pxy - cell * cs;
   vec2 g0 = vec2((cs.x - 30.0) * 0.5 + 3.0, 17.0), gs = vec2(24.0, 46.0);`,
];
const INTERIOR_GLSL = (v) => `
#include <emissivemap_fragment>
{
  float distW = length(cameraPosition - vWPos);
  float el = max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b);
  if (el > 0.02 && distW < 100.0) {
    vec2 uvT = vEmissiveMapUv;
    vec2 pxy = vec2(fract(uvT.x), 1.0 - fract(uvT.y)) * 512.0;
    ${WIN_LAYOUT[v]}
    vec2 q = (cp - g0) / gs;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      const float K = 12.0 / 512.0;
      vec2 boxM = cs * K;                                               // room width / height in metres
      vec3 Nw = normalize(inverseTransformDirection(nonPerturbedNormal, viewMatrix));
      vec3 dp1 = dFdx(vWPos), dp2 = dFdy(vWPos); vec2 du1 = dFdx(uvT), du2 = dFdy(uvT);
      vec3 dp1p = cross(Nw, dp1), dp2p = cross(dp2, Nw);
      vec3 Tw = normalize(dp2p * du1.x + dp1p * du2.x), Bw = normalize(dp2p * du1.y + dp1p * du2.y);
      vec3 Vw = normalize(cameraPosition - vWPos);
      float vz = dot(Vw, Nw);
      if (vz > 0.06) {
        vec2 tile = floor(uvT);
        float h1 = hash21(cell + tile * 7.13), h2 = hash21(cell.yx + 13.7 + tile), h3 = hash21(cell * 1.7 + 5.3 + tile.yx);
        float D = mix(3.0, 6.5, h1);
        vec3 sP = vec3(cp.x * K, (cs.y - cp.y) * K, 0.0);              // where the sight line crosses the glass, in room coordinates (x right, y up from the floor, z into the room)
        vec3 dr = vec3(-dot(Vw, Tw), -dot(Vw, Bw), vz);
        if (abs(dr.x) < 1e-4) dr.x = 1e-4; if (abs(dr.y) < 1e-4) dr.y = 1e-4;
        vec3 tv = vec3((dr.x > 0.0 ? boxM.x - sP.x : -sP.x) / dr.x, (dr.y > 0.0 ? boxM.y - sP.y : -sP.y) / dr.y, D / dr.z);
        float tt = min(min(tv.x, tv.y), tv.z);
        vec3 hit = sP + dr * tt;
        vec3 lamp = vec3(boxM.x * (0.5 + (h2 - 0.5) * 0.5), boxM.y - 0.12, D * (0.35 + 0.3 * h3));
        float dl = length(hit - lamp);
        float lightK = 0.95 / (0.55 + 0.22 * dl * dl);
        vec3 wallHue = vec3(0.6 + 0.4 * h1, 0.55 + 0.45 * h2, 0.55 + 0.45 * h3);
        vec3 rc;
        if (tt == tv.z) {                                                   // back wall
          rc = wallHue * 0.85;
          float fx = h2 * max(boxM.x - 0.9, 0.05);
          if (hit.y < 0.45 + 0.4 * h3 && hit.x > fx && hit.x < fx + 0.55 + 0.5 * h1) rc = vec3(0.1, 0.07, 0.06);                      // sofa / bed
          if (h1 > 0.8 && abs(hit.x - boxM.x * (0.25 + 0.5 * h3)) < 0.14 && hit.y < 1.15 + 0.6 * h2) rc = vec3(0.015, 0.015, 0.02);    // someone standing in the room
          if (h3 < 0.2 && hit.y > 0.95 && hit.y < 1.55 && abs(hit.x - boxM.x * 0.5) < 0.3) rc = vec3(1.1, 1.0, 0.85);                 // a lit screen
        } else if (tt == tv.y) {                                            // floor / ceiling
          rc = dr.y < 0.0 ? vec3(0.3, 0.19, 0.12) * (0.6 + 0.4 * step(0.5, fract(hit.z * 4.0))) : vec3(0.85);
        } else rc = wallHue * 0.55;                                          // side walls
        // soft corner darkening makes the box read as a room
        float edge = min(min(hit.x, boxM.x - hit.x), hit.y) ;
        rc *= lightK * (0.45 + 0.55 * smoothstep(0.0, 0.35, edge));
        vec3 tintN = totalEmissiveRadiance / el;
        vec3 room = tintN * mix(vec3(dot(rc, vec3(0.33))), rc, 0.4) * (0.25 + 0.75 * el) * 1.25;
        totalEmissiveRadiance = mix(totalEmissiveRadiance, room, 1.0 - smoothstep(45.0, 100.0, distW));
      }
    }
  }
}`;

// Walls get darker and glossier near street level (rain-soaked), so the lower
// floors pick up neon reflections from the env map.  Lit windows of facade variants 0-2 become interior-mapped rooms.
export function patchWall(mat, variant = 3) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'varying vec3 vWPos;\n' + (variant < 3 ? HASH_GLSL : '') + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
float wetH = 1.0 - smoothstep(0.0, 18.0, vWPos.y);
float groundAO = 1.0 - smoothstep(0.0, 2.2, vWPos.y);
diffuseColor.rgb *= (1.0 - 0.38 * wetH) * (1.0 - 0.35 * groundAO);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, wetH );`);
    if (variant < 3) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', INTERIOR_GLSL(variant));
  };
  mat.customProgramCacheKey = () => 'wall-v2-' + variant;
}

// Asphalt / sidewalk: rain ripples bloom on puddles, and the planar ground reflection (js/reflect.js) is mixed in
// with a roughness-driven blur that smears vertically (the GGX highlight stretches toward the viewer), so wet roads
// mirror Dredd, traffic, neon and the sky.  Puddles (low roughness) are near-mirrors; rough patches only catch grazing light.
const REFL_GLSL = `
uniform sampler2D uReflTex; uniform mat4 uReflVP; uniform float uReflOn; uniform vec2 uReflRes;
const vec2 RP[8] = vec2[8](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621), vec2(0.962,-0.195), vec2(0.473,-0.480), vec2(0.519,0.767), vec2(0.185,-0.893));
vec3 groundReflect(vec2 uv, float rough) {
  float spread = 0.0018 + rough * rough * 0.075;
  float lod = max(0.0, log2(spread * uReflRes.y) - 1.0);
  vec2 aniso = vec2(1.0, 1.0 + 3.2 * smoothstep(0.1, 0.55, rough));
  vec3 acc = textureLod(uReflTex, uv, lod).rgb * 1.5; float ws = 1.5;
  for (int i = 0; i < 8; i++) { float w = 1.0 - 0.4 * dot(RP[i], RP[i]); acc += textureLod(uReflTex, uv + RP[i] * spread * aniso, lod).rgb * w; ws += w; }
  return acc / ws;
}
`;
export function patchRoad(mat, timeUniform, reflU) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    if (reflU) Object.assign(shader.uniforms, reflU);
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'varying vec3 vWPos;\nuniform float uTime;\n' + HASH_GLSL + (reflU ? REFL_GLSL : '') + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float puddle = 1.0 - smoothstep(0.05, 0.3, texelRoughness.g);
roughnessFactor = max(roughnessFactor * 0.66, 0.02);`)
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
    if (reflU) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
if (uReflOn > 0.5) {
  vec4 rc = uReflVP * vec4(vWPos, 1.0);
  if (rc.w > 0.0) {
    vec3 nW = inverseTransformDirection(normal, viewMatrix);
    vec2 ruv = rc.xy / rc.w * 0.5 + 0.5;
    ruv += nW.xz * (0.012 + roughnessFactor * 0.022);
    float edge = smoothstep(0.0, 0.05, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
    float NoV = saturate(dot(normal, normalize(vViewPosition)));
    float gloss = 1.0 - roughnessFactor;
    float F0 = mix(0.035, 0.1, gloss * gloss);
    float F = mix(F0, 1.0, pow(1.0 - NoV, 4.5));
    float wet = smoothstep(0.78, 0.12, roughnessFactor);
    vec3 refl = groundReflect(clamp(ruv, 0.002, 0.998), roughnessFactor);
    outgoingLight += refl * F * wet * edge * 1.15;
  }
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'road-v2' + (reflU ? 'r' : '');
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
