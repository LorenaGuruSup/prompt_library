# Prompts como Notas — Extensión de Chrome (MVP)

Estado: **MVP con listas**  · Manifest **V3**  · Idioma UI: **ES**

## Descripción

Extensión para **guardar, organizar y copiar** prompts como notas rápidas dentro de Chrome. Incluye **listas** para categorizar.

## Funcionalidades (alcance del MVP)

* Crear, listar, copiar y borrar prompts.
* Crear, renombrar y eliminar **listas**; filtro por lista.
* Lista **General** por defecto (no se borra).
* Persistencia con `chrome.storage.sync`.

Fuera del MVP: búsqueda textual, variables `{{clave}}`, importar/exportar, favoritos, historial, compartir.

## Arquitectura

* **Manifest v3**
* **Popup**: UI mínima para crear/ver/copiar prompts y gestionar listas.
* **Service worker**: almacenamiento, migraciones básicas, reglas de listas.
* **Sin** content scripts en MVP.

## Requisitos

* Google Chrome con soporte MV3.
* Permisos mínimos: `storage`.

## Instalación (modo desarrollador)

1. Descarga o clona el proyecto.
2. Chrome → `chrome://extensions` → activa **Modo desarrollador**.
3. **Cargar descomprimida** → selecciona la carpeta del proyecto.
4. Pincha el icono en la barra para abrir el **popup**.

## Uso básico

* **Crear lista**: botón “Nueva lista”.
* **Cambiar lista activa**: selector superior.
* **Nuevo prompt**: título + contenido + lista → **Guardar**.
* **Copiar**: botón **Copiar** en cada tarjeta de prompt.
* **Borrar**: icono de eliminar.
* **Eliminar lista**: pide mover o borrar sus prompts; General no se elimina.

## Modelo de datos

**List**
`{ id, nombre, creado_en, actualizado_en, orden }`

**Prompt**
`{ id, titulo, cuerpo, lista_id, creado_en, actualizado_en }`

**Ajustes**
`{ lista_activa_id }`

## Almacenamiento

* Primario: `chrome.storage.sync`.
* Claves: `lists`, `prompts`, `settings`.
* Migración v0→v1: asigna `lista_id = General` a prompts existentes.

## Criterios de aceptación

* CRUD de prompts y listas funciona y persiste.
* Filtro por lista muestra solo sus prompts.
* No hay nombres de listas duplicados.
* Al borrar lista, el usuario decide mover o borrar prompts.
* General siempre existe.

## Métricas básicas

* Nº de listas.
* Prompts por lista.
* Copias realizadas por sesión.

## Seguridad y privacidad

* Sin red. Datos locales sincronizados por Chrome.
* Permisos mínimos.
* Política clara en el README/Options.

## Roadmap breve

* Búsqueda por texto y etiqueta.
* Variables `{{clave}}` con diálogo de relleno.
* Importar/Exportar JSON.
* Favoritos y atajos de teclado.
* Cifrado opcional local (v1.1).

## Estructura de carpetas (sugerida)

```
root/
  manifest.json
  /popup
    index.html
    styles.css
    app.js
  /background
    worker.js
  /_locales/es
    messages.json
  /assets
    icon_16.png
    icon_32.png
    icon_128.png
```

## Licencia

Elige MIT o similar para simplicidad.

## Contribuir

Issues y PRs bienvenidos. Mantén el alcance del MVP en cada cambio.
