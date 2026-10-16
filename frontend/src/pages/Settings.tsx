import { useEffect, useState, type FormEvent } from "react";
import { Notice, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage, type Settings as SettingsData } from "../lib/api";
import { ChangePassword, ManageUsers } from "../components/AccountSettings";
import { useAuth } from "../lib/auth";
import { formatMoney, paiseToInput, parseRupees } from "../lib/money";
import { useSettings } from "../lib/settings";

export default function Settings() {
  const { reload } = useSettings();
  const { user } = useAuth();
  const [form, setForm] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<SettingsData>("/settings")
      .then((r) => setForm(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { data } = await api.put<SettingsData>("/settings", {
        businessName: form.businessName,
        businessAddress: form.businessAddress,
        businessPhone: form.businessPhone,
        currency: form.currency,
        invoiceFooter: form.invoiceFooter,
      });
      setForm(data);
      setSaved(true);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const set = (key: keyof SettingsData) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));
  };

  return (
    <>
      <PageHeader title="Settings" description="These details are printed on every invoice PDF." />
      {!form && !error && <Spinner />}
      {!form && error && <Notice kind="error">{error}</Notice>}
      {form && (
        <form onSubmit={save} className="panel max-w-2xl space-y-4 p-5 sm:p-6">
          <div>
            <label className="label" htmlFor="businessName">
              Business name
            </label>
            <input id="businessName" className="field" value={form.businessName} onChange={set("businessName")} required maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor="businessAddress">
              Business address
            </label>
            <textarea id="businessAddress" rows={2} className="field" value={form.businessAddress} onChange={set("businessAddress")} maxLength={300} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="businessPhone">
                Business phone number
              </label>
              <input id="businessPhone" className="field num" value={form.businessPhone} onChange={set("businessPhone")} maxLength={30} inputMode="tel" />
            </div>
            <div>
              <label className="label" htmlFor="currency">
                Currency
              </label>
              <input id="currency" className="field uppercase" value={form.currency} onChange={set("currency")} maxLength={3} pattern="[A-Za-z]{3}" title="3-letter currency code, e.g. INR" />
              <p className="mt-1 text-xs text-ink-soft">3-letter code. INR is the default.</p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="invoiceFooter">
              Invoice footer
            </label>
            <textarea id="invoiceFooter" rows={2} className="field" value={form.invoiceFooter} onChange={set("invoiceFooter")} maxLength={300} placeholder="e.g. Thank you for shopping with us!" />
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          {saved && <Notice kind="success">Settings saved.</Notice>}
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      )}
      <div className="mt-8 space-y-6">
        {form && <PackagingSettings settings={form} canEdit={Boolean(user?.isOwner)} onSaved={(d) => { setForm(d); void reload(); }} />}
        <ChangePassword />
        {user?.isOwner && <ManageUsers />}
      </div>
    </>
  );
}

/** Packaging rule for takeaway and delivery bills (owner only). */
function PackagingSettings({ settings, canEdit, onSaved }: { settings: SettingsData; canEdit: boolean; onSaved: (s: SettingsData) => void }) {
  const [minPrice, setMinPrice] = useState(paiseToInput(settings.packagingMinPricePaise));
  const [box, setBox] = useState(paiseToInput(settings.packagingBoxPaise));
  const [bag, setBag] = useState(paiseToInput(settings.packagingBagPaise));
  const [onTakeaway, setOnTakeaway] = useState(settings.packagingOnTakeaway);
  const [onDelivery, setOnDelivery] = useState(settings.packagingOnDelivery);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const values = [parseRupees(minPrice), parseRupees(box), parseRupees(bag)];
    if (values.some((v) => v === null)) return setError("Enter amounts like 50 or 5.50.");
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { data } = await api.put<SettingsData>("/settings/packaging", {
        packagingMinPricePaise: values[0],
        packagingBoxPaise: values[1],
        packagingBagPaise: values[2],
        packagingOnTakeaway: onTakeaway,
        packagingOnDelivery: onDelivery,
      });
      setSaved(true);
      onSaved(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const exampleMin = parseRupees(minPrice) ?? 0;
  const exampleBox = parseRupees(box) ?? 0;
  const exampleBag = parseRupees(bag) ?? 0;

  return (
    <form onSubmit={save} className="panel max-w-2xl space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="font-semibold">Packaging charges</h2>
        <p className="num mt-1 text-sm text-ink-soft">
          For {[onTakeaway && "takeaway", onDelivery && "delivery"].filter(Boolean).join(" and ") || "no"} bills: {formatMoney(exampleBox)} box for each item priced{" "}
          {formatMoney(exampleMin)} or more, plus a {formatMoney(exampleBag)} carry bag on every bill. Packaging is never discounted. Changes apply to new bills only.
        </p>
      </div>
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="pkMin">
              Box for items from (₹)
            </label>
            <input id="pkMin" className="field num" inputMode="decimal" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pkBox">
              Box charge per piece (₹)
            </label>
            <input id="pkBox" className="field num" inputMode="decimal" value={box} onChange={(e) => setBox(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pkBag">
              Carry bag per bill (₹)
            </label>
            <input id="pkBag" className="field num" inputMode="decimal" value={bag} onChange={(e) => setBag(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-khata" checked={onTakeaway} onChange={(e) => setOnTakeaway(e.target.checked)} /> Charge on takeaway
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-khata" checked={onDelivery} onChange={(e) => setOnDelivery(e.target.checked)} /> Charge on delivery
          </label>
        </div>
      </fieldset>
      <p className="text-xs text-ink-soft">Items can have their own box charge, or no packaging at all: edit the item on the Items page.</p>
      {!canEdit && <p className="text-sm text-ink-soft">Only the owner can change these.</p>}
      {error && <Notice kind="error">{error}</Notice>}
      {saved && <Notice kind="success">Packaging charges saved.</Notice>}
      {canEdit && (
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save packaging"}
          </button>
        </div>
      )}
    </form>
  );
}
