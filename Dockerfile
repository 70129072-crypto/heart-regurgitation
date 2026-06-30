# Use an official Python runtime as the base image
FROM python:3.12-slim

# Set the working directory inside the container
WORKDIR /app

# Copy requirements first (to leverage Docker caching)
COPY requirements.txt .

# Install dependencies
# RUN pip install --default-timeout=1000 --no-cache-dir -r requirements.txt
RUN pip install --default-timeout=1000 -r requirements.txt


# Copy the rest of your application code
COPY . .

# Expose the port your app runs on (change if needed)
EXPOSE 8000

# Command to run your application
CMD ["python", "app.py"]