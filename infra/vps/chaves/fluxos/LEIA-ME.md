# Chaves públicas dos fluxos do GitHub (ADR-0028)

Aqui entram as partes **públicas** das chaves dos fluxos: `publicar.pub`,
`aplicar.pub`, `medir.pub`, `operar.pub` (comando do operador, `docs/19`
§6) e `configurar.pub` (configuração do e-mail, `docs/34` §13). As partes
privadas vão para os segredos do ambiente `ensaio` (`VPS_CHAVE_PUBLICAR`,
`VPS_CHAVE_APLICAR`, `VPS_CHAVE_MEDIR`, `VPS_CHAVE_OPERAR`,
`VPS_CHAVE_CONFIGURAR`), a partir do computador do Diogo ou do Bruno, lidas de
ficheiro — nunca para aqui.

O `preparar.sh` instala cada uma no utilizador do fluxo com
`restrict,command="/usr/local/bin/eurolify-pedido <fluxo>"`. Sem o ficheiro,
o passo diz que falta e segue.
