import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Shield,
  Settings,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  ScrollText,
  Megaphone,
  Briefcase,
  Upload,
  BarChart3,
  TrendingUp,
  Clock,
  ShoppingCart,
  ClipboardCheck,
  RefreshCw,
  Tag,
  Store,
  Package,
  PackageOpen,
  PackagePlus,
  Languages,
  FileText,
  Shirt,
  Globe,
  ListChecks,
  Trophy,
  Notebook,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/hooks/useAuth';

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  permission?: string;
}

const menuItems: MenuItem[] = [
  {
    label: 'Dashboard',
    icon: <LayoutDashboard className="h-5 w-5" />,
    path: '/',
  },
  {
    label: 'Fonts',
    icon: <Languages className="h-5 w-5" />,
    path: '/fonts',
  },
  {
    label: 'Seasons',
    icon: <Clock className="h-5 w-5" />,
    path: '/seasons',
    permission: 'seasons:view',
  },
  {
    label: 'Teams',
    icon: <Trophy className="h-5 w-5" />,
    path: '/teams',
    permission: 'teams:view',
  },
  {
    label: 'Users',
    icon: <Users className="h-5 w-5" />,
    path: '/users',
    permission: 'users:view',
  },
  {
    label: 'Roles',
    icon: <Shield className="h-5 w-5" />,
    path: '/roles',
    permission: 'roles:view',
  },
  {
    label: 'Sales Dashboard',
    icon: <BarChart3 className="h-5 w-5" />,
    path: '/sales-dashboard',
    permission: 'sales-dashboard:view',
  },
  {
    label: 'Executive Dashboard',
    icon: <TrendingUp className="h-5 w-5" />,
    path: '/executive-dashboard',
    permission: 'executive-dashboard:view',
  },
  {
    label: 'Sales Performance',
    icon: <Clock className="h-5 w-5" />,
    path: '/reports/sales-performance',
    permission: 'reports:view',
  },
  {
    label: 'eBay Reconciliation',
    icon: <ListChecks className="h-5 w-5" />,
    path: '/reports/ebay-reconciliation',
    permission: 'reports:view',
  },
  {
    label: 'Daily Deals',
    icon: <Tag className="h-5 w-5" />,
    path: '/daily-deals',
    permission: 'daily-deals:view',
  },
  {
    label: 'Deliveries',
    icon: <PackageOpen className="h-5 w-5" />,
    path: '/deliveries',
    permission: 'deliveries:view',
  },
  {
    label: 'Orders',
    icon: <ShoppingCart className="h-5 w-5" />,
    path: '/orders',
    permission: 'orders:view',
  },
  {
    label: 'Seller Dynamics – T-Shirts',
    icon: <Shirt className="h-5 w-5" />,
    path: '/seller-dynamics',
    permission: 'sd-tshirts:view',
  },
  {
    label: 'TOTE Assignment',
    icon: <Package className="h-5 w-5" />,
    path: '/tote-assignment',
    permission: 'tote-assignment:manage',
  },
  {
    label: 'New Product',
    icon: <PackagePlus className="h-5 w-5" />,
    path: '/products/new',
    permission: 'products:create',
  },
  {
    label: 'Country of Origin',
    icon: <Globe className="h-5 w-5" />,
    path: '/products/coo-report',
    permission: 'coo-report:view',
  },
  {
    label: 'Demos',
    icon: <BookOpen className="h-5 w-5" />,
    path: '/demos',
  },
  {
    label: 'Audit Logs',
    icon: <ScrollText className="h-5 w-5" />,
    path: '/audit-logs',
    permission: 'audit-logs:view',
  },
  {
    label: 'Announcements',
    icon: <Megaphone className="h-5 w-5" />,
    path: '/announcements',
    permission: 'announcements:view',
  },
  {
    label: 'Settings',
    icon: <Settings className="h-5 w-5" />,
    path: '/settings',
    permission: 'settings:view',
  },
  {
    label: 'Jobs',
    icon: <Briefcase className="h-5 w-5" />,
    path: '/jobs',
  },
  {
    label: 'Reconciliation',
    icon: <ClipboardCheck className="h-5 w-5" />,
    path: '/reconciliation',
    permission: 'reconciliation:view',
  },
  {
    label: 'Logs',
    icon: <FileText className="h-5 w-5" />,
    path: '/logs',
    permission: 'logs:view',
  },
  {
    label: 'Debenhams Upload',
    icon: <Upload className="h-5 w-5" />,
    path: '/debenhams-inventory-upload',
  },
  {
    label: 'Shopify Inv. Sync',
    icon: <RefreshCw className="h-5 w-5" />,
    path: '/shopify-inventory-sync',
    permission: 'shopify-inventory-sync:view',
  },
  {
    label: 'Marketplaces',
    icon: <Store className="h-5 w-5" />,
    path: '/marketplace-dashboard',
    permission: 'marketplaces:read',
  },
  {
    label: 'Notes',
    icon: <Notebook className="h-5 w-5" />,
    path: '/notes',
  },
  // *************************
  // **lms sidebar from here**
  // *************************
  {
    label: 'Books',
    icon: <BookOpen clasName="h-5 w-5" />,
    path: '/books',
  },
  {
    label: 'Issues',
    icon: <BookOpen clasName="h-5 w-5" />,
    path: '/issues',
  },
  {
    label: 'Students',
    icon: <BookOpen clasName="h-5 w-5" />,
    path: '/students',
  },
  {
    label: 'Book Report',
    icon: <BookOpen clasName="h-5 w-5" />,
    path: '/book-report',
  },
  {
    label: 'Issue Report',
    icon: <BookOpen clasName="h-5 w-5" />,
    path: '/issue-report',
  },
];

export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const location = useLocation();
  const { can } = usePermission();

  const visibleMenuItems = menuItems.filter((item) => !item.permission || can(item.permission));

  return (
    <aside
      className={cn(
        'flex flex-col border-r bg-background transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-4">
        {!collapsed && (
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              A
            </div>
            <span className="font-semibold">Admin Panel</span>
          </Link>
        )}
        {collapsed && (
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            A
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {visibleMenuItems.map((item) => {
          const isActive =
            item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                collapsed && 'justify-center px-2'
              )}
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse button */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={() => onCollapse(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
}
