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
