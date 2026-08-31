import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import AccessDenied from './components/AccessDenied.jsx';
import { LoadingBlock } from './components/ui.jsx';

// Every screen loads on demand. The initial download is the shell and the login
// page; the heavy reporting screens (and the chart library they pull in) arrive
// only when someone actually opens them.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const ProductForm = lazy(() => import('./pages/ProductForm.jsx'));
const Customers = lazy(() => import('./pages/Customers.jsx'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail.jsx'));
const Invoices = lazy(() => import('./pages/Invoices.jsx'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail.jsx'));
const POS = lazy(() => import('./pages/POS.jsx'));
const Quotations = lazy(() => import('./pages/Quotations.jsx'));
const QuotationForm = lazy(() => import('./pages/QuotationForm.jsx'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders.jsx'));
const PurchaseOrderDetail = lazy(() => import('./pages/PurchaseOrderDetail.jsx'));
const PurchaseOrderForm = lazy(() => import('./pages/PurchaseOrderForm.jsx'));
const Suppliers = lazy(() => import('./pages/Suppliers.jsx'));
const SupplierDetail = lazy(() => import('./pages/SupplierDetail.jsx'));
const Accounts = lazy(() => import('./pages/Accounts.jsx'));
const AccountLedger = lazy(() => import('./pages/AccountLedger.jsx'));
const ImportExport = lazy(() => import('./pages/ImportExport.jsx'));
const Deals = lazy(() => import('./pages/Deals.jsx'));
const DealDetail = lazy(() => import('./pages/DealDetail.jsx'));
const Receivables = lazy(() => import('./pages/Receivables.jsx'));
const ReceivableDetail = lazy(() => import('./pages/ReceivableDetail.jsx'));
const Payables = lazy(() => import('./pages/Payables.jsx'));
const PayableDetail = lazy(() => import('./pages/PayableDetail.jsx'));
const Expenses = lazy(() => import('./pages/Expenses.jsx'));
const ExpenseReports = lazy(() => import('./pages/ExpenseReports.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Activity = lazy(() => import('./pages/Activity.jsx'));

// Permissions themselves are unchanged. What changed is that a denial is now
// stated rather than performed silently: the previous <Navigate to="/"> made a
// legitimate permission boundary look like a broken link.
function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingBlock />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <AccessDenied roles={roles} />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingBlock />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<Protected roles={['admin', 'stock', 'sales']}><ProductForm /></Protected>} />
        <Route path="products/:id/edit" element={<Protected roles={['admin', 'stock', 'sales']}><ProductForm /></Protected>} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="pos" element={<Protected roles={['admin', 'sales']}><POS /></Protected>} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="quotations" element={<Quotations />} />
        <Route path="quotations/new" element={<Protected roles={['admin', 'sales']}><QuotationForm /></Protected>} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="purchase-orders/new" element={<Protected roles={['admin', 'stock']}><PurchaseOrderForm /></Protected>} />
        <Route path="purchase-orders/:id/edit" element={<Protected roles={['admin', 'stock']}><PurchaseOrderForm /></Protected>} />
        <Route path="purchase-orders/:id" element={<PurchaseOrderDetail />} />
        {/* Supplier screens mirror the API: admin and stock only. */}
        <Route path="suppliers" element={<Protected roles={['admin', 'stock']}><Suppliers /></Protected>} />
        <Route path="suppliers/:id" element={<Protected roles={['admin', 'stock']}><SupplierDetail /></Protected>} />
        <Route path="accounts" element={<Protected roles={['admin']}><Accounts /></Protected>} />
        <Route path="accounts/:id" element={<Protected roles={['admin']}><AccountLedger /></Protected>} />
        <Route path="data" element={<Protected roles={['admin', 'sales']}><ImportExport /></Protected>} />
        <Route path="deals" element={<Protected roles={['admin']}><Deals /></Protected>} />
        <Route path="deals/:kind/:id" element={<Protected roles={['admin']}><DealDetail /></Protected>} />
        <Route path="receivables" element={<Protected roles={['admin', 'sales']}><Receivables /></Protected>} />
        <Route path="receivables/:id" element={<Protected roles={['admin', 'sales']}><ReceivableDetail /></Protected>} />
        <Route path="payables" element={<Protected roles={['admin']}><Payables /></Protected>} />
        <Route path="payables/:id" element={<Protected roles={['admin']}><PayableDetail /></Protected>} />
        <Route path="expenses" element={<Protected roles={['admin', 'sales']}><Expenses /></Protected>} />
        <Route path="expense-reports" element={<Protected roles={['admin', 'sales']}><ExpenseReports /></Protected>} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Protected roles={['admin']}><Settings /></Protected>} />
        <Route path="users" element={<Protected roles={['admin']}><Users /></Protected>} />
        <Route path="activity" element={<Protected roles={['admin']}><Activity /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
