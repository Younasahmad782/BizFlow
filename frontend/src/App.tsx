import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import Layout from './components/Layout'
import Assistant from './pages/Assistant'
import AuditLogs from './pages/AuditLogs'
import CustomerProfile from './pages/CustomerProfile'
import Customers from './pages/Customers'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import EmployeeProfile from './pages/EmployeeProfile'
import Expenses from './pages/Expenses'
import ForgotPassword from './pages/ForgotPassword'
import Inventory from './pages/Inventory'
import Invoices from './pages/Invoices'
import InvoiceDetail from './pages/InvoiceDetail'
import Login from './pages/Login'
import Notifications from './pages/Notifications'
import Orders from './pages/Orders'
import NewOrder from './pages/NewOrder'
import OrderDetail from './pages/OrderDetail'
import Products from './pages/Products'
import Register from './pages/Register'
import Reports from './pages/Reports'
import ResetPassword from './pages/ResetPassword'
import Sales from './pages/Sales'
import Settings from './pages/Settings'
import Suppliers from './pages/Suppliers'
import SupplierProfile from './pages/SupplierProfile'

/** Landing page: dashboard if permitted, else first permitted section. */
function HomeRedirect() {
  const { can } = useAuth()
  if (can('reports.read')) return <Dashboard />
  for (const [perm, to] of [
    ['customers.read', '/customers'],
    ['products.read', '/products'],
    ['orders.read', '/orders'],
    ['invoices.read', '/invoices'],
    ['expenses.read', '/expenses'],
    ['employees.read', '/employees'],
  ] as const) {
    if (can(perm)) return <Navigate to={to} replace />
  }
  return <Dashboard />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<HomeRedirect />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerProfile />} />
            <Route path="products" element={<Products />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="suppliers/:id" element={<SupplierProfile />} />
            <Route path="sales" element={<Sales />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/new" element={<NewOrder />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/:id" element={<InvoiceDetail />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="employees" element={<Employees />} />
            <Route path="employees/:id" element={<EmployeeProfile />} />
            <Route path="reports" element={<Reports />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="settings" element={<Settings />} />
            <Route path="audit-logs" element={<AuditLogs />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
