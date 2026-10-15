-- Moderação: registro de IPs de acesso, bloqueio permanente de IPs e de
-- e-mails. Somente administradores leem ou alteram estas tabelas.

-- IPs reais de acesso (vindos do cabeçalho x-forwarded-for na Vercel).
create table public.acessos_usuario (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ip inet not null,
  user_agent text check (char_length(user_agent) <= 500),
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  acessos int not null default 1,
  primary key (user_id, ip)
);
create index acessos_usuario_ip_idx on public.acessos_usuario (ip);

-- IP exato (1.2.3.4) ou faixa (1.2.3.0/24).
create table public.ips_bloqueados (
  ip inet primary key,
  motivo text check (char_length(motivo) <= 500),
  email_relacionado text,
  criado_por uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.emails_bloqueados (
  email text primary key check (email = lower(email)),
  motivo text check (char_length(motivo) <= 500),
  criado_por uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.acessos_usuario enable row level security;
alter table public.ips_bloqueados enable row level security;
alter table public.emails_bloqueados enable row level security;
create policy "acessos: admin lê" on public.acessos_usuario for select to authenticated using (public.is_admin());
create policy "ips bloqueados: admin" on public.ips_bloqueados for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "emails bloqueados: admin" on public.emails_bloqueados for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.acessos_usuario, public.ips_bloqueados, public.emails_bloqueados from anon;
revoke insert, update, delete on public.acessos_usuario from authenticated;

-- Registra o IP do usuário logado (no máximo uma escrita a cada 10 minutos por IP).
create or replace function public.registrar_acesso(p_ip text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ip inet;
begin
  if v_uid is null then
    return;
  end if;
  begin
    v_ip := host(p_ip::inet)::inet;
  exception when others then
    return; -- IP ausente ou inválido: nada a registrar
  end;
  insert into public.acessos_usuario as a (user_id, ip, user_agent)
  values (v_uid, v_ip, left(p_user_agent, 500))
  on conflict (user_id, ip) do update
    set ultimo_em = now(), acessos = a.acessos + 1, user_agent = excluded.user_agent
    where a.ultimo_em < now() - interval '10 minutes';
end;
$$;

-- Consultada pelo proxy em toda requisição (com cache): o IP está bloqueado?
create or replace function public.ip_bloqueado(p_ip text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (select 1 from public.ips_bloqueados b where b.ip >>= p_ip::inet);
exception when others then
  return false;
end;
$$;

-- Impede o cadastro (inclusive direto pela API do Supabase) de e-mails banidos.
create or replace function public.bloquear_email_banido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and exists (select 1 from public.emails_bloqueados e where e.email = lower(new.email)) then
    raise exception 'Cadastro não permitido para este e-mail' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger bloquear_email_banido before insert or update of email on auth.users
  for each row execute function public.bloquear_email_banido();

-- Nunca bloquear um IP (ou faixa) já usado por um administrador: evita se trancar para fora.
create or replace function public.proteger_ips_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.acessos_usuario a join public.profiles p on p.id = a.user_id
             where p.papel = 'admin' and new.ip >>= a.ip) then
    raise exception 'Este IP (ou faixa) é usado por um administrador e não pode ser bloqueado' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger proteger_ips_admin before insert or update on public.ips_bloqueados
  for each row execute function public.proteger_ips_admin();

revoke execute on function public.registrar_acesso(text, text) from public, anon;
grant execute on function public.registrar_acesso(text, text) to authenticated;
revoke execute on function public.ip_bloqueado(text) from public;
grant execute on function public.ip_bloqueado(text) to anon, authenticated;
revoke execute on function public.bloquear_email_banido() from public, anon, authenticated;
