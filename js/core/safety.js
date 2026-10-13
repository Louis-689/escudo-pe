// Protección de la víctima: alerta SOS, aviso de trayecto, plan de seguridad
// y blindaje digital. Todo se refiere a la propia víctima y sus contactos de
// confianza; Escudo nunca rastrea a terceros.
//
// Una página web no puede enviar SMS ni WhatsApp sola: Escudo prepara el
// mensaje y abre la app, y la persona solo pulsa "Enviar".

import { classifyPhone } from './indicators.js';

/** Valida un contacto de confianza. Devuelve { nombre, numero } normalizado o lanza error. */
export function normalizeContact({ nombre, numero }) {
  const n = String(nombre ?? '').trim().slice(0, 40);
  const p = classifyPhone(numero) || classifyPhone('+' + String(numero ?? '').replace(/\D/g, ''));
  if (!n) throw new Error('Escribe el nombre del contacto.');
  if (!p) throw new Error('El número no es válido. Ejemplo: 987 654 321.');
  return { nombre: n, numero: p.e164 };
}

export function mapsLink(lat, lon) {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Hora de Lima en formato 24 h ("20:05"), sin importar la zona horaria del celular. */
export function hhmm(date) {
  return date.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * Próxima vez que el reloj de Lima marque "HH:MM" (hoy o mañana).
 * Perú no usa horario de verano: siempre UTC-5.
 */
export function nextLimaTime(value, now = new Date()) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ''));
  if (!m) throw new Error('Indica la hora límite.');
  const today = new Date(now.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
  const d = new Date(`${today}T${m[1]}:${m[2]}:00-05:00`);
  return d > now ? d : new Date(d.getTime() + 24 * 3600 * 1000);
}

function where(ubicacion) {
  if (!ubicacion) return 'No pude obtener mi ubicación.';
  const extra = ubicacion.precision ? ` (precisión aprox. ${Math.round(ubicacion.precision)} m)` : '';
  return `Mi ubicación: ${mapsLink(ubicacion.lat, ubicacion.lon)}${extra}`;
}

export function sosMessage({ ubicacion, ahora = new Date() } = {}) {
  return `🚨 ALERTA: estoy en peligro por una extorsión. ${where(ubicacion)} Hora: ${hhmm(ahora)}. `
    + 'Si no contesto, llama al 105 (Policía) y dales esta ubicación. No me llames si puede ponerme en riesgo; escríbeme.';
}

export function tripMessage({ destino, motivo, hasta, ubicacion, ahora = new Date() }) {
  const d = String(destino ?? '').trim();
  if (!d) throw new Error('Escribe a dónde vas.');
  if (!(hasta instanceof Date) || Number.isNaN(hasta.getTime()) || hasta <= ahora) {
    throw new Error('La hora límite debe ser más tarde que ahora.');
  }
  const m = String(motivo ?? '').trim();
  return `🛡️ AVISO DE SEGURIDAD: voy a ${d}${m ? ` (${m})` : ''}. Salgo a las ${hhmm(ahora)}. `
    + `Si no te escribo "Llegué bien" antes de las ${hhmm(hasta)}, llámame. Si no contesto, llama al 105 y da esta información. `
    + where(ubicacion);
}

export function arrivalMessage({ ahora = new Date() } = {}) {
  return `✅ Llegué bien (${hhmm(ahora)}). Gracias por estar pendiente.`;
}

/** Enlace para abrir WhatsApp con el mensaje listo. */
export function whatsappLink(numero, text) {
  return `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** Enlace para abrir la app de SMS con uno o varios destinatarios y el mensaje listo. */
export function smsLink(numeros, text) {
  // "?&body=" funciona en Android y en iPhone.
  return `sms:${numeros.join(',')}?&body=${encodeURIComponent(text)}`;
}

/** Plan de seguridad personal. Cada punto se marca cuando está hecho. */
export const PLAN = [
  {
    titulo: 'Tu familia',
    items: [
      ['clave', 'Acordamos una palabra clave familiar. Si alguien llama diciendo que tiene a un familiar, pedimos la palabra clave antes de creer nada.'],
      ['ninos', 'Los niños saben con quién pueden irse del colegio y que no deben dar datos por teléfono.'],
      ['avisar', 'Cada familiar sabe a quién avisar y qué hacer si recibe una amenaza.'],
      ['reunion', 'Tenemos un punto de encuentro seguro si hay que salir de casa.'],
    ],
  },
  {
    titulo: 'Tus rutinas',
    items: [
      ['rutas', 'Cambio mis rutas y horarios de entrada y salida.'],
      ['acompanado', 'Abro y cierro el negocio acompañado(a).'],
      ['efectivo', 'No manejo efectivo a la vista ni en horarios fijos.'],
      ['trayecto', 'Uso el aviso de trayecto cuando voy a un lugar riesgoso.'],
    ],
  },
  {
    titulo: 'Tu casa y tu negocio',
    items: [
      ['camara', 'Tengo una cámara o un vecino que pueda ver la entrada.'],
      ['vecinos', 'Me organicé con vecinos o con la junta vecinal para avisarnos.'],
      ['comisaria', 'Tengo a mano el número de la comisaría del sector y del serenazgo.'],
      ['luces', 'La entrada está iluminada y no hay escondites cerca.'],
    ],
  },
  {
    titulo: 'La denuncia',
    items: [
      ['denuncia', 'Presenté la denuncia con el informe de Escudo.'],
      ['proteccion', 'Pedí medidas de protección a la Fiscalía (Unidad de Asistencia a Víctimas y Testigos).'],
      ['copia', 'Guardé una copia de seguridad cifrada fuera de este celular.'],
    ],
  },
];

/** Blindaje digital: cerrar la información que los extorsionadores usan para presionar. */
export const BLINDAJE = [
  {
    titulo: 'WhatsApp',
    pasos: [
      'Ajustes → Privacidad: pon "Mis contactos" en Última vez, Foto de perfil, Info y Estados.',
      'Ajustes → Privacidad → Grupos: "Mis contactos", para que no te agreguen a grupos desconocidos.',
      'Ajustes → Privacidad → Llamadas: activa "Silenciar llamadas de desconocidos".',
      'Ajustes → Cuenta → Verificación en dos pasos: actívala para que nadie pueda robar tu WhatsApp.',
      'Nunca compartas el código de 6 dígitos que te llega por SMS.',
    ],
  },
  {
    titulo: 'Llamadas',
    pasos: [
      'Android: en Teléfono → ⋮ → Configuración → Números bloqueados, activa "Desconocidos" o bloquea cada número.',
      'iPhone: Configuración → Teléfono → Silenciar números desconocidos.',
      'Antes de bloquear, registra el número en Escudo: la Policía lo necesita.',
    ],
  },
  {
    titulo: 'Facebook, Instagram y TikTok',
    pasos: [
      'Pon tus cuentas en privado y oculta tu lista de amigos y familiares.',
      'No publiques en tiempo real dónde estás, tu casa, tu negocio, tus hijos ni su colegio.',
      'Retira fotos con placas de vehículos, fachadas o uniformes escolares.',
      'Si tu negocio necesita redes, usa una cuenta separada sin datos de la familia.',
    ],
  },
  {
    titulo: 'Tu celular',
    pasos: [
      'Pon bloqueo de pantalla con PIN o huella.',
      'Activa "Encontrar mi dispositivo" (Android) o "Buscar mi iPhone" para borrarlo a distancia si te lo roban.',
      'No instales apps que te envíen por mensaje ni abras enlaces de desconocidos.',
    ],
  },
];
