// MySQL/MariaDB seed script
// Uses the MySQL Prisma client

import bcrypt from 'bcrypt';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('.prisma/client-mysql');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding MariaDB database...');

  // Create default roles
  const superAdminRole = await prisma.role.upsert({
    where: { name: 'super-admin' },
    update: {},
    create: {
      name: 'super-admin',
      description: 'Super Administrator with full access',
      isSystem: true,
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Administrator with management access',
      isSystem: true,
    },
  });

  const userRole = await prisma.role.upsert({
    where: { name: 'user' },
    update: {},
    create: {
      name: 'user',
      description: 'Regular user with limited access',
      isSystem: true,
    },
  });

  console.log('Created roles:', superAdminRole.name, adminRole.name, userRole.name);

  // Create permissions for super-admin (all permissions)
  const resources = [
    'users',
    'roles',
    'permissions',
    'menu',
    'settings',
    'files',
    'notifications',
    'audit-logs',
    'exports',
    'feature-flags',
    'announcements',
    'sales-dashboard',
    'reconciliation',
    'products',
    'seasons',
    'teams',
  ];
  const actions = ['view', 'create', 'edit', 'delete'];

  for (const resource of resources) {
    for (const action of actions) {
      await prisma.permission.upsert({
        where: {
          roleId_resource_action: {
            roleId: superAdminRole.id,
            resource,
            action,
          },
        },
        update: {},
        create: {
          roleId: superAdminRole.id,
          resource,
          action,
        },
      });
    }
  }

  // Products: custom inventory permission for super-admin
  await prisma.permission.upsert({
    where: {
      roleId_resource_action: {
        roleId: superAdminRole.id,
        resource: 'products',
        action: 'inventory',
      },
    },
    update: {},
    create: {
      roleId: superAdminRole.id,
      resource: 'products',
      action: 'inventory',
    },
  });

  // Sales Dashboard permissions (superAdmin: view + chatbot)
  for (const action of ['view', 'chatbot']) {
    await prisma.permission.upsert({
      where: {
        roleId_resource_action: {
          roleId: superAdminRole.id,
          resource: 'sales-dashboard',
          action,
        },
      },
      update: {},
      create: {
        roleId: superAdminRole.id,
        resource: 'sales-dashboard',
        action,
      },
    });
  }

  // Logs permissions (superAdmin: view) — gates the Log Viewer
  await prisma.permission.upsert({
    where: {
      roleId_resource_action: {
        roleId: superAdminRole.id,
        resource: 'logs',
        action: 'view',
      },
    },
    update: {},
    create: {
      roleId: superAdminRole.id,
      resource: 'logs',
      action: 'view',
    },
  });

  // Reports permissions (superAdmin: view) — gates the Hourly Sales Report
  await prisma.permission.upsert({
    where: {
      roleId_resource_action: {
        roleId: superAdminRole.id,
        resource: 'reports',
        action: 'view',
      },
    },
    update: {},
    create: {
      roleId: superAdminRole.id,
      resource: 'reports',
      action: 'view',
    },
  });

  // COO report permissions (superAdmin + admin: view) — dedicated permission
  // that gates the Country-of-Origin report page + its export.
  for (const role of [superAdminRole, adminRole]) {
    await prisma.permission.upsert({
      where: {
        roleId_resource_action: {
          roleId: role.id,
          resource: 'coo-report',
          action: 'view',
        },
      },
      update: {},
      create: {
        roleId: role.id,
        resource: 'coo-report',
        action: 'view',
      },
    });
  }

  // Executive Dashboard permissions (superAdmin + admin: view only — same two
  // roles sales-dashboard:view is granted to; view-only, not part of the
  // generic CRUD `resources` array above, mirrors the coo-report pattern.
  for (const role of [superAdminRole, adminRole]) {
    await prisma.permission.upsert({
      where: {
        roleId_resource_action: {
          roleId: role.id,
          resource: 'executive-dashboard',
          action: 'view',
        },
      },
      update: {},
      create: {
        roleId: role.id,
        resource: 'executive-dashboard',
        action: 'view',
      },
    });
  }

  // Create permissions for admin (most permissions except feature flags and settings)
  const adminResources = [
    'users',
    'roles',
    'menu',
    'files',
    'notifications',
    'exports',
    'announcements',
    'reconciliation',
    'products',
    'teams',
    'seasons'
  ];
  for (const resource of adminResources) {
    for (const action of actions) {
      await prisma.permission.upsert({
        where: {
          roleId_resource_action: {
            roleId: adminRole.id,
            resource,
            action,
          },
        },
        update: {},
        create: {
          roleId: adminRole.id,
          resource,
          action,
        },
      });
    }
  }

  // Add view-only permissions for admin
  for (const resource of ['audit-logs', 'settings']) {
    await prisma.permission.upsert({
      where: {
        roleId_resource_action: {
          roleId: adminRole.id,
          resource,
          action: 'view',
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        resource,
        action: 'view',
      },
    });
  }

  // Products: custom inventory permission for admin
  await prisma.permission.upsert({
    where: {
      roleId_resource_action: {
        roleId: adminRole.id,
        resource: 'products',
        action: 'inventory',
      },
    },
    update: {},
    create: {
      roleId: adminRole.id,
      resource: 'products',
      action: 'inventory',
    },
  });

  // Sales Dashboard permissions (admin: view only)
  await prisma.permission.upsert({
    where: {
      roleId_resource_action: {
        roleId: adminRole.id,
        resource: 'sales-dashboard',
        action: 'view',
      },
    },
    update: {},
    create: {
      roleId: adminRole.id,
      resource: 'sales-dashboard',
      action: 'view',
    },
  });

  // Logs permissions (admin: view only) — gates the Log Viewer
  await prisma.permission.upsert({
    where: {
      roleId_resource_action: {
        roleId: adminRole.id,
        resource: 'logs',
        action: 'view',
      },
    },
    update: {},
    create: {
      roleId: adminRole.id,
      resource: 'logs',
      action: 'view',
    },
  });

  // Reports permissions (admin: view only) — gates the Hourly Sales Report
  await prisma.permission.upsert({
    where: {
      roleId_resource_action: {
        roleId: adminRole.id,
        resource: 'logs',
        resource: 'reports',
        action: 'view',
      },
    },
    update: {},
    create: {
      roleId: adminRole.id,
      resource: 'logs',
      resource: 'reports',
      action: 'view',
    },
  });

  // Create permissions for user (view only on limited resources)
  const userViewResources = ['users', 'files'];
  for (const resource of userViewResources) {
    await prisma.permission.upsert({
      where: {
        roleId_resource_action: {
          roleId: userRole.id,
          resource,
          action: 'view',
        },
      },
      update: {},
      create: {
        roleId: userRole.id,
        resource,
        action: 'view',
      },
    });
  }

  // Deliveries module permissions — 1 view gate + 13 per-cell visibility flags
  // mirroring legacy SMS DELIVERIES_* permission constants.
  const deliveryActions = [
    'view', 'edit_season', 'edit_quantities', 'edit_price',
    'map_products', 'set_special', 'link_quantity', 'add_sms_product',
    'set_ebay', 'assign_fonts', 'add_image', 'upload_image',
    'mystery_list', 'supplier_barcode',
  ];
  for (const roleId of [superAdminRole.id, adminRole.id]) {
    for (const action of deliveryActions) {
      await prisma.permission.upsert({
        where: { roleId_resource_action: { roleId, resource: 'deliveries', action } },
        update: {},
        create: { roleId, resource: 'deliveries', action },
      });
    }
  }

  console.log('Created permissions');

  // Create default super admin user
  const hashedPassword = await bcrypt.hash('Admin@123', 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      roleId: superAdminRole.id,
      isActive: true,
      emailVerified: true,
    },
  });

  console.log('Created super admin user:', superAdmin.email);

  // Create additional test users
  const testUsers = [
    { email: 'john.doe@example.com', firstName: 'John', lastName: 'Doe', roleId: adminRole.id },
    { email: 'jane.smith@example.com', firstName: 'Jane', lastName: 'Smith', roleId: adminRole.id },
    { email: 'bob.wilson@example.com', firstName: 'Bob', lastName: 'Wilson', roleId: userRole.id },
    {
      email: 'alice.johnson@example.com',
      firstName: 'Alice',
      lastName: 'Johnson',
      roleId: userRole.id,
    },
    {
      email: 'charlie.brown@example.com',
      firstName: 'Charlie',
      lastName: 'Brown',
      roleId: userRole.id,
    },
    { email: 'diana.ross@example.com', firstName: 'Diana', lastName: 'Ross', roleId: adminRole.id },
    {
      email: 'edward.norton@example.com',
      firstName: 'Edward',
      lastName: 'Norton',
      roleId: userRole.id,
    },
    {
      email: 'fiona.apple@example.com',
      firstName: 'Fiona',
      lastName: 'Apple',
      roleId: userRole.id,
    },
    {
      email: 'george.lucas@example.com',
      firstName: 'George',
      lastName: 'Lucas',
      roleId: userRole.id,
    },
    {
      email: 'helen.mirren@example.com',
      firstName: 'Helen',
      lastName: 'Mirren',
      roleId: adminRole.id,
    },
  ];

  const userPassword = await bcrypt.hash('Test@123', 12);
  for (const userData of testUsers) {
    await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        password: userPassword,
        firstName: userData.firstName,
        lastName: userData.lastName,
        roleId: userData.roleId,
        isActive: true,
        emailVerified: true,
      },
    });
  }

  console.log('Created', testUsers.length, 'test users');

  // Create default menu items
  const menuItems = [
    {
      label: 'Dashboard',
      icon: 'LayoutDashboard',
      path: '/',
      sortOrder: 0,
    },
    {
      label: 'Users',
      icon: 'Users',
      path: '/users',
      permission: 'users:view',
      sortOrder: 10,
    },
    {
      label: 'Roles & Permissions',
      icon: 'Shield',
      path: '/roles',
      permission: 'roles:view',
      sortOrder: 20,
    },
    {
      label: 'Menu Management',
      icon: 'Menu',
      path: '/menu',
      permission: 'menu:view',
      sortOrder: 30,
    },
    {
      label: 'Files',
      icon: 'FileText',
      path: '/files',
      permission: 'files:view',
      sortOrder: 40,
    },
    {
      label: 'Notifications',
      icon: 'Bell',
      path: '/notifications',
      permission: 'notifications:view',
      sortOrder: 50,
    },
    {
      label: 'Audit Logs',
      icon: 'FileSearch',
      path: '/audit-logs',
      permission: 'audit-logs:view',
      sortOrder: 60,
    },
    {
      label: 'Settings',
      icon: 'Settings',
      path: '/settings',
      permission: 'settings:view',
      sortOrder: 100,
    },
  ];

  for (const item of menuItems) {
    await prisma.menuItem.upsert({
      where: { id: item.label.toLowerCase().replace(/\s+/g, '-') },
      update: item,
      create: {
        id: item.label.toLowerCase().replace(/\s+/g, '-'),
        ...item,
      },
    });
  }

  console.log('Created menu items');

  // Create default system settings
  const settings = [
    {
      key: 'app.name',
      value: 'Admin Panel',
      type: 'STRING',
      category: 'general',
      label: 'Application Name',
      isPublic: true,
    },
    {
      key: 'app.logo',
      value: null,
      type: 'STRING',
      category: 'general',
      label: 'Application Logo URL',
      isPublic: true,
    },
    {
      key: 'auth.session_timeout',
      value: 30,
      type: 'NUMBER',
      category: 'security',
      label: 'Session Timeout (minutes)',
      isPublic: false,
    },
    {
      key: 'auth.max_login_attempts',
      value: 5,
      type: 'NUMBER',
      category: 'security',
      label: 'Max Login Attempts',
      isPublic: false,
    },
    {
      key: 'auth.lockout_duration',
      value: 15,
      type: 'NUMBER',
      category: 'security',
      label: 'Lockout Duration (minutes)',
      isPublic: false,
    },
  ];

  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: {
        key: setting.key,
        value: setting.value,
        type: setting.type as any,
        category: setting.category,
        label: setting.label,
        isPublic: setting.isPublic,
      },
    });
  }

  console.log('Created system settings');

  // Seed demo data (simplified - just categories and statuses)
  const categories = ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books'];
  for (const name of categories) {
    await prisma.demoCategory.upsert({
      where: { name },
      update: {},
      create: { name, description: `${name} category`, isActive: true },
    });
  }

  const statuses = [
    { name: 'active', label: 'Active', color: 'green' },
    { name: 'inactive', label: 'Inactive', color: 'gray' },
    { name: 'pending', label: 'Pending', color: 'yellow' },
    { name: 'discontinued', label: 'Discontinued', color: 'red' },
  ];
  for (const status of statuses) {
    await prisma.demoStatus.upsert({
      where: { name: status.name },
      update: {},
      create: { ...status, isActive: true },
    });
  }

  console.log('Created demo categories and statuses');

  // Create sample audit logs
  const auditActions = ['LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'VIEW'];
  const auditResources = ['User', 'Role', 'Settings', 'MenuItem', 'File'];

  for (let i = 0; i < 50; i++) {
    const action = auditActions[Math.floor(Math.random() * auditActions.length)];
    const resource = auditResources[Math.floor(Math.random() * auditResources.length)];
    const daysAgo = Math.floor(Math.random() * 30);

    await prisma.auditLog.create({
      data: {
        user: { connect: { id: superAdmin.id } },
        action,
        resource,
        resourceId: `sample-${i}`,
        metadata: {
          ipAddress: `192.168.1.${Math.floor(Math.random() * 255)}`,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
          sample: true,
        },
        createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      },
    });
  }

  console.log('Created 50 sample audit logs');

  // Create sample announcements
  const announcements = [
    {
      title: 'System Maintenance Scheduled',
      content:
        'The system will undergo maintenance on the upcoming weekend. Please save your work.',
      type: 'WARNING',
      isActive: true,
      priority: 1,
    },
    {
      title: 'New Feature: Dark Mode',
      content: 'We have added dark mode support! Toggle it from the header menu.',
      type: 'INFO',
      isActive: true,
      priority: 2,
    },
    {
      title: 'Welcome to Admin Panel',
      content:
        'Welcome to the new admin panel. Explore the features and let us know your feedback.',
      type: 'SUCCESS',
      isActive: true,
      priority: 3,
    },
  ];

  for (const announcement of announcements) {
    await prisma.announcement.upsert({
      where: { id: announcement.title.toLowerCase().replace(/\s+/g, '-').replace(/:/g, '') },
      update: {},
      create: {
        id: announcement.title.toLowerCase().replace(/\s+/g, '-').replace(/:/g, ''),
        ...announcement,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdById: superAdmin.id,
      },
    });
  }

  console.log('Created sample announcements');

  // Create a custom (non-system) role for testing
  const editorRole = await prisma.role.upsert({
    where: { name: 'editor' },
    update: {},
    create: {
      name: 'editor',
      description: 'Content editor with limited permissions',
      isSystem: false,
    },
  });

  // Add some permissions for editor
  for (const resource of ['files', 'announcements']) {
    for (const action of ['view', 'create', 'edit']) {
      await prisma.permission.upsert({
        where: {
          roleId_resource_action: {
            roleId: editorRole.id,
            resource,
            action,
          },
        },
        update: {},
        create: {
          roleId: editorRole.id,
          resource,
          action,
        },
      });
    }
  }

  console.log('Created editor role with permissions');

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
