import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

/*
=====================================================
WHY HTTPS MATTERS HERE
=====================================================

Browsers only expose navigator.mediaDevices.getUserMedia
on a SECURE CONTEXT: https://, or http://localhost.

So this works:
    http://localhost:5173          <- secure exception
and this does NOT:
    http://192.168.1.7:5173        <- camera/mic blocked

Testing a video call needs two participants, which
usually means a second device on the LAN. On plain HTTP
that second device silently gets no camera, and the app
reports what looks like a permission denial.

    npm run dev        -> http://localhost:5173
                          One machine, two browser
                          profiles. No certificate
                          warnings.

    npm run dev:lan    -> https://192.168.x.x:5173
                          Two devices. Self-signed, so
                          each device shows a one-time
                          "not private" warning ->
                          Advanced -> Proceed.

HTTPS is only enabled for dev:lan, so the everyday
workflow stays exactly as it was.

Note: "--mode lan" still loads .env (Vite loads .env in
every mode), so the Firebase configuration is unchanged.
=====================================================
*/

export default defineConfig(({ mode }) => {
  const useHttps = mode === 'lan'

  return {
    plugins: [react(), ...(useHttps ? [basicSsl()] : [])],

    server: {
      // host: true exposes the server on the LAN.
      host: useHttps ? true : 'localhost',
      port: 5173,
    },
  }
})
