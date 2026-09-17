import meridian from './meridian.js';
import canyon from './canyon.js';
import vanta from './vanta.js';
import inferno from './inferno.js';
import selene from './selene.js';
import osa from './osa.js';

// insertion order matters: TRACK_IDS[0] is the fallback for an invalid room option
export const TRACKS = Object.freeze({ meridian, canyon, vanta, inferno, selene, osa });
export const TRACK_IDS = Object.keys(TRACKS);
export function getTrack(id) { return TRACKS[id] || TRACKS.meridian; }
