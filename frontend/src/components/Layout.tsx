import { FileText, LayoutDashboard, Package, ReceiptIndianRupee, Settings as SettingsIcon, SlidersHorizontal } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useSettings } from "../lib/settings";

const links = [
  { to: "/billing", label: "New bill", icon: ReceiptIndianRupee },
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/items", label: "Items", icon: Package },
  { to: "/stock", label: "Stock adjustment", icon: SlidersHorizontal },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Layout() {
  const { settings } = useSettings();
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-rule bg-sheet md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-4 py-4 md:px-5 md:py-6">
          <span className="grid size-8 place-items-center rounded-md bg-khata text-white" aria-hidden>
            <ReceiptIndianRupee className="size-4.5" />
          </span>
          <span className="truncate font-semibold">{settings?.businessName ?? "Simple Billing"}</span>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-khata-tint text-khata-dark" : "text-ink-soft hover:bg-rule-soft hover:text-ink"
                }`
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
