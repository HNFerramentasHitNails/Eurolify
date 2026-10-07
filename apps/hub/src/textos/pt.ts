// Textos do Hub em português de Portugal, masculino universal (docs/22 §5).
// As outras línguas têm as mesmas chaves (o tipo obriga; o teste confere).

export const pt = {
  marca: "Eurolify Hub",
  saltarParaConteudo: "Saltar para o conteúdo",
  lingua: "Língua",
  sair: "Sair",
  aCarregar: "A carregar…",
  tentarOutraVez: "Tentar outra vez",

  entrarTitulo: "Entrar no Hub",
  entrarExplicacao:
    "Entre com a passkey deste dispositivo ou de um telemóvel próximo.",
  entrarBotao: "Entrar com passkey",
  entrarAEspera: "A aguardar a passkey…",
  entrarCancelado: "A entrada foi cancelada. Pode tentar outra vez.",
  semPasskeys:
    "Este navegador não permite passkeys. Use um navegador actual (Chrome, Edge, Firefox ou Safari).",

  conviteTitulo: "Aceitar o convite",
  conviteExplicacao:
    "Foi convidado para trabalhar no Hub de um comerciante. Escreva o seu nome e crie a conta com uma passkey.",
  conviteNome: "O seu nome",
  conviteBotao: "Criar a conta com uma passkey",
  conviteSemSegredo:
    "Esta ligação não tem convite. Abra a ligação completa que recebeu.",
  conviteContaExiste:
    "Este e-mail já tem conta. Entre no Hub e peça um convite novo a quem o convidou.",

  codigosTitulo: "Os seus códigos de recuperação",
  codigosExplicacao:
    "Se perder a passkey, um destes códigos devolve-lhe a conta. Cada um serve uma vez.",
  codigosAviso:
    "Não voltam a aparecer. Guarde-os agora num sítio seguro, fora deste computador.",
  copiar: "Copiar",
  copiado: "Copiado",
  codigosGuardados: "Já os guardei",

  inicioTitulo: "Os seus comerciantes",
  inicioEntrouComo: "Entrou como",
  inicioVazio:
    "Não pertence a nenhuma equipa. Peça um convite a quem gere o comerciante.",
  verEquipa: "Ver a equipa",

  papel_dono: "Dono",
  papel_gestor: "Gestor",
  papel_armazem: "Armazém",
  papel_apoio: "Apoio",

  equipaTitulo: "Equipa",
  equipaVoltar: "Os seus comerciantes",
  equipaMembros: "Membros",
  equipaContagem: "{n} membros",
  equipaContagemUm: "1 membro",
  colunaNome: "Nome",
  colunaEmail: "E-mail",
  colunaPapel: "Papel",
  colunaDesde: "Desde",
  colunaExpira: "Expira",
  colunaAccoes: "Acções",
  convitesTitulo: "Convites em aberto",
  convitesVazio: "Não há convites em aberto.",
  convitesContagem: "{n} convites em aberto",
  convitesContagemUm: "1 convite em aberto",
  cancelarConvite: "Cancelar",
  cancelarConfirmar: "Cancelar o convite para {email}?",
  conviteCancelado: "O convite foi cancelado.",

  convidarTitulo: "Convidar",
  convidarEmail: "E-mail do convidado",
  convidarPapel: "Papel",
  convidarBotao: "Criar o convite",
  convidarLigacao: "Ligação do convite",
  convidarAviso:
    "Esta ligação só aparece agora. Envie-a a quem convidou; vale uma vez, 7 dias.",
  convidarOutro: "Fechar",

  erroGenerico: "Ocorreu um erro. Tente outra vez.",
  erroReferencia: "Referência: {ref}",
  erroSemPermissao: "Não tem permissão para isto.",
  erroSemSessao: "A sessão terminou. Entre outra vez.",
  erroMuitosPedidos:
    "Pedidos a mais deste endereço. Tente daqui a {s} segundos.",
  erroBloqueado: "Tentativas a mais. Tente daqui a 15 minutos.",
  erroEntrada: "Não foi possível entrar com esta passkey.",
  erroConviteInvalido:
    "Este convite não vale: expirou, já foi usado ou foi cancelado.",
  erroNome: "O nome tem de ter entre 1 e 100 caracteres.",
  erroEmail: "Escreva um e-mail válido.",
  erroRede: "Sem ligação ao servidor. Verifique a rede e tente outra vez.",
};

export type Textos = typeof pt;
