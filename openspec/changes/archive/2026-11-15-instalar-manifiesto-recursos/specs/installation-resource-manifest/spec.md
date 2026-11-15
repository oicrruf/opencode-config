# Spec Delta

## Purpose

Permitir instalar, comprobar y diagnosticar los recursos globales de OpenCode con propiedad verificable, preservando archivos ajenos y separando distribución de acreditación runtime.

## ADDED Requirements

### Requirement: Installed resources are recorded in a manifest

El sistema SHALL registrar versión, perfil y recursos administrados con tipo, destino seguro y origen o digest en un manifiesto local validado. SHALL compartir el inventario entre instalación, comprobación y diagnóstico, sin reclamar rutas ajenas.

#### Scenario: Instalación nueva
- **WHEN** no existe manifiesto ni conflicto y los destinos están ausentes
- **THEN** SHALL instalar los recursos esperados y registrar su identidad con escritura atómica del manifiesto

#### Scenario: Registro inválido
- **WHEN** el manifiesto está corrupto, tiene versión no soportada, campos inválidos, rutas inseguras o identidades duplicadas
- **THEN** SHALL informar el error antes de modificar destinos, sin tratarlo como primera instalación

#### Scenario: Padre enlazado
- **WHEN** una ruta administrada atraviesa un padre inseguro o el manifiesto es un enlace
- **THEN** SHALL rechazar la operación sin escribir a través del enlace

### Requirement: Legacy installation is adopted only with exact evidence

Sin manifiesto el sistema SHALL adoptar únicamente enlaces exactos a recursos conocidos del checkout y un root verificable como render completo de un perfil conocido. SHALL preservar cualquier archivo modificado o recurso ajeno. Una coincidencia ambigua SHALL requerir selección explícita antes de adoptar.

#### Scenario: Enlaces y render anteriores conocidos
- **WHEN** una instalación anterior sin manifiesto coincide exactamente con orígenes y perfil conocidos
- **THEN** SHALL permitir registrar su propiedad y conservarla sin reemplazos innecesarios

#### Scenario: Root ajeno o editado
- **WHEN** un root existente no coincide con ningún render acreditado o un destino es ajeno
- **THEN** SHALL conservarlo y reportar conflicto sin ejecutar la instalación

### Requirement: Foreign resources are reported instead of replaced

El sistema SHALL preparar y validar el plan completo antes de mutar destinos. Un recurso registrado sustituido o cuyo digest cambió SHALL ser conflicto. Un conflicto activo SHALL detener la aplicación antes de la primera mutación; SHALL NOT moverlo a backup para tomar su ubicación. Los recursos Herdr ajenos SHALL conservarse.

#### Scenario: Directorio de skills ajeno
- **WHEN** el destino skills es un directorio real no administrado
- **THEN** SHALL informar conflicto y dejar todos los destinos de instalación sin cambios

#### Scenario: Enlace modificado
- **WHEN** el operador sustituye un enlace registrado por otro origen
- **THEN** SHALL preservar el enlace y su destino y SHALL NOT repararlo sobrescribiéndolo

#### Scenario: Recurso propio ausente
- **WHEN** falta un recurso cuya propiedad registrada es válida y no hay conflictos
- **THEN** SHALL permitir recrearlo desde el origen esperado e informar la reparación

### Requirement: Stale managed resources are removed only when they are unchanged

El sistema SHALL retirar obsoletos solo mientras coincidan con su identidad administrada previa. SHALL conservar los modificados y su procedencia diagnóstica. SHALL NOT borrar recursos heredados solo por nombre o tipo.

#### Scenario: Obsoleto sin cambios
- **WHEN** un recurso deja de distribuirse y conserva su identidad registrada
- **THEN** SHALL retirar solo ese recurso y actualizar el registro

#### Scenario: Obsoleto sustituido
- **WHEN** un obsoleto ya no coincide con su identidad anterior
- **THEN** SHALL conservarlo, informar motivo y mantener la referencia previa para comprobaciones posteriores

### Requirement: Installation is idempotent and recovers conservatively

El sistema SHALL conservar contenido y mtimes cuando el estado ya coincide. SHALL actualizar solo recursos cuya propiedad se mantenga acreditada, serializar aplicaciones concurrentes y revalidar identidades antes de mutar. Ante fallo parcial SHALL conservar estado diagnosticable y SHALL NOT declarar éxito ni propiedad no acreditada.

#### Scenario: Instalación repetida
- **WHEN** se repite la instalación sin diferencias
- **THEN** SHALL informar estado vigente sin reescribir root, enlaces ni manifiesto

#### Scenario: Cambio de perfil sobre root propio
- **WHEN** se selecciona otro perfil válido y el root sigue siendo propio sin modificaciones
- **THEN** SHALL conservar backup único, instalar el nuevo render y registrar perfil y digest

#### Scenario: Fallo parcial o carrera
- **WHEN** falla una escritura o cambia la identidad inspeccionada antes de aplicar
- **THEN** SHALL detener acciones posteriores e informar lo aplicado, lo conservado y lo pendiente sin eliminar trabajo ajeno

### Requirement: Check mode verifies the installed state without mutating it

El sistema SHALL ofrecer comprobación sin crear, modificar, mover o borrar archivos, incluyendo temporales y backups. SHALL comprobar render, perfil, enlaces, recursos distribuidos e instrucciones aplicables; sin perfil explícito SHALL usar el registrado. SHALL devolver 0 sincronizado, 1 diferencias/conflictos y 2 argumentos/estado inválido/error operativo, con motivos por recurso.

#### Scenario: Perfil work instalado
- **WHEN** se comprueba sin --profile una instalación work válida
- **THEN** SHALL comparar contra work sin cambiarlo al perfil predeterminado

#### Scenario: Instalación sin manifiesto o con drift
- **WHEN** falta el manifiesto o hay diferencias verificables
- **THEN** SHALL informar migración pendiente o diferencias y salir no sincronizado sin escrituras ni reparación

#### Scenario: Perfil explícito alternativo
- **WHEN** --check recibe otro perfil válido
- **THEN** SHALL comparar contra ese perfil sin activarlo ni modificar la instalación

### Requirement: Doctor diagnoses the same installed resource contract

Doctor SHALL reconocer root renderizado regular, origen correcto de enlaces, recursos ausentes, drift y configuración efectiva ambigua con las mismas reglas de propiedad. Sus modos de lectura SHALL NOT mutar; su reparación segura SHALL NOT desplazar archivos ajenos ni transformar un root regular en enlace.

#### Scenario: Root regular correcto
- **WHEN** doctor inspecciona un root renderizado válido
- **THEN** SHALL considerarlo archivo administrado y SHALL NOT proponer sustituirlo por symlink

#### Scenario: Configuración ambigua o enlace incorrecto
- **WHEN** hay roots competidores o un enlace apunta a un origen distinto del esperado
- **THEN** SHALL informar la ambigüedad o conflicto sin diagnosticar una instalación sana

### Requirement: Distribution and runtime loading are verified separately

La instalación SHALL distribuir los entrypoints de sandbox-control y worktree-control sin duplicar su descubrimiento. La comprobación estática SHALL distinguir archivo distribuido/importable de plugin efectivamente cargado. La acreditación runtime SHALL usar sandbox-control y SHALL quedar bloqueada si faltan requisitos.

#### Scenario: Distribución correcta sin observación runtime
- **WHEN** ambos entrypoints están instalados y sus imports son resolubles, sin sesión runtime acreditada
- **THEN** SHALL informar distribución verificada y carga runtime no verificada

#### Scenario: Acreditación de carga efectiva
- **WHEN** una sesión OpenCode se ejecuta en sandbox compatible
- **THEN** SHALL verificar las herramientas de ambos plugins una sola vez y registrar evidencia sin modificar la configuración global real

#### Scenario: Sandbox no disponible
- **WHEN** plataforma, Docker o configuración declarada no permiten ejecutar el sandbox
- **THEN** SHALL informar bloqueo y SHALL NOT instalar requisitos ni sustituir la prueba por ejecución directa en el host
