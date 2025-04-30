FROM node:18-alpine

WORKDIR /app

# Copy package files and version files
COPY package*.json ./
COPY version.json ./
COPY increment-version.js ./

# Install dependencies
RUN npm install

# Increment version and store it
RUN node increment-version.js > .version

# Copy application files
COPY . .

# Create logs directory with proper permissions
RUN mkdir -p /app/logs && chown -R node:node /app/logs

# Set version as environment variable
ARG VERSION_ARG
RUN VERSION_ARG=$(cat .version) && \
    echo "VERSION=$VERSION_ARG" >> /app/.env && \
    echo "LUMIGO_DISABLE_PINO_INSTRUMENTATION=true" >> /app/.env && \
    echo "CONTAINER_ENV=true" >> /app/.env && \
    chown node:node /app/.env

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 