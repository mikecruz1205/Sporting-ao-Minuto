"""
Prepara a aplicação Android (Trusted Web Activity) e os deep links.

Não inventa nada: precisa de três dados reais, que só tu tens.

    python scripts/preparar_android.py \
        --dominio app.oteudominio.pt \
        --pacote pt.sportingaominuto.app \
        --sha256 AB:CD:...:EF

  --dominio  o domínio onde o site está publicado e que TU controlas
             (é lá que vai viver /.well-known/assetlinks.json)
  --pacote   o application ID da app na Google Play (não muda depois de
             publicada). Proposta: pt.sportingaominuto.app
  --sha256   a impressão digital SHA-256 do certificado que assina a app.
             Com a assinatura da Google Play ligada (recomendado), está na
             Play Console › Configuração › Integridade da app › "Certificado
             da chave de assinatura da app". Pode repetir-se --sha256 para
             juntar também a chave de upload.

Gera:
  android/twa-manifest.json      a configuração para o Bubblewrap
  .well-known/assetlinks.json    a ligação domínio ↔ app (deep links e
                                 ecrã sem barra de endereço)

Passos seguintes em docs/ANDROID.md.
"""
import argparse, json, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PADRAO_SHA = re.compile(r'^([0-9A-F]{2}:){31}[0-9A-F]{2}$')
PADRAO_PACOTE = re.compile(r'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--dominio', required=True)
    a.add_argument('--pacote', required=True)
    a.add_argument('--sha256', required=True, action='append')
    a.add_argument('--versao', default='1.0.0')
    a.add_argument('--codigo', type=int, default=1, help='versionCode (sobe a cada envio para a Play)')
    args = a.parse_args()

    dominio = args.dominio.strip().lower()
    dominio = re.sub(r'^https?://', '', dominio).strip('/')
    if 'mgira.pt' in dominio:
        sys.exit('app.mgira.pt é o domínio da aplicação mGira (bicicletas de Lisboa), não deste site.')
    if not PADRAO_PACOTE.match(args.pacote):
        sys.exit('pacote inválido: usa minúsculas e pontos, por exemplo pt.sportingaominuto.app')
    impressoes = [s.strip().upper() for s in args.sha256]
    for s in impressoes:
        if not PADRAO_SHA.match(s):
            sys.exit('SHA-256 inválido (esperado 32 pares hexadecimais separados por dois pontos): ' + s)

    manifest_web = json.load(open(os.path.join(RAIZ, 'manifest.webmanifest'), encoding='utf-8'))
    base = f'https://{dominio}'

    twa = {
        "packageId": args.pacote,
        "host": dominio,
        "name": manifest_web["name"],
        "launcherName": manifest_web["short_name"],
        "display": "standalone",
        "orientation": "default",
        "themeColor": manifest_web["theme_color"],
        "themeColorDark": manifest_web["theme_color"],
        "navigationColor": manifest_web["background_color"],
        "navigationColorDark": manifest_web["background_color"],
        "navigationDividerColor": "#1f2422",
        "navigationDividerColorDark": "#1f2422",
        "backgroundColor": manifest_web["background_color"],
        "enableNotifications": True,
        "startUrl": "/?origem=android",
        "iconUrl": f"{base}/img/icones/icone-512.png",
        "maskableIconUrl": f"{base}/img/icones/maskable-512.png",
        "monochromeIconUrl": f"{base}/img/icones/badge-96.png",
        "splashScreenFadeOutDuration": 300,
        "signingKey": {"path": "./android.keystore", "alias": "android"},
        "appVersionName": args.versao,
        "appVersionCode": args.codigo,
        "shortcuts": [
            {"name": s["name"], "shortName": s.get("short_name", s["name"]),
             "url": s["url"].replace("origem=atalho", "origem=android"),
             "chosenIconUrl": f"{base}/img/icones/icone-192.png"}
            for s in manifest_web.get("shortcuts", [])
        ],
        "generatorApp": "bubblewrap-cli",
        "webManifestUrl": f"{base}/manifest.webmanifest",
        "fallbackType": "customtabs",
        "features": {},
        "alphaDependencies": {"enabled": False},
        "enableSiteSettingsShortcut": True,
        "isChromeOSOnly": False,
        "isMetaQuest": False,
        "fullScopeUrl": f"{base}/",
        "minSdkVersion": 21,
        "fingerprints": [{"name": f"chave-{i+1}", "value": s} for i, s in enumerate(impressoes)],
        "additionalTrustedOrigins": [],
        "retainedBundles": [],
        "protocolHandlers": [],
        "fileHandlers": [],
        "launchHandlerClientMode": "navigate-existing",
        "displayOverride": manifest_web.get("display_override", [])
    }

    ligacoes = [{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": args.pacote,
            "sha256_cert_fingerprints": impressoes
        }
    }]

    os.makedirs(os.path.join(RAIZ, 'android'), exist_ok=True)
    os.makedirs(os.path.join(RAIZ, '.well-known'), exist_ok=True)
    with open(os.path.join(RAIZ, 'android', 'twa-manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(twa, f, ensure_ascii=False, indent=2)
    with open(os.path.join(RAIZ, '.well-known', 'assetlinks.json'), 'w', encoding='utf-8') as f:
        json.dump(ligacoes, f, ensure_ascii=False, indent=2)

    print('android/twa-manifest.json e .well-known/assetlinks.json gerados para', base)
    print('Depois de publicares o site, confirma que', base + '/.well-known/assetlinks.json', 'responde 200.')


if __name__ == '__main__':
    main()
