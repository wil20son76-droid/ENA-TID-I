# Economía y cierre productivo (Fase 5)

Este documento fija la política contable de la Fase 5 — qué se suma
dónde, cómo se evita contar un mismo costo dos veces, y cómo se
calculan costo/kg, ingresos, ganancia y margen. Es la referencia que
cualquier reporte o pantalla nueva debe seguir; ningún componente
reimplementa estas reglas por su cuenta.

## 1. Regla contable fundamental: Compra vs Gasto

Una **Compra** (`Purchase` + `PurchaseLine`) es la adquisición de un
bien/insumo con existencia (alimento, alevines, medicina, material,
equipamiento, u otro insumo tangible). Cuando la línea es de alimento,
genera además un `FeedInventoryMovement` tipo `PURCHASE`: el inventario
sube exactamente lo que entra.

Un **Gasto** (`Expense`) es un costo que **no** representa la
adquisición de un bien con existencia — combustible, electricidad,
mano de obra, transporte, mantenimiento, construcción, herramientas,
equipamiento consumido, medicina aplicada sin compra separada,
servicios, u otro. Un gasto **nunca** duplica una compra ya registrada:
comprar 20 sacos de alimento por 3800 Bs se registra **una sola vez**,
como `Purchase` (con su `PurchaseLine` e inventario) — nunca además
como `Expense` de 3800 Bs. La suma de "costos del período" de una
finca es siempre `Σ Purchase.totalAmount + Σ Expense.totalAmount`,
nunca su duplicado, porque cada concepto económico vive en una sola de
las dos tablas.

Esto también resuelve `FishBatch.fryCost`: es un campo **descriptivo**
del lote (snapshot que la persona ingresó al crear el lote, útil
cuando no se quiere registrar una Compra/Gasto de alevines por
separado). Si el costo de alevines de un lote SÍ se registra como una
`Purchase`/`Expense` explícita, `fryCost` debe dejarse en 0/null para
no sumarlo dos veces — el sistema no lo detecta automáticamente
(limitación documentada, ver §12).

## 2. Moneda

Configurable vía `FarmSettings` (singleton, `id = "default"`,
`currencyCode`/`currencySymbol`, por defecto `"BOB"`/`"Bs"`) — ver
`src/lib/db/repositories/settingsRepository.ts`. Ninguna función de
dominio ni componente de UI hardcodea `"Bs"`; todo el formato de
dinero pasa por `formatMoney` (`src/lib/domain/money.ts`), que recibe
el símbolo como parámetro.

## 3. Precisión monetaria

- **Servidor/PostgreSQL**: todos los montos son `Decimal` en Prisma
  (`@db.Decimal(12,2)` para totales, `@db.Decimal(12,4)` para precios
  unitarios) — nunca `Float`.
- **Cliente**: los montos se guardan como `number` sin formato (igual
  que kg o cantidad de peces en el resto del dominio) y se redondean a
  2 decimales solo en dos puntos: `roundMoney` (justo antes de guardar
  un monto derivado de una multiplicación, p. ej. `cantidad × precio`)
  y `formatMoney` (al mostrarlo). Ningún componente de React llama a
  `toLocaleString` con opciones de moneda por su cuenta — eso
  produciría inconsistencias de redondeo dispersas (§3 del encargo).

## 4. Costo de inventario de alimento: promedio ponderado histórico

El costo de un alimento consumido **nunca** se calcula con el precio
*actual* del catálogo (`Feed.defaultCostPerKg`) — eso reescribiría
retroactivamente el costo de alimentaciones ya registradas cada vez
que cambia un precio. En su lugar (`src/lib/domain/feedCost.ts`) se
deriva del historial completo de `FeedInventoryMovement` de ese
alimento, recorrido en orden cronológico:

- Cada **entrada** (`PURCHASE`, `INITIAL_STOCK`, `ADJUSTMENT_IN`,
  `RETURN`) con costo conocido suma su cantidad y su valor
  (`cantidad × costo unitario`) al inventario. Una entrada sin costo
  conocido (dato legado) suma cantidad pero no valor — nunca se
  inventa un precio.
- Cada **salida** (`CONSUMPTION`, `ADJUSTMENT_OUT`, `LOSS`) se valora
  al costo promedio (`valor total / stock`) **de ese momento**, y esa
  salida en sí misma nunca mueve el promedio — solo las compras
  siguientes lo hacen.

**Ejemplo obligatorio del encargo (§16)**: Compra A 100 kg × 6 Bs/kg =
600 Bs; Compra B 100 kg × 8 Bs/kg = 800 Bs → stock 200 kg, valor 1400
Bs, promedio 7 Bs/kg. Un consumo de 20 kg cuesta `20 × 7 = 140 Bs`. El
promedio **después** de ese consumo sigue siendo 7 Bs/kg (`1260 Bs /
180 kg`) — no cambia hasta la próxima compra. Ver
`src/lib/domain/__tests__/feedCost.test.ts`.

Por qué derivar en vez de guardar un snapshot: el resultado es
determinista y reproducible desde el propio ledger de inventario que
ya se sincroniza — evita añadir campos de costo a `FeedingRecord`/
`FeedInventoryMovement` (que hoy los tienen en `null` para consumo,
heredado de la Fase 3) o tocar el protocolo de sync de
`RegisterFeeding` de la Fase 3.5. La alternativa (guardar un costo
auditado al momento de cada consumo) es válida y está permitida por el
encargo (§15) pero no es la que se implementó — se documenta aquí como
limitación consciente: si en el futuro se quiere una foto congelada
del costo exacto que existía el día de un consumo específico (en vez
de recalcularlo siempre desde el historial completo), haría falta
guardar ese snapshot en el propio movimiento.

## 5. Costos de un lote: `getBatchEconomics`

Función central única (`src/lib/domain/batchEconomics.ts`) — ningún
reporte suma estos conceptos por su cuenta. Costos **directos**:

1. **Alevines** (`FishBatch.fryCost`, snapshot descriptivo — §1).
2. **Alimento consumido**, valorado contra el ledger histórico de cada
   alimento usado por el lote (§4), nunca contra el precio actual.
3. **Gastos directos**: `Expense` con `batchId` = este lote.
4. Ningún otro costo se suma salvo que esté explícitamente asignado.

Los **gastos generales** (`Expense` sin `batchId` ni `pondId`, o solo
con `pondId` — p. ej. electricidad de toda la finca) **nunca** se
reparten automáticamente entre lotes: esta fase no implementa ninguna
política de distribución (§18 del encargo). Se muestran aparte, en
`/economia`, como "Gastos generales no asignados".

## 6. Producción cosechada

Por lote: peces cosechados y kg cosechados (suma histórica de todos
los `Harvest`, parciales y totales — `getBatchHarvestedFishTotal`/
`getBatchHarvestedWeightKgTotal` en `src/lib/domain/batchLedger.ts`),
independiente de en qué estanque ocurrió cada cosecha y nunca afectado
por mortalidad/traslados posteriores.

## 7. Costo por kg / por pez producido

`costo/kg = costos directos / kg cosechados`. Sin producción cosechada
todavía, el resultado es `null` ("Datos insuficientes" en la UI) —
**nunca** `Infinity`. Igual criterio para costo/pez (opcional,
`costos directos / peces cosechados`).

## 8. Ingresos

`ingresos = Σ SaleLine.totalAmount` de las líneas de venta con
`batchId` = ese lote. **Nunca** se suma la cosecha como ingreso —
cosechar es producción, vender es ingreso; pueden ocurrir en momentos
distintos y por cantidades distintas (§29 del encargo: 500 kg
cosechados hoy, 200 kg vendidos hoy y 300 kg mañana son dos eventos
separados).

## 9. Ganancia y margen

`ganancia = ingresos - costos directos`. `margen % = ganancia /
ingresos × 100`, `null` si no hay ingresos todavía (nunca división por
cero). Ejemplo completo verificado (§40 del encargo, ver
`src/lib/domain/__tests__/batchEconomics.test.ts`): alevines 2500 Bs +
alimento 18000 Bs + otros gastos directos 4000 Bs = costo directo
24500 Bs; producción 1200 kg → costo/kg 20,42 Bs; ventas 1200 kg × 32
Bs/kg = 38400 Bs; ganancia 13900 Bs; margen 36,2 %.

## 10. Provisional vs definitivo

Mientras un lote siga teniendo peces vivos en cualquier estanque
(derivado del ledger — nunca de un campo de estado guardado, mismo
criterio que el resto del dominio productivo), su rentabilidad se
muestra explícitamente como **"Rentabilidad provisional"**, nunca como
un resultado final — puede seguir acumulando costos de alimento y
generando más cosechas/ventas. Un lote se considera efectivamente
cerrado, para efectos de reporte, cuando ya no le quedan peces vivos Y
tiene al menos una cosecha registrada (ver `/economia`, "Margen por
lotes cerrados").

## 11. Estado de pago

`Purchase`/`Sale` llevan `paymentStatus` (`PENDING`/`PARTIAL`/`PAID`) y
`amountPaid`; `amountOutstanding` se deriva siempre como `max(0,
totalAmount - amountPaid)`, nunca se guarda. Esto es deliberadamente
mínimo — no hay un módulo de cuentas por cobrar/pagar (§59, §76).

## 12. Correcciones y anulaciones — limitaciones conocidas

- `Purchase`/`Sale`: la UI nunca permite reeditar fecha, proveedor/
  cliente o líneas de una que ya se confirmó — la única mutación
  permitida es su estado de pago (versión LWW, igual mecanismo que
  Species/Pond/Feed/Task). Revertir una compra o venta ya sincronizada
  por error requiere una corrección manual futura (documento de
  reversión) que esta fase no implementa.
- `Expense`: se puede **anular** (`voidExpense`) — queda con
  `deletedAt` + `voidReason` obligatorio, nunca se borra físicamente
  un gasto ya sincronizado. Solo un registro todavía pendiente de
  sincronizar podría eliminarse de verdad localmente, y esta fase no
  expone esa acción en la UI (§58 del encargo).
- `FishBatch.fryCost` vs una `Purchase`/`Expense` explícita de
  alevines: el sistema no detecta ni previene automáticamente que
  ambos se registren para el mismo lote — es responsabilidad de quien
  opera la finca elegir una sola fuente por lote (documentado en §1).
- El costeo de alimento (§4) es histórico global por alimento, no por
  lote: si dos lotes consumen el mismo alimento, cada consumo se
  valora contra el promedio ponderado del alimento en ESE momento,
  compartido entre lotes — es el comportamiento correcto y esperado de
  un costeo por promedio ponderado, pero significa que el costo de
  alimento de un lote puede cambiar según cuándo consumió respecto a
  otros lotes, nunca según cuándo se generó el reporte.

## 13. Explícitamente fuera de alcance (§76 del encargo)

Contabilidad fiscal, facturación electrónica, impuestos, integración
bancaria, nómina, sensores, IA, tratamiento sanitario, reproducción,
múltiples fincas, o un ERP completo.
