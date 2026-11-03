# Local web server for the CRM: the same Node.js server that runs on Hostinger.
# Dependencies are installed in /app; the project folder is mounted live at /app/src.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
CMD ["node", "/app/src/server.js"]
