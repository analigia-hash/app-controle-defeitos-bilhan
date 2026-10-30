# App Controle de Defeitos — Bilhan

Lançamento semanal das peças com defeito e painel com o custo das perdas.
Feito a partir do PRD "App de Controle de Defeitos" (30/10/2026). Usa o mesmo Supabase do app de estoque.

## Ligar no computador

Dois cliques em **`INICIAR APP.bat`** → abre `http://localhost:5174`.
(Na primeira vez ele instala as dependências sozinho.) Pelo terminal: `npm run dev`.

## Banco de dados

Tudo está em [`supabase/001_controle_defeitos.sql`](supabase/001_controle_defeitos.sql). Ele só **cria** tabelas
com o prefixo `def_` e lê `peca_sku` / `peca_custo` / `dtf_perfil` do estoque, sem alterar nada delas.

- Quem é **master** no estoque DTF vira **admin** aqui; quem é **producao** vira **lançador**.
  Os papéis depois se ajustam em *Cadastros → Usuários*.
- **Custo médio da peça** = média do `custo_total` dos SKUs ativos do modelo ligado à peça
  (Camiseta → CAMISETA PADRAO, Cropped padrão → CROPPED PADRAO, Cropped SHEIN → CROPPED SHEIN,
  Moletom → MOLETOM CANGURU). Dá para trocar o modelo em *Cadastros → Peças*.
- **Cores** são copiadas de `peca_sku` sempre que alguém abre a tela de lançamento.
- O custo é calculado **no banco** ao salvar a linha e fica congelado. Mudar só a quantidade mantém o
  custo unitário; o gestor pode usar *Recalcular custos* na semana.
- O lançador **não tem acesso de leitura** à tabela com custos — ele só enxerga as linhas pela função
  `def_linhas_sem_custo`, que não devolve valores em R$.

## Abas

| Aba | Quem vê | O que faz |
|---|---|---|
| Lançar semana | todos | escolhe a semana (sábado a sexta), adiciona linhas passo a passo, repete a última linha, avisa e soma duplicadas; gestor fecha/reabre e recalcula |
| Meu histórico | todos | linhas que a própria pessoa lançou, só quantidades |
| Painel | gestor, admin | filtros, cartões com variação, custo por semana, por defeito, por responsável, por peça, mapas de calor, tabela e exportação CSV |
| Cadastros | admin | peças, defeitos, finalidades, responsáveis, cores, parâmetros de custo com vigência, usuários |

## Publicar na Netlify

Build `npm run build`, pasta `dist`. Cadastrar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nas variáveis
de ambiente do site, e incluir o endereço do site em Supabase → Authentication → URL Configuration.

## Ainda não feito (Fase 2 do PRD)

- Foto no lançamento (a coluna `foto_url` já existe).
- Lembrete no WhatsApp na sexta à tarde.
