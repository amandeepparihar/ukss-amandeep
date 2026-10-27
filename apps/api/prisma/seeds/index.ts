import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

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
    'reconciliation',
    'logs',
    'reports',
    'executive-dashboard',
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

  // Create permissions for admin (most permissions except feature flags and settings)
  const adminResources = ['users', 'roles', 'menu', 'files', 'notifications', 'exports', 'announcements', 'reconciliation', 'executive-dashboard', 'teams', 'seasons'];
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
  for (const resource of ['audit-logs', 'settings', 'reports', 'logs']) {
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

  for (const roleId of [superAdminRole.id, adminRole.id]) {
    await prisma.permission.upsert({
      where: {
        roleId_resource_action: {
          roleId,
          resource: 'tote-assignment',
          action: 'manage',
        },
      },
      update: {},
      create: {
        roleId,
        resource: 'tote-assignment',
        action: 'manage',
      },
    });
  }

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
