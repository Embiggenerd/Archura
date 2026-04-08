export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.CTCeqQJ0.js",app:"_app/immutable/entry/app.B4Eznkp3.js",imports:["_app/immutable/entry/start.CTCeqQJ0.js","_app/immutable/chunks/Cn-wmNfj.js","_app/immutable/chunks/BLGLA4ug.js","_app/immutable/chunks/C-y4U3SK.js","_app/immutable/entry/app.B4Eznkp3.js","_app/immutable/chunks/BLGLA4ug.js","_app/immutable/chunks/kbAtuVqC.js","_app/immutable/chunks/nw-pxPsJ.js","_app/immutable/chunks/C-y4U3SK.js","_app/immutable/chunks/Dapz69Dj.js","_app/immutable/chunks/Cpl3PRTS.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
