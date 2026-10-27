# Report Generation System

Comprehensive reporting system for the admin panel with template management, scheduled generation, and multiple export formats.

## Features

- **Report Templates**: Create reusable report templates with custom queries and filters
- **Multiple Formats**: Export as PDF, Excel (XLSX), or CSV
- **Scheduled Reports**: Automate report generation with cron-based scheduling
- **Chart Support**: Include charts and visualizations in reports
- **Email Delivery**: Automatically email scheduled reports to recipients
- **Data Filtering**: Apply dynamic filters to report data
- **Storage Integration**: Reports stored in S3 with signed URLs
- **Audit Trail**: Track all generated reports with metadata

## Architecture

### Backend Services

#### 1. ReportDataService (`report-data.service.ts`)

Handles data querying and aggregation:

```typescript
// Execute query with filters
const data = await reportDataService.executeQuery(queryDef, filters);

// Get aggregated data for charts
const chartData = await reportDataService.getAggregatedData(
  'users',
  'role',
  'count',
  undefined,
  filters,
  10
);

// Get summary statistics
const stats = await reportDataService.getSummaryStats('users', filters);
```

**Supported Resources:**
- users
- auditLogs
- loginHistory
- sessions
- roles
- files

**Filter Operators:**
- `eq`, `ne` - Equals, Not equals
- `gt`, `gte`, `lt`, `lte` - Greater/less than
- `contains`, `startsWith`, `endsWith` - String matching
- `in`, `notIn` - Array membership

#### 2. ReportGeneratorService (`report-generator.service.ts`)

Generates reports in various formats:

```typescript
// Generate PDF
const { buffer, mimeType } = await reportGeneratorService.generatePdf(reportData);

// Generate Excel
const { buffer, mimeType } = await reportGeneratorService.generateExcel(reportData);

// Generate CSV
const { buffer, mimeType } = await reportGeneratorService.generateCsv(reportData);
```

**PDF Features:**
- Company branding (logo, colors)
- Headers and footers with page numbers
- Automatic page breaks
- Charts as text summaries
- Metadata section

**Excel Features:**
- Title and metadata rows
- Formatted columns with custom widths
- Automatic column sizing

#### 3. ReportQueueService (`report-queue.service.ts`)

Manages scheduled report generation:

```typescript
// Initialize scheduled reports on startup
await reportQueueService.initializeScheduledReports();

// Start worker for background processing
reportQueueService.startWorker();

// Add job manually
await reportQueueService.addScheduledReportJob(scheduledReportId);
```

**Features:**
- BullMQ-based job queue
- Automatic retry with exponential backoff
- Email delivery integration
- Next run calculation from cron expressions

### API Endpoints

#### Report Templates

```bash
# List all templates
GET /api/reports/templates

# Get single template
GET /api/reports/templates/:id

# Create template
POST /api/reports/templates
{
  "name": "User Report",
  "description": "All users with roles",
  "type": "users",
  "query": {
    "resource": "users",
    "select": {...},
    "include": {...},
    "orderBy": {...}
  },
  "columns": [...],
  "filters": [...],
  "chartConfig": {...},
  "isPublic": true
}

# Update template
PUT /api/reports/templates/:id

# Delete template
DELETE /api/reports/templates/:id
```

#### Report Generation

```bash
# Generate report
POST /api/reports/generate
{
  "templateId": "...",
  "format": "pdf|excel|csv",
  "filters": [...]  # Optional runtime filters
}

# Preview report data
POST /api/reports/preview
{
  "templateId": "...",
  "filters": [...]
}
```

#### Generated Reports

```bash
# List generated reports
GET /api/reports/generated

# Download report
GET /api/reports/download/:id

# Delete generated report
DELETE /api/reports/generated/:id
```

#### Scheduled Reports

```bash
# List scheduled reports
GET /api/reports/scheduled

# Create scheduled report
POST /api/reports/scheduled
{
  "templateId": "...",
  "name": "Weekly User Report",
  "schedule": "0 9 * * 1",  # Cron expression
  "format": "pdf",
  "recipients": ["admin@example.com"],
  "isActive": true
}

# Update scheduled report
PUT /api/reports/scheduled/:id

# Delete scheduled report
DELETE /api/reports/scheduled/:id
```

## Database Schema

### ReportTemplate

```prisma
model ReportTemplate {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  type        String   // users, audit, activity, custom
  query       String   @db.Text // JSON query definition
  columns     String   @db.Text // JSON column definitions
  filters     String?  @db.Text // JSON filter definitions
  chartConfig String?  @db.Text // JSON chart configuration
  isPublic    Boolean  @default(false)
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  scheduledReports ScheduledReport[]
  generatedReports GeneratedReport[]
}
```

### ScheduledReport

```prisma
model ScheduledReport {
  id           String   @id @default(cuid())
  templateId   String
  name         String
  schedule     String   // cron expression
  format       String   // pdf, excel, csv
  recipients   String[] // email addresses
  isActive     Boolean  @default(true)
  lastRunAt    DateTime?
  nextRunAt    DateTime?
  createdBy    String
  createdAt    DateTime @default(now())
}
```

### GeneratedReport

```prisma
model GeneratedReport {
  id          String   @id @default(cuid())
  templateId  String?
  name        String
  format      String
  fileKey     String   // S3 key
  fileUrl     String   // Signed URL
  fileSize    Int
  rowCount    Int?
  generatedBy String
  createdAt   DateTime @default(now())
  expiresAt   DateTime  // 30 days from creation
}
```

## Frontend Components

### ReportsPage

Main page with three tabs:
- **Templates**: Manage report templates
- **Generated**: View and download reports
- **Scheduled**: Manage scheduled reports

```typescript
import { ReportsPage } from '@/pages/reports/ReportsPage';
```

### Template Builder (To be implemented)

Create and edit report templates with:
- Data source selector
- Column picker with drag-drop
- Filter builder
- Chart configuration
- Preview functionality

### Report Preview (To be implemented)

Live preview of report data:
- Sample data (first 100 rows)
- Chart preview
- Summary statistics
- Format selector

### Schedule Modal (To be implemented)

Configure scheduled reports:
- Cron expression builder
- Recipient management
- Format selection
- Next run preview

## Usage Examples

### Creating a Custom Report Template

```typescript
const template = {
  name: "Active Users Report",
  description: "Currently active users with recent activity",
  type: "custom",
  query: {
    resource: "users",
    where: { isActive: true },
    include: {
      role: { select: { name: true } },
      _count: { select: { auditLogs: true } }
    },
    orderBy: { createdAt: 'desc' }
  },
  columns: [
    { key: "email", header: "Email", width: 30 },
    { key: "firstName", header: "First Name", width: 15 },
    { key: "lastName", header: "Last Name", width: 15 },
    { key: "role.name", header: "Role", width: 15 },
    { key: "_count.auditLogs", header: "Activity Count", width: 15 },
    { key: "createdAt", header: "Registered", width: 20 }
  ],
  chartConfig: {
    type: "bar",
    title: "Users by Role",
    groupBy: "role",
    aggregation: "count",
    limit: 10
  }
};

await apiClient.post('/api/reports/templates', template);
```

### Scheduling a Daily Report

```typescript
const scheduled = {
  templateId: "template-id",
  name: "Daily User Activity Report",
  schedule: "0 9 * * *",  // Every day at 9 AM
  format: "pdf",
  recipients: [
    "manager@company.com",
    "admin@company.com"
  ],
  isActive: true
};

await apiClient.post('/api/reports/scheduled', scheduled);
```

### Generating a One-Time Report

```typescript
const result = await apiClient.post('/api/reports/generate', {
  templateId: "template-id",
  format: "excel",
  filters: [
    {
      field: "createdAt",
      operator: "gte",
      value: "2025-01-01T00:00:00Z"
    },
    {
      field: "isActive",
      operator: "eq",
      value: true
    }
  ]
});

// Download the report
window.open(result.fileUrl, '_blank');
```

## Cron Expression Examples

```bash
# Every day at 9 AM
0 9 * * *

# Every Monday at 9 AM
0 9 * * 1

# First day of month at 9 AM
0 9 1 * *

# Every hour
0 * * * *

# Every 15 minutes
*/15 * * * *
```

## Default Templates

The system includes 5 pre-configured templates:

1. **User Report**: All users with roles and status
2. **Activity Report**: User actions over time
3. **Login History Report**: Login attempts with locations
4. **Active Users Report**: Currently active users only
5. **Security Audit Report**: Security-related events

## Permissions

Add `reports` to your permissions:

```typescript
const resources = [
  'users',
  'roles',
  'audit-logs',
  'reports',  // Add this
  // ...
];
```

Permissions:
- `reports:view` - View templates and generated reports
- `reports:create` - Create new templates
- `reports:edit` - Edit existing templates
- `reports:delete` - Delete templates and generated reports

## Integration Points

### Email System Integration

Update the `sendReportEmail` method in `report-queue.service.ts` to integrate with your email service:

```typescript
await emailService.send({
  to: recipients,
  subject: `Scheduled Report: ${reportName}`,
  template: 'scheduled-report',
  data: {
    reportName,
    downloadUrl: fileUrl,
    format,
    rowCount,
  },
  attachments: [
    {
      filename: `${reportName}.${format}`,
      content: buffer,
    }
  ]
});
```

### S3 Storage

Configure environment variables:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name
```

### Redis for Queue

```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Worker Initialization

Add to your server startup:

```typescript
import { reportQueueService } from './modules/reports/report-queue.service';

// Start the worker
reportQueueService.startWorker();

// Initialize scheduled reports
await reportQueueService.initializeScheduledReports();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await reportQueueService.stopWorker();
});
```

## Customization

### Adding New Data Sources

1. Add resource handler in `report-data.service.ts`:

```typescript
case 'customResource':
  return this.prisma.customResource.findMany({
    where: whereClause,
    select: select,
    include: include,
    orderBy: orderBy,
  });
```

2. Add aggregation method:

```typescript
private async aggregateCustomResource(
  groupBy: string,
  aggregation: string,
  where: any,
  limit: number
): Promise<ChartDataPoint[]> {
  // Implementation
}
```

### Custom Report Formats

Extend `ReportGeneratorService` with new formats:

```typescript
async generateXml(data: ReportData): Promise<Buffer> {
  // XML generation logic
}
```

## Best Practices

1. **Template Naming**: Use clear, descriptive names
2. **Column Selection**: Only select needed columns for performance
3. **Filters**: Apply filters at query level, not in application
4. **Scheduling**: Use appropriate cron expressions to avoid overlap
5. **Recipients**: Keep recipient lists reasonable (<20 emails)
6. **Expiry**: Generated reports expire after 30 days
7. **Testing**: Test templates with preview before scheduling
8. **Performance**: Large reports (>10K rows) should be scheduled, not generated live

## Troubleshooting

### Reports Not Generating

- Check Redis connection
- Verify worker is running
- Check S3 credentials
- Review application logs

### Scheduled Reports Not Running

- Verify cron expression is valid
- Check `isActive` flag
- Ensure `nextRunAt` is in the future
- Review worker logs

### Email Delivery Failures

- Verify email service integration
- Check recipient email addresses
- Review email service logs
- Ensure file size is within limits

## Future Enhancements

- Advanced chart rendering (actual chart images in PDF)
- Report versioning
- Collaborative template editing
- Custom SQL query support
- Report history and comparison
- Dashboard widget integration
- Export to Google Sheets
- Webhook notifications
- Report sharing with external users
- Custom branding per template
