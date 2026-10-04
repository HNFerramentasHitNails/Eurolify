---
name: eurolify-fault-first-debugging
description: "Diagnostica falhas da Eurolify por reprodução e causa antes de repetir correções. Usa para testes e bugs recorrentes; não muda modelo nem arquitetura para contornar erros de ambiente."
metadata:
  version: "1.0"
---

# Diagnóstico antes da repetição

1. Captura erro, comando, ambiente, commit e reprodução mínima. Guarda saída integral fora do contexto, quando necessário, com permissões apropriadas; apresenta trechos relevantes sem esconder o exit code.
2. Classifica falha: ambiente, acesso, dados, contrato, concorrência, lógica ou requisito ambíguo. Falta de credencial, dependência ou serviço não é corrigida por um modelo mais caro.
3. Formula hipótese falsificável e teste que a distingue das alternativas. Faz uma alteração de cada vez; não repete o mesmo comando sem novo motivo.
4. Implementa a menor correção coerente e uma regressão. Em bug de regra transversal, identifica todos os caminhos afetados; pequeno diff não dispensa cobertura.
5. Após duas tentativas sem nova evidência, pára para reavaliar método/contexto. Usa `eurolify-efficient-workflow` para escalonar se o problema for de raciocínio, sem multiplicar agentes para a mesma falha.
6. Verifica reprodução, regressão e integração afetada. Declara limitações do ambiente e nunca considera teste saltado como sucesso.

## Saída

`reprodução | causa confirmada/hipótese | alteração | teste | resultado | incerteza`.

Não enfraquece assertivas, apaga testes ou introduz fallback fiscal permissivo para obter verde. Não atribui causa definitiva só porque o sintoma desapareceu.
