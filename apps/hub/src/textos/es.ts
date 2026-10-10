import type { Textos } from "./pt";

// Textos del Hub en español (docs/22 §5).

export const es: Textos = {
  marca: "Eurolify Hub",
  saltarParaConteudo: "Saltar al contenido",
  lingua: "Idioma",
  tema: "Tema",
  tema_automatico: "Tema automático",
  tema_claro: "Tema claro",
  tema_escuro: "Tema oscuro",
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

  inicioTitulo: "Inicio",
  inicioEntrouComo: "Ha entrado como",
  inicioVazio:
    "No pertenece a ningún equipo. Pida una invitación a quien gestiona el comerciante.",
  inicioComerciante: "Comerciante",
  inicioEscolher: "Elija el comerciante",
  inicioEscolherExplicacao:
    "Pertenece a más de un equipo. Elija con cuál quiere trabajar.",
  inicioComercianteDesconhecido:
    "Este comerciante no está entre los suyos. Elija uno de la lista.",
  inicioMudarComerciante: "Cambiar de comerciante",
  modulosTitulo: "Módulos",
  modulosPesquisar: "Buscar módulos",
  modulosLimpar: "Borrar la búsqueda",
  modulosContagem: "{n} módulos",
  modulosContagemUm: "1 módulo",
  modulosSemResultados: "Ningún módulo coincide con «{consulta}».",
  modulosNenhum: "Su rol en este comerciante aún no tiene módulos disponibles.",
  modulosOpacos: "Superficies opacas",
  modulo_equipa: "Equipo",
  modulo_artigos: "Artículos",
  modulo_chaves: "Claves de API",
  termos_equipa: "miembros invitaciones roles personas",
  termos_artigos: "catálogo productos variantes",
  termos_chaves: "api integraciones servidor",

  papel_dono: "Propietario",
  papel_gestor: "Gestor",
  papel_armazem: "Almacén",
  papel_apoio: "Soporte",

  equipaTitulo: "Equipo",
  equipaVoltar: "Volver al inicio",
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
  recuperadoChaves:
    "como propietario, revisar las claves de API que creó (abajo): si no reconoce una, revóquela.",
  recuperadoChavesTitulo: "Claves de API que creó en «{comerciante}»",
  recuperadoChavesExplica:
    "Estas claves siguen funcionando. Si alguien usó su cuenta, puede haber creado una; ninguna se revoca sin su confirmación.",
  recuperadoChavesNenhuma: "No creó ninguna clave activa en este comerciante.",
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
  papelMudarRotulo: "Función de {nome}",
  papelMudarConfirmar:
    "¿Cambiar la función de {nome} a {papel}? Las invitaciones abiertas y las claves de servidor que creó y que la nueva función ya no permite se cancelan y se revocan, con las claves creadas a partir de ellas: las integraciones que las usan dejan de funcionar.",
  papelMudado: "La función de {nome} pasó a {papel}.",
  membroTirar: "Quitar del equipo",
  membroTirarConfirmar:
    "{nome} deja de entrar en este comerciante. Las invitaciones abiertas que creó aquí se cancelan y las claves de servidor que creó (y las creadas a partir de ellas) se revocan: las integraciones que las usan dejan de funcionar. Las claves públicas de la tienda se mantienen. ¿Continuar?",
  membroTirado: "{nome} fue retirado del equipo.",
  membroSair: "Salir de este equipo",
  membroSairConfirmar:
    "¿Salir de este equipo? Deja de entrar en este comerciante. Las invitaciones abiertas que creó aquí se cancelan y las claves de servidor que creó (y las creadas a partir de ellas) se revocan: las integraciones que las usan dejan de funcionar. Las claves públicas de la tienda se mantienen.",
  membroUltimoDono:
    "Es el último propietario: para salir, nombre antes a otro propietario.",
  conviteJaTemConta:
    "¿Ya tiene cuenta (con passkey o contraseña)? Entre primero en el Hub y vuelva a abrir este enlace.",
  erroUltimoDono: "Es el último propietario: nombre a otro propietario antes.",
  erroProprioPapel: "Nadie cambia su propia función.",
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
  artigosTitulo: "Artículos",
  artigosContagem: "{n} artículos",
  artigosContagemUm: "1 artículo",
  artigosContagemFiltro: "{n} de {total} artículos",
  artigosVazio:
    "Todavía no hay artículos. Entran por la API o por importación.",
  artigosSemResultados: "Ningún artículo con este filtro.",
  artigosLimparFiltro: "Quitar el filtro",
  artigosFiltros: "Filtrar los artículos",
  artigosFiltroEstado: "Estado",
  artigosTodos: "Todos",
  artigosSku: "SKU",
  artigosProcurarBotao: "Buscar",
  artigosSemPermissao: "No puede ver este comerciante.",
  artigosMostrarMais: "Mostrar más",
  artigosDoSistema: "viene del sistema de gestión",
  colunaMarca: "Marca",
  colunaAlterado: "Modificado el",
  estadoArtigo_rascunho: "Borrador",
  estadoArtigo_activo: "Activo",
  estadoArtigo_arquivado: "Archivado",
  tipoArtigo_fisico: "Físico",
  tipoArtigo_servico: "Servicio",
  tipoArtigo_digital: "Digital",
  tipoArtigo_bilhete: "Entrada",
  tipoArtigo_cartao_oferta: "Tarjeta regalo",
  artigoTitulo: "Artículo",
  artigoVoltar: "Volver a los artículos",
  artigoNaoExiste: "Este artículo no existe en este comercio.",
  artigoDoSistemaRef: "viene del sistema de gestión, con la referencia {ref}",
  artigoCriadoAlterado: "Creado el {criado} · modificado el {alterado}",
  artigoDescricao: "Descripción",
  artigoSemDescricao: "Sin descripción.",
  artigoVariantes: "Variantes",
  /** Antes da linha com as opções e os valores (docs/22 §20.2). */
  artigoOpcoes: "Opciones:",
  artigoOpcoesFalharam: "No se han podido leer las opciones.",
  // Escrever as opções (docs/22 §21.3).
  opcoesTitulo: "Editar opciones",
  opcoesValorLongo: "Cada valor tiene como máximo 100 caracteres.",
  opcoesConfirmarApagarOpcaoNenhuma:
    "¿Eliminar la opción {nome}? Ninguna variante la tiene. No se puede deshacer.",
  opcoesConfirmarApagarOpcaoUma:
    "Eliminar la opción {nome} la quita de la variante que la tiene. No se puede deshacer.",
  opcoesMoverOpcaoDepois: "Mover la opción después",
  opcoesMoverOpcaoAntes: "Mover la opción antes",
  artigoEditarOpcoes: "Editar opciones",
  artigoCriarOpcoes: "Crear opciones",
  opcoesSoRascunho:
    "El nombre y los valores solo cambian mientras el artículo es borrador.",
  opcoesSemOpcoes: "Este artículo todavía no tiene opciones.",
  opcoesNome: "Nombre de la opción",
  opcoesGuardarNome: "Guardar nombre",
  opcoesValoresDe: "Valores de {nome}",
  opcoesValor: "Valor",
  opcoesGuardar: "Guardar",
  opcoesMoverAntes: "Mover antes",
  opcoesMoverDepois: "Mover después",
  opcoesApagarOpcao: "Eliminar la opción",
  opcoesApagarValor: "Eliminar",
  opcoesConfirmarApagarOpcao:
    "Eliminar la opción {nome} la quita de las {n} variantes que la tienen. No se puede deshacer.",
  opcoesConfirmarApagarValor:
    "Las variantes con {valor} se quedan sin valor en {nome}. No se puede deshacer.",
  opcoesNovoValor: "Valor nuevo en {nome}",
  opcoesAcrescentarValor: "Añadir valor",
  opcoesCriar: "Crear opción",
  opcoesNovaNome: "Nombre de la opción nueva",
  opcoesNovaValores: "Valores, uno por línea",
  opcoesVariantes: "Valores de las variantes",
  opcoesIncompleta:
    "1 variante todavía sin valor en una de las opciones: así el artículo no se activa.",
  opcoesIncompletas:
    "{n} variantes todavía sin valor en una de las opciones: así el artículo no se activa.",
  opcoesGuardarVariante: "Guardar {sku}",
  opcoesConflito:
    "Otra persona ha cambiado esta opción mientras tanto. No hemos guardado su cambio.",
  opcoesGuardado: "Cambios guardados.",
  opcoesNomeVazio: "Escriba el nombre.",
  opcoesValoresVazios: "Escriba al menos un valor.",
  erroOpcaoDuplicada: "Ya hay una opción con este nombre en este artículo.",
  erroValorDuplicado: "Este valor ya existe en esta opción.",
  erroNaoRascunho:
    "El artículo ya no es borrador: el nombre y los valores ya no cambian.",
  erroCombinacaoRepetida:
    "Dos variantes activas quedarían con los mismos valores. No se ha cambiado nada.",
  erroOpcoesIncompletas: "Cada variante activa lleva un valor de cada opción.",
  erroOrdemDesactualizada:
    "Las opciones han cambiado mientras tanto. La lista se ha actualizado.",
  erroOpcaoRepetida: "Una variante solo lleva un valor de cada opción.",
  colunaUnidade: "Unidad de venta",
  colunaGtin: "GTIN",
  colunaConteudo: "Contenido",
  colunaPeso: "Peso",
  estadoVariante_activa: "Activa",
  estadoVariante_arquivada: "Archivada",
  unidade_unidade: "Unidad",
  unidade_par: "Par",
  unidade_caixa: "Caja",
  unidade_embalagem: "Envase",
  unidade_conjunto: "Conjunto",
  artigoImagens: "Imágenes",
  artigoSemImagens: "Sin imágenes.",
  artigoImagemPrincipal: "Principal",
  artigoImagemDaVariante: "Solo de la variante {sku}",
  artigoSemTextoAlternativo: "Sin texto alternativo: impide la publicación.",
  artigoImagemFalhou: "La imagen no se ha cargado.",
  artigoPublicacoes: "Publicaciones",
  artigoSemPublicacoes: "Todavía no está publicado en ninguna tienda.",
  colunaCanal: "Canal",
  colunaMercado: "Mercado",
  /** Só para leitores de ecrã, antes do nome da loja (docs/22 §19.2). */
  publicacaoLoja: "Tienda:",
  colunaData: "Fecha",
  colunaMotivo: "Motivo",
  estadoPublicacao_rascunho: "Borrador",
  estadoPublicacao_publicado: "Publicado",
  estadoPublicacao_arquivado: "Archivado",
  motivoArquivo_retirada: "Retirado de la venta",
  motivoArquivo_artigo_arquivado: "El artículo se ha archivado",
  motivoArquivo_mercado_arquivado: "El mercado se ha archivado",
  motivoArquivo_canal_arquivado: "El canal se ha archivado",
  motivoArquivo_verificacao_falhou:
    "Ha dejado de cumplir las reglas de publicación",
  artigoEditar: "Editar",
  artigoEditarTitulo: "Editar el artículo",
  artigoActivar: "Activar",
  artigoArquivar: "Archivar",
  artigoRepor: "Restaurar",
  artigoConfirmarArquivar:
    "Archivar el artículo lo retira de la venta en todas las tiendas. Las publicaciones no vuelven solas al restaurarlo. ¿Archivar?",
  artigoExternoAviso:
    "Este artículo viene del sistema de gestión: el nombre, la descripción, la marca, el estado y las variantes se cambian allí. Las imágenes se cambian aquí.",
  artigoGuardado: "Cambios guardados.",
  artigoGuardar: "Guardar",
  artigoConflito:
    "Otra persona ha cambiado este artículo mientras tanto. No hemos guardado sus cambios.",
  artigoConflitoActual:
    "Lo que está guardado ahora aparece debajo; lo que escribió sigue en los campos. Guardar de nuevo sustituye lo guardado.",
  artigoSairSemGuardar: "Tiene cambios sin guardar. ¿Salir sin guardar?",
  artigoCaracteres: "{n} de {max} caracteres",
  artigoNomeObrigatorio: "El nombre es obligatorio.",
  artigoExternoCampo:
    "Este campo viene del sistema de gestión: se cambia allí.",
  artigoArquivarVariante: "Archivar variante",
  artigoConfirmarArquivarVariante:
    "Archivar la variante {sku} no se puede deshacer. ¿Archivar?",
  artigoUltimaVariante:
    "Es la última variante activa: el artículo no se podrá publicar hasta tener otra. ¿Archivar la variante {sku}, sin vuelta atrás?",
  artigoEditarTexto: "Editar texto alternativo",
  artigoTextoAlternativo: "Texto alternativo",
  artigoTornarPrincipal: "Hacer principal",
  artigoMoverAntes: "Mover antes",
  artigoMoverDepois: "Mover después",
  artigoSemVariantesActivas:
    "Para activarlo, el artículo necesita al menos una variante activa.",
  artigoTransicaoInvalida:
    "El artículo ya no estaba en el estado que mostraba la pantalla. Se ha recargado la ficha.",
  artigoVarianteJaArquivada: "La variante ya estaba archivada.",
  artigoOrdemAMeio:
    "El orden de las imágenes quedó a medias: revíselo y vuelva a moverlas si hace falta.",
  conviteInstrucao: "Escriba su nombre y cree la cuenta con una passkey.",
  conviteResumo:
    "Le han invitado al equipo de {comerciante}, con la función {papel}.",
  conviteParaEmail: "La invitación es para {email} y caduca el {data}.",
  conviteEmailDiferente:
    "Esta invitación es para {email} y ha entrado como {sessao}. Salga y entre con la cuenta de ese correo.",
  artigoCriar: "Crear artículo",
  artigosVazioCriar: "Todavía no hay artículos.",
  artigoNovoTitulo: "Crear artículo",
  artigoNovoTipo: "Tipo",
  artigoNovoVariante: "Variante {n}",
  artigoNovoGtinOrigem: "Origen del GTIN",
  gtinOrigem_gs1_comerciante: "GS1 del comerciante",
  gtinOrigem_fornecedor: "Del proveedor",
  gtinOrigem_interno: "Interno",
  artigoNovoEscolher: "Elija",
  artigoNovoQuantidade: "Cantidad del contenido",
  artigoNovoUnidadeConteudo: "Unidad del contenido",
  artigoNovoSemUnidade: "Sin contenido",
  artigoNovoPeso: "Peso (g)",
  artigoNovoComprimento: "Longitud (mm)",
  artigoNovoLargura: "Anchura (mm)",
  artigoNovoAltura: "Altura (mm)",
  artigoNovoSemPeso: "Sin peso, no se puede publicar.",
  artigoNovoAcrescentar: "Añadir otra variante",
  artigoNovoRetirar: "Quitar la variante {n}",
  artigoNovoMaximo: "Como máximo 20 variantes aquí; más por importación.",
  artigoNovoSkuObrigatorio: "El SKU es obligatorio.",
  artigoNovoSkuRepetido: "Este SKU está repetido en este formulario.",
  artigoNovoSkuExiste:
    "Este SKU ya existe en este comerciante (también en los artículos archivados).",
  artigoNovoGtinFormato: "El GTIN tiene 8, 12, 13 o 14 dígitos.",
  artigoNovoGtinOrigemFalta: "Elija el origen del GTIN.",
  artigoNovoGtinInvalido: "El GTIN no es válido: el último dígito no coincide.",
  artigoNovoGtinRepetido: "Este GTIN ya existe en este comerciante.",
  artigoNovoConteudoIncompleto:
    "Escriba la cantidad y la unidad del contenido, o ninguna.",
  artigoNovoInteiro: "Un número entero, sin decimales.",
  artigoNovoCorrigir: "Hay campos por corregir.",
  artigoNovoNaoCriado:
    "La conexión falló y no encontramos el artículo. Puede intentarlo de nuevo: si se creó, la pantalla lo abre.",
  artigoCriado: "Artículo creado en borrador.",
  artigoJaCriado: "El artículo ya se había creado.",
  artigoSkuDuplicado: "Uno de los SKU ya existe en este comerciante.",
  artigoGtinDuplicado: "Uno de los GTIN ya existe en este comerciante.",
  artigoGtinInvalido:
    "Uno de los GTIN no es válido: el último dígito no coincide.",
  artigoConteudoIncompleto:
    "Escriba la cantidad y la unidad del contenido, o ninguna.",
  artigoAcrescentarImagem: "Añadir imagen",
  artigoImagemRegras: "JPEG, PNG o WebP, hasta 10 MB.",
  artigoImagemEscolhida: "{nome} · {tamanho}",
  artigoImagemTextoAjuda:
    "Describa la imagen a quien no la ve. Ej.: «Frasco de esmalte verde, de frente».",
  artigoImagemSemTextoAgora:
    "Guardar sin texto alternativo (el artículo no se puede publicar sin él)",
  artigoImagemSemTexto:
    "Escriba el texto alternativo, o marque que guarda sin él.",
  artigoImagemAEnviar: "Enviando… {p}%",
  artigoImagemGrande: "La imagen supera los 10 MB.",
  artigoImagemTipo: "Solo se aceptan imágenes JPEG, PNG o WebP.",
  artigoImagemIlegivel:
    "El archivo no es una imagen JPEG, PNG o WebP que se pueda leer hasta el final.",
  artigoImagemOutroEnvio:
    "Hay demasiados envíos a la vez; inténtelo dentro de poco.",
  artigoImagemSemEspaco:
    "El espacio de imágenes de este comerciante está lleno.",
  artigoImagemAcrescentada: "Imagen añadida.",
  artigoImagemTirada: "Imagen quitada del artículo.",
  artigoTirarImagem: "Quitar la imagen",
  artigoConfirmarTirarImagem:
    "¿Quitar la imagen del artículo? El archivo queda guardado.",
  artigoImagemSemTextoConfirmar:
    "Guardar sin texto alternativo retira el artículo de la venta en las tiendas donde está publicado. Al escribir el texto, hay que volver a publicarlo. ¿Guardar sin texto?",
  artigoImagemProgresso: "Envío de la imagen",
  artigoHistorico: "Historial",
  historicoTitulo: "Historial del artículo",
  historicoComeco:
    "El historial empieza el día en que entró esta función; los cambios anteriores no aparecen.",
  historicoVazio: "Todavía no hay cambios registrados.",
  historicoSemPermissao: "Su rol no ve el historial de este artículo.",
  historicoMostrarMais: "Mostrar más",
  historicoPelaImportacao: "por la importación",
  historicoAutomatico: "Automático",
  historicoChave: "Clave «{nome}»",
  historicoChaveSemNome: "Clave de API",
  historicoPessoaDeFora: "Persona ajena a este equipo",
  historicoCriou: "creó",
  historicoAlterou: "cambió",
  historicoApagou: "eliminó",
  historicoParte_artigo: "el artículo",
  historicoParte_variante: "la variante {sku}",
  historicoParte_varianteSemSku: "una variante",
  historicoParte_media: "una imagen",
  historicoParte_traducao: "una traducción",
  historicoParte_publicacao: "una publicación",
  historicoParte_opcao: "una opción",
  historicoParte_valor_opcao: "un valor de opción",
  historicoParte_variante_valor: "el valor de una variante",
  historicoParte_componente: "un componente del kit",
  historicoParte_artigo_categoria: "una categoría",
  historicoParte_colecao_artigo: "una colección",
  historicoValorVazio: "vacío",
  historicoSim: "sí",
  historicoNao: "no",
  historicoVerTudo: "Ver todo",
  historicoPosicao: "Posición",
  historicoVoltarFicha: "Volver a la ficha",
  historicoParte_traducaoDe: "la traducción de «{campo}» ({lingua})",
  historicoParte_publicacaoEm:
    "la publicación en el canal {canal}, mercado {mercado}",
  artigoPrecos: "Precios",
  precosSemListas: "Todavía no hay listas de precios activas.",
  precosSemPermissao: "Su rol no ve los precios.",
  precosMostrarMais: "Mostrar más listas",
  precosListaBase: "lista base",
  precosListaB2b: "lista B2B",
  estadoMercado_rascunho: "mercado en borrador",
  estadoMercado_arquivado: "mercado archivado",
  precosComIva: "precios con IVA",
  precosSemIva: "precios sin IVA",
  colunaPreco: "Precio",
  colunaPrecoUnidade: "Precio por unidad",
  precosSemPreco: "Sin precio en esta lista",
  precosGratuito: "Gratuito",
  precosAntes:
    "antes {preco} — el más bajo de los 30 días anteriores a la reducción",
  precosAte: "· termina el {data}",
  precosMinimo: "mínimo {n}",
  precosMultiplo: "múltiplos de {n}",
  precosPorUnidade: "{valor}/{unidade}, con cuatro decimales",
};
