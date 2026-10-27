/**
 * Orders module — main route registration file.
 * Requirements: REQ-01-012 (page modes), REQ-01-014 (AJAX dispatch),
 *   REQ-01-003/04 (permissions), REQ-01-021 (status dropdown)
 *
 * Registers sub-route modules and provides foundation endpoints:
 * - GET /api/orders/statuses — Order status dropdown data
 * - GET /api/orders/permissions — Feature permissions for current user
 * - GET /api/orders/config — DB-defined configuration values
 */

import type { FastifyPluginAsync } from 'fastify';
import { listingRoutes } from './listing/listing.routes';
import { detailsRoutes } from './details/details.routes';
import { productsRoutes } from './products/products.routes';
import { statusRoutes } from './status/status.routes';
import { productActionsRoutes } from './product-actions/product-actions.routes';
import { notificationsRoutes } from './notifications/notifications.routes';
import { processingRoutes } from './processing/processing.routes';
import { allocateRoutes } from './allocate/allocate.routes';
import { getOrderFeaturePermissions } from './orders.permissions';
import { getOrderStatuses, loadDbConfiguration } from './orders.service';
import { sharedSessionService } from '../auth/shared-session.instance';

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  // -----------------------------------------------------------------------
  // Foundation endpoints
  // -----------------------------------------------------------------------

  /**
   * REQ-01-021: Order status dropdown data.
   * Returns all active statuses (status=1) ordered by display_order, then name.
   */
  app.get('/statuses', {
    preHandler: [app.requirePermission('orders:view')],
  }, async () => {
    // REQ-01-005: Language ID from session — default to 1 (English)
    // In Stock2 the language preference is not yet stored in JWT;
    // when it is, pass it via request.user. For now match PHP default.
    const languageId = 1;
    const statuses = await getOrderStatuses(languageId);
    // BUG-413: PHP orders_header.php appends " [id]" suffix to each status name
    // e.g. "Pending [1]", "Processing [2]" — match that display format here.
    return {
      data: statuses.map((s) => ({
        ...s,
        name: `${s.name} [${s.id}]`,
      })),
    };
  });

  /**
   * REQ-01-003 + REQ-01-004: Feature permissions for the current admin.
   * Returns refund/reject permission flags.
   *
   * Resolves the PHP admin ID from the shared session (jsa_SharedAdminSession.phpUserId)
   * so the client never controls which admin ID is queried.
   */
  app.get('/permissions', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    // Resolve PHP admin ID from the shared session cookie — never from client input
    let phpAdminId = 0;
    const sharedToken = request.cookies.shared_admin_session;
    if (sharedToken) {
      const session = await sharedSessionService.validateSession(sharedToken);
      if (session?.phpUserId) {
        phpAdminId = session.phpUserId;
      }
    }

    const permissions = await getOrderFeaturePermissions(phpAdminId);
    return { data: permissions };
  });

  /**
   * REQ-01-010: DB-defined configuration values.
   * Returns specific config keys needed by the orders module.
   * Cached for 5 minutes (CX-009).
   */
  app.get('/config', {
    preHandler: [app.requirePermission('orders:view')],
  }, async () => {
    const config = await loadDbConfiguration();

    // Return only the keys relevant to orders (not the entire config table)
    const relevantKeys = [
      'MULTIPART_FC_BATCH_LIMIT',
      'TOFFS_TYPE_MANUFACTURER_MAPPING',
      'MYSTERY_PRODUCT_CATEGORY',
      'ORDER_PROCESSING_SIMULATION_ELIGIBLE_STATUSES',
      'PRE_ORDER_PROCESSING_ELIGIBLE_STATUSES',
    ];

    const result: Record<string, string> = {};
    for (const key of relevantKeys) {
      const value = config.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }

    return { data: result };
  });

  // -----------------------------------------------------------------------
  // Sub-route modules
  // -----------------------------------------------------------------------

  // SPEC-02: Order listing (browse orders, tabs, filters)
  await app.register(listingRoutes);

  // SPEC-04: Order details (single order view/edit)
  await app.register(detailsRoutes);

  // SPEC-05: Order products table data
  await app.register(productsRoutes);

  // SPEC-07: Order status management (transitions, history, templates, touchpoints)
  await app.register(statusRoutes);

  // SPEC-06: Product-level actions (box number, JIT, backorder, toggles)
  await app.register(productActionsRoutes);

  // SPEC-08: Customer notifications (email dispatch, queries, queue)
  await app.register(notificationsRoutes);

  // SPEC-13: Order processing engine (simulation, batch, remote processing)
  await app.register(processingRoutes);

  // SPEC-12a: Supplier order creation (allocate products to suppliers)
  await app.register(allocateRoutes);
};
