import { Link } from 'react-router-dom';
import {
  Table2,
  FormInput,
  Bell,
  Download,
  Upload,
  FileText,
  Clock,
  ListTodo,
  BookOpen,
  Layers,
  Database,
  Shield,
  Users,
  Globe,
  Calendar,
  FileSpreadsheet,
  Mail,
  TextCursor,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface ComponentDemo {
  title: string;
  description: string;
  icon: React.ElementType;
  path: string;
  tags: string[];
  status: 'stable' | 'beta' | 'new';
}

const componentDemos: ComponentDemo[] = [
  {
    title: 'DataTable',
    description: 'Full-featured data table with sorting, filtering, pagination, row selection, and URL state sync.',
    icon: Table2,
    path: '/demos/datatable',
    tags: ['TanStack Table', 'Sorting', 'Filtering', 'Pagination'],
    status: 'stable',
  },
  {
    title: 'Form Components',
    description: 'Form field components with React Hook Form and Zod validation. TextField, Select, Checkbox, Switch, Radio.',
    icon: FormInput,
    path: '/demos/forms',
    tags: ['React Hook Form', 'Zod', 'Validation'],
    status: 'stable',
  },
  {
    title: 'Notifications',
    description: 'Toast notifications with Sonner and persistent notification panel with bell icon.',
    icon: Bell,
    path: '/demos/notifications',
    tags: ['Sonner', 'Zustand', 'Toast'],
    status: 'stable',
  },
  {
    title: 'Export Module',
    description: 'Export data to CSV, Excel (XLSX), and PDF formats with column selection.',
    icon: Download,
    path: '/demos/export',
    tags: ['CSV', 'Excel', 'PDF', 'papaparse', 'xlsx', 'pdfkit'],
    status: 'stable',
  },
  {
    title: 'File Upload',
    description: 'File upload with S3/MinIO integration, drag-drop, progress tracking, and presigned URLs.',
    icon: Upload,
    path: '/demos/file-upload',
    tags: ['S3', 'MinIO', 'Drag & Drop', 'Multipart'],
    status: 'stable',
  },
  {
    title: 'Logging',
    description: 'Structured logging with Pino for high-performance JSON logs with pino-pretty for development.',
    icon: FileText,
    path: '/demos/logging',
    tags: ['Pino', 'JSON Logs', 'Request Tracing'],
    status: 'stable',
  },
  {
    title: 'Queue Jobs (BullMQ)',
    description: 'Background job processing with BullMQ and Redis for reliable async task execution.',
    icon: ListTodo,
    path: '/demos/queue-jobs',
    tags: ['BullMQ', 'Redis', 'Background Jobs'],
    status: 'stable',
  },
  {
    title: 'Cron Jobs',
    description: 'Scheduled tasks and recurring jobs with cron expressions and job management.',
    icon: Clock,
    path: '/demos/cron-jobs',
    tags: ['Cron', 'Scheduler', 'Recurring Tasks'],
    status: 'stable',
  },
  {
    title: 'Internationalization (i18n)',
    description: 'Multi-language support with RTL detection, translation management, and locale switching.',
    icon: Globe,
    path: '/demos/i18n',
    tags: ['i18n', 'Translations', 'RTL', 'Localization'],
    status: 'new',
  },
  {
    title: 'Scheduled Jobs',
    description: 'Database-backed scheduled jobs with handlers, monitoring, and manual triggering.',
    icon: Calendar,
    path: '/demos/scheduled-jobs',
    tags: ['Cron', 'Database', 'Handlers', 'Monitoring'],
    status: 'new',
  },
  {
    title: 'Reports',
    description: 'Generate and export reports in CSV, JSON, or Excel format with filters.',
    icon: FileSpreadsheet,
    path: '/demos/reports',
    tags: ['CSV', 'Excel', 'JSON', 'Data Export'],
    status: 'new',
  },
  {
    title: 'Notification Channels',
    description: 'Multi-channel notifications with Email, SMS, Push, and WhatsApp support.',
    icon: Mail,
    path: '/demos/notification-channels',
    tags: ['Email', 'SMS', 'Push', 'Templates'],
    status: 'new',
  },
  {
    title: 'Rich Text Editor',
    description: 'WYSIWYG editor with Tiptap for rich content editing, integrated with React Hook Form.',
    icon: TextCursor,
    path: '/demos/rich-text',
    tags: ['Tiptap', 'WYSIWYG', 'Editor', 'React Hook Form'],
    status: 'new',
  },
];

interface ArchitectureItem {
  title: string;
  description: string;
  icon: React.ElementType;
  details: string[];
}

const architectureItems: ArchitectureItem[] = [
  {
    title: 'Frontend Stack',
    description: 'Modern React with TypeScript',
    icon: Layers,
    details: ['React 18', 'TypeScript', 'Vite', 'TanStack Query', 'Zustand', 'Tailwind CSS', 'Shadcn/ui'],
  },
  {
    title: 'Backend Stack',
    description: 'Fast and scalable API',
    icon: Database,
    details: ['Fastify', 'TypeScript', 'Prisma ORM', 'PostgreSQL', 'Redis', 'MinIO/S3'],
  },
  {
    title: 'Authentication',
    description: 'Secure JWT-based auth',
    icon: Shield,
    details: ['JWT Access/Refresh', 'Session Management', 'Password Hashing (bcrypt)', 'Rate Limiting'],
  },
  {
    title: 'RBAC',
    description: 'Role-based access control',
    icon: Users,
    details: ['Roles & Permissions', 'Resource-Action Model', 'Dynamic Menu', 'Audit Logging'],
  },
];

const statusColors = {
  stable: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  beta: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
};

export function DemoIndex() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Component Library & Demos</h1>
        <p className="text-muted-foreground text-lg">
          Explore all reusable components, patterns, and features available in this admin panel framework.
          Each demo includes working examples, feature documentation, and code snippets.
        </p>
      </div>

      {/* Quick Start */}
      <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <CardTitle>Quick Start Guide</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <h4 className="font-semibold">1. Explore Demos</h4>
              <p className="text-sm text-muted-foreground">
                Browse the component demos below to see what's available and how each component works.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">2. Copy Code Snippets</h4>
              <p className="text-sm text-muted-foreground">
                Each demo has a "Usage" tab with copy-ready code examples you can use in your project.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">3. Customize & Build</h4>
              <p className="text-sm text-muted-foreground">
                Components are fully customizable. Extend or modify them to fit your needs.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Component Demos */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Component Demos</h2>
          <Badge variant="outline">{componentDemos.length} Components</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {componentDemos.map((demo) => {
            const Icon = demo.icon;
            return (
              <Link key={demo.path} to={demo.path}>
                <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{demo.title}</CardTitle>
                          <Badge className={`mt-1 ${statusColors[demo.status]}`} variant="secondary">
                            {demo.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <CardDescription className="mt-2">{demo.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1">
                      {demo.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Architecture Overview */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Architecture Overview</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {architectureItems.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">{item.title}</CardTitle>
                  </div>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1">
                    {item.details.map((detail) => (
                      <li key={detail} className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                        {detail}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Directory Structure */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Project Structure</h2>
        <Card>
          <CardContent className="pt-6">
            <pre className="text-sm bg-muted p-4 rounded-lg overflow-x-auto">
{`js-admin-panel/
├── apps/
│   ├── api/                    # Fastify Backend
│   │   ├── src/
│   │   │   ├── config/         # Environment config
│   │   │   ├── lib/            # Utilities (prisma, redis, logger)
│   │   │   ├── modules/        # Feature modules
│   │   │   │   ├── auth/       # Authentication
│   │   │   │   ├── users/      # User management
│   │   │   │   ├── roles/      # Role & permissions
│   │   │   │   ├── files/      # File upload (S3)
│   │   │   │   ├── exports/    # Data export
│   │   │   │   └── menu/       # Dynamic menu
│   │   │   ├── plugins/        # Fastify plugins
│   │   │   └── server.ts       # Entry point
│   │   └── prisma/             # Database schema & seeds
│   │
│   └── web/                    # React Frontend
│       └── src/
│           ├── components/     # Reusable components
│           │   ├── data-table/ # DataTable
│           │   ├── forms/      # Form fields
│           │   ├── export/     # Export components
│           │   ├── notifications/
│           │   ├── layout/     # AppShell, Sidebar, Header
│           │   └── ui/         # Shadcn/ui primitives
│           ├── hooks/          # Custom hooks
│           ├── lib/            # Utilities
│           ├── pages/          # Route pages
│           │   ├── auth/       # Login, Register, etc.
│           │   ├── demos/      # Component demos
│           │   └── users/      # User management
│           └── stores/         # Zustand stores
│
├── packages/
│   └── shared/                 # Shared types, schemas, utils
│
├── docker-compose.yml          # PostgreSQL, Redis, MinIO
└── ecosystem.config.cjs        # PM2 config`}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Key Commands */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Development Commands</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Getting Started</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm bg-muted p-4 rounded-lg overflow-x-auto">
{`# Install dependencies
pnpm install

# Start Docker services (DB, Redis, MinIO)
docker-compose up -d

# Run database migrations
pnpm --filter @admin/api db:migrate

# Seed the database
pnpm --filter @admin/api db:seed

# Start development servers
pnpm dev`}
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Useful Commands</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm bg-muted p-4 rounded-lg overflow-x-auto">
{`# Database
pnpm --filter @admin/api db:studio  # Prisma Studio
pnpm --filter @admin/api db:reset   # Reset DB

# Build
pnpm build                          # Build all
pnpm --filter @admin/web build      # Build frontend
pnpm --filter @admin/api build      # Build backend

# PM2 (Production)
pm2 start ecosystem.config.cjs
pm2 logs js-admin-api
pm2 restart all`}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
