# Mi economía

Aplicación privada en español para organizar ingresos, gastos, devoluciones familiares y el ahorro de una plaza con fecha límite. Funciona sin dependencias, conexiones bancarias, publicidad ni recursos externos.

## Web privada con dirección fija

La publicación preparada usa **Cloudflare Worker + Cloudflare Access**, además del cifrado local del gestor. El servidor exige una identidad autorizada antes de servir HTML, scripts o metadatos de versión. Sin configuración válida permanece cerrado. La activación y los requisitos están en [DEPLOYMENT.md](DEPLOYMENT.md); preparar los archivos no significa que la web esté publicada.

Las mejoras implementadas se publican mediante el workflow de GitHub al actualizar `main`, una vez conectado el alojamiento y activado `ENABLE_PRIVATE_DEPLOY`. Escribir un mensaje en el chat no constituye una publicación ni cambia por sí mismo el almacén financiero local.

La página comprueba nuevas versiones sin enviar datos financieros. Se actualiza automáticamente cuando está bloqueada e inactiva; con el gestor abierto muestra un aviso para guardar y actualizar. Conserva el mismo origen y el almacén cifrado. Al pasar desde el HTML descargado a HTTPS se importa una única vez una copia cifrada. No se añade sincronización de datos entre dispositivos.

El actualizador se sirve por una URL estable sin caché; el resto de scripts y CSS usan nombres con hash. Esto permite recuperarse de una página antigua durante una publicación. Si una pestaña antigua no puede exportar su HTML por falta de recursos anteriores, se conserva la copia JSON cifrada y se debe actualizar antes de exportar el HTML. Los archivos HTML descargados no consultan actualizaciones remotas.

Con Node.js 24:

```sh
npm ci
npm test
npm run build
```

El constructor deja en `dist/` únicamente los archivos genéricos permitidos y `version.json`; rechaza almacenes personales incrustados. Nunca publiques la raíz completa del workspace o del repositorio.

## Abrir

Con Python 3, desde la carpeta de este repositorio:

```sh
python3 start.py
```

Abre el servidor local desde tu navegador. En onboarding no se generan enlaces de vista previa. Otra opción es usar el HTML autónomo distribuido con todos los recursos incluidos: no necesita instalación. Los navegadores pueden gestionar de forma distinta el almacenamiento de archivos locales; conserva el mismo archivo y ubicación y exporta copias.

## Activar el cifrado y migrar datos anteriores

1. En la versión antigua, exporta una copia JSON reciente. Si solo tienes su HTML, se pueden importar sus datos iniciales, pero no contiene cambios posteriores guardados en el navegador.
2. Abre la versión nueva. Elige una contraseña/frase única de al menos 12 caracteres en tu dispositivo, nunca en el chat. Selecciona la copia anterior antes de crear la protección. Si se encuentran datos antiguos en el mismo almacenamiento, se propone migrarlos automáticamente.
3. La migración cifra, guarda, vuelve a leer y autentica los datos antes de retirar la clave antigua sin cifrar de `localStorage`. Si el guardado falla, los datos anteriores se conservan.
4. En **Guardar mi dinero**, usa **Guardar HTML cifrado** para generar un archivo portátil que también incluya tus datos protegidos. Comprueba que puedes abrirlo con tu contraseña en otro contexto/navegador antes de retirar los archivos antiguos.
5. No hay recuperación de contraseña. Conserva la frase en tu gestor de contraseñas junto a una copia cifrada. Evita editar desde varias pestañas a la vez.

## Uso

1. Introduce fecha y saldo reales, ingresos netos, gastos completos (incluido coche), deudas pendientes, colchón y fecha de pago en **Mi punto de partida**. Un saldo incluye únicamente dinero que ya tienes; el ingreso futuro en efectivo no se añade de nuevo.
2. Revisa **Mi panorama**: proyección sin intereses, déficit, reservas y calendario. El simulador de ingresos posibles no altera las tareas ni los ingresos confirmados.
3. Sigue **Qué hago este mes**. Los pagos al padre se proponen con el excedente después de proteger la liquidez y las obligaciones familiares próximas, suponiendo acuerdo para devoluciones parciales.
4. Registra ingresos, gastos, efectivo, devoluciones y pagos de deudas por separado. El historial de movimientos no vuelve a sumarse al saldo inicial. La proyección y el registro real se mantienen separados y se indica en pantalla; actualiza el punto de partida con saldos y deudas reales para recalcular.
5. Guarda una copia JSON cifrada al cerrar el mes. Puedes restaurarla con su contraseña tras validación y confirmación; se vuelve a cifrar con la contraseña de la sesión actual. El CSV descarga el calendario sin cifrar solo si lo confirmas; no es una copia del historial.

## Pibank y BBVA

La sección **Mi cuenta Pibank** organiza la cuenta elegida por el usuario como destino para colchón y ahorro de la plaza, manteniendo BBVA como cuenta operativa. La aplicación no abre cuentas, verifica contratos ni mueve dinero. No incorpora ninguna TAE actual no verificada.

- **Saldo total** incluye BBVA, Pibank y efectivo. En el punto de partida se declaran por separado el saldo actual en Pibank y el efectivo ya incluidos en ese total; el resto es BBVA. Los perfiles anteriores se importan con los campos nuevos a cero y se pueden actualizar si ya se hicieron transferencias.
- El objetivo de Pibank es el colchón más el ahorro de la plaza. Se reservan primero los próximos gastos y pagos familiares; si falta saldo, no se inmoviliza dinero necesario para recibos.
- El calendario muestra **traspaso a Pibank, saldo de Pibank y reserva de BBVA**. Un traspaso negativo indica regreso a BBVA y debe llegar antes de los pagos que dependan de él. El saldo total y la previsión de la plaza no aumentan por mover dinero entre cuentas.
- El plan de cuentas presupone ingresar en BBVA el efectivo que se vaya a utilizar para pagos bancarios. Si ya se pagaron gastos en efectivo, se adaptan el ingreso y los pagos por banco sin registrar esos gastos otra vez.
- La prueba de 10 € es una ida y vuelta y solo se propone si no tiene coste. Después se completa el saldo objetivo pendiente, sin añadir otra vez el importe de prueba ni un colchón que ya esté ingresado.
- Los movimientos de tipo **Transferencia propia** admiten origen y destino (BBVA/Pibank/Efectivo) y se registran una sola vez, sin contarlos como ingreso o gasto. El registro real sigue separado de la previsión: actualiza los saldos reales en el punto de partida antes de recalcular.
- Las tareas y los campos de cuentas se guardan y exportan cifrados junto con los datos existentes. El simulador no cambia las tareas de ingresos confirmados ni ordena transferencias.

## Reglas del plan

- Cálculo en céntimos. La primera previsión es el mes siguiente a la fecha del saldo y la última es el mes del vencimiento, incluido. Se presupone que su ingreso llega antes del pago de la plaza: si vence antes de cobrar, adelanta el límite al último día del mes anterior.
- Reserva protegida: colchón de emergencias **más un mes de gastos** para llegar al próximo cobro. Se excluye del dinero para la plaza.
- El pago a la madre se descuenta una sola vez. La deuda al padre se devuelve antes de acumular ahorro para la plaza.
- El saldo total incluye la reserva y el ahorro; no hay que volver a sumar las aportaciones. El ingreso extra necesario se calcula sin contar intereses o rentabilidades.
- Se supone continuidad de los ingresos y gastos, sin intereses familiares conocidos. Hay que incorporar seguros, impuestos y gastos anuales al presupuesto, revisar la cuota del coche y confirmar que el efectivo mensual es neto.
- Coche futuro y vivienda se conservan como metas posteriores, pendientes de presupuesto. No se presentan como financiadas.

## Privacidad

Datos cifrados en `localStorage` mediante Web Crypto: AES-GCM de 256 bits, IV aleatorio de 12 bytes nuevo por guardado, salt aleatorio de 16 bytes y derivación PBKDF2-SHA256 con 600.000 iteraciones. Formato y versión autenticados; validación del contenedor antes de derivar. La clave derivada no es exportable y vive únicamente en memoria mientras la sesión está abierta. La contraseña no se escribe en el almacenamiento, archivos, URL ni registros.

El bloqueo manual y tras cinco minutos de inactividad recarga la página y retira de la vista los datos descifrados. No se considera un borrado seguro de memoria ni protección frente a malware, extensiones maliciosas o acceso a un dispositivo desbloqueado. Los registros, HTML, PDF y copias de la versión anterior no se cifran retroactivamente. El CSV es una exportación opcional explícita sin cifrar.

Las copias JSON y el HTML portátil exportado contienen solo un contenedor cifrado; el HTML se construye desde una plantilla capturada antes del desbloqueo, nunca desde la pantalla con datos. El HTML de migración distribuido inicialmente no contiene datos personales ni una contraseña incrustada: se incorporan y cifran en el dispositivo. No subir copias personales al repositorio ni compartirlas públicamente.

Se requiere Web Crypto en contexto seguro (HTML local si el navegador lo admite o servidor de bucle local con `start.py`). Si no está disponible, no hay modo débil alternativo ni guardado en texto. La capacidad de almacenamiento depende del navegador: un fallo de cuota conserva la copia anterior. Límite de datos descifrados de 10 MiB; importaciones hasta 16 MiB para permitir el contenedor base64. `navigator.locks` protege el tramo de escritura entre pestañas cuando está disponible, además de comprobación del valor anterior; usa una sola pestaña en navegadores sin esta capacidad.

Los enlaces de FGD, Banco de España y CNMV solo se abren al pulsarlos. La guía financiera no contiene ofertas ni tipos actuales verificados y no contrata productos.

## Comprobaciones

Node.js (sin instalación de paquetes):

```sh
node --check app.js
node --check planner.js
node --check crypto-vault.js
node --check vault-ui.js
node planner.test.cjs
node crypto-vault.test.cjs
```

`planner.test.cjs` utiliza datos sintéticos para comprobar flujos, reservas, deudas, fechas y cálculo del déficit. No contiene datos bancarios personales. `crypto-vault.test.cjs` comprueba cifrado, autenticación, IV, formato y límites con contraseñas ficticias. Las pruebas de navegador también usan datos sintéticos, incluidos migración, bloqueo, copias y recuperación tras fallos.
