import type { Textos } from "./pt";

// Hub texts in English (docs/22 §5).

export const en: Textos = {
  marca: "Eurolify Hub",
  saltarParaConteudo: "Skip to content",
  lingua: "Language",
  sair: "Sign out",
  aCarregar: "Loading…",
  tentarOutraVez: "Try again",

  entrarTitulo: "Sign in to the Hub",
  entrarExplicacao:
    "Sign in with the passkey on this device or on a nearby phone.",
  entrarBotao: "Sign in with a passkey",
  entrarAEspera: "Waiting for the passkey…",
  entrarCancelado: "The passkey was cancelled. You can try again.",
  semPasskeys:
    "This browser does not support passkeys. Use a current browser (Chrome, Edge, Firefox or Safari).",

  conviteTitulo: "Accept the invitation",
  conviteExplicacao:
    "You have been invited to work in a merchant's Hub. Enter your name and create the account with a passkey.",
  conviteNome: "Your name",
  conviteBotao: "Create the account with a passkey",
  conviteSemSegredo:
    "This link has no invitation. Open the full link you received.",
  conviteContaExiste:
    "This e-mail already has an account. Sign in with it to accept the invitation.",

  codigosTitulo: "Your recovery codes",
  codigosExplicacao:
    "If you lose your passkey, one of these codes gives you your account back. Each works once.",
  codigosAviso:
    "They will not be shown again. Store them now somewhere safe, away from this computer.",
  copiar: "Copy",
  copiado: "Copied",
  codigosGuardados: "I have stored them",

  inicioTitulo: "Home",
  inicioEntrouComo: "Signed in as",
  inicioVazio:
    "You are not part of any team. Ask whoever manages the merchant for an invitation.",
  inicioComerciante: "Merchant",
  inicioEscolher: "Choose the merchant",
  inicioEscolherExplicacao:
    "You belong to more than one team. Choose which one to work with.",
  inicioComercianteDesconhecido:
    "This merchant is not one of yours. Choose one from the list.",
  inicioMudarComerciante: "Change merchant",
  modulosTitulo: "Modules",
  modulosPesquisar: "Search modules",
  modulosLimpar: "Clear the search",
  modulosContagem: "{n} modules",
  modulosContagemUm: "1 module",
  modulosSemResultados: "No module matches “{consulta}”.",
  modulosNenhum: "Your role at this merchant has no modules available yet.",
  modulosOpacos: "Opaque surfaces",
  modulo_equipa: "Team",
  modulo_artigos: "Products",
  modulo_chaves: "API keys",
  termos_equipa: "members invitations roles people",
  termos_artigos: "catalogue products variants",
  termos_chaves: "api integrations server",

  papel_dono: "Owner",
  papel_gestor: "Manager",
  papel_armazem: "Warehouse",
  papel_apoio: "Support",

  equipaTitulo: "Team",
  equipaVoltar: "Back to home",
  equipaMembros: "Members",
  equipaContagem: "{n} members",
  equipaContagemUm: "1 member",
  colunaNome: "Name",
  colunaEmail: "Email",
  colunaPapel: "Role",
  colunaDesde: "Since",
  colunaExpira: "Expires",
  colunaAccoes: "Actions",
  convitesTitulo: "Open invitations",
  convitesVazio: "There are no open invitations.",
  convitesContagem: "{n} open invitations",
  convitesContagemUm: "1 open invitation",
  cancelarConvite: "Cancel",
  cancelarConfirmar: "Cancel the invitation for {email}?",
  conviteCancelado: "The invitation was cancelled.",

  convidarTitulo: "Invite",
  convidarEmail: "Invitee's email",
  convidarPapel: "Role",
  convidarBotao: "Create the invitation",
  convidarLigacao: "Invitation link",
  convidarAviso:
    "This link is shown only now. Send it to the invitee; it works once, for 7 days. Ask them to open it on their own computer or in a private window: the browser keeps it in its history.",
  convidarOutro: "Close",

  erroGenerico: "Something went wrong. Please try again.",
  erroReferencia: "Reference: {ref}",
  erroSemPermissao: "You do not have permission for this.",
  erroSemSessao: "Your session has ended. Please sign in again.",
  erroMuitosPedidos:
    "Too many requests from this address. Try again in {s} seconds.",
  erroBloqueado: "Too many attempts. Try again in 15 minutes.",
  erroEntrada: "Could not sign in with this passkey.",
  erroConviteInvalido:
    "This invitation is not valid: it expired, was already used or was cancelled.",
  erroNome: "The name must have between 1 and 100 characters.",
  erroEmail: "Enter a valid email.",
  copiarFalhou: "Could not copy. Select the text and copy it by hand.",
  erroComercianteInactivo:
    "This merchant is suspended or closed: you cannot invite or change the team.",
  erroConviteUsado: "This invitation was already accepted or cancelled.",
  erroPapel: "You cannot give this role.",
  erroOcupado: "The service is busy. Try again shortly.",
  erroOrigem:
    "Request refused because it came from another site. Open the Hub from its usual address.",
  erroRecente:
    "This operation asks you to confirm who you are (passkey, or sign in again). Try again.",
  erroRede: "No connection to the server. Check the network and try again.",

  // My account and recovery (docs/22 §9.1).
  contaTitulo: "My account",
  contaLigacao: "Account",
  passkeysTitulo: "Passkeys",
  passkeysContagem: "{n} passkeys",
  passkeysContagemUm: "1 passkey",
  passkeysConselho:
    "You have only one passkey. Register a second one on another device: if you lose this one, you can sign in with the other.",
  colunaCriadaEm: "Created",
  colunaUltimoUso: "Last used",
  nunca: "Never",
  passkeyNome: "Name for this passkey (e.g. Phone)",
  passkeyAcrescentar: "Add passkey",
  passkeyAcrescentada: "The passkey was added.",
  passkeyRetirar: "Remove",
  passkeyRetirarConfirmar:
    "Remove the passkey “{nome}”? The other open sessions end; this one continues.",
  passkeyRetirada: "The passkey was removed. The other sessions ended.",
  sessoesTitulo: "Open sessions",
  sessoesContagem: "{n} open sessions",
  sessoesContagemUm: "1 open session",
  sessaoEsta: "This session",
  sessoesTerminar: "End all other sessions",
  sessoesTerminarConfirmar:
    "End all other sessions? Anyone using them will have to sign in again.",
  sessoesTerminadas: "The other sessions ended.",
  recuperacaoTitulo: "Recovery codes",
  recuperacaoExplicacao:
    "If you lose all your passkeys, a recovery code gives you back the account. Generating new codes cancels the old ones.",
  codigosGerar: "Generate new codes",
  codigosGerarConfirmar: "Generate 10 new codes? The old ones stop working.",
  erroUltimaPasskey:
    "This is the last way to sign in to the account. Add another passkey before removing this one.",
  erroPasskeyJaRegistada: "This device already has a passkey for this account.",
  erroPasskeyNaoExiste: "This passkey no longer exists in the account.",
  erroPasskeyNaoAceite:
    "The passkey was not accepted: it may belong to another account, or the request took more than 5 minutes. The session is still open; try again.",
  erroRecuperarPasskey:
    "The new passkey was not accepted, or the request took more than 5 minutes. Try again.",
  erroReautenticar:
    "This operation asks you to confirm who you are, and it was not possible with a passkey in this browser. Sign out and sign in again (with the passkey or the password) and repeat within the next 10 minutes.",
  semPasskeysEntrar:
    "This browser does not support passkeys. Sign in with the password, if you activated it, or use a current browser (Chrome, Edge, Firefox or Safari).",
  autenticadorDepois:
    "When you confirm, the other open sessions end. If you already had Eurolify in this app, delete the old entry afterwards.",
  erroNomePasskey: "The passkey name must have between 1 and 100 characters.",

  entrarPerdeu: "Lost your passkey?",
  recuperarTitulo: "Recover the account",
  recuperarExplicacao:
    "With the account's e-mail and one of the recovery codes, register a new passkey on this device. The code used stops working.",
  recuperarEmail: "Account e-mail",
  recuperarCodigo: "Recovery code",
  recuperarCodigoAjuda: "It looks like XXXX-XXXX-XXXX-XXXX.",
  recuperarNome: "Name for the new passkey (optional)",
  recuperarBotao: "Recover with a new passkey",
  recuperarVoltar: "Sign in with a passkey",
  erroRecuperar:
    "The e-mail or the code is not correct, or the code was already used.",
  erroCodigo: "Type the full recovery code: 16 letters and digits.",
  recuperadoTitulo: "The account was recovered",
  recuperadoTexto:
    "The other sessions ended and the code used no longer works. Still to do:",
  recuperadoRetirar:
    "remove the passkeys you no longer have (the one on the lost device keeps working until you remove it);",
  recuperadoCodigos: "generate new recovery codes;",
  recuperadoChaves: "as owner, review the API keys you created.",
  recuperadoFechar: "Close this notice",

  // Password and authenticator (docs/22 §9.2).
  palavraPasseTitulo: "Password and authenticator",
  palavraPasseExplicacao:
    "An alternative to the passkey: sign in with the e-mail, the password and the 6-digit code from an authenticator app. The password alone never signs in.",
  palavraPasseActiva: "Status: active.",
  palavraPasseNenhuma: "Status: not activated.",
  palavraPassePendente:
    "Status: activation was left halfway. Choose the password again to start over.",
  palavraPasseActivar: "Activate password and authenticator",
  palavraPasseTrocar: "Change the password and the authenticator",
  palavraPasseCampo: "Password (12 characters or more)",
  palavraPasseRepetir: "Repeat the password",
  palavraPasseContinuar: "Continue",
  cancelar: "Cancel",
  autenticadorPasso:
    "Scan this QR code with the authenticator app. If you cannot, type the secret into the app by hand.",
  autenticadorQr: "QR code for the authenticator app",
  autenticadorSegredo: "Secret",
  autenticadorAviso:
    "The QR code and the secret only appear now. Do not keep them anywhere else or send them to anyone.",
  autenticadorCodigo: "6-digit code from the app",
  autenticadorConfirmar: "Confirm and activate",
  palavraPasseActivada:
    "The password and the authenticator are now active. The other sessions ended.",
  palavraPasseRetirar: "Remove the password",
  palavraPasseRetirarConfirmar:
    "Remove the password and the authenticator? The other open sessions end; this one continues.",
  palavraPasseRetirada: "The password was removed. The other sessions ended.",
  erroPalavraPasseCurta:
    "The password must have between 12 and 256 characters.",
  erroPalavraPasseDiferente: "The two passwords are not the same.",
  erroCodigoTotp: "Type the 6 digits of the code.",
  erroCodigoTotpErrado:
    "The code is not correct. Check the phone's clock and try the next code.",
  erroPalavraPasseNaoPendente:
    "This activation is no longer valid (it was replaced or completed elsewhere). Start again.",
  erroPalavraPasseUltima:
    "This is the last way to sign in to the account. Add a passkey before removing the password.",
  erroPalavraPasseNaoExiste: "The account no longer has a password.",

  entrarComPalavraPasse: "Sign in with password",
  entrarEmail: "E-mail",
  entrarPalavraPasse: "Password",
  entrarCodigo: "6-digit code from the authenticator",
  entrarPalavraPasseBotao: "Sign in",
  erroEntrarPalavraPasse:
    "The e-mail, the password or the code is not correct.",
  erroPalavraPasseIndisponivel:
    "Signing in with a password is not available on this server.",

  // API keys (docs/22 §9.3).
  chavesTitulo: "API keys",
  chavesExplicacao:
    "Keys let other programs (an integration, invoicing, an AI) use this merchant's API. Each key only does what its scopes allow.",
  chavesVazio: "There are no keys yet.",
  chavesContagem: "{n} keys",
  chavesContagemUm: "1 key",
  colunaTipo: "Type",
  colunaAmbitos: "Scopes",
  colunaPrefixo: "Starts with",
  colunaCriadaPor: "Created by",
  colunaEstado: "Status",
  tipo_servidor: "Server",
  tipo_publica: "Public (store)",
  estadoActiva: "Active",
  estadoRevogada: "Revoked on {data}",
  estadoExpirada: "Expired on {data}",
  semPrazo: "No expiry",
  autorVoce: "You",
  autorOperador: "Operator",
  autorChave: "The key “{nome}”",
  autorChaveSemNome: "Another key",
  autorAntigo: "Someone who left the team",
  ambito_catalog_read: "Read the catalogue",
  ambito_catalog_write: "Change the catalogue",
  ambito_catalog_publish: "Publish products",
  ambito_catalog_import: "Import products",
  ambito_merchant_read: "Read the merchant's details",
  ambito_merchant_write: "Change the merchant's details",
  ambito_keys_write: "Manage keys",
  ambito_storefront: "Store (public read only)",
  criarChaveTitulo: "Create a server key",
  criarChaveExplicacao:
    "A server key is kept only on the server of whoever uses it, never in a web page or a phone app. Public keys, for the store, will come with stores.",
  chaveNome: "Name (e.g. Invoicing integration)",
  chaveAmbitos: "What the key can do",
  chaveExpira:
    "Expires on (optional; until the end of that day, in this computer's time)",
  chaveCriar: "Create the key",
  chaveSegredoTitulo: "The secret of the key “{nome}”",
  chaveSegredoAviso:
    "It only appears now. Copy it to where it will be used; if you lose it, revoke the key and create another.",
  chaveFechar: "I have saved it",
  chaveRevogar: "Revoke",
  chaveRevogarConfirmar:
    "Revoke the key “{nome}”? It stops working at once, and it cannot be undone.",
  chaveRevogada: "The key was revoked.",
  autorDesconhecido: "Unidentified",
  ambitoKeysAviso:
    "A key with “Manage keys” can create and revoke this merchant's other keys: give it only to whoever manages the integrations.",
  erroChaveTalvezCriada:
    "The server did not answer: the key may have been created. If it appears in the list, its secret is lost: revoke it and create another.",
  erroChaveAmbitos: "Choose at least one thing the key can do.",
  erroChaveExpira: "The expiry date must be in the future.",
  erroChaveJaRevogada: "This key had already been revoked.",
  erroChaveNaoExiste: "This key no longer exists.",
  erroChaveUltimaGestora:
    "This is the last key that manages keys; create another before revoking it.",
  erroChaveComercianteInactivo:
    "This merchant is suspended or closed: it cannot create keys, but it can revoke them.",
  erroChaveAmbitosAMais:
    "You cannot give a key scopes your role does not have.",

  // Team management (docs/22 §10).
  papelMudar: "Change",
  papelMudarRotulo: "Role of {nome}",
  papelMudarConfirmar:
    "Change {nome}'s role to {papel}? The open invitations and server keys they created that the new role no longer allows are cancelled and revoked, along with keys created from them: the integrations that use them stop working.",
  papelMudado: "{nome}'s role is now {papel}.",
  membroTirar: "Remove from the team",
  membroTirarConfirmar:
    "{nome} will no longer sign in to this merchant. The open invitations they created here are cancelled and the server keys they created (and those created from them) are revoked: the integrations that use them stop working. The store's public keys stay. Continue?",
  membroTirado: "{nome} was removed from the team.",
  membroSair: "Leave this team",
  membroSairConfirmar:
    "Leave this team? You will no longer sign in to this merchant. The open invitations you created here are cancelled and the server keys you created (and those created from them) are revoked: the integrations that use them stop working. The store's public keys stay.",
  membroUltimoDono:
    "You are the last owner: to leave, appoint another owner first.",
  conviteJaTemConta:
    "Already have an account (passkey or password)? Sign in to the Hub first and open this link again.",
  erroUltimoDono: "This is the last owner: appoint another owner first.",
  erroProprioPapel: "Nobody can change their own role.",
  erroMembroNaoExiste: "This member is no longer in the team.",
  erroConviteOutraPessoa:
    "This invitation is for another e-mail. Sign out and sign in with that e-mail's account.",
  erroJaMembro: "You are already a member of this merchant.",
  conviteEntrarEAceitar: "Sign in with a passkey and accept",
  conviteSoPalavraPasse:
    "If you sign in with a password, sign in to the Hub first and open the invitation link again.",
  conviteComSessao: "Signed in as {nome} ({email}).",
  conviteAceitarComConta: "Accept with this account",
  conviteOutraConta:
    "If the invitation is for another e-mail, sign out first and open the link again.",
  artigosTitulo: "Products",
  artigosContagem: "{n} products",
  artigosContagemUm: "1 product",
  artigosContagemFiltro: "{n} of {total} products",
  artigosVazio:
    "There are no products yet. They come in through the API or an import.",
  artigosSemResultados: "No product matches this filter.",
  artigosLimparFiltro: "Clear the filter",
  artigosFiltros: "Filter the products",
  artigosFiltroEstado: "Status",
  artigosTodos: "All",
  artigosSku: "SKU",
  artigosProcurarBotao: "Search",
  artigosSemPermissao: "You cannot see this merchant.",
  artigosMostrarMais: "Show more",
  artigosDoSistema: "comes from the management system",
  colunaMarca: "Brand",
  colunaAlterado: "Changed on",
  estadoArtigo_rascunho: "Draft",
  estadoArtigo_activo: "Active",
  estadoArtigo_arquivado: "Archived",
  tipoArtigo_fisico: "Physical",
  tipoArtigo_servico: "Service",
  tipoArtigo_digital: "Digital",
  tipoArtigo_bilhete: "Ticket",
  tipoArtigo_cartao_oferta: "Gift card",
  artigoTitulo: "Product",
  artigoVoltar: "Back to products",
  artigoNaoExiste: "This product does not exist for this merchant.",
  artigoDoSistemaRef: "comes from the management system, reference {ref}",
  artigoCriadoAlterado: "Created on {criado} · changed on {alterado}",
  artigoDescricao: "Description",
  artigoSemDescricao: "No description.",
  artigoVariantes: "Variants",
  colunaUnidade: "Sales unit",
  colunaGtin: "GTIN",
  colunaConteudo: "Content",
  colunaPeso: "Weight",
  estadoVariante_activa: "Active",
  estadoVariante_arquivada: "Archived",
  unidade_unidade: "Unit",
  unidade_par: "Pair",
  unidade_caixa: "Box",
  unidade_embalagem: "Pack",
  unidade_conjunto: "Set",
  artigoImagens: "Images",
  artigoSemImagens: "No images.",
  artigoImagemPrincipal: "Main",
  artigoImagemDaVariante: "Only for variant {sku}",
  artigoSemTextoAlternativo: "No alternative text — this blocks publishing.",
  artigoImagemFalhou: "The image did not load.",
  artigoPublicacoes: "Publications",
  artigoSemPublicacoes: "Not yet published in any store.",
  colunaCanal: "Channel",
  colunaMercado: "Market",
  colunaData: "Date",
  colunaMotivo: "Reason",
  estadoPublicacao_rascunho: "Draft",
  estadoPublicacao_publicado: "Published",
  estadoPublicacao_arquivado: "Archived",
  motivoArquivo_retirada: "Withdrawn from sale",
  motivoArquivo_artigo_arquivado: "The product was archived",
  motivoArquivo_mercado_arquivado: "The market was archived",
  motivoArquivo_canal_arquivado: "The channel was archived",
  motivoArquivo_verificacao_falhou: "No longer meets the publishing rules",
  artigoEditar: "Edit",
  artigoEditarTitulo: "Edit the product",
  artigoActivar: "Activate",
  artigoArquivar: "Archive",
  artigoRepor: "Restore",
  artigoConfirmarArquivar:
    "Archiving the product takes it off sale in every store. Publications do not come back on their own when it is restored. Archive?",
  artigoExternoAviso:
    "This product comes from the management system: the name, description, brand, status and variants are changed there. Images are changed here.",
  artigoGuardado: "Changes saved.",
  artigoGuardar: "Save",
  artigoConflito:
    "Someone else changed this product in the meantime. Your changes were not saved.",
  artigoConflitoActual:
    "What is saved now is shown below; what you typed is still in the fields. Saving again replaces what is saved.",
  artigoSairSemGuardar: "You have unsaved changes. Leave without saving?",
  artigoCaracteres: "{n} of {max} characters",
  artigoNomeObrigatorio: "The name is required.",
  artigoExternoCampo:
    "This field comes from the management system: change it there.",
  artigoArquivarVariante: "Archive variant",
  artigoConfirmarArquivarVariante:
    "Archiving variant {sku} cannot be undone. Archive?",
  artigoUltimaVariante:
    "This is the last active variant: the product cannot be published until it has another. Archive variant {sku}, for good?",
  artigoEditarTexto: "Edit alternative text",
  artigoTextoAlternativo: "Alternative text",
  artigoTornarPrincipal: "Make main",
  artigoMoverAntes: "Move earlier",
  artigoMoverDepois: "Move later",
  artigoSemVariantesActivas:
    "To activate it, the product needs at least one active variant.",
  artigoTransicaoInvalida:
    "The product was no longer in the status shown. The page has been reloaded.",
  artigoVarianteJaArquivada: "The variant was already archived.",
  artigoOrdemAMeio:
    "The image order was only partly saved: check it and move again if needed.",
  conviteInstrucao: "Enter your name and create the account with a passkey.",
  conviteResumo:
    "You were invited to the {comerciante} team, with the role {papel}.",
  conviteParaEmail: "The invitation is for {email} and expires on {data}.",
  conviteEmailDiferente:
    "This invitation is for {email} and you are signed in as {sessao}. Sign out and sign in with that e-mail's account.",
  artigoCriar: "Create product",
  artigosVazioCriar: "There are no products yet.",
  artigoNovoTitulo: "Create product",
  artigoNovoTipo: "Type",
  artigoNovoVariante: "Variant {n}",
  artigoNovoGtinOrigem: "GTIN source",
  gtinOrigem_gs1_comerciante: "Merchant's GS1",
  gtinOrigem_fornecedor: "From the supplier",
  gtinOrigem_interno: "Internal",
  artigoNovoEscolher: "Choose",
  artigoNovoQuantidade: "Content quantity",
  artigoNovoUnidadeConteudo: "Content unit",
  artigoNovoSemUnidade: "No content",
  artigoNovoPeso: "Weight (g)",
  artigoNovoComprimento: "Length (mm)",
  artigoNovoLargura: "Width (mm)",
  artigoNovoAltura: "Height (mm)",
  artigoNovoSemPeso: "Without a weight, it cannot be published.",
  artigoNovoAcrescentar: "Add another variant",
  artigoNovoRetirar: "Remove variant {n}",
  artigoNovoMaximo: "At most 20 variants here; more through import.",
  artigoNovoSkuObrigatorio: "The SKU is required.",
  artigoNovoSkuRepetido: "This SKU is repeated in this form.",
  artigoNovoSkuExiste:
    "This SKU already exists for this merchant (archived products included).",
  artigoNovoGtinFormato: "The GTIN has 8, 12, 13 or 14 digits.",
  artigoNovoGtinOrigemFalta: "Choose the GTIN source.",
  artigoNovoGtinInvalido:
    "The GTIN is not valid: the last digit does not match.",
  artigoNovoGtinRepetido: "This GTIN already exists for this merchant.",
  artigoNovoConteudoIncompleto:
    "Enter the content quantity and unit, or neither.",
  artigoNovoInteiro: "A whole number, no decimals.",
  artigoNovoCorrigir: "Some fields need correcting.",
  artigoNovoNaoCriado:
    "The connection failed and we did not find the product. You can try again: if it was created, the screen opens it.",
  artigoCriado: "Product created as a draft.",
  artigoJaCriado: "The product had already been created.",
  artigoSkuDuplicado: "One of the SKUs already exists for this merchant.",
  artigoGtinDuplicado: "One of the GTINs already exists for this merchant.",
  artigoGtinInvalido:
    "One of the GTINs is not valid: the last digit does not match.",
  artigoConteudoIncompleto: "Enter the content quantity and unit, or neither.",
};
