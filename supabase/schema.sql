-- =====================================================================
--  Lubricentro Ramos — esquema de base de datos para Supabase
--  Pegar completo en: Supabase > SQL Editor > New query > Run
--  Es idempotente: se puede volver a ejecutar para actualizar funciones.
--
--  Regla de oro: el STOCK nunca se edita directamente. Solo cambia a
--  través de las funciones registrar_venta, registrar_compra,
--  aplicar_conteo, anular_* y crear_producto, que además escriben el
--  kardex (tabla movimientos) en la misma transacción.
-- =====================================================================

-- ---------- Perfiles y roles ----------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  email text,
  rol text not null default 'mecanico' check (rol in ('admin','vendedor','mecanico')),
  activo boolean not null default false,
  creado_en timestamptz not null default now()
);

-- Rol del usuario actual (null si no existe o está inactivo)
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

-- Al registrarse un usuario: el PRIMERO queda como admin activo;
-- los siguientes quedan INACTIVOS hasta que el admin los active.
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare primero boolean;
begin
  select not exists (select 1 from perfiles) into primero;
  insert into perfiles (id, nombre, email, rol, activo)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nombre',''), split_part(new.email,'@',1)),
          new.email,
          case when primero then 'admin' else 'mecanico' end,
          primero)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.nuevo_usuario();

-- ---------- Tablas ----------
create table if not exists public.productos (
  id bigint generated always as identity primary key,
  codigo_barras text unique,
  nombre text not null,
  marca text,
  categoria text not null default 'Otros',
  unidad text not null default 'UND',
  es_servicio boolean not null default false,
  precio_compra numeric(12,2) not null default 0 check (precio_compra >= 0),
  precio_venta numeric(12,2) not null default 0 check (precio_venta >= 0),
  stock numeric(12,3) not null default 0,
  stock_minimo numeric(12,3) not null default 0,
  ubicacion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.clientes (
  id bigint generated always as identity primary key,
  doc_tipo text not null default 'DNI',
  doc_numero text unique,
  nombre text not null,
  telefono text,
  creado_en timestamptz not null default now()
);

create table if not exists public.vehiculos (
  id bigint generated always as identity primary key,
  placa text not null unique,
  cliente_id bigint references public.clientes(id),
  marca text,
  modelo text,
  anio int,
  creado_en timestamptz not null default now()
);

create table if not exists public.proveedores (
  id bigint generated always as identity primary key,
  ruc text,
  nombre text not null unique
);

create table if not exists public.compras (
  id bigint generated always as identity primary key,
  proveedor_id bigint references public.proveedores(id),
  comprobante text,
  fecha date not null default (now() at time zone 'America/Lima')::date,
  total numeric(12,2) not null default 0,
  usuario_id uuid not null references public.perfiles(id),
  anulada boolean not null default false,
  creado_en timestamptz not null default now()
);

create table if not exists public.compra_items (
  id bigint generated always as identity primary key,
  compra_id bigint not null references public.compras(id) on delete cascade,
  producto_id bigint not null references public.productos(id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  costo_unitario numeric(12,2) not null,
  subtotal numeric(12,2) not null
);

create table if not exists public.ventas (
  id bigint generated always as identity primary key,
  client_uuid uuid unique,              -- evita duplicados al reenviar ventas hechas sin internet
  fecha timestamptz not null default now(),
  cliente_id bigint references public.clientes(id),
  vehiculo_id bigint references public.vehiculos(id),
  km_actual int,
  km_proximo int,
  fecha_proxima date,
  metodo_pago text not null default 'Efectivo',
  subtotal numeric(12,2) not null default 0,
  descuento numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  observaciones text,
  usuario_id uuid not null references public.perfiles(id),
  mecanico_id uuid references public.perfiles(id),
  estado text not null default 'pagada' check (estado in ('pagada','anulada')),
  revisar boolean not null default false, -- venta offline que dejó stock negativo
  anulada_por uuid references public.perfiles(id),
  motivo_anulacion text
);
create index if not exists ix_ventas_fecha on public.ventas(fecha);
create index if not exists ix_ventas_vehiculo on public.ventas(vehiculo_id);

create table if not exists public.venta_items (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas(id) on delete cascade,
  producto_id bigint not null references public.productos(id),
  descripcion text not null,
  cantidad numeric(12,3) not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null,
  costo_unitario numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null
);
create index if not exists ix_venta_items_venta on public.venta_items(venta_id);

-- Kardex
create table if not exists public.movimientos (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  producto_id bigint not null references public.productos(id),
  tipo text not null check (tipo in ('INICIAL','ENTRADA','SALIDA','AJUSTE','ANULACION')),
  cantidad numeric(12,3) not null,
  stock_resultante numeric(12,3) not null,
  costo_unitario numeric(12,2),
  referencia text,
  nota text,
  usuario_id uuid references public.perfiles(id)
);
create index if not exists ix_mov_producto on public.movimientos(producto_id, fecha);
create index if not exists ix_mov_fecha on public.movimientos(fecha);

-- ---------- Seguridad (RLS) ----------
alter table public.perfiles     enable row level security;
alter table public.productos    enable row level security;
alter table public.clientes     enable row level security;
alter table public.vehiculos    enable row level security;
alter table public.proveedores  enable row level security;
alter table public.compras      enable row level security;
alter table public.compra_items enable row level security;
alter table public.ventas       enable row level security;
alter table public.venta_items  enable row level security;
alter table public.movimientos  enable row level security;

-- Lectura: cualquier usuario activo
do $$
declare t text;
begin
  foreach t in array array['productos','clientes','vehiculos','proveedores','compras','compra_items','ventas','venta_items','movimientos'] loop
    execute format('drop policy if exists leer on public.%I', t);
    execute format('create policy leer on public.%I for select to authenticated using (public.mi_rol() is not null)', t);
  end loop;
end $$;

drop policy if exists leer on public.perfiles;
create policy leer on public.perfiles for select to authenticated
  using (id = auth.uid() or public.mi_rol() is not null);
drop policy if exists admin_edita on public.perfiles;
create policy admin_edita on public.perfiles for update to authenticated
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

-- Escritura directa: solo lo mínimo. Todo lo demás va por funciones.
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (nombre, rol, activo) on public.perfiles to authenticated;

-- Productos: admin/vendedor editan datos, pero NUNCA la columna stock
grant update (codigo_barras, nombre, marca, categoria, unidad, precio_compra, precio_venta,
              stock_minimo, ubicacion, activo, actualizado_en) on public.productos to authenticated;
drop policy if exists editar on public.productos;
create policy editar on public.productos for update to authenticated
  using (public.mi_rol() in ('admin','vendedor')) with check (public.mi_rol() in ('admin','vendedor'));

grant update (doc_tipo, doc_numero, nombre, telefono) on public.clientes to authenticated;
drop policy if exists editar on public.clientes;
create policy editar on public.clientes for update to authenticated
  using (public.mi_rol() in ('admin','vendedor')) with check (public.mi_rol() in ('admin','vendedor'));

grant update (marca, modelo, anio, cliente_id) on public.vehiculos to authenticated;
drop policy if exists editar on public.vehiculos;
create policy editar on public.vehiculos for update to authenticated
  using (public.mi_rol() is not null) with check (public.mi_rol() is not null);

-- Un admin no puede quitarse a sí mismo el rol ni desactivarse
create or replace function public.proteger_admin() returns trigger
language plpgsql as $$
begin
  if old.id = auth.uid() and old.rol = 'admin' and (new.rol <> 'admin' or not new.activo) then
    raise exception 'No puedes quitarte el rol de admin ni desactivarte';
  end if;
  return new;
end $$;
drop trigger if exists proteger_admin on public.perfiles;
create trigger proteger_admin before update on public.perfiles for each row execute function public.proteger_admin();

-- ---------- Utilidades internas ----------
create or replace function public._exigir(roles text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text := mi_rol();
begin
  if r is null then raise exception 'Usuario no autorizado o inactivo' using errcode = '42501'; end if;
  if not (r = any(roles)) then raise exception 'No tienes permiso para esta acción' using errcode = '42501'; end if;
  return r;
end $$;

create or replace function public._norm_placa(p text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')), '') $$;

create or replace function public._txt(j jsonb, k text) returns text
language sql immutable as $$ select nullif(btrim(j->>k), '') $$;

-- Mueve stock y escribe el kardex. El producto debe estar bloqueado (FOR UPDATE).
create or replace function public._mover_stock(p_producto bigint, p_cantidad numeric, p_tipo text,
  p_ref text, p_nota text, p_costo numeric default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare nuevo numeric; serv boolean; costo numeric;
begin
  select es_servicio, precio_compra into serv, costo from productos where id = p_producto;
  if serv then return null; end if;
  update productos set stock = stock + p_cantidad, actualizado_en = now()
    where id = p_producto returning stock into nuevo;
  insert into movimientos (producto_id, tipo, cantidad, stock_resultante, costo_unitario, referencia, nota, usuario_id)
    values (p_producto, p_tipo, p_cantidad, nuevo, coalesce(p_costo, costo), p_ref, p_nota, auth.uid());
  return nuevo;
end $$;

-- ---------- Productos ----------
create or replace function public.crear_producto(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint; ini numeric; serv boolean := coalesce((p->>'es_servicio')::boolean, false);
begin
  perform _exigir(array['admin','vendedor']);
  if _txt(p,'nombre') is null then raise exception 'El nombre es obligatorio'; end if;
  if _txt(p,'codigo_barras') is not null and exists (select 1 from productos where codigo_barras = _txt(p,'codigo_barras')) then
    raise exception 'Ya existe otro producto con ese código de barras';
  end if;
  ini := case when serv then 0 else greatest(coalesce((p->>'stock')::numeric, 0), 0) end;
  insert into productos (codigo_barras, nombre, marca, categoria, unidad, es_servicio, precio_compra, precio_venta, stock_minimo, ubicacion)
  values (_txt(p,'codigo_barras'), _txt(p,'nombre'), _txt(p,'marca'), coalesce(_txt(p,'categoria'),'Otros'),
          coalesce(_txt(p,'unidad'),'UND'), serv, greatest(coalesce((p->>'precio_compra')::numeric,0),0),
          greatest(coalesce((p->>'precio_venta')::numeric,0),0), greatest(coalesce((p->>'stock_minimo')::numeric,0),0),
          _txt(p,'ubicacion'))
  returning id into nid;
  if ini > 0 then perform _mover_stock(nid, ini, 'INICIAL', null, 'Stock inicial'); end if;
  return nid;
end $$;

-- ---------- Clientes / vehículos ----------
create or replace function public._upsert_cliente(c jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare cid bigint; doc text := _txt(c,'doc_numero'); nom text := _txt(c,'nombre');
begin
  if c is null or jsonb_typeof(c) <> 'object' then return null; end if;
  if (c->>'id') is not null then return (c->>'id')::bigint; end if;
  if doc is not null then
    select id into cid from clientes where doc_numero = doc;
    if cid is not null then
      update clientes set nombre = coalesce(nom, nombre), telefono = coalesce(_txt(c,'telefono'), telefono) where id = cid;
      return cid;
    end if;
  end if;
  if nom is null then return null; end if;
  insert into clientes (doc_tipo, doc_numero, nombre, telefono)
  values (coalesce(_txt(c,'doc_tipo'), case when length(doc) = 11 then 'RUC' else 'DNI' end), doc, nom, _txt(c,'telefono'))
  returning id into cid;
  return cid;
end $$;

create or replace function public._upsert_vehiculo(v jsonb, p_cliente bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare vid bigint; pl text := _norm_placa(v->>'placa'); an int := nullif(regexp_replace(coalesce(v->>'anio',''),'\D','','g'),'')::int;
begin
  if pl is null then return null; end if;
  select id into vid from vehiculos where placa = pl;
  if vid is not null then
    update vehiculos set cliente_id = coalesce(p_cliente, cliente_id), marca = coalesce(_txt(v,'marca'), marca),
      modelo = coalesce(_txt(v,'modelo'), modelo), anio = coalesce(an, anio) where id = vid;
    return vid;
  end if;
  insert into vehiculos (placa, cliente_id, marca, modelo, anio)
  values (pl, p_cliente, _txt(v,'marca'), _txt(v,'modelo'), an) returning id into vid;
  return vid;
end $$;

-- ---------- Ventas / órdenes de servicio ----------
-- p = { client_uuid, offline, cliente{}, vehiculo{}, km_actual, km_proximo, fecha_proxima,
--       metodo_pago, descuento, observaciones, mecanico_id, items:[{producto_id,cantidad,precio_unitario}] }
create or replace function public.registrar_venta(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  rol text := _exigir(array['admin','vendedor','mecanico']);
  vid bigint; cid bigint; veh bigint; it jsonb; prod productos%rowtype;
  cant numeric; precio numeric; v_sub numeric := 0; v_desc numeric; v_total numeric;
  ref text; offline boolean := coalesce((p->>'offline')::boolean, false); v_revisar boolean := false;
  necesita record;
begin
  -- Idempotencia: si ya llegó esta venta, devolver la misma
  if (p->>'client_uuid') is not null then
    select id into vid from ventas where client_uuid = (p->>'client_uuid')::uuid;
    if vid is not null then return vid; end if;
  end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Agrega al menos un producto o servicio';
  end if;

  -- Bloquear productos (en orden para evitar bloqueos cruzados) y validar stock total por producto
  for necesita in
    select (i->>'producto_id')::bigint pid, sum((i->>'cantidad')::numeric) cant
    from jsonb_array_elements(p->'items') i group by 1 order by 1
  loop
    if necesita.cant is null or necesita.cant <= 0 then raise exception 'Las cantidades deben ser mayores a 0'; end if;
    select * into prod from productos where id = necesita.pid for update;
    if not found or not prod.activo then raise exception 'Producto no encontrado o inactivo'; end if;
    if not prod.es_servicio and prod.stock - necesita.cant < 0 then
      if offline then v_revisar := true;
      else raise exception 'Stock insuficiente de "%": hay % %, se piden %. Registra primero la compra o haz un ajuste.',
             prod.nombre, trim_scale(prod.stock), prod.unidad, trim_scale(necesita.cant);
      end if;
    end if;
  end loop;

  cid := _upsert_cliente(p->'cliente');
  veh := _upsert_vehiculo(p->'vehiculo', cid);

  insert into ventas (client_uuid, cliente_id, vehiculo_id, km_actual, km_proximo, fecha_proxima, metodo_pago,
                      observaciones, usuario_id, mecanico_id, revisar)
  values ((p->>'client_uuid')::uuid, cid, veh,
          nullif(regexp_replace(coalesce(p->>'km_actual',''),'\D','','g'),'')::int,
          nullif(regexp_replace(coalesce(p->>'km_proximo',''),'\D','','g'),'')::int,
          nullif(p->>'fecha_proxima','')::date,
          case when p->>'metodo_pago' in ('Efectivo','Yape','Plin','Tarjeta','Transferencia','Crédito') then p->>'metodo_pago' else 'Efectivo' end,
          _txt(p,'observaciones'), auth.uid(), nullif(p->>'mecanico_id','')::uuid, v_revisar)
  returning id into vid;
  ref := 'OS-' || lpad(vid::text, 6, '0');

  for it in select * from jsonb_array_elements(p->'items') loop
    select * into prod from productos where id = (it->>'producto_id')::bigint;
    cant := round((it->>'cantidad')::numeric, 3);
    -- El mecánico siempre usa el precio de lista
    precio := case when rol = 'mecanico' or nullif(it->>'precio_unitario','') is null then prod.precio_venta
                   else greatest(round((it->>'precio_unitario')::numeric, 2), 0) end;
    insert into venta_items (venta_id, producto_id, descripcion, cantidad, precio_unitario, costo_unitario, subtotal)
    values (vid, prod.id, prod.nombre, cant, precio, prod.precio_compra, round(cant * precio, 2));
    v_sub := v_sub + round(cant * precio, 2);
    perform _mover_stock(prod.id, -cant, 'SALIDA', ref, case when v_revisar then 'Venta sin conexión' end);
  end loop;

  v_desc := case when rol = 'mecanico' then 0 else least(greatest(round(coalesce((p->>'descuento')::numeric, 0), 2), 0), v_sub) end;
  v_total := v_sub - v_desc;
  update ventas set subtotal = v_sub, descuento = v_desc, total = v_total where id = vid;
  return vid;
end $$;

create or replace function public.anular_venta(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; it record;
begin
  perform _exigir(array['admin']);
  if nullif(btrim(p_motivo),'') is null then raise exception 'Indica el motivo de la anulación'; end if;
  select * into v from ventas where id = p_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v.estado = 'anulada' then raise exception 'La orden ya está anulada'; end if;
  for it in select vi.* from venta_items vi join productos pr on pr.id = vi.producto_id
            where venta_id = p_id order by producto_id for update of pr loop
    perform _mover_stock(it.producto_id, it.cantidad, 'ANULACION', 'OS-' || lpad(p_id::text, 6, '0'), p_motivo);
  end loop;
  update ventas set estado = 'anulada', anulada_por = auth.uid(), motivo_anulacion = p_motivo where id = p_id;
end $$;

-- ---------- Compras (entradas) ----------
-- p = { proveedor, ruc, comprobante, fecha, items:[{producto_id,cantidad,costo_unitario,precio_venta?}] }
create or replace function public.registrar_compra(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare cid bigint; prov bigint; it jsonb; prod productos%rowtype; cant numeric; costo numeric; ref text; tot numeric := 0;
begin
  perform _exigir(array['admin','vendedor']);
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Agrega al menos un producto';
  end if;
  if _txt(p,'proveedor') is not null then
    select id into prov from proveedores where lower(nombre) = lower(_txt(p,'proveedor'));
    if prov is null then
      insert into proveedores (nombre, ruc) values (_txt(p,'proveedor'), _txt(p,'ruc')) returning id into prov;
    end if;
  end if;
  insert into compras (proveedor_id, comprobante, fecha, usuario_id)
  values (prov, _txt(p,'comprobante'), coalesce(nullif(p->>'fecha','')::date, (now() at time zone 'America/Lima')::date), auth.uid())
  returning id into cid;
  ref := 'CO-' || lpad(cid::text, 6, '0') || coalesce(' / ' || _txt(p,'comprobante'), '');

  for it in select * from jsonb_array_elements(p->'items') order by (value->>'producto_id')::bigint loop
    cant := round((it->>'cantidad')::numeric, 3);
    costo := greatest(round(coalesce((it->>'costo_unitario')::numeric, 0), 2), 0);
    if cant is null or cant <= 0 then raise exception 'Las cantidades deben ser mayores a 0'; end if;
    select * into prod from productos where id = (it->>'producto_id')::bigint for update;
    if not found then raise exception 'Producto no encontrado'; end if;
    if prod.es_servicio then raise exception '"%" es un servicio, no se compra', prod.nombre; end if;
    insert into compra_items (compra_id, producto_id, cantidad, costo_unitario, subtotal)
      values (cid, prod.id, cant, costo, round(cant * costo, 2));
    tot := tot + round(cant * costo, 2);
    perform _mover_stock(prod.id, cant, 'ENTRADA', ref, null, costo);
    -- Costo promedio ponderado (y precio de venta si se indicó)
    update productos set
      precio_compra = case when greatest(prod.stock,0) + cant > 0
        then round((greatest(prod.stock,0) * prod.precio_compra + cant * costo) / (greatest(prod.stock,0) + cant), 2) else costo end,
      precio_venta = coalesce(nullif((it->>'precio_venta')::numeric, 0), precio_venta)
    where id = prod.id;
  end loop;
  update compras set total = tot where id = cid;
  return cid;
end $$;

create or replace function public.anular_compra(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c compras%rowtype; it record; prod productos%rowtype;
begin
  perform _exigir(array['admin']);
  select * into c from compras where id = p_id for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if c.anulada then raise exception 'La compra ya está anulada'; end if;
  for it in select producto_id, sum(cantidad) cantidad from compra_items
            where compra_id = p_id group by producto_id order by producto_id loop
    select * into prod from productos where id = it.producto_id for update;
    if prod.stock - it.cantidad < 0 then
      raise exception 'No se puede anular: "%" ya se vendió (stock actual %)', prod.nombre, trim_scale(prod.stock);
    end if;
    perform _mover_stock(it.producto_id, -it.cantidad, 'ANULACION', 'CO-' || lpad(p_id::text, 6, '0'), 'Anulación de compra');
  end loop;
  update compras set anulada = true where id = p_id;
end $$;

-- ---------- Conteo físico / ajustes ----------
-- p = { nota, conteos:[{producto_id, contado}] }
create or replace function public.aplicar_conteo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; prod productos%rowtype; contado numeric; dif numeric; out jsonb := '[]'::jsonb;
        nota text := coalesce(_txt(p,'nota'), 'Conteo físico');
begin
  perform _exigir(array['admin']);
  for c in select * from jsonb_array_elements(coalesce(p->'conteos','[]'::jsonb)) order by (value->>'producto_id')::bigint loop
    select * into prod from productos where id = (c->>'producto_id')::bigint for update;
    if not found or prod.es_servicio then raise exception 'Producto inválido'; end if;
    contado := round((c->>'contado')::numeric, 3);
    if contado is null or contado < 0 then raise exception 'Cantidad contada inválida para "%"', prod.nombre; end if;
    dif := contado - prod.stock;
    if dif <> 0 then
      perform _mover_stock(prod.id, dif, 'AJUSTE', null,
        nota || ' (sistema: ' || trim_scale(prod.stock) || ', contado: ' || trim_scale(contado) || ')');
    end if;
    out := out || jsonb_build_object('producto_id', prod.id, 'nombre', prod.nombre, 'antes', prod.stock, 'contado', contado, 'diferencia', dif);
  end loop;
  return out;
end $$;

-- ---------- Tablero y reportes ----------
create or replace function public.dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rol text := _exigir(array['admin','vendedor','mecanico']);
        d date := (now() at time zone 'America/Lima')::date; r jsonb;
begin
  select jsonb_build_object(
    'fecha', d,
    'ventas_hoy', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(total),0)) from ventas
                   where estado = 'pagada' and (fecha at time zone 'America/Lima')::date = d),
    'por_metodo', (select coalesce(jsonb_agg(x), '[]') from (select metodo_pago, sum(total) total from ventas
                   where estado = 'pagada' and (fecha at time zone 'America/Lima')::date = d group by 1 order by 2 desc) x),
    'stock_bajo', (select coalesce(jsonb_agg(x), '[]') from (select id, nombre, marca, stock, stock_minimo, unidad from productos
                   where activo and not es_servicio and stock <= stock_minimo order by stock - stock_minimo limit 30) x),
    'n_productos', (select count(*) from productos where activo and not es_servicio),
    'por_revisar', (select count(*) from ventas where revisar and estado = 'pagada'),
    'valor_inventario', case when rol = 'mecanico' then null else
                   (select coalesce(sum(stock * precio_compra), 0) from productos where activo and not es_servicio and stock > 0) end
  ) into r;
  return r;
end $$;

create or replace function public.recordatorios(p_dias int default 15) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.fecha_proxima), '[]') from (
    select distinct on (ve.vehiculo_id) ve.id venta_id, ve.fecha, ve.fecha_proxima, ve.km_proximo,
           v.placa, v.marca, v.modelo, c.nombre cliente, c.telefono
    from ventas ve join vehiculos v on v.id = ve.vehiculo_id left join clientes c on c.id = ve.cliente_id
    where ve.estado = 'pagada' and mi_rol() is not null
    order by ve.vehiculo_id, ve.fecha desc
  ) x where x.fecha_proxima is not null
      and x.fecha_proxima <= (now() at time zone 'America/Lima')::date + p_dias
$$;

create or replace function public.reporte(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exigir(array['admin','vendedor']);
  with v as (select * from ventas where estado = 'pagada' and (fecha at time zone 'America/Lima')::date between p_desde and p_hasta),
       vi as (select vi.*, p.nombre pnombre, p.unidad from venta_items vi join v on v.id = vi.venta_id join productos p on p.id = vi.producto_id)
  select jsonb_build_object(
    'resumen', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(total),0), 'descuentos', coalesce(sum(descuento),0)) from v),
    'costo', (select coalesce(sum(cantidad * costo_unitario), 0) from vi),
    'por_dia', (select coalesce(jsonb_agg(x order by dia), '[]') from (
        select (fecha at time zone 'America/Lima')::date dia, count(*) n, sum(total) total from v group by 1) x),
    'por_metodo', (select coalesce(jsonb_agg(x order by total desc), '[]') from (
        select metodo_pago, count(*) n, sum(total) total from v group by 1) x),
    'top_productos', (select coalesce(jsonb_agg(x order by total desc), '[]') from (
        select pnombre nombre, unidad, sum(cantidad) cantidad, sum(subtotal) total, sum(subtotal - cantidad * costo_unitario) ganancia
        from vi group by producto_id, pnombre, unidad order by sum(subtotal) desc limit 20) x),
    'por_usuario', (select coalesce(jsonb_agg(x order by total desc), '[]') from (
        select pf.nombre, count(*) n, sum(v.total) total from v join perfiles pf on pf.id = v.usuario_id group by pf.nombre) x),
    'compras', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(total),0)) from compras
                where not anulada and fecha between p_desde and p_hasta)
  ) into r;
  return r || jsonb_build_object('ganancia', (r->'resumen'->>'total')::numeric - (r->>'costo')::numeric);
end $$;

-- Las funciones internas no se exponen por la API
revoke execute on function public._mover_stock(bigint, numeric, text, text, text, numeric) from public, anon, authenticated;
revoke execute on function public._upsert_cliente(jsonb) from public, anon, authenticated;
revoke execute on function public._upsert_vehiculo(jsonb, bigint) from public, anon, authenticated;
revoke execute on function public.nuevo_usuario() from public, anon, authenticated;

-- ---------- Tiempo real (stock en vivo entre equipos) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.productos'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.ventas'; exception when duplicate_object then null; end;
  end if;
end $$;
