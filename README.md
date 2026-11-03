# Orçamento Familiar

App Android de controle financeiro: receitas, despesas fixas, cartão de crédito, despesas variáveis e aplicações, com provisionado × gasto, fechamento do mês, lembretes de contas a vencer e resumo pelo WhatsApp.

## Baixar o APK
Abra a página **Releases** deste repositório e baixe `OrcamentoFamiliar.apk` da versão mais recente.

## Instalar no celular
1. Abra o arquivo `.apk` no celular (pelo navegador, WhatsApp ou Arquivos).
2. Se o Android pedir, permita **instalar apps desta fonte**.
3. Toque em **Instalar**. Na primeira vez, o Play Protect pode avisar que o app é desconhecido: toque em **Mais detalhes → Instalar mesmo assim**.

Os dados ficam só no celular de cada pessoa. Use **Lembretes e backup → Enviar backup** para guardar uma cópia.

## Como o APK é gerado
Cada alteração enviada para a branch `main` dispara o workflow **Gerar APK** (`.github/workflows/build-apk.yml`), que compila e publica o arquivo em Releases.
O código do app fica em `src/` (`app.js`, `style-markup.html`, `extra.css`).
