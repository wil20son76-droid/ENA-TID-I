"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { RequireCapability } from "@/components/auth/RequireCapability";
import type { PurchaseItemType } from "@/lib/db/types";
import { db } from "@/lib/db/schema";
import { registerPurchase } from "@/lib/db/repositories/purchaseRepository";
import { listActiveSuppliers } from "@/lib/db/repositories/supplierRepository";
import { formatMoney } from "@/lib/domain/money";

const ITEM_TYPE_LABEL: Record<PurchaseItemType, string> = {
  FEED: "Alimento",
  FRY: "Alevines",
  MEDICINE: "Medicina",
  MATERIAL: "Material",
  EQUIPMENT: "Equipamiento",
  OTHER: "Otro",
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewPurchasePage() {
  const router = useRouter();
  const suppliers = useLiveQuery(() => listActiveSuppliers(), []) ?? [];
  const feeds = useLiveQuery(async () => {
    const all = await db.feeds.toArray();
    return all.filter((f) => f.active && !f.deletedAt).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, []) ?? [];

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [itemType, setItemType] = useState<PurchaseItemType>("FEED");
  const [feedId, setFeedId] = useState("");
  const [description, setDescription] = useState("");

  // Feed: entrada en sacos (§13) o kg directo.
  const [feedInputMode, setFeedInputMode] = useState<"sacks" | "kg">("sacks");
  const [sackCount, setSackCount] = useState("");
  const [weightPerSackKg, setWeightPerSackKg] = useState("25");
  const [pricePerSack, setPricePerSack] = useState("");
  const [feedQuantityKg, setFeedQuantityKg] = useState("");
  const [feedPricePerKg, setFeedPricePerKg] = useState("");

  // Otros tipos: cantidad/unidad/precio genéricos.
  const [genericQuantity, setGenericQuantity] = useState("");
  const [genericUnit, setGenericUnit] = useState("unidad");
  const [genericUnitPrice, setGenericUnitPrice] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedFeedQuantityKg =
    feedInputMode === "sacks"
      ? Number(sackCount || 0) * Number(weightPerSackKg || 0)
      : Number(feedQuantityKg || 0);
  const computedFeedUnitPrice =
    feedInputMode === "sacks"
      ? Number(weightPerSackKg || 0) > 0
        ? Number(pricePerSack || 0) / Number(weightPerSackKg || 0)
        : 0
      : Number(feedPricePerKg || 0);
  const computedFeedTotal = computedFeedQuantityKg * computedFeedUnitPrice;

  const computedGenericTotal = Number(genericQuantity || 0) * Number(genericUnitPrice || 0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSubmitting(true);
    setError(null);
    try {
      if (itemType === "FEED") {
        if (!feedId) {
          throw new Error("Selecciona a qué alimento del catálogo corresponde.");
        }
        if (computedFeedQuantityKg <= 0) {
          throw new Error("La cantidad de alimento debe ser mayor que cero.");
        }
        const feedName = feeds.find((f) => f.id === feedId)?.name ?? "Alimento";
        await registerPurchase({
          supplierId: supplierId || null,
          date: new Date(date).toISOString(),
          referenceNumber: referenceNumber.trim() || null,
          lines: [
            {
              itemType: "FEED",
              feedId,
              description: feedName,
              quantity: computedFeedQuantityKg,
              unit: "kg",
              unitPrice: computedFeedUnitPrice,
            },
          ],
        });
      } else {
        if (!description.trim()) {
          throw new Error("Escribe una descripción de la compra.");
        }
        const quantity = Number(genericQuantity);
        if (!quantity || quantity <= 0) {
          throw new Error("La cantidad debe ser mayor que cero.");
        }
        await registerPurchase({
          supplierId: supplierId || null,
          date: new Date(date).toISOString(),
          referenceNumber: referenceNumber.trim() || null,
          lines: [
            {
              itemType,
              feedId: null,
              description: description.trim(),
              quantity,
              unit: genericUnit.trim() || "unidad",
              unitPrice: Number(genericUnitPrice || 0),
            },
          ],
        });
      }
      router.push("/compras");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <RequireCapability capability="MANAGE_ECONOMY">
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Nueva compra</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Proveedor (opcional)</span>
          <select
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Sin proveedor</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Fecha</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">N.º de referencia (opcional)</span>
            <input
              type="text"
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Tipo de compra</span>
          <select
            value={itemType}
            onChange={(event) => setItemType(event.target.value as PurchaseItemType)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {(Object.keys(ITEM_TYPE_LABEL) as PurchaseItemType[]).map((key) => (
              <option key={key} value={key}>
                {ITEM_TYPE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>

        {itemType === "FEED" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Alimento del catálogo</span>
              <select
                value={feedId}
                onChange={(event) => setFeedId(event.target.value)}
                disabled={submitting}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">Selecciona un alimento</option>
                {feeds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setFeedInputMode("sacks")}
                className={`flex-1 rounded-lg border px-3 py-2 font-medium transition-colors ${
                  feedInputMode === "sacks"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                Por sacos
              </button>
              <button
                type="button"
                onClick={() => setFeedInputMode("kg")}
                className={`flex-1 rounded-lg border px-3 py-2 font-medium transition-colors ${
                  feedInputMode === "kg"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                Kg directo
              </button>
            </div>

            {feedInputMode === "sacks" ? (
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400"># sacos</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={sackCount}
                    onChange={(event) => setSackCount(event.target.value)}
                    disabled={submitting}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Kg/saco</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={weightPerSackKg}
                    onChange={(event) => setWeightPerSackKg(event.target.value)}
                    disabled={submitting}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Precio/saco</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={pricePerSack}
                    onChange={(event) => setPricePerSack(event.target.value)}
                    disabled={submitting}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Kg totales</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={feedQuantityKg}
                    onChange={(event) => setFeedQuantityKg(event.target.value)}
                    disabled={submitting}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Precio/kg</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={feedPricePerKg}
                    onChange={(event) => setFeedPricePerKg(event.target.value)}
                    disabled={submitting}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
              </div>
            )}

            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {computedFeedQuantityKg.toLocaleString("es", { maximumFractionDigits: 2 })} kg — Total:{" "}
              {formatMoney(computedFeedTotal)}
            </p>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Descripción</span>
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Cantidad</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={genericQuantity}
                  onChange={(event) => setGenericQuantity(event.target.value)}
                  disabled={submitting}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Unidad</span>
                <input
                  type="text"
                  value={genericUnit}
                  onChange={(event) => setGenericUnit(event.target.value)}
                  disabled={submitting}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Precio unitario</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={genericUnitPrice}
                  onChange={(event) => setGenericUnitPrice(event.target.value)}
                  disabled={submitting}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Total: {formatMoney(computedGenericTotal)}</p>
          </>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Guardar compra
        </button>
      </form>
    </div>
    </RequireCapability>
  );
}
