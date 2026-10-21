// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const sql = (f: string) => fs.readFileSync(new URL(`../../server/${f}`, import.meta.url), 'utf8')
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b'
const id = (u: string, n: number) => (u === A ? 'a' : 'b') + u.slice(1, 35) + n // uuid determinista, distinto por usuario
let db: PGlite
let orgA = '', orgB = ''

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`)
  try { return await fn() } finally { await db.exec('reset role') }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } })
  await db.exec(`create role authenticated nologin; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`)
  await db.exec(sql('001_schema.sql')); await db.exec(sql('002_permissions.sql'))
  orgA = await as(A, async () => (await db.query<{ id: string }>('select app.create_organization($1) as id', ['Taller A'])).rows[0].id)
  orgB = await as(B, async () => (await db.query<{ id: string }>('select app.create_organization($1) as id', ['Taller B'])).rows[0].id)
  for (const [u, org] of [[A, orgA], [B, orgB]] as const) {
    await as(u, () => db.exec(`
      insert into customers (org_id, id, name) values ('${org}', '${id(u, 1)}', 'Cliente de ${u === A ? 'A' : 'B'}');
      insert into warehouses (org_id, id, name, is_default) values ('${org}', '${id(u, 2)}', 'Principal', true);
      insert into products (org_id, id, sku, name) values ('${org}', '${id(u, 3)}', 'F-1', 'Filtro');`))
  }
}, 60000)

describe('Esquema de servidor (PostgreSQL)', () => {
  it('aísla las filas por organización (RLS)', async () => {
    const mine = await as(A, () => db.query<{ name: string }>('select name from customers'))
    expect(mine.rows.map((r) => r.name)).toEqual(['Cliente de A'])
    await expect(as(A, () => db.exec(`insert into customers (org_id, name) values ('${orgB}', 'Intruso')`))).rejects.toThrow(/row-level security/)
    const upd = await as(A, () => db.query(`update customers set name = 'x' where org_id = '${orgB}' returning id`))
    expect(upd.rows).toHaveLength(0)
  })
  it('una clave foránea no puede cruzar organizaciones', async () => {
    await expect(db.exec(`insert into vehicles (org_id, customer_id, make, model, plate) values ('${orgA}', '${id(B, 1)}', 'X', 'Y', 'ZZ1')`)).rejects.toThrow(/foreign key/)
  })
  it('los permisos por rol se aplican en la base (un mecánico ve pero no crea clientes)', async () => {
    const M = '00000000-0000-0000-0000-0000000000c1'
    await as(A, () => db.exec(`insert into org_members (org_id, user_id, role) values ('${orgA}', '${M}', 'mecanico')`))
    await expect(as(M, () => db.exec(`insert into customers (org_id, name) values ('${orgA}', 'No debería')`))).rejects.toThrow(/row-level security/)
    const r = await as(M, () => db.query<{ n: number }>('select count(*)::int as n from customers'))
    expect(r.rows[0].n).toBe(1)
    await expect(as(M, () => db.exec(`update org_members set role = 'propietario' where user_id = '${M}'`)).then(async () => (await db.query<{ role: string }>(`select role from org_members where user_id = '${M}'`)).rows[0].role)).resolves.toBe('mecanico')
  }, 20000)
  it('inventario: costo promedio, sin existencias negativas e idempotencia', async () => {
    const [p, w] = [id(A, 3), id(A, 2)]
    await as(A, async () => {
      await db.query('select app.stock_in($1,$2,$3,10,100000,$4)', [orgA, p, w, 'compra'])
      await db.query('select app.stock_in($1,$2,$3,10,140000,$4,$5,$6,$7,$8)', [orgA, p, w, 'compra', '', '', '', 'k1'])
      await db.query('select app.stock_in($1,$2,$3,10,140000,$4,$5,$6,$7,$8)', [orgA, p, w, 'compra', '', '', '', 'k1'])
      await db.query('select app.stock_out($1,$2,$3,5,$4)', [orgA, p, w, 'venta'])
    })
    const b = (await db.query<{ qty: string; value_cents: string }>(`select qty, value_cents from inventory_balances where org_id = '${orgA}'`)).rows[0]
    expect([Number(b.qty), Number(b.value_cents)]).toEqual([15, 180000])
    await expect(as(A, () => db.query('select app.stock_out($1,$2,$3,99,$4)', [orgA, p, w, 'venta']))).rejects.toThrow(/Inventario insuficiente/)
  })
  it('historial inmutable', async () => {
    await expect(db.exec(`update inventory_movements set reason = 'x'`)).rejects.toThrow(/no se pueden modificar/)
    await expect(db.exec('delete from inventory_movements')).rejects.toThrow(/no se pueden modificar/)
  })
  it('cobros: no superan el saldo y son idempotentes', async () => {
    await db.exec(`
      insert into sales (org_id, id, folio, kind, status, customer_id, customer_name, date, due_date, net_cents, tax_cents, total_cents) values ('${orgA}', '${id(A, 4)}', 'V-1', 'mostrador', 'emitida', '${id(A, 1)}', 'C', current_date, current_date, 10000, 1600, 11600);
      insert into cash_sessions (org_id, id, status, opening_cents) values ('${orgA}', '${id(A, 5)}', 'abierta', 0);`)
    const ins = (amt: number, key: string) => `insert into ledger_entries (org_id, kind, direction, amount_cents, date, method, account, sale_id, session_id, op_key) values ('${orgA}', 'cobro_cliente', 'in', ${amt}, current_date, 'efectivo', 'caja', '${id(A, 4)}', '${id(A, 5)}', '${key}')`
    await as(A, () => db.exec(ins(5000, 'p1')))
    await expect(db.exec(ins(5000, 'p1'))).rejects.toThrow(/duplicate key/)
    await expect(db.exec(ins(7000, 'p2'))).rejects.toThrow(/supera el saldo/)
    await db.exec(ins(6600, 'p3'))
    expect(Number((await db.query<{ balance_cents: string }>('select balance_cents from v_receivables')).rows[0].balance_cents)).toBe(0)
  })
  it('un mecánico no tiene tramos de trabajo ni citas traslapadas', async () => {
    const e = id(A, 6), wo = id(A, 7)
    await db.exec(`
      insert into employees (org_id, id, name) values ('${orgA}', '${e}', 'Mec');
      insert into vehicles (org_id, id, customer_id, make, model, plate) values ('${orgA}', '${id(A, 8)}', '${id(A, 1)}', 'N', 'V', 'P1');
      insert into work_orders (org_id, id, folio, customer_id, vehicle_id, status, complaint) values ('${orgA}', '${wo}', 'OT-1', '${id(A, 1)}', '${id(A, 8)}', 'en_reparacion', 'x');
      insert into work_order_time_entries (org_id, work_order_id, employee_id, kind, start_at, end_at) values ('${orgA}', '${wo}', '${e}', 'trabajo', '2026-03-10T10:00Z', '2026-03-10T11:00Z');`)
    await expect(db.exec(`insert into work_order_time_entries (org_id, work_order_id, employee_id, kind, start_at, end_at) values ('${orgA}', '${wo}', '${e}', 'trabajo', '2026-03-10T10:30Z', '2026-03-10T11:30Z')`)).rejects.toThrow(/work_no_overlap/)
    const appt = (s: string) => `insert into appointments (org_id, customer_id, mechanic_id, start_at, duration_min, reason, status) values ('${orgA}', '${id(A, 1)}', '${e}', '${s}', 60, 'a', 'confirmada')`
    await db.exec(appt('2026-03-11T10:00Z'))
    await expect(db.exec(appt('2026-03-11T10:30Z'))).rejects.toThrow(/double_booking/)
  })
  it('los permisos del SQL coinciden con los de la app', async () => {
    const { ROLE_PERMISSIONS } = await import('../domain/permissions')
    const n = (await db.query<{ n: number }>('select count(*)::int as n from role_permissions')).rows[0].n
    expect(n).toBe(Object.values(ROLE_PERMISSIONS).reduce((a, p) => a + p.length, 0))
  })
})
