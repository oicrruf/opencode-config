# Tasks

## 1. Base y origen efectivo

- [x] 1.1 Reconciliar la base con el commit pendiente de `origin/main` y verificar estado de AT-188 y registros activos antes de apply; registrar HEAD, diff del adaptador compartido y cualquier bloqueo real sin modificar Linear.
- [x] 1.2 Implementar resolución de checkout/proyecto/trabajo desde sesión V2 e inventario/listing administrado, sin inferencias de rama; probar worktree, subdirectorio, identidad ausente/ambigua y proyecto ajeno con fixtures temporales.
- [x] 1.3 Extender lectura de configuración para una ruta explícita dentro del checkout conservando defaults antiguos y el JSON fuera de la captura con huella/parámetros sin secretos externos; probar JSON fuera de raíz, symlinks, rutas con espacios, main/worktree divergentes, exclusión incluso con include y cambio de configuración durante captura; documentar resolución de rutas en GUIDE.md.

## 2. Reserva y transiciones

- [x] 2.1 Añadir exclusión entre procesos y registros versionados de operación/generación con escritura atómica y recuperación conservadora; probar contención real con procesos separados, escritura interrumpida, identidad desconocida y ausencia de robo por edad.
- [x] 2.2 Hacer que arranque/cierre/recuperación antiguos, reserva manual y supervisor participen en la exclusión común, verificando executionId/generación antes de mutar; probar carreras con barreras y que una autoridad antigua no actúe sobre la sucesora; documentar las fases y compatibilidad de registros.
- [x] 2.3 Propagar sessionID verificado a arranques y ligar nueva propiedad a ejecución, sesión y generación; probar contexto V2 ausente/falsificado y registros legacy sin reescribirlos ni transferirlos automáticamente.

## 3. Construcción, reconstrucción y transferencia

- [x] 3.1 Implementar build con origen/configuración verificados y conservar la API start existente; probar cuota libre/ocupada, captura/configuración coincidentes y ausencia de nuevos recursos en fallos de prerrequisitos.
- [x] 3.2 Implementar rebuild con reserva continua y journal: validar antes de teardown, preservar reporte, cerrar/verificar recursos y captura/secretos, invalidar supervisor y entregar reserva sucesora sin intervalo libre; probar orden observado, nuevo executionId y fallo inyectado en cada fase, incluyendo cleanup fallido con `ok: true` del cierre.
- [x] 3.3 Implementar transferencia explícita del mismo proyecto/trabajo desde sesión V2 con autoridad interna acotada y rotación de verificador, sin pedir ni guardar token anterior; probar transferencia activa, cuota libre, otro trabajo, reserva manual, operación en vuelo y rechazo de autoridad anterior.
- [x] 3.4 Implementar recuperación de transición interrumpida, incluida rotación antes de entregar capacidad; probar interrupción antes/después del reporte, cierre y cambio de generación, preservación de cuota/evidencia y ausencia de arranque automático; documentar recuperación y pasos manuales ante ambigüedad.

## 4. Interfaz e integración V2

- [x] 4.1 Añadir parser puro, executor nativo V2, referencia `docs/contracts/sandbox-command.md` y herramientas build/rebuild/transfer con validación defensiva previa a efectos; probar operaciones exactas, ayuda, vacío, flags, extras, comillas, rutas literales y llamadas inválidas directas sin operaciones de motor/estado.
- [x] 4.2 Registrar las herramientas nuevas una sola vez en V2, conservar campos de herramientas existentes y permisos/modelos actuales; probar contratos V2 y separación entre contexto verificado y argumentos del llamador, e incorporar checks pertinentes al harness sin sustituir evidencia runtime por regex.
- [x] 4.3 Documentar ayuda y ejemplos ejecutables del comando, diferencias build/rebuild/transfer, activación con perfil/sesión nueva, compatibilidad y rollback que preserve reservas/reportes; verificar consistencia con las pruebas del parser y las fases implementadas.

## 5. Verificación integrada y revisión

- [x] 5.1 Ejecutar `node --test plugins/sandbox-control/test/*.test.mjs`, pruebas añadidas de comandos/concurrencia y, si cambia el adaptador compartido, las pruebas afectadas de worktree-control; registrar resultados reales y regresiones.
- [x] 5.2 Ejecutar `node scripts/validate-config.mjs --profile personal`, equivalente para `work`, `node scripts/test-model-profiles.mjs` y `node scripts/acceptance-harness.mjs`; registrar conteos observados, fallos y bloqueos sin asumir el conteo histórico.
- [x] 5.3 Ejecutar fixture de sesión OpenCode y comportamiento runtime mediante sandbox-control con runtime/imagen previamente preparados: verificar carga única V2, comandos inválidos sin llamadas a herramientas, configuración del checkout, reemplazo/transferencia y cierre; preservar reporte externo y marcar blocked si falta dependencia, sin aprovisionarla ni ejecutar el producto en host.
- [x] 5.4 Obtener revisión adversarial del diff final por autorización/cierre destructivo y resolver BLOCKER/MAJOR con re-revisión enfocada según routing; verificar requisitos y tareas contra evidencia y ejecutar `openspec validate sandbox-command-safe-rebuild --strict` y `git diff --check` antes del handoff.
