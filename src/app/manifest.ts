import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Koragna — Messagerie éphémère",
    short_name: "Koragna",
    description:
      "Discussions anonymes, chiffrées de bout en bout, pair-à-pair. Aucun compte, aucune trace.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#05060a",
    theme_color: "#05060a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
