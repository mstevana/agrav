// Volley 1 vs 1: the same simulation as `volley`, one blob per side, each owning
// a whole half. A separate game id so the room caps at two players.
import { createVolleyModule } from './module.js';

export default createVolleyModule({ id: 'volley1', name: 'Volley 1v1', teamSize: 1 });
