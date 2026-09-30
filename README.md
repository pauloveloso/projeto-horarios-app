# Horários IFNMG Januária

Aplicativo móvel de consulta pública da grade acadêmica do IFNMG – Campus Januária, feito com Expo e React Native para Android e iOS.

## O que já está preparado

- Seleção entre versões publicadas da grade, priorizando a versão vigente.
- Consulta por turma, professor ou espaço, com busca na lista.
- Horários agrupados por dia e com aulas, professor, turma e espaço.
- Layout de agenda otimizado para telas de celular.
- Exportação da grade semanal em PDF pelo diálogo nativo de impressão, com opção de salvar como PDF.
- Leitura direta das mesmas tabelas Supabase usadas pelo sistema web.
- Cópia local das versões e horários acessados, com sincronização automática ao abrir o app com conexão.
- Restauração da última consulta selecionada após fechar e reabrir o app.

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` com os dados do projeto Supabase em produção. No sistema web, a URL está em `NEXT_PUBLIC_SUPABASE_URL` e a chave pública em `NEXT_PUBLIC_SUPABASE_ANON_KEY`; use os mesmos valores com os nomes Expo acima.
3. Confira se as tabelas públicas usadas pela consulta permitem `SELECT` para o papel `anon`, com políticas RLS apropriadas.
4. Inicie o servidor Expo:

   ```bash
   npm start
   ```

Abra o QR code com Expo Go ou use `npm run android` / `npm run ios` em um ambiente de desenvolvimento compatível. Builds de loja podem ser gerados com EAS Build.

## Dados consultados

`versoes_grade` (somente `PUBLICADA`), `aulas`, `turmas`, `cursos`, `professores`, `disciplinas`, `espacos`, `categorias_espacos` e `slots_horarios`.

O app não implementa login nem telas de gestão nesta primeira etapa. As credenciais do Supabase ficam em `.env`, ignorado pelo Git. A chave usada no app deve ser a publishable/anon key, nunca uma chave `service_role`.

Os horários disponíveis offline são os das grades que já foram carregadas no dispositivo. Na primeira abertura, conecte o app à internet para salvar a grade. Quando há conexão, o app busca dados atualizados e substitui a cópia local apenas depois de carregar todas as tabelas com sucesso.

## Requisitos de desenvolvimento

Este projeto usa Expo SDK 57 e requer Node.js 22.13 ou superior para executar o Expo CLI e gerar builds.
