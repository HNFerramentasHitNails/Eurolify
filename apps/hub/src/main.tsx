import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { aplicarTema, temaGuardado } from "./tema";
import "./tokens.css";
import "./estilos.css";

// O tema escolhido antes do primeiro ecrã, para não aparecer com o outro
// (docs/22 §4).
aplicarTema(temaGuardado(), document.documentElement);

const raiz = document.getElementById("raiz");
if (raiz === null) throw new Error("falta o elemento #raiz");
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
