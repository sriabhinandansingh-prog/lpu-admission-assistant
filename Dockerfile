FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8787
ENV STATIC_DIR=/app
EXPOSE 8787
CMD ["node", "server/server.js"]
