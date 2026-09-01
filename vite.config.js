import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// HTTPS is required for camera access when testing on real devices over LAN.
// Set SNAPFIT_HTTP=1 to serve plain HTTP (e.g. for localhost automation).
const useHttps = process.env.SNAPFIT_HTTP !== '1';

export default defineConfig({
  plugins: useHttps ? [basicSsl()] : [],
});
