import { defineConfig } from "vitest/config";

// Um ficheiro de testes de cada vez: os que usam a base (comerciante.test.ts,
// catalogo.test.ts) dão LOGIN ao papel eurolify_api no início e tiram-no no
// fim (base-de-teste.ts), e o papel é da instância, não de cada base — em
// paralelo, o fim de um ficheiro fechava a porta ao outro.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
