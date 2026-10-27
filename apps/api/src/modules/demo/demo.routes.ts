import type { FastifyPluginAsync } from 'fastify';
import { listQuerySchema, calculatePaginationMeta } from '@admin/shared';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';

/**
 * SIMPLE SERVER-SIDE DATATABLE PATTERN
 *
 * Copy this file and replace:
 * - "DemoProduct" with your model name
 * - "DemoCategory/DemoStatus" with your filter models
 * - Update the fields in where clause and response
 *
 * Key rule: Use the SAME filtering in list AND export endpoints
 */

export const demoRoutes: FastifyPluginAsync = async (app) => {

  // =====================================================
  // FILTER OPTIONS - Fetch from master tables
  // =====================================================

  // GET /api/demo/categories - For category dropdown
  app.get('/categories', {
    preHandler: [app.authenticate],
  }, async () => {
    const categories = await prisma.demoCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { products: true } },
      },
    });

    return {
      data: categories.map((c) => ({
        id: c.id,
        label: c.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: c.id,
        count: c._count.products,
      })),
    };
  });

  // GET /api/demo/statuses - For status dropdown
  app.get('/statuses', {
    preHandler: [app.authenticate],
  }, async () => {
    const statuses = await prisma.demoStatus.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        label: true,
        color: true,
        _count: { select: { products: true } },
      },
    });

    return {
      data: statuses.map((s) => ({
        id: s.id,
        label: s.label,
        value: s.id,
        color: s.color,
        count: s._count.products,
      })),
    };
  });

  // GET /api/demo/products/stats - Filter options with counts
  app.get('/products/stats', {
    preHandler: [app.authenticate],
  }, async () => {
    const [total, categories, statuses] = await Promise.all([
      prisma.demoProduct.count(),
      prisma.demoCategory.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, _count: { select: { products: true } } },
      }),
      prisma.demoStatus.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, label: true, color: true, _count: { select: { products: true } } },
      }),
    ]);

    return {
      data: {
        total,
        categories: categories.map((c) => ({
          id: c.id,
          label: c.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: c.id,
          count: c._count.products,
        })),
        statuses: statuses.map((s) => ({
          id: s.id,
          label: s.label,
          value: s.id,
          color: s.color,
          count: s._count.products,
        })),
      },
    };
  });

  // =====================================================
  // LIST PRODUCTS - Server-side pagination, sort, filter
  // =====================================================

  app.get('/products', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const raw = request.query as Record<string, unknown>;

    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';
    const search = query.search || '';

    // Get filter values from query string
    const categoryIds = raw.categoryId
      ? (Array.isArray(raw.categoryId) ? raw.categoryId : [raw.categoryId]) as string[]
      : [];
    const statusIds = raw.statusId
      ? (Array.isArray(raw.statusId) ? raw.statusId : [raw.statusId]) as string[]
      : [];

    // ========== BUILD WHERE CLAUSE ==========
    // IMPORTANT: Copy this EXACT same logic to export endpoint
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryIds.length > 0) {
      where.categoryId = { in: categoryIds };
    }

    if (statusIds.length > 0) {
      where.statusId = { in: statusIds };
    }
    // ========== END WHERE CLAUSE ==========

    // Build order by
    const orderBy: any = {};
    if (sortBy === 'category') {
      orderBy.category = { name: sortOrder };
    } else if (sortBy === 'status') {
      orderBy.status = { sortOrder: sortOrder };
    } else {
      orderBy[sortBy] = sortOrder;
    }

    // Fetch data
    const [products, total] = await Promise.all([
      prisma.demoProduct.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true } },
          status: { select: { id: true, name: true, label: true, color: true } },
        },
      }),
      prisma.demoProduct.count({ where }),
    ]);

    return {
      data: products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        price: Number(p.price),
        stock: p.stock,
        category: p.category,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      meta: calculatePaginationMeta(total, page, pageSize),
    };
  });

  // =====================================================
  // EXPORT PRODUCTS - CSV or Excel with SAME filters
  // =====================================================

  app.get('/products/export', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const raw = request.query as Record<string, unknown>;

    const format = (raw.format as string) || 'csv';
    const sortBy = (raw.sortBy as string) || 'createdAt';
    const sortOrder = (raw.sortOrder as 'asc' | 'desc') || 'desc';
    const search = (raw.search as string) || '';

    // Get filter values from query string
    const categoryIds = raw.categoryId
      ? (Array.isArray(raw.categoryId) ? raw.categoryId : [raw.categoryId]) as string[]
      : [];
    const statusIds = raw.statusId
      ? (Array.isArray(raw.statusId) ? raw.statusId : [raw.statusId]) as string[]
      : [];

    // ========== BUILD WHERE CLAUSE ==========
    // IMPORTANT: This is SAME as list endpoint above
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryIds.length > 0) {
      where.categoryId = { in: categoryIds };
    }

    if (statusIds.length > 0) {
      where.statusId = { in: statusIds };
    }
    // ========== END WHERE CLAUSE ==========

    // Build order by
    const orderBy: any = {};
    if (sortBy === 'category') {
      orderBy.category = { name: sortOrder };
    } else if (sortBy === 'status') {
      orderBy.status = { sortOrder: sortOrder };
    } else {
      orderBy[sortBy] = sortOrder;
    }

    // Fetch ALL matching products (no pagination for export)
    const products = await prisma.demoProduct.findMany({
      where,
      orderBy,
      include: {
        category: { select: { name: true } },
        status: { select: { label: true } },
      },
    });

    // Generate CSV
    if (format === 'csv') {
      const headers = ['ID', 'SKU', 'Name', 'Category', 'Status', 'Price', 'Stock', 'Created At'];
      const rows = products.map((p) => [
        p.id,
        p.sku,
        `"${p.name.replace(/"/g, '""')}"`,
        p.category.name,
        p.status.label,
        Number(p.price).toFixed(2),
        p.stock,
        p.createdAt.toISOString(),
      ]);

      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="products-${Date.now()}.csv"`);
      return csv;
    }

    // Generate Excel
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Products');

      sheet.columns = [
        { header: 'ID', key: 'id', width: 25 },
        { header: 'SKU', key: 'sku', width: 18 },
        { header: 'Name', key: 'name', width: 35 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Price', key: 'price', width: 12 },
        { header: 'Stock', key: 'stock', width: 10 },
        { header: 'Created At', key: 'createdAt', width: 22 },
      ];

      // Style header
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      // Add data
      products.forEach((p) => {
        sheet.addRow({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category.name,
          status: p.status.label,
          price: Number(p.price),
          stock: p.stock,
          createdAt: p.createdAt.toISOString(),
        });
      });

      sheet.getColumn('price').numFmt = '$#,##0.00';

      const buffer = await workbook.xlsx.writeBuffer();
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="products-${Date.now()}.xlsx"`);
      return Buffer.from(buffer);
    }

    return reply.status(400).send({ error: { message: 'Format must be csv or excel' } });
  });

  // =====================================================
  // GET SINGLE PRODUCT
  // =====================================================

  app.get('/products/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const product = await prisma.demoProduct.findUnique({
      where: { id },
      include: { category: true, status: true },
    });

    if (!product) {
      return reply.status(404).send({ error: { message: 'Product not found' } });
    }

    return { data: { ...product, price: Number(product.price) } };
  });
};
