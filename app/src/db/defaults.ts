import type { ExpenseCategory, Settings } from '../domain/types'

export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: 'renta', name: 'Renta', kind: 'operativo', allocate: true },
  { id: 'electricidad', name: 'Electricidad', kind: 'operativo', allocate: true },
  { id: 'agua', name: 'Agua', kind: 'operativo', allocate: true },
  { id: 'internet', name: 'Internet y teléfono', kind: 'operativo', allocate: true },
  { id: 'nomina_admin', name: 'Nómina administrativa', kind: 'operativo', allocate: true },
  { id: 'nomina_mecanicos', name: 'Nómina de mecánicos', kind: 'mano_obra_directa', allocate: false },
  { id: 'prestaciones', name: 'Prestaciones', kind: 'operativo', allocate: true },
  { id: 'publicidad', name: 'Publicidad', kind: 'operativo', allocate: false },
  { id: 'limpieza', name: 'Limpieza', kind: 'operativo', allocate: true },
  { id: 'combustible', name: 'Combustible', kind: 'operativo', allocate: false },
  { id: 'herramientas', name: 'Herramientas', kind: 'operativo', allocate: true },
  { id: 'mantenimiento', name: 'Mantenimiento del local', kind: 'operativo', allocate: true },
  { id: 'seguros', name: 'Seguros', kind: 'operativo', allocate: true },
  { id: 'software', name: 'Software', kind: 'operativo', allocate: true },
  { id: 'profesionales', name: 'Servicios profesionales', kind: 'operativo', allocate: false },
  { id: 'comisiones', name: 'Comisiones bancarias', kind: 'operativo', allocate: false },
  { id: 'administrativos', name: 'Gastos administrativos', kind: 'operativo', allocate: true },
  { id: 'otros', name: 'Otros gastos', kind: 'operativo', allocate: false },
]

export function defaultSettings(orgId: string, businessName: string, now: string): Settings {
  return {
    id: 'main', orgId, createdAt: now, updatedAt: now,
    businessName, legalName: '', taxId: '', address: '', phone: '', email: '',
    currency: 'MXN', timezone: 'America/Mexico_City', locale: 'es-MX',
    // Valores iniciales editables. Verifica las tasas y el tratamiento fiscal de tus productos y servicios con tu contador.
    taxes: [{ id: 'iva16', name: 'IVA 16 %', rate: 16 }, { id: 'iva0', name: 'IVA 0 %', rate: 0 }, { id: 'exento', name: 'Exento', rate: 0 }],
    defaultTaxId: 'iva16', pricesIncludeTax: false,
    targetMarginPct: 35, minMarginPct: 15,
    counters: { orden: 1, cotizacion: 1, venta: 1, compra: 1, recepcion: 1 },
    prefixes: { orden: 'OT', cotizacion: 'COT', venta: 'VTA', compra: 'OC', recepcion: 'REC' },
    labor: { productiveHoursPerMonth: 140, loadPct: 30, defaultRateCents: 45000 },
    overheadMethod: 'ninguno', requireAuthorization: true,
    warrantyDays: 30, warrantyText: 'Garantía sobre la mano de obra y las refacciones instaladas, sujeta a uso normal del vehículo y a que no haya intervención de terceros.',
    quoteValidDays: 15, quoteTerms: 'Precios sujetos a cambio sin previo aviso después de la vigencia. Trabajos adicionales requieren autorización previa del cliente.',
    showCostsInQuote: false,
    paymentMethods: [{ id: 'efectivo', name: 'Efectivo', account: 'caja' }, { id: 'tarjeta', name: 'Tarjeta', account: 'banco' }, { id: 'transferencia', name: 'Transferencia', account: 'banco' }],
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    productCategories: ['Aceites y lubricantes', 'Filtros', 'Frenos', 'Suspensión y dirección', 'Motor', 'Eléctrico', 'Baterías', 'Llantas', 'Líquidos', 'Consumibles de taller', 'Otros'],
    serviceCategories: ['Mantenimiento', 'Frenos', 'Suspensión y dirección', 'Motor', 'Eléctrico', 'Diagnóstico', 'Alineación y balanceo', 'Aire acondicionado', 'Transmisión', 'Otros'],
    units: ['pza', 'litro', 'juego', 'kit', 'metro', 'kg', 'servicio'],
    lowStockDefault: 2, onboardingDone: false, schemaVersion: 1,
  }
}
