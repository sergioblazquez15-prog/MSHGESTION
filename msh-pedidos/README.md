# MSH Pedidos

Gestión de pedidos multi-cliente de MSH Madrid. Sin dependencias (Node 22.13 o superior).

## Instalar en el servidor

    cd /root
    git clone https://github.com/TU_USUARIO/NOMBRE_REPO.git
    cd /root/NOMBRE_REPO
    docker compose up -d --build

Abre http://IP-DEL-SERVIDOR:3081 . La primera vez te pide crear el administrador.

## Actualizar

    cd /root/NOMBRE_REPO
    git pull
    docker compose up -d --build

## Datos

Todo (base de datos, escudos, PDF) está en la carpeta data/ del servidor. Haz copia de esa carpeta.

## Primeros pasos

1. Ajustes: configura el correo SMTP y prueba el envío.
2. Plazos: revisa las fases por defecto.
3. Clientes: crea el cliente, sube su escudo, añade sus usuarios.
4. Catálogo: acabados, productos y packs de ese cliente.

## Actualizar sin perder datos

La base de datos se actualiza sola al arrancar y antes de migrar guarda una copia en data/backups/.

    cd /root/MSHGESTION
    git pull
    cd /root/MSHGESTION/msh-pedidos
    docker compose up -d --build

## Novedades v3
- **Precios**: se introducen siempre **sin IVA** (base imponible) en el catálogo (productos, packs y suplemento de acabados opcionales) y en las líneas libres del pedido. El pedido calcula base + IVA 21 % = total con IVA. Los clientes no ven precios.
- **Informes**: nueva pestaña con KPIs, gráfico por meses, reparto por tipo, ventas por cliente y por producto (con tallas), filtros por clientes/periodo/estado y generación de informe en PDF.
- Al actualizar, la base de datos se migra sola y se guarda una copia en data/backups.

## Novedades v3.1
- **Tareas**: lista de pendientes con responsable, fecha máxima y semáforo (verde, naranja si queda 1 día, rojo el último día o vencida). Al marcar el check pasan al registro de realizadas, que se consulta aparte.

## Novedades v4 (MSH gestión)
- **Nombre y logo**: la app pasa a llamarse **MSH gestión**, con el logo de MSH en el acceso y la cabecera.
- **Facturado / pendiente de facturar**: etiqueta en la lista, el histórico y la ficha del pedido. Se marca solo al subir la factura en PDF y también a mano. Informes muestra lo facturado, lo pendiente (remanente) por cliente y los pedidos pendientes.
- **Albarán de entrega parcial** desde el pedido: eliges cuántas unidades entregas de cada artículo y talla, sin importes, con logo de MSH, escudo del cliente, datos de la empresa, firmas y lo que queda pendiente. Numeración ALB-AAAA-NNNN.
- **Duplicar línea** en productos de catálogo y líneas libres (copia talla, color, unidades y acabados; el dato del acabado, como el dorsal, queda vacío).
- **Exportar a FactuSOL**: botón en el pedido que descarga un zip con FAC.xlsx (cabecera de la factura) y LFA.xlsx (líneas). Códigos de artículo automáticos y editables (PRD, PCK, ACB; LIBRE para líneas libres). Numeración desde Ajustes (siguiente: 1-000207). Packs: una línea con el precio del pack y sus prendas a 0 €.
- **Ajustes**: datos de la empresa, serie y siguiente número de factura, forma de pago, y descarga del listado de códigos de artículo.
- **Clientes**: código de cliente de FactuSOL, NIF y dirección.

## Novedades v5
- **Comercial** (nueva pestaña) con dos listas, **Clubes** y **Empresas**: filtro por zona y semáforo (rojo = sin contactar, amarillo = contactado / negociando), buscador y casilla «Contactado».
- **Ficha** con hasta 3 personas de contacto (nombre, cargo, teléfono, correo), notas e **historial de contactos** (fecha, medio y observaciones; al anotar el primero pasa a amarillo).
- **Importar Excel o CSV**: lee la primera hoja (Zona, Modalidad, Club/Empresa, Municipio, CP, Dirección, Teléfonos, Email, Presidente, Otro contacto, Web…); las demás columnas van a notas. Lo que ya existe no se duplica ni se pisa: solo se rellenan los huecos, y se conservan estado, contactos e historial.
- **Pasar a cliente** (verde): pide nombre, NIF/CIF, dirección, CP, población y provincia (y el código de FactuSOL si existe), exige confirmar, crea el cliente y retira la ficha de Comercial; el historial queda en la ficha del cliente.
- **Pedidos e Histórico**: columnas Total y Total con IVA a simple vista, y suma de los pedidos mostrados.
- Clientes: persona de contacto, teléfono y correo.

- **Comercial**: nuevo filtro por deporte (o sector en empresas), combinable con la zona.
- **Firma digital del albarán**: al crear un albarán se abre dentro de la app. El cliente firma con el dedo en el móvil (nombre obligatorio, DNI opcional); la firma, la fecha y la hora quedan guardadas y salen en el albarán. Hasta que no se firma no se puede exportar a PDF, y un albarán firmado ya no se puede cambiar ni eliminar.

## v7 · Numeración FactuSOL y «Entregado por»

- **Nº de pedido en formato FactuSOL** (serie-número, p. ej. `1-000206`). También acepta solo el número (`206`, usa la serie de Ajustes). Se puede cambiar en cualquier pedido (pendientes e histórico) desde «Datos del pedido». No se admiten duplicados.
- Un pedido nuevo continúa con el **número más alto existente + 1** (si el último es 1-000206, el siguiente es 1-000207).
- Los albaranes sin firmar muestran siempre el número actual del pedido (se actualizan solos); los firmados conservan su documento.
- La **factura de FactuSOL lleva el mismo número que el pedido**. Un pedido ya exportado no puede renumerarse hasta anular la exportación.
- **Entregado por**: editable al crear el albarán (por defecto, el usuario) y modificable después, junto con la fecha, mientras esté sin firmar.
- Migración automática a esquema 7 con copia de seguridad previa. Los pedidos existentes pasan a `1-00000N` con su número actual.
