# Cómo contribuir

¡Gracias por querer ayudar! Escudo lo usan personas en situaciones de mucho riesgo, así que priorizamos **simplicidad, privacidad y que funcione en celulares básicos**.

## Reglas del proyecto

1. **Nada sale del teléfono.** No se aceptan analíticas, rastreadores, fuentes, CDNs ni servicios externos.
2. **Sin dependencias ni compilación.** JavaScript moderno (módulos ES) que corre tal cual en el navegador. Así cualquiera puede auditar el código.
3. **Español claro.** Textos cortos, sin jerga técnica, pensando en alguien asustado y con prisa.
4. **Toda lógica en `js/core/` lleva tests.** Corre `npm test` antes de enviar tu PR.
5. **Contactos con fuente.** Todo número en `js/data/contacts.js` debe tener un enlace a una fuente oficial o periodística. Actualiza `VERIFICADO`.
6. Si agregas o renombras archivos de la app, añádelos a `sw.js` y sube la versión de `CACHE` (un test lo comprueba).

## Flujo

```bash
git checkout -b mi-mejora
npm start   # prueba en http://localhost:8080
npm test
```

Abre un pull request explicando qué cambia para la persona que usa la app.
