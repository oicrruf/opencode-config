# Proposal

## Why

AT-188 requiere verificar y actualizar la instalación global sin desplazar recursos ajenos ni modificaciones locales. El instalador no registra propiedad, `doctor` todavía trata el root renderizado como symlink y `sandbox-control` no se distribuye junto a `worktree-control`.

## What Changes

- Registrar recursos administrados, perfil, tipo, origen y digest del root en un manifiesto local versionado.
- Preparar y validar un plan completo antes de escribir; conflictos, manifiesto inválido o rutas inseguras detienen la instalación sin mutar sus destinos.
- Adoptar una instalación anterior sin manifiesto únicamente cuando sus enlaces apunten exactamente a los recursos conocidos del checkout y el root regular coincida con un render completo de un perfil conocido. Preservar cualquier contenido diferente.
- Conservar recursos administrados modificados y recursos Herdr ajenos; retirar obsoletos solo si su identidad aún coincide con la registrada.
- Incorporar `--check` sin escrituras y códigos de salida explícitos, usando el perfil registrado salvo selección explícita.
- Compartir inventario y diagnóstico entre instalación y doctor; comprobar el root como archivo renderizado y detectar drift, enlaces incorrectos y configuraciones ambiguas.
- Distribuir ambos plugins una sola vez y verificar por separado inventario estático y carga efectiva mediante sandbox.

## Capabilities

### New Capabilities

- `installation-resource-manifest`: propiedad, migración, comprobación, diagnóstico y distribución de los recursos globales de OpenCode.

### Modified Capabilities

- `installer-portability`: modo de comprobación sin escrituras y resultados explícitos, conservando las cuatro shells soportadas.
- `doctor-agent`: diagnóstico del root renderizado y reparación limitada a ausencias con propiedad acreditada, conservando recursos modificados y la instalación de herramientas existente.

## Impact

`install.sh`, `scripts/resource-manifest.mjs`, `scripts/render-config.mjs`, `scripts/doctor.mjs`, validadores, acceptance harness y pruebas de instalación/diagnóstico; documentación README/AGENTS y distribución de los entrypoints existentes de sandbox y worktree.

No se cambian modelos, permisos de producto, budgets, política de retiro de worktrees ni aislamiento del sandbox. Las pruebas usan directorios temporales y capturas independientes; no activan la configuración global real. AT-189 sigue siendo responsable de actualización desde Git y compatibilidad de versiones de herramientas.
