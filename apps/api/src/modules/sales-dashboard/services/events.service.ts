/**
 * Events Service
 *
 * CRUD operations for jsa_sales_events table.
 * Events represent football and retail events that drive merchandise sales.
 */

import { getLogger } from '../../../lib/logger-context';
import { queryWithLog, executeWithLog } from '../lib/query-logger';

// ─── Types ────────────────────────────────────────────────────────────

interface SalesEvent {
  event_id: number;
  event_name: string;
  event_category: string;
  event_type: string;
  region: string;
  buying_window_start: string;
  buying_window_end: string;
  event_start_date: string;
  event_end_date: string;
  year: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface GetEventsParams {
  startDate: string;
  endDate: string;
  category?: string;
  region?: string;
}

interface CreateEventData {
  event_name: string;
  event_category: string;
  event_type: string;
  region?: string;
  buying_window_start: string;
  buying_window_end: string;
  event_start_date: string;
  event_end_date: string;
  year: number;
  is_active?: boolean;
  notes?: string;
}

interface UpdateEventData {
  event_name?: string;
  event_category?: string;
  event_type?: string;
  region?: string;
  buying_window_start?: string;
  buying_window_end?: string;
  event_start_date?: string;
  event_end_date?: string;
  year?: number;
  is_active?: boolean;
  notes?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Format date values from MySQL DATETIME (ISO timestamps) to YYYY-MM-DD
 * for date-only columns.
 */
function formatEvent(row: any): SalesEvent {
  return {
    event_id: row.event_id,
    eventId: row.event_id,
    event_name: row.event_name,
    eventName: row.event_name,
    event_category: row.event_category,
    eventCategory: row.event_category,
    event_type: row.event_type,
    eventType: row.event_type,
    region: row.region,
    buying_window_start: toDateString(row.buying_window_start),
    buyingWindowStart: toDateString(row.buying_window_start),
    buying_window_end: toDateString(row.buying_window_end),
    buyingWindowEnd: toDateString(row.buying_window_end),
    event_start_date: toDateString(row.event_start_date),
    eventStartDate: toDateString(row.event_start_date),
    event_end_date: toDateString(row.event_end_date),
    eventEndDate: toDateString(row.event_end_date),
    year: row.year,
    is_active: Boolean(row.is_active),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toDateString(val: any): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'string') return val.slice(0, 10);
  return String(val);
}

// ─── CRUD Operations ──────────────────────────────────────────────────

/**
 * Get events whose buying window overlaps the given date range.
 * Optionally filtered by category and/or region.
 */
export async function getEvents(params: GetEventsParams): Promise<SalesEvent[]> {
  const logger = getLogger();
  const { startDate, endDate, category, region } = params;

  logger.info({ startDate, endDate, category, region }, 'Fetching events');

  const conditions: string[] = [
    'buying_window_start <= ?',
    'buying_window_end >= ?',
    'is_active = TRUE',
  ];
  const values: any[] = [endDate, startDate];

  if (category) {
    conditions.push('event_category = ?');
    values.push(category);
  }

  if (region) {
    conditions.push('region = ?');
    values.push(region);
  }

  const whereClause = conditions.join(' AND ');

  const rows = await queryWithLog<any>('events', 'get-events', `SELECT * FROM jsa_sales_events WHERE ${whereClause} ORDER BY buying_window_start ASC`, values);

  logger.info({ count: rows.length }, 'Events fetched');
  return rows.map(formatEvent);
}

/**
 * Create a new event. Returns the created event.
 */
export async function createEvent(data: CreateEventData): Promise<SalesEvent> {
  const logger = getLogger();
  logger.info({ event_name: data.event_name }, 'Creating event');

  const region = data.region ?? 'Global';
  const isActive = data.is_active ?? true;

  await executeWithLog('events', 'create-event',
    `INSERT INTO jsa_sales_events
      (event_name, event_category, event_type, region,
       buying_window_start, buying_window_end, event_start_date, event_end_date,
       year, is_active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.event_name, data.event_category, data.event_type, region,
     data.buying_window_start, data.buying_window_end, data.event_start_date, data.event_end_date,
     data.year, isActive, data.notes ?? null],
  );

  const rows = await queryWithLog<any>('events', 'get-created-event', 'SELECT * FROM jsa_sales_events WHERE event_id = LAST_INSERT_ID()');

  if (!rows.length) {
    throw new Error('Failed to retrieve created event');
  }

  logger.info({ event_id: rows[0].event_id }, 'Event created');
  return formatEvent(rows[0]);
}

/**
 * Update an existing event. Returns the updated event.
 * Throws 404-style error if event not found or inactive.
 */
export async function updateEvent(id: number, data: UpdateEventData): Promise<SalesEvent> {
  const logger = getLogger();
  logger.info({ event_id: id }, 'Updating event');

  // Check event exists and is active
  const existing = await queryWithLog<any>('events', 'check-event-exists', 'SELECT event_id FROM jsa_sales_events WHERE event_id = ? AND is_active = TRUE', [id]);

  if (!existing.length) {
    const error = new Error('Event not found') as any;
    error.statusCode = 404;
    throw error;
  }

  // Build dynamic SET clause from provided fields
  const setClauses: string[] = [];
  const setValues: any[] = [];

  const allowedFields: (keyof UpdateEventData)[] = [
    'event_name', 'event_category', 'event_type', 'region',
    'buying_window_start', 'buying_window_end', 'event_start_date', 'event_end_date',
    'year', 'is_active', 'notes',
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      setValues.push(data[field]);
    }
  }

  if (setClauses.length === 0) {
    // Nothing to update, just return the existing event
    const rows = await queryWithLog<any>('events', 'get-existing-event', 'SELECT * FROM jsa_sales_events WHERE event_id = ?', [id]);
    return formatEvent(rows[0]);
  }

  setValues.push(id);

  await executeWithLog('events', 'update-event',
    `UPDATE jsa_sales_events SET ${setClauses.join(', ')} WHERE event_id = ?`,
    setValues,
  );

  const rows = await queryWithLog<any>('events', 'get-updated-event', 'SELECT * FROM jsa_sales_events WHERE event_id = ?', [id]);

  logger.info({ event_id: id }, 'Event updated');
  return formatEvent(rows[0]);
}

/**
 * Soft-delete an event (set is_active = false).
 * Throws 404-style error if event not found.
 */
export async function deleteEvent(id: number): Promise<{ success: true }> {
  const logger = getLogger();
  logger.info({ event_id: id }, 'Soft-deleting event');

  const affected = await executeWithLog('events', 'soft-delete-event',
    'UPDATE jsa_sales_events SET is_active = FALSE WHERE event_id = ? AND is_active = TRUE',
    [id],
  );

  if (affected === 0) {
    const error = new Error('Event not found') as any;
    error.statusCode = 404;
    throw error;
  }

  logger.info({ event_id: id }, 'Event soft-deleted');
  return { success: true };
}
