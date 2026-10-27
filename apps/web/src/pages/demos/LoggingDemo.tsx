import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

const logLevels = [
  { level: 'FATAL', value: 60, color: 'bg-red-900 text-white', description: 'System is unusable' },
  { level: 'ERROR', value: 50, color: 'bg-red-500 text-white', description: 'Error conditions' },
  { level: 'WARN', value: 40, color: 'bg-yellow-500 text-black', description: 'Warning conditions' },
  { level: 'INFO', value: 30, color: 'bg-blue-500 text-white', description: 'Informational messages' },
  { level: 'DEBUG', value: 20, color: 'bg-gray-500 text-white', description: 'Debug-level messages' },
  { level: 'TRACE', value: 10, color: 'bg-gray-400 text-black', description: 'Trace-level messages' },
];

const sampleLogs = [
  { time: '2024-12-16 10:30:15', level: 'INFO', message: 'Server started on port 4000', context: { env: 'development' } },
  { time: '2024-12-16 10:30:16', level: 'INFO', message: 'Connected to PostgreSQL', context: { host: 'localhost', port: 15432 } },
  { time: '2024-12-16 10:30:16', level: 'INFO', message: 'Connected to Redis', context: { host: 'localhost', port: 16379 } },
  { time: '2024-12-16 10:31:22', level: 'INFO', message: 'User logged in', context: { userId: 'u123', email: 'admin@example.com' } },
  { time: '2024-12-16 10:31:45', level: 'DEBUG', message: 'Database query executed', context: { table: 'users', duration: '12ms' } },
  { time: '2024-12-16 10:32:10', level: 'WARN', message: 'Rate limit approaching', context: { ip: '192.168.1.1', requests: 95 } },
  { time: '2024-12-16 10:33:00', level: 'ERROR', message: 'Failed to send email', context: { to: 'user@example.com', error: 'SMTP timeout' } },
];

export function LoggingDemo() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logging System</h1>
        <p className="text-muted-foreground">
          Structured logging with Pino for high-performance JSON logs.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="levels">Log Levels</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="output">Sample Output</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pino Logger</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                High-performance JSON logger with minimal overhead. 5x faster than alternatives.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">pino-pretty</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Human-readable output in development. Colorized logs with timestamps.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Request ID Tracking</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Every request gets a unique ID for end-to-end tracing across services.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Structured Context</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Attach metadata objects to logs for easy filtering and analysis.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Auto Request Logging</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Automatic logging of incoming requests and responses with timing.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Child Loggers</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Create scoped loggers with persistent context for modules/services.
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="levels" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Log Levels</CardTitle>
              <CardDescription>
                Logs at or above the configured level are output (default: info in production, debug in development)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {logLevels.map((level) => (
                  <div key={level.level} className="flex items-center gap-4">
                    <Badge className={`${level.color} w-16 justify-center`}>
                      {level.level}
                    </Badge>
                    <span className="text-sm text-muted-foreground w-8">{level.value}</span>
                    <span className="text-sm">{level.description}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Logger Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/lib/logger.ts
import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.LOG_LEVEL || 'info',
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            colorize: true,
          },
        }
      : undefined,
});

// Environment variable: LOG_LEVEL=debug`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Basic Logging</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { logger } from '../lib/logger';

// Simple messages
logger.info('Server started');
logger.error('Database connection failed');
logger.warn('Rate limit exceeded');
logger.debug('Processing request');

// With context object
logger.info({ userId: 'u123', action: 'login' }, 'User logged in');

logger.error({
  err: error,
  userId: 'u123',
  endpoint: '/api/users',
}, 'Request failed');

// With child logger for module scope
const authLogger = logger.child({ module: 'auth' });
authLogger.info('Token validated'); // Includes module: 'auth' in output`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fastify Integration</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Fastify has built-in Pino support
const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'requestId',
});

// In route handlers
app.get('/users', async (request, reply) => {
  request.log.info('Fetching users');
  request.log.debug({ filters }, 'Applied filters');
  // request.log automatically includes requestId
});

// Hooks for automatic logging
app.addHook('onRequest', async (request) => {
  request.log.info({
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  });
});

app.addHook('onResponse', async (request, reply) => {
  request.log.info({
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    responseTime: reply.elapsedTime,
  });
});`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Error Logging Best Practices</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Always use 'err' key for Error objects (Pino serializes it)
try {
  await riskyOperation();
} catch (error) {
  logger.error({ err: error }, 'Operation failed');
  // Output includes stack trace, message, name, etc.
}

// Log with relevant context
logger.error({
  err: error,
  userId: user.id,
  operation: 'createOrder',
  orderId: order?.id,
  input: sanitizedInput, // Never log passwords/tokens!
}, 'Order creation failed');

// Fatal errors (app should exit)
logger.fatal({ err: error }, 'Unrecoverable error');
process.exit(1);`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="output" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sample Log Output</CardTitle>
              <CardDescription>
                Development mode with pino-pretty formatting
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="font-mono text-xs space-y-1 bg-gray-900 text-gray-100 p-4 rounded-lg">
                  {sampleLogs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-gray-500">[{log.time}]</span>
                      <span className={
                        log.level === 'ERROR' ? 'text-red-400' :
                        log.level === 'WARN' ? 'text-yellow-400' :
                        log.level === 'DEBUG' ? 'text-gray-400' :
                        'text-green-400'
                      }>
                        {log.level}:
                      </span>
                      <span className="text-white">{log.message}</span>
                      {log.context && (
                        <span className="text-cyan-400">
                          {JSON.stringify(log.context)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>JSON Output (Production)</CardTitle>
              <CardDescription>
                Raw JSON format for log aggregation systems
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{"level":30,"time":1702716615000,"requestId":"req-1","msg":"User logged in","userId":"u123","email":"admin@example.com"}
{"level":40,"time":1702716630000,"requestId":"req-2","msg":"Rate limit approaching","ip":"192.168.1.1","requests":95}
{"level":50,"time":1702716680000,"requestId":"req-3","msg":"Failed to send email","err":{"type":"SMTPError","message":"Connection timeout","stack":"..."}}`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
