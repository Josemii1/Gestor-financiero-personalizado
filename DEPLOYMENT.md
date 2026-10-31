# Web privada con dirección fija

Esta configuración prepara Cloudflare Workers Static Assets detrás de Cloudflare Access. **No hay una web publicada por guardar estos archivos.** Se requiere una cuenta de Cloudflare, una aplicación Access con acceso restringido al propietario y autorización de despliegue. La presencia de acceso a GitHub no proporciona credenciales de Cloudflare.

La dirección debe ser HTTPS y permanecer estable. Puede ser la dirección de producción `workers.dev` del Worker si la cuenta permite protegerla con Access, o un dominio propio en Cloudflare con una aplicación Access que lo cubra. No se debe sustituir esta configuración por GitHub Pages público ni por un túnel anónimo.

## Qué se publica y qué permanece privado

- El constructor `node scripts/build.mjs` produce únicamente `dist/`: HTML genérico, CSS/JS con nombres derivados de su contenido y `version.json`.
- Rechaza HTML con datos iniciales o un almacén cifrado incrustado. No se publican archivos descargables personales, PDF, copias, registros de transacciones, claves ni la carpeta de trabajo completa.
- Access exige la identidad permitida antes de llegar al Worker. El Worker verifica además la firma del JWT, emisor, audiencia, vencimiento y correo permitido antes de servir **cualquier** archivo, incluidos JS, CSS y `version.json`.
- Si falta la configuración privada, el Worker devuelve 503; sin identificación válida devuelve 401/403. No existe una ruta alternativa que sirva los archivos sin verificar Access. `assets.run_worker_first` está activo y las direcciones de previsualización están desactivadas.
- Los datos financieros siguen cifrados en el navegador con la contraseña del usuario. La web no dispone de un servidor de datos ni sincronización financiera. Access protege el acceso a la web, no sustituye el cifrado del almacén local.

## Preparación una sola vez

1. Crear o utilizar una cuenta de Cloudflare y su equipo de Zero Trust. Verificar las condiciones y límites actuales del servicio antes de aceptar sus términos. No se presupone ningún plan contratado ni coste concreto.
2. En Access, habilitar el proveedor de acceso por código de un solo uso enviado al correo del propietario, o un proveedor de identidad de confianza ya configurado.
3. Crear una aplicación Access que proteja toda la dirección de producción y todas sus rutas. La política Allow debe incluir únicamente el correo autorizado. No usar una política Bypass o Everyone. Si se mantiene `workers.dev`, comprobar en la cuenta la protección Access de esa dirección; si no está disponible, usar un dominio propio protegido y desactivar la dirección alternativa antes de considerar el despliegue accesible y privado.
4. Anotar el dominio de equipo con formato `equipo.cloudflareaccess.com` y la audiencia (AUD) de la aplicación. No incluir el esquema `https://` en el dominio de equipo.
5. Preparar un token API limitado a la cuenta de Cloudflare elegida con el permiso necesario para desplegar Workers, normalmente **Account → Workers Scripts → Edit**. Añadir permisos de rutas o zona únicamente si el dominio elegido los requiere. No usar una API Global Key ni conceder permisos de otras cuentas. La protección Access puede configurarse manualmente para no ampliar el token de despliegue con permisos de administración Zero Trust.
6. Configurar los valores de la tabla en **Settings → Secrets and variables → Actions** del repositorio de GitHub. Introducir secretos mediante esa interfaz segura, nunca por el chat ni en archivos del repositorio.
7. Mantener `ENABLE_PRIVATE_DEPLOY` desactivado hasta disponer de la protección Access y la configuración completa. Después poner su valor en `true` y ejecutar el workflow `Private web` desde la rama `main`.

| Nombre | Ubicación en GitHub | Contenido |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Token de despliegue limitado a la cuenta seleccionada |
| `ACCESS_ALLOWED_EMAIL` | Secret | Correo exacto del propietario autorizado |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Identificador de la cuenta que alojará el Worker |
| `ACCESS_TEAM_DOMAIN` | Variable | Dominio del equipo Access, sin esquema ni ruta |
| `ACCESS_AUDIENCE` | Variable | Audiencia AUD de la aplicación Access que protege la web |
| `ENABLE_PRIVATE_DEPLOY` | Variable | `true` activa despliegues privados desde `main`; otro valor los omite |

El workflow valida que todos los valores requeridos existan y tengan formato válido antes de intentar desplegar. Usa las dependencias exactas del lockfile y las acciones oficiales fijadas a SHA. El correo autorizado se pasa a Wrangler mediante un archivo JSON temporal con permisos 0600, se carga como secreto de la misma versión y se elimina en un bloque `finally`. No se imprime su contenido ni se convierte en variable pública del repositorio. Los parámetros de equipo y audiencia no son secretos; el token y el correo nunca se imprimen deliberadamente. No se suben los registros de Wrangler como artefactos.

`wrangler deploy --secrets-file` está disponible en la versión exacta instalada. Permite cargar el secreto junto con la versión inicial sin crear primero un Worker público o realizar un despliegue intermedio sin correo autorizado. La validación del Worker permanece cerrada incluso si una configuración del proveedor está incompleta.

## Comprobar la publicación real

Un workflow preparado o una construcción local no demuestra que el sitio esté publicado ni que Access esté configurado correctamente. Antes de entregar una dirección como operativa:

1. Confirmar el despliegue de producción en la cuenta correcta y su URL HTTPS real; no inventar una URL a partir del nombre del Worker.
2. En un navegador sin sesión, comprobar que solicita la identidad Access. Verificar también las rutas de JS, CSS y `version.json`: no deben exponer archivos de la aplicación antes de autenticarse.
3. Confirmar que un correo no autorizado queda bloqueado, y que la identidad permitida puede acceder.
4. Dentro de Access, abrir la aplicación, crear/desbloquear el almacén local e importar **una sola vez** la copia cifrada exportada del HTML anterior. La contraseña se introduce únicamente en el dispositivo. No se sube la copia a Cloudflare ni al repositorio.
5. Verificar apertura de datos y exportación de una copia cifrada antes de retirar los archivos antiguos.
6. Publicar una revisión inocua posterior y comprobar que se detecta la nueva versión y se conservan los datos locales, los formularios y la privacidad de las rutas.

## Actualizaciones posteriores desde este chat

El workflow ejecuta las pruebas y la construcción en pushes a `main`, pull requests dirigidas a `main` y ejecuciones manuales. El despliegue requiere pruebas correctas, `ENABLE_PRIVATE_DEPLOY=true`, configuración completa y un push o ejecución manual sobre `main`. Las pull requests nunca despliegan.

El flujo es: petición en este chat → implementación → pruebas → commit/push de código a `main` → CI → versión de producción. **Un mensaje por sí solo no modifica la web ni los datos financieros cifrados del dispositivo.** El agente no conoce la contraseña local y no puede reescribir ese almacén automáticamente desde el texto del chat.

El cliente consulta `version.json` sin caché. Si está bloqueado y no se está escribiendo una contraseña ni cifrando, puede recargar de forma automática; si está abierto, muestra un aviso para guardar y actualizar. El HTML y la información de versión no se almacenan en caché; los recursos con hash se identifican por contenido. La dirección, el origen HTTPS y la clave de almacenamiento `mi-economia-encrypted-v1` se mantienen estables. Ninguna publicación envía `Clear-Site-Data` ni borra el almacén local.

El HTML portátil exportado sigue siendo una copia independiente sin actualización automática. Se recomienda conservarlo como respaldo cifrado, no usarlo como sustituto de la dirección fija publicada.

## Validación local sin publicar

```sh
npm ci
npm test
npm run build
npx wrangler deploy --dry-run
```

La construcción y las pruebas locales utilizan datos e identidades sintéticos. Un `--dry-run` no publica ni configura Access; tampoco demuestra autorización de despliegue. En un entorno con directorio de usuario de solo lectura, establece `WRANGLER_LOG_PATH` en una ruta temporal autorizada y `WRANGLER_SEND_METRICS=false` antes de ejecutar la CLI. No desactives la verificación TLS o de los paquetes.

## Bloqueos externos pendientes

Se necesita autorización de Cloudflare y una aplicación Access real para producir una dirección privada utilizable. Los permisos de red del entorno también deben permitir las APIs necesarias. Si la API de GitHub o Cloudflare está bloqueada, no se debe evitar ese control mediante rutas alternativas ni declarar que la publicación se completó. Conservar el código preparado y reanudar la operación cuando se haya configurado el acceso requerido.
