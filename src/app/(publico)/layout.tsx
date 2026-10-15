import Link from "next/link";
import { GraduationCap } from "lucide-react";

export default function LayoutPublico({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          Aprova+
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-primary-foreground">
          <p className="text-3xl font-semibold leading-tight">Seus materiais, questões e simulados trabalhando juntos.</p>
          <p className="mt-4 max-w-md text-primary-foreground/80">
            Importe seus PDFs, resolva questões autorais geradas a partir deles, faça simulados com correção comentada e
            acompanhe exatamente onde está errando.
          </p>
        </div>
      </div>
    </div>
  );
}
