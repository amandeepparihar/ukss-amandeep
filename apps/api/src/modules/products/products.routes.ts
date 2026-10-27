/**
 * New Product Module — Route registrar.
 *
 * The route handlers were split into two sub-plugins purely to keep each file
 * small (no behaviour change). Both are registered here without their own
 * prefix, so they inherit this plugin's `/api/products` prefix and the root
 * instance's decorators (`authenticate`, `requirePermission`).
 *
 *   - products-lookup.routes.ts → lookups, product-code CRUD, inventory
 *   - products-image.routes.ts  → Dify AI, uploads, enhance, bg-removal, crop, save-details
 *
 * Requirements: REQ-6 (lookup endpoints), REQ-1 (product code),
 *   REQ-3.4 (barcode check), REQ-7 (permissions), REQ-5 (save details)
 */

import type { FastifyPluginAsync } from 'fastify';
import { productLookupRoutes } from './products-lookup.routes';
import { productImageRoutes } from './products-image.routes';

export const productRoutes: FastifyPluginAsync = async (app) => {
  await app.register(productLookupRoutes);
  await app.register(productImageRoutes);
};
