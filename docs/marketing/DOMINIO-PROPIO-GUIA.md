# Guía — Dominio propio para la landing (pendiente hasta nuevo aviso)

> Decisión 2026-09-14: el dominio propio queda **en pausa**. Esta guía queda lista para ejecutarlo
> en ~20 minutos cuando se decida.

## 1. Comprar el dominio

Registrars recomendados (pagando con tarjeta, ~USD 10-12/año para un `.com`):

| Registrar                | Nota                                                          |
| ------------------------ | ------------------------------------------------------------- |
| **Cloudflare Registrar** | precio a costo (sin recargo), DNS incluido — requiere tarjeta |
| **Porkbun**              | barato y simple, interfaz amigable                            |
| **Namecheap**            | el más conocido, soporte en español                           |

Opciones de nombre: `gentlevanguard.com`, `academy.gentlevanguard.com` (el subdominio se configura
igual), o `.com.ar` gratis vía nic.ar (si el público es Argentina).

## 2. Conectarlo a GitHub Pages (10 minutos)

1. En el repo de publicación (`gentlevanguard/gentlevanguard.github.io`): **Settings → Pages →
   Custom domain** → escribir el dominio (ej. `academy.gentlevanguard.com`) → Save.
2. En el registrar, agregar el registro DNS que GitHub indique:
   - **Subdominio** (`academy.tudominio.com`): un `CNAME` → `gentlevanguard.github.io`
   - **Dominio raíz** (`tudominio.com`): 4 registros `A` → `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`
3. Esperar la propagación de DNS (5 min a 24 h, normalmente <1 h).
4. En Settings → Pages: marcar **"Enforce HTTPS"**.

## 3. Ajustes en este stack (los hacemos nosotros)

- `apps/academy-web/scripts/build-landing.mjs`: `SITE_URL` → el dominio nuevo (canonical, og:image y
  sitemap quedan apuntando ahí).
- Regenerar landing + commit + push (deploy automático).
- Regenerar el QR (`docs/marketing/assets/landing-qr.png`) al dominio nuevo.
- Actualizar este documento y `LANDING-PLAYBOOK.md` con el URL definitivo.

## 4. Checklist final

- [ ] Dominio comprado y DNS apuntando
- [ ] Custom domain en Settings → Pages + Enforce HTTPS
- [ ] `SITE_URL` actualizado y landing regenerada y deployada
- [ ] QR regenerado
- [ ] Probar: carga, pestañas, WhatsApp, formulario
