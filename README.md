# Sporting CP — portal

Portal do Sporting: notícias ao minuto de jornais portugueses, rumores, plantel com
fotografias reais, jogos, estatísticas e classificação. Época 2026/27.

---

## Como abrir

```bash
python C:/Users/user/sporting-hud/servidor.py
```

Depois **http://localhost:8123**

### Entrar

| | |
|---|---|
| Utilizador | `sporting` |
| Palavra-passe | `1906` |

Com «manter a sessão iniciada» só é pedido uma vez. O botão **SAIR**, no canto
superior direito, termina a sessão.

É um cadeado de cortesia, do lado do browser — evita que qualquer pessoa que
abra a página entre, mas não é segurança a sério: quem souber ver o
código-fonte passa à frente. Para mudar os dados, edita `UTILIZADOR` e
`PALAVRA` no início do `js/app.js`.

Tem de ser este servidor (não `python -m http.server`, nem duplo-clique no
`index.html`). É o `servidor.py` que vai buscar os feeds dos jornais — o browser,
sozinho, não consegue por causa das regras de origem cruzada.

---

## De onde vem cada coisa

| O quê | Fonte | Atualiza |
|---|---|---|
| Notícias, ao minuto, rumores, formação | RSS diretos: Record, Maisfutebol, Notícias ao Minuto, zerozero, RTP, Observador | 60 s |
| Classificação | API do Wikipédia | 15 min |
| Plantel (nº, posição, país) | API do Wikipédia | 15 min |
| Presenças e golos | API do Wikipédia | 15 min |
| Calendário e resultados | API do Wikipédia | 15 min |
| **Fotografias dos jogadores** | API-Football | quando corres o script |
| **Emblemas das equipas** | API-Football | quando corres o script |

O estado da ligação aparece no canto direito do menu: `dados reais · hh:mm`,
`parcial` ou `offline`.

### Arquivo de notícias

A vista **NOTÍCIAS** agrupa por dia (HOJE, ONTEM, depois a data) e tem
**VER MAIS ANTIGAS** no fundo. O que já foi lido fica guardado no browser
durante 45 dias e vai-se acumulando, por isso o arquivo aprofunda-se sozinho
com o uso. O feed do zerozero é o que traz mais história de uma vez.

A barra por cima da lista diz quantas notícias há, desde que data, e quando
foi a última leitura — com `+N novas` a piscar quando entra alguma. O sino no
topo mostra quantas chegaram desde a última vez que lá foste.

### Ler notícias sem sair do site

Carregar numa notícia abre-a **dentro do site**, num leitor próprio. O
`servidor.py` vai buscar o artigo, tira-lhe os scripts e serve-o — é por isso
que funciona mesmo com jornais que normalmente não deixam ser mostrados dentro
de outra página. O botão **abrir no jornal ↗** leva ao site original, e `Esc`
fecha o leitor.

Se algum jornal não abrir, aparece uma mensagem com a ligação para o site.

### Ficha de jogo

Na vista **JOGOS**, carregar num jogo já disputado abre a ficha: quem marcou e
em que minuto (com penáltis e autogolos assinalados), resultado, golos a favor
e sofridos, diferença, assistência e árbitro. Vem tudo da mesma página do
Wikipédia e enche-se sozinho depois de cada jogo.

Os particulares de pré-época não têm ficha publicada, por isso aparecem vazios.
**Posse de bola, remates e cartões não entram** — não há fonte gratuita para a
época atual; seria preciso o plano pago da API-Football.

### Carreira do jogador

Na vista **EQUIPA**, ao carregar num jogador aparece a carreira dele nas épocas
**2022, 2023 e 2024**: clube, prova, jogos, golos, assistências, minutos e nota,
vindos da API-Football. É o que o plano gratuito permite.

A API dá 100 pedidos por dia e cada jogador novo custa 3. As respostas ficam
guardadas em `cache/` durante 30 dias, por isso só se paga uma vez por jogador —
mas não vale a pena percorrer o plantel inteiro no mesmo dia.

O **valor de mercado** vem do `VALOR_MERCADO`, em `js/data.js`. O Transfermarkt
bloqueia leitura automática (testado: devolve as páginas sem os valores e depois
começa a recusar ligações), por isso esses números são escritos à mão.

---

## Fotografias e emblemas

Já estão descarregados. Para atualizar (contratações, saídas):

```bash
python C:/Users/user/sporting-hud/atualizar_fotos.py
```

Gasta 3 pedidos do limite de 100/dia e só descarrega o que falta.

A chave da API está em `chave-api.txt`. **É uma chave pessoal** — não publiques
esta pasta nem a partilhes tal como está.

### Emblema do clube

Está a ser usado o **emblema de 2026** (`img/crest.svg`), o atual. A ordem é:

1. `img/crest.png` — se puseres um ficheiro teu, é esse que manda
2. `img/crest.svg` — o emblema de 2026
3. `img/teams/228.png` — versão simplificada da API, último recurso

### Fotografia do ecrã de entrada

Guarda a imagem na pasta **`img/`** com o nome **`entrada`**. A extensão não
interessa — `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif` ou `.avif`, todas servem.
Depois recarrega a página (`F5`).

Passa a ser o fundo do ecrã de acesso, com um zoom lento e escurecida o
suficiente para a caixa de login se ler. Se não existir nenhuma, fica só o
degradê verde — não parte nada.

Para trocar de imagem: apaga a antiga, mete a nova, `F5`.

---

## Navegação

Só o menu de cima. Muda de vista sem recarregar a página:

**INÍCIO** · **NOTÍCIAS** (com filtro por jornal) · **AO MINUTO** ·
**RUMORES** (entradas, saídas com valores, somas e imprensa) ·
**EQUIPA** (plantel + ficha + carreira) · **JOGOS** (época toda) ·
**ESTATÍSTICAS** · **CLASSIFICAÇÃO** · **FORMAÇÃO** · **CLUBE**

A lupa procura em todas as notícias. `Esc` fecha a procura e o leitor.

---

## O que editas tu — `js/data.js`

- `PERFIS` — as barras e o radar de cada jogador. **É opinião tua**, não é
  estatística; está assinalado na ficha.
- `VALOR_MERCADO` — valores de mercado, em milhões de €
- `ALCUNHAS` — ex.: Pedro Gonçalves → Pote
- `ENTRADAS` / `SAIDAS` — movimentos do defeso, com `valor` (fixo) e `bonus`
  (objetivos). As somas e o saldo são calculados sozinhos.
- `CLUBE` — factos e palmarés
- `feeds` — acrescentar jornais (mete também o domínio em
  `DOMINIOS_PERMITIDOS`, no `servidor.py`)

Guardas, `F5`, está feito. Se alterares CSS ou JS e não vires diferença, sobe o
número no `?v=` dos `<script>` do `index.html`.

---

## O que ainda não dá

**Estatísticas detalhadas** (assistências, minutos, remates, ratings) e
**classificação em direto pela API-Football**: o plano gratuito só dá acesso às
épocas 2022–2024. Fotografias e emblemas não têm essa limitação, por isso é isso
que se usa. Para as estatísticas completas seria preciso o plano pago.

**Eventos de jogo ao minuto** (golos, cartões, substituições durante o jogo):
mesma razão. O painel AO MINUTO mostra o fluxo de notícias em tempo real.
