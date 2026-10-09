# Reformulação — entrada, login, centro de jogo e estatísticas

Estado a 9 de outubro de 2026 (dia do Braga x Sporting, jornada 8).
Tudo o que está aqui foi testado; onde um teste usou dados simulados ou
não foi possível, isso está dito.

---

## 1. Auditoria (antes de mexer)

| Área | O que estava | Problema |
|---|---|---|
| Entrada | Ecrã de login por cima de tudo (`body.trancado`); site inteiro só com conta | Sem modo visitante; fotografia de origem desconhecida (foto de agência com publicidade da Champions) |
| Contas | Supabase Auth com nome de utilizador → email interno `utilizador@utilizador.sportingaominuto.pt` (12 contas, **todas sem email real**) | Recuperação de palavra-passe impossível por email; "manter sessão" feito a apagar o token no `beforeunload` |
| Jogo em direto | `js/jogo.js`: minuto **calculado pelo relógio**; lances **tirados dos títulos das notícias** com o minuto da publicação; onze **lido do texto** do artigo | Viola as regras novas (minuto só da fonte, nada simulado) |
| football-data | `js/fd.js` assumia onzes/golos/cartões no plano gratuito; proxy `/api/fd` aceitava qualquer caminho, sem cache | O plano gratuito **não** tem esses dados; quota exposta |
| API-Football | Proxy `/api/api` aceitava qualquer caminho | Quota exposta a quem descobrisse o endereço |
| Chat | Política RLS `chat_leitura_publica` para `anon` | Qualquer pessoa lia o chat pela API, mesmo sem conta |
| Cabeçalho | Marca "SPORTING CP" e lema do clube; botão de conta levava ao "Clube" | Parecia oficial; perfil inacessível |
| Página inicial | Destaque de notícias primeiro; resultados a meio da página | Ordem pedida: jogo → próximo → resultados → notícias → classificação → estatísticas → Fantasy |

## 2. Estrutura e desenho

* **Entrada** (`index.html` `#acesso`, `css/entrada.css`, `js/entrada.js`): fotografia
  do Alvalade com véu escuro, marca "Sporting ao Minuto · projeto de adeptos ·
  não oficial", frase curta, **Entrar** / **Criar conta** / **Continuar como
  visitante** / **Esqueceste-te da palavra-passe?**, e três cartões de
  pré-visualização só com dados reais (próximo jogo e último resultado do
  calendário, títulos reais das notícias, jornada aberta da Fantasy).
  Só aparece na página inicial a quem não tem sessão nem escolheu "visitante";
  ligações diretas (`/jogos`, `/ao-vivo`…) abrem logo o conteúdo.
* **Painel de conta** (`<dialog id="auth">`): folha que sobe de baixo no
  telemóvel, janela ao centro no computador. Entrar, Criar conta, Recuperar,
  Código de recuperação, Confirmação. Perfil (`<dialog id="perfil">`) com
  código de recuperação, mudança de palavra-passe e terminar sessão.
* **Cabeçalho**: marca do site, pesquisa (sugere jogadores e notícias, com
  setas/Enter), tema, últimas, Fantasy, conta ou **Entrar**.
* **Página inicial** (`css/casa.css`): 1 jogo de hoje (após a hora de início),
  2 próximo jogo + 3 últimos resultados lado a lado, 4 notícias, 5 classificação
  + 6 estatísticas da equipa, 7 Fantasy e comunidade, depois agenda,
  modalidades, mercado, vídeos.
* **Centro de jogo** (`/ao-vivo`, `js/centro.js`, `css/centro.css`): placar
  (emblemas, resultado, estado, minuto só da fonte, competição, jornada, data,
  fonte e hora), separadores Lances / Estatísticas / Equipas / Classificação,
  notícias do jogo à parte (marcadas como notícias). No telemóvel o resultado
  fica colado aos separadores quando se desce.
* **Estatísticas** (`/estatisticas`): totais da época, últimos 10 jogos
  oficiais, casa e fora, por competição, jogadores jogo a jogo (base de dados),
  arquivo e comparação de 7 épocas — cada bloco diz se é da partida, da época
  ou histórico.

## 3. Contas e segurança

* Mesmo sistema de sempre (Supabase Auth). Nada de segundo sistema de contas.
* **Recuperação por código** (`supabase/migrations/20261009180000_contas_recuperacao.sql`):
  `conta_gerar_codigo()` (com sessão) devolve 16 caracteres Base32 (80 bits),
  mostrado uma vez; guarda-se só o bcrypt. `conta_recuperar(utilizador, código,
  nova)` (sem sessão): 5 falhas/15 min por utilizador e 20/hora por origem,
  resposta igual para utilizador inexistente e código errado, bcrypt falso
  para igualar o tempo, termina todas as sessões, gasta o código.
  Palavras-passe novas: mínimo 8 (as antigas de 6 continuam a entrar).
* **Manter a sessão**: o cliente Supabase usa um armazém que escreve no
  `localStorage` (ligado) ou no `sessionStorage` (desligado).
* **Chat**: leitura só para `authenticated` (RLS). Visitantes veem um convite.
* **Proxies**: `/api/api` só aceita `players?id=N&season=AAAA` (cache 1 dia na
  CDN); `/api/fd` só `competitions/(PPL|CL)/standings` (cache 5 min); sem
  `Access-Control-Allow-Origin: *`; erros sem detalhes internos.
* **Cabeçalhos** (`vercel.json`): `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options: DENY`, `Permissions-Policy`.
* **Service worker**: `/api/jogo` nunca vai para a cache (sem rede, o centro
  de jogo tem de saber que falhou).

## 4. Camada de dados do jogo

`api/_jogo.py` (usado por `api/jogo.py` no Vercel e pelo `servidor.py` local):

* **Pedido**: `/api/jogo?data=<ISO>&casa=<nome>&fora=<nome>[&id=af:N|fd:N]`
  (parâmetros validados; nada de caminhos livres).
* **Fontes, por prioridade**: API-Football (`API_FOOTBALL_KEY`) → football-data.org
  (`FOOTBALL_DATA_TOKEN`). As chaves só existem no servidor.
* **Formato único**: `estado` (agendado, direto, intervalo, terminado, adiado,
  suspenso, interrompido, cancelado, abandonado), `minuto`/`acrescimo` só da
  fonte, `resultado`, `eventos` (golo, penálti, autogolo, penálti falhado,
  amarelo, 2.º amarelo, vermelho, substituição, VAR), `estatisticas` (posse,
  remates, à baliza, para fora, bloqueados, cantos, faltas, foras de jogo,
  cartões, defesas, passes, passes certos, precisão, xG), `equipas` (formação,
  treinador, onze, banco), `jogadores`; cada bloco com `fonte`, `atualizado_em`
  e, se faltar, `motivo`.
* **Conflitos**: estado/minuto/resultado da fonte prioritária; um bloco que
  ela não tenha pode vir da seguinte; resultados finais diferentes ficam em
  `conflitos`. O resultado nunca se calcula a partir dos eventos.
* **Sem duplicados**: os eventos substituem-se em bloco; cada um tem um `id`
  estável. Um golo anulado sai quando a fonte o corrigir.
* **Substituições da API-Football**: o sentido (quem entra/sai) decide-se pelo
  onze inicial; se não houver onze, mostra-se "a fonte não diz quem entrou".
* **Cache**: em memória por instância (20 s em direto, 60 s perto da hora,
  6 h depois do fim, 120 s sem dados) + CDN (`s-maxage`). Limite de pedidos
  por minuto por instância (API-Football 20, football-data 8). Nova tentativa
  em 429/5xx/tempo esgotado; 401/403 não insiste.
* **Falha**: devolve-se a última leitura boa, marcada `desatualizado` com a hora.
* **Cliente** (`js/centro.js`): um seguimento por jogo, partilhado pela faixa,
  pela página inicial e pelo centro; ritmo dado pelo servidor; pára com o
  separador escondido; recupera com a rede; atrasos crescentes com erros.

## 5. Cobertura das fontes (confirmada a 9 de outubro de 2026)

| Fonte | Competições | Direto | Eventos | Onzes | Estat. equipa | Estat. jogadores | Histórico | Limites | Custo | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| **API-Football** (api-sports.io) | Liga, Taças, Champions, Liga Europa… | Sim (planos pagos) | Sim | Sim | Sim | Sim | Desde ~2010 | Grátis 100/dia; Pro 7 500/dia | Grátis só 2022–2024; **Pro 19 USD/mês** | **Conta suspensa** (`/status`, 9/10/2026). Chave antiga está no histórico do git → trocar |
| **football-data.org** grátis | Liga Portugal (PPL), Champions (CL). **Não**: Taças, Liga Europa | **Com atraso** | Não | Não | Não | Não | ? | 10/min | 0 € | Sem token configurado |
| football-data.org pagos | as mesmas 12 | Sim ("Livescores" 12 €/mês) | Sim ("Deep Data" 29 €/mês) | Sim (Deep Data) | Extra pago | Não | — | 20–30/min | 12–29 €/mês | Não ativado (precisa da tua decisão) |
| **TheSportsDB** (chave grátis `123`) | Liga Portugal (resultados) | Só premium | Linha temporal **incompleta** | Vazio | Vazio | Não | Sim | 30/min | Grátis / Patreon | **Rejeitado**: no Sporting 2–2 Arouca (19/09/2026) só listou 2 golos e 2 amarelos da 1.ª parte |
| **Wikipédia** (CC BY-SA) | Todas as do Sporting | Não (horas depois) | Só golos e minuto, depois do jogo | Não | Não | Presenças e golos da época | Várias épocas | Educado | 0 € | **Em uso**: calendário, resultados, classificação, marcadores, arquivo |
| Sites oficiais (sporting.pt, ligaportugal.pt, uefa.com) | — | — | — | — | — | — | — | — | — | Sem API pública documentada → só ligações |
| Google (painel de resultados) | — | — | — | — | — | — | — | — | — | **Não usado** (sem API autorizada) → só ligação de pesquisa |
| Highlightly | ? | ? | ? | ? | ? | ? | ? | 100/dia grátis | a partir de 9,49 USD | Não testado (precisa de registo); cobertura da Liga não confirmada |

## 6. Testes executados

**Automáticos**

* `python -m unittest discover -s tests` → **27 testes, OK** (estados, minuto
  só em direto, eventos, sentido das substituições, VAR, duplicados, conflito
  de resultado, bloco da 2.ª fonte, cache, última leitura boa, sem fontes,
  429/401/tempo/JSON inválido, limite por minuto, conta suspensa, hora de
  Lisboa no verão/inverno, nomes de equipas, pedidos inválidos).
* `python scripts/sincronizar_jogos.py --testar` → OK.
* `supabase/testes/contas_testes.sql` → **10 passos, 0 falhas** (transação desfeita).
* `supabase/testes/fantasy_testes.sql` → **0 falhas** (transação desfeita).

**Base de dados, como visitante (API REST com a chave pública)**

| Pedido | Resultado |
|---|---|
| `chat_mensagens` | `[]` (RLS) |
| `contas_recuperacao`, `contas_recuperacao_tentativas` | `permission denied` |
| `rpc/conta_gerar_codigo` | `permission denied` |
| `rpc/conta_recuperar` com utilizador inexistente | `"codigo_invalido"` (tentativa registada com a origem e apagada a seguir) |
| `fantasy_escolhas` de outros antes do fecho | `[]` |

**Fontes reais**

* `/api/jogo` para SC Braga x Sporting CP (2026-10-09 19:15 UTC), a 18:05 UTC:
  API-Football `conta` (recusada), football-data `sem_chave` → `disponivel:false`,
  "Dados em direto indisponíveis", nova tentativa em 60 s.
* **Comparação de um jogo terminado** — Sporting CP x Arouca (19/09/2026):
  resultado Wikipédia 2–2 = TheSportsDB 2–2 (`strStatus` FT); eventos:
  TheSportsDB tem Inácio 3' (assist. Maxi Araújo), Suárez 17' (assist. Fresneda),
  amarelos a Van Ee 36' e Javi Sánchez 44' — e mais nada, num jogo com 4 golos.
  Conclusão: fonte incompleta, não usada.
* **Totais calculados vs. tabela**: Liga 2026/27 calculada dos resultados =
  7 J, 4V 3E 0D, 17–8 → 15 pts e +9; a classificação do Wikipédia dá Sporting
  7 J, +9, 15 pts. Coincide.
* **Comparação de épocas** (Wikipédia): 2020/21 Liga 26-7-1, 2023/24 29-3-2 —
  os registos dos títulos dessas épocas.

**Interface (browser, 1440×900, 1366×860, 390×844; sem scroll horizontal)**

As respostas de `/api/jogo` foram substituídas na página por respostas
produzidas pelo **normalizador real** a partir dos dados de teste:

| Cenário | Resultado visto |
|---|---|
| Em direto, 2.ª parte, 67' | "Em direto · 67'", 1–0, 6 entradas (início, amarelo 12', intervalo 0–0, golo 58', 2 trocas com sentido certo) |
| Golo do Sporting 30' | 1–1, golo com assistência |
| Golo anulado pelo VAR | volta a 1–0; o golo sai, entra "VAR · Golo anulado" |
| Mesma resposta outra vez | 7 entradas, sem duplicados |
| Fim (1–2) | "Resultado final", posse 42–58 %, xG 0,91–1,4, tabela de jogadores; classificação: Sporting 3.º → 2.º (▲1) |
| football-data gratuito | "Com atraso", sem minuto, lances "não inclui" |
| Falha da fonte | dados anteriores com "Desatualizado" e "estes dados são das 20:52" |
| Real, hoje antes do jogo | "Agendado", aviso de dados indisponíveis + Google/zerozero/Liga Portugal; Equipas aponta a notícia do onze d'A BOLA |

Contas (o Supabase real não foi usado para criar contas nem entrar com
credenciais inventadas; as chamadas de autenticação foram simuladas na página):
validação ("Escreve o teu nome de utilizador.", "pelo menos 8 caracteres",
"O código tem 16 letras…"), estado "A entrar…", erro de credenciais com a
palavra-passe limpa, entrada com "@nome" no cabeçalho, código mostrado uma vez
(não fecha sem "Já guardei"), recuperação com erro e com sucesso.
Visitante: entrada → "Continuar como visitante" → cabeçalho com Entrar, chat
com convite, ligação direta `/ao-vivo` abre sem entrada.

**Segredos**: `git grep` sem chaves no código seguido; `.vercelignore` exclui
`chave-*.txt`, `cache/`, `tests/`; a chave antiga da API-Football aparece no
histórico (commits `93858b5` e `b65684c`) → tem de ser trocada.

## 7. Limitações que continuam

* **Sem fonte de dados em direto ativa**: o centro de jogo diz
  "indisponíveis" até haver chave (e, para a época atual, plano pago).
* Recuperação só por código: as 12 contas atuais **não têm código** até
  entrarem e o gerarem (o site pede-o ao entrar). Sem código, só o
  administrador consegue repor (SQL).
* O reset por SQL usa bcrypt no `auth.users.encrypted_password` (o formato que
  o Supabase Auth documenta); foi verificado na base de dados, **não** com uma
  entrada real depois do reset.
* A proteção contra palavras-passe vazadas do Supabase é só do plano Pro.
* Impacto na classificação: pontos, diferença e golos marcados; o confronto
  direto (1.º critério da Liga) não entra — está escrito na página.
* As horas do calendário do Wikipédia são lidas como hora de Lisboa.
* Sem Content-Security-Policy (há scripts inline e imagens de muitos jornais;
  precisa de um passo próprio para não partir nada).
* A função de gatilho `chat_carimbar_autor` continua executável por `anon`
  (aviso do Supabase, anterior a esta reformulação; inofensiva fora de um gatilho).
