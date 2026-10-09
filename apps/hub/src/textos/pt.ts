// Textos do Hub em português de Portugal, masculino universal (docs/22 §5).
// As outras línguas têm as mesmas chaves (o tipo obriga; o teste confere).

export const pt = {
  marca: "Eurolify Hub",
  saltarParaConteudo: "Saltar para o conteúdo",
  lingua: "Língua",
  tema: "Tema",
  tema_automatico: "Tema automático",
  tema_claro: "Tema claro",
  tema_escuro: "Tema escuro",
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
    "Este e-mail já tem conta. Entre com ela para aceitar o convite.",

  codigosTitulo: "Os seus códigos de recuperação",
  codigosExplicacao:
    "Se perder a passkey, um destes códigos devolve-lhe a conta. Cada um serve uma vez.",
  codigosAviso:
    "Não voltam a aparecer. Guarde-os agora num sítio seguro, fora deste computador.",
  copiar: "Copiar",
  copiado: "Copiado",
  codigosGuardados: "Já os guardei",

  inicioTitulo: "Início",
  inicioEntrouComo: "Entrou como",
  inicioVazio:
    "Não pertence a nenhuma equipa. Peça um convite a quem gere o comerciante.",
  inicioComerciante: "Comerciante",
  inicioEscolher: "Escolha o comerciante",
  inicioEscolherExplicacao:
    "Pertence a mais do que uma equipa. Escolha com qual quer trabalhar.",
  inicioComercianteDesconhecido:
    "Este comerciante não está entre os seus. Escolha um da lista.",
  inicioMudarComerciante: "Mudar de comerciante",
  modulosTitulo: "Módulos",
  modulosPesquisar: "Pesquisar módulos",
  modulosLimpar: "Limpar a pesquisa",
  modulosContagem: "{n} módulos",
  modulosContagemUm: "1 módulo",
  modulosSemResultados: "Nenhum módulo corresponde a «{consulta}».",
  modulosNenhum:
    "O seu papel neste comerciante ainda não tem módulos disponíveis.",
  modulosOpacos: "Superfícies opacas",
  modulo_equipa: "Equipa",
  modulo_artigos: "Artigos",
  modulo_chaves: "Chaves de API",
  termos_equipa: "membros convites papéis pessoas",
  termos_artigos: "catálogo produtos variantes",
  termos_chaves: "api integrações servidor",

  papel_dono: "Dono",
  papel_gestor: "Gestor",
  papel_armazem: "Armazém",
  papel_apoio: "Apoio",

  equipaTitulo: "Equipa",
  equipaVoltar: "Voltar ao início",
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
  chaveExpira:
    "Expira a (opcional; até ao fim desse dia, na hora deste computador)",
  chaveCriar: "Criar a chave",
  chaveSegredoTitulo: "O segredo da chave «{nome}»",
  chaveSegredoAviso:
    "Só aparece agora. Copie-o para o sítio onde vai ser usado; se o perder, revogue a chave e crie outra.",
  chaveFechar: "Já o guardei",
  chaveRevogar: "Revogar",
  chaveRevogarConfirmar:
    "Revogar a chave «{nome}»? Deixa de funcionar já, e não há volta atrás.",
  chaveRevogada: "A chave foi revogada.",
  autorDesconhecido: "Não identificado",
  ambitoKeysAviso:
    "Uma chave com «Gerir chaves» pode criar e revogar outras chaves deste comerciante: dê-a só a quem gere as integrações.",
  erroChaveTalvezCriada:
    "Não houve resposta do servidor: a chave pode ter sido criada. Se aparecer na lista, o segredo perdeu-se: revogue-a e crie outra.",
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

  // A gestão da equipa (docs/22 §10).
  papelMudar: "Mudar",
  papelMudarRotulo: "Papel de {nome}",
  papelMudarConfirmar:
    "Mudar o papel de {nome} para {papel}? Os convites em aberto e as chaves de servidor que criou e que o papel novo já não permite são cancelados e revogados, com as chaves criadas a partir delas: as integrações que as usam deixam de funcionar.",
  papelMudado: "O papel de {nome} passou a {papel}.",
  membroTirar: "Tirar da equipa",
  membroTirarConfirmar:
    "{nome} deixa de entrar neste comerciante. Os convites em aberto que criou aqui são cancelados e as chaves de servidor que criou (e as criadas a partir delas) são revogadas: as integrações que as usam deixam de funcionar. As chaves públicas da loja ficam. Continuar?",
  membroTirado: "{nome} foi tirado da equipa.",
  membroSair: "Sair desta equipa",
  membroSairConfirmar:
    "Sair desta equipa? Deixa de entrar neste comerciante. Os convites em aberto que criou aqui são cancelados e as chaves de servidor que criou (e as criadas a partir delas) são revogadas: as integrações que as usam deixam de funcionar. As chaves públicas da loja ficam.",
  membroUltimoDono: "É o último dono: para sair, nomeie outro dono antes.",
  conviteJaTemConta:
    "Já tem conta (com passkey ou palavra-passe)? Entre primeiro no Hub e volte a abrir esta ligação.",
  erroUltimoDono: "É o último dono: nomeie outro dono antes.",
  erroProprioPapel: "Ninguém muda o seu próprio papel.",
  erroMembroNaoExiste: "Este membro já não está na equipa.",
  erroConviteOutraPessoa:
    "Este convite é para outro e-mail. Saia e entre com a conta desse e-mail.",
  erroJaMembro: "Já é membro deste comerciante.",
  conviteEntrarEAceitar: "Entrar com passkey e aceitar",
  conviteSoPalavraPasse:
    "Se entra com a palavra-passe, entre primeiro no Hub e volte a abrir a ligação do convite.",
  conviteComSessao: "Entrou como {nome} ({email}).",
  conviteAceitarComConta: "Aceitar com esta conta",
  conviteOutraConta:
    "Se o convite é para outro e-mail, saia primeiro e volte a abrir a ligação.",
  artigosTitulo: "Artigos",
  artigosContagem: "{n} artigos",
  artigosContagemUm: "1 artigo",
  artigosContagemFiltro: "{n} de {total} artigos",
  artigosVazio: "Ainda não há artigos. Entram pela API ou por importação.",
  artigosSemResultados: "Nenhum artigo com este filtro.",
  artigosLimparFiltro: "Limpar o filtro",
  artigosFiltros: "Filtrar os artigos",
  artigosFiltroEstado: "Estado",
  artigosTodos: "Todos",
  artigosSku: "SKU",
  artigosProcurarBotao: "Procurar",
  artigosSemPermissao: "Não pode ver este comerciante.",
  artigosMostrarMais: "Mostrar mais",
  artigosDoSistema: "vem do sistema de gestão",
  colunaMarca: "Marca",
  colunaAlterado: "Alterado em",
  estadoArtigo_rascunho: "Rascunho",
  estadoArtigo_activo: "Activo",
  estadoArtigo_arquivado: "Arquivado",
  tipoArtigo_fisico: "Físico",
  tipoArtigo_servico: "Serviço",
  tipoArtigo_digital: "Digital",
  tipoArtigo_bilhete: "Bilhete",
  tipoArtigo_cartao_oferta: "Cartão-oferta",
  artigoTitulo: "Artigo",
  artigoVoltar: "Voltar aos artigos",
  artigoNaoExiste: "Este artigo não existe neste comerciante.",
  artigoDoSistemaRef: "vem do sistema de gestão, com a referência {ref}",
  artigoCriadoAlterado: "Criado em {criado} · alterado em {alterado}",
  artigoDescricao: "Descrição",
  artigoSemDescricao: "Sem descrição.",
  artigoVariantes: "Variantes",
  colunaUnidade: "Unidade de venda",
  colunaGtin: "GTIN",
  colunaConteudo: "Conteúdo",
  colunaPeso: "Peso",
  estadoVariante_activa: "Activa",
  estadoVariante_arquivada: "Arquivada",
  unidade_unidade: "Unidade",
  unidade_par: "Par",
  unidade_caixa: "Caixa",
  unidade_embalagem: "Embalagem",
  unidade_conjunto: "Conjunto",
  artigoImagens: "Imagens",
  artigoSemImagens: "Sem imagens.",
  artigoImagemPrincipal: "Principal",
  artigoImagemDaVariante: "Só da variante {sku}",
  artigoSemTextoAlternativo: "Sem texto alternativo — impede a publicação.",
  artigoImagemFalhou: "A imagem não carregou.",
  artigoPublicacoes: "Publicações",
  artigoSemPublicacoes: "Ainda não está publicado em nenhuma loja.",
  colunaCanal: "Canal",
  colunaMercado: "Mercado",
  colunaData: "Data",
  colunaMotivo: "Motivo",
  estadoPublicacao_rascunho: "Rascunho",
  estadoPublicacao_publicado: "Publicado",
  estadoPublicacao_arquivado: "Arquivado",
  motivoArquivo_retirada: "Retirado da venda",
  motivoArquivo_artigo_arquivado: "O artigo foi arquivado",
  motivoArquivo_mercado_arquivado: "O mercado foi arquivado",
  motivoArquivo_canal_arquivado: "O canal foi arquivado",
  motivoArquivo_verificacao_falhou: "Deixou de cumprir as regras de publicação",
  artigoEditar: "Editar",
  artigoEditarTitulo: "Editar o artigo",
  artigoActivar: "Activar",
  artigoArquivar: "Arquivar",
  artigoRepor: "Repor",
  artigoConfirmarArquivar:
    "Arquivar o artigo tira-o de venda em todas as lojas. As publicações não voltam sozinhas ao repor. Arquivar?",
  artigoExternoAviso:
    "Este artigo vem do sistema de gestão: o nome, a descrição, a marca, o estado e as variantes alteram-se lá. As imagens alteram-se aqui.",
  artigoGuardado: "Alterações guardadas.",
  artigoGuardar: "Guardar",
  artigoConflito:
    "Outra pessoa alterou este artigo entretanto. Não guardámos as suas alterações.",
  artigoConflitoActual:
    "O que está guardado agora está por baixo; o que escreveu ficou nos campos. Guardar outra vez substitui o que está guardado.",
  artigoSairSemGuardar: "Tem alterações por guardar. Sair sem guardar?",
  artigoCaracteres: "{n} de {max} caracteres",
  artigoNomeObrigatorio: "O nome é obrigatório.",
  artigoExternoCampo: "Este campo vem do sistema de gestão: altera-se lá.",
  artigoArquivarVariante: "Arquivar variante",
  artigoConfirmarArquivarVariante:
    "Arquivar a variante {sku} não se desfaz. Arquivar?",
  artigoUltimaVariante:
    "É a última variante activa: o artigo deixa de se poder publicar até ter outra. Arquivar a variante {sku}, sem volta?",
  artigoEditarTexto: "Editar texto alternativo",
  artigoTextoAlternativo: "Texto alternativo",
  artigoTornarPrincipal: "Tornar principal",
  artigoMoverAntes: "Mover para antes",
  artigoMoverDepois: "Mover para depois",
  artigoSemVariantesActivas:
    "Para activar, o artigo precisa de pelo menos uma variante activa.",
  artigoTransicaoInvalida:
    "O artigo já não estava no estado que o ecrã mostrava. A ficha foi recarregada.",
  artigoVarianteJaArquivada: "A variante já estava arquivada.",
  artigoOrdemAMeio:
    "A ordem das imagens ficou a meio: confira-a e volte a mover, se for preciso.",
  conviteInstrucao: "Escreva o seu nome e crie a conta com uma passkey.",
  conviteResumo:
    "Foi convidado para a equipa de {comerciante}, com o papel {papel}.",
  conviteParaEmail: "O convite é para {email} e expira a {data}.",
  conviteEmailDiferente:
    "Este convite é para {email} e entrou como {sessao}. Saia e entre com a conta desse e-mail.",
  artigoCriar: "Criar artigo",
  artigosVazioCriar: "Ainda não há artigos.",
  artigoNovoTitulo: "Criar artigo",
  artigoNovoTipo: "Tipo",
  artigoNovoVariante: "Variante {n}",
  artigoNovoGtinOrigem: "Origem do GTIN",
  gtinOrigem_gs1_comerciante: "GS1 do comerciante",
  gtinOrigem_fornecedor: "Do fornecedor",
  gtinOrigem_interno: "Interno",
  artigoNovoEscolher: "Escolha",
  artigoNovoQuantidade: "Quantidade do conteúdo",
  artigoNovoUnidadeConteudo: "Unidade do conteúdo",
  artigoNovoSemUnidade: "Sem conteúdo",
  artigoNovoPeso: "Peso (g)",
  artigoNovoComprimento: "Comprimento (mm)",
  artigoNovoLargura: "Largura (mm)",
  artigoNovoAltura: "Altura (mm)",
  artigoNovoSemPeso: "Sem peso, não se pode publicar.",
  artigoNovoAcrescentar: "Acrescentar outra variante",
  artigoNovoRetirar: "Retirar a variante {n}",
  artigoNovoMaximo: "No máximo 20 variantes aqui; mais pela importação.",
  artigoNovoSkuObrigatorio: "O SKU é obrigatório.",
  artigoNovoSkuRepetido: "Este SKU está repetido neste formulário.",
  artigoNovoSkuExiste:
    "Este SKU já existe neste comerciante (também nos artigos arquivados).",
  artigoNovoGtinFormato: "O GTIN tem 8, 12, 13 ou 14 algarismos.",
  artigoNovoGtinOrigemFalta: "Escolha a origem do GTIN.",
  artigoNovoGtinInvalido:
    "O GTIN não é válido: o último algarismo não confere.",
  artigoNovoGtinRepetido: "Este GTIN já existe neste comerciante.",
  artigoNovoConteudoIncompleto:
    "Escreva a quantidade e a unidade do conteúdo, ou nenhuma.",
  artigoNovoInteiro: "Um número inteiro, sem casas decimais.",
  artigoNovoCorrigir: "Há campos por corrigir.",
  artigoNovoNaoCriado:
    "A ligação falhou e não encontrámos o artigo. Pode tentar outra vez: se tiver ficado criado, o ecrã abre-o.",
  artigoCriado: "Artigo criado em rascunho.",
  artigoJaCriado: "O artigo já tinha sido criado.",
  artigoSkuDuplicado: "Um dos SKU já existe neste comerciante.",
  artigoGtinDuplicado: "Um dos GTIN já existe neste comerciante.",
  artigoGtinInvalido:
    "Um dos GTIN não é válido: o último algarismo não confere.",
  artigoConteudoIncompleto:
    "Escreva a quantidade e a unidade do conteúdo, ou nenhuma.",
  artigoAcrescentarImagem: "Acrescentar imagem",
  artigoImagemRegras: "JPEG, PNG ou WebP, até 10 MB.",
  artigoImagemEscolhida: "{nome} · {tamanho}",
  artigoImagemTextoAjuda:
    "Descreva a imagem a quem não a vê. Ex.: «Frasco de verniz verde, de frente».",
  artigoImagemSemTextoAgora:
    "Guardar sem texto alternativo (o artigo não se pode publicar sem ele)",
  artigoImagemSemTexto:
    "Escreva o texto alternativo, ou marque que guarda sem ele.",
  artigoImagemAEnviar: "A enviar… {p}%",
  artigoImagemGrande: "A imagem passa de 10 MB.",
  artigoImagemTipo: "Só se aceitam imagens JPEG, PNG ou WebP.",
  artigoImagemIlegivel:
    "O ficheiro não é uma imagem JPEG, PNG ou WebP que se consiga ler até ao fim.",
  artigoImagemOutroEnvio:
    "Há demasiados envios ao mesmo tempo; tente daqui a pouco.",
  artigoImagemSemEspaco: "O espaço das imagens deste comerciante está cheio.",
  artigoImagemAcrescentada: "Imagem acrescentada.",
  artigoImagemTirada: "Imagem tirada do artigo.",
  artigoTirarImagem: "Tirar a imagem",
  artigoConfirmarTirarImagem:
    "Tirar a imagem do artigo? O ficheiro fica guardado.",
  artigoImagemSemTextoConfirmar:
    "Guardar sem texto alternativo tira o artigo de venda nas lojas onde está publicado. Ao escrever o texto, é preciso publicá-lo outra vez. Guardar sem texto?",
  artigoImagemProgresso: "Envio da imagem",
  artigoHistorico: "Histórico",
  historicoTitulo: "Histórico do artigo",
  historicoComeco:
    "O histórico começa no dia em que esta função entrou; as alterações de antes não aparecem.",
  historicoVazio: "Ainda não há alterações registadas.",
  historicoSemPermissao: "O seu papel não vê o histórico deste artigo.",
  historicoMostrarMais: "Mostrar mais",
  historicoPelaImportacao: "pela importação",
  historicoAutomatico: "Automático",
  historicoChave: "Chave «{nome}»",
  historicoChaveSemNome: "Chave de API",
  historicoPessoaDeFora: "Pessoa de fora desta equipa",
  historicoCriou: "criou",
  historicoAlterou: "alterou",
  historicoApagou: "apagou",
  historicoParte_artigo: "o artigo",
  historicoParte_variante: "a variante {sku}",
  historicoParte_varianteSemSku: "uma variante",
  historicoParte_media: "uma imagem",
  historicoParte_traducao: "uma tradução",
  historicoParte_publicacao: "uma publicação",
  historicoParte_opcao: "uma opção",
  historicoParte_valor_opcao: "um valor de opção",
  historicoParte_variante_valor: "o valor de uma variante",
  historicoParte_componente: "um componente do kit",
  historicoParte_artigo_categoria: "uma categoria",
  historicoParte_colecao_artigo: "uma colecção",
  historicoValorVazio: "vazio",
  historicoSim: "sim",
  historicoNao: "não",
  historicoVerTudo: "Ver tudo",
  historicoPosicao: "Posição",
};

export type Textos = typeof pt;
