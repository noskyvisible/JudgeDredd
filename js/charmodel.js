import { buildHero } from './charhero.js';
import { buildGeneric } from './chargeneric.js';
export { makeMat } from './charkit.js';

// ---------------------------------------------------------------------------
// Procedural character bodies.  `buildBody` fills the joint groups of a Character:
//   hips > torso > chest > neck > head ; chest > shL/shR > elL/elR > wrL/wrR > handL/handR ;
//   hips > hipL/hipR > knL/knR > anL/anR
// ---------------------------------------------------------------------------
export function buildBody(ch, styleName, st) {
  if (st.hero) return buildHero(ch, st); // Judge Dredd
  return buildGeneric(ch, styleName, st);
}
