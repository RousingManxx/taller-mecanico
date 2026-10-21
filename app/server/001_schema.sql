-- Torque — modelo relacional de servidor (PostgreSQL 15+; probado en PostgreSQL 18 con PGlite).
-- ESTADO: propuesta validada con pruebas (src/tests/server-schema.test.ts). La aplicación actual funciona 100 % local
-- (IndexedDB) y NO está conectada a este esquema; sirve como base para una futura sincronización (ver docs/SERVIDOR.md).
--
-- Principios:
--  · Multiempresa: TODA tabla de negocio lleva org_id; las claves foráneas son compuestas (org_id, id) para que un registro
--    nunca pueda referenciar datos de otra organización; RLS aísla las filas por membresía.
--  · Dinero en centavos (bigint). Estados con CHECK. Folios únicos por organización.
--  · Historial inmutable: movimientos de inventario, movimientos de dinero, auditoría y precios no admiten UPDATE/DELETE.
--  · Integridad financiera en la base: inventario ≥ 0, cobros ≤ saldo de la venta, idempotencia por (org_id, op_key).
--  · Requiere auth.uid() (Supabase lo provee) y el rol «authenticated».

create schema if not exists app;
create extension if not exists btree_gist; -- necesaria para las restricciones de exclusión (traslapes)

/* ───────── Organizaciones, membresías y permisos ───────── */
create table organizations (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) > 0), is_demo boolean not null default false, created_at timestamptz not null default now()
);
create table role_permissions (role text not null, permission text not null, primary key (role, permission));
create table org_members (
  org_id uuid not null references organizations (id) on delete cascade, user_id uuid not null,
  role text not null check (role in ('propietario','gerente','recepcion','mecanico','almacen','finanzas')),
  grant_perms text[] not null default '{}', revoke_perms text[] not null default '{}', employee_id uuid, active boolean not null default true,
  primary key (org_id, user_id)
);
create index on org_members (user_id);

create function app.is_member(p_org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid() and m.active)
$$;
create function app.has_perm(p_org uuid, p_perm text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid() and m.active
      and not (p_perm = any (m.revoke_perms))
      and (p_perm = any (m.grant_perms) or exists (select 1 from role_permissions rp where rp.role = m.role and rp.permission = p_perm))
  )
$$;
create function app.has_any_perm(p_org uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(p_perms) p where app.has_perm(p_org, p))
$$;
/* Alta de organización: quien la crea queda como propietario (no hay INSERT directo en organizations). */
create function app.create_organization(p_name text, p_demo boolean default false) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Se requiere un usuario autenticado'; end if;
  insert into organizations (name, is_demo) values (p_name, p_demo) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'propietario');
  return v_org;
end $$;

create table branches (org_id uuid not null references organizations (id) on delete cascade, id uuid not null default gen_random_uuid(), name text not null, is_main boolean not null default false, primary key (org_id, id));
create table settings (org_id uuid primary key references organizations (id) on delete cascade, data jsonb not null default '{}', updated_at timestamptz not null default now());

/* ───────── Clientes, vehículos, personal ───────── */
create table customers (
  org_id uuid not null references organizations (id) on delete cascade, id uuid not null default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0), phone text not null default '', email text not null default '', address text not null default '', tax_id text not null default '',
  contact_pref text not null default 'telefono', notes text not null default '', active boolean not null default true, created_at timestamptz not null default now(),
  primary key (org_id, id)
);
create table vehicles (
  org_id uuid not null, id uuid not null default gen_random_uuid(), customer_id uuid not null, make text not null, model text not null, year int check (year between 1950 and 2100),
  version text not null default '', plate text not null default '', vin text not null default '', km int not null default 0 check (km >= 0), notes text not null default '', active boolean not null default true,
  created_at timestamptz not null default now(), primary key (org_id, id), foreign key (org_id, customer_id) references customers (org_id, id),
  check (plate <> '' or vin <> '')
);
create unique index vehicles_plate_uq on vehicles (org_id, upper(plate)) where plate <> '' and active;
create table employees (
  org_id uuid not null references organizations (id) on delete cascade, id uuid not null default gen_random_uuid(), name text not null, role text not null default '', is_mechanic boolean not null default true,
  monthly_cost_cents bigint not null default 0 check (monthly_cost_cents >= 0), load_pct numeric, productive_hours numeric check (productive_hours > 0), commercial_rate_cents bigint not null default 0 check (commercial_rate_cents >= 0),
  active boolean not null default true, primary key (org_id, id)
);

/* ───────── Catálogo e inventario ───────── */
create table services (
  org_id uuid not null references organizations (id) on delete cascade, id uuid not null default gen_random_uuid(), name text not null, category text not null default 'Otros', std_hours numeric not null default 0 check (std_hours >= 0),
  price_cents bigint not null default 0 check (price_cents >= 0), tax_rate numeric not null default 16 check (tax_rate between 0 and 100), min_margin_pct numeric, active boolean not null default true, primary key (org_id, id)
);
create unique index services_name_uq on services (org_id, lower(name));
create table suppliers (
  org_id uuid not null references organizations (id) on delete cascade, id uuid not null default gen_random_uuid(), name text not null, contact text not null default '', phone text not null default '', email text not null default '',
  payment_terms_days int not null default 0 check (payment_terms_days >= 0), lead_days int not null default 0 check (lead_days >= 0), active boolean not null default true, primary key (org_id, id)
);
create table products (
  org_id uuid not null references organizations (id) on delete cascade, id uuid not null default gen_random_uuid(), sku text not null check (length(trim(sku)) > 0), barcode text, name text not null, category text not null default 'Otros',
  brand text not null default '', part_no text not null default '', kind text not null default 'refaccion' check (kind in ('refaccion','consumible')), unit text not null default 'pza', supplier_id uuid,
  price_cents bigint not null default 0 check (price_cents >= 0), tax_rate numeric not null default 16 check (tax_rate between 0 and 100), min_stock numeric not null default 0 check (min_stock >= 0),
  location text not null default '', min_margin_pct numeric, last_purchase_cost numeric, prev_purchase_cost numeric, active boolean not null default true,
  primary key (org_id, id), foreign key (org_id, supplier_id) references suppliers (org_id, id)
);
create unique index products_sku_uq on products (org_id, upper(sku));
create unique index products_barcode_uq on products (org_id, barcode) where barcode is not null and barcode <> '';
create table warehouses (org_id uuid not null references organizations (id) on delete cascade, id uuid not null default gen_random_uuid(), name text not null, is_default boolean not null default false, primary key (org_id, id));
create table supplier_products (org_id uuid not null, supplier_id uuid not null, product_id uuid not null, supplier_sku text not null default '', last_cost_cents bigint not null check (last_cost_cents >= 0), updated_at timestamptz not null default now(),
  primary key (org_id, supplier_id, product_id), foreign key (org_id, supplier_id) references suppliers (org_id, id), foreign key (org_id, product_id) references products (org_id, id));
/* Saldo: el valor se lleva en centavos enteros; costo promedio = value_cents / qty. Nunca negativo. */
create table inventory_balances (
  org_id uuid not null, product_id uuid not null, warehouse_id uuid not null, qty numeric(14,3) not null default 0 check (qty >= 0), value_cents bigint not null default 0 check (value_cents >= 0),
  primary key (org_id, product_id, warehouse_id), foreign key (org_id, product_id) references products (org_id, id), foreign key (org_id, warehouse_id) references warehouses (org_id, id),
  check (qty > 0 or value_cents = 0)
);
create table inventory_movements (
  org_id uuid not null, id uuid not null default gen_random_uuid(), product_id uuid not null, warehouse_id uuid not null,
  type text not null check (type in ('compra','entrada','venta','consumo_orden','devolucion_cliente','devolucion_orden','ajuste_positivo','ajuste_negativo','merma','traspaso_salida','traspaso_entrada','inventario_fisico','devolucion_proveedor')),
  qty numeric(14,3) not null check (qty <> 0), unit_cost numeric not null, total_cost_cents bigint not null, ref_type text not null default '', ref_id text not null default '', reason text not null default '',
  user_id uuid, at timestamptz not null default now(), reverses uuid, op_key text,
  primary key (org_id, id), foreign key (org_id, product_id) references products (org_id, id), foreign key (org_id, warehouse_id) references warehouses (org_id, id),
  check (sign(qty) = sign(total_cost_cents) or total_cost_cents = 0)
);
create index on inventory_movements (org_id, product_id, at);
create unique index inventory_movements_opkey_uq on inventory_movements (org_id, op_key) where op_key is not null;

/* ───────── Compras ───────── */
create table purchase_orders (
  org_id uuid not null, id uuid not null default gen_random_uuid(), folio text not null, supplier_id uuid not null, status text not null check (status in ('borrador','enviada','parcial','recibida','cancelada')),
  date date not null, expected_date date, freight_cents bigint not null default 0 check (freight_cents >= 0), tax_rate numeric not null default 16, notes text not null default '', cancel_reason text,
  primary key (org_id, id), unique (org_id, folio), foreign key (org_id, supplier_id) references suppliers (org_id, id)
);
create table purchase_order_items (
  org_id uuid not null, id uuid not null default gen_random_uuid(), purchase_order_id uuid not null, product_id uuid not null, qty numeric(14,3) not null check (qty > 0), received_qty numeric(14,3) not null default 0 check (received_qty >= 0),
  unit_cost_cents numeric not null check (unit_cost_cents >= 0), discount_cents bigint not null default 0 check (discount_cents >= 0),
  primary key (org_id, id), foreign key (org_id, purchase_order_id) references purchase_orders (org_id, id) on delete cascade, foreign key (org_id, product_id) references products (org_id, id),
  check (received_qty <= qty)
);
create table purchase_receipts (
  org_id uuid not null, id uuid not null default gen_random_uuid(), folio text not null, purchase_order_id uuid not null, supplier_id uuid not null, date date not null, due_date date not null, invoice_ref text not null default '',
  goods_cents bigint not null check (goods_cents >= 0), freight_cents bigint not null default 0 check (freight_cents >= 0), tax_cents bigint not null default 0 check (tax_cents >= 0), total_cents bigint not null,
  op_key text, primary key (org_id, id), unique (org_id, folio), foreign key (org_id, purchase_order_id) references purchase_orders (org_id, id), foreign key (org_id, supplier_id) references suppliers (org_id, id),
  check (total_cents = goods_cents + freight_cents + tax_cents)
);
create unique index purchase_receipts_opkey_uq on purchase_receipts (org_id, op_key) where op_key is not null;

/* ───────── Órdenes de trabajo ───────── */
create table work_orders (
  org_id uuid not null, id uuid not null default gen_random_uuid(), folio text not null, customer_id uuid not null, vehicle_id uuid not null, mechanic_id uuid, sale_id uuid, warranty_of uuid,
  status text not null check (status in ('borrador','pendiente_autorizacion','autorizada','espera_diagnostico','en_diagnostico','esperando_refacciones','en_reparacion','en_pruebas','lista_entrega','entregada','cancelada')),
  priority text not null default 'normal' check (priority in ('baja','normal','alta','urgente')), is_warranty boolean not null default false,
  received_at timestamptz not null default now(), promised_at timestamptz, delivered_at timestamptz, km int not null default 0, km_out int, complaint text not null, symptoms text not null default '', inspection text not null default '',
  diagnosis text not null default '', damages text not null default '', accessories text not null default '', notes_internal text not null default '', notes_customer text not null default '', cancel_reason text,
  primary key (org_id, id), unique (org_id, folio), foreign key (org_id, customer_id) references customers (org_id, id), foreign key (org_id, vehicle_id) references vehicles (org_id, id), foreign key (org_id, mechanic_id) references employees (org_id, id),
  check (status <> 'cancelada' or cancel_reason is not null), check (status <> 'entregada' or delivered_at is not null)
);
create index on work_orders (org_id, status); create index on work_orders (org_id, vehicle_id);
create table work_order_items (
  org_id uuid not null, id uuid not null default gen_random_uuid(), work_order_id uuid not null, type text not null check (type in ('servicio','refaccion','consumible','externo','otro')), ref_id uuid,
  description text not null, qty numeric(14,3) not null check (qty > 0), unit text not null default 'pza', unit_price_cents bigint not null check (unit_price_cents >= 0), discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_rate numeric not null default 16, status text not null check (status in ('sugerido','cotizado','autorizado','ejecutado','rechazado')), cost_cents bigint not null default 0, consumed_qty numeric(14,3) not null default 0 check (consumed_qty >= 0),
  std_hours numeric not null default 0, mechanic_id uuid, authorized_at timestamptz, authorized_by text,
  primary key (org_id, id), foreign key (org_id, work_order_id) references work_orders (org_id, id) on delete cascade, check (discount_cents <= round(qty * unit_price_cents)), check (consumed_qty <= qty)
);
create table work_order_time_entries (
  org_id uuid not null, id uuid not null default gen_random_uuid(), work_order_id uuid not null, employee_id uuid, item_id uuid, kind text not null check (kind in ('trabajo','espera')), start_at timestamptz not null, end_at timestamptz,
  minutes int not null default 0 check (minutes >= 0), hourly_cost_cents bigint not null default 0, cost_cents bigint not null default 0,
  primary key (org_id, id), foreign key (org_id, work_order_id) references work_orders (org_id, id) on delete cascade, check (end_at is null or end_at >= start_at)
);
/* Un mecánico no puede tener dos tramos de trabajo abiertos ni traslapados: las horas no se cuentan dos veces. */
alter table work_order_time_entries add constraint work_no_overlap exclude using gist (org_id with =, employee_id with =, tstzrange(start_at, coalesce(end_at, 'infinity')) with &&) where (kind = 'trabajo' and employee_id is not null);
create table work_order_authorizations (
  org_id uuid not null, id uuid not null default gen_random_uuid(), work_order_id uuid not null, at timestamptz not null default now(), user_id uuid, approved_by text not null, via text not null, amount_cents bigint not null check (amount_cents >= 0),
  item_ids uuid[] not null default '{}', quotation_id uuid, quotation_version int, notes text not null default '', primary key (org_id, id), foreign key (org_id, work_order_id) references work_orders (org_id, id) on delete cascade
);
create table work_order_status_history (
  org_id uuid not null, id uuid not null default gen_random_uuid(), work_order_id uuid not null, at timestamptz not null default now(), from_status text, to_status text not null, user_id uuid, note text not null default '',
  primary key (org_id, id), foreign key (org_id, work_order_id) references work_orders (org_id, id) on delete cascade
);

/* ───────── Cotizaciones ───────── */
create table quotations (
  org_id uuid not null, id uuid not null default gen_random_uuid(), folio text not null, customer_id uuid not null, vehicle_id uuid not null, status text not null check (status in ('borrador','enviada','vista','aprobada','rechazada','vencida','convertida')),
  issue_date date not null, valid_until date not null, current_version int not null default 1, approved_version int, approved_by text, approved_at timestamptz, work_order_id uuid,
  primary key (org_id, id), unique (org_id, folio), foreign key (org_id, customer_id) references customers (org_id, id), foreign key (org_id, vehicle_id) references vehicles (org_id, id),
  check (valid_until >= issue_date), check (approved_version is null or approved_version <= current_version or status in ('aprobada','convertida'))
);
create table quotation_versions (org_id uuid not null, quotation_id uuid not null, n int not null check (n >= 1), created_at timestamptz not null default now(), notes text not null default '', terms text not null default '', warranty text not null default '', estimated_days int not null default 1,
  primary key (org_id, quotation_id, n), foreign key (org_id, quotation_id) references quotations (org_id, id) on delete cascade);
create table quotation_items (
  org_id uuid not null, id uuid not null default gen_random_uuid(), quotation_id uuid not null, version int not null, type text not null, ref_id uuid, description text not null, qty numeric(14,3) not null check (qty > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0), discount_cents bigint not null default 0 check (discount_cents >= 0), tax_rate numeric not null default 16, est_unit_cost numeric not null default 0,
  primary key (org_id, id), foreign key (org_id, quotation_id, version) references quotation_versions (org_id, quotation_id, n) on delete cascade
);

/* ───────── Ventas, dinero, caja y gastos ───────── */
create table sales (
  org_id uuid not null, id uuid not null default gen_random_uuid(), folio text not null, kind text not null check (kind in ('orden','mostrador')), status text not null check (status in ('emitida','cancelada')), work_order_id uuid, customer_id uuid,
  customer_name text not null, date date not null, due_date date not null, net_cents bigint not null, tax_cents bigint not null, total_cents bigint not null, cost_cents bigint not null default 0, other_cost_cents bigint not null default 0,
  labor_hours numeric not null default 0, cancel_reason text, op_key text, user_id uuid,
  primary key (org_id, id), unique (org_id, folio), foreign key (org_id, customer_id) references customers (org_id, id), foreign key (org_id, work_order_id) references work_orders (org_id, id),
  check (total_cents = net_cents + tax_cents), check (due_date >= date), check (status <> 'cancelada' or cancel_reason is not null)
);
create unique index sales_one_per_order on sales (org_id, work_order_id) where work_order_id is not null and status = 'emitida';
create unique index sales_opkey_uq on sales (org_id, op_key) where op_key is not null;
create table sale_items (
  org_id uuid not null, id uuid not null default gen_random_uuid(), sale_id uuid not null, type text not null, ref_id uuid, description text not null, qty numeric(14,3) not null check (qty > 0), unit_price_cents bigint not null, discount_cents bigint not null default 0,
  tax_rate numeric not null, net_cents bigint not null, tax_cents bigint not null, total_cents bigint not null, cost_cents bigint not null default 0, cost_estimated boolean not null default false, mechanic_id uuid, std_hours numeric not null default 0, hours numeric not null default 0,
  primary key (org_id, id), foreign key (org_id, sale_id) references sales (org_id, id) on delete cascade, check (total_cents = net_cents + tax_cents)
);
create table sale_returns (
  org_id uuid not null, id uuid not null default gen_random_uuid(), sale_id uuid not null, item_id uuid not null, date date not null, qty numeric(14,3) not null check (qty > 0), net_cents bigint not null check (net_cents >= 0), tax_cents bigint not null check (tax_cents >= 0),
  cost_recovered_cents bigint not null default 0, reason text not null, primary key (org_id, id), foreign key (org_id, sale_id) references sales (org_id, id), foreign key (org_id, item_id) references sale_items (org_id, id)
);
create table cash_sessions (
  org_id uuid not null, id uuid not null default gen_random_uuid(), status text not null check (status in ('abierta','cerrada')), opened_at timestamptz not null default now(), opened_by uuid, opening_cents bigint not null check (opening_cents >= 0),
  closed_at timestamptz, closed_by uuid, expected_cents bigint, counted_cents bigint, difference_cents bigint, note text not null default '',
  primary key (org_id, id), check (status = 'abierta' or (counted_cents is not null and expected_cents is not null and (difference_cents = 0 or length(trim(note)) > 0)))
);
create unique index one_open_cash_session on cash_sessions (org_id) where status = 'abierta';
/* Único punto de registro de dinero (cobros, pagos a proveedores, gastos, aportaciones…). Solo se anexa. */
create table ledger_entries (
  org_id uuid not null, id uuid not null default gen_random_uuid(), kind text not null check (kind in ('cobro_cliente','reembolso_cliente','pago_gasto','pago_proveedor','aportacion_dueno','retiro_dueno','prestamo_recibido','pago_prestamo','transferencia_entrada','transferencia_salida','reembolso_proveedor','otro_ingreso','otro_egreso')),
  direction text not null check (direction in ('in','out')), amount_cents bigint not null check (amount_cents > 0), date date not null, at timestamptz not null default now(), method text not null, account text not null check (account in ('caja','banco')),
  reference text not null default '', note text not null default '', user_id uuid, sale_id uuid, work_order_id uuid, customer_id uuid, expense_id uuid, supplier_id uuid, session_id uuid, reversal_of uuid, op_key text,
  primary key (org_id, id), foreign key (org_id, sale_id) references sales (org_id, id), foreign key (org_id, session_id) references cash_sessions (org_id, id),
  check (account <> 'caja' or session_id is not null)
);
create unique index ledger_opkey_uq on ledger_entries (org_id, op_key) where op_key is not null;
create index on ledger_entries (org_id, date);
create table ledger_allocations (org_id uuid not null, ledger_id uuid not null, receipt_id uuid not null, amount_cents bigint not null check (amount_cents > 0),
  primary key (org_id, ledger_id, receipt_id), foreign key (org_id, ledger_id) references ledger_entries (org_id, id), foreign key (org_id, receipt_id) references purchase_receipts (org_id, id));
create table expenses (
  org_id uuid not null, id uuid not null default gen_random_uuid(), concept text not null, category text not null, date date not null, amount_cents bigint not null check (amount_cents > 0), tax_cents bigint not null default 0 check (tax_cents >= 0),
  supplier_id uuid, due_date date, cost_center text not null default '', recurring_key text, cancelled boolean not null default false, primary key (org_id, id), foreign key (org_id, supplier_id) references suppliers (org_id, id),
  check (due_date is null or due_date >= date)
);
create unique index expenses_recurring_uq on expenses (org_id, recurring_key) where recurring_key is not null;
alter table ledger_entries add foreign key (org_id, expense_id) references expenses (org_id, id);
create table recurring_expenses (org_id uuid not null, id uuid not null default gen_random_uuid(), concept text not null, category text not null, amount_cents bigint not null check (amount_cents > 0), tax_cents bigint not null default 0,
  frequency text not null check (frequency in ('mensual','semanal')), day_of_month int check (day_of_month between 1 and 31), start_date date not null, active boolean not null default true, primary key (org_id, id));

/* ───────── Agenda, precios, auditoría, archivos, idempotencia ───────── */
create table appointments (
  org_id uuid not null, id uuid not null default gen_random_uuid(), customer_id uuid not null, vehicle_id uuid, mechanic_id uuid, start_at timestamptz not null, duration_min int not null check (duration_min > 0), reason text not null,
  status text not null check (status in ('solicitada','confirmada','en_recepcion','convertida','completada','cancelada','no_asistio')), work_order_id uuid,
  primary key (org_id, id), foreign key (org_id, customer_id) references customers (org_id, id)
);
/* Sin dobles asignaciones del mismo mecánico. */
alter table appointments add constraint appointments_no_double_booking exclude using gist (org_id with =, mechanic_id with =, tsrange(start_at at time zone 'UTC', (start_at at time zone 'UTC') + make_interval(mins => duration_min)) with &&) where (mechanic_id is not null and status in ('solicitada','confirmada','en_recepcion','convertida'));
create table price_history (org_id uuid not null, id uuid not null default gen_random_uuid(), kind text not null check (kind in ('producto','servicio')), ref_id uuid not null, at timestamptz not null default now(), user_id uuid, old_price_cents bigint not null, new_price_cents bigint not null, reason text not null default '', primary key (org_id, id));
create table price_proposals (org_id uuid not null, id uuid not null default gen_random_uuid(), kind text not null, ref_id uuid not null, proposed_price_cents bigint not null check (proposed_price_cents >= 0), target_margin_pct numeric not null,
  status text not null default 'pendiente' check (status in ('pendiente','aprobada','rechazada')), decided_by uuid, decided_at timestamptz, primary key (org_id, id));
create table audit_logs (org_id uuid not null, id uuid not null default gen_random_uuid(), at timestamptz not null default now(), user_id uuid, action text not null, entity text not null, entity_id text not null, before_data jsonb, after_data jsonb, reason text, primary key (org_id, id));
create index on audit_logs (org_id, at desc);
create table attachments (org_id uuid not null, id uuid not null default gen_random_uuid(), owner_type text not null, owner_id text not null, name text not null, mime text not null, size int not null, storage_path text not null, created_at timestamptz not null default now(), primary key (org_id, id));
create table ops (org_id uuid not null, key text not null, kind text not null, result_id text not null, at timestamptz not null default now(), primary key (org_id, key));

/* ───────── Reglas en la base de datos ───────── */
-- Historial inmutable.
create function app.forbid_change() returns trigger language plpgsql as $$ begin raise exception 'Los registros históricos no se pueden modificar ni eliminar (% en %)', tg_op, tg_table_name; end $$;
create trigger no_change_movements before update or delete on inventory_movements for each row execute function app.forbid_change();
create trigger no_change_ledger before update or delete on ledger_entries for each row execute function app.forbid_change();
create trigger no_change_audit before update or delete on audit_logs for each row execute function app.forbid_change();
create trigger no_change_price_history before update or delete on price_history for each row execute function app.forbid_change();
create trigger no_change_allocations before update or delete on ledger_allocations for each row execute function app.forbid_change();

-- Un cobro nunca supera el saldo de la venta (fila bloqueada: dos cobros simultáneos no pueden pasarse).
create function app.check_sale_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare v_total bigint; v_ret bigint; v_paid bigint; v_status text;
begin
  if new.sale_id is null or new.kind not in ('cobro_cliente','reembolso_cliente') then return new; end if;
  select total_cents, status into v_total, v_status from sales where org_id = new.org_id and id = new.sale_id for update;
  if v_status = 'cancelada' then raise exception 'La venta está cancelada'; end if;
  if new.kind = 'cobro_cliente' then
    select coalesce(sum(net_cents + tax_cents), 0) into v_ret from sale_returns where org_id = new.org_id and sale_id = new.sale_id;
    select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end), 0) into v_paid from ledger_entries where org_id = new.org_id and sale_id = new.sale_id and kind in ('cobro_cliente','reembolso_cliente');
    if new.amount_cents > v_total - v_ret - v_paid then raise exception 'El cobro supera el saldo pendiente de la venta'; end if;
  end if;
  return new;
end $$;
create trigger check_sale_payment before insert on ledger_entries for each row execute function app.check_sale_payment();

-- Un pago a proveedor no puede exceder el saldo de la recepción.
create function app.check_receipt_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare v_total bigint; v_paid bigint;
begin
  select total_cents into v_total from purchase_receipts where org_id = new.org_id and id = new.receipt_id for update;
  select coalesce(sum(case when l.direction = 'out' then a.amount_cents else -a.amount_cents end), 0) into v_paid
    from ledger_allocations a join ledger_entries l on l.org_id = a.org_id and l.id = a.ledger_id where a.org_id = new.org_id and a.receipt_id = new.receipt_id;
  if new.amount_cents > v_total - v_paid then raise exception 'El pago supera el saldo pendiente de la recepción'; end if;
  return new;
end $$;
create trigger check_receipt_payment before insert on ledger_allocations for each row execute function app.check_receipt_payment();

-- Inventario: costo promedio ponderado móvil (misma regla que src/domain/inventory.ts). Fila bloqueada; sin existencias negativas.
create function app.stock_in(p_org uuid, p_product uuid, p_wh uuid, p_qty numeric, p_total_cents bigint, p_type text, p_ref_type text default '', p_ref_id text default '', p_reason text default '', p_op_key text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; begin
  if not app.has_any_perm(p_org, array['compras.recibir','inventario.ajustar','ventas.crear','ordenes.consumir']) then raise exception 'No tienes permiso para mover inventario'; end if;
  if p_op_key is not null then select id into v_id from inventory_movements where org_id = p_org and op_key = p_op_key; if found then return v_id; end if; end if;
  insert into inventory_balances (org_id, product_id, warehouse_id, qty, value_cents) values (p_org, p_product, p_wh, p_qty, p_total_cents)
    on conflict (org_id, product_id, warehouse_id) do update set qty = inventory_balances.qty + excluded.qty, value_cents = inventory_balances.value_cents + excluded.value_cents;
  insert into inventory_movements (org_id, product_id, warehouse_id, type, qty, unit_cost, total_cost_cents, ref_type, ref_id, reason, user_id, op_key)
    values (p_org, p_product, p_wh, p_type, p_qty, p_total_cents::numeric / p_qty, p_total_cents, p_ref_type, p_ref_id, p_reason, auth.uid(), p_op_key) returning id into v_id;
  return v_id;
end $$;
create function app.stock_out(p_org uuid, p_product uuid, p_wh uuid, p_qty numeric, p_type text, p_ref_type text default '', p_ref_id text default '', p_reason text default '', p_op_key text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_qty numeric; v_val bigint; v_cost bigint; begin
  if not app.has_any_perm(p_org, array['ordenes.consumir','ventas.crear','inventario.ajustar']) then raise exception 'No tienes permiso para mover inventario'; end if;
  if p_op_key is not null then select id into v_id from inventory_movements where org_id = p_org and op_key = p_op_key; if found then return v_id; end if; end if;
  select qty, value_cents into v_qty, v_val from inventory_balances where org_id = p_org and product_id = p_product and warehouse_id = p_wh for update;
  if not found or v_qty < p_qty then raise exception 'Inventario insuficiente: hay % y se piden %', coalesce(v_qty, 0), p_qty; end if;
  v_cost := case when v_qty = p_qty then v_val else round(v_val::numeric * p_qty / v_qty)::bigint end;
  update inventory_balances set qty = qty - p_qty, value_cents = value_cents - v_cost where org_id = p_org and product_id = p_product and warehouse_id = p_wh;
  insert into inventory_movements (org_id, product_id, warehouse_id, type, qty, unit_cost, total_cost_cents, ref_type, ref_id, reason, user_id, op_key)
    values (p_org, p_product, p_wh, p_type, -p_qty, v_cost::numeric / p_qty, -v_cost, p_ref_type, p_ref_id, p_reason, auth.uid(), p_op_key) returning id into v_id;
  return v_id;
end $$;

/* Saldos derivados (única fuente: documentos y movimientos; nada se guarda duplicado). */
create view v_receivables with (security_invoker = true) as
  select s.org_id, s.id as sale_id, s.folio, s.customer_name, s.due_date, s.total_cents
         - coalesce((select sum(r.net_cents + r.tax_cents) from sale_returns r where r.org_id = s.org_id and r.sale_id = s.id), 0)
         - coalesce((select sum(case when l.direction = 'in' then l.amount_cents else -l.amount_cents end) from ledger_entries l where l.org_id = s.org_id and l.sale_id = s.id and l.kind in ('cobro_cliente','reembolso_cliente')), 0) as balance_cents
  from sales s where s.status = 'emitida';

/* ───────── Seguridad por filas (RLS) ───────── */
do $$
declare t record;
begin
  -- (tabla, permiso de escritura; null = solo anexar)
  for t in select * from (values
    ('branches','config.editar'),('settings','config.editar'),('customers','clientes.editar'),('vehicles','vehiculos.editar'),('employees','personal.editar'),('services','precios.editar'),('suppliers','compras.editar'),
    ('products','inventario.editar'),('warehouses','config.editar'),('supplier_products','compras.recibir'),('inventory_balances','inventario.ajustar'),('inventory_movements',null),('purchase_orders','compras.editar'),
    ('purchase_order_items','compras.editar'),('purchase_receipts','compras.recibir'),('work_orders','ordenes.editar'),('work_order_items','ordenes.editar'),('work_order_time_entries','ordenes.tiempos'),
    ('work_order_authorizations','ordenes.autorizar'),('work_order_status_history','ordenes.editar'),('quotations','cotizaciones.editar'),('quotation_versions','cotizaciones.editar'),('quotation_items','cotizaciones.editar'),
    ('sales','ventas.crear'),('sale_items','ventas.crear'),('sale_returns','ventas.cancelar'),('cash_sessions','caja.operar'),('ledger_allocations','pagos_proveedor.registrar'),
    ('expenses','gastos.editar'),('recurring_expenses','gastos.editar'),('appointments','agenda.editar'),('price_history',null),('price_proposals','precios.editar'),('audit_logs',null),('attachments','ordenes.editar'),('ops',null)
  ) as x(tbl, perm) loop
    execute format('alter table %I enable row level security', t.tbl);
    execute format('alter table %I force row level security', t.tbl);
    execute format('create policy sel on %I for select to authenticated using (app.is_member(org_id))', t.tbl);
    if t.perm is null then
      execute format('create policy ins on %I for insert to authenticated with check (app.is_member(org_id))', t.tbl);
    else
      execute format('create policy ins on %I for insert to authenticated with check (app.has_perm(org_id, %L))', t.tbl, t.perm);
      execute format('create policy upd on %I for update to authenticated using (app.has_perm(org_id, %L)) with check (app.has_perm(org_id, %L))', t.tbl, t.perm, t.perm);
      execute format('create policy del on %I for delete to authenticated using (app.has_perm(org_id, %L))', t.tbl, t.perm);
    end if;
  end loop;
end $$;
-- Movimientos de dinero: solo anexar; quien cobra, paga, gasta u opera caja puede registrar.
alter table ledger_entries enable row level security; alter table ledger_entries force row level security;
create policy sel on ledger_entries for select to authenticated using (app.is_member(org_id));
create policy ins on ledger_entries for insert to authenticated with check (app.has_any_perm(org_id, array['caja.operar','cobros.registrar','pagos_proveedor.registrar','gastos.editar']));
-- Toda tabla de negocio pertenece a una organización existente.
do $$ declare t text; begin
  foreach t in array array['cash_sessions','recurring_expenses','price_history','price_proposals','audit_logs','attachments','ops'] loop
    execute format('alter table %I add foreign key (org_id) references organizations (id) on delete cascade', t);
  end loop;
end $$;
alter table organizations enable row level security; alter table organizations force row level security;
create policy sel on organizations for select to authenticated using (app.is_member(id));
alter table org_members enable row level security; alter table org_members force row level security;
create policy sel on org_members for select to authenticated using (user_id = auth.uid() or app.has_perm(org_id, 'usuarios.admin'));
create policy ins on org_members for insert to authenticated with check (app.has_perm(org_id, 'usuarios.admin'));
create policy upd on org_members for update to authenticated using (app.has_perm(org_id, 'usuarios.admin')) with check (app.has_perm(org_id, 'usuarios.admin'));
create policy del on org_members for delete to authenticated using (app.has_perm(org_id, 'usuarios.admin'));
alter table role_permissions enable row level security;
create policy sel on role_permissions for select to authenticated using (true);

grant usage on schema app to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
