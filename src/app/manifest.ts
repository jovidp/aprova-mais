import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aprova+ — Estudos para concursos",
    short_name: "Aprova+",
    description: "Materiais, questões, simulados, cronograma e desempenho.",
    lang: "pt-BR",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f8fafc",
    theme_color: "#2f54eb",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Resolver questões", url: "/resolver" },
      { name: "Cronograma", url: "/cronograma" },
      { name: "Revisões", url: "/revisoes" },
    ],
  };
}
