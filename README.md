# Lubricentro Ramos — Inventario y órdenes de servicio

App web instalable (PWA) para controlar el **stock real** del Lubricentro Ramos (Juliaca, Puno): cambios de aceite, filtros, compras a proveedores, conteos físicos y reportes. Funciona en celular y PC, incluso sin internet.

## Qué hace

| Módulo | Para qué |
|---|---|
| **Nueva orden** | Placa → trae cliente e historial. Agrega aceite (por galón o litro a granel), filtros y mano de obra. Calcula el próximo cambio (km y fecha). Cobro en Efectivo / Yape / Plin / Tarjeta / Transferencia / Crédito. Ticket para imprimir (80 mm) o enviar por WhatsApp. |
| **Foto con IA** | En *Nuevo producto*, una foto de la etiqueta llena nombre, marca, categoría y unidad (Cloudflare Workers AI, plan gratuito: ~150 fotos/día). Si el código de barras no se ve o no pasa el dígito verificador, el campo queda resaltado con el botón **📷 Escanear**. |
| **Inventario** | Stock en vivo, alertas de stock mínimo, búsqueda por código de barras (cámara del celular o lector USB), **kardex** por producto, exportar a Excel. |
| **Compras** | Cada factura o guía del proveedor suma stock y recalcula el **costo promedio**. |
| **Conteo físico** | Se cuenta el estante y el sistema registra la diferencia como AJUSTE (con usuario y fecha). |
| **Vehículos y clientes** | Historial de servicios por placa, recordatorios del próximo cambio por WhatsApp. |
| **Reportes** | Ventas, ganancia bruta, métodos de pago, productos más vendidos, kardex del periodo en Excel. |
| **Usuarios** | Roles: Administrador, Vendedor y Mecánico (de 3 a 20 personas o más). |

### Cómo se garantiza que el stock cuadre
1. **El stock no se edita a mano.** Solo cambia con ventas, compras, anulaciones o conteos, y cada cambio queda en el kardex.
2. En la nube, esas operaciones son **funciones de Postgres** (`registrar_venta`, `registrar_compra`, `aplicar_conteo`…). Bloquean el producto y validan que haya stock en una sola transacción. La base de datos rechaza escribir el stock directamente desde el navegador.
3. **Sin internet:** se puede vender igual. La venta queda en cola y se envía al volver la conexión (sin duplicarse). Si dejó stock negativo, se marca **“Revisar”** para corregirla con un conteo.
4. **Conteo cíclico semanal** de 10–15 productos para detectar mermas a tiempo.

## Arquitectura

```
Navegador (PWA Angular) ── Repositorio único ──┬── Modo local: IndexedDB (sin cuenta, para probar)
   Service Worker (offline, avisos de versión) └── Modo nube: Supabase (Auth + Postgres/RLS + Realtime)
Cloudflare Workers: sirve la app, genera /config.js y expone /api/admin-users
```

- **Frontend:** Angular 22 (componentes standalone y signals), ECharts, ExcelJS, ZXing / BarcodeDetector.
- **Datos:** Supabase. El esquema completo está en [`supabase/schema.sql`](supabase/schema.sql).
- **Hosting:** Cloudflare Workers con assets estáticos ([`wrangler.jsonc`](wrangler.jsonc), [`worker/index.ts`](worker/index.ts)).

## Probar en tu PC

```bash
npm install
npm start            # http://localhost:4200 -> "Usar en modo local"
```
En la pantalla de inicio pulsa **“Cargar datos de ejemplo”**.

## Puesta en producción (unos 20 minutos, todo gratis)

### 1. Supabase (base de datos y usuarios)
1. Crea una cuenta en https://supabase.com y un proyecto nuevo. Región sugerida: **São Paulo** (la más cercana a Perú).
2. Abre **SQL Editor → New query**, pega todo el contenido de `supabase/schema.sql` y presiona **Run**.
3. En **Authentication → Sign In / Providers**, deja activo Email. Para pruebas puedes desactivar “Confirm email”.
4. En **Project Settings → API** copia la **Project URL** y la **anon public key**.

> El **primer usuario** que se registre queda como **Administrador**. Los siguientes quedan *pendientes* hasta que el admin los active en **Usuarios**.
> Cuando ya estén todos registrados, puedes desactivar el registro público en *Authentication → Sign In / Providers → Allow new users to sign up*.

### 2. Cloudflare (publicar la app)
1. Crea una cuenta en https://dash.cloudflare.com.
2. En `wrangler.jsonc` completa `SUPABASE_URL`, `SUPABASE_ANON_KEY` y los datos del negocio (RUC, dirección, teléfono). La anon key es pública; la seguridad la da RLS.
3. Publica:
   ```bash
   npx wrangler login
   npm run deploy
   ```
   Te dará una URL como `https://lubricentro-ramos.<tu-cuenta>.workers.dev`. Luego se le puede poner un dominio propio.
4. *(Opcional)* Para que el admin cree usuarios desde la app, guarda la clave de servicio como **secreto** (nunca en el código):
   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```

### 3. En cada celular
Abre la URL → menú → **“Instalar aplicación”** (Android) o **“Agregar a pantalla de inicio”** (iPhone).

## Roles

| Acción | Admin | Vendedor | Mecánico |
|---|:-:|:-:|:-:|
| Registrar órdenes | ✔ | ✔ | ✔ (precio de lista, sin descuento) |
| Productos / compras / reportes | ✔ | ✔ | — |
| Ver costos | ✔ | ✔ | — (oculto en la interfaz) |
| Anular ventas y compras | ✔ | — | — |
| Conteo y ajustes de stock | ✔ | — | — |
| Gestionar usuarios | ✔ | — | — |

## Hardware recomendado (opcional)
- **Lector de código de barras USB o Bluetooth** (S/ 60–150): funciona como un teclado, solo se escanea dentro del buscador.
- **Ticketera térmica 80 mm** (S/ 200–350): el ticket ya viene con ese formato.
- Para productos sin código (granel, filtros sueltos) se pueden imprimir etiquetas con código propio.

## Pendiente / siguientes pasos sugeridos
- **Facturación electrónica SUNAT** (boleta/factura) con un proveedor OSE/PSE (Nubefact, etc.). Hoy el ticket es un documento interno.
- Cuentas por cobrar para ventas a **Crédito**.
- Varias sedes o almacenes.

## Pruebas
- SQL: `supabase/test/` tiene una simulación de Supabase Auth y un script que prueba ventas, compras, anulaciones, conteos, permisos y la cola sin conexión contra un Postgres local.
