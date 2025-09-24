# Use a lightweight Nginx image as a base
FROM nginx:alpine

# Copy the application's static files (HTML, TSX, etc.) into the web server's directory
COPY . /usr/share/nginx/html

# Copy our custom Nginx configuration file
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 8080, which is the standard port Cloud Run listens on
EXPOSE 8080

# The command to start Nginx when the container starts
CMD ["nginx", "-g", "daemon off;"]
