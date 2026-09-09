FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source files
COPY . .

# Expose API port
EXPOSE 4001

# Start server
CMD ["node", "index.js"]
