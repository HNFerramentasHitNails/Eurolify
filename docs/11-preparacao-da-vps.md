# Preparação da VPS

> **Versão de 03/10/2026.** Decidido: o Eurolify fica numa VPS operada pelo
> Diogo e pelo Bruno ([ADR-0015](adr/0015-alojamento-numa-vps.md)); o Claude
> opera-a com acesso total ([ADR-0016](adr/0016-o-claude-opera-a-vps.md));
> publica-se pelo GitHub ([ADR-0005](adr/0005-publicacao-pelo-github.md),
> ponto 1); um só ensaio, actualizado a cada entrada no `main`
> ([ADR-0014](adr/0014-um-so-ensaio.md)); o código passa por duas revisões
> ([ADR-0013](adr/0013-revisao-do-codigo.md)); a máquina é uma VPS-3 da OVH
> ([ADR-0017](adr/0017-vps-3-da-ovh.md)), a do ensaio por agora no Reino Unido
> ([ADR-0018](adr/0018-vps-do-ensaio-no-reino-unido.md), até 31/03/2027:
> [ADR-0019](adr/0019-fim-da-vps-no-reino-unido.md)). **Tudo o resto aqui é proposta**
> e está marcado assim. As decisões por tomar estão no §7, por ordem.
>
> Este documento é a lista do que a preparação faz. O script de instalação vem
> depois, num ramo, e entra no `main` com as duas revisões do ADR-0013.

## 1. O que se compra

Preços da página portuguesa das VPS da OVH, lidos a 03/10/2026 — *«a partir
de»*, sem IVA:

| Plano | vCores | RAM | Disco | Preço/mês | Cópia incluída |
|---|---|---|---|---|---|
| VPS-2 | 4 | 8 GB | 75 GB NVMe | 7,21 € | *«Backup automatizado 1 dia»* |
| **VPS-3** | 6 | 12 GB | 100 GB NVMe | **10,40 €** | idem |
| VPS-4 | 8 | 24 GB | 200 GB NVMe | 19,96 € | idem |

- ✅ **Decidido** (Diogo, 03/10/2026, [ADR-0017](adr/0017-vps-3-da-ovh.md)): uma
  **VPS-3 da OVH** para começar (o ensaio, durante a construção). Proposta: uma
  segunda máquina para a produção antes do primeiro comerciante de fora. A
  VPS-3 foi proposta minha (**C**, carga não medida): PostgreSQL, a API, o Hub e as
  construções das imagens na mesma máquina; a Coolify, se for usada, pede no
  mínimo 2 núcleos e 2 GB.
- **Centro de dados na UE** (regra 4 do `AGENTS.md`), escolhido na compra. O
  catálogo público da OVH para Portugal (lido a 03/10/2026) oferece ao VPS-3
  `DE`, `EU-SOUTH-MIL`, `EU-WEST-RBX`, `GRA`, `SBG` e `WAW` — na UE, pelo
  código — e também `UK`, `BHS`, `SGP`, `SYD` e `YNM`, que não servem.
- ⚠️ **A VPS comprada a 03/10/2026 (`vps-c01fa544`) está no Reino Unido**
  (RIPE: `VPS-UK2`, país GB; confirmado pelo Diogo na consola): só havia essa
  localidade. Fica para o ensaio, **sem dados pessoais reais**, até à
  migração para um servidor em Paris, **até 31/03/2027**
  ([ADR-0018](adr/0018-vps-do-ensaio-no-reino-unido.md),
  [ADR-0019](adr/0019-fim-da-vps-no-reino-unido.md)). Paris não está na
  lista dos centros das VPS; a 03/10/2026, 23:10 UTC, todos os 11 estavam
  esgotados para o VPS-3 (API pública da OVH).
- **Tudo o que se instala sai do script** (§3), para que a migração seja
  correr o mesmo script em Paris e repor a base.
- **Cópias fora da máquina**: num armazenamento na UE, noutro sítio que não a
  VPS. A cópia diária da OVH não chega (ver §3.5). Preço: **não verifiquei**.

## 2. Quem faz o quê

| Passo | Quem |
|---|---|
| Comprar a VPS, escolher o centro de dados na UE e o sistema (proposta: Ubuntu LTS) | o Diogo ou o Bruno, na consola do fornecedor |
| Criar um par de chaves SSH no computador de cada um e entregar só a parte pública | cada um |
| Escrever o script de preparação | o Claude, num ramo; revisto pela outra pessoa e pelo Codex (ADR-0013) |
| Correr o script e operar a máquina | o Claude, com a confirmação de quem pediu (ADR-0016) |
| Pôr a chave da sessão nas definições do ambiente do Claude Code | cada um, no seu ambiente — **nunca no chat** |
| Ler e assinar o acordo de tratamento de dados do fornecedor | o Diogo ou o Bruno, antes do primeiro dado pessoal real (§4) |

## 3. O que a preparação instala

Lista de operações; os pormenores ficam no script e na revisão dele.

### 3.1 Acesso

- Um utilizador de trabalho sem ser `root`; o `root` não entra por SSH.
- SSH **só com chave**, sem palavra-passe; uma chave por pessoa (ADR-0016),
  com data de troca. Quem sai perde a chave no mesmo dia (lição do Hub:
  contas de ex-colaboradores activas, 28/08/2026).
- ✅ **A chave do Diogo (`eurolify_vps`) troca-se a 31/03/2027**, com a
  migração para Paris: máquina nova, chave nova (Diogo, 03/10/2026, decisão
  AB). A do Bruno tem data própria quando for criada.
- Bloqueio de quem tenta entrar à força (proposta: `fail2ban`).

### 3.2 Firewall — fechado por omissão

- Abertas só as portas 22 (SSH), 80 e 443. **O PostgreSQL nunca fica aberto à
  Internet** (skill `observability-security`, «fechado por omissão»).
- Abrir uma porta nova é um acto explícito, com confirmação e registo (§3.9).

### 3.3 Actualizações

- Actualizações de segurança do sistema automáticas.
- Reinícios **só fora do horário de trabalho e anunciados** (lição do Hub: um
  reinício da base às 13h deixou toda a gente ≈ 8 minutos à espera,
  02/09/2026).

### 3.4 Contentores e certificados

- A API e o Hub correm em contentores (Docker).
- À frente, um proxy com certificados automáticos (proposta: o da Coolify, ou o
  Caddy se não houver Coolify).

### 3.5 PostgreSQL

- **Versão:** a última estável na altura da instalação (qual é a 03/10/2026:
  **não verifiquei**).
- **Só ouve dentro da máquina** (ou da rede privada entre máquinas).
- **Utilizadores separados** (proposta): um para as migrações, um para a
  aplicação (sem poder mudar tabelas) e um **só de leitura**, para relatórios e
  para o Claude ler sem risco de escrever.
- **Isolamento entre comerciantes imposto pela base**, com testes que tentam
  ler o vizinho e têm de falhar (`docs/02` §5).
- **Cópias:**
  - contínuas (o registo de transacções) e completas todos os dias, **para fora
    da máquina**, cifradas, **nunca públicas** (lição: as cópias do Hub
    nasciam abertas ao mundo, 12/08/2026);
  - a cópia diária da OVH não chega: com ela, uma avaria às 18h perde o que
    entrou desde a noite anterior;
  - **ensaio de reposição agendado** — uma cópia que nunca foi reposta não é
    uma cópia (skill `observability-security`);
  - **quanto se pode perder e em quanto tempo se volta**: por decidir (§7).
- **Segunda máquina para a base** (réplica pronta a assumir): por decidir (§7).

### 3.6 Publicação a partir do GitHub

A cada entrada no `main` (ADR-0014): os testes correm no GitHub, constrói-se a
imagem e a VPS passa a correr a nova versão. Duas formas (por decidir, §7):

- **Coolify** na VPS: publica a partir do GitHub e mostra o estado; é mais uma
  peça na máquina, com uma página de administração que tem de nascer fechada
  (a documentação avisa que quem chegar primeiro ao registo fica administrador
  com acesso total à máquina).
- **O GitHub por SSH**: o fluxo do GitHub entra na VPS com uma chave que **só
  pode publicar** (um comando fixo), guardada nos segredos do GitHub.

### 3.7 O ensaio

- Um só, actualizado a cada entrada no `main` (ADR-0014).
- **Sem dados pessoais reais** (`docs/02` §6).
- Separado da produção: base e contentores próprios. Na mesma máquina ou não:
  por decidir (§7).

### 3.8 Alertas — o que pára em silêncio

- Máquina ou serviço em baixo; disco acima do limite; cópia que não correu ou
  reposição que falhou; certificado a expirar; actualizações por aplicar.
- A data de fim da VPS no Reino Unido e a troca da chave do Diogo, ambas a
  **31/03/2027** (ADR-0019, decisão AB): aviso a partir de 01/03/2027
  (proposta).
- Para onde vão (e-mail, com fornecedor na UE): por decidir (§7).
- Lição: o recálculo diário esteve parado 15 dias sem ninguém saber (repo
  `claude`, 05/09/2026).

### 3.9 Registo do que se faz na máquina

- Cada acção fica registada na máquina: quem, o quê, quando (ADR-0016).
- Cada alteração à máquina fica também numa memória em `memoria/`.

### 3.10 Segredos

- Nunca no repositório nem no chat (`AGENTS.md`).
- Na máquina, só legíveis pelo serviço que os usa; um cofre de segredos é
  proposta, por decidir.

## 4. Antes do primeiro dado pessoal real

- Acordo de tratamento de dados com o fornecedor da VPS e com o das cópias, e
  ambos no registo de tratamentos (skill `eu-gdpr-privacy`).
- Centro de dados na UE confirmado, para a VPS e para as cópias. O dado
  nunca entra na VPS do ensaio, que está no Reino Unido (ADR-0018).
- O teste de intrusão antes do primeiro comerciante de fora continua
  obrigatório (`docs/05`, `docs/10` §5).

## 5. Como o Claude chega à máquina

✅ **Decidido** (Diogo, 03/10/2026,
[ADR-0020](adr/0020-acesso-pelo-computador-do-diogo.md)): pelo **Claude Code no
computador do Diogo (Windows), por SSH**, com uma chave do Diogo; o Bruno, no
dele, com a dele. Os passos estão no §5.1.

Como se chegou aqui: numa sessão do Claude Code na cloud, uma ligação directa à
porta 22 (SSH) do `github.com` não respondeu em 8 s (03/10/2026); o resto do
teste foi bloqueado pelo sistema de permissões da sessão. Com a VPS comprada,
a porta 22 dela também não respondeu em 10 s a partir da cloud (03/10/2026);
não se sabe se o bloqueio é da sessão ou da VPS. Caminhos:

| Caminho | Como | Estado |
|---|---|---|
| ✅ **a) O Claude Code no computador do Diogo ou do Bruno** | SSH directo, com a chave de cada um | **escolhido** (ADR-0020); por testar |
| b) Um servidor MCP na VPS, por HTTPS | o endereço tem de ser autorizado na rede do ambiente (definições do ambiente → *Network access*, [documentação](https://code.claude.com/docs/en/cloud-environments#network-access)); é mais uma porta para uma ferramenta com acesso total, com autenticação forte | **não testado** |

A a) não expõe nada além do SSH. A b) só se for preciso operar a partir da
cloud.

### 5.1 Ligar o computador do Diogo (Windows)

Fontes: documentação da Microsoft, *Key-based authentication in OpenSSH for
Windows*, e do Claude Code, `code.claude.com/docs/en/setup`, lidas a
03/10/2026. **A chave privada, a frase-passe e a palavra-passe da OVH nunca
saem do computador** — nem para o chat, nem para o repositório.

1. **O cliente SSH existe?** No PowerShell: `ssh -V`.
2. **Uma chave só para a VPS** (não a do GitHub), com frase-passe:
   `ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\eurolify_vps -C "diogo-eurolify-vps"`.
3. **O agente de SSH**, para o Claude Code usar a chave sem pedir a
   frase-passe a cada comando. Vem desligado por omissão (Microsoft). No
   PowerShell **como administrador**:
   `Get-Service ssh-agent | Set-Service -StartupType Automatic` e
   `Start-Service ssh-agent`; depois, no PowerShell normal:
   `ssh-add $env:USERPROFILE\.ssh\eurolify_vps`.
4. **Pôr a parte pública na VPS**, com a palavra-passe da OVH (uma vez):
   `type $env:USERPROFILE\.ssh\eurolify_vps.pub | ssh ubuntu@57.129.168.39 "umask 077; mkdir -p ~/.ssh; tr -d '\r' >> ~/.ssh/authorized_keys"`
   (o `tr` tira o fim de linha do Windows).
   É a primeira alteração à máquina: fica registada em `memoria/`.
5. **Entra com a chave?**
   `ssh -i $env:USERPROFILE\.ssh\eurolify_vps ubuntu@57.129.168.39 "hostname; whoami"`
   — tem de responder sem pedir a palavra-passe da OVH.
6. **A VPS aceita palavra-passe?**
   `ssh -o PubkeyAuthentication=no -o PreferredAuthentications=none ubuntu@57.129.168.39`
   — a linha `Permission denied (...)` diz os métodos aceites. Se lá estiver
   `password`, qualquer pessoa na Internet pode tentar adivinhá-la: é a
   primeira coisa a fechar.
7. **O Claude Code** (se ainda não estiver instalado), no PowerShell:
   `irm https://claude.ai/install.ps1 | iex`. O Git para Windows é
   recomendado para o Claude Code ter o Bash; sem ele, usa o PowerShell.
8. **O repositório**, com as ligações das skills (ADR-0010): Modo de
   Programador do Windows ligado e
   `git clone -c core.symlinks=true https://github.com/HNFerramentasHitNails/Eurolify.git`.
   Abrir `claude` nessa pasta.
9. **Ao operar a VPS:** nunca «permitir sempre» num comando `ssh`, e não usar
   o modo que salta as autorizações (ADR-0020).

## 6. O que deixa de ser preciso da Scaleway

- Nas sessões do Claude Code: as variáveis `SCW_*` e o setup script que instala
  o `scw` (ADR-0011). Tirá-los é decisão (§7): a conta pode ficar para os
  domínios (o ADR-0009 propunha lá comprá-los).
- A chave só de leitura do Diogo expira a 03/10/2027.

## 7. Decisões por tomar, por esta ordem

1. ~~Fornecedor, plano e centro de dados~~ → ✅ **OVH, VPS-3, centro na UE**
   (ADR-0017); a comprada ficou no Reino Unido, só para o ensaio, até à
   migração para Paris, até 31/03/2027 (ADR-0018, ADR-0019).
2. ~~Como o Claude chega à máquina~~ → ✅ **o Claude Code no computador do
   Diogo, por SSH** (ADR-0020); passos no §5.1.
3. **Ensaio e produção na mesma máquina ou separados** (proposta: separados
   antes do primeiro comerciante de fora).
4. **Onde ficam as cópias e quanto se pode perder** (minutos de dados e horas
   para voltar).
5. **Segunda máquina para a base**, e a partir de quando.
6. **Coolify ou o GitHub por SSH** (§3.6).
7. **Para onde vão os alertas.**
8. **O Codex na VPS** (ADR-0016: não está decidido).
9. **O que se faz à conta da Scaleway** (§6).

## 8. O que ficou por verificar

- Que produto da OVH é o servidor de Paris, o preço e a disponibilidade; se
  a OVH muda uma VPS de centro de dados ou o custo de sair desta antes do fim
  do período pago.
- As condições do preço «a partir de» (a página irlandesa, lida por resumo,
  fala de 12 meses adiantados) e se o preço muda com o centro de dados.
- O preço do armazenamento das cópias.
- A versão estável do PostgreSQL à data da instalação.
- O caminho a) do §5, no computador do Diogo (§5.1), e o equivalente no macOS
  do Bruno (por escrever).
- O acordo de tratamento de dados do fornecedor.
