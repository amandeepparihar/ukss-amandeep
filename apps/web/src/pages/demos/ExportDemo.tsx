import { FileText, FileSpreadsheet, File, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExportButton } from '@/components/export/ExportButton';
import { ExportDialog } from '@/components/export/ExportDialog';
import { useExport } from '@/hooks/useExport';

const userColumns = [
  { key: 'email', header: 'Email', width: 30 },
  { key: 'firstName', header: 'First Name', width: 15 },
  { key: 'lastName', header: 'Last Name', width: 15 },
  { key: 'role', header: 'Role', width: 15 },
  { key: 'isActive', header: 'Active', width: 10 },
  { key: 'createdAt', header: 'Created At', width: 20 },
];

const roleColumns = [
  { key: 'name', header: 'Role Name', width: 20 },
  { key: 'description', header: 'Description', width: 40 },
  { key: 'userCount', header: 'Users', width: 10 },
  { key: 'permissionCount', header: 'Permissions', width: 10 },
  { key: 'isSystem', header: 'System Role', width: 10 },
];

export function ExportDemo() {
  const { exportData, isExporting } = useExport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Export Module</h1>
        <p className="text-muted-foreground">
          Export data to CSV, Excel, or PDF formats with customizable columns.
        </p>
      </div>

      <Tabs defaultValue="demo" className="space-y-4">
        <TabsList>
          <TabsTrigger value="demo">Demo</TabsTrigger>
          <TabsTrigger value="formats">Formats</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="demo" className="space-y-4">
          {/* Quick Export Buttons */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Export (Dropdown)</CardTitle>
              <CardDescription>
                Simple dropdown to select format and export immediately
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div>
                  <p className="text-sm font-medium mb-2">Export Users</p>
                  <ExportButton
                    resource="users"
                    columns={userColumns}
                    title="Users Export"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Export Roles</p>
                  <ExportButton
                    resource="roles"
                    columns={roleColumns}
                    title="Roles Export"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Export Audit Logs</p>
                  <ExportButton
                    resource="audit-logs"
                    title="Audit Logs Export"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Export Dialog */}
          <Card>
            <CardHeader>
              <CardTitle>Advanced Export (Dialog)</CardTitle>
              <CardDescription>
                Dialog with column selection and format options
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <ExportDialog
                  resource="users"
                  availableColumns={userColumns}
                  title="Users"
                >
                  <Button variant="outline">
                    <Download className="h-4 w-4 mr-2" />
                    Export Users (Advanced)
                  </Button>
                </ExportDialog>
                <ExportDialog
                  resource="roles"
                  availableColumns={roleColumns}
                  title="Roles"
                >
                  <Button variant="outline">
                    <Download className="h-4 w-4 mr-2" />
                    Export Roles (Advanced)
                  </Button>
                </ExportDialog>
              </div>
            </CardContent>
          </Card>

          {/* Direct Export */}
          <Card>
            <CardHeader>
              <CardTitle>Programmatic Export</CardTitle>
              <CardDescription>
                Export directly using the useExport hook
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    exportData({
                      resource: 'users',
                      format: 'csv',
                      title: 'Users CSV Export',
                    })
                  }
                  disabled={isExporting}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Users CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    exportData({
                      resource: 'users',
                      format: 'xlsx',
                      title: 'Users Excel Export',
                    })
                  }
                  disabled={isExporting}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Users Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    exportData({
                      resource: 'users',
                      format: 'pdf',
                      title: 'Users Report',
                      orientation: 'landscape',
                    })
                  }
                  disabled={isExporting}
                >
                  <File className="h-4 w-4 mr-2" />
                  Users PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="formats" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-green-500" />
                  <CardTitle className="text-lg">CSV</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="mb-2">Comma-Separated Values</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Universal compatibility</li>
                  <li>Small file size</li>
                  <li>Easy to import into databases</li>
                  <li>Best for data processing</li>
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-blue-500" />
                  <CardTitle className="text-lg">Excel (XLSX)</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="mb-2">Microsoft Excel Spreadsheet</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Native Excel support</li>
                  <li>Column width preservation</li>
                  <li>Multiple sheet support</li>
                  <li>Best for spreadsheet editing</li>
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <File className="h-5 w-5 text-red-500" />
                  <CardTitle className="text-lg">PDF</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="mb-2">Portable Document Format</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Print-ready format</li>
                  <li>Professional appearance</li>
                  <li>Portrait/Landscape options</li>
                  <li>Best for sharing/printing</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>ExportButton Component</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { ExportButton } from '@/components/export/ExportButton';

// Simple usage - exports with default columns
<ExportButton resource="users" />

// With custom columns
<ExportButton
  resource="users"
  columns={[
    { key: 'email', header: 'Email', width: 30 },
    { key: 'name', header: 'Name', width: 20 },
  ]}
  title="User Export"
/>

// With filters
<ExportButton
  resource="users"
  filters={{ isActive: true }}
/>

// Custom styling
<ExportButton
  resource="users"
  variant="default"
  size="sm"
/>`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ExportDialog Component</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { ExportDialog } from '@/components/export/ExportDialog';

// With trigger button
<ExportDialog
  resource="users"
  availableColumns={[
    { key: 'email', header: 'Email', width: 30 },
    { key: 'name', header: 'Name', width: 20 },
    { key: 'role', header: 'Role', width: 15 },
  ]}
  title="Users"
>
  <Button>Export Users</Button>
</ExportDialog>

// With filters
<ExportDialog
  resource="users"
  availableColumns={columns}
  filters={{ status: 'active' }}
/>`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>useExport Hook</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { useExport } from '@/hooks/useExport';

function MyComponent() {
  const { exportData, isExporting, getPreview } = useExport();

  // Basic export
  const handleExport = async () => {
    await exportData({
      resource: 'users',
      format: 'xlsx',
    });
  };

  // With all options
  const handleAdvancedExport = async () => {
    await exportData({
      resource: 'users',
      format: 'pdf',
      columns: [
        { key: 'email', header: 'Email' },
        { key: 'name', header: 'Full Name' },
      ],
      filters: { isActive: true },
      title: 'Active Users Report',
      subtitle: 'Generated on ' + new Date().toLocaleDateString(),
      orientation: 'landscape',
    });
  };

  // Get preview data
  const handlePreview = async () => {
    const preview = await getPreview('users');
    // { columns: [...], preview: [...], totalCount: 100 }
  };

  return (
    <Button onClick={handleExport} disabled={isExporting}>
      {isExporting ? 'Exporting...' : 'Export'}
    </Button>
  );
}`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Adding New Export Resources (Backend)</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/modules/exports/exports.routes.ts

const resourceHandlers: Record<string, ResourceHandler> = {
  // Add your new resource
  products: {
    getData: async (filters) => {
      const products = await prisma.product.findMany({
        where: filters as any,
        orderBy: { name: 'asc' },
      });
      return products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        category: p.category,
      }));
    },
    defaultColumns: [
      { key: 'name', header: 'Product Name', width: 30 },
      { key: 'price', header: 'Price', width: 15 },
      { key: 'category', header: 'Category', width: 20 },
    ],
  },
};`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
