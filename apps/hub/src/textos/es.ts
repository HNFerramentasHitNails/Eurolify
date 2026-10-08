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
    "Este correo ya tiene cuenta. Entre con ella para aceptar la invitación.",

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
    "Esta operación pide que confirme quién es (passkey, o entrar de nuevo). Inténtelo de nuevo.",
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
  erroPasskeyNaoAceite:
    "No se aceptó la passkey: puede ser de otra cuenta, o la solicitud tardó más de 5 minutos. La sesión sigue abierta; inténtelo de nuevo.",
  erroRecuperarPasskey:
    "No se aceptó la passkey nueva, o la solicitud tardó más de 5 minutos. Inténtelo de nuevo.",
  erroReautenticar:
    "Esta operación pide que confirme quién es, y no fue posible con una passkey en este navegador. Salga y vuelva a entrar (con la passkey o con la contraseña) y repita en los 10 minutos siguientes.",
  semPasskeysEntrar:
    "Este navegador no permite passkeys. Entre con la contraseña, si la activó, o use un navegador actual (Chrome, Edge, Firefox o Safari).",
  autenticadorDepois:
    "Al confirmar, las demás sesiones abiertas terminan. Si ya tenía Eurolify en esta aplicación, borre después la entrada anterior.",
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

  // Contraseña y autenticador (docs/22 §9.2).
  palavraPasseTitulo: "Contraseña y autenticador",
  palavraPasseExplicacao:
    "Una alternativa a la passkey: entra con el correo, la contraseña y el código de 6 dígitos de una aplicación de autenticación. La contraseña sola nunca entra.",
  palavraPasseActiva: "Estado: activa.",
  palavraPasseNenhuma: "Estado: no activada.",
  palavraPassePendente:
    "Estado: la activación quedó a medias. Elija la contraseña de nuevo para empezar otra vez.",
  palavraPasseActivar: "Activar contraseña y autenticador",
  palavraPasseTrocar: "Cambiar la contraseña y el autenticador",
  palavraPasseCampo: "Contraseña (12 caracteres o más)",
  palavraPasseRepetir: "Repita la contraseña",
  palavraPasseContinuar: "Continuar",
  cancelar: "Cancelar",
  autenticadorPasso:
    "Lea este código QR con la aplicación de autenticación. Si no puede, escriba el secreto a mano en la aplicación.",
  autenticadorQr: "Código QR para la aplicación de autenticación",
  autenticadorSegredo: "Secreto",
  autenticadorAviso:
    "El código QR y el secreto solo aparecen ahora. No los guarde en otro sitio ni los envíe a nadie.",
  autenticadorCodigo: "Código de 6 dígitos de la aplicación",
  autenticadorConfirmar: "Confirmar y activar",
  palavraPasseActivada:
    "La contraseña y el autenticador quedaron activos. Las demás sesiones terminaron.",
  palavraPasseRetirar: "Quitar la contraseña",
  palavraPasseRetirarConfirmar:
    "¿Quitar la contraseña y el autenticador? Las demás sesiones abiertas terminan; esta continúa.",
  palavraPasseRetirada:
    "Se quitó la contraseña. Las demás sesiones terminaron.",
  erroPalavraPasseCurta: "La contraseña debe tener entre 12 y 256 caracteres.",
  erroPalavraPasseDiferente: "Las dos contraseñas no son iguales.",
  erroCodigoTotp: "Escriba los 6 dígitos del código.",
  erroCodigoTotpErrado:
    "El código no es correcto. Compruebe la hora del móvil y pruebe con el código siguiente.",
  erroPalavraPasseNaoPendente:
    "Esta activación ya no vale (se sustituyó o se completó en otro sitio). Empiece de nuevo.",
  erroPalavraPasseUltima:
    "Es la última forma de entrar en la cuenta. Añada una passkey antes de quitar la contraseña.",
  erroPalavraPasseNaoExiste: "La cuenta ya no tiene contraseña.",

  entrarComPalavraPasse: "Entrar con contraseña",
  entrarEmail: "Correo",
  entrarPalavraPasse: "Contraseña",
  entrarCodigo: "Código de 6 dígitos del autenticador",
  entrarPalavraPasseBotao: "Entrar",
  erroEntrarPalavraPasse:
    "El correo, la contraseña o el código no son correctos.",
  erroPalavraPasseIndisponivel:
    "Entrar con contraseña no está disponible en este servidor.",

  // Claves de API (docs/22 §9.3).
  chavesTitulo: "Claves de API",
  verChaves: "Claves de API",
  chavesExplicacao:
    "Las claves dejan que otros programas (una integración, la facturación, una IA) usen la API de este comerciante. Cada clave solo hace lo que permiten sus ámbitos.",
  chavesVazio: "Todavía no hay claves.",
  chavesContagem: "{n} claves",
  chavesContagemUm: "1 clave",
  colunaTipo: "Tipo",
  colunaAmbitos: "Ámbitos",
  colunaPrefixo: "Empieza por",
  colunaCriadaPor: "Creada por",
  colunaEstado: "Estado",
  tipo_servidor: "Servidor",
  tipo_publica: "Pública (tienda)",
  estadoActiva: "Activa",
  estadoRevogada: "Revocada el {data}",
  estadoExpirada: "Caducó el {data}",
  semPrazo: "Sin plazo",
  autorVoce: "Usted",
  autorOperador: "Operador",
  autorChave: "La clave «{nome}»",
  autorChaveSemNome: "Otra clave",
  autorAntigo: "Alguien que ya salió del equipo",
  ambito_catalog_read: "Leer el catálogo",
  ambito_catalog_write: "Cambiar el catálogo",
  ambito_catalog_publish: "Publicar artículos",
  ambito_catalog_import: "Importar artículos",
  ambito_merchant_read: "Leer los datos del comerciante",
  ambito_merchant_write: "Cambiar los datos del comerciante",
  ambito_keys_write: "Gestionar claves",
  ambito_storefront: "Tienda (solo lectura pública)",
  criarChaveTitulo: "Crear una clave de servidor",
  criarChaveExplicacao:
    "Una clave de servidor se guarda solo en el servidor de quien la usa, nunca en una página ni en una aplicación móvil. Las claves públicas, para la tienda, llegarán con las tiendas.",
  chaveNome: "Nombre (p. ej.: Integración de la facturación)",
  chaveAmbitos: "Lo que la clave puede hacer",
  chaveExpira:
    "Caduca el (opcional; hasta el final de ese día, en la hora de este ordenador)",
  chaveCriar: "Crear la clave",
  chaveSegredoTitulo: "El secreto de la clave «{nome}»",
  chaveSegredoAviso:
    "Solo aparece ahora. Cópielo donde se vaya a usar; si lo pierde, revoque la clave y cree otra.",
  chaveFechar: "Ya lo guardé",
  chaveRevogar: "Revocar",
  chaveRevogarConfirmar:
    "¿Revocar la clave «{nome}»? Deja de funcionar ya, y no hay vuelta atrás.",
  chaveRevogada: "Se revocó la clave.",
  autorDesconhecido: "Sin identificar",
  ambitoKeysAviso:
    "Una clave con «Gestionar claves» puede crear y revocar otras claves de este comerciante: désela solo a quien gestiona las integraciones.",
  erroChaveTalvezCriada:
    "No hubo respuesta del servidor: puede que la clave se haya creado. Si aparece en la lista, el secreto se perdió: revóquela y cree otra.",
  erroChaveAmbitos: "Elija al menos una cosa que la clave pueda hacer.",
  erroChaveExpira: "La fecha de caducidad tiene que ser futura.",
  erroChaveJaRevogada: "Esta clave ya estaba revocada.",
  erroChaveNaoExiste: "Esta clave ya no existe.",
  erroChaveUltimaGestora:
    "Es la última clave que gestiona claves; cree otra antes de revocarla.",
  erroChaveComercianteInactivo:
    "Este comerciante está suspendido o cerrado: no crea claves, pero puede revocarlas.",
  erroChaveAmbitosAMais:
    "No puede dar a una clave ámbitos que su papel no tiene.",

  // La gestión del equipo (docs/22 §10).
  papelMudar: "Cambiar",
  papelMudarRotulo: "Papel de {nome}",
  papelMudarConfirmar:
    "¿Cambiar el papel de {nome} a {papel}? Las claves y las invitaciones que creó y que el papel nuevo ya no permite se cierran.",
  papelMudado: "El papel de {nome} pasó a {papel}.",
  membroTirar: "Quitar del equipo",
  membroTirarConfirmar:
    "{nome} deja de entrar en este comerciante; las invitaciones y las claves que creó aquí se cierran. ¿Continuar?",
  membroTirado: "{nome} salió del equipo.",
  membroSair: "Salir de este equipo",
  membroSairConfirmar:
    "¿Salir de este equipo? Deja de entrar en este comerciante; las invitaciones y las claves que creó aquí se cierran.",
  erroUltimoDono: "Es el último propietario: nombre a otro propietario antes.",
  erroProprioPapel: "Nadie cambia su propio papel.",
  erroMembroNaoExiste: "Este miembro ya no está en el equipo.",
  erroConviteOutraPessoa:
    "Esta invitación es para otro correo. Salga y entre con la cuenta de ese correo.",
  erroJaMembro: "Ya es miembro de este comerciante.",
  conviteEntrarEAceitar: "Entrar con passkey y aceptar",
  conviteSoPalavraPasse:
    "Si entra con contraseña, entre primero en el Hub y vuelva a abrir el enlace de la invitación.",
  conviteComSessao: "Entró como {nome} ({email}).",
  conviteAceitarComConta: "Aceptar con esta cuenta",
  conviteOutraConta:
    "Si la invitación es para otro correo, salga primero y vuelva a abrir el enlace.",
};
