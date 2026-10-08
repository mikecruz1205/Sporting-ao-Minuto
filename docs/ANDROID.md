# Aplicação Android (Google Play)

## Decisão: Trusted Web Activity (TWA)

A app Android deve ser uma **Trusted Web Activity**, gerada com o
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) a partir da PWA
que já existe. Não uma WebView.

| | WebView (Cordova e afins) | Capacitor | **TWA** | Nativa (Kotlin) |
|---|---|---|---|---|
| Motor | WebView do sistema, pode estar desatualizada | WebView | **Chrome completo** | nativo |
| Desempenho | o mais fraco | médio | **igual ao Chrome** | o melhor |
| Service worker, cache offline | parcial, à parte do browser | parcial | **o mesmo da PWA** | refazer |
| Notificações push | FCM à parte | FCM à parte | **Web Push da PWA**, entregue como notificação da app | FCM |
| Sessão/contas | separada do browser | separada | **partilhada com o Chrome** | separada |
| Atualizações | nova versão na loja | nova versão na loja | **publicar o site chega** | nova versão na loja |
| Deep links | à mão | à mão | **Digital Asset Links** | App Links |
| Manutenção | duas bases de código | duas | **uma** | duas (ou três) |
| Segurança | a app controla a WebView, fácil de errar | idem | **sandbox do Chrome** | depende |

A TWA corre o site dentro do Chrome, em ecrã inteiro e sem barra de
endereço, desde que o domínio prove que a app é sua (`assetlinks.json`).
Tudo o que já foi feito para a PWA — cache, offline, notificações,
atalhos, cores, ecrã de arranque — passa para a app sem código novo.

A WebView só faria sentido se fosse preciso algo que o browser não dá; não
é o caso. O Capacitor fica como plano B se um dia forem precisas APIs
nativas que a Web não tem (widgets no ecrã principal, por exemplo) — e
mesmo aí a PWA continua a ser a base.

## O que já está pronto

- **PWA instalável**: `manifest.webmanifest`, `sw.js`, ícones `any` e
  `maskable` (`img/icones/`), ícone monocromático para notificações
  (`badge-96.png`), atalhos, `theme_color`/`background_color`.
- **Endereços por vista** (`/jogos`, `/plantel`, `/ao-minuto`…): são estes
  os deep links. Um link para `https://<domínio>/jogos` abre a app
  diretamente nos Jogos, quando a app estiver instalada.
- **Política de privacidade com endereço público**: `/privacidade`
  (obrigatório na ficha da Play), e `/termos`.
- **`scripts/preparar_android.py`**: gera `android/twa-manifest.json` e
  `.well-known/assetlinks.json` a partir de dados reais.
- **`vercel.json`** já serve `/.well-known/assetlinks.json` com o tipo certo.
- O site **não mostra** "Disponível na Google Play" enquanto
  `CONFIG.app.googlePlay` (em `js/data.js`) for `null`.

## O que falta — e porquê não foi inventado

1. **O domínio.** Tem de ser um domínio teu, onde o site está publicado.
   `app.mgira.pt` não serve: é o domínio da aplicação **mGira** (bicicletas
   partilhadas de Lisboa) — o `assetlinks.json` tem de ser servido pelo
   domínio, e esse não é nosso. O script recusa-o.
2. **O application ID.** Proposta: `pt.sportingaominuto.app`. Escolhe com
   cuidado: depois de publicada, a app não pode mudar de ID.
3. **A chave de assinatura (SHA-256).** Só existe depois de criares a app
   na Play Console (com a assinatura da Google Play ligada) ou de gerares
   a keystore com o Bubblewrap.

## Passo a passo

```bash
# 1. ferramentas (Node 18+ e JDK 17; o Bubblewrap instala o Android SDK)
npm i -g @bubblewrap/cli

# 2. publica o site no teu domínio e confirma que o manifest responde
#    https://<dominio>/manifest.webmanifest

# 3. gera a configuração (a primeira vez, uma impressão provisória da
#    keystore local; depois troca pela da Play Console)
python scripts/preparar_android.py --dominio <dominio> --pacote pt.sportingaominuto.app --sha256 <SHA-256>

# 4. constrói o pacote
cd android
bubblewrap init --manifest ./twa-manifest.json   # aceita o que vem do ficheiro
bubblewrap build                                # gera app-release-bundle.aab

# 5. publica o site com o .well-known/assetlinks.json e confirma:
#    https://<dominio>/.well-known/assetlinks.json  → 200, JSON
#    https://developers.google.com/digital-asset-links/tools/generator

# 6. Play Console: nova app → envia o .aab para testes internos primeiro.
#    Copia o "certificado da chave de assinatura da app" (SHA-256) e volta
#    a correr o passo 3 com ele — senão a app abre com barra de endereço.

# 7. quando a ficha estiver pública, põe o endereço em js/data.js:
#    app: { googlePlay: 'https://play.google.com/store/apps/details?id=pt.sportingaominuto.app' }
#    — o site passa a mostrar "Disponível na Google Play" no Android.
```

## Antes de enviar para a Play — atenção

- **Marca registada.** O nome "Sporting" e o leão são marcas do Sporting
  Clube de Portugal. A Google Play recusa apps que usem marcas de terceiros
  sem autorização (política de propriedade intelectual e de
  representação enganosa). Para uma app de adeptos, convém: deixar claro
  na ficha e na app que **não é oficial**, evitar o emblema do clube no
  ícone, e idealmente ter autorização escrita. Sem isto, o mais provável é
  a app ser rejeitada.
- **Conteúdo gerado por utilizadores** (o chat): a Play exige forma de
  denunciar e bloquear conteúdo, e moderação. Rever antes de submeter.
- **Contas**: se a app permite criar conta, a Play exige forma de a
  apagar a partir da app e de um endereço web.
- **Qualidade da PWA**: a TWA exige que o site passe nos critérios de PWA
  (Lighthouse) — ícones, manifest, service worker e HTTPS já estão.
