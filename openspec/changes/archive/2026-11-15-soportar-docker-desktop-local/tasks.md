# Tasks

## 1. Inspección del motor local y contrato de soporte

- [x] 1.1 Implementar inspección compartida de plataforma, endpoint efectivo e identidad/metadatos mínimos del daemon sin shell ni mutaciones; probar precedencia de contexto y overrides, respuestas inválidas, Unix local, TCP/SSH/HTTP, datos vacíos y errores sanitizados sin crear reservas o recursos.
- [x] 1.2 Añadir decisión explícita para macOS + Docker Desktop + Linux, preservar Linux/WSL2 y rechazar Windows nativo/otros motores; probar matriz Linux/macOS positiva/negativa y actualizar GUIDE.md con requisitos y límites observables, sin equiparar CLI/version/context name con soporte.

## 2. Binding durante el ciclo completo

- [x] 2.1 Integrar la inspección en sandbox_preflight y startSandbox antes de reserva/captura; probar coherencia de diagnóstico y bloqueo previo sin efectos en lifecycle/boundaries, conservando todos los escenarios existentes.
- [x] 2.2 Persistir binding y usar un ejecutor Docker explícitamente ligado a él para build/run/inspect/finish/cancel/cleanup/recover/supervisor; probar cambios de contexto/entorno, reinicio de coordinador, daemon distinto/inaccesible y ausencia de operaciones destructivas o liberación ante incertidumbre.
- [x] 2.3 Documentar y probar recuperación de registros antiguos sin binding y rollback de soporte, conservando reservas/evidencia y recursos ajenos en lugar de adoptar el daemon ambiente; mantener pruebas de exclusividad e identidad de recursos y ausencia verificada.

## 3. Fixture runtime de AT-188 e integridad de aislamiento

- [x] 3.1 Portar sandbox-control y worktree-control al entrypoint y API de herramientas/worktree V2, preservando adaptadores V1 existentes y contratos de las herramientas; añadir pruebas unitarias del registro, nombres, esquemas, contexto y fallo cerrado. Preparar después la configuración y Dockerfile explícitos de la fixture AT-188 sobre la imagen oficial OpenCode 2.2.7, digest multiarch fijado y HOME/XDG aislados; provisionar solo ese digest autorizado, añadir preflight reproducible y verificar la interfaz pública de la versión fijada.
- [x] 3.2 Ejecutar mediante sandbox-control la fixture real en Docker Desktop y observar OpenCode cargando una vez las herramientas sandbox/worktree desde la instalación temporal; preservar versión, configuración cargada, fingerprint de captura, observaciones y resultado fuera del entorno en `runtime-evidence.json`.
- [x] 3.3 Verificar en esa ejecución captura independiente, red interna, ausencia de publicaciones de puerto en esta fixture (y loopback-only para cualquier publicación declarada), límites, ausencia de socket/montaje original/privilegios y rechazo de un segundo inicio; preservar reporte antes de limpiar solo recursos propios y acreditar ausencia antes de liberar reserva. Documentar condiciones y diferencias del cliente macOS frente a Linux nativo.

## 4. Integración y cierre con evidencia

- [x] 4.1 Alinear acceptance-harness y pruebas de sandbox con el nuevo contrato; ejecutar suites pertinentes, validate-config personal/work, perfiles, acceptance y OpenSpec strict junto a diff --check, registrar resultados y separar negativos simulados de observaciones reales.
- [x] 4.2 Realizar la revisión adversarial final requerida por el límite de compatibilidad/selección de motor; resolver hallazgos introducidos materiales y aplicar el gate de re-review existente, documentando riesgos no verificados y pruebas efectivamente realizadas.
- [x] 4.3 Actualizar evidencia y seguimiento de AT-188 con resultados actuales; completar instalar-manifiesto-recursos 4.5 solo si el reporte real acredita todos sus criterios, sin convertir un arranque/importación o un bloqueo en prueba aprobada.
