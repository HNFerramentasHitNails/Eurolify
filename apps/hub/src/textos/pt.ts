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
  entrarCancelado: "A passkey foi cancelada. Pode tentar outra vez.",
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
    "Este e-mail já tem conta. Aceitar um convite com uma conta que já existe ainda não é possível neste ecrã; fale com quem o convidou.",

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
    "Esta ligação só aparece agora. Envie-a a quem convidou; vale uma vez, 7 dias. Peça-lhe que a abra num computador seu ou numa janela privada: o navegador guarda-a no histórico.",
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
  copiarFalhou: "Não foi possível copiar. Seleccione o texto e copie à mão.",
  erroComercianteInactivo:
    "Este comerciante está suspenso ou fechado: não pode convidar nem mudar a equipa.",
  erroConviteUsado: "Este convite já foi aceite ou cancelado.",
  erroPapel: "Não pode dar este papel.",
  erroOcupado: "O serviço está ocupado. Tente daqui a pouco.",
  erroOrigem:
    "Pedido recusado por vir de outro sítio. Abra o Hub pelo endereço habitual.",
  erroRecente:
    "Esta operação pede que confirme quem é (passkey, ou entrar outra vez). Tente outra vez.",
  erroRede: "Sem ligação ao servidor. Verifique a rede e tente outra vez.",

  // A minha conta e recuperar (docs/22 §9.1).
  contaTitulo: "A minha conta",
  contaLigacao: "Conta",
  passkeysTitulo: "Passkeys",
  passkeysContagem: "{n} passkeys",
  passkeysContagemUm: "1 passkey",
  passkeysConselho:
    "Tem só uma passkey. Registe uma segunda noutro dispositivo: se perder esta, entra com a outra.",
  colunaCriadaEm: "Criada em",
  colunaUltimoUso: "Último uso",
  nunca: "Nunca",
  passkeyNome: "Nome desta passkey (ex.: Telemóvel)",
  passkeyAcrescentar: "Acrescentar passkey",
  passkeyAcrescentada: "A passkey foi acrescentada.",
  passkeyRetirar: "Retirar",
  passkeyRetirarConfirmar:
    "Retirar a passkey «{nome}»? As outras sessões abertas terminam; esta continua.",
  passkeyRetirada: "A passkey foi retirada. As outras sessões terminaram.",
  sessoesTitulo: "Sessões abertas",
  sessoesContagem: "{n} sessões abertas",
  sessoesContagemUm: "1 sessão aberta",
  sessaoEsta: "Esta sessão",
  sessoesTerminar: "Terminar todas as outras",
  sessoesTerminarConfirmar:
    "Terminar todas as outras sessões? Quem estiver nelas tem de entrar outra vez.",
  sessoesTerminadas: "As outras sessões terminaram.",
  recuperacaoTitulo: "Códigos de recuperação",
  recuperacaoExplicacao:
    "Se perder todas as passkeys, um código de recuperação devolve-lhe a conta. Gerar códigos novos anula os antigos.",
  codigosGerar: "Gerar códigos novos",
  codigosGerarConfirmar: "Gerar 10 códigos novos? Os antigos deixam de valer.",
  erroUltimaPasskey:
    "É a última forma de entrar na conta. Acrescente outra passkey antes de retirar esta.",
  erroPasskeyJaRegistada: "Este dispositivo já tem uma passkey desta conta.",
  erroPasskeyNaoExiste: "Esta passkey já não existe na conta.",
  erroPasskeyNaoAceite:
    "A passkey não foi aceite: pode ser de outra conta, ou o pedido demorou mais de 5 minutos. A sessão continua aberta; tente outra vez.",
  erroRecuperarPasskey:
    "A passkey nova não foi aceite, ou o pedido demorou mais de 5 minutos. Tente outra vez.",
  erroReautenticar:
    "Esta operação pede que confirme quem é, e não foi possível com uma passkey neste navegador. Saia e volte a entrar (com a passkey ou com a palavra-passe) e repita nos 10 minutos seguintes.",
  semPasskeysEntrar:
    "Este navegador não permite passkeys. Entre com a palavra-passe, se a tiver activado, ou use um navegador actual (Chrome, Edge, Firefox ou Safari).",
  autenticadorDepois:
    "Ao confirmar, as outras sessões abertas terminam. Se já tinha o Eurolify nesta aplicação, apague depois a entrada antiga.",
  erroNomePasskey: "O nome da passkey tem de ter entre 1 e 100 caracteres.",

  entrarPerdeu: "Perdeu a passkey?",
  recuperarTitulo: "Recuperar a conta",
  recuperarExplicacao:
    "Com o e-mail da conta e um dos códigos de recuperação, registe uma passkey nova neste dispositivo. O código usado deixa de valer.",
  recuperarEmail: "E-mail da conta",
  recuperarCodigo: "Código de recuperação",
  recuperarCodigoAjuda: "Tem o formato XXXX-XXXX-XXXX-XXXX.",
  recuperarNome: "Nome da passkey nova (opcional)",
  recuperarBotao: "Recuperar com uma passkey nova",
  recuperarVoltar: "Entrar com uma passkey",
  erroRecuperar:
    "O e-mail ou o código não estão certos, ou o código já foi usado.",
  erroCodigo:
    "Escreva o código de recuperação completo: 16 letras e algarismos.",
  recuperadoTitulo: "A conta foi recuperada",
  recuperadoTexto:
    "As outras sessões terminaram e o código usado já não vale. Falta:",
  recuperadoRetirar:
    "retirar as passkeys que já não tem (a do dispositivo perdido continua a valer até a retirar);",
  recuperadoCodigos: "gerar códigos de recuperação novos;",
  recuperadoChaves: "como dono, rever as chaves de API que criou.",
  recuperadoFechar: "Fechar o aviso",

  // Palavra-passe e autenticador (docs/22 §9.2).
  palavraPasseTitulo: "Palavra-passe e autenticador",
  palavraPasseExplicacao:
    "Uma alternativa à passkey: entra com o e-mail, a palavra-passe e o código de 6 dígitos de uma aplicação de autenticação. A palavra-passe sozinha nunca entra.",
  palavraPasseActiva: "Estado: activa.",
  palavraPasseNenhuma: "Estado: não activada.",
  palavraPassePendente:
    "Estado: ficou a meio de activar. Escolha a palavra-passe outra vez para recomeçar.",
  palavraPasseActivar: "Activar palavra-passe e autenticador",
  palavraPasseTrocar: "Trocar a palavra-passe e o autenticador",
  palavraPasseCampo: "Palavra-passe (12 caracteres ou mais)",
  palavraPasseRepetir: "Repita a palavra-passe",
  palavraPasseContinuar: "Continuar",
  cancelar: "Cancelar",
  autenticadorPasso:
    "Leia este código QR com a aplicação de autenticação. Se não conseguir, escreva o segredo à mão na aplicação.",
  autenticadorQr: "Código QR para a aplicação de autenticação",
  autenticadorSegredo: "Segredo",
  autenticadorAviso:
    "O código QR e o segredo só aparecem agora. Não os guarde noutro sítio nem os envie a ninguém.",
  autenticadorCodigo: "Código de 6 dígitos da aplicação",
  autenticadorConfirmar: "Confirmar e activar",
  palavraPasseActivada:
    "A palavra-passe e o autenticador ficaram activos. As outras sessões terminaram.",
  palavraPasseRetirar: "Retirar a palavra-passe",
  palavraPasseRetirarConfirmar:
    "Retirar a palavra-passe e o autenticador? As outras sessões abertas terminam; esta continua.",
  palavraPasseRetirada:
    "A palavra-passe foi retirada. As outras sessões terminaram.",
  erroPalavraPasseCurta:
    "A palavra-passe tem de ter entre 12 e 256 caracteres.",
  erroPalavraPasseDiferente: "As duas palavras-passe não são iguais.",
  erroCodigoTotp: "Escreva os 6 algarismos do código.",
  erroCodigoTotpErrado:
    "O código não está certo. Confira a hora do telemóvel e tente com o código seguinte.",
  erroPalavraPasseNaoPendente:
    "Esta activação já não vale (foi substituída ou concluída noutro sítio). Comece outra vez.",
  erroPalavraPasseUltima:
    "É a última forma de entrar na conta. Acrescente uma passkey antes de retirar a palavra-passe.",
  erroPalavraPasseNaoExiste: "A conta já não tem palavra-passe.",

  entrarComPalavraPasse: "Entrar com palavra-passe",
  entrarEmail: "E-mail",
  entrarPalavraPasse: "Palavra-passe",
  entrarCodigo: "Código de 6 dígitos do autenticador",
  entrarPalavraPasseBotao: "Entrar",
  erroEntrarPalavraPasse:
    "O e-mail, a palavra-passe ou o código não estão certos.",
  erroPalavraPasseIndisponivel:
    "Entrar com palavra-passe não está disponível neste servidor.",

  // Chaves de API (docs/22 §9.3).
  chavesTitulo: "Chaves de API",
  verChaves: "Chaves de API",
  chavesExplicacao:
    "As chaves deixam outros programas (uma integração, a faturação, uma IA) usar a API deste comerciante. Cada chave só faz o que os seus âmbitos permitem.",
  chavesVazio: "Ainda não há chaves.",
  chavesContagem: "{n} chaves",
  chavesContagemUm: "1 chave",
  colunaTipo: "Tipo",
  colunaAmbitos: "Âmbitos",
  colunaPrefixo: "Começa por",
  colunaCriadaPor: "Criada por",
  colunaEstado: "Estado",
  tipo_servidor: "Servidor",
  tipo_publica: "Pública (loja)",
  estadoActiva: "Activa",
  estadoRevogada: "Revogada a {data}",
  estadoExpirada: "Expirou a {data}",
  semPrazo: "Sem prazo",
  autorVoce: "Você",
  autorOperador: "Operador",
  autorChave: "A chave «{nome}»",
  autorChaveSemNome: "Outra chave",
  autorAntigo: "Alguém que já saiu da equipa",
  ambito_catalog_read: "Ler o catálogo",
  ambito_catalog_write: "Alterar o catálogo",
  ambito_catalog_publish: "Publicar artigos",
  ambito_catalog_import: "Importar artigos",
  ambito_merchant_read: "Ler os dados do comerciante",
  ambito_merchant_write: "Alterar os dados do comerciante",
  ambito_keys_write: "Gerir chaves",
  ambito_storefront: "Loja (só leitura pública)",
  criarChaveTitulo: "Criar uma chave de servidor",
  criarChaveExplicacao:
    "Uma chave de servidor guarda-se só no servidor de quem a usa, nunca numa página nem numa aplicação de telemóvel. As chaves públicas, para a loja, chegam com as lojas.",
  chaveNome: "Nome (ex.: Integração da faturação)",
  chaveAmbitos: "O que a chave pode fazer",
  chaveExpira: "Expira a (opcional)",
  chaveCriar: "Criar a chave",
  chaveSegredoTitulo: "O segredo da chave «{nome}»",
  chaveSegredoAviso:
    "Só aparece agora. Copie-o para o sítio onde vai ser usado; se o perder, revogue a chave e crie outra.",
  chaveFechar: "Já o guardei",
  chaveRevogar: "Revogar",
  chaveRevogarConfirmar:
    "Revogar a chave «{nome}»? Deixa de funcionar já, e não há volta atrás.",
  chaveRevogada: "A chave foi revogada.",
  erroChaveAmbitos: "Escolha pelo menos uma coisa que a chave pode fazer.",
  erroChaveExpira: "A data de expiração tem de ser no futuro.",
  erroChaveJaRevogada: "Esta chave já tinha sido revogada.",
  erroChaveNaoExiste: "Esta chave já não existe.",
  erroChaveUltimaGestora:
    "É a última chave que gere chaves; crie outra antes de a revogar.",
  erroChaveComercianteInactivo:
    "Este comerciante está suspenso ou fechado: não cria chaves, mas pode revogá-las.",
  erroChaveAmbitosAMais:
    "Não pode dar a uma chave âmbitos que o seu papel não tem.",
};

export type Textos = typeof pt;
