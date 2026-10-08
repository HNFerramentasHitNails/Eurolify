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

  // Mi cuenta y recuperar (docs/22 §9.1).
  contaTitulo: "Mi cuenta",
  contaLigacao: "Cuenta",
  passkeysTitulo: "Passkeys",
  passkeysContagem: "{n} passkeys",
  passkeysContagemUm: "1 passkey",
  passkeysConselho:
    "Solo tiene una passkey. Registre una segunda en otro dispositivo: si pierde esta, entra con la otra.",
  colunaCriadaEm: "Creada el",
  colunaUltimoUso: "Último uso",
  nunca: "Nunca",
  passkeyNome: "Nombre de esta passkey (p. ej.: Móvil)",
  passkeyAcrescentar: "Añadir passkey",
  passkeyAcrescentada: "Se añadió la passkey.",
  passkeyRetirar: "Quitar",
  passkeyRetirarConfirmar:
    "¿Quitar la passkey «{nome}»? Las demás sesiones abiertas terminan; esta continúa.",
  passkeyRetirada: "Se quitó la passkey. Las demás sesiones terminaron.",
  sessoesTitulo: "Sesiones abiertas",
  sessoesContagem: "{n} sesiones abiertas",
  sessoesContagemUm: "1 sesión abierta",
  sessaoEsta: "Esta sesión",
  sessoesTerminar: "Terminar todas las demás",
  sessoesTerminarConfirmar:
    "¿Terminar todas las demás sesiones? Quien esté en ellas tendrá que entrar de nuevo.",
  sessoesTerminadas: "Las demás sesiones terminaron.",
  recuperacaoTitulo: "Códigos de recuperación",
  recuperacaoExplicacao:
    "Si pierde todas las passkeys, un código de recuperación le devuelve la cuenta. Generar códigos nuevos anula los anteriores.",
  codigosGerar: "Generar códigos nuevos",
  codigosGerarConfirmar:
    "¿Generar 10 códigos nuevos? Los anteriores dejan de valer.",
  erroUltimaPasskey:
    "Es la última forma de entrar en la cuenta. Añada otra passkey antes de quitar esta.",
  erroPasskeyJaRegistada:
    "Este dispositivo ya tiene una passkey de esta cuenta.",
  erroPasskeyNaoExiste: "Esta passkey ya no existe en la cuenta.",
  erroNomePasskey:
    "El nombre de la passkey debe tener entre 1 y 100 caracteres.",

  entrarPerdeu: "¿Perdió la passkey?",
  recuperarTitulo: "Recuperar la cuenta",
  recuperarExplicacao:
    "Con el correo de la cuenta y uno de los códigos de recuperación, registre una passkey nueva en este dispositivo. El código usado deja de valer.",
  recuperarEmail: "Correo de la cuenta",
  recuperarCodigo: "Código de recuperación",
  recuperarCodigoAjuda: "Tiene el formato XXXX-XXXX-XXXX-XXXX.",
  recuperarNome: "Nombre de la passkey nueva (opcional)",
  recuperarBotao: "Recuperar con una passkey nueva",
  recuperarVoltar: "Entrar con una passkey",
  erroRecuperar:
    "El correo o el código no son correctos, o el código ya se usó.",
  erroCodigo:
    "Escriba el código de recuperación completo: 16 letras y números.",
  recuperadoTitulo: "Se recuperó la cuenta",
  recuperadoTexto:
    "Las demás sesiones terminaron y el código usado ya no vale. Falta:",
  recuperadoRetirar:
    "quitar las passkeys que ya no tiene (la del dispositivo perdido sigue valiendo hasta que la quite);",
  recuperadoCodigos: "generar códigos de recuperación nuevos;",
  recuperadoChaves: "como propietario, revisar las claves de API que creó.",
  recuperadoFechar: "Cerrar el aviso",
};
