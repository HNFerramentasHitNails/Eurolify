# As skills de regras da UE geradas pelo Perplexity — avaliadas, não instaladas (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«Pedi ao perplexity para procurar tudo
sobre a UE e as suas regras, e ele gerou estas skill. verifica se são uteis»*
(zip `eu-ecommerce-skills.zip`) e depois *«pedi para atualizar e mostrar
futuras regras»* (segunda versão, `eu-ecommerce-skills_1.zip`). A seguir:
*«sim, regista e acrescenta ao docs/03»*.

## O que se fez

- Li as duas versões inteiras, na pasta temporária da sessão. **Nada foi
  instalado nem copiado para o repositório.**
- Comparei-as com as nossas 14 skills e com o `docs/03-regulamentar-ue.md`, e
  conferi os erros e as datas no **texto publicado no EUR-Lex** (versão do
  Jornal Oficial, não a consolidada) e nas páginas do Parlamento Europeu.
- Acrescentei ao `docs/03` (marcadas **W · texto lido**, uma marca nova
  explicada na legenda): o Omnibus da IA e a data do art. 50.º, a Dir. (UE)
  2024/1799, a Dir. (UE) 2024/2853 e o código QR das baterias; e o DSA na Fase 1
  e a Dir. 2024/2853 como **perguntas para o jurista**.

## Veredicto: não se instalam; o calendário serviu

1. **Duplicam o que temos, com menos cuidado.** 8 das 10 skills da primeira
   versão tratam temas que já têm skill nossa (a de cibersegurança só em
   parte). Duas skills sobre o mesmo tema davam ordens contrárias ao Claude e
   ao Codex: a deles manda pôr a ligação à plataforma europeia de litígios, a
   nossa proíbe-a.
2. **Erros conferidos no texto legal**, que continuam na segunda versão:
   - ligação à plataforma ODR, que fechou a 20/07/2025 (`docs/03`, §2);
   - isenção da autenticação forte de 50 €/150 €: é a dos pagamentos sem
     contacto em loja física (art. 11.º do Reg. Del. (UE) 2018/389); na venda
     online é 30 €/100 €/5 operações (art. 16.º). A isenção «MOTO» não existe
     no regulamento e falta a da análise de risco (art. 18.º);
   - ViDA como «Dir. 2023/2226, pendente»: a 2023/2226 é a DAC8
     (cripto-activos); a ViDA é a Dir. (UE) 2025/516, adoptada a 11/03/2025;
   - o fornecedor presumido para vendedores **estabelecidos na UE** acima dos
     10.000 €: o art. 14.º-A, n.º 2, só fala de vendedor não estabelecido na
     Comunidade (Dir. (UE) 2017/2455);
   - coordenadores do DSA designados «até julho de 2023»: o prazo foi
     17/02/2024 (art. 49.º, n.º 3);
   - Dir. 2024/2853 «em vigor desde 08/12/2024, 25 anos»: aplica-se a produtos
     colocados no mercado depois de 09/12/2026 (art. 2.º); o prazo é de 10
     anos, e 25 só para lesões corporais que se manifestam tarde (art. 17.º);
   - direito à reparação «o vendedor tem de oferecer reparação»: a obrigação é
     do **fabricante**, só nos produtos do anexo II (art. 5.º).
3. **Não seguem as nossas regras:** em inglês, sem marcas W/M/C, nada marcado
   como não verificado. O RGPD trata a plataforma como responsável e nunca diz
   que o Eurolify é **subcontratante** dos comerciantes; apresenta o TCF 2.2
   (norma da publicidade) e transferências para fora da UE como caminho normal,
   o que choca com «os dados ficam na UE». A de pagamentos manda montar
   vigilância de branqueamento, mas o Eurolify nunca guarda dinheiro de
   ninguém.
4. **A segunda versão foi mal aplicada:** só acrescentou uma secção
   «Atualizações Recentes e Futuras» no fim. O texto de cima ficou, e cada skill
   contradiz-se (a de IVA diz ViDA «2023/2226, pendente» em cima e «2025/516,
   adoptada» em baixo; DAC7 «anual» em baixo e «relatório trimestral» na lista).
   Ao inserir a secção, apagou o título «Sources» e a primeira fonte de 9 das
   11 skills.
5. **Vêm assinadas «author: Diogo Monteiro»**, mas foi o Perplexity que as
   escreveu.

## O calendário da segunda versão, conferido (03/10/2026)

| Regra | Resultado |
|---|---|
| Omnibus da IA, Reg. (UE) 2026/1744 | **confere**: de 08/07/2026, publicado a 24/07/2026, em vigor a 27/07/2026. Alto risco para 02/12/2027 e 02/08/2028; o art. 50.º não muda (02/08/2026) |
| Dir. (UE) 2024/2853 | **confere** (09/12/2026); o considerando 13 põe o software, incluindo SaaS, como produto |
| Dir. (UE) 2024/1799 | data **confere** (31/07/2026); a obrigação é do fabricante; garantia +12 meses se o consumidor escolher reparar (art. 16.º) |
| Dir. (UE) 2024/825 | **confere** (27/03/2026 transposição, 27/09/2026 aplicação) |
| Reg. (UE) 2024/2847 | **confere** (11/06/2026, 11/09/2026, 11/12/2027) — já estava no `docs/08` |
| Reg. (UE) 2023/1542 | **confere** (18/02/2027: QR em todas as baterias, passaporte nas grandes) |
| Registo dos passaportes digitais (Reg. (UE) 2024/1781) | o texto manda criá-lo **até** 19/07/2026; «a funcionar desde 20/07/2026» não verifiquei |
| PSD3/PSR | **confere** «perto da adopção»: acordo a 27/11/2025, aprovado na ECON a 05/05/2026, falta a adopção formal (Parlamento, actualizado a 20/09/2026). «Textos finais publicados a 23/04/2026» não aparece lá |
| Digital Fairness Act | **confere**: ainda não apresentado a 20/09/2026, previsto para o 4.º trimestre |
| Green Claims | a página da Comissão, lida a 03/10/2026, diz «pending»; a retirada que o zip anuncia não confirmei |
| Carteira europeia de identidade (Reg. (UE) 2024/1183) | o texto conta 24 meses a partir de actos de execução que não li; «até ao fim de 2026» não verifiquei |

## Levado às nossas skills (03/10/2026, pedido do Diogo: *«sim, leva às skills»*)

Antes de escrever, li os artigos no EUR-Lex: o que aqui estava como **C** passou
a **W · texto lido**.

- `consumer-rights-eu`: aviso da garantia legal e **selo da garantia comercial
  de durabilidade**, actualizações de software, índice de reparabilidade ou
  informação sobre peças (Dir. 2024/825, art. 2.º, que altera os arts. 5.º,
  6.º, 8.º e 22.º-A da Dir. 2011/83/UE); o que vai **imediatamente antes do
  botão final** (art. 8.º, n.º 2); **preço por unidade** (Dir. 98/6/CE, arts.
  2.º, 3.º e 5.º); **preço personalizado** (art. 6.º, n.º 1, alínea e-A),
  Omnibus); **conteúdos digitais** — consentimento, reconhecimento e
  confirmação (art. 16.º, alínea m), Omnibus); **garantia +12 meses** quando se
  escolhe reparar e a reparação como obrigação do fabricante (Dir. 2024/1799,
  arts. 5.º e 16.º); **avaliações** e **resultados de pesquisa pagos** (Dir.
  2005/29/CE, art. 7.º, n.º 6, e anexo I, pontos 11-A, 23-B e 23-C, Omnibus).
- `eu-gdpr-privacy`: secção «Violação de dados pessoais» — o Eurolify, como
  subcontratante, avisa cada comerciante afectado; o comerciante notifica a
  autoridade até 72 h e as pessoas se o risco for elevado (RGPD, arts. 28.º,
  n.º 3, 33.º e 34.º).
- `product-compliance-eu`: linhas **Bateria** (QR a partir de 18/02/2027,
  passaporte, registo de produtor por país e representante — Reg. (UE)
  2023/1542, arts. 3.º, 13.º, 55.º, 56.º, 77.º) e **Equipamento eléctrico ou
  electrónico** (registo por país com representante — Dir. 2012/19/UE, arts.
  3.º, 16.º, 17.º; a transposição de cada país, **C**).
- `observability-security`: secção «Notificação de incidentes (NIS2)» — médias
  empresas ou maiores, nuvem no anexo I, mercados em linha no anexo II; 24 h,
  72 h, um mês (Dir. (UE) 2022/2555, arts. 2.º e 23.º). Se o Eurolify cabe num
  dos anexos fica para o jurista.
- Ficou **C**: o desenho do aviso e do selo harmonizados (actos de execução da
  Comissão, não lidos) e as leis nacionais que transpõem a REEE.
- O `docs/03` foi alinhado a seguir (pedido do Diogo: *«sim, acerta o
  docs/03»*): linhas novas para preço por unidade, preço personalizado,
  avaliações e resultados pagos, conteúdos digitais, REEE e violação de dados;
  a linha da garantia (Dir. 2024/825) com o selo de durabilidade; a das
  baterias com o registo de produtor por país (já não diz «não foi lido»); a
  da NIS2 passou de **C** a **W · texto lido**, com 24 h, 72 h e um mês. Datas
  de aplicação confirmadas no texto: Omnibus 28/05/2022, RGPD 25/05/2018,
  capítulo VIII das baterias 18/08/2025.

## Números (com data e como se contaram)

- 1.ª versão: 10 skills + README, 75.775 bytes (`wc -c`, 03/10/2026).
- 2.ª versão: 11 skills + README, 96.444 bytes; 9 das 10 antigas mudaram e a de
  RGPD ficou igual (`diff -rq`); o título «Sources» desapareceu em 9 das 11
  (`grep -c "^## Sources"`).
- Textos lidos no EUR-Lex a 03/10/2026, na versão inglesa: 22 actos (`legal-content/EN/TXT/HTML`,
  CELEX 32018R0389, 32022R2065, 32024L2853, 32024R1689, 32006L0112,
  32025L0516, 32023L2226, 31998L0006, 32017L2455, 32018R0302, 32016R0679,
  32026R1744, 32024L1799, 32024R2847, 32023R1542, 32024R1183, 32024L0825,
  32024R1781 e, para as skills, 32019L2161, 32012L0019, 32022L2555,
  32011L0083); só os artigos citados, nenhum por inteiro.
- 09/12/2026 fica a 67 dias de 03/10/2026.

## O que ficou por verificar

- As versões consolidadas: se um acto lido foi alterado depois (além do
  Omnibus da IA), não vi.
- A NIS2 («23 de 27 países», «registo em Portugal até 15/09/2026»), a 2030
  Consumer Agenda, as coimas de acessibilidade por país e as taxas de IVA da
  tabela do zip (13 dos 27 países, sem datas).
- Se o Eurolify é «serviço de alojamento» do DSA (leitura nossa do texto) e o
  que a Dir. 2024/2853 quer dizer para ele: **perguntas para o jurista**.
- O `05-fases-e-mvp.md`, o `10-estimativa-prazo-e-custo.md` e a skill
  `marketplace-dsa` continuam a pôr o DSA só na loja de extensões ou no
  marketplace; ficam assim até o jurista responder.
