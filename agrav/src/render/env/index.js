import { buildCity } from './city.js';
import { buildCanyon } from './canyon.js';
import { buildCoast } from './coast.js';
export function buildEnvironment(scene, ribbon, track) {
  switch (track.theme) {
    case 'canyon': return buildCanyon(scene, ribbon, track);
    case 'coast': return buildCoast(scene, ribbon, track);
    default: return buildCity(scene, ribbon, track);
  }
}
