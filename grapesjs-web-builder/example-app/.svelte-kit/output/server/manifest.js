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
		client: {start:"_app/immutable/entry/start.C5AhxNIO.js",app:"_app/immutable/entry/app.CX-UY1Tf.js",imports:["_app/immutable/entry/start.C5AhxNIO.js","_app/immutable/chunks/DK5IrK47.js","_app/immutable/chunks/CjaWL43I.js","_app/immutable/chunks/D2nrmzOV.js","_app/immutable/entry/app.CX-UY1Tf.js","_app/immutable/chunks/BEQwtr-X.js","_app/immutable/chunks/CjaWL43I.js","_app/immutable/chunks/ChxQDCaf.js","_app/immutable/chunks/IAkNMeSi.js","_app/immutable/chunks/D2nrmzOV.js","_app/immutable/chunks/DEnd9KgC.js","_app/immutable/chunks/BQDEynR_.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js'))
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
			},
			{
				id: "/demo",
				pattern: /^\/demo\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/demo/[...componentPath]",
				pattern: /^\/demo(?:\/([^]*))?\/?$/,
				params: [{"name":"componentPath","optional":false,"rest":true,"chained":true}],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
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
