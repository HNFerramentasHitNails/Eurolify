# Chaves públicas dos fluxos do GitHub (ADR-0028)

Aqui entram, na Fase D, as partes **públicas** das três chaves dos fluxos:
`publicar.pub`, `aplicar.pub` e `medir.pub`. As partes privadas vão para os
segredos do ambiente `ensaio` (`VPS_CHAVE_PUBLICAR`, `VPS_CHAVE_APLICAR`,
`VPS_CHAVE_MEDIR`), a partir do computador do Diogo, lidas de ficheiro — nunca
para aqui.

O `preparar.sh` instala cada uma no utilizador do fluxo com
`restrict,command="/usr/local/bin/eurolify-pedido <fluxo>"`. Sem o ficheiro,
o passo diz que falta e segue.
