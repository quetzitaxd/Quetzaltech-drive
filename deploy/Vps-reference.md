# Guía de deploy para nuevas landings en el VPS

> Instrucciones para el agente de IA que desarrolle una nueva landing localmente y luego la despliegue en el VPS.

---

## 1. Stack recomendado

Para mantener consistencia con los proyectos actuales (`quetzaltech`, `yammidlc`, `tiendanancy`):

| Capa | Tecnología |
|------|-----------|
| Framework | **Astro** (recomendado) o HTML/CSS/JS puro |
| Servidor web | **Nginx** en contenedor Docker |
| Proxy / SSL | **Nginx Proxy Manager** (`proxy-app-1`, ya existe en el VPS) |
| Deploy | Docker Compose en `/srv/nuevalanding` |
| Control de versiones | Git + GitHub |

- Usá **Astro** si la landing necesita componentes reutilizables, rutas o SSR.
- Usá **HTML/CSS/JS puro** si es una landing muy simple (como `yammidlc`).

---

## 2. Estructura de carpetas

```
/srv/nuevalanding/
├── src/                    # Código fuente Astro o HTML
│   ├── pages/
│   │   └── index.astro
│   ├── layouts/
│   │   └── BaseLayout.astro
│   └── components/
├── public/                 # Assets estáticos (img, fonts, favicon)
├── dist/                   # Build output (si aplica)
├── docker-compose.yml
├── Dockerfile              # Solo si requiere build (Astro/React)
├── nginx.conf
├── .env.example
├── .gitignore
└── README.md
```

---

## 3. `docker-compose.yml` estándar

```yaml
name: nuevalanding

services:
  web:
    # Opción A: Astro/React que requiere build
    build:
      context: .
      dockerfile: Dockerfile

    # Opción B: HTML/CSS/JS puro (sin build)
    # image: nginx:alpine
    # volumes:
    #   - ./src:/usr/share/nginx/html:ro

    container_name: nuevalanding-web
    restart: unless-stopped
    networks:
      - proxy
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.5'

networks:
  proxy:
    external: true
```

> **Importante:** la red `proxy` es externa y obligatoria. Ahí vive Nginx Proxy Manager.

---

## 4. `Dockerfile` para Astro

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

> Si usás HTML puro, no necesitás `Dockerfile`. Solo montá `./src` en nginx.

---

## 5. `nginx.conf` mínimo

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## 6. `.env.example`

```bash
# Variables públicas de ejemplo
SITE_URL=https://nuevalanding.com
API_URL=https://api.otroproyecto.com
```

> Nunca subir `.env` real a Git. Solo el `.env.example`.

---

## 7. `.gitignore`

```gitignore
node_modules/
dist/
.env
.DS_Store
*.log
```

---

## 8. Pasos de deploy en el VPS

### Paso 1: Localmente

```bash
git init
git remote add origin git@github.com:quetzitaxd/nuevalanding.git
git add .
git commit -m "feat: initial landing"
git push -u origin main
```

### Paso 2: En el VPS

```bash
cd /srv
git clone git@github.com:quetzitaxd/nuevalanding.git
cd nuevalanding
docker compose up -d --build
```

### Paso 3: En Nginx Proxy Manager

1. Abrir `http://158.69.211.253:81`
2. Ir a **Proxy Hosts → Add Proxy Host**
3. Completar:
   - **Domain Names:** `nuevalanding.com` y `www.nuevalanding.com`
   - **Scheme:** `http`
   - **Forward Hostname/IP:** `nuevalanding-web`
   - **Forward Port:** `80`
   - **Block Common Exploits:** ✅
   - **Cache Assets:** opcional
4. Ir a la pestaña **SSL**
   - **Request a new SSL certificate:** ✅
   - **Agree to TOS:** ✅
   - **Force SSL:** ✅
   - **HTTP/2 Support:** ✅
5. Guardar.

---

## 9. Convenciones para convivir con los otros proyectos

| Aspecto | Convención |
|---------|-----------|
| **Nombres de contenedor** | `{proyecto}-web`, `{proyecto}-backend`, `{proyecto}-db` |
| **Red Docker** | Siempre unirse a la red `proxy` externa |
| **Puertos expuestos al host** | Evitar. Usar Nginx Proxy Manager para exponer al mundo |
| **Puerto interno del contenedor web** | `80` |
| **Restart policy** | `unless-stopped` o `always` |
| **Límites de recursos** | Siempre definir `memory` y `cpus` |
| **Git** | Rama `main`, commits consistentes en español o inglés |
| **Assets pesados** | Optimizar imágenes a WebP, no subir videos grandes al repo |
| **Variables sensibles** | `.env`, nunca en el código |

---

## 10. Checklist antes de dar por terminada

- [ ] `docker compose up -d --build` funciona sin errores
- [ ] El contenedor aparece en `docker ps`
- [ ] Proxy Host configurado en Nginx Proxy Manager
- [ ] SSL activo y forzado
- [ ] El dominio responde con HTTPS
- [ ] `.env` no está en Git
- [ ] Imágenes y video están optimizados
- [ ] Límites de memoria y CPU definidos
- [ ] `README.md` con instrucciones de deploy

---

## 11. Comandos de verificación final

```bash
# Ver contenedor
docker ps --filter name=nuevalanding

# Ver respuesta HTTPS
curl -I https://nuevalanding.com
```

---

## Notas importantes

- El VPS tiene **11 GB de RAM**. Antes de agregar un proyecto, verificar recursos con `free -h` y `df -h`.
- Si la landing no requiere backend, no crear uno solo por costumbre.
- No exponer puertos directamente al host salvo que sea estrictamente necesario.
- Mantener los nombres de contenedor únicos para evitar colisiones.
