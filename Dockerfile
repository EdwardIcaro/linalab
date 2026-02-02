# Use Node.js 18 Alpine image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy todo o projeto
COPY . .

# Instalar dependências do backend
WORKDIR /app/backend
RUN npm install

# Build TypeScript
RUN npm run build

# Gerar Prisma Client
RUN npx prisma generate

# Tornar script de startup executável
RUN chmod +x /app/backend/start.sh

# Expor porta
EXPOSE 3001

# Rodar aplicação com migrations
CMD ["/app/backend/start.sh"]
