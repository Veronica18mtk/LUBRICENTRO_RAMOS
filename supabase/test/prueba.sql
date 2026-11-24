\set ON_ERROR_STOP 1
-- Usuarios: el primero queda admin, el segundo inactivo
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','dueno@x.pe','{"nombre":"Dueño"}'),
 ('00000000-0000-0000-0000-000000000002','meca@x.pe','{"nombre":"Mecánico"}');
select nombre, rol, activo from perfiles order by email;

-- Actuar como admin
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001', false);
select crear_producto('{"nombre":"Mobil Super 20W-50 1gal","marca":"Mobil","categoria":"Aceite de motor","unidad":"GAL","precio_compra":80,"precio_venta":110,"stock":10,"stock_minimo":3,"codigo_barras":"775000"}') p1;
select crear_producto('{"nombre":"Filtro aceite W712","categoria":"Filtro de aceite","precio_compra":15,"precio_venta":25,"stock":2}') p2;
select crear_producto('{"nombre":"Mano de obra cambio de aceite","categoria":"Servicio","es_servicio":true,"precio_venta":15}') p3;
-- Intentar editar stock directamente debe fallar
do $$ begin update productos set stock = 999 where id = 1; raise exception 'NO DEBIÓ PASAR'; exception when insufficient_privilege then raise notice 'OK: stock no editable directo'; end $$;
-- Venta normal
select registrar_venta('{"cliente":{"doc_numero":"45678912","nombre":"Juan Quispe","telefono":"951111222"},"vehiculo":{"placa":"v1k-456","marca":"Toyota","modelo":"Hilux"},"km_actual":"85,000","km_proximo":90000,"fecha_proxima":"2026-11-30","metodo_pago":"Yape","descuento":5,"items":[{"producto_id":1,"cantidad":1.25},{"producto_id":2,"cantidad":1},{"producto_id":3,"cantidad":1}]}') venta1;
select id, total, subtotal, descuento, km_actual from ventas;
select nombre, stock from productos order by id;
-- Venta con stock insuficiente debe fallar
do $$ begin perform registrar_venta('{"items":[{"producto_id":2,"cantidad":5}]}'); raise exception 'NO DEBIÓ PASAR'; exception when raise_exception then raise notice 'OK: %', sqlerrm; end $$;
-- Venta offline con stock insuficiente: pasa y queda para revisar; reenviar mismo uuid no duplica
select registrar_venta('{"client_uuid":"11111111-1111-1111-1111-111111111111","offline":true,"items":[{"producto_id":2,"cantidad":2}]}') v2;
select registrar_venta('{"client_uuid":"11111111-1111-1111-1111-111111111111","offline":true,"items":[{"producto_id":2,"cantidad":2}]}') v2_repetida;
select id, revisar from ventas order by id;
-- Compra: costo promedio
select registrar_compra('{"proveedor":"Distribuidora Juliaca","comprobante":"F001-123","items":[{"producto_id":2,"cantidad":10,"costo_unitario":17,"precio_venta":28},{"producto_id":1,"cantidad":4,"costo_unitario":84}]}') compra;
select nombre, stock, precio_compra, precio_venta from productos order by id;
-- Anular venta 1 devuelve stock
select anular_venta(1, 'Error de digitación');
select nombre, stock from productos order by id;
-- Conteo físico
select aplicar_conteo('{"nota":"Conteo semanal","conteos":[{"producto_id":1,"contado":12}]}');
select tipo, cantidad, stock_resultante, referencia, nota from movimientos where producto_id = 1 order by id;
select dashboard();
select reporte('2026-01-01','2026-12-31');
select recordatorios(30);
-- Activar mecánico (admin) y probar sus permisos
update perfiles set activo = true where email = 'meca@x.pe';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002', false);
do $$ begin perform anular_venta(2,'x'); raise exception 'NO DEBIÓ PASAR'; exception when insufficient_privilege then raise notice 'OK mecánico no anula: %', sqlerrm; end $$;
select registrar_venta('{"descuento":50,"items":[{"producto_id":3,"cantidad":1,"precio_unitario":1}]}') venta_meca;
select id, total, descuento from ventas where id = (select max(id) from ventas);
do $$ begin update perfiles set rol='admin' where email='meca@x.pe'; if found then raise exception 'NO DEBIÓ PASAR'; end if; raise notice 'OK mecánico no se cambia el rol'; end $$;
-- Usuario inactivo no ve nada
reset role;
update perfiles set activo = false where email = 'meca@x.pe';
set role authenticated;
select count(*) as productos_visibles_inactivo from productos;
reset role;
