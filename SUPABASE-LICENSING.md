# Configuração de licenças do PrecisionFix

O MVP valida as chaves online através de uma Supabase Edge Function. Cada licença pode ser associada a um computador e não tem expiração automática. A chave fica guardada localmente com a encriptação segura do Windows; no Supabase é guardado apenas o seu SHA-256. Ao ativar, cada pessoa escolhe também um nome de perfil, guardado de forma encriptada apenas nesse computador e não enviado ao Supabase.

## 1. Criar o projeto Supabase

1. Cria um projeto no [Supabase](https://supabase.com/).
2. Instala e inicia sessão na [Supabase CLI](https://supabase.com/docs/guides/cli).
3. Na raiz do projeto, associa-o ao teu projeto com `supabase link --project-ref <PROJECT_REF>`.
4. Aplica a migração: `supabase db push`.
5. Define o segredo da função: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>`.
6. Publica a função: `supabase functions deploy validate-license`.

O `SUPABASE_SERVICE_ROLE_KEY` só existe nos segredos do Supabase. **Nunca o coloques no `license-config.json`, na aplicação, no GitHub ou num executável.**

## 2. Configurar o executável

No painel do Supabase, abre **Project Settings → API** e copia o Project URL e a chave pública `anon` (ou a chave publicável compatível com a configuração do projeto). Preenche `license-config.json`:

```json
{
  "supabaseUrl": "https://TEU-PROJETO.supabase.co",
  "supabaseAnonKey": "A_TUA_CHAVE_PUBLICA"
}
```

A chave pública pode estar no cliente; a tabela não concede acesso direto a `anon` ou `authenticated`. Depois de configurar, cria o instalador/executável novamente para incluir a configuração. Sem a configuração e a função publicadas, o programa permanece bloqueado.

## 3. Criar uma licença

No **SQL Editor** do Supabase, executa esta consulta para gerar uma chave aleatória. Guarda o resultado apresentado: a chave original não é armazenada na base de dados e não pode ser recuperada depois.

```sql
with generated as (
  select 'PF-' || upper(encode(extensions.gen_random_bytes(24), 'hex')) as license_key
),
saved as (
  insert into public.license_keys (key_hash)
  select encode(extensions.digest(license_key, 'sha256'), 'hex')
  from generated
  returning key_hash
)
select generated.license_key
from generated
join saved on saved.key_hash = encode(extensions.digest(generated.license_key, 'sha256'), 'hex');
```

## 4. Desativar ou libertar uma licença

Para revogar uma chave, calcula o hash SHA-256 da chave normalizada (`PF-` e 48 caracteres hexadecimais em maiúsculas) e executa:

```sql
update public.license_keys
set active = false, revoked_at = now()
where key_hash = encode(extensions.digest('PF-<CHAVE_HEXADECIMAL>', 'sha256'), 'hex');
```

Para transferir a licença para outro computador, revoga a associação antiga com cuidado:

```sql
update public.license_keys
set device_id = null, activated_at = null
where key_hash = encode(extensions.digest('PF-<CHAVE_HEXADECIMAL>', 'sha256'), 'hex')
  and active = true;
```

O programa volta a validar a licença ao iniciar e a cada cinco minutos. Se estiver sem internet durante a validação, permanece bloqueado até conseguir contactar o serviço.

## Limites do modelo

O identificador é criado e guardado localmente; reinstalar o Windows, apagar os dados da aplicação ou mover a instalação pode exigir a libertação manual da associação pelo administrador. Como o programa é distribuído como Electron, esta é uma barreira prática de acesso, não DRM inviolável. A função usa a chave de serviço apenas no servidor; não existe segredo administrativo no executável.
