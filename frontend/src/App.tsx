import { Link, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { EmptyState, Notice, Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { SettingsProvider } from "./lib/settings";
import Login from "./pages/Login";
import Billing from "./pages/Billing";
import Dashboard from "./pages/Dashboard";
import InvoiceDetail from "./pages/InvoiceDetail";
import Invoices from "./pages/Invoices";
import Items from "./pages/Items";
import Settings from "./pages/Settings";
import StockAdjustment from "./pages/StockAdjustment";

export default function App() {
  const { phase, refresh, startError } = useAuth();

  if (phase === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }
  if (phase === "offline") {
    return (
      <main className="mx-auto max-w-md px-4 py-20">
        <Notice kind="error">{startError ?? "Cannot reach the billing server. Check that the backend is running (npm run dev), then try again."}</Notice>
        <button type="button" className="btn btn-secondary mt-4" onClick={() => void refresh()}>
          Try again
        </button>
      </main>
    );
  }
  if (phase === "setup" || phase === "login") return <Login mode={phase} />;

  return (
    <SettingsProvider>
      <AppRoutes />
    </SettingsProvider>
  );
}

function AppRoutes() {
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
