import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { inRange } from '../domain/dates'
import { cashFlow, LEDGER_LABEL } from '../domain/finance'
import { formatMXN } from '../domain/money'
import type { LedgerEntry } from '../domain/types'
import { fmtDate, fmtDateTime, type Data } from '../ui/data'
import { useOpen } from '../ui/create'
import { PeriodPicker } from '../ui/money/common'
import { initPer, lastCounted, ledgerOrigin, methodName, openSessionOf, rangeOf, rangeText, sessionExpectedLive, type PerState, useUserNames } from '../ui/money/helpers'
import { useCtx } from '../ui/session'
import { Badge, Chips, DataTable, Empty, Seg, Stat } from '../ui/ui'

type Tab = 'mov' | 'flujo' | 'ses' | 'conc'
type AccFilter = 'todas' | 'caja' | 'banco'
const OPS = ['cobro_cliente', 'reembolso_cliente', 'pago_gasto', 'pago_proveedor', 'reembolso_proveedor', 'otro_ingreso', 'otro_egreso']
const FIN = ['aportacion_dueno', 'retiro_dueno', 'prestamo_recibido', 'pago_prestamo']
const signed = (l: LedgerEntry) => (l.direction === 'in' ? l.amountCents : -l.amountCents)

/** Marca de conciliación: informativa y local de este dispositivo (no hay integración bancaria). */
function useRecon(orgId: string): [Set<string>, (id: string) => void] {
  const key = `torque.recon.${orgId}`
  const [set, setSet] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]) } catch { return new Set() } })
  const toggle = (id: string) => setSet((cur) => {
    const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id)
    try { localStorage.setItem(key, JSON.stringify([...n])) } catch { /* sin almacenamiento */ }
    return n
  })
  return [set, toggle]
}

export function Caja({ data }: { data: Data }) {
  const ctx = useCtx(), open = useOpen(), nav = useNavigate()
  const userName = useUserNames()
  const sess = openSessionOf(data)
  const [tab, setTab] = useState<Tab>('mov')
  const [per, setPer] = useState<PerState>(() => initPer('hoy', data.today))
  const [acc, setAcc] = useState<AccFilter>('todas')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [recon, toggleRecon] = useRecon(ctx.orgId)
  const range = useMemo(() => rangeOf(per, data.today), [per, data.today])

  const bal = useMemo(() => {
    const b = { caja: 0, banco: 0 }
    for (const l of data.ledger) b[l.account] += signed(l)
    return b
  }, [data.ledger])
  const sessRows = useMemo(() => (sess ? data.ledger.filter((l) => l.sessionId === sess.id && l.account === 'caja') : []), [sess, data.ledger])
  const expected = sess ? sessionExpectedLive(sess, data.ledger) : 0

  const inPeriod = useMemo(() => data.ledger.filter((l) => inRange(l.date, range)), [data.ledger, range])
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return inPeriod.filter((l) => (acc === 'todas' || l.account === acc) && (!kind || l.kind === kind) && (!t || (l.note + ' ' + l.reference).toLowerCase().includes(t))).sort((a, b) => b.at.localeCompare(a.at))
  }, [inPeriod, acc, kind, q])
  const kindsPresent = useMemo(() => [...new Set(data.ledger.map((l) => l.kind))], [data.ledger])
  const cf = useMemo(() => cashFlow(data.ledger, range), [data.ledger, range])
  const closed = useMemo(() => data.cashSessions.filter((s) => s.status === 'cerrada').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')), [data.cashSessions])
  const bankRows = useMemo(() => inPeriod.filter((l) => l.account === 'banco').sort((a, b) => b.at.localeCompare(a.at)), [inPeriod])

  const canOp = data.can('caja.operar'), canClose = data.can('caja.cerrar')
  const sumKinds = (arr: { kind: string; cents: number }[], kinds: string[]) => arr.filter((x) => kinds.includes(x.kind)).reduce((a, x) => a + x.cents, 0)
  const opIn = sumKinds(cf.inflows, OPS), opOut = sumKinds(cf.outflows, OPS)
  const finIn = sumKinds(cf.inflows, FIN), finOut = sumKinds(cf.outflows, FIN)
  const xIn = sumKinds(cf.inflows, ['transferencia_entrada']), xOut = sumKinds(cf.outflows, ['transferencia_salida'])
  const kindLines = (kinds: string[]) => kinds.map((k) => ({ k, i: cf.inflows.find((x) => x.kind === k)?.cents ?? 0, o: cf.outflows.find((x) => x.kind === k)?.cents ?? 0 })).filter((x) => x.i || x.o)
  const reconDone = bankRows.filter((l) => recon.has(l.id)).length

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Caja y dinero</h1><div className="sub">Entradas y salidas reales de efectivo y banco. No es lo mismo que ventas ni que utilidad.</div></div>
        <div className="row wrap">
          {canOp && <button className="btn" onClick={() => open({ k: 'cashmove' })}>Movimiento de dinero</button>}
          {sess ? (canClose && <button className="btn primary" onClick={() => open({ k: 'cashclose' })}>Cerrar caja</button>) : (canOp && <button className="btn primary" onClick={() => open({ k: 'cashopen' })}>Abrir caja</button>)}
        </div>
      </div>

      {sess ? (
        <section className="card stack" aria-label="Caja abierta">
          <div className="row between wrap"><div className="row"><Badge tone="ok">Caja abierta</Badge><span className="small muted">Desde {fmtDateTime(sess.openedAt)} · {userName(sess.openedBy)}</span></div></div>
          <div className="row wrap" style={{ alignItems: 'flex-end', gap: 24 }}>
            <div><div className="small muted">Efectivo esperado en caja ahora</div><div className="mny-big num">{formatMXN(expected)}</div></div>
            <div className="small muted">Apertura {formatMXN(sess.openingCents)} + entradas {formatMXN(sessRows.filter((l) => l.direction === 'in').reduce((a, l) => a + l.amountCents, 0))} − salidas {formatMXN(sessRows.filter((l) => l.direction === 'out').reduce((a, l) => a + l.amountCents, 0))} · {sessRows.length} movimiento(s) en efectivo</div>
          </div>
        </section>
      ) : (
        <div className="banner" role="status"><b>La caja está cerrada.</b> Los cobros y pagos en efectivo necesitan una caja abierta{lastCounted(data) > 0 ? `; el último efectivo contado fue ${formatMXN(lastCounted(data))}` : ''}.{canOp && <> <button className="btn small" onClick={() => open({ k: 'cashopen' })}>Abrir caja</button></>}</div>
      )}

      <div className="grid">
        <Stat label="Caja (movimientos en efectivo)" value={formatMXN(bal.caja)} hint="Suma de movimientos, sin el fondo inicial de cada turno" />
        <Stat label="Banco (movimientos)" value={formatMXN(bal.banco)} hint="Tarjeta y transferencias; sin conciliación bancaria" />
      </div>

      <Seg<Tab> value={tab} onChange={setTab} label="Secciones de caja" options={[['mov', 'Movimientos'], ['flujo', 'Flujo del periodo'], ['ses', 'Sesiones de caja'], ['conc', 'Conciliación']]} />
      {(tab === 'mov' || tab === 'flujo' || tab === 'conc') && <PeriodPicker value={per} onChange={setPer} today={data.today} all />}

      {tab === 'mov' && (
        <section className="stack" aria-label="Movimientos">
          <div className="row wrap">
            <div className="grow" style={{ minWidth: 200 }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar concepto o referencia" aria-label="Buscar movimientos" /></div>
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo de movimiento" style={{ width: 'auto', minWidth: 190 }}><option value="">Todos los tipos</option>{kindsPresent.map((k) => <option key={k} value={k}>{LEDGER_LABEL[k] ?? k}</option>)}</select>
          </div>
          <Chips value={acc} onChange={setAcc} options={[['todas', 'Caja y banco'], ['caja', 'Solo caja'], ['banco', 'Solo banco']]} />
          <div className="small muted">{rangeText(per, range)} · {rows.length} movimiento(s) · entradas {formatMXN(rows.filter((l) => l.direction === 'in').reduce((a, l) => a + l.amountCents, 0))} · salidas {formatMXN(rows.filter((l) => l.direction === 'out').reduce((a, l) => a + l.amountCents, 0))}</div>
          <DataTable
            rows={rows} rowKey={(l) => l.id} onRow={(l) => { const o = ledgerOrigin(l, data); if (o?.to) nav(o.to) }}
            empty={<Empty title="Sin movimientos" text={data.ledger.length === 0 ? 'Aún no hay movimientos de dinero. Se crean al cobrar, pagar gastos o proveedores, o con un movimiento manual.' : 'No hay movimientos con estos filtros en el periodo.'} />}
            columns={[
              { key: 'k', label: 'Tipo', primary: true, render: (l) => <span>{LEDGER_LABEL[l.kind] ?? l.kind}{l.reversalOf && <span className="small muted"> · anula otro movimiento</span>}</span> },
              { key: 'd', label: 'Fecha', render: (l) => fmtDateTime(l.at) },
              { key: 'n', label: 'Concepto', render: (l) => l.note || '—' },
              { key: 'm', label: 'Método', render: (l) => `${methodName(data, l.methodId)} · ${l.account === 'caja' ? 'caja' : 'banco'}` },
              { key: 'r', label: 'Referencia', hideMobile: true, render: (l) => l.reference || '—' },
              { key: 'u', label: 'Usuario', hideMobile: true, render: (l) => userName(l.userId) },
              { key: 'o', label: 'Origen', render: (l) => ledgerOrigin(l, data)?.label ?? '—' },
              { key: 'a', label: 'Importe', align: 'r', render: (l) => <b className={l.direction === 'in' ? 'pos' : 'neg'}>{l.direction === 'in' ? '+' : '−'} {formatMXN(l.amountCents)}</b> },
            ]}
          />
        </section>
      )}

      {tab === 'flujo' && (
        <section className="stack" aria-label="Flujo del periodo">
          <div className="grid">
            <Stat label="Entradas operativas" value={formatMXN(opIn)} hint="Cobros y otros ingresos" />
            <Stat label="Salidas operativas" value={formatMXN(opOut)} hint="Gastos, proveedores y reembolsos" />
            <Stat label="Flujo operativo neto" value={formatMXN(opIn - opOut)} tone={opIn - opOut < 0 ? 'bad' : 'ok'} />
            <Stat label="Aportaciones, préstamos y retiros" value={formatMXN(finIn - finOut)} hint="Neto; no es venta ni gasto" />
          </div>
          <div className="card stack">
            <div className="row between"><b>Cobrado a clientes</b><b className="num">{formatMXN(cf.collectedCents)}</b></div>
            <div className="small muted">Cobros menos reembolsos del periodo. Las ventas a crédito no aparecen aquí hasta que se cobran.</div>
          </div>
          <div className="tablewrap"><table className="table">
            <thead><tr><th>Concepto</th><th className="r">Entradas</th><th className="r">Salidas</th></tr></thead>
            <tbody>
              <tr><td colSpan={3}><b>Operación del taller</b></td></tr>
              {kindLines(OPS).map((x) => <tr key={x.k}><td>{LEDGER_LABEL[x.k]}</td><td className="r">{x.i ? formatMXN(x.i) : '—'}</td><td className="r">{x.o ? formatMXN(x.o) : '—'}</td></tr>)}
              {kindLines(OPS).length === 0 && <tr><td colSpan={3} className="muted">Sin movimientos operativos en el periodo.</td></tr>}
              <tr><td colSpan={3}><b>Aportaciones, préstamos y retiros del propietario</b> <span className="small muted">(no operativos)</span></td></tr>
              {kindLines(FIN).map((x) => <tr key={x.k}><td>{LEDGER_LABEL[x.k]}</td><td className="r">{x.i ? formatMXN(x.i) : '—'}</td><td className="r">{x.o ? formatMXN(x.o) : '—'}</td></tr>)}
              {kindLines(FIN).length === 0 && <tr><td colSpan={3} className="muted">Sin movimientos no operativos en el periodo.</td></tr>}
              {(xIn > 0 || xOut > 0) && <><tr><td colSpan={3}><b>Transferencias entre caja y banco</b> <span className="small muted">(no cambian el total)</span></td></tr>
                <tr><td>Transferencias</td><td className="r">{formatMXN(xIn)}</td><td className="r">{formatMXN(xOut)}</td></tr></>}
            </tbody>
            <tfoot><tr><td>Total del periodo (variación neta: {formatMXN(cf.netCents)})</td><td className="r">{formatMXN(cf.inCents)}</td><td className="r">{formatMXN(cf.outCents)}</td></tr></tfoot>
          </table></div>
          <div className="grid2">
            <div className="card"><div className="small muted">Variación en caja (efectivo)</div><b className="num">{formatMXN(cf.byAccount.caja)}</b></div>
            <div className="card"><div className="small muted">Variación en banco</div><b className="num">{formatMXN(cf.byAccount.banco)}</b></div>
          </div>
          <div className="small muted">El flujo de efectivo mide dinero que entra y sale; la utilidad mide lo vendido menos lo que costó. Pueden diferir mucho: por ejemplo, una venta a crédito tiene utilidad pero no flujo, y un retiro del propietario tiene flujo pero no es gasto.</div>
        </section>
      )}

      {tab === 'ses' && (
        <section className="stack" aria-label="Historial de sesiones">
          <h2>Sesiones cerradas</h2>
          <DataTable
            rows={closed} rowKey={(s) => s.id}
            empty={<Empty title="Aún no hay cierres de caja" text="Cuando cierres una caja aparecerá aquí con lo esperado, lo contado y la diferencia." />}
            columns={[
              { key: 'a', label: 'Apertura', primary: true, render: (s) => `${fmtDateTime(s.openedAt)} · ${userName(s.openedBy)}` },
              { key: 'c', label: 'Cierre', render: (s) => `${fmtDateTime(s.closedAt)} · ${userName(s.closedBy)}` },
              { key: 'f', label: 'Fondo inicial', align: 'r', hideMobile: true, render: (s) => formatMXN(s.openingCents) },
              { key: 'e', label: 'Esperado', align: 'r', render: (s) => formatMXN(s.expectedCents ?? 0) },
              { key: 'n', label: 'Contado', align: 'r', render: (s) => formatMXN(s.countedCents ?? 0) },
              { key: 'd', label: 'Diferencia', align: 'r', render: (s) => { const d = s.differenceCents ?? 0; return d === 0 ? <Badge tone="ok">Sin diferencia</Badge> : <Badge tone="bad">{d > 0 ? 'Sobrante' : 'Faltante'} {formatMXN(Math.abs(d))}</Badge> } },
              { key: 'm', label: 'Motivo', render: (s) => s.note || '—' },
            ]}
          />
        </section>
      )}

      {tab === 'conc' && (
        <section className="stack" aria-label="Conciliación bancaria">
          <div className="banner info">Marca manual para revisar que cada movimiento de banco aparezca en tu estado de cuenta. Es solo informativa, no hay conexión con el banco, y se guarda únicamente en este dispositivo.</div>
          <div className="small muted">{rangeText(per, range)} · {bankRows.length} movimiento(s) bancario(s) · {reconDone} conciliado(s) · {bankRows.length - reconDone} pendiente(s)</div>
          {bankRows.length === 0 ? <Empty title="Sin movimientos bancarios" text="No hay cobros ni pagos por tarjeta o transferencia en este periodo." /> : (
            <div className="stack-sm">{bankRows.map((l) => (
              <div key={l.id} className="mny-check">
                <label>
                  <input type="checkbox" checked={recon.has(l.id)} onChange={() => toggleRecon(l.id)} aria-label={`Conciliado: ${LEDGER_LABEL[l.kind] ?? l.kind} ${formatMXN(l.amountCents)} del ${fmtDate(l.date)}`} />
                  <span className="grow"><b>{LEDGER_LABEL[l.kind] ?? l.kind}</b> · {methodName(data, l.methodId)}<span className="small muted" style={{ display: 'block' }}>{fmtDate(l.date)}{l.note ? ` · ${l.note}` : ''}{l.reference ? ` · ref. ${l.reference}` : ''}</span></span>
                </label>
                <b className={`num ${l.direction === 'in' ? 'pos' : 'neg'}`}>{l.direction === 'in' ? '+' : '−'} {formatMXN(l.amountCents)}</b>
              </div>
            ))}</div>
          )}
        </section>
      )}
    </div>
  )
}
