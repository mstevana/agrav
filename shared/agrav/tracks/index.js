import meridian from './meridian.js';
import canyon from './canyon.js';
import vanta from './vanta.js';

export const TRACKS = Object.freeze({ meridian, canyon, vanta });
export const TRACK_IDS = Object.keys(TRACKS);
export function getTrack(id) { return TRACKS[id] || TRACKS.meridian; }
