# Mi economía: instrucciones para futuras tareas

El usuario pidió una web de dirección fija con acceso privado y que las mejoras implementadas desde este chat se publiquen sin tener que descargar cada vez un HTML. Esta intención continúa vigente salvo que el usuario la cambie.

- Usa el checkout existente. Cada tarea de nube ya está aislada; no crees worktrees salvo petición expresa.
- Conserva `mi-economia-encrypted-v1` y la compatibilidad de sus copias. Nunca pidas por el chat la contraseña del almacén, tokens de alojamiento ni claves bancarias.
- Los datos financieros siguen cifrados en el navegador. La web solo distribuye código genérico: no incluyas extractos, saldos personales, copias JSON, HTML portátiles con `encrypted-data`, carpetas de descargas ni adjuntos en Git o en `dist/`.
- Comprueba los cambios con `npm test` y `npm run build`. Usa `scripts/build.mjs`, que publica solo la lista permitida de recursos. Respeta el actualizador de URL estable y los hashes de los demás recursos.
- El despliegue privado requiere Cloudflare Access y las variables documentadas en `DEPLOYMENT.md`. No lo sustituyas por una web pública ni desactives la autenticación para resolver un fallo de configuración.
- Una vez que el usuario haya conectado y activado el despliegue privado, las mejoras solicitadas incluyen probar, guardar los cambios en Git y enviarlos a la rama de despliegue para ejecutar el workflow. Respeta las protecciones de rama y no fuerces pushes. Si una tarea pide solo revisión o no publicar, respeta esa limitación.
- No publiques cada mensaje del chat ni conviertas información financiera privada en código público. Los cambios del programa requieren implementación, comprobaciones y una publicación correcta; los saldos reales se mantienen dentro del almacén cifrado del usuario.
- Antes de afirmar que una publicación está disponible, verifica su resultado y el control de acceso. Una compilación local, un commit o un workflow preparado no acreditan una URL operativa.
- Si falta autorización del proveedor, conserva el resultado listo y explica el requisito externo concreto. Nunca inventes una dirección, un despliegue completado ni capacidad de acceder al dispositivo del usuario.
