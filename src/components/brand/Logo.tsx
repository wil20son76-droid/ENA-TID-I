"use client";

// Punto único de uso del logo en el cliente (§"Centraliza las rutas/uso
// del logo para que no quede duplicado innecesariamente en el código").
// Lee siempre el mismo archivo público (public/brand/logo.png) que
// src/lib/server/brandAssets.ts usa del lado servidor para generar
// favicon/iconos PWA — un solo archivo maestro alimenta toda la app.
//
// Si el archivo todavía no existe (antes de que se suba el logo
// definitivo), el <img> se queda en el DOM pero oculto ([hidden], onError)
// en vez de mostrar un ícono de imagen rota — cada pantalla que usa <Logo>
// ya tiene su propio texto de marca al lado, así que no queda nada
// visualmente roto mientras tanto. Se mantiene adjunto (nunca
// desmontado del todo) a propósito: así el elemento sigue siendo
// localizable en pruebas automatizadas como parte cableada de cada
// pantalla, exista o no todavía el archivo real.
import { useState } from "react";

export const LOGO_PUBLIC_PATH = "/brand/logo.png";

export function Logo({
  className,
  alt = "ENA TID'I — Finca integral agropiscícola",
}: {
  className?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  // Proporciones reales del logo desconocidas de antemano (se preservan
  // con width:auto); next/image exige dimensiones fijas o "fill" con un
  // contenedor de aspecto ya conocido, mismo criterio que
  // PondGeometryFields/gráficos SVG propios: sin dependencia adicional
  // para un caso de un único archivo local pequeño.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_PUBLIC_PATH}
      alt={alt}
      draggable={false}
      hidden={failed}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
