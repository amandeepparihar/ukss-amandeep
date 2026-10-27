/**
 * New Product Module — Lookup, product-code, and inventory route definitions.
 * Split out of products.routes.ts verbatim (no behaviour change); registered as
 * a sub-plugin so it inherits the parent's `/api/products` prefix + decorators.
 *
 * Requirements: REQ-6 (lookup endpoints), REQ-1 (product code),
 *   REQ-3.4 (barcode check), REQ-7 (permissions)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  teamSearchSchema,
  sizeGroupQuerySchema,
  sizesQuerySchema,
  boxSearchSchema,
  productCodeCheckSchema,
  barcodeCheckSchema,
  checkDuplicatesSchema,
  productCodeSchema,
  inventoryEntrySchema,
  inventoryUpdateSchema,
  checkSizeGroupSchema,
} from './products.schema';
import {
  searchTeams,
  getSeasons,
  getProductTypes,
  getSizeOptions,
  getSizeGroups,
  getSizes,
  searchBoxes,
  checkSizeGroupForProduct,
  checkProductCode,
  checkBarcode,
  getColors,
  getSleeveLengths,
  getManufacturers,
  getGenders,
  getAgeGroups,
  getSizeGuides,
  searchTeamCategories,
  getCountries,
} from './products-lookup.service';
import { runWithExecution } from '../../lib/logger-context';
import { originConflictsSchema } from './products.schema';
import { getOriginDetailsFamilyConflicts } from './origin-details.service';
import { cooReportQuerySchema } from './coo-report.schema';
import { fetchCooReportPage } from './coo-report.service';
import { createOrUpdateProductCode } from './products.service';
import { checkDuplicates } from './products-duplicates.service';
import { addInventory, getInventory, updateInventoryRow } from './products-inventory.service';
import { getAttributeValues, resolveTypesenseFacet } from '../../lib/typesense';
import { resolvePhpAdminId } from '../orders/orders.helpers';

export const productLookupRoutes: FastifyPluginAsync = async (app) => {

  // =========================================================================
  // Lookup endpoints (REQ-6) — auth only, no specific permission required
  // =========================================================================

  // GET /api/products/teams?search=
  app.get('/teams', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { search } = teamSearchSchema.parse(request.query);
    return { data: await searchTeams(search) };
  });

  // GET /api/products/seasons
  app.get('/seasons', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getSeasons() };
  });

  // GET /api/products/product-types
  app.get('/product-types', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getProductTypes() };
  });

  // GET /api/products/countries?search= — country of origin lookup (ascending)
  app.get('/countries', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { search } = teamSearchSchema.parse(request.query);
    return { data: await getCountries(search) };
  });

  // GET /api/products/size-options
  app.get('/size-options', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getSizeOptions() };
  });

  // GET /api/products/size-groups?optionId=
  app.get('/size-groups', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { optionId } = sizeGroupQuerySchema.parse(request.query);
    return { data: await getSizeGroups(optionId) };
  });

  // GET /api/products/sizes?groupId=
  app.get('/sizes', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { groupId } = sizesQuerySchema.parse(request.query);
    return { data: await getSizes(groupId) };
  });

  // GET /api/products/check-size-group?productListsId=&sizeGroupId=
  // Returns { ok: true } if the chosen size group matches the one already
  // assigned to existing inventory for this product, or { ok: false, message,
  // existingGroupName } if the user is trying to mix groups (legacy parity).
  app.get('/check-size-group', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { productListsId, sizeGroupId } = checkSizeGroupSchema.parse(request.query);
    return { data: await checkSizeGroupForProduct(productListsId, sizeGroupId) };
  });

  // GET /api/products/boxes?search=
  app.get('/boxes', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { search } = boxSearchSchema.parse(request.query);
    return { data: await searchBoxes(search) };
  });

  // =========================================================================
  // Product code check (REQ-1.3)
  // =========================================================================

  // GET /api/products/check-code/:code
  app.get('/check-code/:code', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { code } = productCodeCheckSchema.parse(request.params);
    return { data: await checkProductCode(code) };
  });

  // =========================================================================
  // Duplicate detection (Product Automation Improvement — Brazil-shirt case)
  // =========================================================================

  // POST /api/products/check-duplicates
  // Two-tier detection (structured team+season+type + Typesense fuzzy title)
  // across active AND archived products. Read-only; safe to call on debounce.
  app.post('/check-duplicates', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const input = checkDuplicatesSchema.parse(request.body);
    return { data: await checkDuplicates(input) };
  });

  // =========================================================================
  // Barcode check (REQ-3.4)
  // =========================================================================

  // GET /api/products/check-barcode/:barcode
  app.get('/check-barcode/:barcode', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { barcode } = barcodeCheckSchema.parse(request.params);
    return { data: await checkBarcode(barcode) };
  });

  // =========================================================================
  // Attribute lookups for AI Description panel
  // =========================================================================

  // GET /api/products/colors
  app.get('/colors', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getColors() };
  });

  // GET /api/products/sleeve-lengths
  app.get('/sleeve-lengths', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getSleeveLengths() };
  });

  // GET /api/products/manufacturers
  app.get('/manufacturers', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getManufacturers() };
  });

  // GET /api/products/genders
  app.get('/genders', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getGenders() };
  });

  // GET /api/products/age-groups
  app.get('/age-groups', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getAgeGroups() };
  });

  // GET /api/products/size-guides
  app.get('/size-guides', {
    preHandler: [app.authenticate],
  }, async () => {
    return { data: await getSizeGuides() };
  });

  // GET /api/products/typesense/:key?search=
  // Source canonical attribute values from Typesense — same dataset the
  // Dify description-generator validates LLM picks against, so dropdown
  // options stay in sync with workflow validation. The key → facet mapping
  // lives in lib/typesense so other callers (CLI, batch jobs) reuse it.
  app.get('/typesense/:key', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { key } = z.object({ key: z.string().min(1) }).parse(request.params);
    const { search } = z.object({ search: z.string().trim().max(100).optional() }).parse(request.query);
    const facet = resolveTypesenseFacet(key);
    if (!facet) {
      return reply.status(400).send({ error: { code: 'UNKNOWN_TYPESENSE_KEY', message: `Unknown key '${key}'` } });
    }
    const values = await getAttributeValues(facet, { search });
    return { data: values.map((v) => ({ id: v, name: v })) };
  });

  // GET /api/products/team-categories?search=
  app.get('/team-categories', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { search } = teamSearchSchema.parse(request.query); // Reuse team search schema
    return { data: await searchTeamCategories(search) };
  });

  // =========================================================================
  // Country-of-Origin report (server-side DataTable read)
  // =========================================================================

  // GET /api/products/coo-report — Country-of-Origin report, server-side
  // paginated/filtered/sorted DataTable read (see coo-report.schema.ts /
  // coo-report.service.ts for the query contract and shared WHERE builder).
  app.get('/coo-report', {
    preHandler: [app.requirePermission('coo-report:view')],
  }, async (request) => {
    const q = cooReportQuerySchema.parse(request.query);
    const { rows, total } = await fetchCooReportPage(q);
    return {
      data: rows,
      meta: {
        total,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    };
  });

  // =========================================================================
  // Product code CRUD (REQ-1, REQ-7)
  // =========================================================================

  // POST /api/products/origin-conflicts
  //
  // Twin of the SMS `check_country_of_origin_conflict` endpoint (PMS #166509).
  // The origin details — country of origin and HS Code — are shared by the whole
  // product code family, so saving them against one code decides them for the
  // parent and every child. Where somebody else in the family already holds a
  // different value that is a question for the person at the form, not something
  // to settle quietly, so the form asks this before it saves.
  //
  // Reads only. Returns one conflict list per field; either list being empty
  // means there is nothing to ask about for that field, and a field sent blank is
  // a field that is not being changed and never conflicts.
  app.post('/origin-conflicts', {
    preHandler: [app.requirePermission('products:create')],
  }, async (request) => {
    // Wrapped so getLogger() inside the service resolves an executionId — the id
    // lives in AsyncLocalStorage and has to be established at the entry point,
    // otherwise every line logs without one.
    return runWithExecution('products', async () => {
      const { productCode, countryOfOriginId, hsCode } = originConflictsSchema.parse(request.body);
      return {
        data: await getOriginDetailsFamilyConflicts(productCode, countryOfOriginId, hsCode),
      };
    });
  });

  // POST /api/products/product-code
  app.post('/product-code', {
    preHandler: [app.requirePermission('products:create')],
  }, async (request, reply) => {
    // Wrapped for the same reason as /origin-conflicts above: the origin details
    // family write logs through getLogger() and needs an executionId to tie its
    // lines to this one request.
    return runWithExecution('products', async () => {
      const data = productCodeSchema.parse(request.body);
      const smsUserId = await resolvePhpAdminId(request.cookies);
      const result = await createOrUpdateProductCode(data, smsUserId);
      return reply.status(result.isNew ? 201 : 200).send({ data: result });
    });
  });

  // =========================================================================
  // Inventory management (REQ-3, REQ-4, REQ-7)
  // =========================================================================

  // POST /api/products/inventory
  app.post('/inventory', {
    preHandler: [app.requirePermission('products:inventory')],
  }, async (request, reply) => {
    const data = inventoryEntrySchema.parse(request.body);
    const smsUserId = await resolvePhpAdminId(request.cookies);
    const result = await addInventory(data, smsUserId, request.ip);
    return reply.status(201).send({ data: result });
  });

  // GET /api/products/inventory/:productListsId
  app.get('/inventory/:productListsId', {
    preHandler: [app.requirePermission('products:view')],
  }, async (request) => {
    const { productListsId } = z.object({
      productListsId: z.coerce.number().int().positive(),
    }).parse(request.params);
    const rows = await getInventory(productListsId);
    const totalItems = rows.reduce((sum, r) => sum + Number(r.quantity), 0);
    const totalBarcodes = new Set(rows.map((r) => r.barcode)).size;
    return { data: { rows, summary: { totalItems, totalBarcodes } } };
  });

  // PATCH /api/products/inventory/:productQuantitiesId — inline edit quantity/weight
  app.patch('/inventory/:productQuantitiesId', {
    preHandler: [app.requirePermission('products:inventory')],
  }, async (request, reply) => {
    const { productQuantitiesId } = z.object({
      productQuantitiesId: z.coerce.number().int().positive(),
    }).parse(request.params);
    const { quantity, weight } = inventoryUpdateSchema.parse(request.body);
    const smsUserId = await resolvePhpAdminId(request.cookies);
    await updateInventoryRow(productQuantitiesId, quantity, weight, smsUserId, request.ip);
    return reply.status(200).send({ data: { success: true } });
  });
};
