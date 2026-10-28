// Standalone Vercel functions are tree-shakable; the full client would add ~2 MB.
export { VercelCore } from '@vercel/sdk/core.js';
export { aliasesAssignAlias } from '@vercel/sdk/funcs/aliasesAssignAlias.js';
export { aliasesDeleteAlias } from '@vercel/sdk/funcs/aliasesDeleteAlias.js';
export { aliasesGetAlias } from '@vercel/sdk/funcs/aliasesGetAlias.js';
export { aliasesListAliases } from '@vercel/sdk/funcs/aliasesListAliases.js';
export { deploymentsDeleteDeployment } from '@vercel/sdk/funcs/deploymentsDeleteDeployment.js';
export { deploymentsGetDeployment } from '@vercel/sdk/funcs/deploymentsGetDeployment.js';
export { deploymentsGetDeployments } from '@vercel/sdk/funcs/deploymentsGetDeployments.js';
export { projectsGetProject } from '@vercel/sdk/funcs/projectsGetProject.js';
export { createNeonClient } from '@neon/sdk';
