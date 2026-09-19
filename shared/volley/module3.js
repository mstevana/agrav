// Volley 3 vs 3: the same simulation as `volley`, three blobs per side, each owning
// a back / mid / front zone. A separate game id so the room caps at six players.
import { createVolleyModule } from './module.js';

export default createVolleyModule({ id: 'volley3', name: 'Volley 3v3', teamSize: 3 });
