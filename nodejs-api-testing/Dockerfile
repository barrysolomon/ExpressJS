FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

# Create the views directory
RUN mkdir -p src/views

# Copy the application files
COPY src/ src/
COPY views/index.ejs src/views/

EXPOSE 3000

CMD ["npm", "start"] 