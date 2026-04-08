

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/layout.svelte.js')).default;
export const imports = ["_app/immutable/nodes/0.DP4ykbkf.js","_app/immutable/chunks/IAkNMeSi.js","_app/immutable/chunks/CjaWL43I.js","_app/immutable/chunks/BQDEynR_.js"];
export const stylesheets = [];
export const fonts = [];
