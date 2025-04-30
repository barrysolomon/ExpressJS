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

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Set version as environment variable
ARG VERSION_ARG
RUN VERSION_ARG=$(cat .version) && echo "VERSION=$VERSION_ARG" >> /app/.env

# Start the application
CMD ["npm", "start"] 