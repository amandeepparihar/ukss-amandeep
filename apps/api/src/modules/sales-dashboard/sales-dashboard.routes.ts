import type { FastifyPluginAsync } from 'fastify';
import {
  eventsQuerySchema,
  createEventSchema,
  updateEventSchema,
  teamSalesQuerySchema,
  productTypeSalesQuerySchema,
  genderSalesQuerySchema,
  personalisationQuerySchema,
  orderHealthQuerySchema,
  dailyRevenueQuerySchema,
  revenueDayHourQuerySchema,
  customerSegmentsQuerySchema,
  returnRateQuerySchema,
  inventoryQuadrantQuerySchema,
  geoRevenueQuerySchema,
} from './sales-dashboard.schema';
import { getTeamSales, getLeagues, getContinents } from './services/team-sales.service';
import { getProductTypeSales, getProductTypes } from './services/product-type-sales.service';
import { getPersonalisationSales } from './services/personalisation.service';
import { getGenderSales } from './services/gender-sales.service';
import { getOrderHealth } from './services/order-health.service';
import { getEvents, createEvent, updateEvent, deleteEvent } from './services/events.service';
import { getDailyRevenue } from './services/daily-revenue.service';
import { getRevenueDayHour } from './services/revenue-day-hour.service';
import { getCustomerSegments } from './services/customer-segments.service';
import { getReturnRate } from './services/return-rate.service';
import { getInventoryQuadrant } from './services/inventory-quadrant.service';
import { getGeoRevenue } from './services/geo-revenue.service';

export const salesDashboardRoutes: FastifyPluginAsync = async (app) => {
  // All routes require authentication + sales-dashboard:view permission
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('sales-dashboard', 'view'));

  // ─── Event CRUD Routes ────────────────────────────────────────────

  app.get('/events', async (request) => {
    const query = eventsQuerySchema.parse(request.query);
    const data = await getEvents(query);
    return { data };
  });

  app.post('/events', async (request) => {
    const body = createEventSchema.parse(request.body);
    const data = await createEvent(body);
    return { data };
  });

  app.put<{ Params: { id: string } }>('/events/:id', async (request) => {
    const body = updateEventSchema.parse(request.body);
    const id = parseInt(request.params.id, 10);
    const data = await updateEvent(id, body);
    return { data };
  });

  app.delete<{ Params: { id: string } }>('/events/:id', async (request) => {
    const id = parseInt(request.params.id, 10);
    const result = await deleteEvent(id);
    return result;
  });

  // ─── Chart Data Routes ────────────────────────────────────────────

  app.get('/team-sales', async (request) => {
    const query = teamSalesQuerySchema.parse(request.query);
    const data = await getTeamSales(query);
    return { data };
  });

  app.get('/product-type-sales', async (request) => {
    const query = productTypeSalesQuerySchema.parse(request.query);
    const result = await getProductTypeSales(query);
    return { data: result };
  });

  app.get('/gender-sales', async (request) => {
    const query = genderSalesQuerySchema.parse(request.query);
    const result = await getGenderSales(query);
    return { data: result };
  });

  app.get('/personalisation', async (request) => {
    const query = personalisationQuerySchema.parse(request.query);
    const data = await getPersonalisationSales(query);
    return { data };
  });

  app.get('/order-health', async (request) => {
    const query = orderHealthQuerySchema.parse(request.query);
    const data = await getOrderHealth(query);
    return { data };
  });

  // ─── V2 Chart Data Routes ────────────────────────────────────────

  app.get('/daily-revenue', async (request) => {
    const query = dailyRevenueQuerySchema.parse(request.query);
    const data = await getDailyRevenue(query);
    return { data };
  });

  app.get('/revenue-day-hour', async (request) => {
    const query = revenueDayHourQuerySchema.parse(request.query);
    const data = await getRevenueDayHour(query);
    return { data };
  });

  app.get('/customer-segments', async (request) => {
    const query = customerSegmentsQuerySchema.parse(request.query);
    const data = await getCustomerSegments(query);
    return { data };
  });

  app.get('/return-rate', async (request) => {
    const query = returnRateQuerySchema.parse(request.query);
    const data = await getReturnRate(query);
    return { data };
  });

  app.get('/inventory-quadrant', async (request) => {
    const query = inventoryQuadrantQuerySchema.parse(request.query);
    const data = await getInventoryQuadrant(query);
    return { data };
  });

  app.get('/geo-revenue', async (request) => {
    const query = geoRevenueQuerySchema.parse(request.query);
    const data = await getGeoRevenue(query);
    return { data };
  });

  // ─── Filter Routes ────────────────────────────────────────────────

  app.get('/team-sales/leagues', async () => {
    const data = await getLeagues();
    return { data };
  });

  app.get('/team-sales/continents', async () => {
    const data = await getContinents();
    return { data };
  });

  app.get('/product-type-sales/types', async () => {
    const result = await getProductTypes();
    return { data: result };
  });
};
