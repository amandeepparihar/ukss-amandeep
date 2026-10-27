/**
 * Orders detail routes — single order view/edit page + panel endpoints.
 * Requirements: REQ-04-001 (validation), REQ-04-002 (navigation),
 *   REQ-04-004 (viewers), REQ-04-007 (priority/approve), REQ-04-019 (lock),
 *   REQ-03-001 (panel), REQ-03-009 (reject), REQ-03-015 (refund review),
 *   REQ-03-013 (suppliers)
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  OrderIdParamSchema,
  OrderNavigationSchema,
  CustomerToggleSchema,
  RejectOrderSchema,
  RefundReviewSchema,
  UpdateSuppliersSchema,
  DeleteOrderSchema,
} from '../orders.schema';
import {
  getOrderDetails,
  getOrderViewers,
  getNextOrderId,
  togglePriorityCustomer,
  toggleApproveCustomer,
  toggleLockForReview,
} from './details.service';
import { getOrderPanelData, updateRefundReviewStatus, updateOrderSuppliers, cancelOrderRefund } from './panel.service';
import { rejectOrder } from './rejection.service';
import { deleteOrder } from './deletion.service';
import { getOrderFeaturePermissions } from '../orders.permissions';
import { NotFoundError, AuthorizationError } from '../../../lib/errors';
import { sharedSessionService } from '../../auth/shared-session.instance';

export const detailsRoutes: FastifyPluginAsync = async (app) => {
  // -----------------------------------------------------------------------
  // REQ-04-001: Full order details for edit page
  // -----------------------------------------------------------------------

  app.get('/:id', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);
    const details = await getOrderDetails(id);

    if (!details) {
      throw new NotFoundError('Order');
    }

    return { data: details };
  });

  // -----------------------------------------------------------------------
  // REQ-04-002: Prev/Next order navigation
  // -----------------------------------------------------------------------

  app.get('/:id/navigation', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);
    const { status, direction } = OrderNavigationSchema.parse(request.query);

    const nextId = await getNextOrderId(id, status ?? null, direction);

    if (!nextId) {
      return {
        status: 'error' as const,
        message: 'No more orders exist',
        data: null,
      };
    }

    return {
      status: 'success' as const,
      message: 'OK',
      data: { orderId: nextId },
    };
  });

  // -----------------------------------------------------------------------
  // REQ-04-004: Concurrent viewer detection (polled every 3s from frontend)
  // -----------------------------------------------------------------------

  app.get('/:id/viewers', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);

    // Resolve PHP admin ID from shared session cookie
    let phpAdminId = 0;
    const sharedToken = request.cookies.shared_admin_session;
    if (sharedToken) {
      const session = await sharedSessionService.validateSession(sharedToken);
      if (session?.phpUserId) {
        phpAdminId = session.phpUserId;
      }
    }

    const viewers = await getOrderViewers(id, phpAdminId);
    return { data: viewers };
  });

  // -----------------------------------------------------------------------
  // REQ-04-007: Toggle priority customer
  // -----------------------------------------------------------------------

  app.post('/:id/priority', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { customersId } = CustomerToggleSchema.parse(request.body);
    const isPriority = await togglePriorityCustomer(customersId);

    return {
      status: 'success' as const,
      message: isPriority ? 'Customer marked as priority' : 'Priority removed',
      data: { isPriority },
    };
  });

  // -----------------------------------------------------------------------
  // REQ-04-007: Toggle approve customer
  // -----------------------------------------------------------------------

  app.post('/:id/approve', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { customersId } = CustomerToggleSchema.parse(request.body);
    const isApproved = await toggleApproveCustomer(customersId);

    return {
      status: 'success' as const,
      message: isApproved ? 'Customer approved' : 'Approval removed',
      data: { isApproved },
    };
  });

  // -----------------------------------------------------------------------
  // REQ-04-019: Toggle lock for review
  // -----------------------------------------------------------------------

  app.post('/:id/lock-for-review', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);
    const isLocked = await toggleLockForReview(id);

    return {
      status: 'success' as const,
      message: isLocked ? 'Order locked for admin review' : 'Order unlocked',
      data: { isLocked },
    };
  });

  // -----------------------------------------------------------------------
  // SPEC-03: Order Details Panel endpoints
  // -----------------------------------------------------------------------

  /**
   * REQ-03-001/002: Fetch panel data for the right-side quick view.
   */
  app.get('/:id/panel', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);
    const panelData = await getOrderPanelData(id);

    if (!panelData) {
      throw new NotFoundError('Order');
    }

    return { data: panelData };
  });

  /**
   * REQ-03-009/010: Reject order with one of 5 action types.
   * Requires both orders:edit permission AND reject feature permission (permission_id=2).
   */
  app.post('/:id/reject', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);
    const { actionType } = RejectOrderSchema.parse(request.body);

    // Enforce reject permission (REQ-03-008)
    let phpAdminId = 0;
    const sharedToken = request.cookies.shared_admin_session;
    if (sharedToken) {
      const session = await sharedSessionService.validateSession(sharedToken);
      if (session?.phpUserId) phpAdminId = session.phpUserId;
    }
    const perms = await getOrderFeaturePermissions(phpAdminId);
    if (!perms.rejectPermission) {
      throw new AuthorizationError('Reject permission required');
    }

    const result = await rejectOrder(id, actionType);
    return result;
  });

  /**
   * REQ-03-015: Update refund review status.
   */
  app.post('/:id/refund-review', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);
    const { status, comment } = RefundReviewSchema.parse(request.body);
    await updateRefundReviewStatus(id, status, comment);
    return {
      status: 'success' as const,
      message: status === 0 ? 'Removed from refund review'
        : status === 2 ? 'Refund review resolved'
        : 'Added to refund review',
    };
  });

  /**
   * REQ-03-013: Update supplier assignment.
   */
  app.put('/:id/suppliers', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);
    const { suppliers } = UpdateSuppliersSchema.parse(request.body);
    await updateOrderSuppliers(id, suppliers);
    return {
      status: 'success' as const,
      message: 'Suppliers updated',
    };
  });

  /**
   * REQ-03-005: Cancel a pending refund on a rejected order.
   * Resets refund_status_for_reject_orders from 1 to 0.
   * Requires reject permission.
   */
  app.post('/:id/cancel-refund', {
    preHandler: [app.requirePermission('orders:edit')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);

    // Enforce reject permission (same as cancel refund button visibility check)
    let phpAdminId = 0;
    const sharedToken = request.cookies.shared_admin_session;
    if (sharedToken) {
      const session = await sharedSessionService.validateSession(sharedToken);
      if (session?.phpUserId) phpAdminId = session.phpUserId;
    }
    const perms = await getOrderFeaturePermissions(phpAdminId);
    if (!perms.rejectPermission) {
      throw new AuthorizationError('Reject permission required to cancel refund');
    }

    const success = await cancelOrderRefund(id);
    return {
      status: success ? 'success' as const : 'error' as const,
      message: success
        ? 'Refund cancelled successfully'
        : 'Order is not in a refundable state',
    };
  });

  /**
   * REQ-03-006: Delete an order with optional restock.
   * Removes order and all related data from 5 tables.
   */
  app.post('/:id/delete', {
    preHandler: [app.requirePermission('orders:delete')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);
    const { restock } = DeleteOrderSchema.parse(request.body);

    const result = await deleteOrder(id, restock);
    return result;
  });
};
