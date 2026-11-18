/// <reference types="vite-plugin-pwa/client" />

/** Short git hash of the build; injected by Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** Build date, `YYYY-MM-DD`; injected by Vite `define`. */
declare const __BUILD_DATE__: string;
/** Whether this build has the developer panel (dev server, tests, `test` builds); the literal `false` in production. Injected by Vite `define`. */
declare const __DEV_PANEL__: boolean;
