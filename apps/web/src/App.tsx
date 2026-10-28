import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/ui/loading-screen';

// Lazy load pages for code splitting
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const UsersPage = lazy(() => import('@/pages/users/UsersPage').then(m => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('@/pages/roles/RolesPage').then(m => ({ default: m.RolesPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('@/pages/settings').then(m => ({ default: m.SettingsPage })));
const AuditLogsPage = lazy(() => import('@/pages/audit').then(m => ({ default: m.AuditLogsPage })));
const AnnouncementsPage = lazy(() => import('@/pages/announcements').then(m => ({ default: m.AnnouncementsPage })));
const LoginHistoryPage = lazy(() => import('@/pages/security/LoginHistoryPage').then(m => ({ default: m.LoginHistoryPage })));
const TrustedDevicesPage = lazy(() => import('@/pages/security/TrustedDevicesPage').then(m => ({ default: m.TrustedDevicesPage })));

// Lazy load demo pages
const DemoIndex = lazy(() => import('@/pages/demos').then(m => ({ default: m.DemoIndex })));
const DataTableDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.DataTableDemo })));
const FormDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.FormDemo })));
const NotificationsDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.NotificationsDemo })));
const ExportDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.ExportDemo })));
const FileUploadDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.FileUploadDemo })));
const LoggingDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.LoggingDemo })));
const QueueJobsDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.QueueJobsDemo })));
const CronJobsDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.CronJobsDemo })));
const I18nDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.I18nDemo })));
const ScheduledJobsDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.ScheduledJobsDemo })));
const ReportsDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.ReportsDemo })));
const NotificationChannelsDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.NotificationChannelsDemo })));
const RichTextDemo = lazy(() => import('@/pages/demos').then(m => ({ default: m.RichTextDemo })));
const JobsPage = lazy(() => import('@/pages/jobs/Jobs').then(m => ({ default: m.JobsPage })));
const DebenhamsInventoryUploadPage = lazy(() => import('@/pages/debenhams-inventory-upload/DebenhamsInventoryUploadPage').then(m => ({ default: m.DebenhamsInventoryUploadPage })));
const SalesDashboardPage = lazy(() => import('./pages/sales-dashboard/SalesDashboardPage'));
const ExecutiveDashboardPage = lazy(() => import('./pages/executive-dashboard/ExecutiveDashboardPage'));
const SalesPerformancePage = lazy(() => import('@/pages/reports/SalesPerformancePage'));
const EbayReconciliationPage = lazy(() => import('@/pages/reports/ebay-reconciliation/EbayReconciliationPage'));
const OrdersPage = lazy(() => import('@/pages/orders/OrdersPage').then(m => ({ default: m.OrdersPage })));
const OrderEditPage = lazy(() => import('@/pages/orders/OrderEditPage').then(m => ({ default: m.OrderEditPage })));
const ReconciliationPage = lazy(() => import('@/pages/reconciliation/ReconciliationPage').then(m => ({ default: m.ReconciliationPage })));
const ShopifyInventorySyncPage = lazy(() => import('@/pages/shopify-inventory-sync/ShopifyInventorySyncPage').then(m => ({ default: m.ShopifyInventorySyncPage })));
const MarketplaceDashboardPage = lazy(() => import('@/pages/marketplace-dashboard/MarketplaceDashboardPage'));
const FontPage = lazy(() => import('@/pages/fonts/Fonts').then(m => ({ default: m.Fonts })));
const FontFormPage = lazy(() => import('@/pages/fonts/FontFormPage').then(m => ({ default: m.FontFormPage })));
const SeasonsPage = lazy(() => import('@/pages/seasons/Seasons').then(m => ({ default: m.Seasons })));
const SeasonFormPage = lazy(() => import('@/pages/seasons/SeasonFormPage').then(m => ({ default: m.SeasonFormPage })));
const TeamsPage = lazy(() => import('@/pages/teams/Teams').then(m => ({ default: m.Teams })));
const TeamFormPage = lazy(() => import('@/pages/teams/TeamFormPage').then(m => ({ default: m.TeamFormPage })));
const NewProductPage = lazy(() => import('@/pages/products/NewProductPage').then(m => ({ default: m.NewProductPage })));
const CooReportPage = lazy(() => import('@/pages/products/CooReportPage').then(m => ({ default: m.CooReportPage })));
const NotesPage = lazy(() => import('@/pages/notes/NotesPage').then(m => ({ default: m.NotesPage })));
const BooksPage = lazy(() => import('@/pages/books/Books').then(m => ({ default: m.Books })));
const BookFormPage = lazy(() => import('@/pages/books/BookFormPage').then(m => ({ default: m.BookFormPage })));
const IssuesPage = lazy(() => import('@/pages/issues/Issues').then(m => ({default: m.Issues})));
const StudentsPage = lazy(() => import('@/pages/students/Students').then(m => ({default: m.Students})));
const StudentFormPage = lazy(() => import('@/pages/students/StudentFormPage').then(m => ({default: m.StudentFormPage})));
const BookReportPage = lazy(() => import('@/pages/report/BookReport').then(m => ({default: m.BookReport})));
const IssueReportPage = lazy(() => import("@/pages/report/IssueReport").then(m => ({default: m.IssueReport})));

// Daily Deals
const DailyDealsPage = lazy(() => import('@/pages/daily-deals/DailyDealsPage'));

// TOTE Assignment
const ToteAssignmentPage = lazy(() => import('@/pages/tote-assignment').then(m => ({ default: m.ToteAssignmentPage })));

// Logs
const LogsPage = lazy(() => import('@/pages/logs/LogsPage').then(m => ({ default: m.LogsPage })));
// Deliveries (migration of legacy SMS /index/new_stock)
const DeliveriesPage = lazy(() => import('@/pages/deliveries/DeliveriesPage').then(m => ({ default: m.DeliveriesPage })));
const CreateEditProductFormPage = lazy(() => import('@/pages/deliveries/CreateEditProductFormPage').then(m => ({ default: m.CreateEditProductFormPage })));

// Seller Dynamics (T-Shirts approval for Seller Dynamics listing)
const SellerDynamicsPage = lazy(() => import('@/pages/seller-dynamics/SellerDynamicsPage').then(m => ({ default: m.SellerDynamicsPage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// Suspense wrapper for lazy loaded components
function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LazyPage>
              <LoginPage />
            </LazyPage>
          </PublicRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <LazyPage>
              <ForgotPasswordPage />
            </LazyPage>
          </PublicRoute>
        }
      />
      <Route
        path="/reset-password"
        element={
          <PublicRoute>
            <LazyPage>
              <ResetPasswordPage />
            </LazyPage>
          </PublicRoute>
        }
      />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<LazyPage><DashboardPage /></LazyPage>} />
        <Route path="users" element={<LazyPage><UsersPage /></LazyPage>} />
        <Route path="roles" element={<LazyPage><RolesPage /></LazyPage>} />
        <Route path="profile" element={<LazyPage><ProfilePage /></LazyPage>} />
        <Route path="settings" element={<LazyPage><SettingsPage /></LazyPage>} />
        <Route path="audit-logs" element={<LazyPage><AuditLogsPage /></LazyPage>} />
        <Route path="announcements" element={<LazyPage><AnnouncementsPage /></LazyPage>} />
        <Route path="jobs" element={<LazyPage><JobsPage /></LazyPage>} />
        <Route path="debenhams-inventory-upload" element={<LazyPage><DebenhamsInventoryUploadPage /></LazyPage>} />
        <Route path="sales-dashboard" element={<LazyPage><SalesDashboardPage /></LazyPage>} />
        <Route path="executive-dashboard" element={<LazyPage><ExecutiveDashboardPage /></LazyPage>} />
        <Route path="reports/sales-performance" element={<LazyPage><SalesPerformancePage /></LazyPage>} />
        <Route path="reports/ebay-reconciliation" element={<LazyPage><EbayReconciliationPage /></LazyPage>} />

        {/* Fonts routes */}
        <Route path="fonts" element={<LazyPage><FontPage/></LazyPage>} />
        <Route path="fonts/create" element={<LazyPage><FontFormPage/></LazyPage>} />
        <Route path="fonts/:id" element={<LazyPage><FontFormPage/></LazyPage>} />

        {/* Seasons routes */}
        <Route path="seasons" element={<LazyPage><SeasonsPage /></LazyPage>} />
        <Route path="seasons/create" element={<LazyPage><SeasonFormPage /></LazyPage>} />
        <Route path="seasons/:id" element={<LazyPage><SeasonFormPage /></LazyPage>} />
        {/* Teams routes */}
        <Route path="teams" element={<LazyPage><TeamsPage/></LazyPage>} />
        <Route path="teams/create" element={<LazyPage><TeamFormPage/></LazyPage>} />
        <Route path="teams/:id" element={<LazyPage><TeamFormPage/></LazyPage>} />

        {/* Books route */}
        <Route path="books" element={<LazyPage><BooksPage /></LazyPage>} />
        <Route path="books/create" element={<LazyPage><BookFormPage /></LazyPage>} />
        <Route path="books/:id" element={<LazyPage><BookFormPage /></LazyPage>} />
        
        {/* Issues route */}
        <Route path="issues" element={<LazyPage><IssuesPage /></LazyPage>} />
        
        {/* Students route */}
        <Route path="students" element={<LazyPage><StudentsPage /></LazyPage>} />
        <Route path="students/create" element={<LazyPage><StudentFormPage /></LazyPage>} />
        <Route path="students/:id" element={<LazyPage><StudentFormPage /></LazyPage>} />

        {/* Report route */}
        <Route path="book-report" element={<LazyPage><BookReportPage /></LazyPage>} />
        <Route path="issue-report" element={<LazyPage><IssueReportPage /></LazyPage>} />


        {/* Notes routes */}
        <Route path="notes" element={<LazyPage><NotesPage /></LazyPage>} />

        {/* Orders routes (SPEC-01 Foundation) */}
        <Route path="orders" element={<LazyPage><OrdersPage /></LazyPage>} />
        <Route path="orders/:id" element={<LazyPage><OrderEditPage /></LazyPage>} />
        <Route path="reconciliation" element={<LazyPage><ReconciliationPage /></LazyPage>} />
        <Route path="shopify-inventory-sync" element={<LazyPage><ShopifyInventorySyncPage /></LazyPage>} />
        <Route path="daily-deals" element={<LazyPage><DailyDealsPage /></LazyPage>} />
        <Route path="tote-assignment" element={<LazyPage><ToteAssignmentPage /></LazyPage>} />
        <Route path="deliveries" element={<LazyPage><DeliveriesPage /></LazyPage>} />
        <Route path="deliveries/new-product" element={<LazyPage><CreateEditProductFormPage /></LazyPage>} />
        <Route path="seller-dynamics" element={<LazyPage><SellerDynamicsPage /></LazyPage>} />
        <Route path="marketplace-dashboard" element={<LazyPage><MarketplaceDashboardPage /></LazyPage>} />
        <Route path="products/new" element={<LazyPage><NewProductPage /></LazyPage>} />
        <Route path="products/coo-report" element={<LazyPage><CooReportPage /></LazyPage>} />
        <Route path="logs" element={<LazyPage><LogsPage /></LazyPage>} />
        {/* Security routes */}
        <Route path="security/login-history" element={<LazyPage><LoginHistoryPage /></LazyPage>} />
        <Route path="security/trusted-devices" element={<LazyPage><TrustedDevicesPage /></LazyPage>} />

        {/* Demo routes */}
        <Route path="demos" element={<LazyPage><DemoIndex /></LazyPage>} />
        <Route path="demos/datatable" element={<LazyPage><DataTableDemo /></LazyPage>} />
        <Route path="demos/forms" element={<LazyPage><FormDemo /></LazyPage>} />
        <Route path="demos/notifications" element={<LazyPage><NotificationsDemo /></LazyPage>} />
        <Route path="demos/export" element={<LazyPage><ExportDemo /></LazyPage>} />
        <Route path="demos/file-upload" element={<LazyPage><FileUploadDemo /></LazyPage>} />
        <Route path="demos/logging" element={<LazyPage><LoggingDemo /></LazyPage>} />
        <Route path="demos/queue-jobs" element={<LazyPage><QueueJobsDemo /></LazyPage>} />
        <Route path="demos/cron-jobs" element={<LazyPage><CronJobsDemo /></LazyPage>} />
        <Route path="demos/i18n" element={<LazyPage><I18nDemo /></LazyPage>} />
        <Route path="demos/scheduled-jobs" element={<LazyPage><ScheduledJobsDemo /></LazyPage>} />
        <Route path="demos/reports" element={<LazyPage><ReportsDemo /></LazyPage>} />
        <Route path="demos/notification-channels" element={<LazyPage><NotificationChannelsDemo /></LazyPage>} />
        <Route path="demos/rich-text" element={<LazyPage><RichTextDemo /></LazyPage>} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
