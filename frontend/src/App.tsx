import { Link, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { EmptyState } from "./components/ui";
import Billing from "./pages/Billing";
import Dashboard from "./pages/Dashboard";
import InvoiceDetail from "./pages/InvoiceDetail";
import Invoices from "./pages/Invoices";
import Items from "./pages/Items";
import Settings from "./pages/Settings";
import StockAdjustment from "./pages/StockAdjustment";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="billing" element={<Billing />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="items" element={<Items />} />
        <Route path="stock" element={<StockAdjustment />} />
        <Route path="settings" element={<Settings />} />
        <Route
          path="*"
          element={
            <EmptyState title="Page not found">
              <Link className="text-khata underline" to="/">
                Go to the dashboard
              </Link>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
