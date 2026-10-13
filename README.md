# Escudo 🛡️

**Bitácora cifrada y sin internet para víctimas de extorsión en el Perú.**

Escudo ayuda a quien recibe amenazas de extorsión a **registrar cada amenaza, conservar las pruebas sin que se alteren y llegar a la comisaría con un informe ordenado**. Funciona en cualquier celular con navegador, sin internet y sin crear cuentas. Todo queda **cifrado y solo en el teléfono** de la víctima.

> Escudo no reemplaza la denuncia ni la asesoría legal. Si estás en peligro ahora mismo, llama al **105**.

---

## ¿Por qué existe?

La extorsión es el delito que más crece en el Perú:

- La Fiscalía registró **13 892 denuncias de extorsión entre enero y julio de 2026** y proyecta unas **32 000 al cierre del año**. Fueron unas 11 000 en 2022 y 27 500 en 2025 ([América TV, 03/09/2026](https://www.americatv.com.pe/noticias/actualidad/fiscalia-reporta-14-mil-casos-extorsion-2026-n522272)).
- Más de **60 choferes asesinados** en lo que va de 2026, según la PNP ([Caretas](https://caretas.pe/?p=829452)).
- **9 de cada 10 peruanos se sienten inseguros**, y la extorsión es el segundo delito que más temen ([Gestión / Ipsos, 31/03/2026](https://gestion.pe/peru/nueve-de-cada-10-peruanos-se-sienten-inseguros-los-delitos-de-mayor-riesgo-noticia/)).
- La Policía pide a las víctimas **"grabar y conservar los mensajes"** y denunciar cuanto antes ([El Peruano](https://www.elperuano.pe/noticia/216147-campana-yo-no-caigo-en-la-extorsion-yo-denuncio-revisa-estas-recomendaciones)). En la práctica, muchas pruebas se pierden: chats borrados, celulares cambiados, capturas sin fecha y números anotados en papeles.

No existía una herramienta abierta, gratuita y pensada para el Perú que ayudara a la víctima en ese momento. Escudo cubre ese vacío.

## Qué hace

| Función | Para qué sirve |
| --- | --- |
| **Registrar amenazas** | Fecha y hora, canal (llamada, WhatsApp, SMS, redes, en persona, carta), número o perfil, monto exigido, Yape/Plin/cuenta indicada, mensaje literal y descripción. |
| **Guardar pruebas** | Capturas, audios, videos, fotos o PDF, cifrados dentro del teléfono. |
| **Huella de cada prueba** | Calcula el SHA-256 del archivo al registrarlo. Si luego el original da la misma huella, no fue modificado. |
| **Bitácora encadenada** | Cada registro guarda la huella del anterior. Editar, borrar o reordenar algo rompe la cadena y se detecta. Las correcciones se agregan como notas, sin tocar el original. |
| **Informe para la denuncia** | Resumen (números y cuentas que se repiten, monto máximo, fechas) y detalle cronológico. Se imprime, se guarda como PDF, se copia como texto o se comparte. |
| **Guía y contactos** | Qué hacer paso a paso y a quién llamar (111, 105, 1818, Dirincri), con fuente y fecha de verificación. Se puede ver sin abrir la bitácora. |
| **Salida rápida** | Un botón que cierra la app y abre una página inofensiva. La bitácora también se bloquea sola si la app queda 2 minutos en segundo plano. |
| **Copia de seguridad** | Archivo cifrado para guardar en otro teléfono de confianza. Sin la contraseña no sirve. |
| **Sin internet** | Después de la primera visita funciona sin conexión (PWA). Se puede "instalar" en la pantalla de inicio. |

## Privacidad y seguridad

- **No hay servidor.** Escudo es una página estática. Nada de lo que escribes sale del teléfono, salvo que tú descargues o compartas el informe o la copia.
- **Cifrado:** la clave se deriva de tu contraseña con PBKDF2-SHA256 (210 000 iteraciones) y los datos se cifran con AES-GCM de 256 bits, usando la Web Crypto API del navegador. No hay dependencias externas.
- **Política de seguridad de contenido estricta:** la app no carga scripts de terceros ni puede enviar datos a otros dominios.
- **Si olvidas la contraseña, nadie puede recuperar los datos.** Es a propósito.

**Límites que debes conocer** (más detalle en [SECURITY.md](SECURITY.md)):

- Si alguien tiene tu celular **desbloqueado y con Escudo abierto**, puede ver la información. Usa la salida rápida y el bloqueo automático.
- Una contraseña corta puede adivinarse con tiempo si alguien copia los datos del teléfono. Usa una frase larga.
- La huella prueba que un archivo **no cambió desde que se registró**, no quién lo envió. No reemplaza el peritaje: **no borres los originales** de tu celular, la Policía puede pedirlos.
- Borrar los datos del navegador borra la bitácora. Haz copias de seguridad.

## Cómo usarlo

1. Abre la app desde el navegador del celular (Chrome, Firefox, Samsung Internet, Safari).
2. Crea una contraseña.
3. Cada vez que recibas una amenaza, entra a **Registrar**, llena lo que sepas y adjunta las capturas o audios.
4. Antes de ir a la comisaría, entra a **Informe** → *Comprobar que nada fue alterado* → *Ver informe para imprimir o guardar en PDF*.
5. Ve a la comisaría o al Depincri con el informe **y con tu celular**.

## Probarlo en tu computadora

Requiere [Node.js](https://nodejs.org/) 20 o superior. No hay que instalar dependencias.

```bash
git clone https://github.com/Louis-689/escudo-pe.git
cd escudo-pe
npm start        # abre http://localhost:8080
npm test         # corre los tests
```

> El cifrado del navegador solo funciona en `https://` o en `localhost`. Si abres `index.html` directamente como archivo, no funcionará.

## Publicarlo gratis (GitHub Pages)

El repositorio incluye `.github/workflows/pages.yml`. En GitHub ve a **Settings → Pages → Source: GitHub Actions**. Cada cambio en `main` corre los tests y publica la app en `https://<tu-usuario>.github.io/escudo-pe/`.

Cualquier persona u organización (municipalidad, gremio de transportistas, asociación de bodegueros, ONG) puede publicar su propia copia en su dominio.

## Estructura

```
index.html            Interfaz (una sola página)
css/app.css           Estilos (modo claro y oscuro, pensado para pantallas pequeñas)
js/app.js             Lógica de la interfaz
js/core/crypto.js     Cifrado y huellas (Web Crypto)
js/core/model.js      Validación, normalización, cadena de huellas y resumen
js/core/vault.js      Bóveda cifrada: crear, abrir, agregar, verificar, copias
js/core/storage.js    IndexedDB (navegador) y memoria (tests)
js/core/report.js     Informe en texto y HTML
js/data/contacts.js   Contactos oficiales y pasos a seguir (con fuentes)
sw.js                 Service worker para uso sin internet
tests/                Tests con node:test (sin dependencias)
```

Todo es JavaScript sin compilar ni dependencias, para que cualquiera pueda auditarlo.

## Contribuir

Las contribuciones son bienvenidas. Lee [CONTRIBUTING.md](CONTRIBUTING.md). Hay tres formas muy útiles de ayudar:

- **Mantener los contactos al día** en `js/data/contacts.js`, siempre con fuente.
- **Probar en celulares de gama baja** y reportar problemas.
- **Revisión legal:** abogados y abogadas que nos ayuden a que el informe sea lo más útil posible para la Policía y la Fiscalía.

## Ideas para siguientes versiones

- Grabación de llamadas y audio directamente desde la app.
- Traducción al quechua y aimara.
- Exportar en el formato que pida la PNP o el Ministerio Público.
- Modo "camuflado" (que la app parezca una calculadora o una libreta de notas).
- Compartir la bitácora, cifrada, con un familiar de confianza.

## Licencia

[MIT](LICENSE). Úsalo, cópialo y mejóralo libremente.
