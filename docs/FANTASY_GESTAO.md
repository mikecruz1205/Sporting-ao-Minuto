# Fantasy — introduzir estatísticas e calcular as jornadas

Os pontos da Fantasy calculam-se no servidor a partir das estatísticas de cada jogo. Enquanto não houver uma fonte automática, alguém com conta de **administrador** introduz os números do relatório oficial do jogo no separador **Gestão** da Fantasy.

## 1. Ter uma conta de administrador
A 18 de outubro de 2026 não havia nenhuma, por isso as 35 jornadas ficaram sem pontos. No Supabase (SQL), com o nome de utilizador da conta:

```sql
insert into public.fantasy_admins (perfil_id)
select id from public.perfis where utilizador = 'o_teu_utilizador';
```

## 2. Gestão → Jornadas em atraso
Lista as jornadas cujo jogo já começou e que ainda não estão finalizadas, com o estado de cada uma:

| Estado | Significado |
|---|---|
| sem estatísticas | é preciso introduzir os números |
| com estatísticas, por calcular | o botão "Calcular … jornadas" trata disso |
| provisória | já tem pontos; pode ser corrigida e depois finalizada |

## 3. Introduzir as estatísticas de um jogo
- **Golos e resultado da Wikipédia**: preenche o resultado e os golos (e os autogolos) a partir do calendário. É preciso confirmá-los com o relatório oficial.
- **Colar o relatório do jogo**: uma linha por jogador que jogou, no formato `nome; minutos; golos; assistências; amarelos; vermelhos; defesas; golos sofridos`. Basta o nome e os minutos. Também serve `Nome 90 1`. O que faltar fica "sem dados", e não zero.
- O site avisa dos nomes que não reconhece e dos que servem a mais do que um jogador (por exemplo "Silva": escreve "Rui Silva").
- **Guardar e calcular (provisória)** grava e calcula os pontos. Ao fim de 48 horas (ou com **Finalizar**) a jornada fica final.
