import { buildCity, prewarmCity } from './city.js';
import { buildCanyon, prewarmCanyon } from './canyon.js';
import { buildCoast, prewarmCoast } from './coast.js';
export function buildEnvironment(scene, ribbon, track) {
  switch (track.theme) {
    case 'canyon': return buildCanyon(scene, ribbon, track);
    case 'coast': return buildCoast(scene, ribbon, track);
    default: return buildCity(scene, ribbon, track);
  }
}
/** generate the theme's textures and terrain ahead of the race so the start does not stall */
export function prewarmEnvironment(ribbon, track) {
  switch (track.theme) {
    case 'canyon': return prewarmCanyon(ribbon, track);
    case 'coast': return prewarmCoast(ribbon, track);
    default: return prewarmCity(ribbon, track);
  }
}
