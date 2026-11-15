# Tasks

## 1. Inventario, propiedad y plan

- [x] 1.1 Implementar inventario compartido y esquema versionado en scripts/resource-manifest.mjs; probar roundtrip, recursos root/agents/commands/skills/TUI/Herdr/worktree/sandbox y rechazo de campos, versiones e identificadores inválidos.
- [x] 1.2 Implementar inspección segura y propiedad por enlace/digest, validando padres y destinos; probar symlinks rotos, padres enlazados, traversal, root editado y recursos ajenos sin seguir escrituras fuera del destino.
- [x] 1.3 Implementar migración sin manifiesto solo de enlaces exactos y render conocido, con perfil explícito ante ambigüedad; probar instalaciones anteriores válidas, root legado conocido y rechazo conservador de contenido diferente.
- [x] 1.4 Implementar plan completo previo y bloqueo ante conflictos activos sin ninguna mutación; verificar snapshots de destinos y ausencia de backups/temporales ante errores y documentar granularidad por enlace.
- [x] 1.5 Implementar retiro de obsoletos propios idénticos y conservación de modificados/procedencia, incluyendo legado autonomy sin propiedad; probar que comprobaciones posteriores siguen informando el pendiente sin borrar archivos ajenos.
- [x] 1.6 Implementar aplicación serializada, revalidación, backups únicos, escrituras atómicas por archivo y recuperación conservadora; probar idempotencia de mtimes, carreras y fallos inyectados antes/durante aplicación con estado diagnosticable.

## 2. Instalador y comprobación

- [x] 2.1 Integrar el helper en install.sh antes de mutaciones, manteniendo resolución Node y rutas Linux/macOS/WSL/Git Bash; verificar fixtures aisladas y documentar migración sin desplazar configuración ajena.
- [x] 2.2 Añadir --check sin escrituras, usando perfil registrado salvo --profile explícito, códigos 0/1/2 y argumentos estrictos; probar filesystem completo antes/después, instalación ausente, perfil work, perfil desconocido y diferencias.
- [x] 2.3 Integrar root regular, cambio de perfil propio y gates existentes sin falsos éxitos; probar personal→work con backup, render fallido, recurso ajeno y omisiones de gates claramente reportadas.
- [x] 2.4 Documentar interfaz, códigos, conflictos, granularidad, activación y rollback conservador en README/AGENTS/help; verificar ejemplos y cuatro shells sin ejecutar instalación sobre configuración real.

## 3. Doctor y distribución

- [x] 3.1 Aplicar el delta doctor-agent y sustituir reglas divergentes de doctor por inspección compartida de root/digest/perfil/enlaces y roots competidores; probar diagnósticos correctos y ausencia de escrituras en check-only/dry-run.
- [x] 3.2 Limitar reparación de recursos en doctor a ausencias con propiedad acreditada y sin conflictos; probar que no reemplaza root regular, Herdr ajeno, enlaces cambiados ni directorios del usuario y documentar límites.
- [x] 3.3 Distribuir sandbox-control y worktree-control desde el inventario común sin duplicados; probar importación de entrypoints instalados, imports relativos y detección de distribución faltante/duplicada sin afirmar carga runtime.

## 4. Gates y evidencia de integración

- [x] 4.1 Alinear validate-config y acceptance-harness con el inventario y las nuevas reglas en lugar de duplicar link() literal; comprobar fixture válida y mutaciones representativas que deben fallar con diagnóstico específico.
- [x] 4.2 Ejecutar pruebas de instalación/doctor con HOME/XDG_CONFIG_HOME temporales, sin fuentes, proveedores ni secretos reales; registrar cobertura de los cinco criterios de AT-188 y resultados de fallos/regresiones.
- [x] 4.3 Ejecutar validate-config para personal/work, test-model-profiles, acceptance-harness, OpenSpec strict y git diff --check; registrar comandos, resultados y deuda previa separada, sin marcar tareas con verificaciones fallidas como completas.
- [x] 4.4 Ejecutar revisión adversarial final requerida por propiedad/rutas/escrituras, resolver hallazgos introducidos materiales y revalidar según el gate de re-review; registrar archivos, evidencia y riesgos no verificados.
- [x] 4.5 Acreditar carga única de herramientas sandbox/worktree en sesión OpenCode mediante sandbox-control con captura independiente, entorno temporal y reporte externo; la fixture V2 de OpenCode 2.2.7 sobre Docker Desktop local observó 17/17 herramientas una sola vez, aislamiento y limpieza verificados. Evidencia: `openspec/changes/archive/2026-11-15-soportar-docker-desktop-local/runtime-evidence.json`.
