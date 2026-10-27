// Standalone Vercel functions are tree-shakable; the full client would add ~2 MB.
export { VercelCore } from '@vercel/sdk/core.js';
export { aliasesAssignAlias } from '@vercel/sdk/funcs/aliasesAssignAlias.js';
export { aliasesGetAlias } from '@vercel/sdk/funcs/aliasesGetAlias.js';
export { deploymentsGetDeployment } from '@vercel/sdk/funcs/deploymentsGetDeployment.js';
export { deploymentsGetDeployments } from '@vercel/sdk/funcs/deploymentsGetDeployments.js';
export { projectsGetProject } from '@vercel/sdk/funcs/projectsGetProject.js';
export { createNeonClient } from '@neon/sdk';
