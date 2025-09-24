# Use a lightweight Nginx image as a base
FROM nginx:alpine

# Copy all application files into the web server's directory
COPY . /usr/share/nginx/html

# Copy our custom Nginx configuration file
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the entrypoint script
COPY entrypoint.sh /entrypoint.sh

# Make the entrypoint script executable
RUN chmod +x /entrypoint.sh

# Expose port 8080, which is the standard port Cloud Run listens on
EXPOSE 8080

# Set the entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# The command to start Nginx (will be called by the entrypoint script)
CMD ["nginx", "-g", "daemon off;"]
