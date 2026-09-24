# Salas permanentes

O frontend exige a migração `migrations/20260924160000_private_rooms_auth.sql` no **mesmo projeto Supabase** configurado em `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`). Aplique a migração antes de publicar o frontend, pois ela substitui as políticas abertas de `messages_chat` por RLS para membros autenticados.

Se o projeto antigo não estiver acessível, é possível usar um projeto novo sob controle do usuário. A migração também cria `messages_chat` quando a tabela ainda não existe. O backup do projeto antigo deve ser importado pelo script `scripts/import-legacy-messages.mjs` com a chave administrativa do **novo** projeto, guardada apenas em variável de ambiente ou arquivo privado local (`WEBCHAT_TARGET_CONFIG_FILE`). Nunca coloque essa chave no frontend ou no Git. Só atualize `.env.local` e as variáveis da hospedagem após validar a importação.

1. Faça backup do banco atual.
2. Execute a migração no SQL Editor do projeto ou com uma conexão administrativa.
3. Confirme no painel Auth que o provedor **Email** está ativado. O SMTP padrão de um projeto novo só envia mensagens aos integrantes da organização. Para uso por duas pessoas sem SMTP próprio, crie as duas contas pelo Admin API com `email_confirm: true`, gere senhas temporárias e desative o cadastro público (`disable_signup: true`). O formulário de cadastro e a recuperação por e-mail ficam ocultos por padrão. Cada pessoa pode trocar a senha depois de entrar. Se configurar SMTP, ative os respectivos controles com `NEXT_PUBLIC_ALLOW_SIGNUP=true` e `NEXT_PUBLIC_ALLOW_PASSWORD_RESET=true` e revise a política de cadastro.
4. Confirme que a tabela `messages_chat` está na publicação `supabase_realtime` para continuar recebendo mensagens instantaneamente. Ative canais privados do Realtime; os canais `sala:<id>` agora usam `private: true`.
5. Publique o frontend. Entre nas duas contas, reivindique a sala antiga pelo código dela em uma das contas e use o novo convite para a segunda. Salas novas também comportam duas contas.

As mensagens antigas ficam no banco. O código antigo serve apenas para a primeira reivindicação; depois disso, entrar com ele não concede acesso. O convite novo é um UUID separado do ID da sala e deixa de aceitar novas pessoas quando há dois membros.
