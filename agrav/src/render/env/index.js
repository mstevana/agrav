import { buildCity, prewarmCity } from './city.js';
import { buildCanyon, prewarmCanyon } from './canyon.js';
import { buildCoast, prewarmCoast } from './coast.js';
import { buildHell, prewarmHell } from './hell.js';
import { buildMoon, prewarmMoon } from './moon.js';
import { buildJungle, prewarmJungle } from './jungle.js';
export function buildEnvironment(scene, ribbon, track) {
  switch (track.theme) {
    case 'canyon': return buildCanyon(scene, ribbon, track);
    case 'coast': return buildCoast(scene, ribbon, track);
    case 'hell': return buildHell(scene, ribbon, track);
    case 'moon': return buildMoon(scene, ribbon, track);
    case 'jungle': return buildJungle(scene, ribbon, track);
    default: return buildCity(scene, ribbon, track);
  }
}
/** generate the theme's textures and terrain ahead of the race so the start does not stall */
export function prewarmEnvironment(ribbon, track) {
  switch (track.theme) {
    case 'canyon': return prewarmCanyon(ribbon, track);
    case 'coast': return prewarmCoast(ribbon, track);
    case 'hell': return prewarmHell(ribbon, track);
    case 'moon': return prewarmMoon(ribbon, track);
    case 'jungle': return prewarmJungle(ribbon, track);
    default: return prewarmCity(ribbon, track);
  }
}
