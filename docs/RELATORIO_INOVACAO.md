# Relatório — onde melhorar e inovar no Sporting ao Minuto (18 de outubro de 2026)

Análise feita ao código e ao site em produção, com medições reais (não estimativas).

## Em resumo
1. **As notícias gastam cerca de 4 MB por minuto** a quem tem o site aberto: o browser descarrega o XML completo de 12 jornais a cada 60 s, sem compressão. Só o Notícias ao Minuto pesa 3 MB.
2. **A Fantasy nunca deu pontos**: há 35 jornadas, 0 calculadas e 0 linhas de estatísticas. Os pontos dependem de alguém introduzir as estatísticas à mão. Há 13 contas e 1 equipa.
3. **Todas as páginas carregam tudo**: os scripts da Fantasy, do quiz, do museu, do centro de jogo e da entrada (~170 KB), mais 14 ficheiros de CSS (~430 KB, 41 `!important`) e cerca de 7 000 elementos na página.
4. **As notificações push estão prontas no browser, mas desligadas**: faltam as chaves e quem as envie.
5. **As partilhas mostram sempre o mesmo cartão**: o WhatsApp e as redes não correm JavaScript, por isso um jogo partilhado aparece igual à página inicial.

## O que foi medido

| Medição | Valor |
|---|---|
| Página Notícias em produção | 100 pedidos; ~4,1 MB das notícias; 530 KB de scripts; 430 KB de CSS; 528 KB de imagens |
| Feeds dos jornais | 12 + 1 pedidos a cada 60 s, `no-store`, sem gzip; o maior tem 3 021 KB |
| Código | `app.js` com 4 941 linhas (224 KB); 17 ficheiros JS; 14 ficheiros CSS; 130 media queries |
| Elementos na página | ~6 990 (todas as vistas vivem no mesmo HTML) |
| Terceiros | Google Fonts, jsDelivr (supabase-js), Wikipédia, Supabase |
| Acessibilidade | 0 imagens sem `alt`; 0 botões sem nome; 2 campos sem rótulo; 2 `h1`; 195 ligações que abrem num separador novo sem aviso |
| Uso (Supabase) | 13 contas; 1 equipa Fantasy; 0 jornadas com pontos; 7 mensagens no chat (a última a 9/10); 0 contas com código de recuperação |
| Segurança (avisos do Supabase) | `chat_carimbar_autor` pode ser chamada sem sessão |
| Fontes em falta | API-Football sem chave (a carreira dos jogadores dá sempre 503); SportScore integrada mas desligada (sem resultado em direto) |

## Melhorias (corrigir o que existe)

| # | O quê | Porquê | Esforço |
|---|---|---|---|
| M1 | Notícias agregadas no servidor: um só `/api/noticias` que lê os jornais, filtra o Sporting, junta, comprime e guarda em cache; o browser pede só o que mudou | De ~4 MB/min para dezenas de KB; menos bateria e dados móveis | Médio |
| M2 | Fantasy com pontos: importar as estatísticas de cada jogo com um formulário rápido de gestão (colar o relatório do jogo) ou, com fonte em direto, automaticamente | 35 jornadas sem um único ponto; é a funcionalidade principal da comunidade | Médio |
| M3 | Carregar só o que cada página usa: scripts e CSS por vista, e o supabase-js só quando é preciso | Página inicial mais leve e rápida, sobretudo no telemóvel | Médio |
| M4 | Arrumar o CSS: juntar os 14 ficheiros num sistema de estilos, tirar regras mortas e `!important` | Menos conflitos (o bug do `hidden` veio daqui) e menos peso | Grande |
| M5 | Partir o `app.js` (4 941 linhas) em módulos por vista | Manutenção e testes mais fáceis | Grande |
| M6 | Privacidade: alojar as fontes e o supabase-js no próprio site | Hoje cada visita envia o IP à Google e ao jsDelivr | Pequeno |
| M7 | Acessibilidade: rótulos nos 2 campos, um só `h1` por vista, aviso de "abre num separador novo" | Fecha os pontos que faltam | Pequeno |
| M8 | Segurança: fechar `chat_carimbar_autor` a quem não tem sessão | Aviso do Supabase | Pequeno |
| M9 | Carreira dos jogadores: esconder enquanto não houver chave, ou trocar de fonte | Hoje mostra sempre "fonte indisponível" | Pequeno |
| M10 | Testes de ponta a ponta (Playwright) dos fluxos principais e, com autorização, testes automáticos no GitHub | Evitar regressões como o campo gigante e o `hidden` | Médio |

## Inovações (coisas novas)

| # | O quê | Como, sem inventar dados nem custos | Depende de ti? |
|---|---|---|---|
| I1 | Notificações push: início do jogo, resultado final, notícias "Oficial", fecho da jornada Fantasy e Desafio do Dia | Chaves VAPID (grátis) e envio pelo Supabase (pg_cron + Edge Function); o Vercel Hobby só tem cron diário | Sim: criar as chaves e guardá-las na Vercel/Supabase |
| I2 | Notícias agrupadas: "esta história está em 5 jornais", selo "Oficial" e linha do tempo de rumores por jogador (quantos jornais, desde quando) | Agrupar por semelhança de títulos e datas; não se escreve texto novo | Não |
| I3 | Prognósticos e "Homem do jogo": cada conta prevê o resultado até ao apito inicial e vota no melhor jogador no fim; classificação nas ligas privadas | Tabelas novas no Supabase, com fecho validado no servidor | Não |
| I4 | Calendário no telemóvel: `/api/calendario.ics` para subscrever os jogos no Google/Apple Calendar | Gerado do calendário que o site já lê; atualiza sozinho | Não |
| I5 | Páginas partilháveis com pré-visualização própria: `/jogo/...` e `/jogador/...` | O servidor devolve título, descrição e imagem de pré-visualização; depois abre o site | Não |
| I6 | Quiz vivo: perguntas da época atual geradas dos resultados e marcadores verificados ("Quem marcou ao Lens?"), ligas de amigos no Quiz e um desafio semanal | Só a partir de dados com fonte; continua a validação do banco | Não |
| I7 | Modo dia de jogo: a página inicial muda no dia do jogo (contagem decrescente, meteorologia no estádio pela Open-Meteo, centro de jogo em destaque) | A Open-Meteo é grátis e sem chave | Não |
| I8 | "O meu Sporting": seguir modalidades e jogadores, com notícias e avisos filtrados; guardado na conta | Preferências no Supabase | Não |
| I9 | Resultado em direto (SportScore, já integrado e desligado): golos ao minuto, push de golo e pontos Fantasy automáticos | Ligar `SPORTSCORE_ATIVO=1` depois de leres os termos | Sim: termos e ativação |

## Decisões que são tuas
- Ler os termos da SportScore e ativar `SPORTSCORE_ATIVO=1` (desbloqueia I9 e parte de M2 e I1).
- Criar as chaves VAPID para as notificações (I1), guardadas só no servidor.
- Autorizar a pasta `.github/` para os testes automáticos (M10).
- Chave da API-Football: pagar ou deixar a carreira escondida (M9).

## Ordem recomendada
M1 → M2 → I3 → I4 → I2 → I1 → M3/M6 → I5 → I6 → I7 → I8 → M7/M8/M9 → M4/M5/M10.
Primeiro o que gasta dados e o que não funciona; depois o que traz pessoas de volta (prognósticos, avisos, calendário); por fim a arrumação técnica.
