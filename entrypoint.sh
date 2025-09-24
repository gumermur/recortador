#!/bin/sh
# This script creates a JavaScript file with environment variables
# that can be loaded by the frontend.

# Create the env.js file in the web root
cat <<EOF > /usr/share/nginx/html/env.js
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: "${GOOGLE_CLIENT_ID}",
  GOOGLE_API_KEY: "${GOOGLE_API_KEY}"
};
EOF

# Execute the original command (starts Nginx)
exec "$@"
