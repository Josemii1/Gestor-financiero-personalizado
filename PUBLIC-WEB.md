# Pantalla pública, datos locales con dos contraseñas

El usuario autorizó expresamente este modelo de publicación con la condición de utilizar dos contraseñas. Esta opción simplifica el alojamiento frente al acceso adicional de Cloudflare. **La pantalla y el código son públicos; no es una web cuyo acceso esté restringido por el servidor.**

## Qué protegen las contraseñas

El cliente requiere el módulo de doble cifrado antes de publicarse. Una contraseña protege la capa exterior del almacén local y la otra descifra los datos de su interior. Ambas se eligen en el dispositivo, deben ser distintas y no se incorporan al repositorio o al sitio. Son dos secretos de conocimiento, no autenticación de dos factores.

Cualquier visitante puede ver la pantalla y descargar el código. Eso no proporciona las contraseñas ni los datos financieros que estén guardados cifrados en otro navegador. El primer bloqueo es una protección criptográfica local, no una cuenta de acceso comprobada por un servidor. No se debe presentar una pantalla JavaScript como una restricción de acceso al alojamiento.

El sitio no recibe saldos, movimientos, extractos, copias personales ni contraseñas. Solo se sube `dist/`, construido con la lista permitida de archivos genéricos. Las copias cifradas permanecen en el dispositivo y sus descargas, nunca dentro del artefacto publicado. No se añade sincronización entre dispositivos.

## Publicación automática preparada

El workflow `.github/workflows/public-client.yml` se ejecuta en pushes a `main` o manualmente desde esa rama. Antes de subir el sitio comprueba que existe el módulo de dos contraseñas, que el cliente lo carga y que su prueba forma parte de `npm test`. Después instala las dependencias del lockfile, ejecuta las pruebas y construye el cliente. Solo sube `dist/` al artefacto de Pages.

El trabajo de despliegue tiene únicamente los permisos necesarios para Pages: lectura de contenidos, escritura de Pages y emisión del token de identidad de la publicación. Las acciones oficiales están fijadas a SHA verificados. El despliegue no utiliza un token personal ni credenciales de Cloudflare.

La alternativa de Cloudflare existente continúa separada y desactivada salvo su configuración explícita. No se activa ni modifica su control de acceso mediante este workflow.

## Activación inicial que puede requerir el propietario

La acción oficial `configure-pages@v5` indica que su opción `enablement` necesita un token **distinto de `GITHUB_TOKEN`**. Un token personal necesita `repo` o permiso Pages de escritura; una aplicación GitHub necesita además administración del repositorio. Para evitar pedir un token administrativo nuevo, este workflow usa `enablement: false` y aprovecha una configuración Pages ya habilitada.

Si Pages todavía no está habilitado, el propietario debe entrar una sola vez en:

**Settings → Pages → Build and deployment → Source: GitHub Actions**

Después se puede ejecutar `Public encrypted client (two passwords)` desde **Actions → Run workflow** sobre `main`, o publicar un nuevo cambio probado. No hay una variable adicional de activación que configurar.

La disponibilidad de Pages depende de la visibilidad del repositorio y del plan de GitHub. En particular, un repositorio privado puede necesitar un plan compatible. No se ha comprobado el plan de esta cuenta. Si GitHub no permite habilitar Pages, se debe informar de ese bloqueo: **no cambiar la visibilidad del repositorio, contratar un plan ni prometer una dirección por iniciativa propia**. La creación de una rama `gh-pages` tampoco demuestra que el servicio se haya habilitado.

Fuente oficial verificada: [configuración de configure-pages v5](https://github.com/actions/configure-pages/blob/983d7736d9b0ae728b81ab479565c72886d7745b/action.yml). Para disponibilidad del servicio: [documentación de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages).

## Dirección y comprobación

No se inventa una URL. La dirección real debe obtenerse de una publicación correcta, mediante la salida `page_url` de `deploy-pages` y el entorno `github-pages`, y verificarse antes de entregarla como operativa.

Tras publicar:

1. Comprobar la pantalla y las dos etapas de desbloqueo en la dirección HTTPS real.
2. Desde el gestor anterior, exportar una copia cifrada reciente e importarla una sola vez en el nuevo origen. La contraseña se introduce localmente; no se envía por el chat.
3. Si se migra una copia antigua de una sola contraseña, conservar el original hasta verificar el nuevo doble cifrado y su recuperación.
4. Comprobar que una contraseña incorrecta en cualquiera de las etapas no muestra los movimientos, que la copia exportada también exige ambas y que el bloqueo vuelve a pedirlas.
5. Publicar una revisión inocua y comprobar que el aviso o la recarga conservan el almacén y no interrumpen formularios ni restauraciones pendientes.

GitHub Pages no permite definir las mismas cabeceras personalizadas del Worker de Cloudflare. Tampoco ofrece por defecto el control de acceso del servidor de Cloudflare Access. No debe afirmarse que ambas opciones tienen las mismas garantías.

Los proyectos de Pages de un mismo propietario pueden compartir el origen `propietario.github.io` y, por tanto, el alcance de almacenamiento del navegador. Conviene evitar otras aplicaciones no fiables en ese origen; un dominio exclusivo permite aislarlo. Nunca se promete protección frente a un dispositivo comprometido o scripts maliciosos del mismo origen.

## Actualizaciones desde este chat

El proceso será: cambio solicitado → implementación → pruebas → commit/push de código genérico a `main` → workflow → publicación correcta. Un mensaje sin implementar y publicar no cambia la web, y el agente no conoce ni modifica por sí solo las finanzas cifradas del dispositivo.

El actualizador conserva su URL estable sin depender de un hash antiguo; los demás recursos se identifican por contenido. Consulta `version.json` sin caché y recarga de forma segura cuando el gestor está bloqueado e inactivo. Con el gestor abierto ofrece actualizar después de guardar. Pages puede tener propagación o caché: no se promete disponibilidad instantánea ni éxito sin comprobar el resultado del workflow.
