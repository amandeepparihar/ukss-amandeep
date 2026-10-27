import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { Readable } from 'stream';
import { buildHourlyOrdersQuery, type HourlyOrdersParams } from './hourly-orders.query';

const logger = createLogger('reports');

// Report data source types
type DataSourceFunction = (params: Record<string, unknown>) => Promise<Record<string, unknown>[]>;

// Built-in data sources registry
const dataSources = new Map<string, DataSourceFunction>();

// Report format types
export type ReportFormat = 'csv' | 'json' | 'excel';

export interface ReportDefinition {
  id: string;
  name: string;
  description?: string;
  dataSource: string;
  columns: Array<{
    key: string;
    label: string;
    format?: 'string' | 'number' | 'date' | 'currency' | 'boolean';
    width?: number;
  }>;
  filters?: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'select';
    options?: Array<{ value: string; label: string }>;
  }>;
  defaultSort?: { column: string; direction: 'asc' | 'desc' };
}

export interface GenerateReportInput {
  reportId: string;
  format: ReportFormat;
  params?: Record<string, unknown>;
  userId: string;
}

export interface ScheduledReportInput {
  reportId: string;
  format: ReportFormat;
  params?: Record<string, unknown>;
  schedule: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  userId: string;
}

export class ReportsService {
  private reports = new Map<string, ReportDefinition>();

  constructor() {
    this.registerBuiltInReports();
    this.registerBuiltInDataSources();
  }

  /**
   * Register a data source function
   */
  registerDataSource(name: string, fn: DataSourceFunction): void {
    dataSources.set(name, fn);
    logger.info({ dataSource: name }, 'Data source registered');
  }

  /**
   * Register a report definition
   */
  registerReport(report: ReportDefinition): void {
    this.reports.set(report.id, report);
    logger.info({ reportId: report.id }, 'Report registered');
  }

  /**
   * Get all registered reports
   */
  getReports(): ReportDefinition[] {
    return Array.from(this.reports.values());
  }

  /**
   * Get a specific report definition
   */
  getReport(reportId: string): ReportDefinition | undefined {
    return this.reports.get(reportId);
  }

  /**
   * Generate a report
   */
  async generate(input: GenerateReportInput): Promise<{
    data: Record<string, unknown>[];
    report: ReportDefinition;
    generatedAt: Date;
  }> {
    const report = this.reports.get(input.reportId);
    if (!report) {
      throw new Error(`Report not found: ${input.reportId}`);
    }

    const dataSource = dataSources.get(report.dataSource);
    if (!dataSource) {
      throw new Error(`Data source not found: ${report.dataSource}`);
    }

    const data = await dataSource(input.params || {});

    logger.info({
      reportId: input.reportId,
      rowCount: data.length,
      userId: input.userId,
    }, 'Report generated');

    return {
      data,
      report,
      generatedAt: new Date(),
    };
  }

  /**
   * Generate report as CSV stream
   */
  async generateCSV(input: GenerateReportInput): Promise<Readable> {
    const { data, report } = await this.generate(input);

    const stream = new Readable({ read() {} });

    // Write header
    const header = report.columns.map(c => `"${c.label}"`).join(',');
    stream.push(header + '\n');

    // Write data rows
    for (const row of data) {
      const values = report.columns.map(col => {
        const value = row[col.key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
        if (value instanceof Date) return `"${value.toISOString()}"`;
        return String(value);
      });
      stream.push(values.join(',') + '\n');
    }

    stream.push(null);
    return stream;
  }

  /**
   * Generate report as JSON
   */
  async generateJSON(input: GenerateReportInput): Promise<{
    metadata: {
      reportId: string;
      reportName: string;
      generatedAt: string;
      rowCount: number;
      columns: Array<{ key: string; label: string }>;
    };
    data: Record<string, unknown>[];
  }> {
    const { data, report, generatedAt } = await this.generate(input);

    return {
      metadata: {
        reportId: report.id,
        reportName: report.name,
        generatedAt: generatedAt.toISOString(),
        rowCount: data.length,
        columns: report.columns.map(c => ({ key: c.key, label: c.label })),
      },
      data,
    };
  }

  /**
   * Get report statistics
   */
  async getStats(): Promise<{
    totalReports: number;
    availableDataSources: string[];
  }> {
    return {
      totalReports: this.reports.size,
      availableDataSources: Array.from(dataSources.keys()),
    };
  }

  /**
   * Register built-in reports
   */
  private registerBuiltInReports(): void {
    // User Activity Report
    this.registerReport({
      id: 'user-activity',
      name: 'User Activity Report',
      description: 'Shows user login and activity statistics',
      dataSource: 'user-activity',
      columns: [
        { key: 'userId', label: 'User ID' },
        { key: 'email', label: 'Email' },
        { key: 'name', label: 'Name' },
        { key: 'loginCount', label: 'Login Count', format: 'number' },
        { key: 'lastLogin', label: 'Last Login', format: 'date' },
        { key: 'actionsCount', label: 'Actions', format: 'number' },
      ],
      filters: [
        { key: 'dateFrom', label: 'From Date', type: 'date' },
        { key: 'dateTo', label: 'To Date', type: 'date' },
      ],
      defaultSort: { column: 'loginCount', direction: 'desc' },
    });

    // Audit Log Report
    this.registerReport({
      id: 'audit-logs',
      name: 'Audit Log Report',
      description: 'Detailed audit trail of system activities',
      dataSource: 'audit-logs',
      columns: [
        { key: 'id', label: 'Log ID' },
        { key: 'createdAt', label: 'Timestamp', format: 'date' },
        { key: 'userName', label: 'User' },
        { key: 'action', label: 'Action' },
        { key: 'resource', label: 'Resource' },
        { key: 'resourceId', label: 'Resource ID' },
      ],
      filters: [
        { key: 'dateFrom', label: 'From Date', type: 'date' },
        { key: 'dateTo', label: 'To Date', type: 'date' },
        { key: 'action', label: 'Action', type: 'text' },
        { key: 'resource', label: 'Resource', type: 'text' },
      ],
      defaultSort: { column: 'createdAt', direction: 'desc' },
    });

    // Users Report
    this.registerReport({
      id: 'users',
      name: 'Users Report',
      description: 'List of all users in the system',
      dataSource: 'users',
      columns: [
        { key: 'id', label: 'User ID' },
        { key: 'email', label: 'Email' },
        { key: 'firstName', label: 'First Name' },
        { key: 'lastName', label: 'Last Name' },
        { key: 'roleName', label: 'Role' },
        { key: 'isActive', label: 'Active', format: 'boolean' },
        { key: 'createdAt', label: 'Created', format: 'date' },
        { key: 'lastLogin', label: 'Last Login', format: 'date' },
      ],
      filters: [
        { key: 'isActive', label: 'Active Status', type: 'select', options: [
          { value: 'true', label: 'Active' },
          { value: 'false', label: 'Inactive' },
        ]},
        { key: 'roleId', label: 'Role', type: 'text' },
      ],
      defaultSort: { column: 'createdAt', direction: 'desc' },
    });

    // Login History Report
    this.registerReport({
      id: 'login-history',
      name: 'Login History Report',
      description: 'Login attempts and their status',
      dataSource: 'login-history',
      columns: [
        { key: 'createdAt', label: 'Timestamp', format: 'date' },
        { key: 'userId', label: 'User ID' },
        { key: 'ipAddress', label: 'IP Address' },
        { key: 'browser', label: 'Browser' },
        { key: 'os', label: 'OS' },
        { key: 'location', label: 'Location' },
        { key: 'success', label: 'Success', format: 'boolean' },
        { key: 'failureReason', label: 'Failure Reason' },
      ],
      filters: [
        { key: 'dateFrom', label: 'From Date', type: 'date' },
        { key: 'dateTo', label: 'To Date', type: 'date' },
        { key: 'success', label: 'Status', type: 'select', options: [
          { value: 'true', label: 'Successful' },
          { value: 'false', label: 'Failed' },
        ]},
      ],
      defaultSort: { column: 'createdAt', direction: 'desc' },
    });

    // Sessions Report
    this.registerReport({
      id: 'active-sessions',
      name: 'Active Sessions Report',
      description: 'Currently active user sessions',
      dataSource: 'active-sessions',
      columns: [
        { key: 'userId', label: 'User ID' },
        { key: 'email', label: 'Email' },
        { key: 'name', label: 'Name' },
        { key: 'ipAddress', label: 'IP Address' },
        { key: 'userAgent', label: 'User Agent' },
        { key: 'createdAt', label: 'Session Start', format: 'date' },
        { key: 'lastActiveAt', label: 'Last Active', format: 'date' },
        { key: 'expiresAt', label: 'Expires', format: 'date' },
      ],
      defaultSort: { column: 'lastActiveAt', direction: 'desc' },
    });

    // Hourly Sales Report (orders placed per day x hour) — sourced from shared MySQL
    this.registerReport({
      id: 'hourly-orders',
      name: 'Hourly Sales Report',
      description: 'Number of orders placed, bucketed by day and hour',
      dataSource: 'hourly-orders',
      columns: [
        { key: 'day', label: 'Day', format: 'date' },
        ...Array.from({ length: 24 }, (_, h) => ({
          key: `h${String(h).padStart(2, '0')}`,
          label: String(h).padStart(2, '0'),
          format: 'number' as const,
        })),
        { key: 'total', label: 'Total', format: 'number' },
      ],
      filters: [
        { key: 'dateFrom', label: 'From Date', type: 'date' as const },
        { key: 'dateTo', label: 'To Date', type: 'date' as const },
        { key: 'orderStatuses', label: 'Order Status', type: 'select' as const },
        { key: 'channel', label: 'Channel', type: 'select' as const, options: [
          { value: 'both', label: 'Both' },
          { value: 'ukss', label: 'UKSS only' },
          { value: 'marketplace', label: 'Marketplaces only' },
        ]},
        { key: 'marketplace', label: 'Marketplace', type: 'select' as const },
      ],
      defaultSort: { column: 'day', direction: 'asc' },
    });
  }

  /**
   * Register built-in data sources
   */
  private registerBuiltInDataSources(): void {
    // User Activity data source
    this.registerDataSource('user-activity', async (params) => {
      const dateFrom = params.dateFrom ? new Date(params.dateFrom as string) : undefined;
      const dateTo = params.dateTo ? new Date(params.dateTo as string) : undefined;

      const users = await prisma.user.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      });

      const results = [];
      for (const user of users) {
        const [loginCount, lastLogin, actionsCount] = await Promise.all([
          prisma.loginHistory.count({
            where: {
              userId: user.id,
              success: true,
              createdAt: {
                gte: dateFrom,
                lte: dateTo,
              },
            },
          }),
          prisma.loginHistory.findFirst({
            where: { userId: user.id, success: true },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
          prisma.auditLog.count({
            where: {
              userId: user.id,
              createdAt: {
                gte: dateFrom,
                lte: dateTo,
              },
            },
          }),
        ]);

        results.push({
          userId: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          loginCount,
          lastLogin: lastLogin?.createdAt || null,
          actionsCount,
        });
      }

      return results;
    });

    // Audit Logs data source
    this.registerDataSource('audit-logs', async (params) => {
      const where: Record<string, unknown> = {};

      if (params.dateFrom || params.dateTo) {
        where.createdAt = {};
        if (params.dateFrom) {
          (where.createdAt as Record<string, Date>).gte = new Date(params.dateFrom as string);
        }
        if (params.dateTo) {
          (where.createdAt as Record<string, Date>).lte = new Date(params.dateTo as string);
        }
      }
      if (params.action) where.action = params.action;
      if (params.resource) where.resource = params.resource;

      const logs = await prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10000, // Limit for performance
      });

      return logs.map(log => ({
        id: log.id,
        createdAt: log.createdAt,
        userName: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System',
        userEmail: log.user?.email || null,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
      }));
    });

    // Users data source
    this.registerDataSource('users', async (params) => {
      const where: Record<string, unknown> = { deletedAt: null };

      if (params.isActive !== undefined) {
        where.isActive = params.isActive === 'true' || params.isActive === true;
      }
      if (params.roleId) where.roleId = params.roleId;

      const users = await prisma.user.findMany({
        where,
        include: {
          role: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const results = [];
      for (const user of users) {
        const lastLogin = await prisma.loginHistory.findFirst({
          where: { userId: user.id, success: true },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });

        results.push({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roleName: user.role.name,
          isActive: user.isActive,
          createdAt: user.createdAt,
          lastLogin: lastLogin?.createdAt || null,
        });
      }

      return results;
    });

    // Login History data source
    this.registerDataSource('login-history', async (params) => {
      const where: Record<string, unknown> = {};

      if (params.dateFrom || params.dateTo) {
        where.createdAt = {};
        if (params.dateFrom) {
          (where.createdAt as Record<string, Date>).gte = new Date(params.dateFrom as string);
        }
        if (params.dateTo) {
          (where.createdAt as Record<string, Date>).lte = new Date(params.dateTo as string);
        }
      }
      if (params.success !== undefined) {
        where.success = params.success === 'true' || params.success === true;
      }

      const history = await prisma.loginHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10000,
      });

      return history.map(h => ({
        createdAt: h.createdAt,
        userId: h.userId,
        ipAddress: h.ipAddress,
        browser: h.browser,
        os: h.os,
        location: h.location,
        success: h.success,
        failureReason: h.failureReason,
      }));
    });

    // Active Sessions data source
    this.registerDataSource('active-sessions', async () => {
      const now = new Date();

      const sessions = await prisma.session.findMany({
        where: { expiresAt: { gt: now } },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { lastActiveAt: 'desc' },
      });

      return sessions.map(s => ({
        userId: s.user.id,
        email: s.user.email,
        name: `${s.user.firstName} ${s.user.lastName}`,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
      }));
    });

    // Hourly orders data source — shared MySQL orders table, read via the
    // Prisma MySQL client (same connection the orders module uses). buildHourlyOrdersQuery
    // emits `?`-placeholder SQL + values, matching prisma.$queryRawUnsafe(sql, ...values).
    this.registerDataSource('hourly-orders', async (params) => {
      const { sql, values } = buildHourlyOrdersQuery(params as HourlyOrdersParams);
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values);
      // MySQL SUM()/COUNT() come back as BigInt/Decimal via Prisma — coerce numeric columns
      return rows.map((row) => {
        const out: Record<string, unknown> = { day: row.day };
        for (let h = 0; h < 24; h++) {
          const k = `h${String(h).padStart(2, '0')}`;
          out[k] = Number(row[k] ?? 0);
        }
        out.total = Number(row.total ?? 0);
        return out;
      });
    });
  }
}

export const reportsService = new ReportsService();
