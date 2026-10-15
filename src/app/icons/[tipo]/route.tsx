import { ImageResponse } from "next/og";

const TAMANHOS: Record<string, { lado: number; margem: number }> = {
  "192": { lado: 192, margem: 0 },
  "512": { lado: 512, margem: 0 },
  maskable: { lado: 512, margem: 80 },
  apple: { lado: 180, margem: 0 },
};

export function generateStaticParams() {
  return Object.keys(TAMANHOS).map((tipo) => ({ tipo }));
}

/** Ícones do app gerados como PNG (capelo estilizado sobre fundo azul). */
export async function GET(_: Request, { params }: RouteContext<"/icons/[tipo]">) {
  const { tipo } = await params;
  const t = TAMANHOS[tipo];
  if (!t) return new Response("Não encontrado", { status: 404 });
  const interno = t.lado - t.margem * 2;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#2f54eb", borderRadius: t.margem || tipo === "apple" ? 0 : t.lado * 0.22 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "white", fontWeight: 800, fontSize: interno * 0.34, letterSpacing: -interno * 0.01 }}>
          <span style={{ display: "flex" }}>A+</span>
        </div>
      </div>
    ),
    { width: t.lado, height: t.lado },
  );
}
