# ==========================================
# Stage 1: Build Public React App
# ==========================================
FROM node:20-alpine AS public-builder
WORKDIR /app/public
COPY apps/public/package*.json ./
RUN npm install
COPY apps/public ./
ENV VITE_DEMO_MODE=false
# Build production bundle with standard base URL
RUN npm run build

# ==========================================
# Stage 2: Build Admin React Dashboard
# ==========================================
FROM node:20-alpine AS admin-builder
WORKDIR /app/admin
COPY apps/admin/package*.json ./
RUN npm install
COPY apps/admin ./
ENV VITE_DEMO_MODE=false
# Build production bundle
RUN npm run build

# ==========================================
# Stage 3: Nginx Production Web Server
# ==========================================
FROM nginx:alpine
RUN rm -rf /etc/nginx/conf.d/default.conf

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built public and admin assets to Nginx html directory
COPY --from=public-builder /app/public/dist /usr/share/nginx/html/public
COPY --from=admin-builder /app/admin/dist /usr/share/nginx/html/admin

# Expose Port 80 (Public site) and Port 8080 (Admin dashboard)
EXPOSE 80 8080

CMD ["nginx", "-g", "daemon off;"]
