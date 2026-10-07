import type { Textos } from "./pt";

// Textos del Hub en español (docs/22 §5).

export const es: Textos = {
  marca: "Eurolify Hub",
  saltarParaConteudo: "Saltar al contenido",
  lingua: "Idioma",
  sair: "Salir",
  aCarregar: "Cargando…",
  tentarOutraVez: "Intentar de nuevo",

  entrarTitulo: "Entrar en el Hub",
  entrarExplicacao:
    "Entre con la passkey de este dispositivo o de un móvil cercano.",
  entrarBotao: "Entrar con passkey",
  entrarAEspera: "Esperando la passkey…",
  entrarCancelado: "Se canceló la passkey. Puede intentarlo de nuevo.",
  semPasskeys:
    "Este navegador no admite passkeys. Use un navegador actual (Chrome, Edge, Firefox o Safari).",

  conviteTitulo: "Aceptar la invitación",
  conviteExplicacao:
    "Le han invitado a trabajar en el Hub de un comerciante. Escriba su nombre y cree la cuenta con una passkey.",
  conviteNome: "Su nombre",
  conviteBotao: "Crear la cuenta con una passkey",
  conviteSemSegredo:
    "Este enlace no tiene invitación. Abra el enlace completo que recibió.",
  conviteContaExiste:
    "Este correo ya tiene cuenta. Aceptar una invitación con una cuenta existente aún no es posible en esta pantalla; hable con quien le invitó.",

  codigosTitulo: "Sus códigos de recuperación",
  codigosExplicacao:
    "Si pierde la passkey, uno de estos códigos le devuelve la cuenta. Cada uno sirve una vez.",
  codigosAviso:
    "No volverán a aparecer. Guárdelos ahora en un lugar seguro, fuera de este ordenador.",
  copiar: "Copiar",
  copiado: "Copiado",
  codigosGuardados: "Ya los he guardado",

  inicioTitulo: "Sus comerciantes",
  inicioEntrouComo: "Ha entrado como",
  inicioVazio:
    "No pertenece a ningún equipo. Pida una invitación a quien gestiona el comerciante.",
  verEquipa: "Ver el equipo",

  papel_dono: "Propietario",
  papel_gestor: "Gestor",
  papel_armazem: "Almacén",
  papel_apoio: "Soporte",

  equipaTitulo: "Equipo",
  equipaVoltar: "Sus comerciantes",
  equipaMembros: "Miembros",
  equipaContagem: "{n} miembros",
  equipaContagemUm: "1 miembro",
  colunaNome: "Nombre",
  colunaEmail: "Correo",
  colunaPapel: "Función",
  colunaDesde: "Desde",
  colunaExpira: "Caduca",
  colunaAccoes: "Acciones",
  convitesTitulo: "Invitaciones abiertas",
  convitesVazio: "No hay invitaciones abiertas.",
  convitesContagem: "{n} invitaciones abiertas",
  convitesContagemUm: "1 invitación abierta",
  cancelarConvite: "Cancelar",
  cancelarConfirmar: "¿Cancelar la invitación para {email}?",
  conviteCancelado: "Se canceló la invitación.",

  convidarTitulo: "Invitar",
  convidarEmail: "Correo del invitado",
  convidarPapel: "Función",
  convidarBotao: "Crear la invitación",
  convidarLigacao: "Enlace de la invitación",
  convidarAviso:
    "Este enlace solo aparece ahora. Envíelo al invitado; vale una vez, 7 días. Pídale que lo abra en su propio ordenador o en una ventana privada: el navegador lo guarda en el historial.",
  convidarOutro: "Cerrar",

  erroGenerico: "Se produjo un error. Inténtelo de nuevo.",
  erroReferencia: "Referencia: {ref}",
  erroSemPermissao: "No tiene permiso para esto.",
  erroSemSessao: "La sesión ha terminado. Entre de nuevo.",
  erroMuitosPedidos:
    "Demasiadas solicitudes desde esta dirección. Inténtelo dentro de {s} segundos.",
  erroBloqueado: "Demasiados intentos. Inténtelo dentro de 15 minutos.",
  erroEntrada: "No se pudo entrar con esta passkey.",
  erroConviteInvalido:
    "Esta invitación no es válida: caducó, ya se usó o se canceló.",
  erroNome: "El nombre debe tener entre 1 y 100 caracteres.",
  erroEmail: "Escriba un correo válido.",
  copiarFalhou: "No se pudo copiar. Seleccione el texto y cópielo a mano.",
  erroComercianteInactivo:
    "Este comerciante está suspendido o cerrado: no puede invitar ni cambiar el equipo.",
  erroConviteUsado: "Esta invitación ya se aceptó o se canceló.",
  erroPapel: "No puede dar esta función.",
  erroOcupado: "El servicio está ocupado. Inténtelo dentro de un momento.",
  erroOrigem:
    "Solicitud rechazada por venir de otro sitio. Abra el Hub desde la dirección habitual.",
  erroRecente:
    "Esta operación pide que confirme la passkey. Inténtelo de nuevo.",
  erroRede:
    "Sin conexión con el servidor. Compruebe la red e inténtelo de nuevo.",
};
