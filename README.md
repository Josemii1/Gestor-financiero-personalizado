# Mi economía

Aplicación privada en español para organizar ingresos, gastos, devoluciones familiares y el ahorro de una plaza con fecha límite. Funciona sin dependencias, conexiones bancarias, publicidad ni recursos externos.

## Dirección fija con dos contraseñas

El usuario eligió **pantalla/código públicos y datos privados cifrados en su dispositivo**, con dos contraseñas distintas. La ruta actual es GitHub Pages y sus pasos están en [PUBLIC-WEB.md](PUBLIC-WEB.md). No requiere tokens de Cloudflare. Si Pages no está habilitado, el propietario puede tener que elegir una vez **Settings → Pages → Source: GitHub Actions**; los repositorios privados requieren un plan compatible. No cambiar la visibilidad del repositorio ni contratar un plan automáticamente.

Una contraseña abre la capa cifrada exterior y la otra descifra el almacén interior. La primera no da acceso a los datos ni restringe el código servido por el alojamiento. Es doble cifrado local, **no autenticación de servidor ni dos factores**. Ambas contraseñas las elige el usuario en su dispositivo y son necesarias también para restaurar las nuevas copias.

`.github/workflows/public-client.yml` comprueba la implementación de ambas contraseñas, ejecuta las pruebas, construye el cliente genérico y publica únicamente `dist/` cuando Pages está activo. Un mensaje del chat no modifica por sí solo la web ni los datos locales: las mejoras necesitan implementación, pruebas y publicación correcta.

El actualizador comprueba `version.json` sin enviar datos financieros. Se actualiza automáticamente bloqueado e inactivo, y avisa cuando hay una sesión o un primer paso ya abierto. Respeta formularios, operaciones de cifrado y restauraciones pendientes. Los HTML portátiles no hacen consultas remotas para actualizarse. El mismo origen conserva `mi-economia-encrypted-v1`; al cambiar de HTML local a HTTPS se importa una copia una sola vez. No hay sincronización de datos entre dispositivos.

La alternativa de acceso restringido por Cloudflare Access permanece separada en [DEPLOYMENT.md](DEPLOYMENT.md). No se considera activada ni se requiere para el modelo público elegido.

```sh
npm ci
npm test
npm run build
```

El constructor publica solo recursos genéricos permitidos. Rechaza almacenes y datos iniciales incrustados. No publicar la raíz del repositorio o del workspace. El actualizador conserva una URL estable; los demás scripts/CSS usan hashes. Una pestaña antigua que no pueda exportar HTML puede exportar su JSON cifrado, actualizar y volver a intentarlo.

## Abrir

Con Python 3, desde la carpeta de este repositorio:

```sh
python3 start.py
```

Abre el servidor local desde tu navegador. En onboarding no se generan enlaces de vista previa. Otra opción es usar el HTML autónomo distribuido con todos los recursos incluidos: no necesita instalación. Los navegadores pueden gestionar de forma distinta el almacenamiento de archivos locales; conserva el mismo archivo y ubicación y exporta copias.

## Activar las dos contraseñas y migrar

1. Conserva una copia cifrada reciente del gestor anterior. El HTML antiguo solo contiene sus datos iniciales, no los cambios posteriores guardados en el navegador.
2. Abre la nueva versión. Si encuentra un almacén anterior con una contraseña en el mismo origen, elige una contraseña de entrada nueva y usa la contraseña actual como contraseña de datos. Deben ser distintas y tener al menos 12 caracteres. Si importas un archivo puedes elegir claves nuevas; se pide aparte la contraseña de esa copia.
3. Antes de sustituir el almacén anterior se comprueban las dos capas y se compara el contenido. Un fallo de contraseña, validación o escritura conserva la copia anterior. La clave de almacenamiento sigue siendo `mi-economia-encrypted-v1` para permitir la migración.
4. Para entrar se piden dos pasos: entrada → datos. El primer paso solo descifra otro contenedor cifrado y no muestra información financiera. Bloquear, cerrar o permanecer inactivo cinco minutos vuelve a exigir el primer paso.
5. En **Guardar mi dinero**, exporta un JSON cifrado o usa **Guardar HTML cifrado**. Las nuevas copias contienen ambas capas. Comprueba que puedes restaurarlas con las dos contraseñas antes de retirar las copias antiguas.
6. No hay recuperación de contraseñas. Guarda ambas frases en tu gestor de contraseñas y no las compartas por chat. Las copias anteriores y el PDF no se cifran retroactivamente.

## Uso

1. Introduce fecha y saldo reales, ingresos netos, gastos completos (incluido coche), deudas pendientes, colchón y fecha de pago en **Mi punto de partida**. Un saldo incluye únicamente dinero que ya tienes; el ingreso futuro en efectivo no se añade de nuevo.
2. Revisa **Mi panorama**: proyección sin intereses, déficit, reservas y calendario. El simulador de ingresos posibles no altera las tareas ni los ingresos confirmados.
3. Sigue **Qué hago este mes**. Los pagos al padre se proponen con el excedente después de proteger la liquidez y las obligaciones familiares próximas, suponiendo acuerdo para devoluciones parciales.
4. Registra ingresos, gastos, efectivo, devoluciones y pagos de deudas por separado. El historial de movimientos no vuelve a sumarse al saldo inicial. La proyección y el registro real se mantienen separados y se indica en pantalla; actualiza el punto de partida con saldos y deudas reales para recalcular.
5. Guarda una copia JSON cifrada al cerrar el mes. Puedes restaurarla con sus contraseñas tras validación y confirmación; se vuelve a cifrar con las dos contraseñas de la sesión actual. El CSV descarga el calendario sin cifrar solo si lo confirmas; no es una copia del historial.

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

Datos cifrados en `localStorage` mediante dos capas Web Crypto AES-GCM de 256 bits. Cada capa usa su propia contraseña, salt aleatorio de 16 bytes y derivación PBKDF2-SHA256 de 600.000 iteraciones, con IV aleatorio de 12 bytes nuevo en cada guardado. Formato y versión autenticados; validación del contenedor antes de derivar. Las claves derivadas no son exportables y viven únicamente en memoria durante los pasos abiertos. Ninguna contraseña se escribe en el almacenamiento, archivos, URL ni registros.

El bloqueo manual y tras cinco minutos de inactividad recarga la página y retira de la vista los datos descifrados. No se considera un borrado seguro de memoria ni protección frente a malware, extensiones maliciosas o acceso a un dispositivo desbloqueado. Los registros, HTML, PDF y copias de la versión anterior no se cifran retroactivamente. El CSV es una exportación opcional explícita sin cifrar.

Las copias JSON y el HTML portátil exportado contienen solo un contenedor cifrado; el HTML se construye desde una plantilla capturada antes del desbloqueo, nunca desde la pantalla con datos. El HTML de migración distribuido inicialmente no contiene datos personales ni una contraseña incrustada: se incorporan y cifran en el dispositivo. No subir copias personales al repositorio ni compartirlas públicamente.

Se requiere Web Crypto en contexto seguro (HTML local si el navegador lo admite o servidor de bucle local con `start.py`). Si no está disponible, no hay modo débil alternativo ni guardado en texto. La capacidad de almacenamiento depende del navegador: un fallo de cuota conserva la copia anterior. Límite de datos descifrados de 6 MiB para que ambas capas quepan sin exceder los límites del contenedor; importaciones hasta 16 MiB para permitir el contenedor base64. `navigator.locks` protege el tramo de escritura entre pestañas cuando está disponible, además de comprobación del valor anterior; usa una sola pestaña en navegadores sin esta capacidad.

Los enlaces de FGD, Banco de España y CNMV solo se abren al pulsarlos. La guía financiera no contiene ofertas ni tipos actuales verificados y no contrata productos.

## Comprobaciones

Node.js (sin instalación de paquetes):

```sh
node --check app.js
node --check planner.js
node --check crypto-vault.js
node --check vault-ui.js
node --check dual-vault.js
node planner.test.cjs
node crypto-vault.test.cjs
node dual-vault.test.cjs
```

`planner.test.cjs` utiliza datos sintéticos para comprobar flujos, reservas, deudas, fechas y cálculo del déficit. No contiene datos bancarios personales. `crypto-vault.test.cjs` comprueba cifrado, autenticación, IV, formato y límites con contraseñas ficticias. `dual-vault.test.cjs` verifica las dos contraseñas, el contenedor interior, manipulación y límites. Las pruebas de navegador también usan datos sintéticos, incluidos migración, ambos pasos, bloqueo, copias y recuperación tras fallos.
