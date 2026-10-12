import { useEffect, useState, type FormEvent } from "react";
import { Notice, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage, type Settings as SettingsData } from "../lib/api";
import { useSettings } from "../lib/settings";

export default function Settings() {
  const { reload } = useSettings();
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
    </>
  );
}
