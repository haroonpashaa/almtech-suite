import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import ProductForm from './pages/ProductForm.jsx';
import Customers from './pages/Customers.jsx';
import CustomerDetail from './pages/CustomerDetail.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import POS from './pages/POS.jsx';
import Quotations from './pages/Quotations.jsx';
import QuotationForm from './pages/QuotationForm.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail.jsx';
import PurchaseOrderForm from './pages/PurchaseOrderForm.jsx';
import Accounts from './pages/Accounts.jsx';
import AccountLedger from './pages/AccountLedger.jsx';
import ImportExport from './pages/ImportExport.jsx';
import Deals from './pages/Deals.jsx';
import DealDetail from './pages/DealDetail.jsx';
import Receivables from './pages/Receivables.jsx';
import ReceivableDetail from './pages/ReceivableDetail.jsx';
import Payables from './pages/Payables.jsx';
import PayableDetail from './pages/PayableDetail.jsx';
import Expenses from './pages/Expenses.jsx';
import ExpenseReports from './pages/ExpenseReports.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Users from './pages/Users.jsx';
import Activity from './pages/Activity.jsx';

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
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
        <Route path="products/new" element={<Protected roles={['admin', 'stock']}><ProductForm /></Protected>} />
        <Route path="products/:id/edit" element={<Protected roles={['admin']}><ProductForm /></Protected>} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="pos" element={<Protected roles={['admin', 'sales']}><POS /></Protected>} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="quotations" element={<Quotations />} />
        <Route path="quotations/new" element={<Protected roles={['admin', 'sales']}><QuotationForm /></Protected>} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="purchase-orders/new" element={<Protected roles={['admin', 'stock']}><PurchaseOrderForm /></Protected>} />
        <Route path="purchase-orders/:id" element={<PurchaseOrderDetail />} />
        <Route path="accounts" element={<Protected roles={['admin']}><Accounts /></Protected>} />
        <Route path="accounts/:id" element={<Protected roles={['admin']}><AccountLedger /></Protected>} />
        <Route path="data" element={<Protected roles={['admin']}><ImportExport /></Protected>} />
        <Route path="deals" element={<Protected roles={['admin']}><Deals /></Protected>} />
        <Route path="deals/:kind/:id" element={<Protected roles={['admin']}><DealDetail /></Protected>} />
        <Route path="receivables" element={<Protected roles={['admin']}><Receivables /></Protected>} />
        <Route path="receivables/:id" element={<Protected roles={['admin']}><ReceivableDetail /></Protected>} />
        <Route path="payables" element={<Protected roles={['admin']}><Payables /></Protected>} />
        <Route path="payables/:id" element={<Protected roles={['admin']}><PayableDetail /></Protected>} />
        <Route path="expenses" element={<Protected roles={['admin']}><Expenses /></Protected>} />
        <Route path="expense-reports" element={<Protected roles={['admin']}><ExpenseReports /></Protected>} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Protected roles={['admin']}><Settings /></Protected>} />
        <Route path="users" element={<Protected roles={['admin']}><Users /></Protected>} />
        <Route path="activity" element={<Protected roles={['admin']}><Activity /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
