# Proposal

## Why

AT-200 necesita una interfaz validada para construir, reconstruir y transferir el sandbox desde el checkout efectivo. El destino ya captura, aísla, reporta y cierra ejecuciones, pero carece de un reemplazo serializado y de transferencia entre sesiones sin revelar el token anterior.

## What Changes

- Añadir `/sandbox` con ayuda y sintaxis exacta `build|rebuild|transfer <config.json>`, respaldada por validación ejecutable y rechazo previo a efectos.
- Vincular configuración, captura e identidad del trabajo al checkout efectivo de la sesión V2; mantener el estado y la cuota comunes al proyecto.
- Mantener el JSON de configuración fuera de la captura, con huella y parámetros sin secretos como evidencia externa y comprobación de estabilidad durante la captura, según la decisión del operador.
- Reconstruir mediante una transición exclusiva que preserve reporte externo, verifique el cierre y mantenga la reserva hasta entregar el nuevo arranque, sin ventana de cuota libre.
- Transferir explícitamente un sandbox del mismo trabajo a la sesión verificada que lo solicita, comprobando propiedad, operaciones pendientes y recursos; rotar la capacidad privada sin pedir ni publicar el token anterior.
- Mantener herramientas existentes, aislamiento, dependencias preparadas por el operador y ausencia de efectos en Git/Linear. Documentar activación, recuperación y rollback de registros nuevos.

## Capabilities

### New Capabilities

- Ninguna; la interfaz y el ciclo de vida amplían los contratos existentes.

### Modified Capabilities

- `docker-test-sandbox`: comando validado, origen efectivo, reemplazo con reporte/cierre verificados y transferencia de sesión.
- `local-execution-reservation`: reserva continua, exclusión y generaciones para reemplazo; excepción explícita de transferencia de sandbox al contrato de propietario, sin habilitar apropiación de aplicaciones manuales.

## Impact

- `docs/contracts/sandbox-command.md` y un executor nativo V2 con parser/dispatcher ejecutable del comando; nuevas herramientas `sandbox_build`, `sandbox_rebuild` y `sandbox_transfer`.
- `plugins/sandbox-control/{index.js,lifecycle.mjs,reservation.mjs,sandbox-config.mjs,execution.mjs}` y módulos auxiliares acotados para origen, exclusión y transiciones; adaptador V2 compartido solo si hace falta para contexto verificado.
- Pruebas del control, integración V2, validadores/harness pertinentes y guía de operación/activación. Sin cambios de modelos, dependencias nuevas ni ampliación de permisos de agentes.
- Referencia inspeccionada en el commit `79e679ad394ce0cce69cf36607228936feeca3fb` del repositorio CEREBR4L; se adapta al destino, sin copiar sus APIs ni su almacenamiento de capacidades.
- Base inspeccionada: `f0b4929`; `origin/main` registrado está un commit por delante con cambios de worktrees/adaptador. Reconciliar la base antes de aplicar. Esta propuesta no publica, instala, cambia Linear ni autoriza merge/cierre.
