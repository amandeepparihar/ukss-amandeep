// PM2 Ecosystem Configuration for Production
// Environment variables are loaded from apps/api/.env by the application itself

module.exports = {
  apps: [
    {
      name: 'js-admin-api',
      cwd: './apps/api',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      error_file: '/tmp/js-admin-api-error.log',
      out_file: '/tmp/js-admin-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'js-admin-web',
      cwd: './apps/web',
      script: 'npx',
      args: 'serve -s dist -l 3002',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/tmp/js-admin-web-error.log',
      out_file: '/tmp/js-admin-web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'ebay-recon-snapshot',
      cwd: './apps/api',
      script: 'dist/cli.js',
      args: 'ebay snapshot-listings',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: false,           // one-shot job, NOT a server
      cron_restart: '0 6 * * *',    // daily 06:00 server time
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' },
      error_file: '/tmp/ebay-recon-snapshot-error.log',
      out_file: '/tmp/ebay-recon-snapshot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
