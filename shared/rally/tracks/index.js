import scrapyard from './scrapyard.js';

export const TRACKS = Object.freeze([scrapyard]);
export const TRACK_IDS = Object.freeze(TRACKS.map(t => t.id));

const BY_ID = new Map(TRACKS.map(t => [t.id, t]));
export const getTrack = (id) => BY_ID.get(id) || TRACKS[0];
export const isTrackId = (id) => BY_ID.has(id);
