export default function ConfiguracaoPendente() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Configuração pendente</h1>
      <p className="text-muted-foreground">
        As variáveis <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> não estão
        definidas. Copie <code>.env.example</code> para <code>.env.local</code>, preencha com os dados do seu projeto
        Supabase e reinicie o servidor. Consulte <code>docs/INSTALACAO.md</code>.
      </p>
    </div>
  );
}
