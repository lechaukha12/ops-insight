FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN npm run build

EXPOSE 8000
ENV PORT=8000

CMD ["npm", "run", "start", "--", "-p", "8000"]
