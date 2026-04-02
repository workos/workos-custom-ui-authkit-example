import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const frontendPort = parseInt(env.FRONTEND_PORT || "5176");
  const backendPort = env.PORT || "3001";

  return {
    plugins: [react()],
    server: {
      port: frontendPort,
      proxy: {
        "/api": `http://localhost:${backendPort}`,
      },
    },
    test: {
      include: ["**/*.test.{ts,tsx,js}"],
    },
  };
});
