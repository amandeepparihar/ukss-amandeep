import type { FastifyInstance } from 'fastify';
import { getSupplierOptions } from './supplier-options.service';
import { createSupplierOrder } from './supplier-create.service';
import { createSupplierOrderSchema } from './allocate.schema';
import { resolvePhpAdminId } from '../orders.helpers';

export async function allocateRoutes(app: FastifyInstance) {
  app.get('/:orderId/supplier-options', { preHandler: [app.requirePermission('orders:edit')] }, async (request) => {
    const { orderId } = request.params as { orderId: string };
    const { orderProductIds } = request.query as { orderProductIds?: string };
    const ids = (orderProductIds ?? '').split('_').map(Number).filter(n => n > 0);
    const data = await getSupplierOptions(Number(orderId), ids);
    return { status: 'success', data };
  });

  app.post('/:orderId/supplier-orders', { preHandler: [app.requirePermission('orders:edit')] }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const parsed = createSupplierOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: 'error', message: 'Invalid payload', issues: parsed.error.issues });
    const adminId = await resolvePhpAdminId(request.cookies);
    const data = await createSupplierOrder(Number(orderId), parsed.data, adminId);
    return { status: 'success', data };
  });
}
