// ============================================================================
// Game registry. A game is a module in shared/<game>/module.js implementing
// the contract documented in shared/net/module-contract.md; the server never
// imports game code directly, it asks this registry.
// ============================================================================

const loaders = {
  agrav: () => import('../shared/agrav/module.js'),
  volley: () => import('../shared/volley/module.js')
};

const cache = new Map();

export async function loadGame(id) {
  if (cache.has(id)) return cache.get(id);
  const loader = loaders[id];
  if (!loader) return null;
  const mod = (await loader()).default;
  cache.set(id, mod);
  return mod;
}

/** tests register throwaway modules here */
export function registerGame(id, module) { cache.set(id, module); }

export function listGames() {
  return [...new Set([...Object.keys(loaders), ...cache.keys()])];
}
