#!/bin/sh
set -e

# Function to fetch parameters from AWS Parameter Store
fetch_aws_params() {
  echo "Fetching parameters from AWS Parameter Store for environment: $NODE_ENV"
  
  # Get all parameters under the environment path
  PARAMS=$(aws ssm get-parameters-by-path \
    --path "/streambet/$NODE_ENV/" \
    --recursive \
    --with-decryption \
    --region $AWS_REGION \
    --query "Parameters[*].[Name,Value]" \
    --output text)
  
  # Export parameters as environment variables
  echo "$PARAMS" | while read -r LINE; do
    PARAM_NAME=$(echo "$LINE" | awk '{print $1}' | sed "s|/streambet/$NODE_ENV/||")
    PARAM_VALUE=$(echo "$LINE" | awk '{$1=""; print $0}' | xargs)
    export "$PARAM_NAME"="$PARAM_VALUE"
    echo "Loaded parameter: $PARAM_NAME"
  done
  
  echo "Parameters loaded successfully"
}

# If AWS_REGION is set and not running locally, fetch parameters
if [ -n "$AWS_REGION" ] && [ "$RUN_LOCAL" != "true" ]; then
  fetch_aws_params
fi

# Start the application
exec "$@" 