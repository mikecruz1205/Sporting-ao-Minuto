# Dados desportivos, Fantasy e A BOLA

Estado a 9 de outubro de 2026. Tudo o que aqui está foi testado com pedidos
reais; onde uma fonte não respondeu, isso está escrito.

---

## 1. Fontes testadas

| Fonte | Teste feito | Resultado | Uso no site |
|---|---|---|---|
| **API-Football** (api-sports.io), chave em `chave-api.txt` | `status`, `teams?id=228`, `leagues?id=94&season=2026`, `fixtures?team=228&season=2026`, `fixtures?team=228&season=2024` | **Conta suspensa** (`"Your account is suspended, check on dashboard.api-football.com"`). Além disso o plano gratuito só dá as épocas **2022 a 2024** (`"Free plans do not have access to this season, try from 2022 to 2024"`). Limite: 100 pedidos/dia. | Fotografias já descarregadas (150×150, `img/players/<id>.png`) e IDs externos. Estatísticas da época atual: **não**, sem plano pago. |
| **football-data.org** | `/api/fd?p=teams/498`, `competitions/PPL/standings` pelo proxy do site | **Sem token configurado** (nem no Vercel nem no computador). Não foi possível testar dados. | Pronto a usar: `api/fd.py`, `js/fd.js` e `scripts/sincronizar_jogos.py` esperam `FOOTBALL_DATA_TOKEN`. |
| **TheSportsDB** (chave pública de teste `123`) | `searchteams.php?t=Sporting CP`, `lookup_all_players.php?id=135708` | Sporting CP = **135708**. A chave gratuita devolve só **10 jogadores**, com plantel desatualizado (Adán, Bruno Paulista…). | **Não usado** — não serve como fonte do plantel nem das fotos. |
| **Wikipédia** (API aberta, CC BY-SA) | página `2026–27 Sporting CP season` e épocas 2019–20 a 2025–26 | 43 jogos 2026/27 (Liga, Taça da Liga, Champions) com resultados e marcadores; presenças e golos de 33 jogadores; plantel de 29. Páginas antigas têm formatos diferentes. | Calendário/jornadas, presenças e golos da época (preços iniciais), **arquivo de épocas**. |
| **zerozero** (`dados/plantel_zz.json`, de `atualizar_plantel.py`) | ficheiro existente | 31 jogadores, nº, posição, idade, país. | Plantel atual, IDs zerozero. Fotografias zerozero **não** são usadas no Fantasy. |
| **A BOLA** | `/rss`, `/rss/sporting`, `/feed`, `/rss.xml`, `robots.txt`, `sitemap-news.xml` | **Não tem RSS** (`/rss/sporting` só redireciona para a página da secção). O `robots.txt` anuncia `sitemap-news.xml` (formato Google News): 296 artigos dos últimos ~3 dias, 22 sobre o Sporting, com título, data e endereço — **sem imagens**. | Fonte de notícias pelo sitemap. Só título, data e link; o artigo abre no site d'A BOLA. |

### Escolha

* **Fonte principal para o Fantasy (grátis): football-data.org**, quando tiver
  token. Dá por jogo, num só pedido, o onze, o banco, golos com marcador e
  assistente, cartões e substituições com o minuto — chega para minutos,
  golos, assistências, cartões, autogolos e golos sofridos com o jogador em
  campo. Cobre a **Liga Portugal (PPL)** e a **Liga dos Campeões (CL)**.
  Não dá defesas, penáltis falhados/defendidos nem recuperações (ficam "sem dados").
* **Alternativa paga: API-Football** (plano com a época atual). Dá, num
  pedido por jogo, minutos, golos, assistências, cartões, penáltis, defesas e
  golos sofridos do guarda-redes. **Precisa da tua decisão** (custo).
* **Sem nenhuma das duas**: as estatísticas de cada jogo introduzem-se à mão
  no separador **Gestão** do Fantasy, a partir do relatório oficial do jogo.
  É o que funciona hoje, de graça.
* **Wikipédia** para o calendário e os números da época; **API-Football**
  (ficheiros já guardados) para as fotografias.

---

## 2. Modelo de dados (Supabase, `supabase/migrations/`)

```
desporto_jogadores ──< desporto_jogador_ids (fonte, id_externo)   ← evita duplicados
        │
        ├──< desporto_estatisticas_jogo >── desporto_jogos (fonte, id_externo)
        ├──< desporto_estatisticas_epoca (época, competição, fonte)
        ├──< fantasy_jogadores (elegível)        desporto_sincronizacoes (registo)
        └──< fantasy_precos (histórico) ── fantasy_preco_atual (vista)

fantasy_jornadas (1 jogo do Sporting = 1 jornada, com fecho) ──< fantasy_pontos_jogador (detalhe auditável)
perfis ── fantasy_perfis ──< fantasy_equipa_jornada ──< fantasy_escolhas (15, titular/banco, C, V, preço de compra)
                          ├──< fantasy_transferencias      ├──< fantasy_resultados (onze, banco, capitão, penalização, total)
                          ├──< fantasy_historico           └──< fantasy_liga_membros >── fantasy_ligas (código)
fantasy_config (jogo, pontuacao, precos)    fantasy_admins    vistas: fantasy_classificacao, fantasy_classificacao_jornada
```

* Valores desconhecidos são `NULL`, nunca `0`.
* O browser **só lê**. Escreve-se apenas por funções `SECURITY DEFINER` que
  validam quem chama: `fantasy_guardar_equipa`, `fantasy_criar_liga`,
  `fantasy_entrar_liga`, `fantasy_sair_liga` (utilizador); `fantasy_importar_jogo`,
  `fantasy_calcular_jornada`, `fantasy_finalizar_jornada`,
  `fantasy_importar_calendario`, `desporto_importar_jogadores`,
  `desporto_importar_estatisticas_epoca`, `fantasy_definir_precos_iniciais`
  (administrador ou servidor).
* RLS: a equipa dos outros só se vê depois do fecho da jornada; transferências
  e histórico só o próprio; ligas só os membros.
* Importações **idempotentes**: o jogador encontra-se pelos IDs externos, o
  jogo por `(fonte, id_externo)`; correr outra vez atualiza, não duplica.

Dados reais carregados: 36 jogadores (IDs zerozero/Wikipédia/API-Football,
27 com fotografia), 31 linhas de época 2026/27, 43 jogos, 35 jornadas
(a 1 é SC Braga x Sporting, 09/10 20:15), 36 preços iniciais.

---

## 3. Regras do Fantasy (em `fantasy_config`, alteráveis sem mexer no código)

**Plantel**: 15 (2 GR, 5 DEF, 5 MED, 3 AVA), 100 M€ Fantasy. Onze com 1 GR,
3–5 DEF, 2–5 MED, 1–3 AVA. Banco de 4 por ordem (o primeiro é o GR).
Capitão (×2) e vice, ambos titulares.

**Pontuação**

| Ação | Pontos |
|---|---:|
| Jogar ≥ 1 minuto | +1 |
| Jogar ≥ 60 minutos | +1 adicional |
| Golo GR / DEF | +6 |
| Golo MED | +5 |
| Golo AVA | +4 |
| Assistência | +3 |
| Baliza inviolada GR / DEF (≥ 60′) | +4 |
| Baliza inviolada MED (≥ 60′) | +1 |
| Cada 3 defesas (GR) | +1 |
| Cada 3 recuperações | +1 (só se a fonte der o número) |
| Penálti defendido | +5 |
| Amarelo | −1 |
| Vermelho | −3 |
| Penálti falhado | −2 |
| Autogolo | −2 |
| Golos sofridos GR / DEF | −1 por cada 2 |

**Definições**
* *Assistência*: o passe ou toque que dá diretamente o golo, como a fonte o regista; não há assistência num autogolo do adversário.
* *Autogolo*: −2 para quem o marca; conta como golo sofrido.
* *Golos sofridos*: com o jogador em campo, quando a fonte os dá; senão o total do jogo, só para quem jogou ≥ 60′.
* *Cartões*: com vermelho (direto ou por acumulação) os amarelos não descontam.
* *Não jogou*: 0 pontos; substituição automática pelo 1.º suplente (ordem do banco) que jogou e mantenha a formação válida; GR só por GR. Capitão sem jogar → o vice fica com o bónus.
* *Estatística em falta*: não dá pontos e fica assinalada "sem dados" no detalhe.
* *Correções*: enquanto a jornada é **provisória**, importar de novo recalcula tudo do zero (idempotente — nenhuma substituição se aplica duas vezes).
* *Provisória → final*: quando o administrador finaliza (o objetivo é ~48 h depois do jogo, `horas_ate_final`). Depois disso as estatísticas não podem mudar.

**Transferências**: a primeira equipa é livre; depois 2 grátis por jornada, −4 pontos por cada extra. Trocar quem saiu do plantel é grátis. Fecho = hora do início do jogo (`fecho_minutos_antes`).

**Preços** (não são valores de mercado): inicial = base da posição (GR 4,5 · DEF 5,0 · MED 5,5 · AVA 6,5) + 0,15 por jogo da época (máx. 2,0) + golos da época × (GR/DEF 0,5 · MED 0,35 · AVA 0,3; máx. 3,0), arredondado a 0,5. Depois de cada jornada final: média ≥ 6 nas últimas 3 → +0,1; jogou e média ≤ 1 → −0,1. Histórico em `fantasy_precos`. Quem fica mantém o preço de compra; quem sai vende ao preço atual — nada retroativo.

---

## 4. Testes

* `supabase/testes/fantasy_testes.sql` — corre numa transação desfeita no fim
  (nenhum dado de teste fica). **0 falhas**:
  11 casos de pontuação; 6 validações recusadas (onze de 10, repetidos,
  capitão no banco, banco sem GR à frente, 6 defesas, orçamento);
  equipa válida; RLS antes/depois do fecho; importação e reimportação
  idempotente; 2 substituições automáticas + vice-capitão (37 pontos) e
  capitão normal (38); classificação; 3 transferências com −4 e orçamento
  exato; equipa anterior intacta; variação de preços com histórico;
  estatísticas recusadas depois de finalizar.
* `python scripts/sincronizar_jogos.py --testar` — normalização do
  football-data e da API-Football (minutos, golos, assistências, penáltis,
  expulsões, golos sofridos em campo, "sem dados" ≠ 0): **OK**.
* Interface testada no browser (375 px e 1280 px, tema claro e escuro):
  montar plantel pelo mercado, formação corrigida automaticamente, capitão,
  vice, trocas, regras, pontos, classificação, ligas, arquivo.

---

## 5. Variáveis de ambiente e segredos

| Variável | Onde | Para quê |
|---|---|---|
| `FOOTBALL_DATA_TOKEN` | Vercel (Settings → Environment Variables) e onde correr o script | classificação, jogos e estatísticas (grátis, registo em football-data.org) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **só** onde correr `scripts/sincronizar_jogos.py` (nunca no repositório nem no browser) | enviar estatísticas para o servidor |
| `API_FOOTBALL_KEY` (ou `chave-api.txt`) | só no servidor/script | se a conta for reativada ou passar a plano pago |

A chave do Supabase que está em `js/nuvem.js` é a **publicável** (pública por
desenho; quem protege os dados é o RLS).

---

## 6. Operação

1. **Tornar-te administrador** (uma vez), no editor SQL do Supabase:
   `insert into fantasy_admins (perfil_id) select id from perfis where utilizador = 'O_TEU_UTILIZADOR';`
2. **Depois de cada jogo**: Fantasy → **Gestão** → escolhe a jornada →
   resultado e números do relatório oficial → *Guardar e calcular* (fica
   provisória). Corrigir é voltar a guardar. → *Finalizar jornada* (preços mexem).
   Com token do football-data: `python scripts/sincronizar_jogos.py --fonte football-data --jogo <id> --jogo-interno <id> --enviar`.
3. **Calendário**: `fantasy_importar_calendario` (o script
   `scripts/preparar_importacao_fantasy.py` prepara o JSON a partir do
   plantel e do Wikipédia).

---

## 7. O que ficou por fazer (e porquê)

* **Estatísticas automáticas da época atual**: precisam de `FOOTBALL_DATA_TOKEN` (grátis) ou de um plano pago da API-Football. Até lá, introdução manual.
* **Centro de jogo em direto com posse, remates, cantos, passes, defesas**: nenhuma fonte gratuita testada os dá em direto para o Sporting. O centro atual continua a marcar como estimativa o que não é oficial.
* **Taças nacionais**: não estão no plano gratuito do football-data → manual.
* **Recuperações de bola**: nenhuma fonte disponível → regra fica inativa.
* **Fecho automático "provisória → final"** às 48 h: está a cargo do administrador (pode passar a tarefa agendada com `pg_cron`).
* **Proteção de palavras-passe vazadas** (Supabase Auth): desligada — ativar no painel.
* Arquivo: páginas antigas do Wikipédia nem sempre dizem a competição de cada jogo; esses jogos aparecem como "competição não identificada".
