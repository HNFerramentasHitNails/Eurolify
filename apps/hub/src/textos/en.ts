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
    "This email already has an account. Accepting an invitation with an existing account is not yet possible on this screen; talk to whoever invited you.",

  codigosTitulo: "Your recovery codes",
  codigosExplicacao:
    "If you lose your passkey, one of these codes gives you your account back. Each works once.",
  codigosAviso:
    "They will not be shown again. Store them now somewhere safe, away from this computer.",
  copiar: "Copy",
  copiado: "Copied",
  codigosGuardados: "I have stored them",

  inicioTitulo: "Your merchants",
  inicioEntrouComo: "Signed in as",
  inicioVazio:
    "You are not part of any team. Ask whoever manages the merchant for an invitation.",
  verEquipa: "View the team",

  papel_dono: "Owner",
  papel_gestor: "Manager",
  papel_armazem: "Warehouse",
  papel_apoio: "Support",

  equipaTitulo: "Team",
  equipaVoltar: "Your merchants",
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
    "This operation needs you to confirm your passkey. Please try again.",
  erroRede: "No connection to the server. Check the network and try again.",
};
