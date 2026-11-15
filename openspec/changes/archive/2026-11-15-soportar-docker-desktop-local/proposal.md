# Proposal

## Why

AT-188 tiene 17/18 tareas verificadas y no puede acreditar carga runtime porque sandbox-control rechaza macOS antes de inspeccionar el motor. El operador autorizó ampliar compatibilidad para aprovechar Docker Desktop local, cuyo daemon Linux ya responde; no autoriza falsear plataforma ni reducir aislamiento.

## What Changes

- Admitir macOS únicamente con endpoint Unix local verificado y motor Linux identificado como Docker Desktop; conservar Linux/WSL2 y rechazar Windows nativo, endpoints remotos y motores incompatibles.
- Sustituir la conclusión basada solo en process.platform por inspección compartida, de solo lectura y sin recursos, entre preflight y start.
- Vincular las operaciones de una ejecución al endpoint e identidad de daemon verificados; un cambio de contexto, un reinicio no verificable o una identidad distinta no autoriza limpieza en otro motor.
- Registrar plataforma cliente, tipo de motor, identidad y condiciones de aislamiento en evidencia externa, sin credenciales ni entorno completo.
- Conservar cuota exclusiva, captura independiente, límites, ausencia de privilegios/socket/montaje original, red interna y puertos loopback.
- Preparar la prueba explícita de carga única de plugins para AT-188 con configuración declarada. Usar como única dependencia aprovisionable la imagen oficial OpenCode v2.2.7 fijada por digest multiarch, declarada expresamente en la fixture; cualquier otra imagen/paquete o tag flotante sigue bloqueado y nunca se instala automáticamente.
- Migrar sandbox-control y worktree-control al entrypoint y registro de herramientas OpenCode V2, conservando los nombres, contratos de argumentos y límites de seguridad de sus herramientas.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `docker-test-sandbox`: añadir Docker Desktop local en macOS al contrato de host e identificar/vincular el motor de cada ejecución sin relajar sus límites.

## Impact

`plugins/sandbox-control/docker-adapter.mjs`, `index.js`, `lifecycle.mjs` y rutas de limpieza/supervisor que emitan operaciones Docker; `plugins/worktree-control/index.js` y su adaptación al API worktree V2; sus pruebas, guía y acceptance-harness. Fixture declarada y prueba runtime de AT-188, cuya acreditación queda pendiente hasta observar OpenCode real dentro del sandbox. No se toca configuración global, credenciales, agentes/modelos ni servicios de otros proyectos.

Los cambios locales de AT-188 se conservan en la rama actual. Este cambio habilita el entorno, pero solo el resultado runtime satisfactorio puede completar la tarea 4.5 de instalar-manifiesto-recursos.
