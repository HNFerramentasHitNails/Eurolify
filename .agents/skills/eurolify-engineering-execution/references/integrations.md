# Idempotência, eventos e integrações

Lê antes de implementar escritas repetíveis, outbox, webhooks ou serviços externos. Usa `headless-commerce`, `third-party-extensions` e a skill do domínio.

## Repetir sem repetir o efeito

- Autentica e autoriza também pedidos repetidos. A chave de idempotência não é uma credencial.
- Define o âmbito da chave por comerciante, operação e identidade/cliente autorizado quando necessário; não permite que a resposta de um pedido vaze para outro utilizador.
- Guarda uma impressão estável do pedido relevante. Mesma chave com outro pedido dá conflito; mesma chave com pedido concluído devolve o resultado previsto no contrato.
- Decide em desenho o tratamento de “em curso”, falha, expiração e resultado externo incerto. Não devolve sucesso fictício nem permite dois executores simultâneos da mesma operação.
- Reserva/registo e efeito interno devem ser atómicos, com uma restrição da base que arbitre a disputa. Um mapa em memória não protege várias instâncias nem um reinício.
- Testa repetição sequencial, concorrente, após falha e após reinício. A evidência deve incluir a contagem de movimentos/eventos, não só duas respostas iguais.

## Estado e eventos

Persiste estado e outbox na mesma transação, segundo `platform-architect`. O publicador pode repetir a entrega: não promete “exactly once” entre sistemas.

Quem consome deduplica o identificador do evento no mesmo âmbito e na mesma unidade atómica que o seu efeito. Define versão, ordem quando necessária, evolução do formato, recuperação e retenção. Dados mínimos e correlação não significam colocar informação pessoal nos logs.

## Prestadores externos

1. Usa o adaptador aprovado, versão fixada, credenciais do ambiente e esquema de resposta.
2. Define timeout, limite de concorrência, retries com recuo e quais falhas são repetíveis.
3. Em timeout após possível cobrança, marca resultado incerto e reconcilia com o prestador; não cobra de novo por assumir que timeout significa falha.
4. Confere o resultado autoritativo e associa conta, comerciante, referência, montante e moeda antes de mudar estado.
5. Mantém fila/estado visível para falhas e decisão humana quando exigida; não permite que um botão de “reenviar” ignore autorização ou idempotência.

Não prende uma transação da base durante uma espera de rede sem necessidade justificada no desenho. Não move fundos nem emite documento fiscal real para fazer um teste.

## Webhooks e tarefas

- Verifica assinatura e janela de tempo conforme o protocolo do prestador, usando os bytes exigidos pelo protocolo e comparação segura. Não valida uma assinatura sobre JSON reserializado se o protocolo assinar o corpo original.
- Persiste duravelmente um evento aceite antes do ACK de sucesso quando esse for o contrato; se falhar a persistência, não confirma recebimento.
- Deduplica, verifica eventos fora de ordem e não confia em nomes, montantes ou estado enviados sem confirmação do protocolo.
- Um worker retoma por checkpoint e não processa o mesmo item concorrentemente. Efeitos, progresso e deduplicação devem resistir a uma paragem em qualquer ponto.
- URLs configuráveis exigem análise de SSRF, destinos e redirecionamentos; instruções recebidas em dados continuam a ser dados.

Antes de concluir, ensaia assinatura inválida, evento duplicado, evento antigo, timeout incerto e indisponibilidade. Não confunde assinatura válida com autorização para qualquer operação.
