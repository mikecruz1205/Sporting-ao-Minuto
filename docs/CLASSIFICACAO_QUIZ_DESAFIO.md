# Classificação, telemóvel, estados vazios, PC, página inicial, Quiz Leonino e Desafio do Dia (16 de outubro de 2026)

## O que estava mal e porquê

| Problema | Causa | Correção |
|---|---|---|
| A Liga mostrava zeros e "a época ainda não começou" ao abrir | A tabela arrancava com a lista de reserva de `js/data.js` (18 equipas por ordem alfabética, tudo a 0) e só era substituída quando a sincronização acabava | As tabelas começam vazias, com esqueleto; "ainda não começou" só aparece se a fonte trouxer a tabela com 0 jogos. As listas de reserva foram retiradas |
| Estatísticas da Champions visíveis no separador Liga | O resumo da Champions e o cartão "Os adversários" tinham o atributo `hidden`, mas o CSS (`display: grid` / `display: flex`) sobrepunha-se-lhe | Regra global `[hidden]{display:none!important}` em `css/base.css` (havia 10 regras soltas a remendar casos parecidos) |
| O separador não ficava no endereço | Só vivia numa variável | `/classificacao?comp=liga` ou `?comp=champions`; também com Recuar e Avançar, e com as setas do teclado |
| Erro 503 na consola | `/api/api?p=players?id=…&season=…`: a carreira da API-Football para a ficha do jogador em destaque, pedida no arranque em qualquer página; a chave da API-Football não está configurada na Vercel | A carreira só é pedida com o Plantel à vista; um 503 é lembrado 30 min; a ficha diz que a fonte não responde e tem "Tentar outra vez". O football-data (`/api/fd`) responde 200 em produção (a chave está configurada) |
| Últimos resultados de julho enquanto carregava | O calendário arrancava com o retrato guardado no código | Esqueleto até a fonte responder; falha → mensagem e "Tentar outra vez" |
| "Ainda não há jogos" e "a época começa a 8 de agosto" com a época a decorrer | Mensagens de vazio mostradas antes de os dados chegarem | Esqueleto enquanto carrega; vazio só depois da resposta |
| Plantel com "Médios 31, Guarda-redes 0" | Contagens feitas sobre a lista provisória (só nomes) | Sem contagens até chegar o plantel a sério |
| Plantel de recurso com "0 jogos, 0 golos" | O retrato do zerozero não tem estatísticas | "números da época indisponíveis" e "—" |
| Fantasy/chat "sem jornada aberta"/"ninguém escreveu" com o servidor em baixo | O Supabase devolve `error` (não lança exceção) e isso era tratado como vazio | Os erros são tratados como erros, com "Tentar outra vez" |
| Lotação do estádio | O site dizia 50 095; depois das obras de 2025 são 52 095 (Wikipédia) | Corrigido |

## Telemóvel (testado a 375 px)
- Marca em duas linhas em vez de cortada; "Entrar" com texto.
- Alvos de toque com pelo menos 44 × 44 px: procurar, alertas, conta, entrar, "saltar para o conteúdo", chips, listas de escolha, rodapé e quadro tático.
- Classificação com título, separadores e fonte empilhados; a tabela mostra todas as colunas e desliza para o lado, com a posição e a equipa fixas.
- A barra inferior não mudou.

## PC
- Página inicial em grelha: notícias, jogos seguintes e classificação em 3 colunas a partir de 1200 px (2 colunas a partir de 900 px).
- Tabelas ordenáveis ao clicar no cabeçalho: classificação, jogadores (Estatísticas) e estatísticas individuais. Clicar outra vez inverte a ordem; o cabeçalho tem `aria-sort`.
- Pesquisa com `/` (fora de campos de texto) ou Ctrl+K / ⌘K.

## Página inicial (5 blocos)
1. Jogo: o próximo e os últimos resultados.
2. Destaques.
3. Painel: últimas notícias (jornal, hora, título e excerto de 2 linhas, com ligação para o jornal), os jogos a seguir e a classificação.
4. Época em números.
5. Jogar e conversar: Fantasy, Quiz Leonino, Desafio do Dia e chat.

Saíram da página inicial as repetições: Importantes 24 h, Ao minuto, Mais lidas, Próximos jogos, Modalidades, Mercado/Vídeos/Rumores e "Leva o Sporting contigo". Continuam todos nas vistas próprias. Cada tabela indica a fonte e a hora de atualização.

## Quiz Leonino (`/quiz`, `js/quiz.js`, `css/quiz.css`)
- 15 perguntas: 1–5 fáceis, 6–10 médias, 11–15 difíceis, com 4 respostas cada e só uma certa (a ordem das respostas é baralhada).
- Escada de pontos: 10, 20, 30, 50, **100** · 150, 200, 300, 450, **600** · 800, 1000, 1250, 1500, 1906 (o ano da fundação). Patamares seguros nas perguntas 5 e 10. Pode-se parar antes de responder e ficar com os pontos da última pergunta certa.
- Ajudas, uma vez cada: 50:50 (tira duas erradas), trocar a pergunta (outra da mesma dificuldade) e ajuda do público (percentagens simuladas e plausíveis, assinaladas como simulação).
- Depois de cada resposta aparece a explicação e a fonte. Teclado: 1–4 ou A–D.
- Recorde: neste browser (`localStorage`) e, com conta, na conta (`quiz_recordes`, gravado só por `quiz_guardar_recorde`, que aceita só valores da escada e guarda o maior; cada conta só vê o seu).

### Banco de perguntas (`dados/quiz.json`)
53 perguntas (15 fáceis, 18 médias, 20 difíceis) em seis categorias: história, títulos, jogadores, estádio, modalidades e presidentes. Cada uma tem `id`, `pergunta`, `opcoes` (4), `correta` (índice), `dificuldade`, `categoria`, `fonte` (nome e ligação) e `explicacao`. Os factos foram lidos nos artigos da Wikipédia em português indicados em cada pergunta e no palmarés já verificado. Não foram usadas frases que a própria Wikipédia marca "carece de fontes".

**Validar**: `python scripts/validar_quiz.py` confirma que cada pergunta tem exatamente 4 opções diferentes, um índice de resposta certa válido, dificuldade, categoria, fonte com ligação https e explicação, e que há perguntas suficientes de cada dificuldade. Valida a forma, não a verdade: antes de acrescentar uma pergunta, é preciso ler o facto na fonte.

## Desafio do Dia (`/desafio`)
- Uma pergunta por dia, igual para todos: o dia é o de Lisboa e a escolha é determinística (ordem baralhada com semente fixa; não se repete antes de o banco acabar).
- Uma resposta por dia, com explicação e fonte; sequência de dias seguidos certos (neste browser).
- "Partilhar o resultado" diz se acertou e a sequência, nunca a resposta. Antes de responder só há "Desafiar um amigo".
- Cartão na página inicial com a pergunta de hoje (sem a resposta) e ligação para a página.

## Como testar cada parte
- **Testes automáticos**: `python -m unittest discover -s tests` (48 testes, inclui os de JavaScript) ou `node --test tests/` (24 testes de JavaScript: Fantasy, museu, quiz e desafio). Banco: `python scripts/validar_quiz.py`.
- **SQL** (Supabase, dentro de uma transação desfeita): `supabase/testes/quiz_testes.sql`, que deu 7 passos e 0 falhas.
- **Classificação**: abrir `/classificacao?comp=champions` e confirmar que abre na Champions; mudar para Liga e confirmar que o endereço muda para `?comp=liga` e que o resumo e os adversários da Champions desaparecem. Com a rede lenta (DevTools → Network → Slow 3G) aparece o esqueleto, nunca zeros. Com a rede desligada aparece "Não foi possível carregar a classificação" e "Tentar outra vez".
- **Telemóvel**: DevTools a 375 px. A marca aparece inteira, "Entrar" tem texto e a tabela desliza com a equipa fixa.
- **PC**: clicar em PTS (ordena do maior para o menor) e outra vez (inverte); premir `/` ou Ctrl+K para abrir a pesquisa.
- **Quiz**: `/quiz` → Começar. Responder, usar as três ajudas, parar; errar depois da 5.ª deixa 100 pontos e depois da 10.ª deixa 600.
- **Desafio**: `/desafio` → responder (fica bloqueado até amanhã) → Partilhar (o texto não tem a resposta).
