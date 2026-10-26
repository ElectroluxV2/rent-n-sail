// Expose Angular's compiled SSR request handler as a Vercel Node.js Function.
// https://vercel.com/docs/functions/runtimes/node-js
export { reqHandler as default } from '../dist/frontend/server/server.mjs';
