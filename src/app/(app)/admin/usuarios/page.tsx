import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { exigirAdmin } from "@/lib/auth";
import { adminDisponivel, clienteAdmin } from "@/lib/supabase/servidor";
import { ipDoCliente } from "@/lib/rede/ip";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/basicos";
import { Button } from "@/components/ui/button";
import { Aviso, CabecalhoPagina, Tabela } from "@/components/ui/layout";
import { formatarDataHora } from "@/lib/utils";
import { AcoesUsuario, BloquearIpManual, Desbloquear } from "./controles";

export const metadata: Metadata = { title: "Usuários · Administração" };

export default async function PaginaUsuarios() {
  const eu = await exigirAdmin();
  if (!adminDisponivel()) return <Aviso tipo="erro">SUPABASE_SECRET_KEY não configurada no servidor.</Aviso>;
  const admin = clienteAdmin();
  const meuIp = ipDoCliente(await headers());

  const [{ data: lista, error }, { data: perfis }, { data: acessos }, { data: ips }, { data: emails }, { data: materiais }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("profiles").select("id, nome, papel"),
    admin.from("acessos_usuario").select("user_id, ip, ultimo_em, acessos, user_agent").order("ultimo_em", { ascending: false }),
    admin.from("ips_bloqueados").select("ip, motivo, email_relacionado, created_at").order("created_at", { ascending: false }),
    admin.from("emails_bloqueados").select("email, motivo, created_at").order("created_at", { ascending: false }),
    admin.from("materiais").select("user_id"),
  ]);
  if (error) return <Aviso tipo="erro">Não foi possível listar os usuários: {error.message}</Aviso>;

  const perfil = new Map((perfis ?? []).map((p) => [p.id, p]));
  const qtdMateriais = (materiais ?? []).reduce((m, x) => m.set(x.user_id, (m.get(x.user_id) ?? 0) + 1), new Map<string, number>());
  const usuarios = [...(lista?.users ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const ipsDe = (id: string) => (acessos ?? []).filter((a) => a.user_id === id).map((a) => ({ ...a, ip: String(a.ip).replace(/\/(32|128)$/, "") }));

  return (
    <>
      <CabecalhoPagina titulo="Usuários" descricao={`${usuarios.length} conta(s). Seu IP atual: ${meuIp ?? "não identificado"} (IPs de administradores nunca são bloqueados).`}
        acoes={<Button variant="outline" asChild><Link href="/admin"><ArrowLeft /> Administração</Link></Button>} />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <Tabela>
            <thead><tr><th>Usuário</th><th>Cadastro</th><th>Último acesso</th><th>IPs usados</th><th className="text-right">Materiais</th><th /></tr></thead>
            <tbody>
              {usuarios.map((u) => {
                const p = perfil.get(u.id);
                const banido = u.banned_until && new Date(u.banned_until) > new Date();
                const ipsUsuario = ipsDe(u.id);
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="font-medium">{u.email ?? "(sem e-mail)"}</div>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {p?.nome && <span>{p.nome}</span>}
                        {p?.papel === "admin" && <Badge>Master</Badge>}
                        {u.id === eu.id && <Badge variant="outline">Você</Badge>}
                        {banido && <Badge variant="destructive">Banido</Badge>}
                        {!u.email_confirmed_at && <Badge variant="warning">E-mail não confirmado</Badge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{formatarDataHora(u.created_at)}</td>
                    <td className="whitespace-nowrap">{u.last_sign_in_at ? formatarDataHora(u.last_sign_in_at) : "—"}</td>
                    <td>
                      {ipsUsuario.length === 0 ? <span className="text-xs text-muted-foreground">nenhum registrado</span> : (
                        <ul className="grid gap-0.5 text-xs">
                          {ipsUsuario.slice(0, 4).map((a) => (
                            <li key={a.ip} title={a.user_agent ?? undefined}>
                              <span className="font-mono">{a.ip}</span> <span className="text-muted-foreground">· {a.acessos}× · {formatarDataHora(a.ultimo_em)}</span>
                            </li>
                          ))}
                          {ipsUsuario.length > 4 && <li className="text-muted-foreground">+{ipsUsuario.length - 4}</li>}
                        </ul>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{qtdMateriais.get(u.id) ?? 0}</td>
                    <td className="text-right">
                      {u.id !== eu.id && p?.papel !== "admin" && (
                        <AcoesUsuario userId={u.id} email={u.email ?? ""} banido={Boolean(banido)} ips={ipsUsuario.map((a) => a.ip)} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4" /> IPs bloqueados</CardTitle>
            <CardDescription>Bloqueio permanente de todo o site (inclusive login e cadastro). Aceita IP exato ou faixa (ex.: 200.100.50.0/24).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <BloquearIpManual />
            {!ips?.length ? <p className="text-sm text-muted-foreground">Nenhum IP bloqueado.</p> : (
              <ul className="grid gap-2 text-sm">
                {ips.map((b) => (
                  <li key={String(b.ip)} className="flex items-start justify-between gap-2 rounded-md border p-2">
                    <div>
                      <span className="font-mono">{String(b.ip).replace(/\/(32|128)$/, "")}</span>
                      <div className="text-xs text-muted-foreground">{[b.email_relacionado, b.motivo, formatarDataHora(b.created_at)].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Desbloquear tipo="ip" valor={String(b.ip)} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>E-mails bloqueados</CardTitle>
            <CardDescription>Estes e-mails não conseguem criar conta novamente (barrado no próprio banco de dados).</CardDescription>
          </CardHeader>
          <CardContent>
            {!emails?.length ? <p className="text-sm text-muted-foreground">Nenhum e-mail bloqueado.</p> : (
              <ul className="grid gap-2 text-sm">
                {emails.map((e) => (
                  <li key={e.email} className="flex items-start justify-between gap-2 rounded-md border p-2">
                    <div>{e.email}<div className="text-xs text-muted-foreground">{[e.motivo, formatarDataHora(e.created_at)].filter(Boolean).join(" · ")}</div></div>
                    <Desbloquear tipo="email" valor={e.email} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
